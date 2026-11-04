import type { LaunchFlowResponse } from '../../../lib/api/v1/contract.ts';
import type { Network } from './engine.ts';
import { CITY_LAUNCH_MAINNET } from './gate.ts';
import type { LaunchTower } from './towers.ts';

/**
 * Launch Night (L9, CITY-146; `docs/research/ryntra-launch-2026-10-29/SPEC.md` §10): the night's launches as a show in
 * the city — the camera flies tower to tower through the Docks, one coin on the stage at a time, one tap to buy it.
 *
 * ## Only a start the chain confirmed
 *
 * A launch goes on the stage only when its start is confirmed by the timestamp of the DBC creation's block — the
 * `launchSlot.at` of the engine's flow (`GET /api/v1/launch/{mint}/flow`, L3) — and that time agrees with the engine's
 * own record of the launch (`launchedAt`) within `driftMs`, is not in the future, and falls inside the night. A launch
 * whose flow has not reached its creation's block, or was not read, is not on the show: never a guess.
 *
 * ## No empty plot
 *
 * The show is cut into acts — just launched, climbing, graduated — and an act with nobody in it is not shown at all.
 * With fewer than `minLaunches` confirmed launches in the night there is no show: no card, no button, nothing that
 * promises a show the city cannot fill. Every launch on the stage has its ticker and its market cap read by the engine;
 * Ryntra's own technical launches and coins whose picture Ryntra took down (MC-1) are left out.
 *
 * The show is for the city's look only: the engine, the curve and every trade are untouched. Client-safe
 * and pure: the towers, the flows and the clock are the caller's.
 */

/**
 * The night's rules.
 *
 * ⚠ PROPOSAL — the numbers are the session's proposal from SPEC §10; `ownerWord` turns true only with it.
 */
export const NIGHT_RULE = Object.freeze({
  version: 'launch-night-0.1.0',
  /** The night: launches whose confirmed start is at most this old. */
  windowMs: 24 * 60 * 60_000,
  /** Fewer confirmed launches than this — no show. */
  minLaunches: 3,
  /** A launch this young on its curve is «just launched». */
  freshMs: 60 * 60_000,
  /** An older launch on its curve is «climbing» from this far along it; below, it is not on the stage. */
  climbMinPct: 25,
  /** The creation's block and the engine's record of the launch may differ by this much at most. */
  driftMs: 15 * 60_000,
  /** A block time this far past the reader's clock is a clock apart, not a start in the future. */
  skewMs: 2 * 60_000,
  /** Launches an act shows at most, and the whole show. */
  perAct: 4,
  maxLaunches: 12,
  /** The operator confirmed the numbers above: false until the word is given. */
  ownerWord: false,
});

export type NightRule = Readonly<Omit<typeof NIGHT_RULE, 'version' | 'ownerWord'>>;

export const NIGHT_ACTS = ['fresh', 'climbing', 'graduated'] as const;
export type NightActId = (typeof NIGHT_ACTS)[number];

/** What of a launch's flow the night rests on: the creation's block time and its graduation. */
export type NightStart = Readonly<{
  /** The DBC creation's block time; null when the flow did not reach it. */
  createdAt: string | null;
  graduated: boolean;
  graduatedAt: string | null;
}>;

/** The flow's answer as the night keeps it. */
export function nightStartOf(flow: Pick<LaunchFlowResponse, 'launchSlot' | 'graduation'>): NightStart {
  return { createdAt: flow.launchSlot?.at ?? null, graduated: flow.graduation.graduated, graduatedAt: flow.graduation.at };
}

export type NightEntry = Readonly<{
  token: string;
  symbol: string;
  name: string;
  image: string | null;
  act: NightActId;
  /** The confirmed start: the creation's block time. */
  startedAt: string;
  /** The graduation's time, for the graduated act; null otherwise. */
  graduatedAt: string | null;
  /** The curve's way to the pool, 0…100; 100 once graduated. */
  progress: number;
  marketCapUsd: number;
  holders: number | null;
  holdersAtLeast: boolean;
}>;

export type NightAct = Readonly<{ id: NightActId; entries: readonly NightEntry[] }>;

export type NightShow = Readonly<{
  network: Network;
  /** Only the acts with someone in them, in the show's order. */
  acts: readonly NightAct[];
  /** Every launch on the stage, act after act — the order the camera flies. */
  entries: readonly NightEntry[];
  computedAt: string;
}>;

export function nightOpen(network: Network | null, switchOpen: boolean, ownerWord: boolean = CITY_LAUNCH_MAINNET): boolean {
  if (!switchOpen) return false;
  return network === 'solana:devnet' || (network === 'solana:mainnet' && ownerWord);
}

/** The deployment's switch: the night opens only where `NEXT_PUBLIC_RYNTRA_CITY_LAUNCH_NIGHT=open`. */
export function nightSwitch(value: string | undefined): boolean {
  return value === 'open';
}

/** A tower that may go on the stage at all, whatever its flow says: people's launch, named, not taken down, not lost. */
function eligible(tower: LaunchTower): boolean {
  return !tower.ryntraTest && !tower.hidden && tower.symbol !== '' && tower.phase !== 'lost';
}

/**
 * The towers whose flows the night needs: eligible, and launched inside the night by the engine's record (with its
 * drift) — the newest first, at most `max`.
 */
export function nightCandidates(towers: readonly LaunchTower[], now: number, rule: NightRule = NIGHT_RULE, max = 24): readonly LaunchTower[] {
  return towers
    .filter((tower) => {
      const at = Date.parse(tower.launchedAt ?? '');
      return eligible(tower) && Number.isFinite(at) && now - at <= rule.windowMs + rule.driftMs && at - now <= rule.driftMs;
    })
    .sort((a, b) => Date.parse(b.launchedAt!) - Date.parse(a.launchedAt!))
    .slice(0, max);
}

/**
 * The confirmed start of a launch, ms: its creation's block time when the flow read it, the engine's record agrees
 * with it, it is not in the future and it falls inside the night. Null otherwise.
 */
export function confirmedStart(tower: Pick<LaunchTower, 'launchedAt'>, start: NightStart | null, now: number, rule: NightRule = NIGHT_RULE): number | null {
  const block = Date.parse(start?.createdAt ?? '');
  const record = Date.parse(tower.launchedAt ?? '');
  if (!Number.isFinite(block) || !Number.isFinite(record)) return null;
  if (Math.abs(block - record) > rule.driftMs) return null;
  if (block - now > rule.skewMs) return null;
  if (now - block > rule.windowMs) return null;
  return block;
}

/** The start a tower's own flow already carries (the feed reads the graduated ones' flows), when it has one. */
export function startOfTower(tower: Pick<LaunchTower, 'flow'>): NightStart | null {
  const flow = tower.flow;
  return flow && flow.createdAt ? { createdAt: flow.createdAt, graduated: flow.graduated, graduatedAt: flow.graduatedAt } : null;
}

/**
 * The start the night goes by for a tower: the one it read itself — unless the tower's own flow (the feed's, read later)
 * has seen a graduation the kept one has not, so a graduation never waits on a stale read.
 */
export function startFor(tower: Pick<LaunchTower, 'token' | 'flow'>, starts: ReadonlyMap<string, NightStart>): NightStart | null {
  const kept = starts.get(tower.token) ?? null;
  const own = startOfTower(tower);
  if (own && own.graduated && !kept?.graduated) return own;
  return kept ?? own;
}

/** Which act a confirmed launch plays in, or null when it is not on the stage. */
export function actOf(tower: Pick<LaunchTower, 'migrated' | 'progress'>, start: NightStart, startedAt: number, now: number, rule: NightRule = NIGHT_RULE): NightActId | null {
  if (tower.migrated || start.graduated) {
    const graduated = Date.parse(start.graduatedAt ?? '');
    /* A graduation the flow has not read is no act: the tower climbs back onto the stage once the read says it. */
    return start.graduated && Number.isFinite(graduated) && graduated >= startedAt && now - graduated <= rule.windowMs && graduated - now <= rule.skewMs ? 'graduated' : null;
  }
  if (now - startedAt < rule.freshMs) return 'fresh';
  return tower.progress !== null && tower.progress >= rule.climbMinPct ? 'climbing' : null;
}

const ORDER: Readonly<Record<NightActId, (a: NightEntry, b: NightEntry) => number>> = {
  fresh: (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  climbing: (a, b) => b.progress - a.progress || Date.parse(b.startedAt) - Date.parse(a.startedAt),
  graduated: (a, b) => Date.parse(b.graduatedAt!) - Date.parse(a.graduatedAt!),
};

/**
 * The night's show: every confirmed launch in its act, each act in its own order and cut to `perAct`, the acts with
 * nobody left out — or null when fewer than `minLaunches` launches are confirmed, so no empty show is ever shown.
 */
export function nightShow(args: Readonly<{ towers: readonly LaunchTower[]; starts: ReadonlyMap<string, NightStart>; network: Network | null; now: number; rule?: NightRule }>): NightShow | null {
  const { towers, starts, network, now } = args;
  const rule = args.rule ?? NIGHT_RULE;
  if (!network) return null;
  const byAct: Record<NightActId, NightEntry[]> = { fresh: [], climbing: [], graduated: [] };
  const seen = new Set<string>();
  for (const tower of towers) {
    if (seen.has(tower.token) || !eligible(tower) || tower.marketCapUsd === null || !(tower.marketCapUsd > 0)) continue;
    seen.add(tower.token);
    const start = startFor(tower, starts);
    if (!start) continue;
    const startedAt = confirmedStart(tower, start, now, rule);
    if (startedAt === null) continue;
    const act = actOf(tower, start, startedAt, now, rule);
    if (!act) continue;
    byAct[act].push({
      token: tower.token,
      symbol: tower.symbol,
      name: tower.name || tower.symbol,
      image: tower.image,
      act,
      startedAt: new Date(startedAt).toISOString(),
      graduatedAt: act === 'graduated' ? start.graduatedAt : null,
      progress: act === 'graduated' ? 100 : Math.max(0, Math.min(100, tower.progress ?? 0)),
      marketCapUsd: tower.marketCapUsd,
      holders: tower.holders,
      holdersAtLeast: tower.holdersAtLeast,
    });
  }
  const acts: NightAct[] = [];
  let left = rule.maxLaunches;
  for (const id of NIGHT_ACTS) {
    const entries = byAct[id].sort(ORDER[id]).slice(0, Math.min(rule.perAct, left));
    left -= entries.length;
    if (entries.length) acts.push({ id, entries });
  }
  const entries = acts.flatMap((act) => act.entries);
  if (entries.length < rule.minLaunches) return null;
  return { network, acts, entries, computedAt: new Date(now).toISOString() };
}

/** Two shows that put the same launches in the same acts: the stage keeps its place when a read changes nothing. */
export function sameLineup(a: NightShow | null, b: NightShow | null): boolean {
  if (!a || !b) return a === b;
  return a.entries.length === b.entries.length && a.entries.every((entry, i) => entry.token === b.entries[i]!.token && entry.act === b.entries[i]!.act);
}

/* ------------------------------------------------------------------------------------------------
 * Which flows to read
 * --------------------------------------------------------------------------------------------- */

/** A flow the night keeps: when it was read, whether the engine answered, and what it said. */
export type KeptStart = Readonly<{ at: number; ok: boolean; start: NightStart | null; /** Reads in a row that confirmed nothing. */ misses?: number }>;

/** A flow not answered is asked again after this; one whose read did not reach the creation's block, too. */
export const NIGHT_RETRY_MS = 60_000;
/** A launch on its curve is read again this often, so its graduation reaches the stage. */
export const NIGHT_FRESH_MS = 5 * 60_000;
/** A flow that keeps confirming nothing waits twice as long each time, up to this. */
export const NIGHT_BACKOFF_MAX_MS = 15 * 60_000;
/** Flows asked in one turn at most. */
export const NIGHT_READS_MAX = 4;

/**
 * The flows due among the night's candidates: a tower whose own flow already confirms its start needs none; one never
 * read first, then a failed read or one that did not reach the block after `NIGHT_RETRY_MS` (doubling with each miss), a graduation the kept
 * flow has not seen at once after the same wait, and a curve's flow after `NIGHT_FRESH_MS` — the newest first.
 */
export function dueNightReads(candidates: readonly LaunchTower[], kept: ReadonlyMap<string, KeptStart>, asking: ReadonlySet<string>, now: number, max = NIGHT_READS_MAX): readonly string[] {
  const due: Array<Readonly<{ token: string; rank: number }>> = [];
  for (const tower of candidates) {
    if (asking.has(tower.token)) continue;
    const own = startOfTower(tower);
    if (own && (!tower.migrated || own.graduated)) continue;
    const entry = kept.get(tower.token);
    if (!entry) {
      due.push({ token: tower.token, rank: 0 });
      continue;
    }
    const age = now - entry.at;
    if (!entry.ok || !entry.start?.createdAt) {
      if (age >= Math.min(NIGHT_BACKOFF_MAX_MS, NIGHT_RETRY_MS * 2 ** Math.max(0, (entry.misses ?? 1) - 1))) due.push({ token: tower.token, rank: 1 });
    } else if (tower.migrated && !entry.start.graduated) {
      if (age >= NIGHT_RETRY_MS) due.push({ token: tower.token, rank: 1 });
    } else if (!entry.start.graduated && age >= NIGHT_FRESH_MS) due.push({ token: tower.token, rank: 2 });
  }
  return due
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max)
    .map((entry) => entry.token);
}

/* ------------------------------------------------------------------------------------------------
 * Which markets to read
 * --------------------------------------------------------------------------------------------- */

/** A market cap the night read itself (`GET /api/v1/launch/{mint}/market`): when, whether it answered, the dollars. */
export type KeptCap = Readonly<{ at: number; ok: boolean; usd: number | null }>;

/** A launch's market cap on the stage is read again this often; a failed read after `NIGHT_RETRY_MS`. */
export const NIGHT_MARKET_MS = 2 * 60_000;

/**
 * The engine's list carries no market cap — only a market read whole does — so the night reads the markets of the
 * launches whose start is confirmed, a few at a time: one never read first, then the oldest past its time.
 */
export function dueMarketReads(candidates: readonly LaunchTower[], starts: ReadonlyMap<string, NightStart>, caps: ReadonlyMap<string, KeptCap>, asking: ReadonlySet<string>, now: number, max = NIGHT_READS_MAX): readonly string[] {
  const due: Array<Readonly<{ token: string; at: number }>> = [];
  for (const tower of candidates) {
    if (asking.has(tower.token)) continue;
    if (confirmedStart(tower, startFor(tower, starts), now) === null) continue;
    const kept = caps.get(tower.token);
    if (!kept) due.push({ token: tower.token, at: -Infinity });
    else if (now - kept.at >= (kept.ok ? NIGHT_MARKET_MS : NIGHT_RETRY_MS)) due.push({ token: tower.token, at: kept.at });
  }
  return due
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map((entry) => entry.token);
}

/** The towers with the market caps the night read laid in: a cap the night read is fresher than one the feed holds. */
export function withCaps(towers: readonly LaunchTower[], caps: ReadonlyMap<string, KeptCap>): readonly LaunchTower[] {
  return towers.map((tower) => {
    const usd = caps.get(tower.token)?.usd;
    return typeof usd === 'number' && usd > 0 ? { ...tower, marketCapUsd: usd } : tower;
  });
}
