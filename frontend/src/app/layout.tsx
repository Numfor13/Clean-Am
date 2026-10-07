import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans, Public_Sans } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/pages.css";
import { Providers } from "@/components/Providers";
import { PwaSetup } from "@/components/pwa";
import { getLang, getSession } from "@/server/session";

// Plus Jakarta Sans carries the wordmark and headings, Public Sans the reading
// text (drawn for public-sector use, full French accents), Plex Mono machine
// values and the spaced eyebrows.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });
const publicSans = Public_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-public-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "CLEAN-AM · Report waste in your community", template: "%s · CLEAN-AM" },
  description:
    "Report uncollected waste in Cameroon with a photo and a map pin, and follow it until a council crew clears it. / Signalez les déchets non collectés et suivez leur collecte.",
  applicationName: "CLEAN-AM",
  // Installable web app: the manifest comes from app/manifest.ts.
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "CLEAN-AM", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#eef2ef",
};

import { LenisProvider } from "@/components/LenisProvider";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, session] = await Promise.all([getLang(), getSession()]);
  return (
    <html lang={lang} className={`${jakarta.variable} ${publicSans.variable} ${plexMono.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          {lang === "fr" ? "Aller au contenu" : "Skip to content"}
        </a>
        <Providers lang={lang} session={session}>
          <LenisProvider>
            {children}
            <PwaSetup />
          </LenisProvider>
        </Providers>
      </body>
    </html>
  );
}
