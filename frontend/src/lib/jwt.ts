// Read a JWT's claims WITHOUT verifying it. Only for deciding what to show:
// API Gateway verifies every token before any data is returned, so a forged
// cookie can at most render an empty screen, never reach another user's data.

import type { Role } from "./types";

export interface IdClaims {
  sub?: string;
  exp?: number;
  "cognito:username"?: string;
  "cognito:groups"?: string[];
  preferred_username?: string;
  "custom:username"?: string;
  phone_number?: string;
  email?: string;
  name?: string;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwt<T = IdClaims>(token?: string | null): T | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as T;
  } catch {
    return null;
  }
}

/** Highest-precedence role in the token: Admin > Employee > Citizen. */
export function roleFromClaims(claims: IdClaims | null): Role | null {
  const groups = claims?.["cognito:groups"] ?? [];
  if (groups.includes("Admin")) return "Admin";
  if (groups.includes("Employee")) return "Employee";
  if (groups.includes("Citizen")) return "Citizen";
  return null;
}

export function usernameFromClaims(claims: IdClaims | null): string | null {
  if (!claims) return null;
  return (
    claims["custom:username"] ||
    claims.preferred_username ||
    claims.name ||
    (claims.email ? claims.email.split("@")[0] : null) ||
    null
  );
}

export function isExpired(claims: { exp?: number } | null, skewSeconds = 60): boolean {
  if (!claims?.exp) return true;
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

/** The guest token's payload is {gid, iat, exp, v}; label = last 4 hex, upper. */
export function guestLabelFromToken(token?: string | null): string | null {
  const payload = decodeJwt<{ gid?: string }>(token ? `x.${token.split(".")[0]}` : null);
  const gid = payload?.gid;
  if (!gid) return null;
  return `Guest-${gid.replace(/-/g, "").slice(-4).toUpperCase()}`;
}

/** Where each role lands after signing in. */
export function homeFor(role: Role | null): string {
  if (role === "Admin") return "/admin/employees";
  if (role === "Employee") return "/staff/reports";
  return "/home";
}

/** Only allow same-site relative paths as a post-login destination. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
