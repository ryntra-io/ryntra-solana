/**
 * «Стежити за токеном» — the rules a person sets on one token (AI-05,
 * decision 54, PLAN §4). Pure: a rule's shape, its bounds, the presets a
 * newcomer picks from and the words a rule is said in. Nothing here reads a
 * market, writes a record or sends a note.
 *
 * Four kinds, each judged without a model:
 * - `price` — the price crossed a level, with a band (hysteresis) so a price
 *   that sits on the line does not ring both ways;
 * - `move` — the price moved by N % over 5 min, 1 h or 24 h;
 * - `volume` — the last hour traded N times the day's hourly average;
 * - `liquidity` — the depth of the token's pools (or one named pool) changed
 *   by N % over 1 h or 24 h.
 *
 * A rule is the person's own threshold, never Ryntra's advice: no rule buys,
 * sells or signs, and no word here tells anyone to.
 */

import { z } from "zod";

export const WATCH_KINDS = ["price", "move", "volume", "liquidity"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export const MOVE_WINDOWS = ["m5", "h1", "h24"] as const;
export type MoveWindow = (typeof MOVE_WINDOWS)[number];
export const LIQUIDITY_WINDOWS = ["h1", "h24"] as const;
export type LiquidityWindow = (typeof LIQUIDITY_WINDOWS)[number];

/** Three watches are free (PLAN §9): a paid watch has no price the operator set, so three is the ceiling for now. */
export const FREE_WATCHES = 3;
export const WATCH_LIMIT = FREE_WATCHES;
/** Between two notes of one watch, at the least and by default. */
export const COOLDOWN_MIN_MINUTES = 5;
export const COOLDOWN_DEFAULT_MINUTES = 60;
export const COOLDOWN_MAX_MINUTES = 24 * 60;
/** The band a price must leave the level by before it can ring again (percent of the level). */
export const PRICE_BAND_PCT = 1;
/** Notes of token watches that leave on Telegram and push in one hour, per person; past it, the inbox alone. */
export const DELIVERIES_PER_HOUR = 20;
/** A volume spike counts only above this hour's volume in dollars: dust tripling is no news. */
export const VOLUME_FLOOR_USD = 5_000;

const Pct = z.number().finite();
const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const WatchRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("price"), direction: z.enum(["above", "below"]), level: z.number().finite().positive().max(1e12) }).strict(),
  z.object({ kind: z.literal("move"), window: z.enum(MOVE_WINDOWS), direction: z.enum(["up", "down", "any"]), pct: Pct.min(0.5).max(1_000) }).strict(),
  z.object({ kind: z.literal("volume"), factor: z.number().finite().min(1.5).max(100) }).strict(),
  z.object({ kind: z.literal("liquidity"), window: z.enum(LIQUIDITY_WINDOWS), direction: z.enum(["drop", "rise", "any"]), pct: Pct.min(5).max(100), pool: Address.nullable() }).strict(),
]);
export type WatchRule = z.infer<typeof WatchRuleSchema>;

export type WatchLocale = "en" | "uk";
type Bi = Readonly<{ en: string; uk: string }>;

/** The presets a newcomer picks from (PLAN §3): one press, then «Детально» for the rest. `price` takes the level from the price read now. */
export const WATCH_PRESETS = ["drop24h", "rise24h", "below", "above", "volume3x", "liquidityDrop"] as const;
export type WatchPreset = (typeof WATCH_PRESETS)[number];

export function presetRule(preset: WatchPreset, priceNow: number | null): WatchRule | null {
  switch (preset) {
    case "drop24h":
      return { kind: "move", window: "h24", direction: "down", pct: 10 };
    case "rise24h":
      return { kind: "move", window: "h24", direction: "up", pct: 10 };
    case "below":
      return priceNow !== null && priceNow > 0 ? { kind: "price", direction: "below", level: roundLevel(priceNow * 0.95) } : null;
    case "above":
      return priceNow !== null && priceNow > 0 ? { kind: "price", direction: "above", level: roundLevel(priceNow * 1.05) } : null;
    case "volume3x":
      return { kind: "volume", factor: 3 };
    case "liquidityDrop":
      return { kind: "liquidity", window: "h1", direction: "drop", pct: 30, pool: null };
  }
}

/** A level a person can read: four significant figures. */
export function roundLevel(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return value;
  const digits = Math.max(0, 3 - Math.floor(Math.log10(value)));
  return Number(value.toFixed(Math.min(digits, 12)));
}

const WINDOW_WORDS: Readonly<Record<MoveWindow, Bi>> = {
  m5: { en: "5 min", uk: "5 хв" },
  h1: { en: "1 hour", uk: "годину" },
  h24: { en: "24 hours", uk: "добу" },
};

export function windowWords(window: MoveWindow, locale: WatchLocale): string {
  return WINDOW_WORDS[window][locale];
}

/** A dollar price the way each screen writes it: «$180,00» in Ukrainian, «$180.00» in English; small prices keep their digits. */
export function usd(value: number, locale: WatchLocale): string {
  const digits = value >= 1 ? 2 : Math.min(10, Math.max(2, 3 - Math.floor(Math.log10(Math.abs(value) || 1))));
  const text = value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: value >= 1 ? 2 : 0, maximumFractionDigits: digits });
  return `$${text}`;
}

/** A dollar figure in short: «$1,2 млн», «$340 тис.». */
export function usdShort(value: number, locale: WatchLocale): string {
  const abs = Math.abs(value);
  const unit = abs >= 1e9 ? [1e9, locale === "uk" ? " млрд" : "B"] : abs >= 1e6 ? [1e6, locale === "uk" ? " млн" : "M"] : abs >= 1e3 ? [1e3, locale === "uk" ? " тис." : "K"] : [1, ""];
  const shown = (value / (unit[0] as number)).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: abs >= 1e3 ? 1 : 0 });
  return `$${shown}${unit[1]}`;
}

/** A percent with its sign: «−10,4 %» / «−10.4%». */
export function pctSigned(value: number, locale: WatchLocale): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const body = Math.abs(value).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return locale === "uk" ? `${sign}${body} %` : `${sign}${body}%`;
}

function pctPlain(value: number, locale: WatchLocale): string {
  const body = value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 1 });
  return locale === "uk" ? `${body} %` : `${body}%`;
}

/** What the rule watches, in one short line — the watch's card and its note say it the same way. */
export function ruleWords(rule: WatchRule, locale: WatchLocale): string {
  const uk = locale === "uk";
  switch (rule.kind) {
    case "price":
      return rule.direction === "below" ? (uk ? `Ціна нижче ${usd(rule.level, locale)}` : `Price below ${usd(rule.level, locale)}`) : uk ? `Ціна вище ${usd(rule.level, locale)}` : `Price above ${usd(rule.level, locale)}`;
    case "move": {
      const size = pctPlain(rule.pct, locale);
      const span = windowWords(rule.window, locale);
      if (rule.direction === "down") return uk ? `Падіння на ${size} за ${span}` : `Down ${size} in ${span}`;
      if (rule.direction === "up") return uk ? `Зростання на ${size} за ${span}` : `Up ${size} in ${span}`;
      return uk ? `Рух на ±${size} за ${span}` : `A ±${size} move in ${span}`;
    }
    case "volume":
      return uk ? `Обсяг за годину ×${rule.factor.toLocaleString("uk-UA")} від звичного` : `Hourly volume ×${rule.factor} the usual`;
    case "liquidity": {
      const size = pctPlain(rule.pct, locale);
      const span = windowWords(rule.window, locale);
      const what = rule.pool ? (uk ? "Ліквідність пулу" : "Pool liquidity") : uk ? "Ліквідність" : "Liquidity";
      if (rule.direction === "drop") return uk ? `${what} −${size} за ${span}` : `${what} down ${size} in ${span}`;
      if (rule.direction === "rise") return uk ? `${what} +${size} за ${span}` : `${what} up ${size} in ${span}`;
      return uk ? `${what} ±${size} за ${span}` : `${what} ±${size} in ${span}`;
    }
  }
}

export const PRESET_WORDS: Readonly<Record<WatchPreset, Bi>> = {
  drop24h: { en: "−10% in a day", uk: "−10 % за добу" },
  rise24h: { en: "+10% in a day", uk: "+10 % за добу" },
  below: { en: "Price 5% lower", uk: "Ціна на 5 % нижча" },
  above: { en: "Price 5% higher", uk: "Ціна на 5 % вища" },
  volume3x: { en: "Volume ×3", uk: "Обсяг ×3" },
  liquidityDrop: { en: "Liquidity −30% in an hour", uk: "Ліквідність −30 % за годину" },
};
