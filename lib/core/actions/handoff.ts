/**
 * The signer handoff — what the ledger hands to whoever signs an action, and the check that signer runs (EXE-2;
 * spec §3.2 «Authority Check → Reserve Budget → Build → Sign», §14.5).
 *
 * A handoff names one action and the exact bytes it may sign: the action's id and digest, the SHA-256 of the
 * compiled message, the recipient, the amount of one mint, the programs, the reservation behind it and when it stops
 * being good (the blockhash's life, ≈ 30 s under Alpenglow — spec §14.7 п. 3; never more than
 * `MAX_HANDOFF_LIFE_MS`). `handoffDigest` is a canonical hash, not a signature: anyone can re-seal a changed handoff.
 * So the signer never trusts the handoff it is handed — it checks it against the digest the ledger recorded for that
 * `handoffId` (`readSignerHandoff`), and a handoff that is not the recorded one is `HANDOFF_TAMPERED`.
 *
 * Two signers, one contract:
 * - `PERSON_WALLET` — the person's own wallet signs, as on every path today. The ledger issues the handoff; the
 *   wallet's Review shows the same facts.
 * - `BOUNDED_SIGNER` — a signer that is not the person (spec §14.5): it signs only what `checkSignerHandoff` passes
 *   and refuses if the digest, the recipient or the amount differ. **Closed** (`BOUNDED_SIGNER_OPEN = false`): no such
 *   signer exists until EXE-3 builds it under the model the operator picks (D3, EXE-0). The ledger refuses to issue one,
 *   so nothing here can lead to a server signing with people's money.
 */

import { hashCanonical } from "../../guard/canonical.ts";
import type { Amount, SignerHandoff } from "./model.ts";

export type { SignerHandoff } from "./model.ts";

/** EXE-3 opens this on D3 — never a variable of the deployment. */
export const BOUNDED_SIGNER_OPEN = false;

/** A blockhash lives ≈ 60 s under TowerBFT and ≈ 30 s under Alpenglow; a handoff may not outlive two minutes. */
export const MAX_HANDOFF_LIFE_MS = 120_000;

/**
 * Whether a handoff's bytes could still land: before its time, or not known to be past its last valid block height.
 * The one rule both a new handoff and a cancel obey.
 */
export function handoffMayLand(handoff: Readonly<{ expiresAt: string; lastValidBlockHeight: number }>, now: string, blockHeight: number | undefined): boolean {
  return Date.parse(now) < Date.parse(handoff.expiresAt) || !(blockHeight !== undefined && blockHeight > handoff.lastValidBlockHeight);
}

export const SIGNER_KINDS = ["PERSON_WALLET", "BOUNDED_SIGNER"] as const;
export type SignerKind = (typeof SIGNER_KINDS)[number];

export type SignerHandoffBody = Omit<SignerHandoff, "handoffDigest">;

export function handoffDigestOf(body: SignerHandoffBody): string {
  return hashCanonical({ domain: "ryntra.action.handoff.v1", ...body, programIds: [...body.programIds].sort() });
}

export function sealHandoff(body: SignerHandoffBody): SignerHandoff {
  return Object.freeze({ ...body, handoffDigest: handoffDigestOf(body) });
}

/** What the signer actually holds when it is about to sign: read from the bytes, never from the request. */
export type PresentedMessage = Readonly<{
  messageHash: string;
  recipient: string | null;
  spend: Amount | null;
  programIds: readonly string[];
  now: string;
}>;

export const HANDOFF_CHECK_REASONS = [
  "HANDOFF_TAMPERED",
  "HANDOFF_EXPIRED",
  "DIGEST_MISMATCH",
  "RECIPIENT_MISMATCH",
  "MINT_MISMATCH",
  "AMOUNT_MISMATCH",
  "PROGRAM_NOT_ALLOWED",
  "SIGNER_NOT_OPEN",
] as const;
export type HandoffCheckReason = (typeof HANDOFF_CHECK_REASONS)[number];

export type HandoffCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reasons: readonly HandoffCheckReason[] }>;

/**
 * The signer's own check: sign only when this passes. `recordedDigest` is the `handoffDigest` the ledger holds for
 * this `handoffId` — read from the ledger by the signer, never taken from whoever delivered the handoff. Every reason is reported, not the first, so a log says all
 * that differed.
 */
export function checkSignerHandoff(handoff: SignerHandoff, presented: PresentedMessage, recordedDigest: string | null): HandoffCheck {
  const reasons: HandoffCheckReason[] = [];
  const { handoffDigest, ...body } = handoff;
  if (handoffDigest !== handoffDigestOf(body) || recordedDigest === null || handoffDigest !== recordedDigest) reasons.push("HANDOFF_TAMPERED");
  if (handoff.signer.kind === "BOUNDED_SIGNER" && !BOUNDED_SIGNER_OPEN) reasons.push("SIGNER_NOT_OPEN");
  if (Date.parse(presented.now) >= Date.parse(handoff.expiresAt)) reasons.push("HANDOFF_EXPIRED");
  if (presented.messageHash !== handoff.messageHash) reasons.push("DIGEST_MISMATCH");
  if (presented.recipient !== handoff.recipient) reasons.push("RECIPIENT_MISMATCH");
  if (handoff.spend === null) {
    if (presented.spend !== null && presented.spend.amountRaw !== "0") reasons.push("AMOUNT_MISMATCH");
  } else if (presented.spend === null) {
    reasons.push("AMOUNT_MISMATCH");
  } else {
    if (presented.spend.mint !== handoff.spend.mint || presented.spend.decimals !== handoff.spend.decimals) reasons.push("MINT_MISMATCH");
    if (presented.spend.amountRaw !== handoff.spend.amountRaw) reasons.push("AMOUNT_MISMATCH");
  }
  const allowed = new Set(handoff.programIds);
  if (presented.programIds.some((program) => !allowed.has(program))) reasons.push("PROGRAM_NOT_ALLOWED");
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
