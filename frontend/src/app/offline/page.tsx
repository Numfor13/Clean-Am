import type { Metadata } from "next";
import { OfflineScreen } from "@/components/pwa";

export const metadata: Metadata = { title: "Offline" };

// Kept by the service worker and shown when a page cannot load.
export default function OfflinePage() {
  return <OfflineScreen />;
}
