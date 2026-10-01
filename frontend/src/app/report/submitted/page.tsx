import type { Metadata } from "next";
import { SubmittedScreen } from "@/screens/Citizen";

export const metadata: Metadata = { title: "Report submitted" };

export default function SubmittedPage() {
  return <SubmittedScreen />;
}
