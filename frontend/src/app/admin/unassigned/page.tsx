import type { Metadata } from "next";
import { UnassignedScreen } from "@/screens/Admin";

export const metadata: Metadata = { title: "Unassigned reports" };

export default function UnassignedPage() {
  return <UnassignedScreen />;
}
