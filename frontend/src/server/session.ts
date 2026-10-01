// Session cookies. Tokens live only in httpOnly cookies, so page scripts (and
// anything injected into them) can never read them.

import { cookies } from "next/headers";
import { config } from "./config";
import {
  decodeJwt,
  guestLabelFromToken,
  isExpired,
  roleFromClaims,
  usernameFromClaims,
  type IdClaims,
} from "@/lib/jwt";
import type { Lang, Session } from "@/lib/types";

export const COOKIE = {
  id: "cam_id",
  access: "cam_access",
  refresh: "cam_refresh",
  /** Cognito's internal username; the refresh call's SECRET_HASH needs it. */
  user: "cam_user",
  guest: "cam_guest",
  /** A sign-in or sign-up step in progress (Cognito session + username). */
  pending: "cam_pending",
  /** State and PKCE verifier while the browser is away at Google. */
  oauth: "cam_oauth",
  lang: "cam_lang",
} as const;

const DAY = 24 * 60 * 60;

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function base(maxAge: number) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export interface Tokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export function writeTokens(store: CookieStore, tokens: Tokens): IdClaims | null {
  const claims = decodeJwt(tokens.idToken);
  // The tokens inside expire after an hour; the cookies outlive them so the
  // proxy can see who the user was and refresh (see api/backend route).
  store.set(COOKIE.id, tokens.idToken, base(30 * DAY));
  store.set(COOKIE.access, tokens.accessToken, base(30 * DAY));
  if (tokens.refreshToken) {
    store.set(COOKIE.refresh, tokens.refreshToken, base(30 * DAY));
    const internal = claims?.["cognito:username"] ?? claims?.sub;
    if (internal) store.set(COOKIE.user, internal, base(30 * DAY));
  }
  return claims;
}

export function clearTokens(store: CookieStore): void {
  for (const name of [COOKIE.id, COOKIE.access, COOKIE.refresh, COOKIE.user, COOKIE.pending]) {
    store.delete(name);
  }
}

export function writeGuest(store: CookieStore, token: string): void {
  // The guest token itself lasts a year; so does the cookie.
  store.set(COOKIE.guest, token, base(365 * DAY));
}

// ---------------------------------------------------------------------------
// A multi-step sign-in in progress
// ---------------------------------------------------------------------------
export interface Pending {
  kind: "SMS_OTP" | "SMS_MFA" | "NEW_PASSWORD_REQUIRED" | "SOFTWARE_TOKEN_MFA" | "SIGN_UP" | "RESET";
  /** What Cognito calls the user for this step (phone, email or internal). */
  username: string;
  /** Cognito's opaque session for the step, when there is one. */
  session?: string;
  /** Masked phone or email the code went to, for "Sent by SMS to …". */
  destination?: string;
  /** The phone number the person typed, for resending a code. */
  phone?: string;
  /** Email for the staff first-sign-in screen. */
  email?: string;
  next?: string;
}

export function writePending(store: CookieStore, pending: Pending): void {
  const value = Buffer.from(JSON.stringify(pending)).toString("base64url");
  // Cognito sessions for a challenge are valid for a few minutes; a sign-up
  // code lasts 24h but the person should not need that long.
  store.set(COOKIE.pending, value, base(pending.kind === "SIGN_UP" ? DAY : 15 * 60));
}

export function readPending(store: CookieStore): Pending | null {
  const raw = store.get(COOKIE.pending)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Pending;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reading the session in server components and route handlers
// ---------------------------------------------------------------------------
export async function getSession(): Promise<Session> {
  const store = await cookies();
  const claims = decodeJwt(store.get(COOKIE.id)?.value);
  // An expired ID token with a refresh token beside it still counts as signed
  // in: the first API call through the proxy refreshes it.
  const signedIn = Boolean(claims) && (!isExpired(claims, 0) || Boolean(store.get(COOKIE.refresh)?.value));
  return {
    role: signedIn ? roleFromClaims(claims) : null,
    username: signedIn ? usernameFromClaims(claims) : null,
    guestLabel: guestLabelFromToken(store.get(COOKIE.guest)?.value),
    google: config.googleSignIn && Boolean(config.cognito.domain),
  };
}

export async function getLang(): Promise<Lang> {
  const store = await cookies();
  return store.get(COOKIE.lang)?.value === "fr" ? "fr" : "en";
}

export async function getPendingPublic(): Promise<Pick<Pending, "kind" | "destination" | "email"> | null> {
  const store = await cookies();
  const pending = readPending(store);
  if (!pending) return null;
  return { kind: pending.kind, destination: pending.destination, email: pending.email };
}
