import type { Metadata } from "next";
import { StaffLoginScreen } from "@/screens/Auth";
import { safeNext } from "@/lib/jwt";

export const metadata: Metadata = {
  title: "Staff Sign in",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function StaffLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNext(params.next, "") || undefined : undefined;
  return <StaffLoginScreen next={next} />;
}
