/* Execution-safety seams (STEP 6 prep). Interfaces only — no live execution ships in this
   wave. They exist so the Hyperliquid (and any future) adapter is BUILT against explicit
   user-approval, revocation, kill-switch, idempotency and audit primitives instead of bolting
   them on after live orders exist. Non-custodial invariant: approvals are WALLET-SIGNED user
   actions; Ryntra never holds a key that could grant itself a fee or move funds. */

import type { RouteId } from "./ids.ts";
import type { InstrumentKey } from "./instrument.ts";

/** A user's explicit, revocable approval of a per-order builder/integrator fee on a venue. */
export type BuilderFeeApproval = {
  route: RouteId;
  /** Maximum fee the user approved, basis points. The venue enforces the cap on-chain/on-venue. */
  maxFeeBps: number;
  /** Wallet-signed action reference (tx hash / signature id) proving the approval. */
  signatureRef: string;
  approvedAt: number; // unix ms
  revokedAt: number | null;
};

/** Port for reading and preparing builder-fee approvals. Prepare-only: the WALLET signs. */
export interface BuilderFeeControl {
  /** Current approval for this address on this route, or null when none/revoked. */
  currentApproval(address: string): Promise<BuilderFeeApproval | null>;
  /** Build the unsigned approval action the user's wallet must sign. Never auto-submitted. */
  prepareApproval(address: string, maxFeeBps: number): Promise<unknown>;
  /** Build the unsigned revocation action. Revocation must always be one step. */
  prepareRevocation(address: string): Promise<unknown>;
}

/** Client-side kill switch: when engaged, NO execution intent may be prepared or relayed. */
export type KillSwitchState = {
  engaged: boolean;
  engagedAt: number | null;
  /** Who/why: "user" | "policy:<code>". Policy engagements require an explicit user reset. */
  reason: string | null;
};

export interface KillSwitch {
  state(): KillSwitchState;
  engage(reason: string, at: number): void;
  /** Reset is always a deliberate user action — never automatic. */
  reset(): void;
}

/** Append-only audit record of every execution-adjacent action, success or failure. */
export type AuditEvent = {
  id: string;
  at: number; // unix ms
  kind:
    | "intent-prepared"
    | "intent-signed"
    | "intent-relayed"
    | "intent-rejected"
    | "approval-prepared"
    | "approval-signed"
    | "revocation-prepared"
    | "kill-switch-engaged"
    | "kill-switch-reset";
  route: RouteId | null;
  instrument: InstrumentKey | null;
  /** Ties retries of the same logical order together. */
  idempotencyKey: string | null;
  /** Digest of the payload (never the raw signed body — no secrets in the log). */
  payloadDigest: string | null;
  outcome: "ok" | "error";
  note: string | null;
};

export interface AuditLog {
  append(event: AuditEvent): Promise<void>;
  list(limit?: number): Promise<AuditEvent[]>;
}

/**
 * Mint an idempotency key ONCE when an intent is created; every retry of the same logical
 * order reuses it, so a venue/relay can deduplicate. Uses the platform CSPRNG.
 */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
