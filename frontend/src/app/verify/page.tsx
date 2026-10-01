import type { Metadata } from "next";
import { VerifyScreen } from "@/screens/Auth";
import { getPendingPublic } from "@/server/session";

export const metadata: Metadata = { title: "Enter your code" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function VerifyPage({ searchParams }: Props) {
  const params = await searchParams;
  const purpose = params.purpose === "signin" || params.purpose === "mfa" ? params.purpose : "signup";
  const pending = await getPendingPublic();
  // An SMS code after a password (SMS_MFA) uses the same screen as a sign-in code.
  const expected = { signin: ["SMS_OTP", "SMS_MFA"], mfa: ["SOFTWARE_TOKEN_MFA"], signup: ["SIGN_UP"] }[purpose];
  const destination = pending && expected.includes(pending.kind) ? pending.destination ?? "" : null;
  return <VerifyScreen purpose={purpose} destination={destination} />;
}
