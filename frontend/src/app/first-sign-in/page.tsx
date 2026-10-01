import type { Metadata } from "next";
import { FirstSignInScreen } from "@/screens/Auth";
import { getPendingPublic } from "@/server/session";

export const metadata: Metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

export default async function FirstSignInPage() {
  const pending = await getPendingPublic();
  const email = pending?.kind === "NEW_PASSWORD_REQUIRED" ? pending.email ?? "" : null;
  return <FirstSignInScreen email={email} />;
}
