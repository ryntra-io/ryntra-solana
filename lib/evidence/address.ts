/**
 * Address evidence — what a security provider says about one plain address
 * before a person sends to it (Send's recipient check).
 *
 * A recipient is not a token: no window, no plan condition, no figure a
 * threshold could stand on. What a person needs before signing is three
 * honest answers — is the address on a sanctions list the source keeps (in
 * the source's own words: clean, unknown, sanctioned), did the source find
 * anything about it and how much (counts by severity, the source's own 0–100
 * figure with the band the source documents for it), and could the source
 * analyse this kind of address at all. A program-owned account, a vault, a
 * PDA — the address engine refuses them, and the honest reading is
 * *unsupported*, never *clean*.
 *
 * Time is the same three fields as a token snapshot: `fetchedAt` when Ryntra
 * asked, `observedAt` the source's own analysis time (it states one for the
 * findings), `expiresAt` Ryntra's rule for how long a copy is served. The
 * source's tags, labels and descriptions never reach this shape: the rights
 * map keeps them server-side until the provider confirms they may be shown.
 *
 * Pure and client-safe; the contract's zod schema mirrors it. Ryntra never
 * blocks a transfer on any of this — the words are the person's information,
 * the decision is theirs, and a mandatory block would be a separate policy
 * with its own approval.
 */

import type { EvidenceProvider } from "./metrics.ts";
import { EVIDENCE_NETWORK, type EvidenceAttribution, type EvidenceReadState, type EvidenceServedFrom } from "./snapshot.ts";

/** The source's own words for a sanctions screening, plus Ryntra's `unavailable` when it did not answer. */
export const SANCTIONS_STATES = ["clean", "sanctioned", "unknown", "unavailable"] as const;
export type SanctionsState = (typeof SANCTIONS_STATES)[number];

/** Whether the findings engine answered for this address at all. */
export const FINDINGS_STATES = ["answered", "unsupported", "unavailable"] as const;
export type FindingsState = (typeof FINDINGS_STATES)[number];

/** The source's documented bands for its 0–100 figure (Low 0–24, Medium 25–49, High 50–74, Critical 75–100), named as the source names them. */
export const RISK_BANDS = ["low", "medium", "high", "critical"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export type AddressEvidence = Readonly<{
  provider: EvidenceProvider;
  subject: Readonly<{
    network: typeof EVIDENCE_NETWORK;
    address: string;
    /** As the source classified it: a plain wallet, a program or contract, or a kind it could not tell. */
    kind: "wallet" | "program" | "unknown";
  }>;
  fetchedAt: string;
  observedAt: string | null;
  providerLagSeconds: number;
  expiresAt: string;
  sanctions: Readonly<{
    state: SanctionsState;
    /** The source's second answer — whether the address is related to a sanctioned party without being listed; null when it gave none. */
    related: boolean | null;
  }>;
  findings: Readonly<{
    state: FindingsState;
    /** Counts of what the source found, by its own severities; null when it did not answer. */
    count: number | null;
    high: number | null;
    medium: number | null;
    /** The source's own 0–100 figure and the band it documents for it; null when it did not answer. */
    score: number | null;
    band: RiskBand | null;
  }>;
  warnings: readonly string[];
  attribution: EvidenceAttribution;
  rightsPolicy: string;
  families: readonly string[];
}>;

export type AddressEvidenceRead = Readonly<{
  state: EvidenceReadState;
  evidence: AddressEvidence | null;
  reason: string | null;
  served: EvidenceServedFrom;
}>;

/** The source's band for its own figure, as its documentation draws it. */
export function riskBandOf(score: number | null): RiskBand | null {
  if (score === null || !Number.isFinite(score)) return null;
  if (score < 25) return "low";
  if (score < 50) return "medium";
  if (score < 75) return "high";
  return "critical";
}

/** Fresh or stale by Ryntra's own expiry, judged at `nowMs`. */
export function addressEvidenceStateAt(evidence: AddressEvidence, nowMs: number): "FRESH" | "STALE" {
  return Date.parse(evidence.expiresAt) > nowMs ? "FRESH" : "STALE";
}

/**
 * One word for the whole read, for a compact line: what a person should know
 * before pressing *Send*. Never "safe": the best answer is that nothing
 * was found among what the source keeps.
 */
export type AddressEvidenceSummary =
  /** Listed on a sanctions list the source keeps — the one word that outranks every other. */
  | "sanctioned"
  /** The source found something of medium or high severity; the details say how much. */
  | "evidence-found"
  /** Both engines answered and neither found anything among what the source keeps. Not "safe". */
  | "nothing-found"
  /** One engine answered nothing found, the other did not answer — half a check, said so. */
  | "partly-checked"
  /** The source cannot analyse this kind of address (a program, a vault, a PDA). Never green. */
  | "unsupported"
  /** The source did not answer. */
  | "unavailable";

export function summarizeAddressEvidence(read: AddressEvidenceRead): AddressEvidenceSummary {
  if (!read.evidence) return read.state === "UNKNOWN" ? "unsupported" : "unavailable";
  const { sanctions, findings } = read.evidence;
  if (sanctions.state === "sanctioned") return "sanctioned";
  if (findings.state === "answered" && ((findings.high ?? 0) > 0 || (findings.medium ?? 0) > 0)) return "evidence-found";
  if (findings.state === "unsupported") return "unsupported";
  const findingsClean = findings.state === "answered";
  const sanctionsClean = sanctions.state === "clean";
  if (findingsClean && sanctionsClean) return "nothing-found";
  if (findingsClean || sanctionsClean) return "partly-checked";
  return "unavailable";
}
