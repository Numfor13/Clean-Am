import type { MetadataRoute } from "next";

// Makes the site installable ("Add to Home screen"). People choose: install it
// and it opens full screen like an app, or keep using it in the browser.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "CLEAN-AM",
    short_name: "CLEAN-AM",
    description: "Report uncollected waste with a photo and a map pin, and follow it until it is cleared.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#06180d",
    theme_color: "#06180d",
    categories: ["utilities", "government"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Report waste", short_name: "Report", url: "/report", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My reports", short_name: "My reports", url: "/my-reports", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
