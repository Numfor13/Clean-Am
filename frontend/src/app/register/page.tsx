import type { Metadata } from "next";
import { RegisterScreen } from "@/screens/Auth";
import { safeNext } from "@/lib/jwt";

export const metadata: Metadata = { title: "Create your account" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RegisterPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNext(params.next, "") || undefined : undefined;
  return <RegisterScreen next={next} />;
}
