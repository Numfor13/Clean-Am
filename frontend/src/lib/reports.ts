import type { MessageKey } from "./dict/en";
import type { Category, FlagReason, Report, ReportStatus } from "./types";

export const STATUSES: ReportStatus[] = ["PENDING", "IN_PROGRESS", "DONE"];

export const STATUS_KEY: Record<ReportStatus, MessageKey> = {
  PENDING: "status.PENDING",
  IN_PROGRESS: "status.IN_PROGRESS",
  DONE: "status.DONE",
};

/** The next step a crew can take, or null once a report is closed. */
export function nextStatus(status: ReportStatus): ReportStatus | null {
  if (status === "PENDING") return "IN_PROGRESS";
  if (status === "IN_PROGRESS") return "DONE";
  return null;
}

export const CATEGORIES: Category[] = [
  "ILLEGAL_DUMPING",
  "OVERFLOWING_BIN",
  "BLOCKED_DRAIN",
  "BURNING_WASTE",
  "HOUSEHOLD_WASTE",
  "OTHER",
];

export const CATEGORY_KEY: Record<Category, MessageKey> = {
  ILLEGAL_DUMPING: "category.ILLEGAL_DUMPING",
  OVERFLOWING_BIN: "category.OVERFLOWING_BIN",
  BLOCKED_DRAIN: "category.BLOCKED_DRAIN",
  BURNING_WASTE: "category.BURNING_WASTE",
  HOUSEHOLD_WASTE: "category.HOUSEHOLD_WASTE",
  OTHER: "category.OTHER",
};

export const FLAG_REASONS: FlagReason[] = [
  "NOT_WASTE",
  "DUPLICATE",
  "WRONG_LOCATION",
  "STAGED",
  "ALREADY_COLLECTED",
  "OTHER",
];

export const FLAG_REASON_KEY: Record<FlagReason, MessageKey> = {
  NOT_WASTE: "flag.reason.NOT_WASTE",
  DUPLICATE: "flag.reason.DUPLICATE",
  WRONG_LOCATION: "flag.reason.WRONG_LOCATION",
  STAGED: "flag.reason.STAGED",
  ALREADY_COLLECTED: "flag.reason.ALREADY_COLLECTED",
  OTHER: "flag.reason.OTHER",
};

/** Must match FLAG_SUSPENSION_THRESHOLD in the backend. */
export const FLAG_THRESHOLD = 5;

/** "Overflowing bin, Bokwango" */
export function reportTitle(report: Pick<Report, "category" | "quarter">, t: (key: MessageKey) => string): string {
  const category = report.category ?? "OTHER";
  return `${t(CATEGORY_KEY[category])}, ${report.quarter}`;
}

export function isGuestReport(report: Pick<Report, "reporter_type" | "username">): boolean {
  if (report.reporter_type) return report.reporter_type === "guest";
  return /^guest[-_]/i.test(report.username ?? "");
}

/** Usernames citizens may pick (the same rule as the backend's sign-up check). */
export function usernameOk(username: string): boolean {
  const name = username.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/.test(name) && !/^guest[-_]/i.test(name);
}

// ---------------------------------------------------------------------------
// Places. Quarter is the unit people actually use ("quartier"), so the form
// asks for it by name. Centroids are approximate and only used to suggest a
// quarter from the GPS fix; the citizen always confirms it.
// ---------------------------------------------------------------------------
export interface Quarter {
  name: string;
  lat: number;
  lng: number;
}

export const CITIES: Record<string, Quarter[]> = {
  Buea: [
    { name: "Bokwango", lat: 4.1536, lng: 9.2419 },
    { name: "Buea Town", lat: 4.1569, lng: 9.2336 },
    { name: "Clerks Quarters", lat: 4.1601, lng: 9.2431 },
    { name: "Bonakanda", lat: 4.1778, lng: 9.2392 },
    { name: "Sasse", lat: 4.1706, lng: 9.2231 },
    { name: "Great Soppo", lat: 4.1331, lng: 9.2528 },
    { name: "Small Soppo", lat: 4.1405, lng: 9.2467 },
    { name: "Bulu", lat: 4.1492, lng: 9.2531 },
    { name: "Check Point", lat: 4.1513, lng: 9.2612 },
    { name: "Bonduma", lat: 4.1452, lng: 9.2718 },
    { name: "Molyko", lat: 4.1488, lng: 9.2869 },
    { name: "Bomaka", lat: 4.1453, lng: 9.2961 },
    { name: "Mile 17", lat: 4.1405, lng: 9.3047 },
    { name: "Mile 16", lat: 4.1302, lng: 9.3152 },
    { name: "Muea", lat: 4.1147, lng: 9.3051 },
  ],
  Limbe: [
    { name: "Down Beach", lat: 4.0122, lng: 9.2064 },
    { name: "New Town", lat: 4.0183, lng: 9.2021 },
    { name: "Bota", lat: 4.0091, lng: 9.1867 },
    { name: "Middle Farms", lat: 4.0259, lng: 9.2156 },
    { name: "Mile 2", lat: 4.0330, lng: 9.2267 },
    { name: "Mile 4", lat: 4.0470, lng: 9.2338 },
  ],
  Douala: [
    { name: "Akwa", lat: 4.0485, lng: 9.7026 },
    { name: "Bonanjo", lat: 4.0428, lng: 9.6926 },
    { name: "Bonapriso", lat: 4.0314, lng: 9.6991 },
    { name: "Deido", lat: 4.0626, lng: 9.7076 },
    { name: "New Bell", lat: 4.0339, lng: 9.7157 },
    { name: "Ndokoti", lat: 4.0452, lng: 9.7465 },
    { name: "Makepe", lat: 4.0808, lng: 9.7592 },
    { name: "Bonamoussadi", lat: 4.0924, lng: 9.7461 },
  ],
  "Yaoundé": [
    { name: "Bastos", lat: 3.8898, lng: 11.5095 },
    { name: "Mokolo", lat: 3.8736, lng: 11.4982 },
    { name: "Mvog-Mbi", lat: 3.8522, lng: 11.5210 },
    { name: "Biyem-Assi", lat: 3.8350, lng: 11.4855 },
    { name: "Mendong", lat: 3.8237, lng: 11.4744 },
    { name: "Essos", lat: 3.8733, lng: 11.5384 },
    { name: "Emana", lat: 3.9148, lng: 11.5210 },
    { name: "Ngoa-Ekelle", lat: 3.8577, lng: 11.4997 },
  ],
};

export const DEFAULT_CITY = "Buea";
/** Map centre before a location is known: Bokwango, Buea. */
export const DEFAULT_CENTER = { lat: 4.1536, lng: 9.2419 };

function metresBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const x = (((lng2 - lng1) * Math.PI) / 180) * Math.cos((p1 + p2) / 2);
  const y = p2 - p1;
  return Math.sqrt(x * x + y * y) * r;
}

/** The nearest known quarter within 2.5 km, or null. */
export function suggestPlace(lat: number, lng: number): { city: string; quarter: string } | null {
  let best: { city: string; quarter: string; distance: number } | null = null;
  for (const [city, quarters] of Object.entries(CITIES)) {
    for (const q of quarters) {
      const distance = metresBetween(lat, lng, q.lat, q.lng);
      if (!best || distance < best.distance) best = { city, quarter: q.name, distance };
    }
  }
  return best && best.distance <= 2500 ? { city: best.city, quarter: best.quarter } : null;
}

/** Cameroon's bounding box, matching the backend's coordinate check. */
export function isInCameroon(lat: number, lng: number): boolean {
  return lat >= 1.5 && lat <= 13.2 && lng >= 8.3 && lng <= 16.3;
}
