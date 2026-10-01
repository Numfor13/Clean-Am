import type { Metadata } from "next";
import { ForgotScreen } from "@/screens/Auth";

export const metadata: Metadata = { title: "Reset your password" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ForgotPage({ searchParams }: Props) {
  const params = await searchParams;
  return <ForgotScreen staff={params.staff === "1"} />;
}
