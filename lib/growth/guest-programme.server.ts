import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { rewardsStartedAt } from "../rewards/activation.ts";
import { networkRulesAt } from "../rewards/network-rules.ts";
import { programmeFacts, type PartnerPayouts, type ProgrammeFacts } from "../rewards/programme-facts.ts";
import { readRewardRulesInForce } from "../rewards/rank-store.ts";
import { readPayoutGate, readPayoutPause } from "./partner-payout.ts";

/**
 * Whether partner payouts are open on Solana: the gate the first test payout writes, unless the owner paused them.
 * Read only. A gate that cannot be read is closed, a pause that cannot be read pauses (`partner-payout.ts`).
 */
export async function partnerPayouts(store: GuardStore): Promise<PartnerPayouts> {
  const [gate, pause] = await Promise.all([readPayoutGate(store, "solana"), readPayoutPause(store, "solana")]);
  if (!gate) return "CLOSED";
  return pause.paused ? "PAUSED" : "OPEN";
}

/**
 * What Rewards pays, for a page read before anybody signs in (Ріст 19): the rules in force now — read only, nothing
 * started — the partner rules of today and whether partner payouts are open. Null when the store does not answer:
 * the page then shows the sign-in alone rather than shares it could not check.
 */
export async function readGuestProgramme(store: GuardStore, now: string, env: NodeJS.ProcessEnv = process.env): Promise<ProgrammeFacts | null> {
  try {
    const [rules, payouts] = await Promise.all([readRewardRulesInForce(store, now), partnerPayouts(store)]);
    return programmeFacts({ rules, network: networkRulesAt(now), payouts, started: rewardsStartedAt(now, env) });
  } catch {
    return null;
  }
}

/** The same, for a page: the store resolved inside the guard too — a store that is not configured is a null, never a failed page. */
export async function readGuestProgrammeNow(): Promise<ProgrammeFacts | null> {
  try {
    return await readGuestProgramme(getGuardRuntime().store, new Date().toISOString());
  } catch {
    return null;
  }
}
