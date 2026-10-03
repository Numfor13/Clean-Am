import type { Metadata } from "next";
import { StaffReportScreen } from "@/screens/Staff";

export const metadata: Metadata = { title: "Report" };

type Props = { params: Promise<{ id: string }> };

export default async function StaffReportPage({ params }: Props) {
  const { id } = await params;
  return <StaffReportScreen id={id} />;
}
