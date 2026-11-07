/**
 * Duels as the Ring runs them for people (CITY-51): start one, watch it round by round, replay it when it is over.
 * Everything a duel decides comes from the pure pieces of this folder — the engines, the one harness, the judge of
 * CITY-68; this file only holds them together with the store, the agents' brains and the clock.
 *
 * - You start a duel with your own agent against another owner's agent of your class, or against a house sparring
 *   agent (practice: nothing rated). Two house agents make an exhibition anyone signed in may start.
 * - Each agent plays at most `DUELS_PER_AGENT_DAY` duels a day and each account starts at most
 *   `STARTS_PER_ACCOUNT_DAY`: a duel spends the agents' own model budgets, so nobody drains another's key.
 * - An agent with no key cannot play — the Ring is quiet until the server makes keys (CITY-50).
 * - A Market Replay needs real bars from the market-data gateway; without them it does not start.
 * - The duel runs after the answer (`background`); people read it with `get` as its rounds resolve.
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
import { emptyRating, type RatingRecord } from "../rating.ts";
import type { AgentRecord } from "../store.ts";
import { CRACK_DEFAULTS, phraseCommit } from "./crack.ts";
import { costCapOf, duelRules, HARNESS_ID, isDuelFormat, MOVE_MS, runDuel, settle, type DuelAgent, type DuelFormat } from "./harness.ts";
import { HOUSE_FORMAT, houseAgent, isHouseAgent, type HouseAgent } from "./house.ts";
import { MARKET_DEFAULTS } from "./market.ts";
import { pairRefusal, rateGame, type Contender, type PairRefusal } from "./pairing.ts";
import { drawPhrase } from "./phrases.ts";
import { pickSegment, type Segment } from "./segment.ts";
import { moments, publicDuel, type Moment, type PublicDuel } from "./spectate.ts";
import type { Pair, Seat } from "./rounds.ts";

export const DUELS_PER_AGENT_DAY = 20;
export const STARTS_PER_ACCOUNT_DAY = 30;
const DAY = 86_400_000;

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
  createdAt: number;
  updatedAt: number;
};

export interface DuelStore {
  readonly durable: boolean;
  put(record: DuelRecord): Promise<void>;
  get(id: string): Promise<DuelRecord | null>;
  recent(limit: number): Promise<DuelRecord[]>;
  /** Duels since a moment that this owner started, or that this agent sat in. */
  count(filter: { owner?: string; agent?: string; since: number }): Promise<number>;
}

/** One instance's memory: tests and a developer's machine — the duels never open in production on it. */
export function createMemoryDuelStore(keep = 200): DuelStore {
  const duels = new Map<string, DuelRecord>();
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    durable: false,
    async put(record) {
      duels.delete(record.id);
      duels.set(record.id, copy(record));
      while (duels.size > keep) duels.delete(duels.keys().next().value as string);
    },
    async get(id) {
      const found = duels.get(id);
      return found ? copy(found) : null;
    },
    async recent(limit) {
      return [...duels.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(copy);
    },
    async count({ owner, agent, since }) {
      return [...duels.values()].filter((d) => d.createdAt >= since && (owner === undefined || d.owner === owner) && (agent === undefined || d.seats.some((s) => s.id === agent))).length;
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

export type DuelErrorCode = PairRefusal | "BAD_REQUEST" | "NOT_FOUND" | "NOT_YOURS" | "NO_KEY" | "MARKET_UNAVAILABLE" | "RATE_LIMITED";
export type DuelOutcome<T> = { ok: true; value: T } | { ok: false; code: DuelErrorCode; message: string };

export type StartRequest = { format: DuelFormat; agent: string; opponent: string };

export type DuelServiceDeps = {
  store: DuelStore;
  agents: {
    agent(id: string): Promise<AgentRecord | null>;
    ratings(agentId: string, brain: Pick<AgentRecord["brain"], "id" | "provider">): Promise<RatingRecord[]>;
    /** Writes a rating row after a rated duel; absent where the store cannot (then nothing is rated). */
    keepRating?(agentId: string, brain: Pick<AgentRecord["brain"], "id" | "provider">, row: RatingRecord): Promise<void>;
  };
  /** The agent's brain, ready to play with its own key; `null` when it has none. */
  brain(record: AgentRecord): Promise<DuelAgent | null>;
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
  MARKET_UNAVAILABLE: "No market history to replay right now.",
  RATE_LIMITED: "Enough duels for today.",
};

const refuse = <T>(code: DuelErrorCode): DuelOutcome<T> => ({ ok: false, code, message: MESSAGES[code] });

export function createDuelService(deps: DuelServiceDeps) {
  const moveMs = deps.moveMs ?? MOVE_MS;

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
        onRound: async (log) => {
          current = { ...current, log, updatedAt: deps.now() };
          await deps.store.put(current);
        },
      });
      const settlement = settle({ rules: record.rules, run, stamp: deps.stamp, verifyStamp: deps.verifyStamp, at: deps.now() });
      current = { ...current, log: run.log, status: run.result ? "done" : "void", voided: run.voided, settlement, updatedAt: deps.now() };
      await deps.store.put(current);
      if (rated && run.result && deps.agents.keepRating) await rate(rated, record.format, run.result.winner as Seat | null);
    } catch (error) {
      console.error("[ring] duel stopped", record.id, error instanceof Error ? error.name : "unknown");
      await deps.store.put({ ...current, status: "void", voided: "harness", updatedAt: deps.now() }).catch(() => undefined);
    }
  }

  async function rate(pair: Pair<AgentRecord>, format: DuelFormat, winner: Seat | null): Promise<void> {
    const rows = (await Promise.all(pair.map(async (a) => (await deps.agents.ratings(a.id, a.brain)).find((r) => r.format === format) ?? emptyRating(format)))) as Pair<RatingRecord>;
    const next = rateGame(rows, winner);
    await Promise.all(pair.map((a, seat) => deps.agents.keepRating!(a.id, a.brain, next[seat]!)));
  }

  return {
    async start(accountId: string, request: StartRequest): Promise<DuelOutcome<DuelView>> {
      if (!isDuelFormat(request.format)) return refuse("BAD_REQUEST");
      const owner = `a:${accountId}`;
      const mine = await seatOf(request.agent, request.format);
      if (!mine.ok) return mine;
      const theirs = await seatOf(request.opponent, request.format);
      if (!theirs.ok) return theirs;
      const [a, b] = [mine.value, theirs.value];
      if (a.record && a.record.owner !== owner) return refuse("NOT_YOURS");
      if (a.house && b.record) return refuse("NOT_YOURS");
      for (const side of [a, b]) if (side.record && (side.record.status !== "active" || !side.record.formats.includes(request.format))) return refuse(side.record.status !== "active" ? "OFF" : "FORMAT");
      if (a.record && b.record) {
        const refusal = pairRefusal(contender(a.record), contender(b.record), request.format);
        if (refusal) return refuse(refusal);
      }
      if (a.seat.id === b.seat.id) return refuse("SAME_AGENT");

      const since = deps.now() - DAY;
      if ((await deps.store.count({ owner, since })) >= STARTS_PER_ACCOUNT_DAY) return refuse("RATE_LIMITED");
      for (const side of [a, b]) if (side.record && (await deps.store.count({ agent: side.record.id, since })) >= DUELS_PER_AGENT_DAY) return refuse("RATE_LIMITED");

      const agents: DuelAgent[] = [];
      for (const side of [a, b]) {
        const agent = side.house ? houseAgent(side.house) : await deps.brain(side.record!);
        if (!agent) return refuse("NO_KEY");
        agents.push(agent);
      }

      const id = deps.newId();
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
        createdAt: now,
        updatedAt: now,
      };
      await deps.store.put(record);
      const rated = a.record && b.record ? ([a.record, b.record] as Pair<AgentRecord>) : null;
      deps.background(play(record, agents as Pair<DuelAgent>, rated));
      return { ok: true, value: viewOf(record) };
    },

    async get(id: string): Promise<DuelOutcome<DuelView>> {
      const record = await deps.store.get(id);
      return record ? { ok: true, value: viewOf(record) } : refuse("NOT_FOUND");
    },

    async recent(limit = 12): Promise<DuelView[]> {
      return (await deps.store.recent(Math.min(Math.max(1, limit), 50))).map(viewOf);
    },
  };
}

export type DuelService = ReturnType<typeof createDuelService>;
