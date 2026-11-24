/**
 * The gate as the private balance's steps reach it (`lib/privacy/flows.ts`): ask before a move, report after it landed.
 *
 * In the browser the gate is Ryntra's server (`/api/v1/privacy/gate`), so the list source's key stays there. In the
 * test-network pass (a script, no page) the same rules run in place from the script's own settings. A gate that does
 * not answer is no answer: the decision says so, and the move waits — except going back to the person's own wallet,
 * which asks nothing and is always open.
 */

import { addressesOf, decide, readAnswer, type Decision, type GateAnswer, type GateMove } from './core.ts';
import { answerFor } from './answer.ts';
import { PRIVATE_TEST } from '../network.ts';
import { gateSettings, type Env } from './settings.ts';
import { sourceFor } from './sources.ts';
import type { TallyMove } from './tally.ts';

export type { Decision, GateCode, GateMove } from './core.ts';

export type Gate = Readonly<{
  /** The answer for these addresses, with the pause and the cap; `null` — the gate did not answer. */
  ask(addresses: readonly string[]): Promise<GateAnswer | null>;
  /** A step landed: SOL went into the ring or came out. Counted as a total on Ryntra's side; never fails the step. */
  landed(move: TallyMove, lamports: bigint): void;
}>;

export const GATE_PATH = '/api/v1/privacy/gate';
export const TALLY_PATH = '/api/v1/privacy/gate/tally';

/** How long the browser waits for the gate: the source's own deadline and a price read, with room. */
export const ASK_DEADLINE_MS = 12_000;

/** The gate on Ryntra's server, at the page's own origin. */
export function serverGate(origin: string, fetchImpl: typeof fetch = fetch): Gate {
  return {
    ask: async (addresses) => {
      try {
        const answer = await fetchImpl(`${origin}${GATE_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ addresses }),
          cache: 'no-store',
          signal: AbortSignal.timeout(ASK_DEADLINE_MS),
        });
        if (!answer.ok) return null;
        return readAnswer(await answer.json(), addresses);
      } catch {
        return null;
      }
    },
    landed: (move, lamports) => {
      void Promise.resolve()
        .then(() =>
          fetchImpl(`${origin}${TALLY_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ move, lamports: lamports.toString() }),
            cache: 'no-store',
            keepalive: true,
          }),
        )
        .catch(() => undefined);
    },
  };
}

/**
 * The same rules in place, for the test-network pass: settings from the script's own variables, no price (a cap set
 * there holds «Hide» as unchecked), nothing counted — the pass moves test money of its own, not people's.
 */
export function localGate(env: Env): Gate {
  const settings = gateSettings(env);
  const source = sourceFor(settings);
  return {
    ask: (addresses) => answerFor(addresses, { settings, source, testNetwork: PRIVATE_TEST, solUsd: async () => null }),
    landed: () => undefined,
  };
}

/** The page's server in a browser; the rules in place anywhere else. */
export function defaultGate(): Gate {
  if (typeof window !== 'undefined' && window.location?.origin) return serverGate(window.location.origin);
  return localGate((globalThis as { process?: { env?: Env } }).process?.env ?? {});
}

/**
 * The decision for one move. Back to the owner's own wallet asks nothing. `held` reads the private balance in lamports
 * and runs only when the answer carries a cap; a balance that cannot be read leaves the cap unchecked.
 */
export async function checkMove(gate: Gate, move: GateMove, held?: () => Promise<bigint>): Promise<Decision> {
  const addresses = addressesOf(move);
  if (!addresses.length) return decide(move, null);
  const answer = await gate.ask(addresses).catch(() => null);
  let balance: bigint | null = null;
  if (move.kind === 'hide' && answer?.cap?.lamports != null && held) balance = await held().catch(() => null);
  return decide(move, answer, balance);
}
