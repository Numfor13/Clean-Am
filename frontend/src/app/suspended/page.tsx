import type { Metadata } from "next";
import { SuspendedScreen } from "@/screens/Home";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Account suspended" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SuspendedPage({ searchParams }: Props) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  return <SuspendedScreen guest={params.guest === "1"} guestLabel={session.guestLabel} />;
}
