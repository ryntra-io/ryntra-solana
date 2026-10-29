/**
 * Mission Control's live scene from Ryntra's API (MC-0, decision 68): the markets list
 * (`GET /api/v1/launch/markets`), the survival checks of SOL-L3 (`GET /api/v1/launch/survival`) and a market's trades
 * (`GET /api/v1/launch/{mint}/market`) become missions and events. Nothing here guesses: a figure the API did not give
 * stays null, an event is only what one answer changed against the last, or a trade the chain recorded.
 */

import type { LaunchCrewsResponse, LaunchMarketResponse, LaunchMarketRow, LaunchMarketsResponse, LaunchSurvivalResponse } from "../api/v1/contract.ts";
import { launchedIn, nextWindow, windowClock, windowOfLaunch, windowOpenAt, windowLabel, windowById } from "../core/launch/windows.ts";
import { CHECK_DAYS, type CheckDay, type CheckState, type MissionPhase, type SceneEvent, type SceneMission, type SceneSnapshot, type ShipGenome, type SignalLost } from "./types.ts";

const DAY_MS = 86_400_000;
/** The scene draws at most this many missions; the rest of the Day 90 ones count as stars. */
export const SCENE_MISSIONS_MAX = 48;
/** A market that appears with a launch older than this joins quietly — it is news to the scene, not to the chain. */
export const IGNITE_FRESH_MS = 60 * 60 * 1000;
/** The curve's quarters a ship grows a booster at. */
export const BOOSTER_AT = [25, 50, 75] as const;

/* ---------------------------------------------------------------- the ship */

/** The brand's neutral hulls (`concepts/orbit.html`); the orange is the action's, never a hull's. */
const HULLS = ["#F5F7FA", "#D6E6FF", "#9FD4FF", "#5CBDFF", "#F5B544", "#FFC7A1", "#B9C6D6", "#E8DCC8"] as const;

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same mint, the same ship — on the sky, in its Control Room, on its card. */
export function shipGenome(id: string): ShipGenome {
  const seed = hashString(id);
  const r = mulberry32(seed);
  const base = HULLS[Math.floor(r() * HULLS.length)];
  let accent: string = HULLS[Math.floor(r() * HULLS.length)];
  if (accent === base) accent = HULLS[(HULLS.indexOf(base) + 3) % HULLS.length];
  return { seed, base, accent, fins: r() < 0.5 ? 3 : 4, length: round(0.9 + r() * 0.24, 3), radius: round(0.88 + r() * 0.22, 3), nose: round(r(), 3) };
}

/* ---------------------------------------------------------------- missions */

type SurvivalRow = LaunchSurvivalResponse["markets"][number];

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function missionHref(token: string): string {
  return `/mission/${token}`;
}

function checksOf(survival: SurvivalRow | undefined, day: number | null): readonly [CheckState, CheckState, CheckState] {
  const at = (days: CheckDay): CheckState => {
    const outcome = survival?.outcomes.find((item) => item.days === days);
    if (outcome) return outcome.state;
    return day !== null && day < days ? "young" : "unread";
  };
  return [at(7), at(30), at(90)];
}

/** The DEX is the only orbit: the curve migrated, or the market trades in its pool. */
function migratedOf(row: LaunchMarketRow): boolean {
  return Boolean(row.progress?.migrated) || row.venue === "pool";
}

/* A quiet check is a lost signal wherever the mission is — on its curve too (SOL-L3 counts every launch); a star is a
   mission that reached orbit and lived its 90 days. A curve token alive at day 90 is still in ascent: no orbit, no star. */
function phaseOf(migrated: boolean, checks: readonly CheckState[]): MissionPhase {
  if (checks.includes("quiet")) return "lost";
  if (migrated) return checks[2] === "alive" ? "star" : "orbit";
  return "ascent";
}

/**
 * Why the signal was lost (MC-3), calmly: the first check read whole with no trade by anyone besides the creator and
 * Ryntra in the week before it — what SOL-L3 reads, nothing more. What stays true is said too: the market is still
 * open, and what was paid stays paid. Null while no check went quiet.
 */
export function signalLost(checks: readonly CheckState[], migrated: boolean): SignalLost | null {
  const index = checks.indexOf("quiet");
  return index < 0 ? null : signalWords(CHECK_DAYS[index], migrated);
}

/** The words of a signal lost at one check. */
export function signalWords(day: CheckDay, migrated: boolean): SignalLost {
  const market = migrated ? "Its pool stays open" : "Its curve stays open";
  return {
    day,
    reason: `Signal lost at Day ${day}: in the week before it, nobody besides the creator and Ryntra traded the token — the whole week was read on chain. ${market}, anyone can still trade it, and every fee already paid stays paid.`,
    line: `Signal lost at Day ${day}: nobody besides the creator and Ryntra traded it that week.`,
    short: `no trade beyond the creator and Ryntra in the week before Day ${day}`,
  };
}

/** One market of the list as a mission. `now` in ms. */
export function missionFromMarket(row: LaunchMarketRow, survival: SurvivalRow | undefined, now: number): SceneMission {
  const launched = Date.parse(row.launchedAt);
  const day = Number.isFinite(launched) ? Math.max(0, (now - launched) / DAY_MS) : null;
  const checks = checksOf(survival, day);
  const migrated = migratedOf(row);
  const phase = phaseOf(migrated, checks);
  return {
    id: row.token,
    ticker: `$${row.symbol}`,
    name: row.name,
    phase,
    migrated,
    altitude: migrated ? 100 : row.progress ? row.progress.bps / 100 : null,
    /* Whole days, as a person counts them — «DAY 18», never «DAY 18.32»; the checks above read the exact age. */
    day: day === null ? null : Math.floor(day),
    checks,
    signal: signalLost(checks, migrated),
    holders: row.holders,
    holdersAtLeast: row.holdersAtLeast,
    crew: [shortAddress(row.creator)],
    ryntraTest: row.technicalValidation,
    ship: shipGenome(row.token),
    window: windowOfLaunch(row.launchedAt)?.id ?? null,
    href: missionHref(row.token),
    marketCapUsd: null,
    sinceLiftoff: null,
    liquidityUsd: migrated ? (row.poolLiquidity?.usd ?? null) : null,
    launchedAt: row.launchedAt,
  };
}

/**
 * The whole sky: every market the list gives, people's and Ryntra's own, the newest-active first as the API orders them,
 * at most `SCENE_MISSIONS_MAX` — and `focus` (a Control Room's own mission) always among them, wherever the list has it.
 */
export function snapshotFrom(markets: LaunchMarketsResponse, survival: LaunchSurvivalResponse | null, now: number, focus?: string, crews: LaunchCrewsResponse | null = null): SceneSnapshot {
  const byToken = new Map((survival?.markets ?? []).map((row) => [row.token, row]));
  const crewOf = new Map((crews?.crews ?? []).map((crew) => [crew.token, crew]));
  const all = markets.markets.map((row) => withCrew(missionFromMarket(row, byToken.get(row.token), now), crewOf.get(row.token), row.creator));
  const shown = all.slice(0, SCENE_MISSIONS_MAX);
  const focused = focus && !shown.some((mission) => mission.id === focus) ? all.find((mission) => mission.id === focus) : undefined;
  if (focused) shown.splice(shown.length - 1, 1, focused);
  return {
    source: "live",
    network: markets.network === "solana:devnet" ? "devnet" : "mainnet",
    missions: shown,
    stars: all.filter((mission) => mission.phase === "star" && !shown.includes(mission)).length,
    complete: markets.complete && (survival?.complete ?? false),
    observedAt: markets.observedAt,
  };
}

type FlyingCrew = LaunchCrewsResponse["crews"][number];

/**
 * A mission's crew as the vault pays it (`GET /api/v1/launch/crews`, MC-2): the creator, then each of the vault's rows,
 * by short address — a handle is nobody's proof, so the sky never names one. Only a crew of this very creator; without
 * one, the creator alone.
 */
export function withCrew(mission: SceneMission, crew: FlyingCrew | undefined, creator: string): SceneMission {
  if (!crew || crew.creator !== creator || crew.members.length === 0) return mission;
  return { ...mission, crew: [shortAddress(creator), ...crew.members.map((member) => shortAddress(member.wallet))] };
}

/**
 * How far the ship has grown: a booster at each quarter of the curve it stands past, wings once in orbit (MC-2), and a
 * ring for each check of days 7, 30 and 90 it passed (MC-3) — the Day 90 ring is the star's. A ship whose signal was
 * lost keeps the rings it earned before.
 */
export function shipGrowth(mission: Pick<SceneMission, "altitude" | "migrated"> & Partial<Pick<SceneMission, "checks">>): Readonly<{ boosters: 0 | 1 | 2 | 3; wings: boolean; rings: readonly CheckDay[] }> {
  const rings = CHECK_DAYS.filter((_, index) => mission.checks?.[index] === "alive");
  if (mission.migrated) return { boosters: 3, wings: true, rings };
  const altitude = mission.altitude ?? 0;
  return { boosters: BOOSTER_AT.filter((mark) => altitude >= mark).length as 0 | 1 | 2 | 3, wings: false, rings };
}

/* ---------------------------------------------------------------- the sky of stars */

export type SkyStar = Readonly<{ id: string; ticker: string; name: string; crew: readonly string[]; href: string | null; ryntraTest: boolean; launchedAt: string | null }>;

/**
 * The Day 90 sky (MC-3) as people read it beside the scene: every star the snapshot draws, with its crew by the names
 * the sky gives them — the creator and the vault's rows by short address, never a handle nobody checked — the oldest
 * first, as the sky grew; `more` — the stars counted beyond the missions drawn.
 */
export function skyStars(snapshot: Pick<SceneSnapshot, "missions" | "stars">): Readonly<{ stars: readonly SkyStar[]; more: number }> {
  const stars = snapshot.missions
    .filter((mission) => mission.phase === "star")
    .map((mission) => ({ id: mission.id, ticker: mission.ticker, name: mission.name, crew: mission.crew, href: mission.href, ryntraTest: mission.ryntraTest, launchedAt: mission.launchedAt }))
    .sort((a, b) => (Date.parse(a.launchedAt ?? "") || Infinity) - (Date.parse(b.launchedAt ?? "") || Infinity));
  return { stars, more: Math.max(0, Math.floor(snapshot.stars)) };
}

/* ---------------------------------------------------------------- windows */

/** How many beats the scene counts aloud before a window opens. */
export const COUNTDOWN_FROM_SEC = 10;
/** A beat older than this when the clock reaches it (a hidden tab, a slow frame) is not said late. */
const BEAT_LATE_MS = 2_500;

/**
 * The windows' beats between two moments of the clock (MC-2): T-10 … T-1 before an opening, the opening, and the
 * closing with the missions whose creation landed in it — counted from the snapshot, never assumed. The schedule is
 * published (`windows.ts`): a countdown to an event of the scene, never to a purchase.
 */
export function windowEvents(from: number, to: number, snapshot: Pick<SceneSnapshot, "missions"> | null): SceneEvent[] {
  if (!(to > from)) return [];
  const events: SceneEvent[] = [];
  const coming = nextWindow(from);
  const clock = windowClock(coming);
  for (let sec = COUNTDOWN_FROM_SEC; sec >= 1; sec--) {
    const at = coming.opensAt - sec * 1000;
    if (at > from && at <= to && to - at < BEAT_LATE_MS) events.push({ type: "countdown", sec, window: coming.id, clock });
  }
  if (coming.opensAt > from && coming.opensAt <= to && to - coming.opensAt < BEAT_LATE_MS) events.push({ type: "window", window: coming.id, clock, state: "open", count: 0 });
  const open = windowOpenAt(from);
  if (open && open.closesAt > from && open.closesAt <= to && to - open.closesAt < BEAT_LATE_MS) {
    const count = launchedIn(open, snapshot?.missions ?? []).length;
    events.push({ type: "window", window: open.id, clock: windowClock(open), state: "closed", count });
  }
  return events;
}

/** A mission's window as a person reads it — «Evening window · 20:00 UTC»; null when it lifted off between windows. */
export function missionWindowWords(mission: Pick<SceneMission, "window">): string | null {
  const window = mission.window ? windowById(mission.window) : null;
  return window ? windowLabel(window) : null;
}

/** A mission with its market read whole: the figures only the market's own answer carries. */
export function withMarket(mission: SceneMission, market: LaunchMarketResponse): SceneMission {
  const inOrbit = mission.migrated;
  return {
    ...mission,
    altitude: inOrbit ? 100 : market.progress.bps / 100,
    holders: market.holders.count,
    holdersAtLeast: market.holders.atLeast,
    marketCapUsd: market.marketCap.usd,
    sinceLiftoff: round(1 + market.sinceLaunchBps / 10_000, 2),
    liquidityUsd: inOrbit ? market.liquidity.usd : mission.liquidityUsd,
  };
}

/* ---------------------------------------------------------------- events */

/** What one answer changed against the last: launches, boosters, orbit, checks passed and lost. `quiet` on the first read. */
export function eventsBetween(before: SceneSnapshot | null, after: SceneSnapshot, now: number): SceneEvent[] {
  const events: SceneEvent[] = [];
  const known = new Map((before?.missions ?? []).map((mission) => [mission.id, mission]));
  for (const mission of after.missions) {
    const was = known.get(mission.id);
    if (!was) {
      const launched = mission.launchedAt ? Date.parse(mission.launchedAt) : NaN;
      if (before && now - launched < IGNITE_FRESH_MS) events.push({ type: "ignite", id: mission.id, at: mission.launchedAt, signature: null });
      continue;
    }
    if (was.altitude !== null && mission.altitude !== null && !mission.migrated) {
      BOOSTER_AT.forEach((mark, index) => {
        if (was.altitude! < mark && mission.altitude! >= mark) events.push({ type: "booster", id: mission.id, n: (index + 1) as 1 | 2 | 3 });
      });
    }
    if (!was.migrated && mission.migrated) events.push({ type: "orbit", id: mission.id, at: null, payoutUsd: null, signature: null });
    CHECK_DAYS.forEach((day, index) => {
      const from = was.checks[index];
      const to = mission.checks[index];
      if (from === to) return;
      if (to === "alive") events.push(day === 90 && mission.phase === "star" ? { type: "star", id: mission.id } : { type: "check", id: mission.id, day, at: null, signature: null });
      if (to === "quiet") events.push({ type: "lost", id: mission.id, day, reason: signalWords(day, mission.migrated).short });
    });
  }
  return events;
}

type TradeRow = LaunchMarketResponse["trades"]["rows"][number];

/** A trade's amount in dollars when the pair is one; null otherwise — never converted at a guessed price. */
export function tradeUsd(row: Pick<TradeRow, "pairRaw">, pair: LaunchMarketResponse["pair"]): number | null {
  if (!pair.dollar) return null;
  const value = Number(row.pairRaw) / 10 ** pair.decimals;
  return Number.isFinite(value) ? round(value, 2) : null;
}

/**
 * The market's trades as buys and sells, the oldest first, skipping the signatures already seen. The newest carries
 * the curve's altitude now; the older ones none — the API gives the market cap each left, not the curve's fill.
 */
export function tradeEvents(market: LaunchMarketResponse, seen: ReadonlySet<string>, quiet: boolean): SceneEvent[] {
  const rows = market.trades.rows.filter((row) => !seen.has(row.signature));
  const newest = market.trades.rows[0]?.signature;
  const altitude = market.progress.migrated ? 100 : market.progress.bps / 100;
  return rows
    .slice()
    .reverse()
    .map((row) => ({
      type: row.side === "buy" ? ("buy" as const) : ("sell" as const),
      id: market.token,
      at: row.at,
      usd: tradeUsd(row, market.pair),
      altitude: row.signature === newest ? altitude : null,
      signature: row.signature,
      ...(quiet ? { quiet: true } : {}),
    }));
}

/* ---------------------------------------------------------------- words */

export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: value < 100 ? 2 : 0, maximumFractionDigits: value < 100 ? 2 : 0 })}`;
}

/** One event as a person reads it — the flight log's line and the post's first line. Data, never a promise. */
export function eventWords(event: SceneEvent, ticker: string): string {
  switch (event.type) {
    case "ignite":
      return `${ticker} lifted off on Ryntra.`;
    case "buy":
    case "sell": {
      const amount = event.usd !== null ? ` ${formatUsd(event.usd)}` : "";
      const altitude = event.altitude !== null ? ` · ${event.altitude.toFixed(1)}% to orbit` : "";
      return `${event.type === "buy" ? "Buy" : "Sell"}${amount} on ${ticker}${altitude}.`;
    }
    case "booster":
      return `${ticker} crossed ${BOOSTER_AT[event.n - 1]}% of its curve.`;
    case "orbit":
      return `${ticker} reached orbit — its DAMM v2 pool is open${event.payoutUsd !== null ? `, ${formatUsd(event.payoutUsd)} to the creator` : ""}.`;
    case "check":
      return `${ticker} passed its Day ${event.day} check.`;
    case "lost":
      return `${ticker}: signal lost at Day ${event.day}${event.reason ? ` — ${event.reason}` : ""}.`;
    case "star":
      return `${ticker} survived 90 days — a star in the Ryntra sky.`;
    case "countdown":
      return `Launch window ${event.clock} · T-${event.sec}.`;
    case "window":
      return event.state === "open" ? `Launch window ${event.clock} is open.` : `Launch window ${event.clock} closed · ${event.count} mission${event.count === 1 ? "" : "s"} lifted off in it.`;
    default:
      return ticker;
  }
}

/** The events a crew would post: the ones that make a card (`/api/launch/mission-card`), in a mission's own order. */
export const CARD_MOMENTS = ["launch", "crew", "booster25", "booster50", "booster75", "orbit", "day7", "day30", "day90"] as const;
export type CardMoment = (typeof CARD_MOMENTS)[number];

export function isCardMoment(value: string): value is CardMoment {
  return (CARD_MOMENTS as readonly string[]).includes(value);
}

/**
 * Which card moments a mission has truly reached: launch always; its crew once the vault pays more than the creator;
 * on the curve, a booster for each quarter of it the mission stands past; orbit after the DEX; a day once its check
 * passed (Day 90 — a star).
 */
export function reachedMoments(mission: Pick<SceneMission, "altitude" | "migrated" | "checks" | "phase" | "crew">): CardMoment[] {
  const moments: CardMoment[] = ["launch"];
  if (mission.crew.length > 1) moments.push("crew");
  /* The boosters are the climb's: once in orbit the orbit's card says it all. */
  const { boosters } = shipGrowth(mission);
  if (!mission.migrated) BOOSTER_AT.slice(0, boosters).forEach((mark) => moments.push(`booster${mark}` as CardMoment));
  if (mission.migrated) moments.push("orbit");
  CHECK_DAYS.forEach((day, index) => {
    /* Day 90 is the star's card: only a mission that reached orbit and lived its course. */
    if (mission.checks[index] === "alive" && (day !== 90 || mission.phase === "star")) moments.push(`day${day}` as CardMoment);
  });
  return moments;
}

export function momentWords(moment: CardMoment, mission: Pick<SceneMission, "ticker" | "crew" | "window">): Readonly<{ title: string; line: string }> {
  switch (moment) {
    case "launch": {
      const window = mission.window ? windowById(mission.window) : null;
      return { title: "LIFTOFF", line: window ? `${mission.ticker} lifted off in the ${window.kind} launch window at ${windowClock(window)}.` : `${mission.ticker} lifted off on Ryntra.` };
    }
    case "crew":
      return { title: `CREW OF ${mission.crew.length}`, line: `${mission.ticker} flies with a crew of ${mission.crew.length} — each one's part of the creator's fees is on chain.` };
    case "booster25":
    case "booster50":
    case "booster75":
      return { title: `BOOSTER · ${moment.slice(7)}%`, line: `${mission.ticker} crossed ${moment.slice(7)}% of its curve to orbit.` };
    case "orbit":
      return { title: "ORBIT", line: `${mission.ticker} reached orbit — its DAMM v2 pool is open.` };
    case "day7":
    case "day30":
    case "day90": {
      const day = Number(moment.slice(3));
      return day === 90 ? { title: "DAY 90", line: `${mission.ticker} survived 90 days — a star in the Ryntra sky.` } : { title: `DAY ${day}`, line: `${mission.ticker} passed its Day ${day} check.` };
    }
  }
}

/** A moment's post: what the person's post says, data and the scene's line, never a promise. */
export function postWords(moment: CardMoment, ticker: string, crew: readonly string[] = []): string {
  if (moment === "orbit") return `${ticker} reached orbit on Ryntra. Launch is just the beginning.`;
  if (moment === "launch") return `${ticker} is in flight on Ryntra — watch it live.`;
  if (moment === "crew") return `${ticker} flies with a crew of ${crew.length} on Ryntra — watch it live.`;
  if (moment.startsWith("booster")) return `${ticker} crossed ${moment.slice(7)}% of its curve on Ryntra — watch it live.`;
  return `${ticker} passed its Day ${moment.slice(3)} check on Ryntra.`;
}

export type PostMoment = Readonly<{ moment: CardMoment; card: string; intent: string }>;

/** Every moment the mission truly reached, with its card for X and the intent that posts it. */
export function postMoments(mission: Pick<SceneMission, "id" | "ticker" | "phase" | "migrated" | "checks" | "altitude" | "crew">): PostMoment[] {
  return reachedMoments(mission).map((moment) => ({
    moment,
    card: `/api/launch/mission-card?mint=${mission.id}&moment=${moment}`,
    intent: postIntentUrl(postWords(moment, mission.ticker, mission.crew), `https://ryntra.io${missionHref(mission.id)}`),
  }));
}

/**
 * A post for X through its web intent — the person posts it themselves; Ryntra's account posts only. No hashtags bought, no reward for the post (X's rules since 15.01.2026).
 */
export function postIntentUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?${new URLSearchParams({ text, url }).toString()}`;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
