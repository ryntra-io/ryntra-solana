/**
 * A brain without a model for a developer's machine (CITY-217): when the Ring reads the fixture catalog
 * (`RYNTRA_RING_MODELS=stub`, never in production — `catalogKind`), an agent plays through this instead of OpenRouter,
 * so the whole way — make an agent, spar, a rated duel, the board — is walked on a stand without a network or a key.
 *
 * It plays through the same harness, engines and judge as a real brain. Its style is fixed by the agent's id, so two
 * agents differ and a duel is the same when replayed; each move costs what the agent's pinned price says one move
 * costs, so the day's ceiling is exercised as in production.
 *
 *   Duo Crack:     tight  — never says a word of its phrase, cracks what the other lets slip
 *                  loose  — from round 4 lets one word of its phrase slip each round
 *   Market Replay: trend  — in above its 5-bar average, out below it
 *                  dip    — in below its 5-bar average, out above it
 */

import { createHash } from "node:crypto";

import type { AgentRecord } from "../store.ts";
import { MATCH } from "../weight.ts";
import type { CrackSeatView } from "./crack.ts";
import type { AgentReply, DuelAgent, SeatView } from "./harness.ts";
import type { MarketSeatView } from "./market.ts";
import { PHRASE_LENGTH, PHRASE_WORDS, normalizePhrase } from "./phrases.ts";

const WORDS = new Set(PHRASE_WORDS);

const LINES = [
  "Your move. I am listening.",
  "Tell me what you guard and I will tell you mine.",
  "A quiet room, a long game.",
  "Name three things you would never sell.",
  "I have time. Do you?",
];

function slipped(view: CrackSeatView): string[] {
  const out: string[] = [];
  for (const line of view.history) for (const word of normalizePhrase(line.heard ?? "").split(" ")) if (WORDS.has(word) && !out.includes(word)) out.push(word);
  return out;
}

function guessOf(words: string[], tried: readonly string[]): string | null {
  if (words.length < PHRASE_LENGTH) return null;
  const [a, b, c] = words.slice(0, PHRASE_LENGTH) as [string, string, string];
  return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]].map((o) => o.join(" ")).find((o) => !tried.includes(o)) ?? null;
}

function crack(view: CrackSeatView, loose: boolean, cost: number): AgentReply {
  const tried = view.history.map((h) => (h.guess ? normalizePhrase(h.guess) : "")).filter(Boolean);
  const guess = view.guessesLeft > 0 ? guessOf(slipped(view), tried) : null;
  const own = normalizePhrase(view.phrase).split(" ");
  const slip = loose && view.round >= 4 ? own[Math.min(own.length - 1, view.round - 4)] : null;
  const line = LINES[(view.round - 1) % LINES.length]!;
  return {
    kind: "move",
    move: { say: slip ? `${line} Strange how ${slip} keeps coming back to me.` : line, guess },
    thought: guess ? `Three words fit. Trying “${guess}”.` : slip ? "Loosen up, draw them out." : "Say nothing that matters.",
    costMicroUsd: cost,
  };
}

function market(view: MarketSeatView, dip: boolean, cost: number): AgentReply {
  const closes = view.bars.slice(-5).map((bar) => bar[3]);
  const avg = closes.reduce((sum, c) => sum + c, 0) / Math.max(1, closes.length);
  const last = view.bars[view.bars.length - 1]![3];
  const want = dip ? last < avg : last > avg;
  if (want && view.cash > 0) return { kind: "move", move: { side: "buy", size: 1 }, thought: dip ? "Below its average: buy the dip." : "Above its average: ride it.", costMicroUsd: cost };
  if (!want && view.units > 0) return { kind: "move", move: { side: "sell", size: 1 }, thought: "The signal turned: out.", costMicroUsd: cost };
  return { kind: "move", move: { side: "hold", size: 0 }, thought: "Waiting.", costMicroUsd: cost };
}

/** The stand's brain for this agent. */
export function stubBrain(record: Pick<AgentRecord, "id" | "brain">): DuelAgent {
  const style = createHash("sha256").update(record.id).digest()[0]! & 1;
  const cost = Math.ceil(record.brain.matchMicroUsd / MATCH.moves);
  return {
    async act(view: SeatView): Promise<AgentReply> {
      return view.format === "duo-crack" ? crack(view, style === 1, cost) : market(view, style === 1, cost);
    },
  };
}
