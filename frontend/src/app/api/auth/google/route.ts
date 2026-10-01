// GET /api/auth/google?next=/my-reports  ->  off to Google (via Cognito)

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { config } from "@/server/config";
import { authorizeUrl, newOAuthRequest } from "@/server/google";
import { COOKIE } from "@/server/session";
import { safeNext } from "@/lib/jwt";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const store = await cookies();
  const next = safeNext(request.nextUrl.searchParams.get("next"), "") || undefined;

  if (!config.cognito.domain) {
    return NextResponse.redirect(new URL("/login?error=google", request.url));
  }

  const { state, verifier, challenge } = newOAuthRequest();
  store.set(COOKIE.oauth, JSON.stringify({ state, verifier, next }), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax", // sent on Cognito's redirect back to us
    path: "/api/auth/google",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(request.nextUrl.origin, state, challenge));
}
