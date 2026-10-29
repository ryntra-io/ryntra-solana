/**
 * The treasury's routes (SOL-4): what the page asks for and what it is answered. Amounts travel as raw base units in
 * decimal strings, never as numbers; addresses as base58. The server checks every request again against the rules of
 * `model.ts` — the page's own checks are for the person, these are for the bytes.
 */

import { z } from "zod";

import { MAX_DESTINATIONS, MAX_MEMBERS, MAX_PAYOUTS, MAX_SPENDERS, MAX_TIME_LOCK_S, PERIODS, TREASURY_ASSET_IDS } from "./model.ts";

const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "not an address");
const U64_MAX = 18_446_744_073_709_551_615n;
const Raw = z
  .string()
  .regex(/^[1-9]\d{0,19}$/, "not a raw amount")
  .refine((value) => BigInt(value) <= U64_MAX, "over the largest amount a token holds");
const unique = (list: readonly string[]) => new Set(list).size === list.length;
const Index = z.string().regex(/^[1-9]\d{0,19}$/, "not a transaction index");
const Asset = z.enum(TREASURY_ASSET_IDS);

export const MemberSchema = z.object({ address: Address, initiate: z.boolean(), vote: z.boolean(), execute: z.boolean() });

const ConfigChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addLimit"),
    asset: Asset,
    amountRaw: Raw,
    period: z.enum(PERIODS),
    spenders: z.array(Address).min(1).max(MAX_SPENDERS).refine(unique, "a spender is named twice"),
    destinations: z.array(Address).min(1).max(MAX_DESTINATIONS).refine(unique, "an address is named twice"),
  }),
  z.object({ type: z.literal("removeLimit"), limit: Address }),
  z.object({ type: z.literal("addMember"), member: MemberSchema }),
  z.object({ type: z.literal("removeMember"), address: Address }),
  z.object({ type: z.literal("threshold"), threshold: z.number().int().min(1).max(MAX_MEMBERS) }),
  z.object({ type: z.literal("timeLock"), seconds: z.number().int().min(0).max(MAX_TIME_LOCK_S) }),
]);
export type ConfigChange = z.output<typeof ConfigChangeSchema>;

/** The bytes' format: v1 (SIMD-0385) for a wallet that signs it — Phantom asks a dApp for v1 — legacy otherwise. */
const Format = { format: z.enum(["legacy", "v1"]).optional() };

export const TreasuryBuildRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    ...Format,
    kind: z.literal("create"),
    wallet: Address,
    /* The new multisig's one-time seed key, made in the person's browser: its public half only. The wallet signs first,
       the browser signs with this key after — no server ever holds it. Required; optional in the type for the forms. */
    createKey: Address.optional(),
    members: z.array(MemberSchema).min(1).max(MAX_MEMBERS),
    threshold: z.number().int().min(1).max(MAX_MEMBERS),
    timeLockSeconds: z.number().int().min(0).max(MAX_TIME_LOCK_S),
  }),
  z.object({
    ...Format,
    kind: z.literal("createAgent"),
    wallet: Address,
    createKey: Address.optional(),
    agent: Address,
    timeLockSeconds: z.number().int().min(0).max(MAX_TIME_LOCK_S),
    asset: Asset,
    amountRaw: Raw,
    period: z.enum(PERIODS),
    destinations: z.array(Address).min(1).max(MAX_DESTINATIONS).refine(unique, "an address is named twice"),
  }),
  z.object({
    ...Format,
    kind: z.literal("payouts"),
    wallet: Address,
    multisig: Address,
    asset: Asset,
    payouts: z.array(z.object({ to: Address, amountRaw: Raw })).min(1).max(MAX_PAYOUTS),
  }),
  z.object({ ...Format, kind: z.literal("config"), wallet: Address, multisig: Address, change: ConfigChangeSchema }),
  z.object({ ...Format, kind: z.literal("vote"), wallet: Address, multisig: Address, index: Index, vote: z.enum(["approve", "reject", "cancel"]) }),
  z.object({ ...Format, kind: z.literal("execute"), wallet: Address, multisig: Address, index: Index }),
  z.object({ ...Format, kind: z.literal("spend"), wallet: Address, multisig: Address, limit: Address, amountRaw: Raw, to: Address }),
  /* A top-up: the wallet sends to the treasury's vault — the one action whose money leaves the wallet, not the vault. */
  z.object({ ...Format, kind: z.literal("deposit"), wallet: Address, multisig: Address, asset: Asset, amountRaw: Raw }),
  /* SOL-L1d: the partner's share of Ryntra's launches claimed into the vault — one proposal, every claim waiting now. */
  z.object({ ...Format, kind: z.literal("launchClaims"), wallet: Address, multisig: Address }),
]);
export type TreasuryBuildRequest = z.output<typeof TreasuryBuildRequestSchema>;
export type TreasuryBuildKind = TreasuryBuildRequest["kind"];

export const TreasurySubmitRequestSchema = z.object({
  buildId: z.string().regex(/^[0-9a-f]{32}$/),
  wallet: Address,
  signedWireBase64: z.array(z.string().min(1).max(4_096)).min(1).max(MAX_PAYOUTS + 2),
});
export type TreasurySubmitRequest = z.output<typeof TreasurySubmitRequestSchema>;

/** One line of the Review: what the bytes do, in the page's words — the page names each kind in both languages. */
export type TreasuryReview = Readonly<{
  kind: TreasuryBuildKind;
  multisig: string;
  vault: string;
  /** The proposal's number when the build creates or acts on one. */
  index: string | null;
  /** Money that leaves the vault, by asset; empty for a build that moves none. */
  outflow: readonly Readonly<{ asset: "SOL" | "USDC"; raw: string; recipients: number }>[];
  /** What the multisig's own rules become, for a create or a config change. */
  rules: Readonly<{ threshold: number; voters: number; members: number; timeLockSeconds: number }> | null;
  /** Squads' fee for a new multisig (0 when Squads asks none) — the program's, never Ryntra's. */
  creationFeeLamports: string | null;
  /** Rent the wallet puts down for the accounts the build opens; returned to the multisig's rent collector on close. */
  rentLamports: string;
  /** The person also votes «for» in the same signature (an initiator who is a voter). */
  alsoApproves: boolean;
  /** How many recipients get a USDC account opened (by the vault at a payout's execution, by the wallet on a spend). */
  newTokenAccounts: number;
  /**
   * What the vault lacks today for this to run. For a proposal it is said, not refused (a proposal may wait for its
   * funding); for an execution or a spend it blocks the signature (`blockedBy`).
   */
  shortfall: readonly Readonly<{ asset: "SOL" | "USDC"; raw: string }>[];
  /** What the wallet lacks for this: the network, the rent it puts down, a top-up's amount — and SOL left rent-exempt. */
  walletShortfall: readonly Readonly<{ asset: "SOL" | "USDC"; raw: string }>[];
  /** Why the wallet should not sign it now: the transaction would be refused for want of money. */
  blockedBy: "wallet" | "vault" | null;
  /** A top-up's treasury with someone holding its config authority: that key changes its rules without a vote. */
  configAuthority: string | null;
  /** Where a proposal's account rent goes once closed: the vault, another collector, or nowhere (no collector). */
  rentTo: "vault" | "collector" | "kept" | null;
  /** Who receives: a spend's address, a batch's recipients (their wallets, where their USDC accounts name them). */
  to: readonly string[];
  /** What a change of the rules does, for its proposal, its votes and its execution. */
  changes: readonly ConfigChangeView[] | null;
  /** SOL the vault itself puts down for the USDC accounts it opens for recipients. */
  vaultRentLamports: string;
  /** A top-up's treasury: whether this wallet votes, and whether the others' votes alone move the money. */
  control: Readonly<{ youVote: boolean; othersAlone: boolean }> | null;
  /**
   * The launch fees a proposal claims into the vault (SOL-L1d) — nothing leaves the vault: how many claims of each
   * source, over how many launches and lines, and, when it is proposed, what the sources hold now by currency (the
   * claims take all they hold when they run). Null for any other build.
   */
  claims: TreasuryClaimsView | null;
}>;

export type TreasuryClaimsView = Readonly<{
  claims: number;
  launches: number;
  lines: number;
  bySource: readonly Readonly<{ source: "curve" | "migration" | "surplus" | "lp"; count: number }>[];
  /** What the sources hold now, by currency; empty for a vote or an execution, which take whatever they hold then. */
  holding: readonly Readonly<{ mint: string; symbol: string; decimals: number; raw: string }>[];
  /** Launches whose fees could not be read whole now: claimed in a later proposal. */
  unread: number;
  /** A proposal: launches it has no room for — the next proposal takes them first. An execution: lines left for the next press. */
  later: number;
  /** The vault's token accounts the proposer opens for claims to land in. */
  opens: number;
}>;

export type TreasuryBuildResponse = Readonly<{
  buildId: string;
  network: "solana:devnet" | "solana:mainnet";
  unsignedWireBase64: readonly string[];
  networkCostLamports: string;
  signableMs: number;
  expiresAt: string;
  review: TreasuryReview;
}>;

export type TreasurySubmitResponse = Readonly<{
  /** CONFIRMED — every transaction landed; PENDING — sent, not confirmed in time; PARTIAL — a part did not land. */
  state: "CONFIRMED" | "PENDING" | "PARTIAL";
  signatures: readonly string[];
  pending: readonly string[];
  /** `code` — what the refusal means, in the page's words; `reason` — the network's own text, for the disclosure. */
  failed: readonly Readonly<{ signature: string; code: string; reason: string }>[];
  kind: TreasuryBuildKind;
  multisig: string;
  index: string | null;
  at: string;
}>;

export type TreasuryMember = Readonly<{ address: string; initiate: boolean; vote: boolean; execute: boolean }>;

export type TreasuryProposal = Readonly<{
  index: string;
  /**
   * What it carries: a batch of payouts, a batch of launch-fee claims into the vault (SOL-L1d), a change of the rules,
   * a transaction made elsewhere (Squads' own app).
   */
  type: "payouts" | "claims" | "config" | "vault" | "unknown";
  state: "draft" | "active" | "approved" | "rejected" | "executing" | "executed" | "cancelled" | "stale" | "none";
  /** When the state was set, seconds; the approval's time is what the delay counts from. */
  stateAt: number | null;
  approved: readonly string[];
  rejected: readonly string[];
  cancelled: readonly string[];
  executableAt: number | null;
  /** `count` — payouts (lines); `done` and `items` — the batch's transactions run and in all. */
  payouts: Readonly<{ count: number; done: number; items: number; sums: readonly Readonly<{ asset: "SOL" | "USDC" | "OTHER"; raw: string }>[] }> | null;
  changes: readonly ConfigChangeView[] | null;
  /** A batch of claims: how many, over how many launches, and the batch's transactions run and in all. */
  claims: Readonly<{ count: number; launches: number; done: number; items: number }> | null;
  /** This page shows all it does (its own payouts and changes); otherwise it gets no «for» and no «execute» here. */
  readable: boolean;
}>;

export type ConfigChangeView =
  | Readonly<{ type: "addMember"; member: TreasuryMember }>
  | Readonly<{ type: "removeMember"; address: string }>
  | Readonly<{ type: "threshold"; threshold: number }>
  | Readonly<{ type: "timeLock"; seconds: number }>
  | Readonly<{ type: "addLimit"; limit: string; asset: "SOL" | "USDC" | "OTHER"; amountRaw: string; period: string; spenders: readonly string[]; destinations: readonly string[]; mint?: string; vaultIndex?: number }>
  | Readonly<{ type: "removeLimit"; limit: string }>
  | Readonly<{ type: "rentCollector"; address: string | null }>;

export type TreasuryLimit = Readonly<{
  address: string;
  asset: "SOL" | "USDC" | "OTHER";
  mint: string;
  amountRaw: string;
  remainingRaw: string;
  period: "once" | "day" | "week" | "month" | null;
  lastReset: number;
  /** The vault it spends from: only vault 0 is this page's; another is listed, never spent from here. */
  vaultIndex: number;
  spenders: readonly string[];
  /** Never empty for a limit made here; an empty list read from the chain means «anywhere» and is said so. */
  destinations: readonly string[];
}>;

export type TreasuryState = Readonly<{
  network: "solana:devnet" | "solana:mainnet";
  multisig: string;
  vault: string;
  /** True when nobody holds the config authority: every change is a vote. Ryntra never holds it. */
  autonomous: boolean;
  configAuthority: string | null;
  threshold: number;
  timeLockSeconds: number;
  transactionIndex: string;
  staleTransactionIndex: string;
  members: readonly TreasuryMember[];
  balances: Readonly<{ solRaw: string; usdcRaw: string | null }>;
  proposals: readonly TreasuryProposal[];
  limits: readonly TreasuryLimit[];
  /** Spending limits could not be read: the node did not answer. Not «none». */
  limitsUnread: boolean;
  /**
   * The limits shown are those the rules' history names, and that history cannot vouch for all: a node that refuses
   * the program scan, with a change of the rules closed, a history longer than is read, or a config authority.
   */
  limitsPartial: boolean;
  /** This vault is the fee claimer of Ryntra's launches on this network (SOL-L1d): its members may claim them here. */
  launchFeeClaimer: boolean;
  readAt: string;
}>;

export type TreasuryInfo = Readonly<{
  network: "solana:devnet" | "solana:mainnet";
  creationFeeLamports: string | null;
  usdcMint: string;
}>;
