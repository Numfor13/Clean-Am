import type { Metadata } from "next";
import { HomeScreen } from "@/screens/Home";

export const metadata: Metadata = { title: "Home" };

export default function CitizenHomePage() {
  return <HomeScreen mode="citizen" />;
}
