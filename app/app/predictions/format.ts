import type { WorkspaceLocale } from "@/app/shell/locale";

/** Figures the way the Predictions surfaces print them; nothing here invents a value. */

export function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const p = value * 100;
  return `${p.toFixed(p < 10 && digits === 0 ? 1 : digits)}%`;
}

export function pctPoints(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return "—";
  const p = delta * 100;
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)} pp`;
}

export function usd(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function usdCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function shares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

/** `in 3d 4h`, `in 45m`, or `ended` — relative to now, in the person's language. */
export function timeLeft(iso: string | null, locale: WorkspaceLocale, nowMs: number = Date.now()): string {
  if (!iso) return locale === "uk" ? "без дати" : "no date";
  const diff = Date.parse(iso) - nowMs;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const parts = d > 0 ? `${d}${locale === "uk" ? "д" : "d"} ${h}${locale === "uk" ? "год" : "h"}` : h > 0 ? `${h}${locale === "uk" ? "год" : "h"} ${m}${locale === "uk" ? "хв" : "m"}` : `${m}${locale === "uk" ? "хв" : "m"}`;
  if (diff < 0) return locale === "uk" ? `${parts} тому` : `${parts} ago`;
  return locale === "uk" ? `через ${parts}` : `in ${parts}`;
}

export function dateShort(iso: string | null, locale: WorkspaceLocale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function timeShort(iso: string | null, locale: WorkspaceLocale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function secondsAgo(iso: string | null, nowMs: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((nowMs - t) / 1000));
}
