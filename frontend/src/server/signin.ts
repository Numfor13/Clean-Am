// What every successful sign-in does, whichever way the person signed in.

import type { cookies } from "next/headers";
import { callBackend } from "./backend";
import { COOKIE, writeTokens, type Tokens } from "./session";
import type { PoolType } from "./config";
import { roleFromClaims } from "@/lib/jwt";
import type { Role } from "@/lib/types";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * Store the tokens and, for a citizen, move this browser's guest reports into
 * the account (FR-AUTH-03, revised). Claiming is best effort: sign-in never
 * fails because of it, and it is retried at the next sign-in.
 */
export async function completeSignIn(store: CookieStore, tokens: Tokens, pool?: PoolType): Promise<Role | null> {
  const role = roleFromClaims(writeTokens(store, tokens, pool));
  store.delete(COOKIE.pending);

  const guestToken = store.get(COOKIE.guest)?.value;
  if (role === "Citizen" && guestToken) {
    try {
      const result = await callBackend({
        method: "POST",
        path: "me/claim-guest-reports",
        body: { guest_token: guestToken },
        auth: { kind: "user", idToken: tokens.idToken },
        lang: store.get(COOKIE.lang)?.value === "fr" ? "fr" : "en",
      });
      // Claimed now, claimed earlier by someone else, or a token the API does
      // not accept: in each case it is spent.
      const code = (result.body as { error?: { code?: string } } | null)?.error?.code;
      if (result.status === 200 || result.status === 409 || code === "INVALID_GUEST_TOKEN") store.delete(COOKIE.guest);
    } catch {
      // Try again next time.
    }
  }
  return role;
}
