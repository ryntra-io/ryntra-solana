/**
 * A launch in a pair with a tokenized stock — the register of checked pair currencies.
 *
 * Meteora's DBC takes a Token-2022 mint as the pair currency of a curve from program 0.2.1 (09.09), and from 0.2.2 one
 * whose transfers carry a fee as well — but only through `createConfig2`: the older path refuses such a mint outright.
 * So the version of the config is not a choice, it is a fact of the mint: a fee in force, a fee scheduled, or an
 * authority that may still set one, and the launch needs 0.2.2; nothing of the three, and 0.2.1 is enough.
 *
 * A badge is Meteora's own: only its operator creates one, Ryntra never can, and the program needs it for every quote
 * mint that is not permissionless — which a tokenized stock, with its scaled unit and its issuer's powers, never is. So
 * the badge is read on chain first, and a pair with no badge is not offered at all. And the badge binds nothing: by
 * Meteora's own documentation it stores the mint, not its fee, so the issuer may change the fee, an authority or an
 * extension the day after it was given. That is what this register is for.
 *
 * One record per mint holds what was read on chain — the token program, the decimals, every Token-2022 extension by the
 * program's own number, the fee in force and the one scheduled, the authorities, the scaled unit's multiplier, the badge
 * — and what the price must be: where it comes from and how old it may be. Every launch on that pair reads the mint
 * again and holds it against the record, and **any difference closes the launch**: a refusal with a plain word, never a
 * warning beside a button. A mint that could not be read closes it too — unknown is not good.
 *
 * Two facts of a mint are refused whatever the record says, because Ryntra could not trade such a market at all: a
 * transfer hook on the pair currency (the venue's own swap and claim refuse a pool with one) and new accounts frozen by
 * default (a buyer could not receive what they bought).
 *
 * The figures a creator reads before signing are counted here too: the threshold in the pair's own units and in
 * dollars, and the liquidity that reaches the DEX after every fee on the way — the move's own fee and what the issuer's
 * mint withholds on the transfer into the pool. The dollars are of the price read at that moment, and its age is said
 * with it.
 *
 * Nothing here names an issuer, an underlying company or a kind of asset, and the public view of a record carries the
 * mint, the symbol and the decimals and nothing else: a launch on such a pair reads on its page exactly as a launch on
 * any other pair. The limits on issuers live in the documents (decision 38), never in a surface.
 *
 * Pure and client-safe. The mints are never written here: the operator names them (O-03, O-04) and a deployment carries
 * them in its own configuration.
 */

import { scaledAmountString } from "../../stocks/units.ts";

/** The environment variable that offers the format; `open` — offered, anything else — not. */
export const QUOTE_ASSET_FLAG = "RYNTRA_LAUNCH_QUOTE_ASSETS";

/** Where the deployment carries the operator's checked records — a JSON array of them. */
export const QUOTE_ASSET_REGISTRY_ENV = "RYNTRA_LAUNCH_QUOTE_ASSETS_REGISTRY";

/**
 * Token-2022's extensions by the token program's own numbers (`ExtensionType`), named here so a library renaming one
 * changes nothing. `quote-asset.test.mjs` holds them against `@solana/spl-token`.
 */
export const EXTENSION = {
  TRANSFER_FEE_CONFIG: 1,
  MINT_CLOSE_AUTHORITY: 3,
  DEFAULT_ACCOUNT_STATE: 6,
  PERMANENT_DELEGATE: 12,
  TRANSFER_HOOK: 14,
  METADATA_POINTER: 18,
  TOKEN_METADATA: 19,
  SCALED_UI_AMOUNT: 25,
  PAUSABLE: 26,
} as const;

/**
 * The extensions DBC needs no badge for (the program's `get_mint_score`): a mint carrying only these, and no fee and no
 * live fee authority, is permissionless. Anything else — a scaled unit, a permanent delegate — needs Meteora's badge.
 */
export const DBC_PERMISSIONLESS_EXTENSIONS: readonly number[] = Object.freeze([
  EXTENSION.TRANSFER_FEE_CONFIG,
  EXTENSION.METADATA_POINTER,
  EXTENSION.TOKEN_METADATA,
]);

/** The two facts that make a mint untradeable as a pair currency here, whatever else holds. */
export const FORBIDDEN_QUOTE_EXTENSIONS: readonly number[] = Object.freeze([EXTENSION.TRANSFER_HOOK]);

/** How old the pair currency's price may be, in seconds, and the most the operator's record may allow. */
export const QUOTE_PRICE_MAX_AGE_SECONDS = 300;
export const QUOTE_PRICE_MAX_AGE_CEILING_SECONDS = 900;

/** The DBC program version a config takes, decided by the mint's fee. */
export const QUOTE_CONFIG_VERSIONS = ["0.2.1", "0.2.2"] as const;
export type QuoteConfigVersion = (typeof QUOTE_CONFIG_VERSIONS)[number];

/** The SDK each version is built through: 0.2.2's `createConfig2` lives in 2.0.0 alone. */
export const QUOTE_CONFIG_SDK: Readonly<Record<QuoteConfigVersion, string>> = Object.freeze({ "0.2.1": "1.5.13", "0.2.2": "2.0.0" });

/** One epoch's transfer fee of a mint, as the token program stores it. */
export type QuoteEpochFee = Readonly<{ epoch: string; bps: number; maxRaw: string }>;

/** A mint's `TransferFeeConfig` as the register keeps it: the two rates with their epochs and the two authorities. */
export type QuoteTransferFee = Readonly<{ authority: string | null; withdrawAuthority: string | null; older: QuoteEpochFee; newer: QuoteEpochFee }>;

/** What a mint says about itself — the shape `mintProfileOf` reads from its bytes (`../../solana/mint-profile.ts`). */
export type QuoteMintFacts = Readonly<{
  program: "spl-token" | "token-2022" | "other" | "missing";
  decimals: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** The extensions by the program's numbers, as strings, ascending. */
  extensions: readonly string[];
  transferFee: QuoteTransferFee | null;
  permanentDelegate: string | null;
  defaultAccountState: "initialized" | "frozen" | "uninitialized" | null;
  transferHook: Readonly<{ authority: string | null; program: string | null }> | null;
  closeAuthority: string | null;
  pausable: Readonly<{ authority: string | null; paused: boolean }> | null;
}>;

/** The scaled unit of a mint: how much of the unit a page counts one token as, now and from when. */
export type QuoteMultiplier = Readonly<{ current: number; pending: number | null; effectiveAt: string | null }>;

/**
 * One checked pair currency, as the operator names it — every field read on chain at the time of the check, so a later read
 * that differs is a difference this code can see. `note` is the operator's own word to the operator and never leaves the
 * server.
 */
export type QuoteAssetRecord = Readonly<{
  mint: string;
  /** The symbol a page says — the mint's own, nothing about what stands behind it. */
  symbol: string;
  program: "spl-token" | "token-2022";
  decimals: number;
  /** Every extension on the mint, by the program's numbers, ascending. */
  extensions: readonly number[];
  /** The fee as read: in force, scheduled, and who may change or withdraw it; null — the mint carries no fee at all. */
  transferFee: Readonly<{ bps: number; scheduledBps: number; authority: string | null; withdrawAuthority: string | null }> | null;
  /** The authorities as read; each null where the mint names none. */
  authorities: Readonly<{ mint: string | null; freeze: string | null; permanentDelegate: string | null; close: string | null; transferHook: string | null }>;
  /** The default state of a new account of this mint, where the mint sets one. */
  defaultAccountState: "initialized" | "frozen" | "uninitialized" | null;
  /** The scaled unit's multiplier as read; 1 — one token is one unit. */
  multiplier: number;
  /** Whether Meteora's badge was seen for this mint. A badge is Meteora's to create; Ryntra only reads it. */
  badge: boolean;
  /** How old this pair's price may be when a launch is built, in seconds. */
  priceMaxAgeSeconds: number;
  /** The operator's note — for the operator; never part of a public answer. */
  note: string | null;
}>;

/** What one read of the chain and the price says about a pair currency now. */
export type QuoteAssetObservation = Readonly<{
  /** The mint as read; null — it was not read, and then nothing is offered. */
  facts: QuoteMintFacts | null;
  /** Whether Meteora's badge account is there, owned by the DBC program; null — it could not be read. */
  badge: boolean | null;
  /** The epoch the read was made in — the rate in force follows from it. */
  epoch: bigint | null;
  /** The scaled unit as read; null — the mint carries no such extension, which is a multiplier of one. */
  multiplier: QuoteMultiplier | null;
  /** The price of one token in dollars, and when it was observed; null — unknown. */
  priceUsd: number | null;
  priceAt: string | null;
}>;

export const QUOTE_ASSET_REFUSALS = [
  "MINT_NOT_READ",
  "PROGRAM_NOT_REGISTERED",
  "DECIMALS_CHANGED",
  "EXTENSIONS_CHANGED",
  "EXTENSION_FORBIDDEN",
  "BADGE_MISSING",
  "BADGE_NOT_READ",
  "TRANSFER_FEE_CHANGED",
  "AUTHORITY_CHANGED",
  "MULTIPLIER_CHANGED",
  "MULTIPLIER_PENDING",
  "PRICE_UNKNOWN",
  "PRICE_STALE",
  "CONFIG_VERSION_UNAVAILABLE",
] as const;
export type QuoteAssetRefusal = (typeof QUOTE_ASSET_REFUSALS)[number];

/** Why each refusal closes the launch, in a plain line a form and a route both say. */
export const QUOTE_ASSET_REASONS: Readonly<Record<QuoteAssetRefusal, string>> = Object.freeze({
  MINT_NOT_READ: "the pair currency's mint could not be read, so nothing about it is known now",
  PROGRAM_NOT_REGISTERED: "the mint belongs to another token program than the one checked",
  DECIMALS_CHANGED: "the mint's decimals are not the ones checked",
  EXTENSIONS_CHANGED: "the mint carries an extension that was not there when it was checked, or lost one that was",
  EXTENSION_FORBIDDEN: "a pair currency with a transfer hook, or one whose new accounts start frozen, cannot be traded here",
  BADGE_MISSING: "Meteora has given this mint no token badge, and only Meteora can give one",
  BADGE_NOT_READ: "the token badge could not be read, so its presence is unknown now",
  TRANSFER_FEE_CHANGED: "the issuer changed the transfer fee in force or the one scheduled",
  AUTHORITY_CHANGED: "an authority over the mint is not the one checked",
  MULTIPLIER_CHANGED: "the issuer changed what one token of the pair currency stands for",
  MULTIPLIER_PENDING: "the issuer has scheduled a change to what one token stands for, so the figures would not hold",
  PRICE_UNKNOWN: "the pair currency's price is not known now, so the curve cannot be set in dollars",
  PRICE_STALE: "the pair currency's price is older than this pair allows",
  CONFIG_VERSION_UNAVAILABLE: "a pair currency whose transfers carry a fee needs DBC 0.2.2, which this deployment does not build on",
});

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACCOUNT_STATES = ["initialized", "frozen", "uninitialized"] as const;

/* ------------------------------------------------------------- the program's own rules */

/** Whether a mint's fee is zero in the epoch given — the token program's rule: either part at zero is no fee. */
function zeroFee(fee: QuoteEpochFee): boolean {
  return fee.bps === 0 || BigInt(fee.maxRaw) === 0n;
}

/**
 * Whether the mint carries a transfer fee the program must reckon with — its rule, mirrored
 * (`hasTransferFeeOrConfigAuthority` of the SDK): an authority that may still set a rate counts even at 0 bps, because
 * the rate could be set between the config and the pool.
 */
export function quoteFeeLive(facts: Pick<QuoteMintFacts, "transferFee">, epoch: bigint): boolean {
  const fee = facts.transferFee;
  if (!fee) return false;
  if (fee.authority !== null) return true;
  if (epoch < BigInt(fee.newer.epoch)) return !zeroFee(fee.older) || !zeroFee(fee.newer);
  return !zeroFee(fee.newer);
}

/** The rate a transfer pays in the epoch given, basis points, and the mint's cap on one transfer's fee. */
export function quoteFeeAt(fee: QuoteTransferFee, epoch: bigint): QuoteEpochFee {
  return epoch >= BigInt(fee.newer.epoch) ? fee.newer : fee.older;
}

/**
 * Whether Meteora's badge is needed for this mint — the program's `get_mint_score`, mirrored: only a mint whose every
 * extension is one of the permissionless three, and which carries no live fee, goes without one.
 */
export function quoteBadgeRequired(facts: Pick<QuoteMintFacts, "extensions" | "transferFee">, epoch: bigint): boolean {
  if (quoteFeeLive(facts, epoch)) return true;
  return !facts.extensions.every((extension) => DBC_PERMISSIONLESS_EXTENSIONS.includes(Number(extension)));
}

/**
 * The DBC version a config on this pair currency needs: 0.2.2 — `createConfig2` — for a mint with a live fee, 0.2.1 for
 * one without. The older path refuses such a mint itself, so this is a fact to read, never a setting.
 */
export function quoteConfigVersion(facts: Pick<QuoteMintFacts, "transferFee">, epoch: bigint): QuoteConfigVersion {
  return quoteFeeLive(facts, epoch) ? "0.2.2" : "0.2.1";
}

/* ------------------------------------------------------------- the register's rule */

const sameKeys = (a: readonly number[], b: readonly string[]): boolean => {
  const read = [...b].map(Number).sort((x, y) => x - y);
  const known = [...a].sort((x, y) => x - y);
  return known.length === read.length && known.every((value, index) => value === read[index]);
};

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9;

/**
 * Why this pair currency may not be launched against now, each refusal once, the badge first — it is the one thing
 * Ryntra cannot obtain and the first thing to read. Empty — the mint reads as it was checked, its badge is there, its
 * price is fresh, and this deployment builds the version its fee needs.
 */
export function quoteAssetProblems(
  record: QuoteAssetRecord,
  observed: QuoteAssetObservation,
  options: Readonly<{ nowMs: number; sdk: string }>,
): readonly QuoteAssetRefusal[] {
  const problems: QuoteAssetRefusal[] = [];
  if (observed.badge === null) problems.push("BADGE_NOT_READ");
  else if (!observed.badge) problems.push("BADGE_MISSING");
  const facts = observed.facts;
  if (!facts || facts.program === "missing" || observed.epoch === null) {
    problems.push("MINT_NOT_READ");
    return problems;
  }
  const epoch = observed.epoch;
  if (facts.program !== record.program) problems.push("PROGRAM_NOT_REGISTERED");
  if (facts.decimals !== record.decimals) problems.push("DECIMALS_CHANGED");
  if (!sameKeys(record.extensions, facts.extensions)) problems.push("EXTENSIONS_CHANGED");
  /* Not the issuer's powers as such — those are read and recorded — but the two a market could not live with. */
  const forbidden = facts.extensions.some((extension) => FORBIDDEN_QUOTE_EXTENSIONS.includes(Number(extension)));
  if (forbidden || facts.transferHook?.program || facts.defaultAccountState === "frozen") problems.push("EXTENSION_FORBIDDEN");
  const fee = facts.transferFee;
  const recorded = record.transferFee;
  if ((fee === null) !== (recorded === null)) problems.push("TRANSFER_FEE_CHANGED");
  else if (fee && recorded) {
    const inForce = quoteFeeAt(fee, epoch).bps;
    const scheduled = fee.newer.bps;
    if (inForce !== recorded.bps || scheduled !== recorded.scheduledBps) problems.push("TRANSFER_FEE_CHANGED");
    if (fee.authority !== recorded.authority || fee.withdrawAuthority !== recorded.withdrawAuthority) problems.push("AUTHORITY_CHANGED");
  }
  const authorities = record.authorities;
  /* Everything the issuer holds over the mint, the default state of a new account among it: a change in any of them. */
  const changed =
    facts.mintAuthority !== authorities.mint ||
    facts.freezeAuthority !== authorities.freeze ||
    facts.permanentDelegate !== authorities.permanentDelegate ||
    facts.closeAuthority !== authorities.close ||
    (facts.transferHook?.authority ?? null) !== authorities.transferHook ||
    (facts.defaultAccountState ?? null) !== record.defaultAccountState;
  if (changed && !problems.includes("AUTHORITY_CHANGED")) problems.push("AUTHORITY_CHANGED");
  const multiplier = observed.multiplier;
  if (!sameNumber(multiplier?.current ?? 1, record.multiplier)) problems.push("MULTIPLIER_CHANGED");
  if (multiplier && multiplier.pending !== null) problems.push("MULTIPLIER_PENDING");
  if (observed.priceUsd === null || !(observed.priceUsd > 0) || observed.priceAt === null) problems.push("PRICE_UNKNOWN");
  else {
    const at = Date.parse(observed.priceAt);
    if (!Number.isFinite(at) || options.nowMs - at > record.priceMaxAgeSeconds * 1000) problems.push("PRICE_STALE");
  }
  if (QUOTE_CONFIG_SDK[quoteConfigVersion(facts, epoch)] !== options.sdk) problems.push("CONFIG_VERSION_UNAVAILABLE");
  return problems;
}

/** The refusals in one sentence — the plain word a creator reads instead of a code. */
export function quoteAssetRefusalWords(problems: readonly QuoteAssetRefusal[]): string {
  return problems.map((problem) => QUOTE_ASSET_REASONS[problem]).join("; ");
}

/* ------------------------------------------------------------- the operator's records */

const key = (value: unknown): string | null => (typeof value === "string" && BASE58.test(value) ? value : null);
const optionalKey = (value: unknown): string | null | undefined => (value === null ? null : key(value) ?? undefined);

/** One record as the operator's configuration carries it; null for anything incomplete — a guessed field is not a check. */
export function quoteAssetRecordOf(value: unknown): QuoteAssetRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const mint = key(row.mint);
  if (!mint) return null;
  if (typeof row.symbol !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(row.symbol)) return null;
  if (row.program !== "token-2022" && row.program !== "spl-token") return null;
  if (typeof row.decimals !== "number" || !Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 18) return null;
  if (!Array.isArray(row.extensions) || !row.extensions.every((entry) => typeof entry === "number" && Number.isInteger(entry) && entry >= 0)) return null;
  if (typeof row.multiplier !== "number" || !Number.isFinite(row.multiplier) || row.multiplier <= 0) return null;
  if (typeof row.badge !== "boolean") return null;
  const age = row.priceMaxAgeSeconds;
  if (typeof age !== "number" || !Number.isInteger(age) || age <= 0 || age > QUOTE_PRICE_MAX_AGE_CEILING_SECONDS) return null;
  const state = row.defaultAccountState ?? null;
  if (state !== null && !(ACCOUNT_STATES as readonly unknown[]).includes(state)) return null;
  const authoritiesRow = row.authorities;
  if (!authoritiesRow || typeof authoritiesRow !== "object") return null;
  const a = authoritiesRow as Record<string, unknown>;
  const authorities = { mint: optionalKey(a.mint), freeze: optionalKey(a.freeze), permanentDelegate: optionalKey(a.permanentDelegate), close: optionalKey(a.close), transferHook: optionalKey(a.transferHook) };
  if (Object.values(authorities).some((entry) => entry === undefined)) return null;
  let transferFee: QuoteAssetRecord["transferFee"] = null;
  if (row.transferFee !== null && row.transferFee !== undefined) {
    if (typeof row.transferFee !== "object") return null;
    const f = row.transferFee as Record<string, unknown>;
    const bps = f.bps;
    const scheduledBps = f.scheduledBps;
    if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > 10_000) return null;
    if (typeof scheduledBps !== "number" || !Number.isInteger(scheduledBps) || scheduledBps < 0 || scheduledBps > 10_000) return null;
    const authority = optionalKey(f.authority);
    const withdrawAuthority = optionalKey(f.withdrawAuthority);
    if (authority === undefined || withdrawAuthority === undefined) return null;
    transferFee = { bps, scheduledBps, authority, withdrawAuthority };
  }
  const note = row.note === undefined || row.note === null ? null : typeof row.note === "string" ? row.note.slice(0, 500) : null;
  return Object.freeze({
    mint,
    symbol: row.symbol,
    program: row.program,
    decimals: row.decimals,
    extensions: Object.freeze([...(row.extensions as number[])].sort((x, y) => x - y)),
    transferFee: transferFee ? Object.freeze(transferFee) : null,
    authorities: Object.freeze(authorities as QuoteAssetRecord["authorities"]),
    defaultAccountState: state as QuoteAssetRecord["defaultAccountState"],
    multiplier: row.multiplier,
    badge: row.badge,
    priceMaxAgeSeconds: age,
    note,
  });
}

/**
 * The records a deployment carries: the operator's JSON array, each record whole, one per mint. Anything malformed is left
 * out rather than guessed, and a registry that is not an array offers nothing.
 */
export function quoteAssetRecords(raw: string | undefined): readonly QuoteAssetRecord[] {
  const text = raw?.trim();
  if (!text) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: QuoteAssetRecord[] = [];
  for (const row of value) {
    const record = quoteAssetRecordOf(row);
    if (record && !out.some((known) => known.mint === record.mint)) out.push(record);
  }
  return Object.freeze(out);
}

/** Whether the format is offered on this deployment at all: the flag open and at least one checked record. */
export function quoteAssetsOffered(env: Readonly<Record<string, string | undefined>>): readonly QuoteAssetRecord[] {
  if ((env[QUOTE_ASSET_FLAG] ?? "").trim() !== "open") return [];
  return quoteAssetRecords(env[QUOTE_ASSET_REGISTRY_ENV]);
}

/** What a page may read of a record: the pair as any other pair — nothing of the issuer, the underlying or the note. */
export const QUOTE_ASSET_PUBLIC_FIELDS = ["mint", "symbol", "decimals"] as const;

export type PublicQuoteAsset = Readonly<{ mint: string; symbol: string; decimals: number }>;

export function publicQuoteAsset(record: QuoteAssetRecord): PublicQuoteAsset {
  return { mint: record.mint, symbol: record.symbol, decimals: record.decimals };
}

/* ------------------------------------------------------------- the figures before the signature */

/** One amount of the pair currency: raw, in the pair's own units, and in dollars at the price read. */
export type QuoteAmount = Readonly<{ raw: string; units: string; usd: number | null }>;

/**
 * The fee the mint withholds on one transfer of `grossRaw` — the token program's rule with the mint's own cap, which a
 * launch's own token never has (`./transfer-fee.ts`) but an issuer's token may.
 */
export function quoteTransferFeeOn(grossRaw: bigint, fee: Readonly<{ bps: number; maxRaw: string }> | null): bigint {
  if (!fee || grossRaw <= 0n || fee.bps <= 0) return 0n;
  const withheld = (grossRaw * BigInt(fee.bps) + 9_999n) / 10_000n;
  const cap = BigInt(fee.maxRaw);
  return withheld > cap ? cap : withheld;
}

/** An amount in the three ways it is said: raw, in units of the pair (one token is `multiplier` of them) and in dollars. */
export function quoteAmountOf(raw: bigint, args: Readonly<{ decimals: number; multiplier: number; usdPrice: number | null }>): QuoteAmount {
  const amount = raw < 0n ? 0n : raw;
  const units = scaledAmountString(amount, args.decimals, args.multiplier);
  /* The dollars are of the token, not of the unit — the price read is a price of one token — and at the mint's own scale. */
  const tokens = Number(scaledAmountString(amount, args.decimals, 1, args.decimals));
  const usd = args.usdPrice !== null && args.usdPrice > 0 && Number.isFinite(tokens) ? tokens * args.usdPrice : null;
  return { raw: amount.toString(), units, usd };
}

/** What a launch on this pair raises and what of it reaches the DEX, each after the fees on its way. */
export type QuoteLaunchFigures = Readonly<{
  /** The pair currency a curve must raise before it moves to the DEX. */
  threshold: QuoteAmount;
  /** The fee of the move itself, taken from the threshold. */
  graduationFee: QuoteAmount;
  /** What the issuer's mint withholds on the transfer into the pool. */
  transferFeeOnExit: QuoteAmount;
  /** What is left as liquidity in the pool — after both. */
  exitLiquidity: QuoteAmount;
  /** The price the dollars are of, and when it was observed. */
  priceUsd: number | null;
  priceAt: string | null;
}>;

/**
 * The threshold and the liquidity at the exit, counted in the pair's units and in dollars. The move to the DEX takes its
 * own fee from what the curve raised, and what is then sent to the pool is a transfer of the issuer's token, so the mint
 * withholds its rate of it as of any other transfer; both come off before anything is liquidity.
 *
 * The figure holds for the fee read now. A fee the issuer raises before the move would leave less in the pool — by
 * Meteora's own documentation the move counts the amounts after the fee and may not go through at all — which is why a
 * changed fee closes a launch on this pair instead of warning about it.
 */
export function quoteLaunchFigures(
  args: Readonly<{ thresholdRaw: bigint; graduationFeePct: number; fee: Readonly<{ bps: number; maxRaw: string }> | null; decimals: number; multiplier: number; usdPrice: number | null; priceAt: string | null }>,
): QuoteLaunchFigures {
  const amount = (raw: bigint) => quoteAmountOf(raw, { decimals: args.decimals, multiplier: args.multiplier, usdPrice: args.usdPrice });
  const threshold = args.thresholdRaw > 0n ? args.thresholdRaw : 0n;
  /*
   * What the move sends to the pool, by the program's own rule (`getMigrationQuoteAmountFromThreshold` of the SDK): the
   * whole percentages of the threshold that are not the fee, rounded up — the fee is what is left of it.
   */
  const pct = BigInt(Math.min(100, Math.max(0, Math.trunc(args.graduationFeePct))));
  const toPool = threshold === 0n ? 0n : (threshold * (100n - pct) + 99n) / 100n;
  const graduationFee = threshold - toPool;
  const withheld = quoteTransferFeeOn(toPool, args.fee);
  return {
    threshold: amount(threshold),
    graduationFee: amount(graduationFee),
    transferFeeOnExit: amount(withheld),
    exitLiquidity: amount(toPool - withheld),
    priceUsd: args.usdPrice,
    priceAt: args.priceAt,
  };
}
