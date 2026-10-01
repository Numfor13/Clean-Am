import type { Metadata } from "next";
import { ResetScreen } from "@/screens/Auth";
import { getPendingPublic } from "@/server/session";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPage() {
  const pending = await getPendingPublic();
  return <ResetScreen destination={pending?.kind === "RESET" ? pending.destination ?? null : null} />;
}
