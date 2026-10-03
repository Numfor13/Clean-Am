import type { Metadata } from "next";
import { SecurityScreen } from "@/screens/Staff";

export const metadata: Metadata = { title: "Sign-in security" };

export default function SecurityPage() {
  return <SecurityScreen />;
}
