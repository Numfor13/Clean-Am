import type { Metadata } from "next";
import { CitizenReportScreen } from "@/screens/Citizen";

export const metadata: Metadata = { title: "Report" };

type Props = { params: Promise<{ id: string }> };

export default async function CitizenReportPage({ params }: Props) {
  const { id } = await params;
  return <CitizenReportScreen id={id} />;
}
