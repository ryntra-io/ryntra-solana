/**
 * The Nansen adapter — the provider behind the evidence layer's one
 * interface: a mint and a window in, a normalized read out, every call
 * reserved with the governor before it is made and settled after.
 *
 * Two families answer one snapshot: the token screener filtered to the one
 * mint (the whole-market DEX figures) and flow intelligence (the labelled
 * groups' net movement). Each is one credit and each is governed on its
 * own, so a ceiling reached between the two yields a snapshot with the first
 * family's figures and an honest note on the second, not a refusal of both.
 * A family that fails for a reason a person cannot mend (no key, no
 * credits, a rate limit, a provider fault) is reported as such; the read is
 * UNAVAILABLE only when nothing answered.
 *
 * The next provider implements the same `MarketEvidenceProvider` shape with
 * its own families and its own rights map; nothing above this file knows
 * which provider answered beyond the snapshot's `provider` field. The
 * governor is a contract (`governor.ts`): the product hands the shared
 * ledger, a script hands a one-process counter.
 */

import type { CreditGovernor } from "../../governor.ts";
import { type EvidenceProvider, type EvidenceWindow, type MarketWindow, MARKET_WINDOWS } from "../../metrics.ts";
import { familyRights, NANSEN_RIGHTS } from "../../rights.ts";
import type { MarketEvidenceSnapshot } from "../../snapshot.ts";
import type { NansenCall, NansenClient } from "./client.server.ts";
import { firstRow, mapNansenSnapshot, NANSEN_FLOWS_FAMILY, NANSEN_SCREENER_FAMILY, NANSEN_TIMEFRAMES, rowsOf, warningsOf, type NansenFamilyAnswer } from "./mapper.ts";

export type ProviderRead =
  | Readonly<{ state: "FRESH"; snapshot: MarketEvidenceSnapshot }>
  | Readonly<{ state: "UNKNOWN"; reason: string }>
  | Readonly<{ state: "UNAVAILABLE"; reason: string }>;

export type MarketEvidenceProvider = Readonly<{
  provider: EvidenceProvider;
  read(input: { mint: string; window: EvidenceWindow; nowMs: number }): Promise<ProviderRead>;
}>;

const CHAIN = "solana";

function failureWords(call: Extract<NansenCall, { ok: false }>): string {
  switch (call.kind) {
    case "auth":
      return "The provider refused the key.";
    case "credits":
      return "The provider account has no credits left.";
    case "geo":
      return "The provider does not serve this region.";
    case "rate":
      return `The provider's rate limit was reached${call.headers.retryAfterSeconds ? `; retry after ${call.headers.retryAfterSeconds} s` : ""}.`;
    case "timeout":
      return "The provider did not answer in time.";
    case "network":
      return "The provider could not be reached.";
    case "server":
      return `The provider answered ${call.status}.`;
    case "refused":
      return call.message;
    case "invalid":
      return `The request was refused (${call.code ?? call.status}).`;
  }
}

export function createNansenAdapter(input: { client: NansenClient; governor: CreditGovernor }): MarketEvidenceProvider {
  const { client, governor } = input;

  async function family(name: string, body: Readonly<Record<string, unknown>>, nowMs: number, pick: (json: unknown) => Readonly<Record<string, unknown>> | null): Promise<NansenFamilyAnswer & { hard: boolean }> {
    const rights = familyRights(NANSEN_RIGHTS, name);
    const expected = rights?.creditsPerCall ?? 1;
    const reserved = await governor.reserve({ expectedCredits: expected, nowMs });
    if (!reserved.ok) {
      return { row: null, answered: false, warnings: [], failure: reserved.code === "NO_BUDGET" ? "No credit budget is configured." : reserved.code === "BUDGET_EXHAUSTED" ? "The credit budget for today is used up." : "The credit ledger could not be reached.", hard: true };
    }
    const call = await client.call(name, body);
    await governor.settle({
      expectedCredits: expected,
      settlement: { succeeded: call.ok, creditsUsed: call.headers.creditsUsed, creditsRemaining: call.headers.creditsRemaining, requestId: call.headers.requestId, retried: call.retried, failureKind: call.ok ? null : call.kind },
      nowMs,
    });
    if (!call.ok) {
      console.warn(`evidence nansen ${name}: ${call.kind} ${call.status} ${call.code ?? ""} in ${call.ms} ms${call.retried ? " (retried)" : ""}`);
      return { row: null, answered: false, warnings: [], failure: failureWords(call), hard: call.kind !== "invalid" };
    }
    return { row: pick(call.json), answered: true, warnings: warningsOf(call.json), failure: null, hard: false };
  }

  return {
    provider: "nansen",
    async read({ mint, window, nowMs }) {
      /* Nansen's figures are rolling-window activity; a point-in-time window
         is another provider's and is not asked here. */
      if (!(MARKET_WINDOWS as readonly EvidenceWindow[]).includes(window)) return { state: "UNKNOWN", reason: "This source has no point-in-time figures; the rolling windows are its own." };
      const timeframes = NANSEN_TIMEFRAMES[window as MarketWindow];
      /* The screener's address filter also matches a symbol, so the row is
         the one whose address is this exact mint, or none; a symbol is a
         label, never an identity. */
      const screener = await family(
        NANSEN_SCREENER_FAMILY,
        { chains: [CHAIN], timeframe: timeframes.screener, filters: { token_address: mint }, pagination: { page: 1, per_page: 5 } },
        nowMs,
        (json) => rowsOf(json).find((row) => row.token_address === mint) ?? null,
      );
      /* A hard refusal of the first family (no key, no credits, no budget, the
         provider down) would meet the second the same way; it is not asked. */
      const flows =
        !screener.answered && screener.hard
          ? { row: null, answered: false, warnings: [], failure: screener.failure, hard: true }
          : await family(NANSEN_FLOWS_FAMILY, { chain: CHAIN, token_address: mint, timeframe: timeframes.flows }, nowMs, firstRow);
      if (!screener.answered && !flows.answered) {
        return { state: "UNAVAILABLE", reason: screener.failure ?? flows.failure ?? "The provider did not answer." };
      }
      const snapshot = mapNansenSnapshot({ mint, window, fetchedAtMs: nowMs, screener, flows });
      if (!snapshot) return { state: "UNKNOWN", reason: "The provider has no data for this token." };
      return { state: "FRESH", snapshot };
    },
  };
}
