/**
 * The gate's answer, put together from its settings, its list source and a price of SOL — the same on the server
 * (`app/api/v1/privacy/gate`) and in the test-network pass. Pure but for what it is handed.
 *
 * The cap is a number of dollars; a private balance holds SOL, so the answer carries it in lamports
 * at today's price. The person's balance never comes here: the browser compares the cap with what it holds itself.
 */

import type { Cap, GateAnswer } from './core.ts';
import type { GateSettings } from './settings.ts';
import { screen, type ListSource } from './sources.ts';

export type AnswerDeps = Readonly<{
  settings: GateSettings;
  source: ListSource;
  /** The private balance runs on the test network; off it, the empty source and a missing cap are no answer. */
  testNetwork: boolean;
  /** Dollars per SOL now; `null` — no price. Asked only when a cap is set. */
  solUsd: () => Promise<number | null>;
  deadlineMs?: number;
}>;

const LAMPORTS_PER_SOL = 1_000_000_000;

/** The cap in lamports at this price, or null when it cannot be priced. */
export function capLamports(usd: number, solUsd: number | null): bigint | null {
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const lamports = Math.floor((usd / solUsd) * LAMPORTS_PER_SOL);
  return Number.isSafeInteger(lamports) && lamports > 0 ? BigInt(lamports) : null;
}

export async function capOf(deps: AnswerDeps): Promise<Cap> {
  const { capUsd } = deps.settings;
  if (capUsd === null) return deps.testNetwork ? null : { lamports: null };
  if (capUsd === 'unreadable') return { lamports: null };
  const price = await deps.solUsd().catch(() => null);
  return { lamports: capLamports(capUsd, price) };
}

/** The pause and the cap — the gate's state, without any address. */
export async function stateOf(deps: AnswerDeps): Promise<Pick<GateAnswer, 'paused' | 'cap'>> {
  return { paused: deps.settings.paused, cap: await capOf(deps) };
}

/** The answer for these addresses: the state and a mark for each. */
export async function answerFor(addresses: readonly string[], deps: AnswerDeps): Promise<GateAnswer> {
  const [state, marks] = await Promise.all([stateOf(deps), screen(deps.source, addresses, { testNetwork: deps.testNetwork, deadlineMs: deps.deadlineMs })]);
  return { ...state, marks };
}
