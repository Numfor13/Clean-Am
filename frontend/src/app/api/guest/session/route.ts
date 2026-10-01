// Gives this browser a guest identity (FR-AUTH-03, revised) the first time it
// reports without an account, and keeps it in an httpOnly cookie for a year.
// Calling it again is harmless: an existing identity is reused.

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { callBackend } from "@/server/backend";
import { COOKIE, writeGuest } from "@/server/session";
import { decodeJwt, guestLabelFromToken } from "@/lib/jwt";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-cam-csrf") !== "1") {
    return NextResponse.json({ error: { code: "CSRF", message: "Request blocked." } }, { status: 403 });
  }
  const store = await cookies();

  const existing = store.get(COOKIE.guest)?.value;
  if (existing) {
    const payload = decodeJwt<{ exp?: number }>(`x.${existing.split(".")[0]}`);
    const stillValid = !payload?.exp || payload.exp * 1000 > Date.now() + 24 * 3600 * 1000;
    const label = guestLabelFromToken(existing);
    if (label && stillValid) return NextResponse.json({ guest_label: label });
  }

  const lang = store.get(COOKIE.lang)?.value === "fr" ? "fr" : "en";
  const result = await callBackend({ method: "POST", path: "guest/session", body: {}, auth: null, lang });
  if (result.status !== 201 && result.status !== 200) {
    return NextResponse.json(result.body, { status: result.status });
  }
  const { guest_token: token, guest_label: label } = result.body as { guest_token: string; guest_label: string };
  writeGuest(store, token);
  return NextResponse.json({ guest_label: label });
}
