// Talking to the CLEAN-AM API from the Next.js server. Used by the
// /api/backend proxy and by the sign-in route (which claims guest reports
// right after sign-in).

import { cookies } from "next/headers";
import { config, assertConfig } from "./config";
import { cognitoProvider } from "./cognito";
import { COOKIE, readPool, writeTokens } from "./session";
import type { AuthProvider } from "./auth-provider";
import { decodeJwt, isExpired } from "@/lib/jwt";

export function authProvider(): AuthProvider {
  assertConfig();
  return cognitoProvider;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * The caller's ID token, refreshed first if it has expired. Returns null when
 * there is no usable session (the caller then gets a 401).
 */
export async function currentIdToken(store: CookieStore): Promise<string | null> {
  const idToken = store.get(COOKIE.id)?.value;
  const claims = decodeJwt(idToken);
  if (idToken && claims && !isExpired(claims)) return idToken;

  const refreshToken = store.get(COOKIE.refresh)?.value;
  const username = store.get(COOKIE.user)?.value ?? claims?.["cognito:username"];
  if (!refreshToken || !username) return null;
  try {
    const pool = readPool(store);
    const tokens = await authProvider().refresh(refreshToken, username, pool);
    writeTokens(store, tokens, pool);
    return tokens.idToken;
  } catch {
    return null;
  }
}

export async function currentAccessToken(store: CookieStore): Promise<string | null> {
  const idToken = await currentIdToken(store);
  if (!idToken) return null;
  return store.get(COOKIE.access)?.value ?? null;
}

export interface BackendResult {
  status: number;
  body: unknown;
}

export interface BackendCall {
  method: string;
  /** No leading slash: "reports/me". */
  path: string;
  search?: string;
  body?: unknown;
  /** The ID token, "Guest <token>", or nothing for public routes. */
  auth?: { kind: "user"; idToken: string } | { kind: "guest"; token: string } | null;
  lang: "en" | "fr";
}

export async function callBackend(call: BackendCall): Promise<BackendResult> {
  if (!config.apiUrl) {
    console.error("[config] CLEAN_AM_API_URL is not set. See .env.example.");
    return {
      status: 503,
      body: { error: { code: "NOT_CONFIGURED", message: "The CLEAN-AM service is not configured on this server." } },
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": call.lang,
  };
  if (call.body !== undefined) headers["Content-Type"] = "application/json";
  // API Gateway's Cognito authorizer takes the ID token itself, with no "Bearer " prefix.
  if (call.auth?.kind === "user") headers.Authorization = call.auth.idToken;
  if (call.auth?.kind === "guest") headers.Authorization = `Guest ${call.auth.token}`;

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/${call.path}${call.search ?? ""}`, {
      method: call.method,
      headers,
      body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
      cache: "no-store",
    });
  } catch {
    return {
      status: 503,
      body: { error: { code: "API_UNREACHABLE", message: "The CLEAN-AM service could not be reached. Try again shortly." } },
    };
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { code: `HTTP_${response.status}`, message: "Unexpected response from the service." } };
  }
  // API Gateway's own answers (throttling, authorizer, timeouts) are {"message": ...}:
  // give them the {error: {code, message}} shape the app reads everywhere else.
  if (response.status >= 400 && !(body as { error?: unknown } | null)?.error) {
    const own: Record<number, [string, string]> = {
      401: ["UNAUTHORIZED", "Your session has ended. Please sign in again."],
      403: ["FORBIDDEN", "You do not have permission to do this."],
      429: ["RATE_LIMITED", "Too many requests right now. Please wait a moment and try again."],
    };
    const [code, message] = own[response.status] ??
      (response.status >= 500
        ? ["API_UNREACHABLE", "The CLEAN-AM service is not responding. Try again shortly."]
        : [`HTTP_${response.status}`, "Unexpected response from the service."]);
    body = { error: { code, message } };
  }
  return { status: response.status, body };
}
