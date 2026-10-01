// Sends people to the part of the app their role can use. This is navigation,
// not security: API Gateway checks the token on every request, so a tampered
// cookie gets someone an empty screen at most.

import { NextResponse, type NextRequest } from "next/server";
import { decodeJwt, homeFor, isExpired, roleFromClaims } from "@/lib/jwt";
import type { Role } from "@/lib/types";

const AREAS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/home", roles: ["Citizen"] },
  { prefix: "/my-reports", roles: ["Citizen"] },
  { prefix: "/profile", roles: ["Citizen"] },
  { prefix: "/staff", roles: ["Employee", "Admin"] },
  { prefix: "/admin", roles: ["Admin"] },
];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const claims = decodeJwt(request.cookies.get("cam_id")?.value);
  const hasRefresh = Boolean(request.cookies.get("cam_refresh")?.value);
  const signedIn = Boolean(claims) && (!isExpired(claims, 0) || hasRefresh);
  const role = signedIn ? roleFromClaims(claims) : null;

  const redirect = (to: string) => NextResponse.redirect(new URL(to, request.url));

  const area = AREAS.find((a) => matches(pathname, a.prefix));
  if (area) {
    if (!role) return redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
    if (!area.roles.includes(role)) return redirect(homeFor(role));
    return NextResponse.next();
  }

  // Signed-in people have no use for the sign-in and sign-up screens.
  if (role && ["/login", "/register", "/guest"].some((p) => matches(pathname, p))) {
    return redirect(homeFor(role));
  }
  // Only citizens and guests file reports; staff go to their workspace.
  if ((role === "Employee" || role === "Admin") && matches(pathname, "/report")) {
    return redirect(homeFor(role));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/home/:path*", "/my-reports/:path*", "/profile/:path*", "/staff/:path*", "/admin/:path*", "/login", "/register", "/guest", "/report/:path*"],
};
