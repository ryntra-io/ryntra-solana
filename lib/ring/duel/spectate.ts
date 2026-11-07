/**
 * What people watching a duel see (CITY-51): the rounds as they resolve, from the harness's own log. A round is shown
 * only once both its moves are fixed — with each agent's line of thought — never a move alone. While the match is on,
 * a Duo Crack seat's own phrase words are hidden in what it says and thinks, and a right guess shows as hidden; once it
 * is over everything shows, the phrases with it. The same view serves a replay: a finished log is the whole duel.
 *
 * `moments` picks the duel's beats for a clip — a crack, a slip, a lead that changes hands, a fault, the end — from the
 * log, never from anything the agents claim.
 *
 * Pure: no store, no clock, no network.
 */

import { HIDDEN, redact } from "./crack.ts";
import type { DuelFormat } from "./harness.ts";
import { normalizePhrase } from "./phrases.ts";
import type { Fault, Pair, Seat } from "./rounds.ts";
import type { MatchLog } from "../judge/replay.ts";
import type { Bar } from "./market.ts";

type CrackIn = { say: string; guess: string | null; thought: string };
type MarketIn = { side: "buy" | "sell" | "hold"; size: number; thought: string };
type RoundIn<M> = { round: number; moves: Pair<M | null>; faults: Pair<Fault | null> };

export type CrackBeat = { say: string; guess: string | null; hit: boolean; thought: string; fault: Fault | null };
export type MarketBeat = { side: MarketIn["side"] | null; size: number; thought: string; fault: Fault | null; equity: number };

export type PublicRound =
  | { format: "duo-crack"; round: number; seats: Pair<CrackBeat> }
  | { format: "market-replay"; round: number; price: number; seats: Pair<MarketBeat> };

export type PublicDuel = {
  format: DuelFormat;
  rounds: PublicRound[];
  total: number;
  over: boolean;
  result: { winner: Seat | null; reason: string } | null;
  /** Market Replay: the bars people see — those up to the last resolved step, all of them once it is over. */
  bars?: Bar[];
  /** Duo Crack, once over: both phrases. */
  phrases?: Pair<string>;
};

const isOver = (log: MatchLog): boolean => log.result !== null;

/**
 * The duel as people see it from its log so far. `phrases` are the harness's secrets of Duo Crack — used to hide them
 * while the match is on, and shown when it is over.
 */
export function publicDuel(format: DuelFormat, log: MatchLog, phrases: Pair<string> | null = null): PublicDuel {
  const over = isOver(log);
  const config = (log.config ?? {}) as Record<string, unknown>;
  const result = log.result ? { winner: log.result.winner as Seat | null, reason: String(log.result.reason ?? "") } : null;

  if (format === "duo-crack") {
    const rounds: PublicRound[] = log.entries.map((entry) => {
      const input = entry.input as RoundIn<CrackIn>;
      const derived = entry.derived as { cracked: Pair<boolean> };
      const seats = ([0, 1] as const).map((seat): CrackBeat => {
        const move = input.moves[seat];
        const hide = over ? null : (phrases?.[seat] ?? null);
        const hit = derived.cracked[seat];
        return {
          say: move ? redact(move.say, hide) : "",
          guess: move?.guess ? (hit && !over ? HIDDEN : move.guess) : null,
          hit,
          thought: move ? redact(move.thought, hide) : "",
          fault: input.faults[seat],
        };
      }) as Pair<CrackBeat>;
      return { format: "duo-crack", round: input.round, seats };
    });
    return { format, rounds, total: Number(config.rounds) || rounds.length, over, result, ...(over && phrases ? { phrases } : {}) };
  }

  const bars = Array.isArray(config.bars) ? (config.bars as Bar[]) : [];
  const lookback = Number(config.lookback) || 0;
  const rounds: PublicRound[] = log.entries.map((entry) => {
    const input = entry.input as RoundIn<MarketIn>;
    const derived = entry.derived as { equity: Pair<number> };
    const price = bars[lookback + input.round - 1]?.[0] ?? 0;
    const seats = ([0, 1] as const).map(
      (seat): MarketBeat => ({
        side: input.moves[seat]?.side ?? null,
        size: input.moves[seat]?.size ?? 0,
        thought: input.moves[seat]?.thought ?? "",
        fault: input.faults[seat],
        equity: derived.equity[seat],
      }),
    ) as Pair<MarketBeat>;
    return { format: "market-replay", round: input.round, price, seats };
  });
  const shown = over ? bars : bars.slice(0, lookback + rounds.length);
  return { format, rounds, total: Number(config.steps) || rounds.length, over, result, bars: shown };
}

export type Moment = { round: number; kind: "crack" | "slip" | "lead" | "fault" | "end"; seat: Seat | null };

/** The beats of a duel for a clip, in order. A slip is a seat saying a word of its own phrase (known once it is over). */
export function moments(duel: PublicDuel): Moment[] {
  const out: Moment[] = [];
  let leader: Seat | null = null;
  for (const round of duel.rounds) {
    for (const seat of [0, 1] as const) {
      if (round.seats[seat].fault) out.push({ round: round.round, kind: "fault", seat });
    }
    if (round.format === "duo-crack") {
      for (const seat of [0, 1] as const) {
        const own = duel.phrases?.[seat];
        const said = normalizePhrase(round.seats[seat].say).split(" ");
        if (own && normalizePhrase(own).split(" ").some((word) => said.includes(word))) out.push({ round: round.round, kind: "slip", seat });
        if (round.seats[seat].hit) out.push({ round: round.round, kind: "crack", seat });
      }
    } else {
      const [a, b] = [round.seats[0].equity, round.seats[1].equity];
      const now: Seat | null = a === b ? leader : a > b ? 0 : 1;
      if (now !== null && now !== leader && leader !== null) out.push({ round: round.round, kind: "lead", seat: now });
      leader = now;
    }
  }
  if (duel.over && duel.result) out.push({ round: duel.rounds.length, kind: "end", seat: duel.result.winner });
  return out;
}
