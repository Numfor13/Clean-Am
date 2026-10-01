import type { Metadata } from "next";
import { MyReportsScreen } from "@/screens/Citizen";

export const metadata: Metadata = { title: "My reports" };

export default function MyReportsPage() {
  return <MyReportsScreen />;
}
