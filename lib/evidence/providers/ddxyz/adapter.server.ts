/**
 * The DD.xyz adapter — the second provider behind the evidence layer's one
 * interface, plus the one read a recipient needs: a mint in, a normalized
 * point-in-time snapshot out; an address in, a normalized address read out;
 * every call reserved with the governor before it is made and settled on the
 * provider's own price after.
 *
 * One family answers the token (`trading-lite`, 4 CU); two answer an address
 * (`sanctions`, 1 CU, then `addresses`, 3 CU), each governed on its own, so
 * a ceiling reached between the two yields evidence with the first engine's
 * answer and an honest note on the second, never a refusal of both. The
 * failures are read for what they are: a refused kind of address is
 * *unsupported* (UNKNOWN, never green); a plan gate, a refused key, a rate
 * limit, a provider fault or a timeout is UNAVAILABLE with the reason; a
 * budget the governor refuses is UNAVAILABLE before a socket opens.
 *
 * Nothing above this file knows which provider answered beyond the
 * snapshot's `provider` field; the governor is the same contract the Nansen
 * adapter speaks.
 */

import type { AddressEvidence } from "../../address.ts";
import type { CreditGovernor } from "../../governor.ts";
import type { EvidenceWindow } from "../../metrics.ts";
import { familyRights, DDXYZ_RIGHTS } from "../../rights.ts";
import type { MarketEvidenceProvider, ProviderRead } from "../nansen/adapter.server.ts";
import type { DdxyzCall, DdxyzClient } from "./client.server.ts";
import { DDXYZ_ADDRESSES_FAMILY, DDXYZ_SANCTIONS_FAMILY, DDXYZ_TRADING_LITE_FAMILY, mapAddressEvidence, mapTradingLiteSnapshot, type DdxyzFindingsAnswer, type DdxyzSanctionsAnswer } from "./mapper.ts";

export type AddressProviderRead =
  | Readonly<{ state: "FRESH"; evidence: AddressEvidence }>
  | Readonly<{ state: "UNKNOWN"; reason: string }>
  | Readonly<{ state: "UNAVAILABLE"; reason: string }>;

/** The token interface every provider speaks, plus the address read this one has. */
export type SecurityEvidenceProvider = MarketEvidenceProvider &
  Readonly<{
    readAddress(input: { address: string; nowMs: number }): Promise<AddressProviderRead>;
  }>;

function failureWords(call: Extract<DdxyzCall, { ok: false }>): string {
  switch (call.kind) {
    case "auth":
      return "The provider refused the key.";
    case "plan":
      return "The provider's plan does not include this family.";
    case "payment":
      return "The provider account has a payment due.";
    case "rate":
      return `The provider's rate limit was reached${call.headers.retryAfterSeconds ? `; retry after ${call.headers.retryAfterSeconds} s` : ""}.`;
    case "timeout":
      return "The provider did not answer in time.";
    case "network":
      return "The provider could not be reached.";
    case "server":
      return `The provider answered ${call.status}.`;
    case "notfound":
      return "The provider has no such subject.";
    case "refused":
      return call.message;
    case "invalid":
      return `The request was refused (${call.status}).`;
  }
}

/** The address engine's own words for a kind of address it does not read. */
function unsupportedEntity(call: Extract<DdxyzCall, { ok: false }>): boolean {
  return (call.status === 400 || call.status === 422) && /unsupported (risk )?entity|not supported|invalid address/i.test(call.message);
}

type FamilyOutcome = Readonly<{ call: DdxyzCall | null; refusal: string | null; hard: boolean }>;

export function createDdxyzAdapter(input: { client: DdxyzClient; governor: CreditGovernor }): SecurityEvidenceProvider {
  const { client, governor } = input;

  async function family(name: string, subject: string, nowMs: number): Promise<FamilyOutcome> {
    const rights = familyRights(DDXYZ_RIGHTS, name);
    const expected = rights?.creditsPerCall ?? 1;
    const reserved = await governor.reserve({ expectedCredits: expected, nowMs });
    if (!reserved.ok) {
      return { call: null, refusal: reserved.code === "NO_BUDGET" ? "No usage budget is configured for the source." : reserved.code === "BUDGET_EXHAUSTED" ? "The source's usage budget for today is used up." : "The usage ledger could not be reached.", hard: true };
    }
    const call = await client.call(name, subject);
    await governor.settle({
      expectedCredits: expected,
      settlement: { succeeded: call.ok, creditsUsed: call.headers.computeUnits, creditsRemaining: null, requestId: call.headers.requestId, retried: call.retried, failureKind: call.ok ? null : call.kind },
      nowMs,
    });
    if (!call.ok) {
      console.warn(`evidence ddxyz ${name}: ${call.kind} ${call.status} in ${call.ms} ms${call.retried ? " (retried)" : ""}`);
      return { call, refusal: null, hard: call.kind !== "invalid" && call.kind !== "notfound" };
    }
    return { call, refusal: null, hard: false };
  }

  return {
    provider: "ddxyz",

    async read({ mint, window, nowMs }: { mint: string; window: EvidenceWindow; nowMs: number }): Promise<ProviderRead> {
      /* A structural figure has one window — the moment the source analysed
         the token; the rolling windows are another provider's. */
      if (window !== "now") return { state: "UNKNOWN", reason: "This source has point-in-time figures only; a rolling window is another source's." };
      const outcome = await family(DDXYZ_TRADING_LITE_FAMILY, mint, nowMs);
      if (outcome.refusal) return { state: "UNAVAILABLE", reason: outcome.refusal };
      const call = outcome.call;
      if (!call) return { state: "UNAVAILABLE", reason: "The provider did not answer." };
      if (!call.ok) {
        if (unsupportedEntity(call)) return { state: "UNKNOWN", reason: "The source does not analyse this token." };
        return { state: "UNAVAILABLE", reason: failureWords(call) };
      }
      const snapshot = mapTradingLiteSnapshot({ mint, fetchedAtMs: nowMs, json: call.json });
      if (!snapshot) return { state: "UNKNOWN", reason: "The source has no data for this token." };
      return { state: "FRESH", snapshot };
    },

    async readAddress({ address, nowMs }) {
      /* Sanctions first — the cheaper engine and the one that screens every
         kind of address; a hard refusal there (no key, no budget, the
         provider down) would meet the findings engine the same way and it
         is not asked. */
      const screened = await family(DDXYZ_SANCTIONS_FAMILY, address, nowMs);
      const sanctions: DdxyzSanctionsAnswer = screened.call?.ok ? { state: "answered", json: screened.call.json } : { state: "unavailable", reason: screened.refusal ?? (screened.call && !screened.call.ok ? failureWords(screened.call) : "The provider did not answer.") };
      const skipFindings = !screened.call?.ok && screened.hard;
      const found = skipFindings ? null : await family(DDXYZ_ADDRESSES_FAMILY, address, nowMs);
      let findings: DdxyzFindingsAnswer;
      if (!found) findings = { state: "unavailable", reason: sanctions.state === "unavailable" ? sanctions.reason : "The provider did not answer." };
      else if (found.refusal) findings = { state: "unavailable", reason: found.refusal };
      else if (!found.call) findings = { state: "unavailable", reason: "The provider did not answer." };
      else if (found.call.ok) findings = { state: "answered", json: found.call.json };
      else if (unsupportedEntity(found.call)) findings = { state: "unsupported", reason: "The source cannot analyse this kind of address." };
      else findings = { state: "unavailable", reason: failureWords(found.call) };

      const evidence = mapAddressEvidence({ address, fetchedAtMs: nowMs, findings, sanctions });
      if (!evidence) {
        /* Neither engine answered: an address the findings engine refuses
           while the screening is down is unknown, not unavailable — the
           refusal is the source's statement about the kind of address. */
        if (findings.state === "unsupported") return { state: "UNKNOWN", reason: "The source cannot analyse this kind of address." };
        return { state: "UNAVAILABLE", reason: findings.state === "unavailable" ? findings.reason : sanctions.state === "unavailable" ? sanctions.reason : "The provider did not answer." };
      }
      return { state: "FRESH", evidence };
    },
  };
}
