/**
 * Market weather: many assets' signals folded into one sky, and the typed event stream a UI listens to.
 *
 * The sky counts only assets whose 24-hour move is `live` (deep enough, on time, two reads agreeing). Each counts by the
 * logarithm of its depth, so the deepest market leads without drowning the rest. The bands, in percent:
 *
 *   storm ≤ −7 · rain ≤ −2 · sun ≥ +2 with most assets up · cloud when most are down · clear otherwise.
 *
 * When half the assets or more are late, the sky is `fog` and `delayed` is true: the data is late, and the city shows
 * that instead of yesterday's sun. Fewer counted assets than the policy asks is `not_measured` — or `fog` when late.
 *
 * Pure: no network; the clock is an argument.
 */

import { DEFAULT_POLICY, judgeSignal, measure, notMeasured, valueOf, type Measured, type Reading, type Signal, type WeatherPolicy } from "./contract.ts";
import { judgeBadges, type AuthorityRead, type IssuerBadges } from "./badges.ts";
import type { LaunchLifecycle } from "./lifecycle.ts";

export const WEATHER_STATES = ["sun", "clear", "cloud", "rain", "storm", "fog", "not_measured"] as const;
export type WeatherState = (typeof WEATHER_STATES)[number];

export type AssetInput = Readonly<{
  asset: string;
  /** The ticker as the source sent it. Shown only when `verified` and it passes `safeTicker`. */
  symbol: string | null;
  verified: boolean;
  liquidityUsd: Measured;
  priceReads: readonly Reading[];
  moveReads: readonly Reading[];
  authorityReads: readonly AuthorityRead[];
  lifecycle: LaunchLifecycle | null;
}>;

export type AssetWeather = Readonly<{
  asset: string;
  /** The ticker a screen may show; null for an unverified token or a ticker that does not pass `safeTicker`. */
  label: string | null;
  verified: boolean;
  liquidityUsd: Measured;
  price: Signal;
  move: Signal;
  badges: IssuerBadges;
  lifecycle: LaunchLifecycle | null;
}>;

export type MarketWeather = Readonly<{
  schemaVersion: "1.0.0";
  state: WeatherState;
  /** When this weather was judged, ISO 8601. */
  at: string;
  /** Half the assets or more are late: show «data delayed», not a stale sky. */
  delayed: boolean;
  /** Depth-weighted mean 24-hour move of the counted assets, percent. */
  move: Measured;
  /** Share of counted assets that rose, 0–1. */
  breadth: Measured;
  counted: number;
  assets: readonly AssetWeather[];
}>;

/** Characters a ticker may hold on a screen: letters, digits and a few marks. Anything else is not shown. */
const TICKER = /^[A-Za-z0-9$._-]{1,12}$/;

/** A ticker fit for a screen, or null. Invisible, direction and look-alike characters fail this test by construction. */
export function safeTicker(raw: string | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return TICKER.test(trimmed) ? trimmed : null;
}

export function judgeAsset(input: AssetInput, now: number, policy: WeatherPolicy = DEFAULT_POLICY): AssetWeather {
  return {
    asset: input.asset,
    label: input.verified ? safeTicker(input.symbol) : null,
    verified: input.verified,
    liquidityUsd: input.liquidityUsd,
    price: judgeSignal({ asset: input.asset, kind: "price", reads: input.priceReads, liquidityUsd: input.liquidityUsd, now, policy }),
    move: judgeSignal({ asset: input.asset, kind: "change24h", reads: input.moveReads, liquidityUsd: input.liquidityUsd, now, policy }),
    badges: judgeBadges(input.authorityReads),
    lifecycle: input.lifecycle,
  };
}

function skyOf(move: number, breadth: number): WeatherState {
  if (move <= -7) return "storm";
  if (move <= -2) return "rain";
  if (move >= 2 && breadth >= 0.55) return "sun";
  if (breadth < 0.45) return "cloud";
  return "clear";
}

export function judgeWeather(inputs: readonly AssetInput[], now: number, policy: WeatherPolicy = DEFAULT_POLICY): MarketWeather {
  const assets = inputs.map((input) => judgeAsset(input, now, policy));
  const late = assets.filter((asset) => asset.price.status === "delayed" || asset.move.status === "delayed").length;
  const delayed = assets.length > 0 && late * 2 >= assets.length;
  /* A move counts when it is live and its price does not contradict it across sources. */
  const counted = assets.filter((asset) => asset.move.status === "live" && asset.price.status !== "disagree");
  const at = new Date(now).toISOString();
  const base = { schemaVersion: "1.0.0" as const, at, delayed, counted: counted.length, assets };
  if (delayed) return { ...base, state: "fog", move: notMeasured("data delayed"), breadth: notMeasured("data delayed") };
  if (counted.length < policy.minAssets) {
    const why = `fewer than ${policy.minAssets} assets with a live move`;
    return { ...base, state: "not_measured", move: notMeasured(why), breadth: notMeasured(why) };
  }
  let weight = 0;
  let sum = 0;
  let up = 0;
  for (const asset of counted) {
    const change = valueOf(asset.move.value) as number;
    const w = Math.log10(Math.max(10, valueOf(asset.liquidityUsd) ?? 10));
    weight += w;
    sum += change * w;
    if (change > 0) up += 1;
  }
  const move = sum / weight;
  const breadth = up / counted.length;
  return { ...base, state: skyOf(move, breadth), move: measure(move), breadth: measure(breadth) };
}

export type WeatherEvent =
  | Readonly<{ type: "weather"; state: WeatherState; at: string }>
  | Readonly<{ type: "delayed"; at: string }>
  | Readonly<{ type: "recovered"; at: string }>
  | Readonly<{ type: "move"; asset: string; label: string | null; direction: "up" | "down"; changePct: number; at: string }>;

/**
 * The event stream: push each new weather, get the events a UI should react to. A move event fires when an asset's live
 * move passes the threshold on two weathers in a row in the same direction — two reads in time — and not again for the
 * same asset within the cooldown. A spike that one read shows and the next does not never reaches the city.
 */
export function createWeatherStream(policy: WeatherPolicy = DEFAULT_POLICY): { push(weather: MarketWeather): WeatherEvent[] } {
  let lastState: WeatherState | null = null;
  let lastDelayed = false;
  const pending = new Map<string, "up" | "down">();
  const lastFired = new Map<string, number>();
  return {
    push(weather) {
      const now = Date.parse(weather.at);
      const events: WeatherEvent[] = [];
      if (weather.state !== lastState) events.push({ type: "weather", state: weather.state, at: weather.at });
      if (weather.delayed && !lastDelayed) events.push({ type: "delayed", at: weather.at });
      if (!weather.delayed && lastDelayed) events.push({ type: "recovered", at: weather.at });
      lastState = weather.state;
      lastDelayed = weather.delayed;
      const seen = new Set<string>();
      for (const asset of weather.assets) {
        const change = asset.move.status === "live" ? valueOf(asset.move.value) : null;
        if (change === null || Math.abs(change) < policy.moveThresholdPct) continue;
        const direction = change > 0 ? "up" : "down";
        seen.add(asset.asset);
        if (pending.get(asset.asset) !== direction) {
          pending.set(asset.asset, direction);
          continue;
        }
        const fired = lastFired.get(asset.asset);
        if (fired !== undefined && now - fired < policy.cooldownMs) continue;
        lastFired.set(asset.asset, now);
        events.push({ type: "move", asset: asset.asset, label: asset.label, direction, changePct: change, at: weather.at });
      }
      for (const asset of [...pending.keys()]) if (!seen.has(asset)) pending.delete(asset);
      return events;
    },
  };
}
