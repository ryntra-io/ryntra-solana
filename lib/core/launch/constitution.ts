/**
 * Market Constitution v1 (MOS-1, spec §8.1–§8.3) — `ryntra.market-constitution/1`: one document per market of Ryntra
 * Launch that says, before a purchase, everything the market runs by — who issued it, the token and its authorities,
 * the curve, the move to the DEX, the locked liquidity, who receives which share of every fee, the market's budget, what
 * may be done on the market and by whom, within which bounds, when Ryntra's acts stop and restart, and its changelog.
 *
 * Every field carries who keeps it (`enforcement`) and where anyone can check it (`source`):
 * - `ONCHAIN_RULE` — a program enforces it: the token's mint, the curve's config, the creation transaction, a lock's
 *   escrow, a fee vault, or a constant of Meteora's program. Neither the creator nor Ryntra can change it;
 * - `SERVER_POLICY` — Ryntra's server runs it (its executor, its build of the launch): the numbers are the ones the
 *   server's code runs (`BUDGET_RULE`, `FLOOR_RULE`, the presets), and Ryntra can change them by a release;
 * - `INFORMATIONAL` — Ryntra's word about a fact (whose wallet an address is, where the document lives);
 * - `NOT_IMPLEMENTED` — the spec asks for it and nothing keeps it yet: said so, never left out.
 *
 * A value not known is `known: false` with the reason, never a zero; a value that is none is `known: true, value: null`
 * (the mint authority revoked, no lock). The document holds only what a launch fixed for ever and the policies that
 * govern it — never a figure of now (a balance, a price, the market's state): those move, and the hash would with them.
 * So the same market read twice gives the same bytes, and a policy changed by a release gives a new hash.
 *
 * The constitution promises no price: the ladder is liquidity that can run out, never a floor (spec §8.2).
 *
 * Pure and client-safe: the chain is read by `lib/launch/constitution.server.ts`; the hash is SHA-256 of
 * `constitutionCanonicalJson` — sorted keys, no spaces (`lib/guard/canonical-json.ts`) — so anyone can repeat it.
 */

import { canonicalJson } from "../../guard/canonical-json.ts";
import type { LaunchReceiptFacts } from "../venues/meteora-dbc/receipt.ts";
import { launchPreset } from "../venues/meteora-dbc/presets.ts";
import { FLOOR_RULE, OWNER_LADDER_PRESETS } from "./autopilot.ts";
import { BUDGET_LADDER, BUDGET_RULE } from "./budget.ts";
import { MARKET_CYCLE_STATES, MATURE_AFTER_SECONDS, type MarketCycleState } from "./market-health.ts";
import { METEORA_MIGRATION_LIQUIDITY_BPS, METEORA_PROTOCOL_PCT, METEORA_REFERRAL_OF_PROTOCOL_PCT } from "./preset-terms.ts";

export const MARKET_CONSTITUTION_SCHEMA = "ryntra.market-constitution/1";
export const MARKET_CONSTITUTION_VERSION = 1;
/**
 * The revision of Ryntra's policies this document states (`BUDGET_RULE`, `FLOOR_RULE`, the presets' rules of Ryntra's).
 * A release that changes one raises it, so a new hash says why it is new; the pinned hash in the test fails until then.
 */
export const MARKET_CONSTITUTION_POLICY_REVISION = 2;

/**
 * Why a field is not known, or why nothing keeps it yet — a code, so the hashed bytes hold no sentence that a rewording
 * would change; the page says each in words.
 */
export const CONSTITUTION_UNKNOWN = [
  "FIELD_MISSING",
  "NOT_EXPONENTIAL",
  "NOT_MARKET_CAP_EXPONENTIAL",
  "SLOT_ACTIVATION",
  "AMOUNTS_DO_NOT_ADD_UP",
  "BOUNDS_ONCHAIN_PHASE_2",
  "POLICY_CHANGES_NOT_JOURNALED",
  "NO_INCIDENT_CHANNEL",
  "NO_DISPUTE_CHANNEL",
  "HASH_NOT_ONCHAIN",
  "METADATA_FIXED_BEFORE",
] as const;
export type ConstitutionUnknown = (typeof CONSTITUTION_UNKNOWN)[number];

export const CONSTITUTION_ENFORCEMENT = ["ONCHAIN_RULE", "SERVER_POLICY", "INFORMATIONAL", "NOT_IMPLEMENTED"] as const;
export type ConstitutionEnforcement = (typeof CONSTITUTION_ENFORCEMENT)[number];

/** How a value reads: an address, raw amounts of the token or the pair, shares, times, counts, a flag, a code word. */
export const CONSTITUTION_UNITS = ["address", "token-raw", "quote-raw", "bps", "pct", "seconds", "lamports", "time", "count", "x100", "flag", "code", "list"] as const;
export type ConstitutionUnit = (typeof CONSTITUTION_UNITS)[number];

/**
 * Where a field is seen: an account and its field, a transaction, a constant of a program, the server's code (its module
 * and constant), or nowhere — a field not implemented, or the document's own words.
 */
export type ConstitutionSource =
  | Readonly<{ kind: "account" | "tx" | "program" | "code"; id: string; field: string }>
  | Readonly<{ kind: "none" }>;

export type ConstitutionValue = string | number | boolean | null | readonly ConstitutionValue[] | Readonly<{ [key: string]: ConstitutionValue }>;

export type ConstitutionField =
  | Readonly<{ enforcement: ConstitutionEnforcement; unit: ConstitutionUnit; known: true; value: ConstitutionValue; source: ConstitutionSource }>
  | Readonly<{ enforcement: ConstitutionEnforcement; unit: ConstitutionUnit; known: false; value: null; unknown: ConstitutionUnknown; source: ConstitutionSource }>;

export const CONSTITUTION_SECTIONS = [
  "issuer",
  "token",
  "distribution",
  "curve",
  "migration",
  "lp",
  "pool",
  "fees",
  "recipients",
  "budget",
  "operations",
  "limits",
  "stops",
  "changelog",
  "channels",
  "anchor",
  "price",
  "lifecycle",
] as const;
export type ConstitutionSection = (typeof CONSTITUTION_SECTIONS)[number];

export type MarketConstitution = Readonly<{
  schema: typeof MARKET_CONSTITUTION_SCHEMA;
  version: typeof MARKET_CONSTITUTION_VERSION;
  policyRevision: typeof MARKET_CONSTITUTION_POLICY_REVISION;
  market: Readonly<{ network: "solana:mainnet" | "solana:devnet"; token: string; curve: string; config: string; preset: string }>;
}> &
  Readonly<Record<ConstitutionSection, Readonly<Record<string, ConstitutionField>>>>;

/* ------------------------------------------------------------ the market's states (§8.3) */

/**
 * The product's projection of the market's states (spec §8.3) over the states the code keeps (`MARKET_CYCLE_STATES`,
 * `docs/marketos/PLAN.md` §4): the internal names stay as they are — the spec forbids renaming them without a migration —
 * and every one maps to one product state; the two of failure carry a reason class. `CLOSED/ARCHIVED` has no internal
 * state yet: no market of Ryntra is closed, and none is said to be.
 */
export const PRODUCT_MARKET_STATES = [
  "CREATED",
  "ON_CURVE",
  "READY_TO_GRADUATE",
  "GRADUATING",
  "ON_DEX",
  "MARKET_ACTIVE",
  "LIQUIDITY_REBALANCING",
  "PAUSED",
  "RECOVERING",
  "CLOSED/ARCHIVED",
] as const;
export type ProductMarketState = (typeof PRODUCT_MARKET_STATES)[number];

export type StateProjection = Readonly<{ product: ProductMarketState; reason: "MIGRATION_FAILED" | "BUDGET_EXHAUSTED" | null }>;

export const MARKET_STATE_PROJECTION: Readonly<Record<MarketCycleState, StateProjection>> = Object.freeze({
  CREATED: { product: "CREATED", reason: null },
  PRICE_DISCOVERY: { product: "ON_CURVE", reason: null },
  GRADUATION_READY: { product: "READY_TO_GRADUATE", reason: null },
  MIGRATING: { product: "GRADUATING", reason: null },
  /* The graduation that did not go through is retried by anyone — the executor too: the market is recovering. */
  MIGRATION_FAILED: { product: "RECOVERING", reason: "MIGRATION_FAILED" },
  CORE_MARKET_LIVE: { product: "ON_DEX", reason: null },
  ENDOWMENT_FUNDED: { product: "MARKET_ACTIVE", reason: null },
  /* The budget spent: the ladder is not refilled, the market lives on its pool — active, with the reason said. */
  ENDOWMENT_EXHAUSTED: { product: "MARKET_ACTIVE", reason: "BUDGET_EXHAUSTED" },
  LADDER_ACTIVE: { product: "LIQUIDITY_REBALANCING", reason: null },
  MAINTAINING: { product: "LIQUIDITY_REBALANCING", reason: null },
  PAUSED_RISK: { product: "PAUSED", reason: null },
  MATURE: { product: "MARKET_ACTIVE", reason: null },
});

/** The product state of an internal one; an internal name the projection does not know is `FAILED_UNKNOWN`. */
export function productState(state: string): StateProjection | Readonly<{ product: "FAILED_UNKNOWN"; reason: null }> {
  return (MARKET_CYCLE_STATES as readonly string[]).includes(state) ? MARKET_STATE_PROJECTION[state as MarketCycleState] : { product: "FAILED_UNKNOWN", reason: null };
}

/* ------------------------------------------------------------ the inputs */

/** The creator's lock as its escrow states it — only what the escrow fixed when it was made. */
export type ConstitutionLock = Readonly<{
  escrow: string;
  program: string;
  mint: string;
  creator: string;
  recipient: string;
  totalRaw: string;
  cliffAt: number;
  endsAt: number;
  cancelMode: number;
  updateRecipientMode: number;
}>;

export type ConstitutionInput = Readonly<{
  /** The launch receipt read from the chain (`buildLaunchReceiptFacts`): the mint, the curve, the creation, the fee vault. */
  receipt: LaunchReceiptFacts;
  /** The curve's DBC config account, decoded plain (`plainConfigFromData`): its on-chain field names, numbers as decimal strings. */
  config: Readonly<Record<string, unknown>>;
  /** The creator's lock the launch made, as its escrow states it; null — the launch made none. */
  lock: ConstitutionLock | null;
  /** Ryntra's addresses on this network, to name whose an address of the config is. */
  ryntra: Readonly<{ partnerVault: string | null; executor: string | null }>;
  /**
   * Whether Ryntra launched this market itself — its creator one of Ryntra's own wallets: the executor keeps the ladder of
   * Ryntra's money only there, and a budget market's budget always there (`lib/launch/autopilot.server.ts`).
   */
  ours: boolean;
  /** «Розширений»: the first-purchase cap its launch's own terms set (`advanced.firstBuyCapBps` of the record). */
  advancedFirstBuyCapBps?: number | null;
  /** Where the canonical document is served, relative to the site: `/api/launch/{mint}/constitution`. */
  documentPath: string;
}>;

/* ------------------------------------------------------------ program and code references */

export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const MET_LOCK_PROGRAM = "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn";
export const FEE_SHARING_PROGRAM = "dfsdo2UqvwfN8DuUVrMRNfQe11VaiNoKcMqLHVvDPzh";
const BUDGET_CODE = "lib/core/launch/budget.ts";
const FLOOR_CODE = "lib/core/launch/autopilot.ts";
const PRESETS_CODE = "lib/core/venues/meteora-dbc/presets.ts";
const EXECUTOR_CODE = "lib/launch/autopilot.server.ts";
const RECORD_CODE = "lib/launch/flow.server.ts";
const SPEC = "docs/canon/ryntra-solana-spec.md";

/** DBC's `TokenAuthorityOption.IMMUTABLE`, `MigrationOption.DAMM_V2`, the exponential scheduler, timestamp activation. */
const DBC_IMMUTABLE = 1n;
const DBC_TO_DAMM_V2 = 1n;
const DBC_EXPONENTIAL = 1n;
const DBC_TIMESTAMP = 1n;
/** DAMM v2's compounding collect mode and its exponential market-cap scheduler (the linear one, 3, is not stated). */
const DAMM_COMPOUNDING = 2n;
const DAMM_MARKET_CAP_EXPONENTIAL = 4n;
/** DBC's fee numerators are of 10⁹; a basis point is 10⁵ of them. */
const FEE_PER_BPS = 100_000n;
const BPS = 10_000n;
/** Of a migrated DAMM v2 pool's fee and of the surplus, Meteora's part (`protocolFeePercent`; the surplus's 20 %). */
const METEORA_POOL_PCT = METEORA_PROTOCOL_PCT;

/* ------------------------------------------------------------ field makers */

const known = (enforcement: ConstitutionEnforcement, unit: ConstitutionUnit, value: ConstitutionValue, source: ConstitutionSource): ConstitutionField => ({ enforcement, unit, known: true, value, source });
const unknown = (enforcement: ConstitutionEnforcement, unit: ConstitutionUnit, why: ConstitutionUnknown, source: ConstitutionSource): ConstitutionField => ({ enforcement, unit, known: false, value: null, unknown: why, source });
const account = (id: string, field: string): ConstitutionSource => ({ kind: "account", id, field });
const tx = (id: string, field: string): ConstitutionSource => ({ kind: "tx", id, field });
const program = (id: string, field: string): ConstitutionSource => ({ kind: "program", id, field });
const code = (id: string, field: string): ConstitutionSource => ({ kind: "code", id, field });
const NONE: ConstitutionSource = { kind: "none" };

/** A field of the plain config by its path (`poolFees.baseFee.cliffFeeNumerator`); undefined where the account lacks it. */
function at(config: Readonly<Record<string, unknown>>, path: string): unknown {
  let value: unknown = config;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** A whole number of the config: a JS integer or a decimal string. */
function integer(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/** cliff × (1 − r / 10 000)ⁿ, the exponential scheduler's last fee, in the same unit as the cliff — rounded down. */
export function exponentialEnd(cliff: bigint, reductionBps: bigint, periods: bigint): bigint {
  if (periods < 0n || reductionBps < 0n || reductionBps > BPS) throw new Error("Not a fee schedule.");
  return (cliff * (BPS - reductionBps) ** periods) / BPS ** periods;
}

/**
 * The graduated pool's market-cap fee schedule as the config stores it (`migratedPoolBaseFeeBytes`, DBC's
 * `MigratedPoolMarketCapFeeSchedulerParams`): `numberOfPeriod` u16, `sqrtPriceStepBps` u16, `schedulerExpirationDuration`
 * u32, `reductionFactor` u64 — little-endian. Null when the bytes are not those.
 */
export function marketCapScheduleOf(bytes: unknown): Readonly<{ periods: number; sqrtPriceStepBps: number; expiresAfterSeconds: number; reductionBps: bigint }> | null {
  if (!Array.isArray(bytes) || bytes.length < 16 || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
  const view = new DataView(Uint8Array.from(bytes as number[]).buffer);
  return { periods: view.getUint16(0, true), sqrtPriceStepBps: view.getUint16(2, true), expiresAfterSeconds: view.getUint32(4, true), reductionBps: view.getBigUint64(8, true) };
}

/** Whose an address of the config is, by Ryntra's own list of its addresses. */
function roleOf(address: string, ryntra: ConstitutionInput["ryntra"]): "RYNTRA_PARTNER_VAULT" | "RYNTRA_EXECUTOR" | "OTHER" {
  if (ryntra.partnerVault && address === ryntra.partnerVault) return "RYNTRA_PARTNER_VAULT";
  if (ryntra.executor && address === ryntra.executor) return "RYNTRA_EXECUTOR";
  return "OTHER";
}

/* ------------------------------------------------------------ the document */

/**
 * The market's constitution from the chain's facts and the server's policies. It refuses only what is not a Ryntra launch
 * (a receipt is that proof); a field the chain did not carry is `known: false` with its reason's code.
 */
export function buildMarketConstitution(input: ConstitutionInput): MarketConstitution {
  const { receipt, config, lock, ryntra, ours } = input;
  const preset = launchPreset(receipt.preset);
  if (!preset) throw new Error(`No preset «${receipt.preset}».`);
  const budgetPreset = preset.feeClaimer === "executor";
  const ownerLadder = OWNER_LADDER_PRESETS.has(preset.id) && ours;
  const created = receipt.created.signature;
  const cfg = (field: string) => account(receipt.config, field);
  const mintField = (field: string, value: ConstitutionValue, unit: ConstitutionUnit = "address") => known("ONCHAIN_RULE", unit, value, account(receipt.token, field));
  const missing = (unit: ConstitutionUnit, field: string) => unknown("ONCHAIN_RULE", unit, "FIELD_MISSING", cfg(field));

  /** A number of the config as a known on-chain rule — or not known, never zero, when the account did not carry it. */
  const number = (path: string, unit: ConstitutionUnit, map: (raw: bigint) => ConstitutionValue = (raw) => (unit === "token-raw" || unit === "quote-raw" || unit === "lamports" ? raw.toString() : Number(raw))) => {
    const raw = integer(at(config, path));
    return raw === null ? missing(unit, path) : known("ONCHAIN_RULE", unit, map(raw), cfg(path));
  };
  /** A config field compared with what it must be: yes or no when read, not known when the account did not carry it. */
  const flag = (path: string, expected: bigint) => {
    const raw = integer(at(config, path));
    return raw === null ? missing("flag", path) : known("ONCHAIN_RULE", "flag", raw === expected, cfg(path));
  };
  /** A config field as a code: `yes` when it is the expected value, `no` otherwise, not known when absent. */
  const codeOf = (path: string, expected: bigint, yes: string, no: string, source: ConstitutionSource = cfg(path)) => {
    const raw = integer(at(config, path));
    return raw === null ? unknown("ONCHAIN_RULE", "code", "FIELD_MISSING", source) : known("ONCHAIN_RULE", "code", raw === expected ? yes : no, source);
  };
  const address = (path: string) => {
    const value = at(config, path);
    return typeof value === "string" ? known("ONCHAIN_RULE", "address", value, cfg(path)) : missing("address", path);
  };
  const role = (path: string) => {
    const value = at(config, path);
    return typeof value === "string" ? known("INFORMATIONAL", "code", roleOf(value, ryntra), cfg(path)) : unknown("INFORMATIONAL", "code", "FIELD_MISSING", cfg(path));
  };
  /** A share computed from config numbers by a formula the source names; not known when one of them is absent. */
  const derived = (values: readonly (bigint | null)[], unit: ConstitutionUnit, compute: (values: readonly bigint[]) => number, field: string) =>
    values.every((value): value is bigint => value !== null) ? known("ONCHAIN_RULE", unit, compute(values as bigint[]), cfg(field)) : missing(unit, field);

  /* ---- the token's distribution, from the config: what the curve sells, what moves to the pool, what is outside. */
  const supply = integer(at(config, "preMigrationTokenSupply"));
  const supplyAfter = integer(at(config, "postMigrationTokenSupply"));
  const sale = integer(at(config, "swapBaseAmount"));
  const toPool = integer(at(config, "migrationBaseThreshold"));
  const vesting = ["amountPerPeriod", "numberOfPeriod", "cliffUnlockAmount"].map((key) => integer(at(config, `lockedVestingConfig.${key}`)));
  const vested = vesting.every((value) => value !== null) ? vesting[0]! * vesting[1]! + vesting[2]! : null;
  const leftover = supply !== null && sale !== null && toPool !== null && vested !== null ? supply - sale - toPool - vested : null;

  /* ---- the curve's fee: a cliff falling exponentially over its periods, counted in seconds when the curve runs by time. */
  const cliff = integer(at(config, "poolFees.baseFee.cliffFeeNumerator"));
  const periods = integer(at(config, "poolFees.baseFee.firstFactor"));
  const frequency = integer(at(config, "poolFees.baseFee.secondFactor"));
  const reduction = integer(at(config, "poolFees.baseFee.thirdFactor"));
  const curveMode = integer(at(config, "poolFees.baseFee.baseFeeMode"));
  const activation = integer(at(config, "activationType"));

  /* ---- the graduated pool's fee: from its start, falling exponentially with the market cap. */
  const poolMode = integer(at(config, "migratedPoolBaseFeeMode"));
  const schedule = poolMode === DAMM_MARKET_CAP_EXPONENTIAL ? marketCapScheduleOf(at(config, "migratedPoolBaseFeeBytes")) : null;
  const poolStart = integer(at(config, "migratedPoolFeeBps"));
  const poolScheduleField = (unit: ConstitutionUnit, value: () => number, field: string) =>
    poolMode === null || poolStart === null
      ? missing(unit, "migratedPoolBaseFeeMode")
      : schedule === null
        ? unknown("ONCHAIN_RULE", unit, "NOT_MARKET_CAP_EXPONENTIAL", cfg("migratedPoolBaseFeeMode"))
        : known("ONCHAIN_RULE", unit, value(), cfg(field));

  const creatorPct = integer(at(config, "creatorTradingFeePercentage"));
  const compounding = integer(at(config, "migratedCompoundingFeeBps"));
  const rest = BigInt(100 - METEORA_PROTOCOL_PCT);
  const poolRest = BigInt(100 - METEORA_POOL_PCT);

  const lockHolds = lock !== null && lock.program === MET_LOCK_PROGRAM && lock.mint === receipt.token && lock.creator === receipt.creator && lock.recipient === receipt.creator && lock.cancelMode === 0 && lock.updateRecipientMode === 0;
  const feeVault = receipt.feeSharing ?? null;
  const feeClaimer = at(config, "feeClaimer");

  const advancedCap = preset.id === "advanced" && typeof input.advancedFirstBuyCapBps === "number" && Number.isInteger(input.advancedFirstBuyCapBps) && input.advancedFirstBuyCapBps > 0 ? input.advancedFirstBuyCapBps : null;
  const capSource = advancedCap !== null ? code(RECORD_CODE, "record.advanced.firstBuyCapBps") : code(PRESETS_CODE, `${preset.id}.creatorFirstBuyCapBps`);

  /* ---- who places a ladder here, by the executor's own rule (`lib/launch/autopilot.server.ts`). */
  const ladder = budgetPreset ? (ours ? "RYNTRA_EXECUTOR_FROM_BUDGET" : "RYNTRA_EXECUTOR_FROM_BUDGET_WHEN_SERVED") : ownerLadder ? "RYNTRA_EXECUTOR_OWN_FUNDS_WHEN_OPERATOR_OPENS" : "NOBODY";
  const ladderSource = budgetPreset ? code(BUDGET_CODE, "BUDGET_LADDER") : code(FLOOR_CODE, "OWNER_LADDER_PRESETS");

  const document: MarketConstitution = {
    schema: MARKET_CONSTITUTION_SCHEMA,
    version: MARKET_CONSTITUTION_VERSION,
    policyRevision: MARKET_CONSTITUTION_POLICY_REVISION,
    market: { network: receipt.cluster === "mainnet" ? "solana:mainnet" : "solana:devnet", token: receipt.token, curve: receipt.pool, config: receipt.config, preset: receipt.preset },

    issuer: {
      creator: known("ONCHAIN_RULE", "address", receipt.creator, tx(created, "initialize.creator")),
      /* Ryntra's pool payer paid for and signed the creation: what makes a launch Ryntra's (the receipt checked it). */
      launchedThroughRyntra: known("ONCHAIN_RULE", "flag", true, tx(created, "feePayer")),
      /* The creation's block time; a node that did not give it leaves the document unread (`constitution.server.ts`). */
      launchedAt: receipt.created.at ? known("ONCHAIN_RULE", "time", receipt.created.at, tx(created, "blockTime")) : unknown("ONCHAIN_RULE", "time", "FIELD_MISSING", tx(created, "blockTime")),
      ryntraLaunchedIt: known("INFORMATIONAL", "flag", ours, code("lib/launch/runtime.server.ts", "ryntraOwnWallets")),
    },

    token: {
      program: mintField("owner", TOKEN_2022_PROGRAM),
      decimals: mintField("decimals", receipt.token2022.decimals, "count"),
      /* The most there can ever be: the mint authority is gone, and anyone may burn their own — never more than this. */
      maxSupply: number("preMigrationTokenSupply", "token-raw"),
      mintAuthority: mintField("mintAuthority", null),
      freezeAuthority: mintField("freezeAuthority", null),
      metadataUpdateAuthority: mintField("tokenMetadata.updateAuthority", null),
      transferHook: mintField("transferHook.programId", null),
      extensions: mintField("extensions", [...receipt.token2022.extensions], "list"),
      /*
       * No hook; and no fee extension — or, «Комісія за переказ» (SOL-L10), the rate the mint takes on every transfer until
       * the DEX: the move to the DEX sets 0 % two epochs on and revokes the authority (RevokeZeroFee), so the rate here is
       * fixed for ever and the document's bytes do not move with the epoch.
       */
      transferFee: receipt.transferFee ? mintField("transferFeeConfig.olderTransferFee.transferFeeBasisPoints", receipt.transferFee.bps, "bps") : mintField("extensions", null, "bps"),
    },

    distribution: {
      curveSale: number("swapBaseAmount", "token-raw"),
      poolAtGraduation: number("migrationBaseThreshold", "token-raw"),
      vestedOutsideCurve: vested === null ? missing("token-raw", "lockedVestingConfig") : known("ONCHAIN_RULE", "token-raw", vested.toString(), cfg("lockedVestingConfig")),
      /* What the config reserves beyond the curve and the pool; after the move its leftover receiver withdraws what is left. */
      leftover: leftover === null ? missing("token-raw", "preMigrationTokenSupply") : leftover < 0n ? unknown("ONCHAIN_RULE", "token-raw", "AMOUNTS_DO_NOT_ADD_UP", cfg("preMigrationTokenSupply")) : known("ONCHAIN_RULE", "token-raw", leftover.toString(), cfg("preMigrationTokenSupply − swapBaseAmount − migrationBaseThreshold − lockedVestingConfig")),
      creatorFirstBuy: known("ONCHAIN_RULE", "token-raw", receipt.creatorFirstBuy ? receipt.creatorFirstBuy.tokensOutRaw : null, tx(created, "meta.postTokenBalances")),
      creatorFirstBuyPaid: known("ONCHAIN_RULE", "quote-raw", receipt.creatorFirstBuy ? receipt.creatorFirstBuy.quoteInRaw : null, tx(created, "meta.postTokenBalances")),
      /* Ryntra builds the creation and refuses a first purchase above this; the program itself would take any. */
      creatorFirstBuyCap: receipt.creatorFirstBuy ? known("SERVER_POLICY", "token-raw", receipt.creatorFirstBuy.capRaw, capSource) : known("SERVER_POLICY", "bps", advancedCap ?? preset.creatorFirstBuyCapBps, capSource),
      creatorLock: lockHolds
        ? known("ONCHAIN_RULE", "list", { escrow: lock.escrow, lockedRaw: lock.totalRaw, cliffAt: new Date(lock.cliffAt * 1000).toISOString(), endsAt: new Date(lock.endsAt * 1000).toISOString(), cancellable: false, redirectable: false }, account(lock.escrow, "vestingEscrow"))
        : lock
          ? /* An escrow that can be cancelled or redirected, or is not the creator's: a lock, but not a rule. */
            known("INFORMATIONAL", "list", { escrow: lock.escrow, rule: false }, account(lock.escrow, "vestingEscrow"))
          : known("INFORMATIONAL", "list", null, tx(created, "instructions")),
      creatorLockRequired: known("SERVER_POLICY", "seconds", preset.creatorLockMinDays === null ? null : preset.creatorLockMinDays * 86_400, code(PRESETS_CODE, `${preset.id}.creatorLockMinDays`)),
    },

    curve: {
      quoteMint: address("quoteMint"),
      graduationThreshold: number("migrationQuoteThreshold", "quote-raw"),
      feeStart: cliff === null ? missing("bps", "poolFees.baseFee.cliffFeeNumerator") : known("ONCHAIN_RULE", "bps", Number(cliff / FEE_PER_BPS), cfg("poolFees.baseFee.cliffFeeNumerator")),
      feeEnd:
        cliff === null || periods === null || reduction === null || curveMode === null
          ? missing("bps", "poolFees.baseFee")
          : curveMode !== DBC_EXPONENTIAL
            ? unknown("ONCHAIN_RULE", "bps", "NOT_EXPONENTIAL", cfg("poolFees.baseFee.baseFeeMode"))
            : known("ONCHAIN_RULE", "bps", Number(exponentialEnd(cliff, reduction, periods) / FEE_PER_BPS), cfg("poolFees.baseFee: cliffFeeNumerator × (1 − thirdFactor / 10 000)^firstFactor")),
      feeFallsOver:
        periods === null || frequency === null || activation === null
          ? missing("seconds", "poolFees.baseFee")
          : activation !== DBC_TIMESTAMP
            ? unknown("ONCHAIN_RULE", "seconds", "SLOT_ACTIVATION", cfg("activationType"))
            : known("ONCHAIN_RULE", "seconds", Number(periods * frequency), cfg("poolFees.baseFee: firstFactor × secondFactor")),
      volatilityFee: flag("poolFees.dynamicFee.initialized", 1n),
      creatorFirstBuyAtEndFee: flag("enableFirstSwapWithMinFee", 1n),
      creationFee: number("poolCreationFee", "lamports"),
      fixed: known("ONCHAIN_RULE", "flag", true, program(DBC_PROGRAM, "poolConfig")),
    },

    migration: {
      target: codeOf("migrationOption", DBC_TO_DAMM_V2, "DAMM_V2", "OTHER"),
      /* At the threshold the move is open to anyone — Meteora's keepers, Ryntra's executor, a person. */
      trigger: known("ONCHAIN_RULE", "code", "ANYONE_AT_THRESHOLD", program(DBC_PROGRAM, "migration_damm_v2")),
      fee: number("migrationFeePercentage", "bps", (raw) => Number(raw) * 100),
      creatorShareOfFee: number("creatorMigrationFeePercentage", "bps", (raw) => Number(raw) * 100),
      partnerShareOfFee: number("creatorMigrationFeePercentage", "bps", (raw) => 10_000 - Number(raw) * 100),
      /* Apart from the fee: Meteora's part of the liquidity that moves into the pool, set on every curve by the program. */
      meteoraOfLiquidity: known("ONCHAIN_RULE", "bps", METEORA_MIGRATION_LIQUIDITY_BPS, program(DBC_PROGRAM, "protocolLiquidityMigrationFeeBps")),
      supplyUnchanged: supply === null || supplyAfter === null ? missing("flag", "postMigrationTokenSupply") : known("ONCHAIN_RULE", "flag", supply === supplyAfter, cfg("preMigrationTokenSupply = postMigrationTokenSupply")),
    },

    lp: {
      partnerLockedForever: number("partnerPermanentLockedLiquidityPercentage", "pct"),
      creatorLockedForever: number("creatorPermanentLockedLiquidityPercentage", "pct"),
      unlocked: derived([integer(at(config, "partnerLiquidityPercentage")), integer(at(config, "creatorLiquidityPercentage"))], "pct", ([a, b]) => Number(a! + b!), "partnerLiquidityPercentage + creatorLiquidityPercentage"),
      vesting: derived([integer(at(config, "partnerLiquidityVestingInfo.vestingPercentage")), integer(at(config, "creatorLiquidityVestingInfo.vestingPercentage"))], "pct", ([a, b]) => Number(a! + b!), "partnerLiquidityVestingInfo + creatorLiquidityVestingInfo"),
      /* The move to the DEX gives each locked position's NFT to its side: the partner's to the fee claimer, the creator's to the creator's role. */
      partnerPositionTo: known("ONCHAIN_RULE", "code", "PARTNER", program(DBC_PROGRAM, "migration_damm_v2")),
      creatorPositionTo: known("ONCHAIN_RULE", "code", feeVault ? "FEE_VAULT" : "CREATOR_ROLE", program(DBC_PROGRAM, "migration_damm_v2")),
    },

    pool: {
      compounds: flag("migratedCollectFeeMode", DAMM_COMPOUNDING),
      compoundingShare: number("migratedCompoundingFeeBps", "bps"),
      feeStart: number("migratedPoolFeeBps", "bps"),
      feeEnd: poolScheduleField("bps", () => Number(exponentialEnd(poolStart! * FEE_PER_BPS, schedule!.reductionBps, BigInt(schedule!.periods)) / FEE_PER_BPS), "migratedPoolBaseFeeBytes: migratedPoolFeeBps × (1 − reductionFactor / 10 000)^numberOfPeriod"),
      /* The schedule steps the square-root price linearly from the graduation price: the price's multiple at the last step. */
      feeEndAtPriceMultiple: poolScheduleField("x100", () => Math.round((1 + (schedule!.periods * schedule!.sqrtPriceStepBps) / 10_000) ** 2 * 100), "migratedPoolBaseFeeBytes: (1 + numberOfPeriod × sqrtPriceStepBps / 10 000)²"),
      feeEndAfter: poolScheduleField("seconds", () => schedule!.expiresAfterSeconds, "migratedPoolBaseFeeBytes: schedulerExpirationDuration"),
      volatilityFee: flag("migratedDynamicFee", 1n),
    },

    fees: {
      meteoraOfCurveFee: known("ONCHAIN_RULE", "pct", METEORA_PROTOCOL_PCT, program(DBC_PROGRAM, "PROTOCOL_FEE_PERCENT")),
      referralOfMeteora: known("ONCHAIN_RULE", "pct", METEORA_REFERRAL_OF_PROTOCOL_PCT, program(DBC_PROGRAM, "HOST_FEE_PERCENT")),
      creatorOfCurveFee: derived([creatorPct], "bps", ([pct]) => Number(rest * pct!), "(100 − PROTOCOL_FEE_PERCENT) × creatorTradingFeePercentage"),
      partnerOfCurveFee: derived([creatorPct], "bps", ([pct]) => Number(rest * (100n - pct!)), "(100 − PROTOCOL_FEE_PERCENT) × (100 − creatorTradingFeePercentage)"),
      migrationFeeOfRaised: number("migrationFeePercentage", "bps", (raw) => Number(raw) * 100),
      /* The surplus — what the curve holds above its threshold — is not a fee: Meteora 20 %, the rest by the creator's trading share. */
      meteoraOfSurplus: known("ONCHAIN_RULE", "pct", METEORA_POOL_PCT, program(DBC_PROGRAM, "withdraw_surplus")),
      creatorOfSurplus: derived([creatorPct], "bps", ([pct]) => Number(rest * pct!), "withdraw_surplus: (100 − 20) × creatorTradingFeePercentage"),
      partnerOfSurplus: derived([creatorPct], "bps", ([pct]) => Number(rest * (100n - pct!)), "withdraw_surplus: (100 − 20) × (100 − creatorTradingFeePercentage)"),
      meteoraOfPoolFee: known("ONCHAIN_RULE", "pct", METEORA_POOL_PCT, program(DAMM_V2_PROGRAM, "protocolFeePercent")),
      referralOfMeteoraPool: known("ONCHAIN_RULE", "pct", METEORA_REFERRAL_OF_PROTOCOL_PCT, program(DAMM_V2_PROGRAM, "referralFeePercent")),
      /* Of every fee in the pool: the compounded part stays as liquidity; the rest is paid to the positions by their liquidity. */
      poolCompoundedOfFee: derived([compounding], "bps", ([bps]) => Number((poolRest * bps!) / 100n), "(100 − protocolFeePercent) × migratedCompoundingFeeBps"),
      poolPositionsOfFee: derived([compounding], "bps", ([bps]) => Number(poolRest * 100n - (poolRest * bps!) / 100n), "(100 − protocolFeePercent) × (10 000 − migratedCompoundingFeeBps)"),
    },

    recipients: {
      partner: address("feeClaimer"),
      partnerIs: role("feeClaimer"),
      leftoverReceiver: address("leftoverReceiver"),
      leftoverReceiverIs: role("leftoverReceiver"),
      /*
       * The curve's creator role takes the creator's fees: a fee vault that pays its shares for ever and holds the role,
       * or — at launch — the creator's wallet, which may hand the role on (`transfer_pool_creator`): Ryntra's word, not a rule.
       */
      creatorFees: feeVault ? known("ONCHAIN_RULE", "address", feeVault.vault, account(receipt.pool, "creator")) : known("INFORMATIONAL", "address", receipt.creator, tx(created, "initialize.creator")),
      creatorFeeShares: feeVault ? known("ONCHAIN_RULE", "list", feeVault.shares.map((share) => ({ address: share.address, bps: share.bps })), account(feeVault.vault, "users")) : known("ONCHAIN_RULE", "list", null, account(receipt.pool, "creator")),
      creatorRoleTransferable: feeVault ? known("ONCHAIN_RULE", "flag", false, program(FEE_SHARING_PROGRAM, "feeVault")) : known("ONCHAIN_RULE", "flag", true, program(DBC_PROGRAM, "transfer_pool_creator")),
    },

    budget: budgetPreset
      ? {
          /* Micro and the demo market: the executor holds the partner's role, and the market's budget is its money first. */
          sources: known("SERVER_POLICY", "list", ["MIGRATION_FEE", "SURPLUS", "PARTNER_CURVE_FEES_SHARE", "PARTNER_LP_FEES_SHARE"], code(BUDGET_CODE, "BUDGET_SOURCES")),
          shareOfPartnerFees: known("SERVER_POLICY", "bps", BUDGET_RULE.feeShareBps, code(BUDGET_CODE, "BUDGET_RULE.feeShareBps")),
          /* Ryntra's own market: always. A person's: while the operator serves people's markets and its creator was watched from launch. */
          claimed: known("SERVER_POLICY", "code", ours ? "ALWAYS" : "WHILE_SERVED_AND_CREATOR_WATCHED", code(EXECUTOR_CODE, "served()")),
          /* The executor's own wallet — a key of Ryntra's server, so where the budget stays is Ryntra's policy, not a program's. */
          heldBy: typeof feeClaimer === "string" ? known("SERVER_POLICY", "address", feeClaimer, code("lib/launch/config.server.ts", "launchExecutor")) : unknown("SERVER_POLICY", "address", "FIELD_MISSING", cfg("feeClaimer")),
          onchainBounds: unknown("NOT_IMPLEMENTED", "code", "BOUNDS_ONCHAIN_PHASE_2", NONE),
        }
      : {
          /* Classic, Protected, «Спільнота», «Розширений»: the partner's fees are Ryntra's revenue, no market's budget. */
          sources: known("SERVER_POLICY", "list", null, code(BUDGET_CODE, "BUDGET_SOURCES")),
          onchainBounds: unknown("NOT_IMPLEMENTED", "code", "BOUNDS_ONCHAIN_PHASE_2", NONE),
        },

    operations: {
      tradeOnCurve: known("ONCHAIN_RULE", "code", "ANYONE", program(DBC_PROGRAM, "swap")),
      graduate: known("ONCHAIN_RULE", "code", "ANYONE", program(DBC_PROGRAM, "migration_damm_v2")),
      sendGraduation: known("SERVER_POLICY", "code", ryntra.executor ? "RYNTRA_EXECUTOR" : "NOBODY", code(EXECUTOR_CODE, "graduation")),
      claimPartnerFees: known("ONCHAIN_RULE", "code", "PARTNER", program(DBC_PROGRAM, "claim_trading_fee")),
      claimCreatorFees: known("ONCHAIN_RULE", "code", feeVault ? "FEE_VAULT" : "CREATOR_ROLE", program(DBC_PROGRAM, "claim_creator_trading_fee")),
      withdrawLeftover: known("ONCHAIN_RULE", "code", "LEFTOVER_RECEIVER", program(DBC_PROGRAM, "withdraw_leftover")),
      ladder: known("SERVER_POLICY", "code", ladder, ladderSource),
      mint: known("ONCHAIN_RULE", "code", "NOBODY", account(receipt.token, "mintAuthority")),
      freeze: known("ONCHAIN_RULE", "code", "NOBODY", account(receipt.token, "freezeAuthority")),
      changeMetadata: codeOf("tokenUpdateAuthority", DBC_IMMUTABLE, "NOBODY", "OTHER"),
      changeConfig: known("ONCHAIN_RULE", "code", "NOBODY", program(DBC_PROGRAM, "poolConfig")),
      withdrawLockedLiquidity: known("ONCHAIN_RULE", "code", "NOBODY", program(DAMM_V2_PROGRAM, "permanent_lock_position")),
    },

    limits: budgetPreset
      ? {
          deployedMax: known("SERVER_POLICY", "bps", BUDGET_RULE.deployMaxBps, code(BUDGET_CODE, "BUDGET_RULE.deployMaxBps")),
          stepMin: known("SERVER_POLICY", "quote-raw", BUDGET_RULE.minStepRaw.toString(), code(BUDGET_CODE, "BUDGET_RULE.minStepRaw")),
          stepsMax: known("SERVER_POLICY", "count", Math.min(BUDGET_LADDER.maxStepsByDepth, BUDGET_RULE.maxSteps), code(BUDGET_CODE, "min(BUDGET_LADDER.maxStepsByDepth, BUDGET_RULE.maxSteps)")),
          stepApart: known("SERVER_POLICY", "bps", BUDGET_LADDER.binStep, code(BUDGET_CODE, "BUDGET_LADDER.binStep")),
          dayTopUpMax: known("SERVER_POLICY", "bps", BUDGET_RULE.dailyTopUpBps, code(BUDGET_CODE, "BUDGET_RULE.dailyTopUpBps")),
          acquiredTokens: known("SERVER_POLICY", "code", "HELD", code(BUDGET_CODE, "BUDGET_LADDER")),
        }
      : ownerLadder
        ? {
            shareOfPartnerEarnings: known("SERVER_POLICY", "bps", FLOOR_RULE.budgetShareBps, code(FLOOR_CODE, "FLOOR_RULE.budgetShareBps")),
            placeMin: known("SERVER_POLICY", "quote-raw", FLOOR_RULE.minPlaceRaw.toString(), code(FLOOR_CODE, "FLOOR_RULE.minPlaceRaw")),
            steps: known("SERVER_POLICY", "count", FLOOR_RULE.depthBins, code(FLOOR_CODE, "FLOOR_RULE.depthBins")),
            stepApart: known("SERVER_POLICY", "bps", FLOOR_RULE.binStep, code(FLOOR_CODE, "FLOOR_RULE.binStep")),
            acquiredTokens: known("SERVER_POLICY", "code", "HELD", code(FLOOR_CODE, "FLOOR_RULE")),
          }
        : {
            /* No ladder of Ryntra's on this market: nothing of Ryntra's money is placed here. */
            ladder: known("SERVER_POLICY", "code", "NONE", code(FLOOR_CODE, "OWNER_LADDER_PRESETS")),
          },

    stops: {
      operatorStop: known("SERVER_POLICY", "code", "ALL_MARKETS_OR_THIS_MARKET", code(EXECUTOR_CODE, "stopOn")),
      ...(budgetPreset
        ? {
            priceDrop: known("SERVER_POLICY", "bps", BUDGET_RULE.dropStopBps, code(BUDGET_CODE, "BUDGET_RULE.dropStopBps, BUDGET_RULE.dropWindowSeconds")),
            creatorSoldFirstWeek: known("SERVER_POLICY", "seconds", BUDGET_RULE.creatorSaleWindowSeconds, code(BUDGET_CODE, "BUDGET_RULE.creatorSaleWindowSeconds")),
            executorSolLow: known("SERVER_POLICY", "lamports", BUDGET_RULE.executorMinLamports.toString(), code(BUDGET_CODE, "BUDGET_RULE.executorMinLamports")),
            nodesDisagree: known("SERVER_POLICY", "bps", BUDGET_RULE.divergenceBps, code(BUDGET_CODE, "BUDGET_RULE.divergenceBps")),
            readsStale: known("SERVER_POLICY", "seconds", BUDGET_RULE.observationMaxAgeSeconds, code(BUDGET_CODE, "BUDGET_RULE.observationMaxAgeSeconds")),
            exhausted: known("SERVER_POLICY", "quote-raw", BUDGET_RULE.minStepRaw.toString(), code(BUDGET_CODE, "exhausted")),
          }
        : {}),
    },

    changelog: {
      entries: known("INFORMATIONAL", "list", [{ version: MARKET_CONSTITUTION_VERSION, policyRevision: MARKET_CONSTITUTION_POLICY_REVISION, event: "LAUNCHED", at: receipt.created.at, tx: created }], tx(created, "initialize")),
      policyChanges: unknown("NOT_IMPLEMENTED", "list", "POLICY_CHANGES_NOT_JOURNALED", NONE),
    },

    channels: {
      flightLog: known("INFORMATIONAL", "code", `/app/launch/${receipt.token}#activity`, NONE),
      incidents: unknown("NOT_IMPLEMENTED", "code", "NO_INCIDENT_CHANNEL", NONE),
      disputes: unknown("NOT_IMPLEMENTED", "code", "NO_DISPUTE_CHANNEL", NONE),
    },

    anchor: {
      document: known("INFORMATIONAL", "code", input.documentPath, NONE),
      hash: known("INFORMATIONAL", "code", "SHA256_CANONICAL_JSON", code("lib/guard/canonical-json.ts", "canonicalJson")),
      onchain: unknown("NOT_IMPLEMENTED", "code", "HASH_NOT_ONCHAIN", NONE),
      tokenMetadata: unknown("NOT_IMPLEMENTED", "code", "METADATA_FIXED_BEFORE", NONE),
    },

    price: {
      promise: known("INFORMATIONAL", "code", "NONE", code(SPEC, "§8.2")),
      ladderIsFloor: known("INFORMATIONAL", "flag", false, code(SPEC, "§8.2")),
    },

    lifecycle: {
      states: known("INFORMATIONAL", "list", MARKET_CYCLE_STATES.map((state) => ({ state, product: MARKET_STATE_PROJECTION[state].product, reason: MARKET_STATE_PROJECTION[state].reason })), code("lib/core/launch/market-health.ts", "MARKET_CYCLE_STATES")),
      maturity: known("SERVER_POLICY", "seconds", MATURE_AFTER_SECONDS, code("lib/core/launch/market-health.ts", "MATURE_AFTER_SECONDS")),
    },
  };
  return document;
}

/** The exact bytes the hash is of: the document as canonical JSON. */
export function constitutionCanonicalJson(document: MarketConstitution): string {
  return canonicalJson(document);
}

/** Every field of the document by its section, in the order the sections are read. */
export function constitutionFields(document: MarketConstitution): readonly Readonly<{ section: ConstitutionSection; key: string; field: ConstitutionField }>[] {
  return CONSTITUTION_SECTIONS.flatMap((section) => Object.entries(document[section]).map(([key, field]) => ({ section, key, field })));
}
