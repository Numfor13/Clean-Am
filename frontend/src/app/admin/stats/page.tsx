import type { Metadata } from "next";
import { AdminStatsScreen } from "@/screens/Admin";

export const metadata: Metadata = { title: "Statistics Board" };

export default function AdminStatsPage() {
  return <AdminStatsScreen />;
}
