import type { Metadata } from "next";
import { FlaggedCitizensScreen } from "@/screens/Admin";

export const metadata: Metadata = { title: "Flagged citizens" };

export default function FlaggedPage() {
  return <FlaggedCitizensScreen />;
}
