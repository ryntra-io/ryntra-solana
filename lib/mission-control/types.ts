/**
 * Mission Control (MC-0, decision 68): the one vocabulary the three scenes speak — Orbit (ryntra.io's home), Control
 * Room (a mission's page) and Launch Night (the broadcast mode). Each scene is a renderer that draws what these
 * objects carry and nothing else: a mission's numbers come from the chain through Ryntra's API (`live.ts`), or from
 * the simulator (`demo.ts`) — and then the whole scene says DEMO. Never the two at once.
 */

/** Where a mission is on its course: on a pad before its window (the simulator's only — a live mission exists once
 * its token does), on the curve, in the DAMM v2 pool, a Day 90 star, or a signal lost at a check. */
export type MissionPhase = "pad" | "ascent" | "orbit" | "star" | "lost";

/** A check of days 7, 30 and 90 as SOL-L3 reads it (`lib/core/launch/survival-stats.ts`). */
export type CheckState = "young" | "alive" | "quiet" | "unread";

export const CHECK_DAYS = [7, 30, 90] as const;
export type CheckDay = (typeof CHECK_DAYS)[number];

/** Why a mission's signal was lost: `reason` for its panel, `line` for a scene's hero, `short` for a line of the log. */
export type SignalLost = Readonly<{ day: CheckDay; reason: string; line: string; short: string }>;

/** A ship drawn from the token's address: the same mint, the same ship, on every screen and card. */
export type ShipGenome = Readonly<{
  seed: number;
  /** Hull and trim, from the brand's neutral palette; the orange stays the action's. */
  base: string;
  accent: string;
  fins: 3 | 4;
  /** Proportions around 1. */
  length: number;
  radius: number;
  /** 0…1: the nose's shape. */
  nose: number;
}>;

export type SceneMission = Readonly<{
  /** The token's mint; a DEMO mission's made-up id starts with `demo:`. */
  id: string;
  /** `$` and the symbol. */
  ticker: string;
  name: string;
  phase: MissionPhase;
  /** The curve migrated to its DAMM v2 pool — the orbit; a lost mission keeps where it was lost. */
  migrated: boolean;
  /** The curve's way to the DEX, 0…100; 100 once in orbit. Null when the chain was not read. */
  altitude: number | null;
  /** Whole days since the launch; null when not known. */
  day: number | null;
  /** Days 7, 30 and 90 in that order. */
  checks: readonly [CheckState, CheckState, CheckState];
  /** Signal lost (MC-3): the first check read whole with no trade beyond the creator's and Ryntra's, and why — said
   * calmly, as the chain has it; null while no check went quiet. */
  signal: SignalLost | null;
  holders: number | null;
  /** `holders` counts the wallets found — a floor. */
  holdersAtLeast: boolean;
  /** The crew as people read it: the creator by a short address, then each of the Dynamic Fee Sharing vault's rows by
   * short address (MC-2) — never a handle nobody checked; a launch without a crew is its creator alone. */
  crew: readonly string[];
  /** The launch window its launch time falls in (`lib/core/launch/windows.ts`), by id; null between windows. */
  window: string | null;
  /** Launched by one of Ryntra's own wallets: technical validation, never demand. */
  ryntraTest: boolean;
  ship: ShipGenome;
  /** Its Control Room; null for a DEMO mission. */
  href: string | null;
  /** Known only where the mission's market was read: in dollars when the pair is a dollar. */
  marketCapUsd: number | null;
  /** Price now against the curve's opening price, a multiple: 3.4 reads «×3.4 since liftoff». */
  sinceLiftoff: number | null;
  /** The DAMM v2 pool's two sides after the DEX, in dollars when the pair is a dollar. */
  liquidityUsd: number | null;
  launchedAt: string | null;
}>;

/**
 * One thing that happened — every visible effect of a scene is driven by one of these. Live events carry the
 * transaction they rest on where there is one; the events marked DEMO are only ever emitted by the simulator.
 * `quiet`: history read on arrival — a line in the log, no effect on the scene.
 */
export type SceneEvent = SceneEventBody & Readonly<{ quiet?: boolean }>;

type SceneEventBody =
  /** T-10 … T-1 before a launch window opens — the published schedule's (MC-2), never a timer to a purchase. */
  | Readonly<{ type: "countdown"; sec: number; window: string; clock: string }>
  /** A launch window opens, or closes with the missions on the sky that launched in it — counted from the snapshot. */
  | Readonly<{ type: "window"; window: string; clock: string; state: "open" | "closed"; count: number }>
  /** DEMO: a ship rolls out onto a pad. */
  | Readonly<{ type: "rollout"; id: string }>
  /** A launch: the token's creation. */
  | Readonly<{ type: "ignite"; id: string; at: string | null; signature: string | null }>
  | Readonly<{ type: "buy" | "sell"; id: string; at: string | null; usd: number | null; altitude: number | null; signature: string | null }>
  /** The curve crossed 25, 50 or 75 % — a booster on the ship. */
  | Readonly<{ type: "booster"; id: string; n: 1 | 2 | 3 }>
  /** DEMO: the camera's approach before an orbit insertion. */
  | Readonly<{ type: "approach"; id: string; cam: boolean }>
  /** The curve filled and the token moved to its DAMM v2 pool. `payoutUsd` only where it was read, never assumed. */
  | Readonly<{ type: "orbit"; id: string; at: string | null; payoutUsd: number | null; signature: string | null }>
  /** A check passed: someone other than the creator and Ryntra traded it in the week up to that day. */
  | Readonly<{ type: "check"; id: string; day: CheckDay; at: string | null; signature: string | null }>
  /** A check read whole with no such trade: signal lost, and why (MC-3) — the scene's own words, never a verdict. */
  | Readonly<{ type: "lost"; id: string; day: CheckDay; reason?: string }>
  /** Day 90 passed: the mission becomes a star. */
  | Readonly<{ type: "star"; id: string }>
  /** DEMO: a pool fee reaching the crew. */
  | Readonly<{ type: "fee"; id: string; usd: number }>;

export type SceneEventType = SceneEvent["type"];

/** What a scene shows at one moment: the roster and where the numbers came from. */
export type SceneSnapshot = Readonly<{
  /** `live` — the chain through Ryntra's API; `demo` — the simulator, and the scene says DEMO. */
  source: "live" | "demo";
  network: "mainnet" | "devnet" | null;
  missions: readonly SceneMission[];
  /** Day 90 stars beyond the visible missions. */
  stars: number;
  /** Every market's chain was read for this snapshot. */
  complete: boolean;
  observedAt: string;
}>;

/** A line of the flight log, newest first: the event and its words. */
export type LogLine = Readonly<{ key: string; event: SceneEvent; ticker: string; at: number }>;

/**
 * A scene renderer (`lib/mission-control/engines/*.js`) as its page mounts it. Live, it draws what `setSnapshot` and
 * `emit` carry and nothing else; `playDemo` runs the concept's own simulated show instead, and until `stopDemo` the
 * renderer ignores the live calls and the page says DEMO (`onSource`).
 */
export interface SceneEngine {
  /** The whole roster: missions not in it leave, new ones arrive quietly (no ignite effect — that is `emit`'s). */
  setSnapshot(snapshot: SceneSnapshot): void;
  emit(event: SceneEvent): void;
  /** Bring the camera to a mission, or back to the whole scene. */
  select(id: string | null): void;
  playDemo(): void;
  stopDemo(): void;
  /** Sound stays off until a person turns it on: the call comes from their tap. */
  setSound(on: boolean): void;
  dispose(): void;
}

export type SceneQuality = "high" | "medium" | "low";

export type EngineOptions = Readonly<{
  reducedMotion: boolean;
  /** The FPS floor (`concepts/orbit.html`): below it the scene steps down a tier. */
  minFps: number;
  /** The device pixel ratio's ceiling. */
  maxPixelRatio: number;
  onSelect?: (id: string | null) => void;
  onQuality?: (quality: SceneQuality, fps: number) => void;
  /** What the scene draws from now on — the page's DEMO marks follow it. */
  onSource?: (source: "live" | "demo") => void;
  /** `2d`: no WebGL, or its context was lost — the renderer draws its 2D board with the same numbers. */
  onRenderer?: (kind: "webgl" | "2d") => void;
  /** Control Room: the mission whose room it is. */
  focusId?: string;
}>;

/**
 * What every renderer module exports as `mount`. It appends its layers to `root` and keeps the page's own children
 * there (the home page's hero); with no WebGL it still returns an engine — the one that draws the 2D board.
 */
export type MountScene = (root: HTMLElement, options: EngineOptions) => SceneEngine;

export const ENGINE_DEFAULTS = { minFps: 30, maxPixelRatio: 1.75 } as const;

/** The DOM event a scene's root carries with every live snapshot (`detail`: `SceneSnapshot`) — for the page's own parts. */
export const SCENE_SNAPSHOT_EVENT = "mission-control:snapshot";

/* The last live snapshot each scene's root carried: a part of the page mounted after it (a sheet, a branch that
   changed) reads it at once instead of waiting a whole read for the next one. */
const LAST_SNAPSHOT = new WeakMap<Element, SceneSnapshot>();

export function rememberSnapshot(root: Element, snapshot: SceneSnapshot): void {
  LAST_SNAPSHOT.set(root, snapshot);
}

export function lastSnapshot(root: Element): SceneSnapshot | null {
  return LAST_SNAPSHOT.get(root) ?? null;
}
