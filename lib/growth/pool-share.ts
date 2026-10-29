import { z } from "zod";

import { splitClaim } from "../core/launch/budget.ts";
import { canonicalJson } from "../guard/canonical-json.ts";
import { REWARD_PAR_MINTS, usdMicrosOf } from "../rewards/model.ts";

/**
 * The pool-share journal: what Ryntra actually took out of each launch pool.
 *
 * ## Why a journal of its own
 *
 * The creator-partner programme pays a share of *Ryntra's received part* of one
 * launch pool. Nothing in the product records that part per pool: the Squads
 * safe that claims the Classic and Protected configs keeps no ledger of its
 * claims, the executor's budget ledger keeps Micro's claims per token, and on
 * the EVM launch network one claim pays out a credit every pool of the hook
 * adds to. This module is the one place where a claim becomes a row: one
 * network, one pool (or one claim split over pools), one source, one
 * transaction, one amount — written once and never changed.
 *
 * ## The two streams, side by side
 *
 * A trade on a launch curve made through Ryntra earns cashback from the
 * partner's part of the curve fee (`METEORA_LAUNCH`) once the rewards rules
 * count that mechanism. That is the same money a claim later takes out of the
 * pool. So beside every pool's claims the journal keeps the stream-1 rewards
 * accrued on trades of the same pool — one row per operation — and the
 * partner's base is the difference. The journal computes neither the base nor
 * any partner's share; it only carries both sums.
 *
 * ## What counts as received
 *
 * - **Classic, Protected (and Community, once its config exists)** — everything
 *   the config's fee claimer (the Squads safe) claims: the curve's trading fee,
 *   the migration fee, the surplus, and the locked position's fees in DAMM v2.
 * - **Micro** — only `revenueRaw` of `splitClaim` (three quarters of the curve's
 *   trading fee and of the position's fees). The migration fee and the surplus
 *   go to the market's budget, so their rows say claimed X, received 0.
 * - **The demo market** and any config without a row in the attribution registry
 *   — nothing: their claims are skipped with a reason, never written.
 * - **A hook's claim** (source `hook`) — one row per claim event, its amount
 *   split over the pools whose swaps credited it (`allocation`); the reader
 *   that builds those rows lives with its network's code, outside this module.
 *
 * ## What is never written
 *
 * A row is a debt's base, so a missing number is never a zero: a claim whose
 * amount could not be read is not written (the next read writes it), a claim
 * not yet finalized is not written (a reorganisation cannot leave a row behind),
 * and a pair asset that is not a dollar and has no price at the claim's moment
 * is written with no dollar figure — `UNVALUED`, shown as "no data".
 */

export const POOL_SHARE_COLLECTION = "growthPoolShares" as const;

export const POOL_SHARE_NETWORKS = ["solana", "arc"] as const;
export type PoolShareNetwork = (typeof POOL_SHARE_NETWORKS)[number];

export const POOL_SHARE_SOURCES = ["curve", "migration", "surplus", "lp", "hook"] as const;
export type PoolShareSource = (typeof POOL_SHARE_SOURCES)[number];
export type SolanaSource = Exclude<PoolShareSource, "hook">;

/** How a claim's received part was derived from what was claimed. */
export const POOL_SHARE_RULES = ["ALL", "MICRO_REVENUE", "OLDEST_CREDIT"] as const;
export type PoolShareRule = (typeof POOL_SHARE_RULES)[number];

export const SOLANA_CHAIN = "solana:mainnet" as const;
/** CAIP-2 of each network the journal knows. */
export const POOL_SHARE_CHAINS: Readonly<Record<PoolShareNetwork, string>> = { solana: SOLANA_CHAIN, arc: "eip155:5042" };

/** The dollar tokens of an EVM network the journal counts at par, by lower-case address. */
export const EVM_PAR_ASSETS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  /* The network's USDC, its native dollar's ERC-20 face — 6 decimals. */
  "eip155:5042": { "0x3600000000000000000000000000000000000000": 6 },
};

const RAW = /^(?:0|[1-9][0-9]*)$/;
const SIGNED = /^-?(?:0|[1-9][0-9]*)$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const AT = z.string().datetime({ offset: true });

/* ------------------------------------------------------------------------------------------------
 * Rows
 * --------------------------------------------------------------------------------------------- */

export const PoolShareValuationSchema = z
  .object({
    basis: z.enum(["STABLECOIN_PAR", "PRICED_AT_SETTLEMENT", "UNVALUED"]),
    price: z.string().regex(DECIMAL).nullable(),
    sourceRef: z.string().min(1).max(200).nullable(),
    observedAt: AT.nullable(),
  })
  .strict();
export type PoolShareValuation = z.output<typeof PoolShareValuationSchema>;

export const PoolShareSliceSchema = z
  .object({
    /** The pool this part of the claim is credited to; null — the part no recorded credit accounts for. */
    pool: z.string().min(1).max(80).nullable(),
    creator: z.string().min(1).max(80).nullable(),
    receivedRaw: z.string().regex(RAW),
    usdMicros: z.string().regex(RAW).nullable(),
  })
  .strict();
export type PoolShareSlice = z.output<typeof PoolShareSliceSchema>;

export const PoolShareClaimSchema = z
  .object({
    kind: z.literal("CLAIM"),
    schema: z.literal(1),
    network: z.enum(POOL_SHARE_NETWORKS),
    chain: z.string().regex(/^[a-z0-9]+:[A-Za-z0-9-]+$/),
    /** The launch pool: the DBC curve on Solana. Null for a claim split over pools — see `allocation`. */
    pool: z.string().min(1).max(80).nullable(),
    /** Where the fee was claimed when that is not the launch pool itself: the graduated DAMM v2 pool of an `lp` claim. */
    venuePool: z.string().min(1).max(80).nullable(),
    /** The DBC config on Solana, the launch factory on an EVM network. */
    config: z.string().min(1).max(80),
    creator: z.string().min(1).max(80).nullable(),
    source: z.enum(POOL_SHARE_SOURCES),
    claimer: z.string().min(1).max(80),
    claim: z
      .object({
        tx: z.string().min(1).max(120),
        /** Solana: the instruction's place, `outer` or `outer.inner`. EVM: the log index. */
        index: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/),
        /** Solana slot or EVM block. */
        block: z.number().int().nonnegative(),
        at: AT,
        finality: z.literal("finalized"),
      })
      .strict(),
    asset: z.object({ mint: z.string().min(1).max(80), symbol: z.string().min(1).max(40).nullable(), decimals: z.number().int().min(0).max(24) }).strict(),
    /** What the instruction or event moved, in the pair asset. */
    claimedRaw: z.string().regex(RAW),
    /** Ryntra's received part of it, in the pair asset. */
    receivedRaw: z.string().regex(RAW),
    /** The launch token's side of the same claim, Ryntra's part, never valued. Null where there is none. */
    tokenRaw: z.string().regex(RAW).nullable(),
    rule: z.enum(POOL_SHARE_RULES),
    /** `receivedRaw` in USD micro-units; null when the pair asset had no price at the claim's moment. */
    usdMicros: z.string().regex(RAW).nullable(),
    valuation: PoolShareValuationSchema,
    /** A claim that pays out several pools' credit at once: its parts, which add up to `receivedRaw`. Null — one pool, `pool`. */
    allocation: z.array(PoolShareSliceSchema).min(1).nullable(),
    recordedAt: AT,
  })
  .strict()
  .superRefine((row, context) => {
    if (BigInt(row.receivedRaw) > BigInt(row.claimedRaw)) context.addIssue({ code: "custom", message: "Ryntra cannot receive more than was claimed" });
    if ((row.pool === null) === (row.allocation === null)) context.addIssue({ code: "custom", message: "a claim names one pool or carries an allocation, never both or neither" });
    if (row.allocation && row.allocation.reduce((sum, slice) => sum + BigInt(slice.receivedRaw), 0n).toString() !== row.receivedRaw) {
      context.addIssue({ code: "custom", message: "the allocation does not add up to the received amount" });
    }
  });
export type PoolShareClaim = z.output<typeof PoolShareClaimSchema>;

export const PoolShareStream1Schema = z
  .object({
    kind: z.literal("STREAM1"),
    schema: z.literal(1),
    network: z.literal("solana"),
    chain: z.literal("solana:mainnet"),
    pool: z.string().min(1).max(80),
    config: z.string().min(1).max(80),
    /**
     * Where the trade ran: on the curve, Ryntra's base is the partner's part of the curve fee — the money a `curve`
     * claim later takes out — plus Meteora's referral; in the graduated pool it is the referral alone, which no claim
     * of the pool ever carries. The difference is taken against the matching claims, not all of them.
     */
    venue: z.enum(["curve", "pool"]),
    /** The trade's signature — the reward accrual's operation reference. */
    operationRef: z.string().min(1).max(200),
    trader: z.string().min(32).max(64),
    /** How many reward entries the operation accrued (cashback, level 1, level 2). */
    entries: z.number().int().nonnegative(),
    /** Their sum, USD micro-units. Written only once every entry has a dollar figure. */
    usdMicros: z.string().regex(SIGNED),
    settledAt: AT,
    recordedAt: AT,
  })
  .strict();
export type PoolShareStream1 = z.output<typeof PoolShareStream1Schema>;

export const PoolShareRowSchema = z.union([PoolShareClaimSchema, PoolShareStream1Schema]);
export type PoolShareRow = PoolShareClaim | PoolShareStream1;

/** One pool's rows, for `valuesWithPrefix`. */
export function poolSharePrefix(network: PoolShareNetwork, pool: string): string {
  return `${network}:${pool}:`;
}

/** Every claim split over pools on a network, for `valuesWithPrefix`. */
export function pooledClaimPrefix(network: PoolShareNetwork): string {
  return `${network}:pooled:`;
}

/**
 * The row's key — the whole of the duplicate defence.
 *
 * Solana: signature and instruction place (the pool before them is fixed by the
 * instruction itself); an EVM hook claim: hash and log index, whatever its
 * split. Reading the same claim again yields the same key, and
 * `insertIfAbsent` writes nothing.
 */
export function poolShareKey(row: PoolShareRow): string {
  if (row.kind === "STREAM1") return `${poolSharePrefix("solana", row.pool)}stream1:${row.operationRef}`;
  const prefix = row.pool === null ? pooledClaimPrefix(row.network) : poolSharePrefix(row.network, row.pool);
  return `${prefix}claim:${row.claim.tx}:${row.claim.index}`;
}

/**
 * A row as its facts, for comparing a repeated write with the stored one: key
 * order does not matter (the database keeps `jsonb`), and neither do when it
 * was written or the dollar figure — a price read later may differ, while the
 * claim, its pool and its amounts may not.
 */
export function poolShareContent(row: PoolShareRow): string {
  const { recordedAt: _recordedAt, ...rest } = row;
  if (rest.kind === "STREAM1") return canonicalJson(rest);
  const { usdMicros: _usd, valuation: _valuation, allocation, ...facts } = rest;
  return canonicalJson({ ...facts, allocation: allocation?.map(({ usdMicros: _part, ...slice }) => slice) ?? null });
}

/* ------------------------------------------------------------------------------------------------
 * Valuation
 * --------------------------------------------------------------------------------------------- */

export type PriceAt = Readonly<{ price: string; sourceRef: string; observedAt: string }>;

/** The longest a price may stand from the claim it values — the rewards core's rule for a price at settlement. */
export const PRICE_WINDOW_MS = 5 * 60_000;

/** True when this exact asset is a dollar the journal counts at par. */
export function isParAsset(network: PoolShareNetwork, mint: string, decimals: number): boolean {
  if (network === "solana") return REWARD_PAR_MINTS[mint] === decimals;
  return EVM_PAR_ASSETS[POOL_SHARE_CHAINS[network]]?.[mint.toLowerCase()] === decimals;
}

/**
 * A received amount in dollars, at par or at a price read within five minutes
 * of the claim — otherwise unvalued, never guessed.
 */
export function valueReceived(args: Readonly<{ network: PoolShareNetwork; mint: string; decimals: number; raw: bigint; at: string; price: PriceAt | null }>): Readonly<{ usdMicros: string | null; valuation: PoolShareValuation }> {
  if (isParAsset(args.network, args.mint, args.decimals)) {
    return { usdMicros: args.raw.toString(), valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null } };
  }
  const price = args.price;
  if (price && DECIMAL.test(price.price) && Math.abs(Date.parse(price.observedAt) - Date.parse(args.at)) <= PRICE_WINDOW_MS) {
    try {
      const usd = usdMicrosOf({ raw: args.raw, decimals: args.decimals, price: price.price });
      return { usdMicros: usd.toString(), valuation: { basis: "PRICED_AT_SETTLEMENT", price: price.price, sourceRef: price.sourceRef, observedAt: price.observedAt } };
    } catch {
      /* A zero or malformed price values nothing. */
    }
  }
  return { usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } };
}

/* ------------------------------------------------------------------------------------------------
 * Which configs count — from the attribution registry
 * --------------------------------------------------------------------------------------------- */

/** The registry row fields this module reads; `/api/stats/registry` rows and `lib/attribution/registry.ts` rows both fit. */
export type RegistryRowLike = Readonly<{
  id: string;
  network: string;
  role: string;
  kind: string;
  parent: string | null;
  address: string | null;
  technicalValidation?: true;
  countedAs?: string;
}>;

export type LaunchConfigPlan = Readonly<{
  id: string;
  config: string;
  claimer: string;
  /** `ALL` — the claimer is Ryntra's own; `MICRO_REVENUE` — the executor, Ryntra keeps `splitClaim`'s revenue. */
  rule: "ALL" | "MICRO_REVENUE";
}>;

export type LaunchConfigPlans = Readonly<{
  counted: ReadonlyMap<string, LaunchConfigPlan>;
  /** Configs in the registry that count nothing (the demo market), by address, with why. */
  skipped: ReadonlyMap<string, string>;
  /** Every claimer a counted config names — the addresses whose claims are read. */
  claimers: readonly string[];
}>;

/**
 * The Solana launch configs whose claims are Ryntra's, and who claims each.
 *
 * A config with no parent is claimed by the registry's launch fee claimer; a
 * config whose parent is the launch executor is the executor's, and only
 * `splitClaim`'s revenue of it is Ryntra's. A config marked as technical
 * validation counts nothing. A row the registry has closed still counts: a
 * config's pools keep earning, and its claimer is fixed in the config on the
 * chain.
 */
export function launchConfigPlans(rows: readonly RegistryRowLike[]): LaunchConfigPlans {
  const solana = rows.filter((row) => row.network === "solana" && row.address);
  const byId = new Map(solana.map((row) => [row.id, row]));
  const feeClaimers = solana.filter((row) => row.role === "LAUNCH_FEE_CLAIMER");
  const counted = new Map<string, LaunchConfigPlan>();
  const skipped = new Map<string, string>();
  for (const row of solana.filter((entry) => entry.role === "LAUNCH_CONFIG")) {
    const config = row.address!;
    if (row.technicalValidation || (row.countedAs !== undefined && row.countedAs !== "FEES")) {
      skipped.set(config, "the demo market — Ryntra's technical validation counts nothing");
      continue;
    }
    const parent = row.parent ? byId.get(row.parent) : null;
    if (row.parent && !parent) {
      skipped.set(config, `its claimer ${row.parent} has no row in the registry`);
      continue;
    }
    if (parent) {
      if (parent.kind !== "LAUNCH_EXECUTOR") {
        skipped.set(config, `its claimer ${parent.id} is not the launch executor`);
        continue;
      }
      counted.set(config, { id: row.id, config, claimer: parent.address!, rule: "MICRO_REVENUE" });
    } else if (feeClaimers.length === 1) {
      counted.set(config, { id: row.id, config, claimer: feeClaimers[0]!.address!, rule: "ALL" });
    } else {
      skipped.set(config, feeClaimers.length ? "the registry names more than one launch fee claimer for a config without a parent" : "the registry names no launch fee claimer");
    }
  }
  return { counted, skipped, claimers: [...new Set([...counted.values()].map((plan) => plan.claimer))] };
}

/** Ryntra's received part of one claim under a config's rule. */
export function receivedOf(rule: "ALL" | "MICRO_REVENUE", source: SolanaSource, raw: bigint): bigint {
  if (rule === "ALL") return raw;
  return splitClaim(source, raw).revenueRaw;
}

/* ------------------------------------------------------------------------------------------------
 * Solana: the claim instructions and their events
 * --------------------------------------------------------------------------------------------- */

export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
/** Anchor's event-CPI tag: an instruction whose data starts with it carries an event, not a call. */
export const EVENT_IX_TAG = "e445a52e51cb9a1d";

type ClaimLayout = Readonly<{
  program: string;
  name: string;
  source: SolanaSource;
  /** Account positions, from the programs' IDLs. */
  at: Readonly<{ config?: number; pool: number; claimer: number; baseMint?: number; quoteMint?: number; tokenAMint?: number; tokenBMint?: number; position?: number; destination: number }>;
  event: string;
}>;

/**
 * The partner's claim instructions, by their 8-byte discriminator (IDLs of
 * `@meteora-ag/dynamic-bonding-curve-sdk` and `cp-amm-sdk`). The partner's part
 * of a pool-creation fee (`claim_partner_pool_creation_fee`) is not here: every
 * Ryntra preset sets that fee to zero.
 */
export const CLAIM_LAYOUTS: Readonly<Record<string, ClaimLayout>> = {
  "08ec5931987db151": { program: DBC_PROGRAM, name: "claim_trading_fee", source: "curve", at: { config: 1, pool: 2, baseMint: 7, quoteMint: 8, claimer: 9, destination: 4 }, event: "1a5375f05cca70fe" },
  "54bf473209a237c1": { program: DBC_PROGRAM, name: "claim_trading_fee2", source: "curve", at: { config: 1, pool: 2, baseMint: 7, quoteMint: 8, claimer: 9, destination: 4 }, event: "1a5375f05cca70fe" },
  a8ad4864c962265c: { program: DBC_PROGRAM, name: "partner_withdraw_surplus", source: "surplus", at: { config: 1, pool: 2, quoteMint: 5, claimer: 6, destination: 3 }, event: "c3389809e8482316" },
  ed8e2d178106dea2: { program: DBC_PROGRAM, name: "withdraw_migration_fee", source: "migration", at: { config: 1, pool: 2, quoteMint: 5, claimer: 6, destination: 3 }, event: "1acb5455a11764d6" },
  b4269a118521a2d3: { program: DAMM_V2_PROGRAM, name: "claim_position_fee", source: "lp", at: { pool: 1, position: 2, tokenAMint: 7, tokenBMint: 8, claimer: 10, destination: 4 }, event: "c6b6b734610c3138" },
};

/** The fields of the events above this module reads. */
export const CLAIM_EVENTS: Readonly<Record<string, string>> = {
  "1a5375f05cca70fe": "EvtClaimTradingFee",
  c3389809e8482316: "EvtPartnerWithdrawSurplus",
  "1acb5455a11764d6": "EvtWithdrawMigrationFee",
  c6b6b734610c3138: "EvtClaimPositionFee",
};

/** An instruction as `getTransaction` in `jsonParsed` encoding gives an unparsed program's call. */
export type RawInstruction = Readonly<{ programId: string; accounts?: readonly string[]; data?: string; stackHeight?: number | null }>;

/** The part of a `getTransaction` (`jsonParsed`, finalized) answer this module reads. */
export type RawTransaction = Readonly<{
  slot: number;
  blockTime: number | null;
  meta: Readonly<{
    err: unknown;
    innerInstructions?: readonly Readonly<{ index: number; instructions: readonly RawInstruction[] }>[] | null;
    postTokenBalances?: readonly Readonly<{ accountIndex: number; mint: string; owner?: string }>[] | null;
  }> | null;
  transaction: Readonly<{ signatures: readonly string[]; message: Readonly<{ instructions: readonly RawInstruction[]; accountKeys?: readonly (string | Readonly<{ pubkey: string }>)[] }> }>;
}>;

/** One partner claim the transaction made, read from the instruction and its event. */
export type SolanaClaimFact = Readonly<{
  signature: string;
  index: string;
  slot: number;
  at: string | null;
  name: string;
  source: SolanaSource;
  program: string;
  /** DBC config named by the instruction; null for a DAMM v2 claim. */
  config: string | null;
  /** DBC curve, or the DAMM v2 pool of an `lp` claim. */
  pool: string;
  position: string | null;
  claimer: string;
  baseMint: string | null;
  quoteMint: string | null;
  /** The pair (quote) side the event reports; null when no event was found — "no data", never zero. */
  pairRaw: bigint | null;
  /** The launch token's side, where the claim has one. */
  tokenRaw: bigint | null;
  /** `withdraw_migration_fee`: 0 is the partner's, 1 the creator's. */
  flag: number | null;
  /** `claim_position_fee`: the position's owner the event names — must be the claimer. */
  owner: string | null;
  /** The token account the pair side was paid into, and its owner as the transaction's token balances state it. */
  destination: string | null;
  destinationOwner: string | null;
}>;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new Error("Not base58.");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = BASE58[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = "1" + text;
  }
  return text;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const u64 = (bytes: Uint8Array, offset: number) => Buffer.from(bytes.subarray(offset, offset + 8)).readBigUInt64LE(0);
const key = (bytes: Uint8Array, offset: number) => base58Encode(bytes.subarray(offset, offset + 32));

type DecodedEvent = Readonly<{ name: string; pool: string; pairRaw: bigint; tokenRaw: bigint | null; flag: number | null; position: string | null; owner: string | null }>;

/** An event-CPI instruction's payload, or null when it is not one of the claim events. */
export function decodeClaimEvent(data: Uint8Array): DecodedEvent | null {
  if (data.length < 16 || hex(data.subarray(0, 8)) !== EVENT_IX_TAG) return null;
  const body = data.subarray(16);
  switch (CLAIM_EVENTS[hex(data.subarray(8, 16))]) {
    case "EvtClaimTradingFee":
      return body.length < 48 ? null : { name: "EvtClaimTradingFee", pool: key(body, 0), tokenRaw: u64(body, 32), pairRaw: u64(body, 40), flag: null, position: null, owner: null };
    case "EvtPartnerWithdrawSurplus":
      return body.length < 40 ? null : { name: "EvtPartnerWithdrawSurplus", pool: key(body, 0), pairRaw: u64(body, 32), tokenRaw: null, flag: null, position: null, owner: null };
    case "EvtWithdrawMigrationFee":
      return body.length < 41 ? null : { name: "EvtWithdrawMigrationFee", pool: key(body, 0), pairRaw: u64(body, 32), tokenRaw: null, flag: body[40]!, position: null, owner: null };
    case "EvtClaimPositionFee":
      return body.length < 112 ? null : { name: "EvtClaimPositionFee", pool: key(body, 0), position: key(body, 32), owner: key(body, 64), tokenRaw: u64(body, 96), pairRaw: u64(body, 104), flag: null };
    default:
      return null;
  }
}

/**
 * Every partner claim a finalized transaction made by one of `claimers`.
 *
 * The instruction may be a direct call (the executor) or a CPI from a multisig
 * (the Squads safe), so both the outer and the inner instructions are read. Its
 * amount is the event the program emitted right after it, matched by program,
 * kind and pool — the instruction's own arguments are only ceilings. A claim
 * whose event is missing keeps `pairRaw: null`.
 *
 * For a DAMM v2 claim the pair is taken as token B and the launch token as
 * token A, as a migrated DBC pool lays them out.
 */
export function extractSolanaClaims(tx: RawTransaction, claimers: ReadonlySet<string>): SolanaClaimFact[] {
  if (!tx.meta || tx.meta.err !== null && tx.meta.err !== undefined) return [];
  const signature = tx.transaction.signatures[0] ?? "";
  const at = tx.blockTime === null ? null : new Date(tx.blockTime * 1000).toISOString();
  const inner = new Map((tx.meta.innerInstructions ?? []).map((group) => [group.index, group.instructions]));
  const keys = (tx.transaction.message.accountKeys ?? []).map((entry) => (typeof entry === "string" ? entry : entry.pubkey));
  const owners = new Map((tx.meta.postTokenBalances ?? []).filter((row) => row.owner && keys[row.accountIndex]).map((row) => [keys[row.accountIndex]!, row.owner!]));
  const facts: Array<{ fact: SolanaClaimFact; layout: ClaimLayout; filled: boolean }> = [];
  tx.transaction.message.instructions.forEach((outer, outerIndex) => {
    const sequence: Array<{ ix: RawInstruction; index: string }> = [{ ix: outer, index: String(outerIndex) }];
    (inner.get(outerIndex) ?? []).forEach((ix, innerIndex) => sequence.push({ ix, index: `${outerIndex}.${innerIndex}` }));
    for (const { ix, index } of sequence) {
      if ((ix.programId !== DBC_PROGRAM && ix.programId !== DAMM_V2_PROGRAM) || !ix.data) continue;
      let data: Uint8Array;
      try {
        data = base58Decode(ix.data);
      } catch {
        continue;
      }
      if (data.length < 8) continue;
      const event = decodeClaimEvent(data);
      if (event) {
        /* The newest claim of this program and kind on this pool still waiting for its amount. */
        const waiting = [...facts].reverse().find(({ fact, layout, filled }) => !filled && layout.program === ix.programId && CLAIM_EVENTS[layout.event] === event.name && fact.pool === event.pool);
        if (waiting) {
          waiting.filled = true;
          waiting.fact = { ...waiting.fact, pairRaw: event.pairRaw, tokenRaw: event.tokenRaw, flag: event.flag ?? waiting.fact.flag, owner: event.owner };
        }
        continue;
      }
      const layout = CLAIM_LAYOUTS[hex(data.subarray(0, 8))];
      if (!layout || layout.program !== ix.programId) continue;
      const accounts = ix.accounts ?? [];
      const claimer = accounts[layout.at.claimer];
      const pool = accounts[layout.at.pool];
      if (!claimer || !pool || !claimers.has(claimer)) continue;
      const lp = layout.source === "lp";
      facts.push({
        layout,
        filled: false,
        fact: {
          signature,
          index,
          slot: tx.slot,
          at,
          name: layout.name,
          source: layout.source,
          program: layout.program,
          config: layout.at.config === undefined ? null : accounts[layout.at.config] ?? null,
          pool,
          position: layout.at.position === undefined ? null : accounts[layout.at.position] ?? null,
          claimer,
          baseMint: (lp ? accounts[layout.at.tokenAMint!] : layout.at.baseMint === undefined ? null : accounts[layout.at.baseMint]) ?? null,
          quoteMint: (lp ? accounts[layout.at.tokenBMint!] : accounts[layout.at.quoteMint!]) ?? null,
          pairRaw: null,
          tokenRaw: null,
          flag: layout.name === "withdraw_migration_fee" && data.length > 8 ? data[8]! : null,
          owner: null,
          destination: accounts[layout.at.destination] ?? null,
          destinationOwner: owners.get(accounts[layout.at.destination] ?? "") ?? null,
        },
      });
    }
  });
  return facts.map(({ fact }) => fact);
}

/* ------------------------------------------------------------------------------------------------
 * Totals and the reconciliation
 * --------------------------------------------------------------------------------------------- */

export type PoolShareTotals = Readonly<{
  network: PoolShareNetwork;
  /** Null — the part of split claims no recorded credit accounts for. */
  pool: string | null;
  claims: number;
  /** Ryntra's received part, USD micros; null while any claim of the pool is unvalued — "no data", not zero. */
  receivedUsdMicros: string | null;
  /** The valued claims alone, so an unvalued one does not hide the rest. */
  valuedUsdMicros: string;
  unvaluedClaims: number;
  /** Stream 1 on the same pool's trades, USD micros; null while a trade of the pool (or one not yet traced to a pool) is pending. */
  stream1UsdMicros: string | null;
  stream1Operations: number;
  stream1Pending: number;
}>;

/** Stream-1 operations not in the journal yet, by pool; `pool: null` — one whose pool is not known yet, which leaves every pool's stream 1 open. */
export type Stream1PendingCount = Readonly<{ pool: string | null; count: number }>;

/** Both sums of every pool the rows name. The partner's base is taken from the difference elsewhere. */
export function poolShareTotals(rows: readonly PoolShareRow[], pending: readonly Stream1PendingCount[] = []): PoolShareTotals[] {
  type Total = { network: PoolShareNetwork; pool: string | null; claims: number; received: bigint; unvalued: number; stream1: bigint; operations: number };
  const pools = new Map<string, Total>();
  const of = (network: PoolShareNetwork, pool: string | null) => {
    const id = `${network}:${pool ?? ""}`;
    const total = pools.get(id) ?? { network, pool, claims: 0, received: 0n, unvalued: 0, stream1: 0n, operations: 0 };
    pools.set(id, total);
    return total;
  };
  for (const row of rows) {
    if (row.kind === "STREAM1") {
      const total = of(row.network, row.pool);
      total.operations += 1;
      total.stream1 += BigInt(row.usdMicros);
      continue;
    }
    const parts = row.allocation ?? [{ pool: row.pool, usdMicros: row.usdMicros }];
    for (const part of parts) {
      const total = of(row.network, part.pool);
      total.claims += 1;
      if (part.usdMicros === null) total.unvalued += 1;
      else total.received += BigInt(part.usdMicros);
    }
  }
  const pendingBy = new Map<string, number>();
  for (const item of pending) pendingBy.set(item.pool ?? "", (pendingBy.get(item.pool ?? "") ?? 0) + item.count);
  for (const item of pending) if (item.pool) of("solana", item.pool);
  const untraced = pendingBy.get("") ?? 0;
  return [...pools.values()].map((total) => {
    const stream1Pending = total.network === "solana" ? (pendingBy.get(total.pool ?? "\u0000") ?? 0) + untraced : 0;
    return {
      network: total.network,
      pool: total.pool,
      claims: total.claims,
      receivedUsdMicros: total.unvalued ? null : total.received.toString(),
      valuedUsdMicros: total.received.toString(),
      unvaluedClaims: total.unvalued,
      stream1UsdMicros: stream1Pending ? null : total.stream1.toString(),
      stream1Operations: total.operations,
      stream1Pending,
    };
  });
}

/** One claim as the chain shows it, for the reconciliation: what was claimed, keyed like the journal. */
export type ChainClaim = Readonly<{ network: PoolShareNetwork; tx: string; index: string; claimedRaw: string }>;

export type PoolShareReconciliation = Readonly<{
  ok: boolean;
  matched: number;
  /** On the chain, not in the journal. */
  missing: readonly ChainClaim[];
  /** In the journal, not on the chain. */
  extra: readonly Readonly<{ network: PoolShareNetwork; tx: string; index: string }>[];
  /** Same claim, different amount — or a split claim whose parts do not add up to it. */
  mismatched: readonly Readonly<{ network: PoolShareNetwork; tx: string; index: string; journal: string; chain: string }>[];
}>;

/**
 * "The journal equals the claims on the chain": every chain claim has its row,
 * every row its chain claim, with the same amount — and a split claim's parts
 * add up to it exactly.
 */
export function reconcilePoolShares(rows: readonly PoolShareRow[], chain: readonly ChainClaim[]): PoolShareReconciliation {
  const journal = new Map<string, PoolShareClaim>();
  for (const row of rows) if (row.kind === "CLAIM") journal.set(`${row.network}:${row.claim.tx}:${row.claim.index}`, row);
  const missing: ChainClaim[] = [];
  const mismatched: Array<{ network: PoolShareNetwork; tx: string; index: string; journal: string; chain: string }> = [];
  let matched = 0;
  const seen = new Set<string>();
  for (const claim of chain) {
    const id = `${claim.network}:${claim.tx}:${claim.index}`;
    seen.add(id);
    const row = journal.get(id);
    if (!row) {
      missing.push(claim);
      continue;
    }
    const parts = row.allocation ? row.allocation.reduce((sum, slice) => sum + BigInt(slice.receivedRaw), 0n).toString() : null;
    const split = row.rule === "OLDEST_CREDIT";
    if (row.claimedRaw !== claim.claimedRaw || (split && parts !== claim.claimedRaw)) {
      mismatched.push({ network: claim.network, tx: claim.tx, index: claim.index, journal: split ? parts ?? row.receivedRaw : row.claimedRaw, chain: claim.claimedRaw });
      continue;
    }
    matched += 1;
  }
  const extra = [...journal.entries()].filter(([id]) => !seen.has(id)).map(([, row]) => ({ network: row.network, tx: row.claim.tx, index: row.claim.index }));
  return { ok: !missing.length && !extra.length && !mismatched.length, matched, missing, extra, mismatched };
}
