// Every sign-in, sign-up and password step, run on the server so the Cognito
// client secret and the tokens never reach the browser.
//
//   sign-in        {identifier, password, next?}   phone (E.164) or staff email
//   sign-in-code   {phone, next?}                  "Sign in with a code instead"
//   sign-up        {phone, password, username, email?, language}
//   verify         {code}                          SMS code for sign-up or sign-in
//   resend         {}                              send that code again
//   forgot         {phone}
//   reset          {code, password}
//   new-password   {password}                      staff first sign-in
//   email-start    {email}                         add an email from Profile
//   email-verify   {code}
//   sign-out       {}

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authProvider, currentAccessToken } from "@/server/backend";
import { completeSignIn } from "@/server/signin";
import { AuthError, type AuthStep } from "@/server/auth-provider";
import { COOKIE, clearTokens, readPending, writePending, writeTokens } from "@/server/session";
import { decodeJwt, homeFor, roleFromClaims, safeNext } from "@/lib/jwt";

export const dynamic = "force-dynamic";

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type Body = Record<string, unknown>;

const E164_CM = /^\+237[26]\d{8}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

function str(body: Body, key: string, max = 256): string {
  const value = body[key];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function maskPhone(phone: string): string {
  return `+237 ${phone.slice(4, 5)}•• •• ${phone.slice(-4, -2)} ${phone.slice(-2)}`;
}

import type { PoolType } from "@/server/config";

/**
 * Tokens in hand: store them, move this browser's guest reports into the
 * account if it is a citizen, and say where to go.
 */
async function finish(
  store: CookieStore,
  step: AuthStep,
  next: string | undefined,
  extra: { phone?: string; email?: string; pool?: PoolType }
) {
  const pool = step.pool ?? extra.pool;
  if (step.kind === "challenge") {
    writePending(store, {
      kind: step.challenge,
      username: step.username,
      session: step.session,
      destination: step.destination ?? (extra.phone ? maskPhone(extra.phone) : undefined),
      phone: extra.phone,
      email: extra.email,
      next,
      pool,
    });
    const to =
      step.challenge === "NEW_PASSWORD_REQUIRED"
        ? "/first-sign-in"
        : step.challenge === "SOFTWARE_TOKEN_MFA"
          ? "/verify?purpose=mfa"
          : "/verify?purpose=signin";
    return NextResponse.json({ ok: true, next: to });
  }

  const role = await completeSignIn(store, step.tokens, pool);
  return NextResponse.json({ ok: true, next: safeNext(next, homeFor(role)) });
}

async function run(action: string, body: Body, store: CookieStore) {
  const auth = authProvider();
  const next = str(body, "next", 512) || undefined;

  switch (action) {
    case "sign-in": {
      const identifier = str(body, "identifier");
      const password = typeof body.password === "string" ? body.password.trim() : "";
      if (!identifier || !password) return fail("INVALID_INPUT", "Enter your phone number and password.");
      if (body.staff === true || EMAIL.test(identifier)) {
        try {
          const step = await auth.signInStaff(identifier, password);
          return finish(store, step, next, { email: identifier, pool: step.pool });
        } catch (error) {
          if (error instanceof AuthError && error.code === "ACCOUNT_SUSPENDED") {
            return fail("ACCOUNT_DISABLED", "This staff account has been deactivated. Contact your administrator.", 403);
          }
          throw error;
        }
      }
      if (!E164_CM.test(identifier)) return fail("INVALID_PHONE", "Enter a valid phone number.");
      try {
        const step = await auth.signInWithPassword(identifier, password, "citizen");
        return finish(store, step, next, { phone: identifier, pool: "citizen" });
      } catch (error) {
        if (error instanceof AuthError && error.code === "NOT_CONFIRMED" && E164_CM.test(identifier)) {
          const { destination } = await auth.resendSignUpCode(identifier);
          writePending(store, { kind: "SIGN_UP", username: identifier, phone: identifier, destination: destination ?? maskPhone(identifier), next, pool: "citizen" });
          return NextResponse.json({ ok: true, next: "/verify?purpose=signup" });
        }
        throw error;
      }
    }

    case "staff-sign-in": {
      const email = str(body, "email").toLowerCase();
      const password = typeof body.password === "string" ? body.password.trim() : "";
      if (!email || !password) return fail("INVALID_INPUT", "Enter your staff email and password.");
      if (!EMAIL.test(email)) return fail("INVALID_EMAIL", "Enter a valid email address.");
      try {
        const step = await auth.signInStaff(email, password);
        return finish(store, step, next, { email, pool: step.pool });
      } catch (error) {
        if (error instanceof AuthError && error.code === "ACCOUNT_SUSPENDED") {
          return fail("ACCOUNT_DISABLED", "This staff account has been deactivated. Contact your administrator.", 403);
        }
        throw error;
      }
    }

    case "sign-in-code": {
      const phone = str(body, "phone");
      if (!E164_CM.test(phone)) return fail("INVALID_PHONE", "Enter a valid phone number.");
      return finish(store, await auth.startSmsSignIn(phone), next, { phone });
    }

    case "sign-up": {
      const phone = str(body, "phone");
      const username = str(body, "username", 30);
      const email = str(body, "email").toLowerCase();
      // Cognito passwords never start or end with a space; drop one copied from an email.
      const password = typeof body.password === "string" ? body.password.trim() : "";
      const language = body.language === "fr" ? "fr" : "en";
      if (!E164_CM.test(phone)) return fail("INVALID_PHONE", "Enter a valid phone number.");
      if (email && !EMAIL.test(email)) return fail("INVALID_EMAIL", "Enter a valid email address.");
      const result = await auth.signUp({ phone, password, username, email: email || undefined, language });
      writePending(store, {
        kind: "SIGN_UP",
        username: phone,
        phone,
        session: result.session,
        destination: result.destination ?? maskPhone(phone),
        next,
      });
      store.set(COOKIE.lang, language, { path: "/", maxAge: 31536000, sameSite: "lax" });
      return NextResponse.json({ ok: true, next: "/verify?purpose=signup" });
    }

    case "verify": {
      const code = str(body, "code", 12).replace(/\D/g, "");
      const pending = readPending(store);
      if (!pending) return fail("SESSION_EXPIRED", "That step has expired. Please start again.", 401);
      if (code.length !== 6) return fail("WRONG_CODE", "Enter the 6-digit code.");

      if (pending.kind === "SOFTWARE_TOKEN_MFA" && pending.session) {
        return finish(store, await auth.answerMfaCode(pending.username, pending.session, code, pending.pool), pending.next, {
          phone: pending.phone,
          email: pending.email,
          pool: pending.pool,
        });
      }
      if ((pending.kind === "SMS_OTP" || pending.kind === "SMS_MFA") && pending.session) {
        const step = await auth.answerSmsCode(pending.username, pending.session, code, pending.kind, pending.pool);
        return finish(store, step, pending.next, { phone: pending.phone, pool: pending.pool });
      }
      if (pending.kind === "SIGN_UP") {
        const phone = pending.phone ?? pending.username;
        const confirmed = await auth.confirmSignUp(phone, code, pending.session);
        if (confirmed.session) {
          try {
            return finish(store, await auth.signInAfterSignUp(phone, confirmed.session), pending.next, { phone });
          } catch {
            // Fall through to a normal sign-in.
          }
        }
        store.delete(COOKIE.pending);
        return NextResponse.json({ ok: true, next: "/login?confirmed=1" });
      }
      return fail("SESSION_EXPIRED", "That step has expired. Please start again.", 401);
    }

    case "resend": {
      const pending = readPending(store);
      if (!pending?.phone) return fail("SESSION_EXPIRED", "That step has expired. Please start again.", 401);
      if (pending.kind === "SIGN_UP") {
        const { destination } = await auth.resendSignUpCode(pending.phone);
        writePending(store, { ...pending, destination: destination ?? pending.destination });
        return NextResponse.json({ ok: true, destination: destination ?? pending.destination });
      }
      if (pending.kind === "SMS_OTP") {
        return finish(store, await auth.startSmsSignIn(pending.phone), pending.next, { phone: pending.phone });
      }
      return fail("SESSION_EXPIRED", "That step has expired. Please start again.", 401);
    }

    case "forgot": {
      // Citizens reset by SMS to their phone; staff by email (the pool recovers either).
      const email = str(body, "email").toLowerCase();
      if (email) {
        if (!EMAIL.test(email)) return fail("INVALID_EMAIL", "Enter a valid email address.");
        const { destination } = await auth.forgotPassword(email);
        writePending(store, { kind: "RESET", username: email, email, destination: destination ?? email });
        return NextResponse.json({ ok: true, destination: destination ?? email, next: "/reset-password" });
      }
      const phone = str(body, "phone");
      if (!E164_CM.test(phone)) return fail("INVALID_PHONE", "Enter a valid phone number.");
      const { destination } = await auth.forgotPassword(phone);
      writePending(store, { kind: "RESET", username: phone, phone, destination: destination ?? maskPhone(phone) });
      return NextResponse.json({ ok: true, destination: destination ?? maskPhone(phone), next: "/reset-password" });
    }

    case "reset": {
      const pending = readPending(store);
      if (pending?.kind !== "RESET" || !pending.username) return fail("SESSION_EXPIRED", "Request a new code.", 401);
      const code = str(body, "code", 12).replace(/\D/g, "");
      // Cognito passwords never start or end with a space; drop one copied from an email.
      const password = typeof body.password === "string" ? body.password.trim() : "";
      await auth.confirmForgotPassword(pending.username, code, password);
      store.delete(COOKIE.pending);
      return NextResponse.json({ ok: true, next: "/login?reset=1" });
    }

    case "new-password": {
      const pending = readPending(store);
      if (pending?.kind !== "NEW_PASSWORD_REQUIRED" || !pending.session) {
        return fail("SESSION_EXPIRED", "Please sign in again with your temporary password.", 401);
      }
      // Cognito passwords never start or end with a space; drop one copied from an email.
      const password = typeof body.password === "string" ? body.password.trim() : "";
      return finish(
        store,
        await auth.answerNewPassword(pending.username, pending.session, password, pending.pool),
        pending.next,
        { email: pending.email, pool: pending.pool }
      );
    }

    case "email-start": {
      const email = str(body, "email").toLowerCase();
      if (!EMAIL.test(email)) return fail("INVALID_EMAIL", "Enter a valid email address.");
      const access = await currentAccessToken(store);
      if (!access) return fail("SESSION_EXPIRED", "Please sign in again.", 401);
      const { destination } = await auth.startEmailChange(access, email);
      return NextResponse.json({ ok: true, destination: destination ?? email });
    }

    case "email-verify": {
      const code = str(body, "code", 12).replace(/\D/g, "");
      const access = await currentAccessToken(store);
      if (!access) return fail("SESSION_EXPIRED", "Please sign in again.", 401);
      await auth.verifyEmail(access, code);
      // Refresh now so the new email is in the ID token, and so
      // pre-token-generation copies it into the citizen record.
      const refreshToken = store.get(COOKIE.refresh)?.value;
      const internal = store.get(COOKIE.user)?.value;
      if (refreshToken && internal) {
        try {
          writeTokens(store, await auth.refresh(refreshToken, internal));
        } catch {
          // The next API call refreshes anyway.
        }
      }
      return NextResponse.json({ ok: true });
    }

    // Two-step verification is offered to staff only.
    case "mfa-status":
    case "mfa-setup":
    case "mfa-confirm":
    case "mfa-disable": {
      const access = await currentAccessToken(store);
      const claims = decodeJwt(store.get(COOKIE.id)?.value);
      const role = roleFromClaims(claims);
      if (!access) return fail("SESSION_EXPIRED", "Please sign in again.", 401);
      if (role !== "Employee" && role !== "Admin") return fail("FORBIDDEN", "Not available for this account.", 403);
      if (action === "mfa-status") return NextResponse.json({ ok: true, enabled: await auth.mfaEnabled(access) });
      if (action === "mfa-setup") {
        const { secret } = await auth.startMfaSetup(access);
        const label = encodeURIComponent(`CLEAN-AM:${claims?.email ?? "staff"}`);
        return NextResponse.json({ ok: true, secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=CLEAN-AM` });
      }
      if (action === "mfa-confirm") {
        const code = str(body, "code", 12).replace(/\D/g, "");
        if (code.length !== 6) return fail("WRONG_CODE", "Enter the 6-digit code.");
        await auth.confirmMfaSetup(access, code);
        return NextResponse.json({ ok: true, enabled: true });
      }
      await auth.disableMfa(access);
      return NextResponse.json({ ok: true, enabled: false });
    }

    case "sign-out": {
      await auth.signOut(store.get(COOKIE.refresh)?.value);
      clearTokens(store);
      return NextResponse.json({ ok: true, next: "/" });
    }

    default:
      return fail("NOT_FOUND", "Unknown action.", 404);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  if (request.headers.get("x-cam-csrf") !== "1") return fail("CSRF", "Request blocked.", 403);
  const { action } = await context.params;
  const store = await cookies();
  let body: Body = {};
  try {
    body = ((await request.json()) as Body) ?? {};
  } catch {
    body = {};
  }
  try {
    return await run(action, body, store);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.code, error.message, error.status);
    console.error(`auth/${action} failed`, error);
    return fail("SERVICE_ERROR", "Something went wrong. Please try again.", 500);
  }
}
