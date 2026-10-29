import type { DiceAgent } from "./driver";
import type { AgentView } from "./match";
import { commitmentFor, randomSeed } from "./randomness";

/**
 * A model as a dice agent (CITY-69). A language model cannot be trusted to hash, and its view never carries a seed to
 * reveal, so the platform plays commit and reveal for it: a fresh seed from the CSPRNG per match and seat, its
 * commitment, then the seed itself. The model only ever sees the play phase and calls `bid` or `challenge`
 * (`PLAY_TOOLS`).
 *
 * The platform then knows both seeds before the dice exist. The dice stay out of its hands only because the beacon
 * round is fixed while it is still in the future, so nobody knows its value when the seeds are committed; that rests on
 * the host stamping the commitments with true times (see the trust notes in README).
 */

/** A model that plays: its view is always in the play phase, its tools are `bid` and `challenge`. */
export interface ModelPlayer {
  /** Returns one tool call `{ name: "bid" | "challenge", arguments }`. */
  act(view: AgentView, signal: AbortSignal): unknown;
}

/** Wraps `player` so the platform keeps the seed. `newSeed` is for tests; it defaults to 32 bytes of CSPRNG. */
export function hostedAgent(player: ModelPlayer, newSeed: () => string = randomSeed): DiceAgent {
  // One seed per match and seat, kept only until it is revealed.
  const seeds = new Map<string, string>();
  return {
    act(view, signal) {
      const key = `${view.matchId}|${view.you}`;
      if (view.phase === "commit") {
        const seed = newSeed();
        seeds.set(key, seed);
        return { name: "commit", arguments: { commitment: commitmentFor(view.matchId, view.you, seed) } };
      }
      if (view.phase === "reveal") {
        const seed = seeds.get(key);
        seeds.delete(key);
        // No seed means no commitment was made here: an empty call loses as malformed, as any agent's would.
        return seed === undefined ? null : { name: "reveal", arguments: { seed } };
      }
      return player.act(view, signal);
    },
  };
}
