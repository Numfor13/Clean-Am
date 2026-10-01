import type { Metadata } from "next";
import { HomeScreen } from "@/screens/Home";

export const metadata: Metadata = { title: "Report waste without an account" };

export default function GuestHomePage() {
  return <HomeScreen mode="guest" />;
}
