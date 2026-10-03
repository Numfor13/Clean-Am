import type { Metadata } from "next";
import { StaffReportListScreen } from "@/screens/Staff";

export const metadata: Metadata = { title: "All reports" };

export default function StaffReportsPage() {
  return <StaffReportListScreen />;
}
