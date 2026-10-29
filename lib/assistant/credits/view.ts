/**
 * What a person reads of their credits (contract 1.52.0): the state as the
 * budget carries it, and the latest entries — what was given, held, kept or
 * given back, never a word of a question. 1.54.0: with `purchase`, what is
 * sold here and to which treasury (AI-12).
 */

import type { AssistantCreditEntry, AssistantCreditsResponse } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";
import { readAgentCredits, type CreditsContext } from "../../agent/budget.ts";
import { readEntries } from "./ledger.ts";
import { purchaseView } from "./order-view.ts";
import { treasuryFrom } from "./purchase.ts";

export async function readCreditsResponse(store: GuardStore, context: CreditsContext, nowMs: number, granted?: number): Promise<AssistantCreditsResponse> {
  const credits = await readAgentCredits(store, context, nowMs);
  const entries: AssistantCreditEntry[] = (await readEntries(store, context.holder, 20)).map((entry) => ({ at: entry.at, kind: entry.kind, action: entry.action, reason: entry.reason, credits: entry.delta.free + entry.delta.bonus + entry.delta.paid, charged: entry.charged }));
  return { credits, entries, ...(granted !== undefined ? { granted } : {}), purchase: purchaseView(treasuryFrom()) };
}
