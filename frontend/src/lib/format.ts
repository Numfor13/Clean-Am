import type { Lang } from "./types";

const LOCALE: Record<Lang, string> = { en: "en-GB", fr: "fr-FR" };

function parse(iso?: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 Sep 2026, 08:14" / "12 sept. 2026, 08:14" */
export function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  const date = parse(iso);
  if (!date) return "";
  const day = date.toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

/** "12 Sep, 08:14" — the year is noise on a report from this week. */
export function formatShortDateTime(iso: string | null | undefined, lang: Lang): string {
  const date = parse(iso);
  if (!date) return "";
  const day = date.toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

/** "3 Sep 2026" */
export function formatDate(iso: string | null | undefined, lang: Lang): string {
  const date = parse(iso);
  if (!date) return "";
  return date.toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric" });
}

/** "Sep 2026" */
export function formatMonthYear(iso: string | null | undefined, lang: Lang): string {
  const date = parse(iso);
  if (!date) return "";
  return date.toLocaleDateString(LOCALE[lang], { month: "short", year: "numeric" });
}

/** "35 min ago", "2 hours ago", "il y a 3 jours" */
export function timeAgo(iso: string | null | undefined, lang: Lang, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return "";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE[lang], { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(seconds / 86400), "day");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / (86400 * 7)), "week");
  return formatDate(iso, lang);
}

export function formatNumber(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(LOCALE[lang]);
}

/** "+237677421890" -> "+237 677 42 18 90" */
export function formatPhone(e164?: string | null): string {
  if (!e164) return "";
  const match = /^\+237(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  if (!match) return e164;
  return `+237 ${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
}

/** "+237677421890" -> "+237 6•• •• 18 90": enough to recognise, not to dial. */
export function maskPhone(e164?: string | null): string {
  if (!e164) return "";
  const match = /^\+237(\d)\d{2}\d{2}(\d{2})(\d{2})$/.exec(e164);
  if (!match) return e164.replace(/\d(?=\d{4})/g, "•");
  return `+237 ${match[1]}•• •• ${match[2]} ${match[3]}`;
}

/** User-typed local number -> E.164, or null when it is not a Cameroon number. */
export function toE164(local: string): string | null {
  const digits = local.replace(/\D/g, "").replace(/^237(?=\d{9}$)/, "");
  return /^[26]\d{8}$/.test(digits) ? `+237${digits}` : null;
}

/** "677421890" -> "677 42 18 90" as the person types. */
export function formatLocalPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  const parts = [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 7), digits.slice(7, 9)];
  return parts.filter(Boolean).join(" ");
}

export function formatCoords(lat: number | string, lng: number | string): string {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  return `${a.toFixed(4)}, ${b.toFixed(4)}`;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
