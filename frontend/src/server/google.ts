// "Continue with Google" through Cognito's OAuth 2.0 endpoints (authorization
// code grant with PKCE). The code is exchanged on the server, with the client
// secret, and the tokens go straight into httpOnly cookies like any sign-in.

import { createHash, randomBytes } from "node:crypto";
import { clientSecret, config } from "./config";
import type { Tokens } from "./session";

const b64url = (buf: Buffer) => buf.toString("base64url");

export function newOAuthRequest() {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { state, verifier, challenge };
}

/** Where Cognito sends the browser back to; must be one of the pool's callback URLs. */
export function callbackUrl(origin: string): string {
  const site = (process.env.CLEAN_AM_SITE_URL ?? "").trim().replace(/\/+$/, "") || origin;
  return `${site}/api/auth/google/callback`;
}

export function authorizeUrl(origin: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.cognito.clientId,
    redirect_uri: callbackUrl(origin),
    identity_provider: "Google", // skip Cognito's own page and go straight to Google
    scope: "openid email profile aws.cognito.signin.user.admin",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${config.cognito.domain}/oauth2/authorize?${params}`;
}

export async function exchangeCode(origin: string, code: string, verifier: string): Promise<Tokens> {
  const basic = Buffer.from(`${config.cognito.clientId}:${await clientSecret()}`).toString("base64");
  const response = await fetch(`${config.cognito.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.cognito.clientId,
      code,
      redirect_uri: callbackUrl(origin),
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, string | number>;
  if (!response.ok || !data.id_token) throw new Error(`token exchange failed: ${String(data.error ?? response.status)}`);
  return {
    idToken: String(data.id_token),
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresIn: Number(data.expires_in ?? 3600),
  };
}
