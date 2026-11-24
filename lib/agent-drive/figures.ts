import { DRIVE_WORDS } from "./words.ts";

/**
 * The drive's figures as a person reads them: lamports in SOL, counted in whole lamports and never in floats, a gain
 * never rounded up and a loss never rounded down; the time a trade was held; the coin by its ticker. Pure.
 */

export type Lang = "en" | "uk";

const places = (abs: bigint) => (abs >= 10_000_000_000n ? 2 : abs >= 1_000_000_000n ? 3 : 4);

function units(raw: string, roundUp: boolean): Readonly<{ text: string; zero: boolean }> {
  const value = BigInt(raw);
  const abs = value < 0n ? -value : value;
  const p = places(abs);
  const step = 10n ** BigInt(9 - p);
  const count = roundUp ? (abs + step - 1n) / step : abs / step;
  const whole = count / 10n ** BigInt(p);
  const fraction = (count % 10n ** BigInt(p)).toString().padStart(p, "0").replace(/0+$/u, "");
  return { text: fraction ? `${whole}.${fraction}` : `${whole}`, zero: count === 0n };
}

const local = (text: string, lang: Lang) => (lang === "uk" ? text.replace(".", ",") : text);

/** «0.5», «0,0123» — an amount of SOL from lamports, without its sign; rounded down. */
export function solPlain(raw: string, lang: Lang): string {
  return local(units(raw, false).text, lang);
}

/** «+0.012 SOL», «−0,003 SOL» — a result: a gain rounded down, a loss rounded up, so it never reads better than it is. */
export function solSigned(raw: string, lang: Lang): string {
  const value = BigInt(raw);
  const { text, zero } = units(raw, value < 0n);
  const sign = zero ? "" : value > 0n ? "+" : value < 0n ? "−" : "";
  return `${sign}${local(text, lang)} SOL`;
}

/** How long a trade was held: minutes under two hours, hours under two days, then days; null — not read. */
export function heldText(ms: number | null, lang: Lang): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const w = DRIVE_WORDS[lang];
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 120) return w.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return w.hours(hours);
  return w.days(Math.floor(hours / 24));
}

/** The coin as a note names it: its ticker when one was read, else the start of its address. */
export function coinName(coin: Readonly<{ mint: string; symbol: string | null }>, lang: Lang): string {
  return coin.symbol ?? DRIVE_WORDS[lang].coinShort(`${coin.mint.slice(0, 4)}…`);
}
