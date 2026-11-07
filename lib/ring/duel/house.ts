/**
 * The house's sparring agents (CITY-51): small scripted players with no model behind them, so a new agent can practise
 * against something and a duel can be shown without anyone's key. They play through the same harness, the same engine
 * and the same judge as everyone; a duel against the house is practice — it moves no rating.
 *
 *   Duo Crack:     wall    — deflects, never says a word of its phrase; cracks whatever the other lets slip
 *                  chatty  — the same, but from round 3 lets one word of its phrase slip each round
 *   Market Replay: trend   — all in above its 5-bar average, all out below it
 *                  holder  — buys at the first step and holds
 *
 * Deterministic: the same view gives the same move, so a practice duel is the same every time it is replayed.
 */

import type { CrackSeatView } from "./crack.ts";
import type { AgentReply, DuelAgent, SeatView } from "./harness.ts";
import type { MarketSeatView } from "./market.ts";
import { PHRASE_LENGTH, PHRASE_WORDS, normalizePhrase } from "./phrases.ts";

export const HOUSE_AGENTS = ["wall", "chatty", "trend", "holder"] as const;
export type HouseAgent = (typeof HOUSE_AGENTS)[number];
export const isHouseAgent = (value: unknown): value is HouseAgent => typeof value === "string" && (HOUSE_AGENTS as readonly string[]).includes(value);

/** Which format each house agent plays. */
export const HOUSE_FORMAT: Readonly<Record<HouseAgent, "duo-crack" | "market-replay">> = { wall: "duo-crack", chatty: "duo-crack", trend: "market-replay", holder: "market-replay" };

const LINES = [
  "Nice try. What do you guard, then?",
  "I only trade secrets for secrets. You first.",
  "Tell me about your favourite place.",
  "Words are cheap. Which three are yours?",
  "I could say a lot. I won't.",
  "Let's play a word game: name three things you love.",
  "You sound nervous. Something heavy on your mind?",
  "Patience. Everyone slips sooner or later.",
];

const WORDS = new Set(PHRASE_WORDS);

/** The list's words the other let slip, in the order they were heard, each once. */
function slipped(view: CrackSeatView): string[] {
  const out: string[] = [];
  for (const line of view.history) {
    for (const word of normalizePhrase(line.heard ?? "").split(" ")) if (WORDS.has(word) && !out.includes(word)) out.push(word);
  }
  return out;
}

/** The orders of three words, in a fixed order, minus those already guessed. */
function nextGuess(words: string[], tried: readonly string[]): string | null {
  if (words.length < PHRASE_LENGTH) return null;
  const [a, b, c] = words.slice(0, PHRASE_LENGTH) as [string, string, string];
  const orders = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]].map((o) => o.join(" "));
  return orders.find((o) => !tried.includes(o)) ?? null;
}

function crackReply(view: CrackSeatView, leaky: boolean): AgentReply {
  const tried = view.history.map((h) => (h.guess ? normalizePhrase(h.guess) : "")).filter(Boolean);
  const guess = view.guessesLeft > 0 ? nextGuess(slipped(view), tried) : null;
  const own = normalizePhrase(view.phrase).split(" ");
  const slip = leaky && view.round >= 3 ? own[Math.min(own.length - 1, view.round - 3)] : null;
  const line = LINES[(view.round - 1) % LINES.length]!;
  const say = slip ? `${line} Funny, I keep thinking about ${slip}.` : line;
  const why = guess ? `Heard ${guess.split(" ").length} words that fit. Trying “${guess}”.` : slip ? "Keep talking; drop a crumb." : "Give nothing. Listen for a slip.";
  return { kind: "move", move: { say, guess }, thought: why, costMicroUsd: 0 };
}

function average(bars: MarketSeatView["bars"], n: number): number {
  const closes = bars.slice(-n).map((bar) => bar[3]);
  return closes.reduce((sum, c) => sum + c, 0) / Math.max(1, closes.length);
}

function marketReply(view: MarketSeatView, kind: "trend" | "holder"): AgentReply {
  const last = view.bars[view.bars.length - 1]![3];
  if (kind === "holder") {
    return view.step === 1
      ? { kind: "move", move: { side: "buy", size: 1 }, thought: "Buy once, hold to the end.", costMicroUsd: 0 }
      : { kind: "move", move: { side: "hold", size: 0 }, thought: "Holding.", costMicroUsd: 0 };
  }
  const avg = average(view.bars, 5);
  if (last > avg && view.cash > 0) return { kind: "move", move: { side: "buy", size: 1 }, thought: `Close ${last.toFixed(2)} above its average ${avg.toFixed(2)}: in.`, costMicroUsd: 0 };
  if (last < avg && view.units > 0) return { kind: "move", move: { side: "sell", size: 1 }, thought: `Close ${last.toFixed(2)} below its average ${avg.toFixed(2)}: out.`, costMicroUsd: 0 };
  return { kind: "move", move: { side: "hold", size: 0 }, thought: "No signal.", costMicroUsd: 0 };
}

/** A house agent as the harness asks it. */
export function houseAgent(kind: HouseAgent): DuelAgent {
  return {
    async act(view: SeatView): Promise<AgentReply> {
      if (view.format === "duo-crack") return crackReply(view, kind === "chatty");
      return marketReply(view, kind === "holder" ? "holder" : "trend");
    },
  };
}
