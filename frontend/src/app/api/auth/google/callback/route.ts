// GET /api/auth/google/callback?code=...&state=...  (Cognito sends the browser here)

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/server/google";
import { completeSignIn } from "@/server/signin";
import { COOKIE } from "@/server/session";
import { homeFor, safeNext } from "@/lib/jwt";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const store = await cookies();
  const params = request.nextUrl.searchParams;
  const back = (path: string) => NextResponse.redirect(new URL(path, request.url));

  let saved: { state?: string; verifier?: string; next?: string } = {};
  try {
    saved = JSON.parse(store.get(COOKIE.oauth)?.value ?? "{}");
  } catch {
    saved = {};
  }
  store.set(COOKIE.oauth, "", { path: "/api/auth/google", maxAge: 0 }); // single use

  // A disabled (suspended) account comes back as an error from Cognito.
  if (/disabled/i.test(params.get("error_description") ?? "")) return back("/suspended");
  const code = params.get("code");
  if (!code || !saved.state || params.get("state") !== saved.state || !saved.verifier) {
    return back("/login?error=google");
  }

  try {
    const tokens = await exchangeCode(request.nextUrl.origin, code, saved.verifier);
    const role = await completeSignIn(store, tokens);
    return back(safeNext(saved.next, homeFor(role)));
  } catch (error) {
    console.error("Google sign-in failed", error);
    return back("/login?error=google");
  }
}
