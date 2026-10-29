/**
 * The spending limits' routes (SOL-7): what the page asks for and what it is answered. Amounts travel as raw base units
 * in decimal strings, never as numbers; addresses as base58; times as unix seconds in decimal strings. The server checks
 * every request again against the rules of `model.ts` — the page's own checks are for the person, these are for the
 * bytes.
 */

import { z } from "zod";

import { MAX_TERM_S, PERIOD_IDS, U64_MAX, isAddress, type AllowanceChain, type AllowanceIssue, type AllowanceKind, type AllowanceStatus, type BlockedBy } from "./model.ts";

const Address = z.string().refine(isAddress, "not an address");
const Raw = z
  .string()
  .regex(/^[1-9]\d{0,19}$/, "not a raw amount")
  .refine((value) => BigInt(value) <= U64_MAX, "over the largest amount a token holds");
const Term = z.number().int().min(60 * 60).max(MAX_TERM_S);

export const AllowanceBuildRequestSchema = z.discriminatedUnion("kind", [
  /* A fixed amount the delegatee may take until the end date. */
  z.object({ kind: z.literal("fixed"), wallet: Address, delegatee: Address, amountRaw: Raw, termSeconds: Term }),
  /* An amount every period until the end date. */
  z.object({ kind: z.literal("recurring"), wallet: Address, delegatee: Address, amountRaw: Raw, period: z.enum(PERIOD_IDS as [string, ...string[]]), termSeconds: Term }),
  /* A merchant's plan, by its address: its terms are read from the chain and bound into the signature. */
  z.object({ kind: z.literal("subscribe"), wallet: Address, plan: Address }),
  /* One limit off: a fixed or recurring one closed at once; a subscription cancelled (or, once over, closed). */
  z.object({ kind: z.literal("revoke"), wallet: Address, delegation: Address }),
  /* Every limit and subscription on USDC at once: the token's approval revoked and its authority closed. */
  z.object({ kind: z.literal("stopAll"), wallet: Address }),
  /* The delegatee's side: take from a fixed or recurring USDC limit given to this wallet. */
  z.object({ kind: z.literal("spend"), wallet: Address, delegation: Address, amountRaw: Raw, to: Address }),
]);
export type AllowanceBuildRequest = z.output<typeof AllowanceBuildRequestSchema>;
export type AllowanceBuildKind = AllowanceBuildRequest["kind"];

export const AllowanceSubmitRequestSchema = z.object({
  buildId: z.string().regex(/^[0-9a-f]{32}$/),
  wallet: Address,
  signedWireBase64: z.array(z.string().min(1).max(4_096)).length(1),
});
export type AllowanceSubmitRequest = z.output<typeof AllowanceSubmitRequestSchema>;

export type PlanView = Readonly<{
  address: string;
  merchant: string;
  planId: string;
  amountRaw: string;
  periodHours: string;
  /** 0 — the plan has no last date. */
  endTs: string;
  destinations: readonly string[];
  pullers: readonly string[];
}>;

/** What the bytes do, in the page's words — the page names each kind in both languages. */
export type AllowanceReview = Readonly<{
  kind: AllowanceBuildKind;
  asset: "USDC";
  /** A revoke's face: a fixed or recurring limit closed, a subscription cancelled, or one already over closed. */
  revokes: "limit" | "cancel" | "close" | null;
  /** The account the action makes or acts on. */
  delegation: string | null;
  /** Who may take (fixed, recurring); the merchant (subscribe); the delegator (spend). */
  counterparty: string | null;
  /** The limit's amount: in total (fixed), per period (recurring, subscribe), taken now (spend). */
  amountRaw: string | null;
  periodSeconds: number | null;
  /** The last moment anything can be taken; null — not a new limit. */
  endsAt: string | null;
  plan: PlanView | null;
  /** The token's authority is opened (its first limit) or its approval given back (another app had replaced it). */
  approves: "first" | "again" | null;
  /** Another delegate on the token account that this approval replaces: its own permission stops working. */
  replacesDelegate: string | null;
  /** Rent put down for the accounts opened; returned when they close. */
  rentLamports: string;
  /** Rent returned to its payer by the accounts this closes. */
  refundLamports: string;
  /** Stop-all: how many limits stop with it; cancel: what the merchant may still take, and until when. */
  stops: number | null;
  grace: Readonly<{ raw: string; until: string }> | null;
  /** Cancel: what the merchant may still take could not be read — said so, never as nothing. */
  graceUnknown: boolean;
  /** Stop-all: another app's approval on the USDC account, which the program does not touch — it stays. */
  remainsDelegate: string | null;
  /** Stop-all on a frozen or missing USDC account: the authority is closed alone; the approval itself is untouched. */
  closesOnly: boolean;
  /** Spend: where the money goes, and whether its USDC account is opened by the wallet. */
  to: string | null;
  opensTokenAccount: boolean;
}>;

export type AllowanceBuildResponse = Readonly<{
  buildId: string;
  network: AllowanceChain;
  unsignedWireBase64: readonly string[];
  networkCostLamports: string;
  signableMs: number;
  expiresAt: string;
  review: AllowanceReview;
}>;

export type AllowanceSubmitResponse = Readonly<{
  /** CONFIRMED — landed; PENDING — sent, not confirmed in time (the page reads the chain again, nothing is sent twice). */
  state: "CONFIRMED" | "PENDING";
  signature: string;
  kind: AllowanceBuildKind;
  delegation: string | null;
  at: string;
}>;

/**
 * A sent build's word from the chain, read again after a PENDING or a lost answer (`GET …/submit?build=&wallet=`):
 * - CONFIRMED — landed;
 * - FAILED — landed and refused by the program: nothing was changed;
 * - NOT_LANDED — never on the chain and never can be (its blockhash passed, or it was never sent and its build expired):
 *   nothing was changed, it may be prepared again;
 * - PENDING — not known yet: read again, never prepare again until it is final.
 */
export type AllowanceSentState = "CONFIRMED" | "FAILED" | "NOT_LANDED" | "PENDING";

export type AllowanceSendStatus = Readonly<{ state: AllowanceSentState; signature: string | null; kind: AllowanceBuildKind; delegation: string | null; at: string }>;

export const AllowanceSendStatusQuerySchema = z.object({ build: z.string().regex(/^[0-9a-f]{32}$/), wallet: Address });

export type AllowanceRow = Readonly<{
  address: string;
  kind: AllowanceKind;
  /** USDC, or a token this page does not name: its amounts in raw units with the mint said. */
  asset: "USDC" | "OTHER";
  mint: string | null;
  decimals: number | null;
  delegator: string;
  /** Who may take: the delegatee; for a subscription, the plan's merchant (null when the plan could not be read). */
  delegatee: string | null;
  plan: string | null;
  /** Fixed: what is left in total; recurring and subscription: per period. */
  amountRaw: string;
  /** Fixed: the amount given at creation, read from the chain; null — not read (then «spent» is not said). */
  originalRaw: string | null;
  /** Fixed: taken in total (null when the original was not read); recurring, subscription: taken this period. */
  spentRaw: string | null;
  availableRaw: string | null;
  periodSeconds: number | null;
  periodEndsAt: string | null;
  endsAt: string;
  status: AllowanceStatus;
  /** Blocked: why — said in its own words; null otherwise. */
  blockedBy: BlockedBy | null;
  /** The delegator's actions on their own limit; the delegatee's is «spend». */
  actions: readonly ("revoke" | "cancel" | "close" | "spend")[];
}>;

export type AllowanceState = Readonly<{
  network: AllowanceChain;
  wallet: string;
  usdc: Readonly<{
    mint: string;
    tokenAccount: string;
    /** Null — not read; absent account is "0" with `hasAccount` false. */
    balanceRaw: string | null;
    hasAccount: boolean | null;
    /** The token account's delegate: the authority (as it should be), another program, or none. */
    delegate: string | null;
    /** What the approval still allows, in base units; null — not read or no account. */
    delegatedRaw: string | null;
    /** Null — not read or no account. */
    frozen: boolean | null;
    authority: string;
    /** Null — not read. */
    authorityOpen: boolean | null;
  }>;
  /** Limits this wallet gave. */
  given: readonly AllowanceRow[];
  /** Limits given to this wallet. */
  received: readonly AllowanceRow[];
  /** The node refused the scan: «not read», never «none». */
  givenUnread: boolean;
  receivedUnread: boolean;
  readAt: string;
}>;

export type AllowanceInfo = Readonly<{ network: AllowanceChain; program: string; usdcMint: string }>;

export type AllowanceFailureBody = Readonly<{ error: Readonly<{ code: string; message: string; issues?: readonly AllowanceIssue[] }> }>;
