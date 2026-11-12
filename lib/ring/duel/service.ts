/**
 * Duels as the Ring runs them for people (CITY-51): start one, watch it round by round, replay it when it is over.
 * Everything a duel decides comes from the pure pieces of this folder — the engines, the one harness, the judge of
 * CITY-68; this file only holds them together with the store, the agents' brains and the clock.
 *
 * - You start a duel with your own agent against another owner's agent of your class, or against a house sparring
 *   agent (practice: nothing rated). Two house agents make an exhibition anyone signed in may start. Asked for a
 *   `rival`, the server draws one (CITY-217): another owner's agent of your class, closest to your rating.
 * - Each agent plays at most `DUELS_PER_AGENT_DAY` duels a day and each account starts at most
 *   `STARTS_PER_ACCOUNT_DAY`: a duel spends the agents' own model budgets, so nobody drains another's key.
 * - The models of a UTC day's duels spend at most the deployment's ceiling (`capMicroUsd`, CITY-217): a live duel
 *   holds the most its seats may spend, a finished one counts what they spent; a start past it waits for tomorrow.
 *   The limits and the ceiling are checked and the duel written in one step (`DuelStore.open`).
 * - An agent with no key cannot play — the Ring is quiet until the server makes keys (CITY-50).
 * - A Market Replay needs real bars from the market-data gateway; without them it does not start.
 * - The duel runs after the answer (`background`); people read it with `get` as its rounds resolve. A duel whose
 *   harness stopped answering (the instance went away) is void once a reader finds it stalled — nobody's fault,
 *   nothing rated, play it again — so no window ever waits on it.
 *
 * No money: no entry, no stake, no pool, no prize — `money: "none"` in every rule set (CITY-46 and CITY-52 are later).
 */

import type { Candle } from "../../bots/backtest/candles.ts";
import type { Archetype, Weight } from "../contract.ts";
import { agentName } from "../agent.ts";
import type { Receipt } from "../judge/receipt.ts";
import type { MatchLog } from "../judge/replay.ts";
import type { Rules } from "../judge/rules.ts";
import type { Stamper, StampVerifier } from "../judge/stamp.ts";
import { ELO, emptyRating, type RatingRecord } from "../rating.ts";
import type { AgentRecord, Ranked, RateInput } from "../store.ts";
import { CRACK_DEFAULTS, phraseCommit } from "./crack.ts";
import { costCapOf, duelRules, HARNESS_ID, isDuelFormat, MOVE_MS, runDuel, settle, type DuelAgent, type DuelFormat } from "./harness.ts";
import { HOUSE_FORMAT, houseAgent, isHouseAgent, type HouseAgent } from "./house.ts";
import { MARKET_DEFAULTS } from "./market.ts";
import { pairRefusal, rateGame, type Contender, type PairRefusal } from "./pairing.ts";
import { drawPhrase } from "./phrases.ts";
import { pickSegment, type Segment } from "./segment.ts";
import { moments, publicDuel, type Moment, type PublicDuel } from "./spectate.ts";
import { SEATS, type Pair, type Seat } from "./rounds.ts";

const SEAT_LIST = SEATS as readonly Seat[];

export const DUELS_PER_AGENT_DAY = 20;
export const STARTS_PER_ACCOUNT_DAY = 30;
const DAY = 86_400_000;

/** The opponent that asks the server to draw a rival of your class (CITY-217). */
export const RIVAL = "rival";
/** How many of the closest rivals one is drawn from, so the same two do not meet every time. */
const RIVAL_POOL = 3;

/** The day's ceiling on models, micro-dollars, where the deployment names none: $5. */
export const DEFAULT_DAILY_CAP_MICRO_USD = 5_000_000;

/** A live duel with no round for this long has lost its harness: the reader voids it. */
export const stalledAfter = (moveMs: number): number => moveMs * 2 + 30_000;

/** A duel's move time, from its rules (`duelRules`: rounds × move + 5 s); the service's own when they do not say. */
export function moveMsOf(rules: Rules, fallback: number): number {
  const { ms, steps } = rules.limits ?? {};
  return ms && steps ? Math.max(1, Math.round((ms - 5_000) / steps)) : fallback;
}

/** The start of the UTC day a moment falls in. */
export const utcDay = (ms: number): number => ms - (((ms % DAY) + DAY) % DAY);

export type DuelSeat = { kind: "agent" | "house"; id: string; name: string; archetype: Archetype | null; weight: Weight | null };

export type DuelRecord = {
  id: string;
  format: DuelFormat;
  /** `a:<account id>` — who started it. */
  owner: string;
  status: "live" | "done" | "void";
  /** Against the house: nothing is rated. */
  practice: boolean;
  seats: Pair<DuelSeat>;
  rules: Rules;
  log: MatchLog;
  /** Server only: Duo Crack's phrases. Shown once the duel is over, never before. */
  secrets: Pair<string | null>;
  /** Server only until the end: which stretch of the market it was. */
  source: Segment["source"] | null;
  settlement: { logHash: string; receipts: Pair<Receipt>; memos: Pair<string> } | null;
  voided: string | null;
  /** Micro-dollars: the most its models may spend (held against the day's ceiling while live), what they spent once over. */
  cost: { reserved: number; spent: number | null };
  createdAt: number;
  updatedAt: number;
};

/** What a start is held to, checked with the write in one step. */
export type OpenLimits = {
  /** The model agents whose daily count holds (house seats have none). */
  agents: string[];
  /** 24 hours back: starts per account and duels per agent. */
  since: number;
  /** The UTC day's start: the models' spend under the ceiling. */
  day: number;
  perOwner: number;
  perAgent: number;
  /** The day's ceiling, micro-dollars. */
  cap: number;
};

/**
 * One account's part of the day's ceiling: a quarter of it, or its first duel whatever that costs — so one account
 * with a heavy agent never leaves the Arena full for everyone else.
 */
export const OWNER_SHARE_OF_CAP = 4;
export function ownerOverShare(ownerSpent: number, reserved: number, cap: number): boolean {
  return ownerSpent > 0 && ownerSpent + reserved > Math.floor(cap / OWNER_SHARE_OF_CAP);
}

/** `EXISTS`: a duel with this id is already written — a retried start (review 8.11), never a second duel. */
export type Opened = { ok: true } | { ok: false; reason: "RATE_LIMITED" | "DAILY_CAP" | "EXISTS" };

export interface DuelStore {
  readonly durable: boolean;
  /** A new duel, if the day's limits and ceiling still let it start; checked and written at once. */
  open(record: DuelRecord, limits: OpenLimits): Promise<Opened>;
  /** The duel as it goes on, written only while it is live in the store; false once it is over there. */
  put(record: DuelRecord): Promise<boolean>;
  get(id: string): Promise<DuelRecord | null>;
  recent(limit: number): Promise<DuelRecord[]>;
  /** Duels since a moment that this owner started, or that this agent sat in. */
  count(filter: { owner?: string; agent?: string; since: number }): Promise<number>;
  /** What the duels since a moment spent on models, the live ones at their most. */
  spent(since: number): Promise<number>;
}

/** One instance's memory: tests and a developer's machine — the duels never open in production on it. */
export function createMemoryDuelStore(keep = 200): DuelStore {
  const duels = new Map<string, DuelRecord>();
  const copy = <T>(value: T): T => structuredClone(value);
  const count = ({ owner, agent, since }: { owner?: string; agent?: string; since: number }) =>
    [...duels.values()].filter((d) => d.createdAt >= since && (owner === undefined || d.owner === owner) && (agent === undefined || d.seats.some((s) => s.id === agent))).length;
  const spent = (since: number, owner?: string) => [...duels.values()].filter((d) => d.createdAt >= since && (owner === undefined || d.owner === owner)).reduce((sum, d) => sum + (d.cost.spent ?? d.cost.reserved), 0);
  return {
    durable: false,
    // Check and write in one turn of the event loop, as the database does under its lock.
    async open(record, limits) {
      if (duels.has(record.id)) return { ok: false, reason: "EXISTS" };
      if (count({ owner: record.owner, since: limits.since }) >= limits.perOwner) return { ok: false, reason: "RATE_LIMITED" };
      if (limits.agents.some((agent) => count({ agent, since: limits.since }) >= limits.perAgent)) return { ok: false, reason: "RATE_LIMITED" };
      if (record.cost.reserved > 0 && spent(limits.day) + record.cost.reserved > limits.cap) return { ok: false, reason: "DAILY_CAP" };
      if (record.cost.reserved > 0 && ownerOverShare(spent(limits.day, record.owner), record.cost.reserved, limits.cap)) return { ok: false, reason: "DAILY_CAP" };
      duels.set(record.id, copy(record));
      while (duels.size > keep) duels.delete(duels.keys().next().value as string);
      return { ok: true };
    },
    async put(record) {
      const kept = duels.get(record.id);
      if (!kept || kept.status !== "live") return false;
      duels.set(record.id, copy({ ...record, cost: { ...record.cost, spent: record.status === "live" ? null : (record.cost.spent ?? record.cost.reserved) } }));
      return true;
    },
    async get(id) {
      const found = duels.get(id);
      return found ? copy(found) : null;
    },
    async recent(limit) {
      return [...duels.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(copy);
    },
    async count(filter) {
      return count(filter);
    },
    async spent(since) {
      return spent(since);
    },
  };
}

/** What anyone may see of a duel: never a secret while it is live. */
export type DuelView = {
  id: string;
  format: DuelFormat;
  status: DuelRecord["status"];
  practice: boolean;
  seats: Pair<DuelSeat>;
  duel: PublicDuel;
  moments: Moment[];
  /** Once over: the judge's word on each seat and the log's hash. */
  verdicts: Pair<{ verdict: string; reason: string; sealed: boolean; receipt: string }> | null;
  logHash: string | null;
  /** Once over, Market Replay: which stretch it was. */
  source: Segment["source"] | null;
  harness: string;
  createdAt: string;
};

export function viewOf(record: DuelRecord): DuelView {
  const over = record.status !== "live";
  const phrases = record.secrets[0] && record.secrets[1] ? ([record.secrets[0], record.secrets[1]] as Pair<string>) : null;
  const duel = publicDuel(record.format, record.log, phrases);
  return {
    id: record.id,
    format: record.format,
    status: record.status,
    practice: record.practice,
    seats: record.seats,
    duel,
    moments: moments(duel),
    verdicts: record.settlement
      ? (record.settlement.receipts.map((r) => ({ verdict: r.verdict, reason: r.reason, sealed: r.seal === "verified", receipt: r.hash })) as DuelView["verdicts"])
      : null,
    logHash: record.settlement?.logHash ?? null,
    source: over && record.status === "done" ? record.source : null,
    harness: HARNESS_ID,
    createdAt: new Date(record.createdAt).toISOString(),
  };
}

export type DuelErrorCode = PairRefusal | "BAD_REQUEST" | "NOT_FOUND" | "NOT_YOURS" | "NO_KEY" | "NO_RIVAL" | "MARKET_UNAVAILABLE" | "RATE_LIMITED" | "DAILY_CAP" | "KEY_REUSED";
export type DuelOutcome<T> = { ok: true; value: T } | { ok: false; code: DuelErrorCode; message: string };

export type StartRequest = { format: DuelFormat; agent: string; opponent: string };

/**
 * `id`: the duel's id when the start carries a request key (`api.ts` makes it from the account and the key). A start
 * whose duel is already written gets that duel back instead of a second one — the answer to the first try may never
 * have been kept (review 8.11).
 */
export type StartOptions = { id?: string };

export type DuelServiceDeps = {
  store: DuelStore;
  agents: {
    agent(id: string): Promise<AgentRecord | null>;
    ratings(agentId: string, brain: Pick<AgentRecord["brain"], "id" | "provider">): Promise<RatingRecord[]>;
    /** Writes a rating row at the game count it was read at (`RingStore.rate`); absent where the store cannot. */
    rate?(input: RateInput, now: number): Promise<boolean>;
    /** Other owners' agents of a class that can play a format, closest to a rating first (`RingStore.rivals`). */
    rivals?(input: { owner: string; weight: AgentRecord["brain"]["weight"]; format: DuelFormat; near: number; limit: number }): Promise<Ranked[]>;
  };
  /** The agent's brain, ready to play with its own key; `null` when it has none. */
  brain(record: AgentRecord): Promise<DuelAgent | null>;
  /** Whether an agent can be asked to play, without opening its key: a live key, by default. */
  playable?: (record: AgentRecord) => boolean;
  /** The day's ceiling on models, micro-dollars (`RYNTRA_RING_DAILY_USD`); $5 when not given. */
  capMicroUsd?: () => number;
  /** Real candles for a Market Replay, oldest first; `null` when the gateway has none to give. */
  candles(): Promise<{ instrument: string; candles: readonly Candle[] } | null>;
  stamp: Stamper;
  verifyStamp: StampVerifier;
  now: () => number;
  /** Uniform whole number in 0 … n − 1, from a CSPRNG on the server. */
  randomInt: (n: number) => number;
  newId: () => string;
  /** Runs work after the answer has gone. */
  background: (task: Promise<unknown>) => void;
  moveMs?: number;
};

const contender = (record: AgentRecord): Contender => ({ id: record.id, owner: record.owner, status: record.status, weight: record.brain.weight, formats: record.formats });

const houseSeat = (kind: HouseAgent): DuelSeat => ({ kind: "house", id: kind, name: kind, archetype: null, weight: null });
const agentSeat = (record: AgentRecord): DuelSeat => ({ kind: "agent", id: record.id, name: agentName(record.archetype, record.id), archetype: record.archetype, weight: record.brain.weight });

const MESSAGES: Readonly<Record<DuelErrorCode, string>> = {
  BAD_REQUEST: "format, agent and opponent name a duel.",
  NOT_FOUND: "There is no such agent or duel.",
  NOT_YOURS: "Start a duel with your own agent.",
  SAME_AGENT: "An agent does not duel itself.",
  SAME_OWNER: "Agents of one owner do not duel each other.",
  WEIGHT: "Both agents must be of one weight class.",
  FORMAT: "One of the brains cannot play this format.",
  OFF: "Both agents must be on.",
  NO_KEY: "The agent has no key yet: the Ring is quiet.",
  NO_RIVAL: "No rival of your class is free right now. Spar with the house meanwhile.",
  MARKET_UNAVAILABLE: "No market history to replay right now.",
  RATE_LIMITED: "Enough duels for today.",
  DAILY_CAP: "The Ring has fought enough for today. Back tomorrow.",
  KEY_REUSED: "This Idempotency-Key was used for another request.",
};

const refuse = <T>(code: DuelErrorCode): DuelOutcome<T> => ({ ok: false, code, message: MESSAGES[code] });

export function createDuelService(deps: DuelServiceDeps) {
  const moveMs = deps.moveMs ?? MOVE_MS;
  const playable = deps.playable ?? ((record: AgentRecord) => record.key.state === "live");
  const cap = () => {
    const value = deps.capMicroUsd?.() ?? DEFAULT_DAILY_CAP_MICRO_USD;
    return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_DAILY_CAP_MICRO_USD;
  };

  async function seatOf(id: string, format: DuelFormat): Promise<DuelOutcome<{ seat: DuelSeat; record: AgentRecord | null; house: HouseAgent | null }>> {
    if (isHouseAgent(id)) return HOUSE_FORMAT[id] === format ? { ok: true, value: { seat: houseSeat(id), record: null, house: id } } : refuse("FORMAT");
    const record = await deps.agents.agent(id);
    if (!record) return refuse("NOT_FOUND");
    return { ok: true, value: { seat: agentSeat(record), record, house: null } };
  }

  async function configOf(format: DuelFormat, id: string): Promise<{ config: unknown; secrets: Pair<string | null>; source: Segment["source"] | null } | null> {
    if (format === "duo-crack") {
      const first = drawPhrase(deps.randomInt);
      let second = drawPhrase(deps.randomInt);
      while (second === first) second = drawPhrase(deps.randomInt);
      const config = { harness: HARNESS_ID, ...CRACK_DEFAULTS, commits: [phraseCommit(id, 0, first), phraseCommit(id, 1, second)] };
      return { config, secrets: [first, second], source: null };
    }
    const read = await deps.candles().catch(() => null);
    const segment = read ? pickSegment(read.candles, MARKET_DEFAULTS.lookback + MARKET_DEFAULTS.steps, read.instrument, deps.randomInt) : null;
    if (!segment) return null;
    return { config: { harness: HARNESS_ID, ...MARKET_DEFAULTS, bars: segment.bars }, secrets: [null, null], source: segment.source };
  }

  async function play(record: DuelRecord, agents: Pair<DuelAgent>, rated: Pair<AgentRecord> | null): Promise<void> {
    let current = record;
    // Once a reader voided it as stalled, the harness stops: nothing it plays after counts.
    const stop = new AbortController();
    try {
      const run = await runDuel({
        format: record.format,
        matchId: record.id,
        config: record.rules.game!.config,
        secrets: record.secrets,
        agents,
        now: deps.now,
        moveMs,
        costCap: record.seats.map((s) => costCapOf(s.weight ?? "light")) as Pair<number>,
        signal: stop.signal,
        onRound: async (log) => {
          current = { ...current, log, updatedAt: deps.now() };
          if (!(await deps.store.put(current))) stop.abort();
        },
      });
      if (stop.signal.aborted) return;
      const settlement = settle({ rules: record.rules, run, stamp: deps.stamp, verifyStamp: deps.verifyStamp, at: deps.now() });
      const spent = run.usage[0].costMicroUsd + run.usage[1].costMicroUsd;
      current = { ...current, log: run.log, status: run.result ? "done" : "void", voided: run.voided, settlement, cost: { ...current.cost, spent }, updatedAt: deps.now() };
      if (!(await deps.store.put(current))) return;
      if (rated && run.result && deps.agents.rate) await rate(rated, record.format, run.result.winner as Seat | null);
    } catch (error) {
      console.error("[ring] duel stopped", record.id, error instanceof Error ? error.name : "unknown");
      await deps.store.put({ ...current, status: "void", voided: "harness", updatedAt: deps.now() }).catch(() => undefined);
    }
  }

  /**
   * Both rows after a rated game, each written at the game count it was read at: a duel finishing at the same moment
   * for one of the agents makes the write miss, and that agent's own row is read and rated again. The rival's rating
   * stays the one of the first read (review 8.11): by a retry the rival's row may already hold this very game, and the
   * game was played against the rating the rival had before it.
   */
  async function rate(pair: Pair<AgentRecord>, format: DuelFormat, winner: Seat | null): Promise<void> {
    const read = async (a: AgentRecord) => (await deps.agents.ratings(a.id, a.brain)).find((r) => r.format === format) ?? emptyRating(format);
    const first = (await Promise.all(pair.map(read))) as Pair<RatingRecord>;
    const done: Pair<boolean> = [false, false];
    for (let attempt = 0; attempt < 4 && !(done[0] && done[1]); attempt += 1) {
      for (const seat of SEAT_LIST) {
        if (done[seat]) continue;
        const own = attempt === 0 ? first[seat] : await read(pair[seat]);
        const rows: Pair<RatingRecord> = seat === 0 ? [own, first[1]] : [first[0], own];
        const row = rateGame(rows, winner)[seat];
        done[seat] = await deps.agents.rate!({ agentId: pair[seat].id, brain: pair[seat].brain, row, before: own.games }, deps.now());
      }
    }
    if (!(done[0] && done[1])) console.error("[ring] rating not written", pair.map((a) => a.id.slice(0, 8)).join(" "));
  }

  /** A live duel whose harness went quiet is void: nobody's fault, nothing rated, the reserve counted as spent. */
  async function fresh(record: DuelRecord): Promise<DuelRecord> {
    if (record.status !== "live" || deps.now() - record.updatedAt <= stalledAfter(moveMsOf(record.rules, moveMs))) return record;
    const stalled: DuelRecord = { ...record, status: "void", voided: "stalled", cost: { ...record.cost, spent: record.cost.reserved }, updatedAt: deps.now() };
    if (await deps.store.put(stalled)) return stalled;
    return (await deps.store.get(record.id)) ?? stalled;
  }

  /** A rival for a rated duel: one of the closest by rating among other owners' agents of this class that can play now. */
  async function rivalFor(mine: AgentRecord, format: DuelFormat, since: number): Promise<AgentRecord | null> {
    if (!deps.agents.rivals) return null;
    const own = (await deps.agents.ratings(mine.id, mine.brain)).find((r) => r.format === format);
    const list = await deps.agents.rivals({ owner: mine.owner, weight: mine.brain.weight, format, near: own?.rating ?? ELO.start, limit: 12 });
    const pool: AgentRecord[] = [];
    for (const { agent } of list) {
      if (pool.length >= RIVAL_POOL) break;
      if (!playable(agent) || pairRefusal(contender(mine), contender(agent), format)) continue;
      if ((await deps.store.count({ agent: agent.id, since })) >= DUELS_PER_AGENT_DAY) continue;
      pool.push(agent);
    }
    return pool.length ? pool[deps.randomInt(pool.length)]! : null;
  }

  /** The duel a retried start already made: the same owner and the same request, or the key was used for another. */
  async function startedBefore(id: string, owner: string, request: StartRequest): Promise<DuelOutcome<DuelView> | null> {
    const found = await deps.store.get(id);
    if (!found) return null;
    const same = found.owner === owner && found.format === request.format && found.seats[0].id === request.agent && (request.opponent === RIVAL ? !found.practice : found.seats[1].id === request.opponent);
    return same ? { ok: true, value: viewOf(await fresh(found)) } : refuse("KEY_REUSED");
  }

  return {
    async start(accountId: string, request: StartRequest, options: StartOptions = {}): Promise<DuelOutcome<DuelView>> {
      if (!isDuelFormat(request.format)) return refuse("BAD_REQUEST");
      const owner = `a:${accountId}`;
      if (options.id) {
        const before = await startedBefore(options.id, owner, request);
        if (before) return before;
      }
      const since = deps.now() - DAY;
      const mine = await seatOf(request.agent, request.format);
      if (!mine.ok) return mine;
      let theirs: DuelOutcome<{ seat: DuelSeat; record: AgentRecord | null; house: HouseAgent | null }>;
      if (request.opponent === RIVAL) {
        const own = mine.value.record;
        if (!own || own.owner !== owner) return refuse("NOT_YOURS");
        if (own.status !== "active") return refuse("OFF");
        if (!own.formats.includes(request.format)) return refuse("FORMAT");
        const rival = await rivalFor(own, request.format, since);
        if (!rival) return refuse("NO_RIVAL");
        theirs = { ok: true, value: { seat: agentSeat(rival), record: rival, house: null } };
      } else {
        theirs = await seatOf(request.opponent, request.format);
      }
      if (!theirs.ok) return theirs;
      // Someone's agent meets another only as the rival the server picks: naming one would let a person choose whom
      // they beat for rating, and spend that agent's day of duels.
      if (theirs.value.record && request.opponent !== RIVAL) return refuse("NOT_YOURS");
      const [a, b] = [mine.value, theirs.value];
      if (a.record && a.record.owner !== owner) return refuse("NOT_YOURS");
      if (a.house && b.record) return refuse("NOT_YOURS");
      for (const side of [a, b]) if (side.record && (side.record.status !== "active" || !side.record.formats.includes(request.format))) return refuse(side.record.status !== "active" ? "OFF" : "FORMAT");
      if (a.record && b.record) {
        const refusal = pairRefusal(contender(a.record), contender(b.record), request.format);
        if (refusal) return refuse(refusal);
      }
      if (a.seat.id === b.seat.id) return refuse("SAME_AGENT");

      // A quick read first, so no key is opened for a start the day has no room for; `open` checks again atomically.
      if ((await deps.store.count({ owner, since })) >= STARTS_PER_ACCOUNT_DAY) return refuse("RATE_LIMITED");
      for (const side of [a, b]) if (side.record && (await deps.store.count({ agent: side.record.id, since })) >= DUELS_PER_AGENT_DAY) return refuse("RATE_LIMITED");
      const reserved = [a, b].reduce((sum, side) => sum + (side.record ? costCapOf(side.record.brain.weight) : 0), 0);
      if (reserved > 0 && (await deps.store.spent(utcDay(deps.now()))) + reserved > cap()) return refuse("DAILY_CAP");

      const agents: DuelAgent[] = [];
      for (const side of [a, b]) {
        const agent = side.house ? houseAgent(side.house) : await deps.brain(side.record!);
        if (!agent) return refuse("NO_KEY");
        agents.push(agent);
      }

      const id = options.id ?? deps.newId();
      const made = await configOf(request.format, id);
      if (!made) return refuse("MARKET_UNAVAILABLE");
      const now = deps.now();
      const rounds = request.format === "duo-crack" ? CRACK_DEFAULTS.rounds : MARKET_DEFAULTS.steps;
      const weight = a.record?.brain.weight ?? b.record?.brain.weight ?? "light";
      const rules = duelRules({ format: request.format, config: made.config, weight, opensAt: now, closesAt: now + rounds * moveMs * 2 + 60_000, moveMs });
      const record: DuelRecord = {
        id,
        format: request.format,
        owner,
        status: "live",
        practice: !(a.record && b.record),
        seats: [a.seat, b.seat],
        rules,
        log: { format: "ryntra-ring-log/1", matchId: id, game: { id: rules.game!.id, version: rules.game!.version }, config: made.config, entries: [], result: null },
        secrets: made.secrets,
        source: made.source,
        settlement: null,
        voided: null,
        cost: { reserved, spent: null },
        createdAt: now,
        updatedAt: now,
      };
      const opened = await deps.store.open(record, {
        agents: [a, b].flatMap((side) => (side.record ? [side.record.id] : [])),
        since,
        day: utcDay(now),
        perOwner: STARTS_PER_ACCOUNT_DAY,
        perAgent: DUELS_PER_AGENT_DAY,
        cap: cap(),
      });
      if (!opened.ok) {
        if (opened.reason === "EXISTS") return (await startedBefore(id, owner, request)) ?? refuse("KEY_REUSED");
        return refuse(opened.reason);
      }
      const rated = a.record && b.record ? ([a.record, b.record] as Pair<AgentRecord>) : null;
      deps.background(play(record, agents as Pair<DuelAgent>, rated));
      return { ok: true, value: viewOf(record) };
    },

    async get(id: string): Promise<DuelOutcome<DuelView>> {
      const record = await deps.store.get(id);
      return record ? { ok: true, value: viewOf(await fresh(record)) } : refuse("NOT_FOUND");
    },

    async recent(limit = 12): Promise<DuelView[]> {
      const records = await deps.store.recent(Math.min(Math.max(1, limit), 50));
      return (await Promise.all(records.map(fresh))).map(viewOf);
    },
  };
}

export type DuelService = ReturnType<typeof createDuelService>;
