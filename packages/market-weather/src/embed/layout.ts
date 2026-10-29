/**
 * The city's layout: a `MarketWeather` in, a scene of towers and sky out. Pure — no DOM, no canvas, no clock — so it is
 * tested in Node and drawn by `city.ts` in a browser or a phone's WebView.
 *
 * - Each asset is a tower; its height is the logarithm of its depth. The deepest stand in the middle.
 * - A rising asset's windows burn orange, a falling one's go cool; how bright, by how far it moved.
 * - A tower whose move is not live (thin, late, one read, disputed, unmeasured) is lit neither way.
 * - An unverified token, or one whose depth nobody measured, is a scaffold: an outline with no name.
 * - Issuer badges sit on the roof: a mark when the mint or freeze authority is active or disputed, a hollow ring when
 *   nobody stated it, nothing when it is revoked.
 * - The sky is the weather; late data is fog — and so is a weather that is itself old when drawn.
 */

import type { BadgeState } from "../badges.ts";
import type { MarketWeather, WeatherState } from "../weather.ts";

export type Tone = "up" | "down" | "flat" | "unknown";

export type SceneTower = Readonly<{
  asset: string;
  x: number;
  w: number;
  h: number;
  tone: Tone;
  /** 0–1: how strongly the windows burn. */
  intensity: number;
  label: string | null;
  scaffold: boolean;
  /** The top of the tower: a flat roof, a stepped setback, or a spire on the deepest. */
  crown: "flat" | "step" | "spire";
  badges: Readonly<{ mint: BadgeState; freeze: BadgeState }>;
  launch: "curve" | "graduated" | null;
  /** For the tap card: the figures as a screen shows them, or null when not measured. */
  priceUsd: number | null;
  changePct: number | null;
}>;

export type Sky = Readonly<{ top: string; bottom: string; glow: string; glowStrength: number }>;

export type Scene = Readonly<{
  width: number;
  height: number;
  /** The y of the waterline; towers stand on it and reflect below it. */
  ground: number;
  state: WeatherState;
  delayed: boolean;
  sky: Sky;
  rain: number;
  fog: number;
  lightning: boolean;
  towers: readonly SceneTower[];
}>;

export const ACCENT = "#FF681C";

export const SKIES: Readonly<Record<WeatherState, Sky>> = Object.freeze({
  sun: { top: "#120d0c", bottom: "#3a1a0c", glow: ACCENT, glowStrength: 0.55 },
  clear: { top: "#090c14", bottom: "#1a2236", glow: "#8fa6d6", glowStrength: 0.18 },
  cloud: { top: "#0c0e13", bottom: "#242833", glow: "#9aa3b5", glowStrength: 0.1 },
  rain: { top: "#070a10", bottom: "#18202c", glow: "#6f86a8", glowStrength: 0.12 },
  storm: { top: "#05060a", bottom: "#191422", glow: "#a58bd6", glowStrength: 0.14 },
  fog: { top: "#0e1014", bottom: "#33363d", glow: "#c8ccd4", glowStrength: 0.08 },
  not_measured: { top: "#0a0b0e", bottom: "#15171c", glow: "#5c6170", glowStrength: 0.05 },
});

export const MAX_TOWERS = 28;

/** A weather older than this when drawn is shown as fog with «data delayed»: the feed stopped, the sky must not lie. */
export const STALE_MS = 5 * 60_000;

const depthOf = (weather: MarketWeather["assets"][number]): number | null =>
  weather.liquidityUsd.state === "measured" && weather.liquidityUsd.value > 0 ? weather.liquidityUsd.value : null;

export function layoutCity(weather: MarketWeather, size: Readonly<{ width: number; height: number; now?: number; staleMs?: number }>): Scene {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const ground = Math.round(height * 0.78);
  const ranked = [...weather.assets]
    .sort((a, b) => (depthOf(b) ?? 0) - (depthOf(a) ?? 0) || a.asset.localeCompare(b.asset))
    .slice(0, MAX_TOWERS);
  /* Deepest in the middle, the rest alternating outward, neighbours swapped here and there: a skyline, not a chart. */
  const order: typeof ranked = [];
  ranked.forEach((asset, index) => (index % 2 === 0 ? order.push(asset) : order.unshift(asset)));
  const middle = Math.floor(order.length / 2);
  for (let i = 0; i + 1 < order.length; i += 2) {
    if (i === middle || i + 1 === middle || hash((order[i] as (typeof order)[number]).asset, i, 7) < 0.5) continue;
    [order[i], order[i + 1]] = [order[i + 1] as (typeof order)[number], order[i] as (typeof order)[number]];
  }
  const logs = ranked.map((asset) => Math.log10(depthOf(asset) ?? 1));
  const top = Math.max(...logs, 1);
  const bottom = Math.min(...logs.filter((value) => value > 0), top);
  const shareOf = (asset: (typeof order)[number]): number => {
    const depth = depthOf(asset);
    return depth === null ? 0 : top === bottom ? 1 : (Math.log10(depth) - bottom) / (top - bottom);
  };
  /* A deeper market is a broader tower as well as a taller one. */
  const weights = order.map((asset) => 0.62 + 0.7 * shareOf(asset));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  const margin = width * 0.05;
  const span = width - margin * 2;
  const spires = new Set(ranked.slice(0, 2).map((asset) => asset.asset));
  let cursor = margin;
  const towers = order.map((asset, index): SceneTower => {
    const depth = depthOf(asset);
    const share = shareOf(asset);
    const slot = (span * (weights[index] as number)) / total;
    const x = cursor + slot * 0.08;
    cursor += slot;
    const live = asset.move.status === "live" && asset.move.value.state === "measured";
    const change = live && asset.move.value.state === "measured" ? asset.move.value.value : null;
    const tone: Tone = change === null ? "unknown" : Math.abs(change) < 0.5 ? "flat" : change > 0 ? "up" : "down";
    const scaffold = !asset.verified || depth === null;
    const price = asset.price.value.state === "measured" ? asset.price.value.value : null;
    const jitter = (hash(asset.asset, 3, 1) - 0.5) * 0.06;
    return {
      asset: asset.asset,
      x,
      w: slot * 0.84,
      h: ground * (depth === null ? 0.18 : Math.max(0.14, 0.2 + 0.64 * share + jitter)),
      tone,
      intensity: change === null ? 0 : Math.min(1, 0.25 + Math.abs(change) / 12),
      label: scaffold ? null : asset.label,
      scaffold,
      crown: scaffold ? "flat" : spires.has(asset.asset) ? "spire" : share > 0.35 && hash(asset.asset, 5, 2) < 0.6 ? "step" : "flat",
      badges: { mint: asset.badges.mint.state, freeze: asset.badges.freeze.state },
      launch: asset.lifecycle ? asset.lifecycle.stage : null,
      priceUsd: price,
      changePct: change,
    };
  });
  const judged = Date.parse(weather.at);
  const stale = size.now !== undefined && (!Number.isFinite(judged) || size.now - judged > (size.staleMs ?? STALE_MS));
  const delayed = weather.delayed || stale;
  const state = stale ? "fog" : weather.state;
  return {
    width,
    height,
    ground,
    state,
    delayed,
    sky: SKIES[state],
    rain: state === "storm" ? 1 : state === "rain" ? 0.55 : 0,
    fog: state === "fog" ? 0.75 : state === "not_measured" ? 0.35 : state === "cloud" ? 0.2 : 0,
    lightning: state === "storm",
    towers,
  };
}

/** Which tower a point falls on, for a tap — with a finger's slack around thin towers; null for the sky. */
export function towerAt(scene: Scene, x: number, y: number, slack = 6): SceneTower | null {
  let best: SceneTower | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const tower of scene.towers) {
    if (y < scene.ground - tower.h - slack || y > scene.ground) continue;
    const off = x < tower.x ? tower.x - x : x > tower.x + tower.w ? x - tower.x - tower.w : 0;
    if (off <= slack && off < distance) {
      best = tower;
      distance = off;
    }
  }
  return best;
}

/** A stable pseudo-random number in [0, 1) from a string and two integers: the same city on every frame and device. */
export function hash(seed: string, a: number, b: number): number {
  let h = 2166136261 ^ (a * 374761393) ^ (b * 668265263);
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const STATES: ReadonlySet<string> = new Set(["sun", "clear", "cloud", "rain", "storm", "fog", "not_measured"]);
const BADGE_STATES: ReadonlySet<string> = new Set(["revoked", "active", "disputed", "not_measured"]);

/**
 * A weather that arrived from outside the page — a fetched file, a message from the host app — checked for the shape
 * this layout reads. Labels are checked again: the city draws only tickers that pass the same test the core applies.
 */
export function acceptWeather(raw: unknown): MarketWeather | null {
  if (typeof raw !== "object" || raw === null) return null;
  const node = raw as Record<string, unknown>;
  if (node.schemaVersion !== "1.0.0" || typeof node.state !== "string" || !STATES.has(node.state) || !Array.isArray(node.assets)) return null;
  const figure = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false;
    const f = value as Record<string, unknown>;
    return (f.state === "measured" && typeof f.value === "number" && Number.isFinite(f.value)) || f.state === "not_measured";
  };
  const signal = (value: unknown): boolean => typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).status === "string" && figure((value as Record<string, unknown>).value);
  const badge = (value: unknown): boolean => typeof value === "object" && value !== null && BADGE_STATES.has((value as Record<string, unknown>).state as string);
  for (const asset of node.assets.slice(0, 200)) {
    if (typeof asset !== "object" || asset === null) return null;
    const a = asset as Record<string, unknown>;
    const badges = a.badges as Record<string, unknown> | undefined;
    if (typeof a.asset !== "string" || !figure(a.liquidityUsd) || !signal(a.price) || !signal(a.move) || !badges || !badge(badges.mint) || !badge(badges.freeze)) return null;
    if (a.label !== null && (typeof a.label !== "string" || !/^[A-Za-z0-9$._-]{1,12}$/.test(a.label))) return null;
  }
  return { ...(raw as MarketWeather), assets: (raw as MarketWeather).assets.slice(0, 200), delayed: node.delayed === true };
}
