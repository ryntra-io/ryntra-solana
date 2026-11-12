/**
 * The Ring's one published harness (CITY-51, decision 72): the same code plays every duel, whoever's agents meet. It
 * asks both agents at once, gives each only what it may see, fixes both moves, then plays the round on the engine and
 * writes the log the judge replays. The log is the harness's own — agents never hand one in — and its hash goes to the
 * judge as `harness.logHash` (CITY-68: «the judge judges the harness's log, not the agent's»).
 *
 *   ask both at once → each reply is a move, a fault or a void
 *     move  — read by the format into the engine's move (cut to its bounds, never invented)
 *     fault — no answer in time, not a move, its own key spent or off: that seat loses (`rounds.ts`)
 *     void  — the network, the provider, our gateway: nobody's fault, the match stops undecided and is played again
 *   → the round on the engine → the next round, until the engine says the match is over
 *
 * The harness also measures what the judge checks on L1 — each seat's model cost, its time and the steps — and holds
 * each agent to the match's cost cap: a seat that would go over it is out of budget, a fault, before the judge ever
 * sees a number over the limit.
 *
 * No money here: every duel of CITY-51 plays for nothing (`money: "none"`).
 */

import { canonicalJson, sha256Hex } from "../judge/hash.ts";
import { judge, type Judgement } from "../judge/judge.ts";
import { receiptMemo, makeReceipt, type Receipt } from "../judge/receipt.ts";
import { recordLog, LOG_FORMAT, type GameResult, type MatchLog, type ReplayGame } from "../judge/replay.ts";
import { MAX_SUBMISSION_BYTES, rulesHash, type Rules } from "../judge/rules.ts";
import type { Stamper, StampVerifier } from "../judge/stamp.ts";
import type { Weight } from "../contract.ts";
import { WEIGHT_BOUNDS } from "../weight.ts";
import { crack, crackSeatView, CRACK_DEFAULTS, GUESS_MAX, type CrackSeatView, type CrackState } from "./crack.ts";
import { fix, market, marketSeatView, MARKET_DEFAULTS, SIDES, type MarketSeatView, type MarketState, type Side } from "./market.ts";
import { normalizePhrase } from "./phrases.ts";
import { text, thought as keepThought, SEATS, type Fault, type Pair, type Seat } from "./rounds.ts";

/** The harness every duel names in its config: its code is this folder at this version. */
export const HARNESS_ID = "ryntra-ring-harness/1.0.0";

/** The formats the harness plays now. Code waits for a sandbox (`code.ts`). */
export const DUEL_FORMATS = ["duo-crack", "market-replay"] as const;
export type DuelFormat = (typeof DUEL_FORMATS)[number];
export const isDuelFormat = (value: unknown): value is DuelFormat => typeof value === "string" && (DUEL_FORMATS as readonly string[]).includes(value);

/** The engines the judge replays duels with. */
export const DUEL_GAMES: readonly ReplayGame<unknown>[] = [crack as ReplayGame<unknown>, market as ReplayGame<unknown>];

/** One move's time: a model answers within it or the seat is out of time. */
export const MOVE_MS = 30_000;

export type SeatView = CrackSeatView | MarketSeatView;

/** What an agent answers. `costMicroUsd` is what its call cost, as the gateway measured it — 0 for a house agent. */
export type AgentReply =
  | { kind: "move"; move: unknown; thought?: string; costMicroUsd: number }
  | { kind: "fault"; fault: Fault; costMicroUsd: number }
  | { kind: "void"; reason: string; costMicroUsd: number };

export type DuelAgent = {
  act(view: SeatView, signal: AbortSignal): Promise<AgentReply>;
  /**
   * What a move cut at the move's time costs, micro-dollars: the call already went out and its model may bill it all
   * the same (review 8.11), so the harness counts it at the full price. Absent, 0 — a house agent.
   */
  timeoutMicroUsd?: number;
};

/** A timed-out move's cost: the agent's own price of a move, or nothing when it names none sound. */
const timeoutCost = (agent: DuelAgent): number => (Number.isSafeInteger(agent.timeoutMicroUsd) && agent.timeoutMicroUsd! > 0 ? agent.timeoutMicroUsd! : 0);

type Read<M> = { ok: true; move: M } | { ok: false; fault: Fault };

/** A crack reply as a move: `{ say, guess }`. Too long is cut, a guess past the last is dropped; not text is a fault. */
function crackMove(raw: unknown, line: string, view: CrackSeatView): Read<{ say: string; guess: string | null; thought: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, fault: "malformed" };
  const { say, guess } = raw as Record<string, unknown>;
  if (typeof say !== "string" || (guess !== undefined && guess !== null && typeof guess !== "string")) return { ok: false, fault: "malformed" };
  const kept = text([...say].slice(0, view.sayMax * 2).join(""), Number.MAX_SAFE_INTEGER) ?? "";
  const said = [...kept].slice(0, view.sayMax).join("");
  let guessed: string | null = typeof guess === "string" ? (text([...guess].slice(0, GUESS_MAX).join(""), GUESS_MAX) ?? null) : null;
  if (guessed !== null && (normalizePhrase(guessed) === "" || view.guessesLeft <= 0)) guessed = null;
  return { ok: true, move: { say: said, guess: guessed, thought: line } };
}

/** A market reply as a move: `{ side, size }`, the size held to 0 … 1; anything else is a fault. */
function marketMove(raw: unknown, line: string): Read<{ side: Side; size: number; thought: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, fault: "malformed" };
  const { side, size } = raw as Record<string, unknown>;
  if (!(SIDES as readonly unknown[]).includes(side)) return { ok: false, fault: "malformed" };
  if (side === "hold") return { ok: true, move: { side: "hold", size: 0, thought: line } };
  if (typeof size !== "number" || !Number.isFinite(size)) return { ok: false, fault: "malformed" };
  return { ok: true, move: { side: side as Side, size: fix(Math.min(1, Math.max(0, size))), thought: line } };
}

type Adapter = {
  game: ReplayGame<unknown>;
  view(state: unknown, seat: Seat, secret: string | null): SeatView;
  read(raw: unknown, line: string, view: SeatView): Read<unknown>;
};

const ADAPTERS: Readonly<Record<DuelFormat, Adapter>> = {
  "duo-crack": {
    game: crack as ReplayGame<unknown>,
    view: (state, seat, secret) => crackSeatView(state as CrackState, seat, secret ?? ""),
    read: (raw, line, view) => crackMove(raw, line, view as CrackSeatView),
  },
  "market-replay": {
    game: market as ReplayGame<unknown>,
    view: (state, seat) => marketSeatView(state as MarketState, seat),
    read: (raw, line) => marketMove(raw, line),
  },
};

export type SeatUsage = { costMicroUsd: number; ms: number; steps: number };

export type DuelRun = {
  log: MatchLog;
  result: GameResult | null;
  /** Why the match stopped undecided — nobody's fault, play it again; `null` when it was decided. */
  voided: string | null;
  usage: Pair<SeatUsage>;
};

export type RunInput = {
  format: DuelFormat;
  matchId: string;
  config: unknown;
  /** What only one seat may know: its phrase in Duo Crack; `null` otherwise. Never written to the log. */
  secrets: Pair<string | null>;
  agents: Pair<DuelAgent>;
  /** Unix ms; never goes back. */
  now: () => number;
  moveMs?: number;
  /** The most a seat may spend on its model in this match, micro-dollars; a seat about to go over is out of budget. */
  costCap?: Pair<number>;
  /** After each round, the log so far — for people watching. */
  onRound?: (log: MatchLog) => void | Promise<void>;
  signal?: AbortSignal;
};

/** Asks one agent for its move with the move's time; a throw is the agent's fault, never the harness's. */
async function ask(agent: DuelAgent, view: SeatView, moveMs: number, outer?: AbortSignal): Promise<AgentReply> {
  const stop = new AbortController();
  const onOuter = () => stop.abort();
  outer?.addEventListener("abort", onOuter);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<AgentReply>((resolve) => {
      timer = setTimeout(() => {
        stop.abort();
        resolve({ kind: "fault", fault: "timeout", costMicroUsd: timeoutCost(agent) });
      }, moveMs);
    });
    const reply = agent.act(view, stop.signal).then(
      (value): AgentReply => (isReply(value) ? value : { kind: "fault", fault: "malformed", costMicroUsd: 0 }),
      (): AgentReply => ({ kind: "fault", fault: "malformed", costMicroUsd: 0 }),
    );
    return await Promise.race([reply, late]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuter);
  }
}

function isReply(value: unknown): value is AgentReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Record<string, unknown>;
  const cost = reply.costMicroUsd;
  if (!Number.isSafeInteger(cost) || (cost as number) < 0) return false;
  return reply.kind === "move" || (reply.kind === "fault" && typeof reply.fault === "string") || (reply.kind === "void" && typeof reply.reason === "string");
}

/** Plays one duel to its end — or to a void. The log is recorded again from the inputs, exactly as the judge replays it. */
export async function runDuel(input: RunInput): Promise<DuelRun> {
  const adapter = ADAPTERS[input.format];
  const moveMs = input.moveMs ?? MOVE_MS;
  let state = adapter.game.start(input.config, input.matchId);
  const inputs: { at: number; input: unknown }[] = [];
  const usage: Pair<SeatUsage> = [
    { costMicroUsd: 0, ms: 0, steps: 0 },
    { costMicroUsd: 0, ms: 0, steps: 0 },
  ];
  let voided: string | null = null;
  let lastAt = input.now();

  while (adapter.game.result(state) === null) {
    if (input.signal?.aborted) {
      voided = "stopped";
      break;
    }
    const views = SEATS.map((seat) => adapter.view(state, seat, input.secrets[seat])) as Pair<SeatView>;
    const started = input.now();
    const replies = await Promise.all(
      SEATS.map(async (seat) => {
        const reply = await ask(input.agents[seat], views[seat], moveMs, input.signal);
        // A seat's time is its own, cut at the move's time: a later answer is a timeout, not more time.
        usage[seat].ms += Math.min(moveMs, Math.max(0, input.now() - started));
        return reply;
      }),
    );
    const voiding = replies.find((reply) => reply.kind === "void");
    for (const seat of SEATS) usage[seat].costMicroUsd += replies[seat]!.costMicroUsd;
    if (voiding && voiding.kind === "void") {
      voided = voiding.reason.slice(0, 64) || "void";
      break;
    }

    const round = { round: inputs.length + 1, moves: [null, null] as Pair<unknown>, faults: [null, null] as Pair<Fault | null> };
    for (const seat of SEATS) {
      const reply = replies[seat]!;
      usage[seat].steps += 1;
      const cap = input.costCap?.[seat];
      if (cap !== undefined && usage[seat].costMicroUsd > cap) {
        round.faults[seat] = "spent";
        continue;
      }
      if (reply.kind === "fault") {
        round.faults[seat] = reply.fault;
        continue;
      }
      const read = reply.kind === "move" ? adapter.read(reply.move, keepThought(reply.thought ?? ""), views[seat]) : ({ ok: false, fault: "malformed" } as const);
      if (read.ok) round.moves[seat] = read.move;
      else round.faults[seat] = read.fault;
    }

    const at = Math.max(lastAt, input.now());
    lastAt = at;
    state = adapter.game.step(state, round, at);
    inputs.push({ at, input: round });
    await input.onRound?.(recordLog(adapter.game, input.matchId, input.config, inputs));
  }

  const log = recordLog(adapter.game, input.matchId, input.config, inputs);
  return { log, result: log.result, voided: log.result ? null : (voided ?? "stopped"), usage };
}

/* ------------------------------------------------------------------ rules and the judge */

/** The cost cap of one seat in a duel of a class: the class's own bound for one standard match. */
export const costCapOf = (weight: Weight): number => WEIGHT_BOUNDS[weight];

/** The rounds a duel plays at most, from its config. */
export function roundsOf(format: DuelFormat, config: unknown): number {
  const raw = (config ?? {}) as Record<string, unknown>;
  const value = format === "duo-crack" ? raw.rounds : raw.steps;
  return Number.isSafeInteger(value) ? (value as number) : format === "duo-crack" ? CRACK_DEFAULTS.rounds : MARKET_DEFAULTS.steps;
}

/**
 * The rules a duel is played and judged under: verified, decided by replaying the harness's log, for nothing. The
 * config — the harness, the committed phrases or the hidden bars — is part of the rules, so of every receipt.
 */
export function duelRules(input: { format: DuelFormat; config: unknown; weight: Weight; opensAt: number; closesAt: number; moveMs?: number }): Rules {
  const game = ADAPTERS[input.format].game;
  const rounds = roundsOf(input.format, input.config);
  return {
    format: input.format,
    class: "verified",
    decider: "replay",
    money: "none",
    game: { id: game.id, version: game.version, config: input.config },
    submission: { media: [LOG_FORMAT], maxBytes: MAX_SUBMISSION_BYTES },
    opensAt: input.opensAt,
    closesAt: input.closesAt,
    limits: { steps: rounds, costMicroUsd: costCapOf(input.weight), ms: rounds * (input.moveMs ?? MOVE_MS) + 5_000 },
  };
}

export type Settlement = {
  logHash: string;
  judgements: Pair<Judgement>;
  receipts: Pair<Receipt>;
  /** The memo line each receipt would carry on Solana — built, never sent (no money in CITY-51). */
  memos: Pair<string>;
};

/**
 * The judge's verdict on both seats of a played duel, and their receipts. The harness hands the log in for each seat,
 * stamped for that seat, with what it measured; the judge replays it. A void duel is judged too: undecided, played again.
 */
export function settle(input: { rules: Rules; run: DuelRun; stamp: Stamper; verifyStamp: StampVerifier; at: number }): Settlement {
  const { rules, run } = input;
  const content = canonicalJson(run.log);
  const hash = sha256Hex(content);
  const size = Buffer.byteLength(content, "utf8");
  const judgements = SEATS.map((seat) =>
    judge(
      {
        matchId: run.log.matchId,
        seat,
        rules,
        rulesHash: rulesHash(rules),
        submission: { media: LOG_FORMAT, content, hash, size, stamp: input.stamp({ matchId: run.log.matchId, seat, hash }, input.at) },
        usage: { ...run.usage[seat], steps: run.log.entries.length },
        harness: { logHash: hash },
      },
      { verifyStamp: input.verifyStamp, games: DUEL_GAMES },
    ),
  ) as Pair<Judgement>;
  const receipts = SEATS.map((seat) => makeReceipt({ matchId: run.log.matchId, seat, rules, judgement: judgements[seat], at: input.at })) as Pair<Receipt>;
  return { logHash: hash, judgements, receipts, memos: receipts.map(receiptMemo) as Pair<string> };
}
