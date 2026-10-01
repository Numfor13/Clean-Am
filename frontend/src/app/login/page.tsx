import type { Metadata } from "next";
import { LoginScreen } from "@/screens/Auth";
import { safeNext } from "@/lib/jwt";

export const metadata: Metadata = { title: "Sign in" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNext(params.next, "") || undefined : undefined;
  const notice = params.confirmed ? "confirmed" : params.reset ? "reset" : params.error === "google" ? "google" : null;
  return <LoginScreen next={next} notice={notice} />;
}
