import type { Metadata } from "next";
import { SubmitReportScreen } from "@/screens/SubmitReport";

export const metadata: Metadata = { title: "Report waste" };

export default function SubmitReportPage() {
  return <SubmitReportScreen />;
}
