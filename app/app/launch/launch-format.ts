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

/** «0,46 %» in Ukrainian, «0.46%» in English — each language's own way to write a share. */
export function formatPercent(value: number, locale: WorkspaceLocale, digits = 2): string {
  return `${formatNumber(value, locale, digits)}${percentSign(locale)}`;
}

/* A no-break space in Ukrainian: «29,99 %» never breaks before its sign. */
const percentSign = (locale: WorkspaceLocale) => (locale === "uk" ? "\u00A0%" : "%");

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

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * A token's price, however small: «0,0₅512» — the zeros after the point
 * counted in a subscript from four of them, three significant digits after
 * them; «1,24» from one up. `plain` is the same number written out, for a
 * screen reader and a title.
 */
export function formatPrice(value: number, locale: WorkspaceLocale): Readonly<{ text: string; plain: string }> {
  if (!Number.isFinite(value) || value <= 0) return { text: "0", plain: "0" };
  const sep = locale === "uk" ? "," : ".";
  const plain = new Intl.NumberFormat(tag(locale), { maximumSignificantDigits: 4, maximumFractionDigits: 20 }).format(value);
  if (value >= 0.0001) return { text: plain, plain };
  /* 0,00000509 — five zeros after the point: ⌈−log₁₀ 0,00000509⌉ − 1 = 6 − 1. */
  const zeros = Math.ceil(-Math.log10(value) - 1e-12) - 1;
  const digits = Math.round(value * 10 ** (zeros + 3)).toString().replace(/0+$/, "") || "0";
  const sub = String(zeros).split("").map((digit) => SUBSCRIPT[Number(digit)]).join("");
  return { text: `0${sep}0${sub}${digits}`, plain };
}

const UNITS: ReadonlyArray<Readonly<{ size: number; en: string; uk: string }>> = [
  { size: 1e12, en: "T", uk: " трлн" },
  { size: 1e9, en: "B", uk: " млрд" },
  { size: 1e6, en: "M", uk: " млн" },
  { size: 1e3, en: "K", uk: " тис." },
];

/** «$12,3 тис.» · «$912» · «$0,42» — or, in a currency that is not a dollar, «12,3 тис. COMM». */
export function formatMoneyShort(value: number, locale: WorkspaceLocale, dollar: boolean, symbol: string): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const unit = UNITS.find((entry) => abs >= entry.size) ?? null;
  const scaled = unit ? abs / unit.size : abs;
  const digits = unit ? (scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2) : abs >= 100 ? 0 : 2;
  const text = `${new Intl.NumberFormat(tag(locale), { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(scaled)}${unit ? unit[locale] : ""}`;
  const sign = value < 0 ? "−" : "";
  return dollar ? `${sign}$${text}` : `${sign}${text} ${symbol}`;
}

/** A count, short: «9 870» · «12,4 тис.». */
export function formatCountShort(value: number, locale: WorkspaceLocale): string {
  if (value < 10_000) return formatNumber(value, locale, 0);
  const unit = UNITS.find((entry) => value >= entry.size) as (typeof UNITS)[number];
  return `${formatNumber(value / unit.size, locale, 1)}${unit[locale]}`;
}

/** A signed move in basis points: «+4,2 %» · «−0,8 %» (in English «+4.2%»). */
export function formatMove(bps: number, locale: WorkspaceLocale): string {
  const pct = Math.abs(bps) / 100;
  const digits = pct >= 100 ? 0 : 1;
  return `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${formatNumber(pct, locale, digits)}${percentSign(locale)}`;
}

/** An address as `Abcd…wxyz`. */
export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function explorerUrl(network: "solana:devnet" | "solana:mainnet", kind: "tx" | "account", id: string): string {
  return `https://solscan.io/${kind}/${id}${network === "solana:devnet" ? "?cluster=devnet" : ""}`;
}

/**
 * Where a key moves the choice in a row of options — tabs or a radio group: the arrows to the next and the previous
 * (around the ends), Home and End to the first and the last. `vertical` lets the up and down arrows move it too, as a
 * radio group's do; a tab row leaves them to the page. Null for any other key.
 */
export function rovingNext<T>(order: readonly T[], current: T, key: string, vertical = false): T | null {
  const index = Math.max(0, order.indexOf(current));
  const forward = key === "ArrowRight" || (vertical && key === "ArrowDown");
  const back = key === "ArrowLeft" || (vertical && key === "ArrowUp");
  if (forward) return order[(index + 1) % order.length] ?? null;
  if (back) return order[(index + order.length - 1) % order.length] ?? null;
  if (key === "Home") return order[0] ?? null;
  if (key === "End") return order.at(-1) ?? null;
  return null;
}
