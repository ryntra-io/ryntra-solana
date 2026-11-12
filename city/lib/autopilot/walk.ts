/**
 * CITY-70 — the agent walks the city: between the person's quarter and the towers of the coins it trades for her, so its
 * work is seen without a word. Pure: the scene (`city/components/autopilot/AgentWalker.tsx`) asks where to be; this says.
 *
 * - **at work** (working, waiting) — it goes from stop to stop: home, then each tower it trades, a few seconds at each;
 * - **a trade just made or being confirmed** — it goes straight to that tower and stays there, its beam on the roof;
 * - **frozen** — it stays home (or over its tower when she has no quarter), its light cold;
 * - **paused, done, stopped** — it is not in the sky at all.
 */

export type Point = Readonly<{ x: number; y: number; z: number }>;

export type WalkMood = 'walk' | 'trade' | 'frozen';

export type WalkAgent = Readonly<{
  /** The coin's tower, when the city has it. */
  tower: Point | null;
  mission: 'working' | 'confirming' | 'waiting' | 'frozen' | 'paused' | 'done' | 'stopped';
  /** When its newest trade landed, ms; null — none. */
  lastTradeAt: number | null;
}>;

export type WalkPlan = Readonly<{ mood: WalkMood; stops: readonly Point[] }> | null;

/** How high over a roof the agent hangs, and how long a just-made trade keeps it over its tower, ms. */
export const HOVER = 11;
export const TRADE_STAY_MS = 45_000;
/** How long it stays at each stop on its round, ms. */
export const DWELL_MS = 4_500;

const over = (point: Point): Point => ({ x: point.x, y: point.y + HOVER, z: point.z });

/** Where the agent goes now: its stops in order and how it carries itself; null — it is not out. */
export function planWalk(agents: readonly WalkAgent[], home: Point | null, now: number): WalkPlan {
  const out = agents.filter((agent) => agent.tower && agent.mission !== 'paused' && agent.mission !== 'done' && agent.mission !== 'stopped');
  if (!out.length) return null;
  /* A trade on its way, or one just made: the tower it is at, and nothing else. */
  const busy = out.find((agent) => agent.mission === 'confirming') ?? out.filter((agent) => agent.lastTradeAt !== null && now - agent.lastTradeAt < TRADE_STAY_MS).sort((a, b) => b.lastTradeAt! - a.lastTradeAt!)[0];
  if (busy) return { mood: 'trade', stops: [over(busy.tower!)] };
  const working = out.filter((agent) => agent.mission !== 'frozen');
  if (!working.length) return { mood: 'frozen', stops: [home ? over(home) : over(out[0]!.tower!)] };
  const towers = working.map((agent) => over(agent.tower!));
  return { mood: 'walk', stops: home ? [over(home), ...towers] : towers };
}

/** The stop it is at, or walking to, `elapsed` ms into its round: one stop after another, each held `DWELL_MS` plus the way there. */
export function stopAt(stops: readonly Point[], elapsed: number, legMs = DWELL_MS * 2): number {
  if (stops.length <= 1) return 0;
  return Math.floor(Math.max(0, elapsed) / legMs) % stops.length;
}
