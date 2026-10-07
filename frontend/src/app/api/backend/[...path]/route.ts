// The browser's only door to the CLEAN-AM API.
//
// It attaches the session's ID token (refreshing it when it has expired), or
// the device's guest token on /guest/* routes, so neither token is ever
// readable by page scripts.

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { callBackend, currentIdToken } from "@/server/backend";
import { clearTokens, COOKIE } from "@/server/session";

export const dynamic = "force-dynamic";

// Only these API areas are reachable through the proxy.
const ALLOWED = /^(public|guest|uploads|reports|me|employees|citizens)(\/|$)/;

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: Context): Promise<NextResponse> {
  const { path: segments } = await context.params;
  if (segments.some((s) => s === ".." || s === "." || s.includes("\\"))) {
    return NextResponse.json({ error: { code: "BAD_PATH", message: "Invalid path." } }, { status: 400 });
  }
  const path = segments.map(encodeURIComponent).join("/");
  // Guest sessions are minted by /api/guest/session, which stores the token.
  if (!ALLOWED.test(path) || path === "guest/session") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }

  // CSRF: every state-changing call must carry the header our own fetch
  // wrapper adds. A cross-site form or image tag cannot set it.
  if (request.method !== "GET" && request.headers.get("x-cam-csrf") !== "1") {
    return NextResponse.json({ error: { code: "CSRF", message: "Request blocked." } }, { status: 403 });
  }

  const store = await cookies();
  const lang = store.get(COOKIE.lang)?.value === "fr" ? "fr" : "en";

  let auth: Parameters<typeof callBackend>[0]["auth"] = null;
  if (path.startsWith("guest/")) {
    const token = store.get(COOKIE.guest)?.value;
    if (!token) {
      return NextResponse.json(
        { error: { code: "GUEST_SESSION_REQUIRED", message: "Start a guest session first." } },
        { status: 401 },
      );
    }
    auth = { kind: "guest", token };
  } else if (!path.startsWith("public/")) {
    const idToken = await currentIdToken(store);
    if (!idToken) {
      // The session cannot be refreshed. Drop its cookies too: left in place,
      // the route guard would still count this browser as signed in and send
      // it from /login straight back home, a loop the person cannot leave.
      clearTokens(store);
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Your session has ended. Please sign in again." } },
        { status: 401 },
      );
    }
    auth = { kind: "user", idToken };
  }

  let body: unknown = undefined;
  if (request.method !== "GET" && request.method !== "DELETE") {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid JSON." } }, { status: 400 });
      }
    } else {
      body = {};
    }
  }

  const result = await callBackend({
    method: request.method,
    path,
    search: request.nextUrl.search,
    body,
    auth,
    lang,
  });
  if (auth?.kind === "guest" && result.status === 401) {
    // The API no longer accepts this device's guest token (for example after
    // the signing key changed). Drop it; the app asks for a fresh one and retries.
    store.delete(COOKIE.guest);
    return NextResponse.json(
      { error: { code: "GUEST_SESSION_EXPIRED", message: "Your guest session has expired. Please try again." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (auth?.kind === "user" && result.status === 401) {
    // API Gateway rejected the token (revoked, wrong pool, expired refresh):
    // the session is over, so clear it for the same reason as above.
    clearTokens(store);
  }
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
