import type { WorkspaceLocale } from "@/app/shell/locale";

/** A decimal the person typed, in raw units of `decimals`; null when it is not an amount. */
export function toRaw(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(",", ".");
  if (!clean) return 0n;
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Raw units as a decimal, at most `places` digits after the point, trailing zeros dropped. */
export function fromRaw(raw: bigint | string, decimals: number, places = decimals): string {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

const tag = (locale: WorkspaceLocale) => (locale === "uk" ? "uk-UA" : "en-US");

export function formatNumber(value: number, locale: WorkspaceLocale, digits = 0): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

/** A raw amount as the person reads it: grouped, at most `digits` after the point. */
export function formatRaw(raw: bigint | string, decimals: number, locale: WorkspaceLocale, digits = 2): string {
  return formatNumber(Number(fromRaw(raw, decimals, Math.max(digits, 0))), locale, digits);
}

export function formatPercent(value: number, locale: WorkspaceLocale, digits = 2): string {
  return `${formatNumber(value, locale, digits)} %`;
}

export function formatBps(bps: number, locale: WorkspaceLocale): string {
  return formatPercent(bps / 100, locale, 2);
}

export function formatDate(at: number | string, locale: WorkspaceLocale): string {
  return new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short", year: "numeric" }).format(new Date(at));
}

export function formatDuration(seconds: number, locale: WorkspaceLocale): string {
  if (seconds % 60 === 0 && seconds < 3600) return locale === "uk" ? `${seconds / 60} хв` : `${seconds / 60} min`;
  return locale === "uk" ? `${seconds} с` : `${seconds} s`;
}

/** An address as `Abcd…wxyz`. */
export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function explorerUrl(network: "solana:devnet" | "solana:mainnet", kind: "tx" | "account", id: string): string {
  return `https://solscan.io/${kind}/${id}${network === "solana:devnet" ? "?cluster=devnet" : ""}`;
}
