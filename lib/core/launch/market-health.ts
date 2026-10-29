/**
 * A Ryntra market's health — what «Лаунчі на Ryntra», the token's page and the
 * API say about a launched market — from what the chain shows: the curve and
 * the pool it graduated into, Ryntra's steps in a DLMM pool, the token's
 * accounts, and the records of the executor's acts.
 *
 * Every figure has one fixed definition, written here and nowhere else, so a
 * terminal reading the same chain can repeat it:
 *
 * - **the market's state** — one of ten states of its cycle and two of
 *   failure (`marketCycleState`), derived from the chain before every read;
 * - **executable depth at −2 / −5 / −10 %** — the pair currency the market
 *   pays out while sales move the price that far down: on the curve, what the
 *   DBC curve releases between the two prices; after graduation, what the DAMM
 *   v2 pool releases plus what Ryntra's DLMM steps hold at or above the lower
 *   price. The pools' own fee is not taken off; other venues are not counted;
 * - **holders** — wallets whose balance is worth more than $1 at the price now,
 *   without pools, locks and Ryntra's own wallets; from every account of the
 *   mint, or — where the node will not list them all — the ones found, a floor;
 * - **concentration** — the ten largest balances without pools and locks, as a
 *   share of the tokens outside pools and locks; from every account, or from
 *   the mint's largest accounts over its supply less the pools and the locks —
 *   then a floor;
 * - **rules and policies** — what keeps the market, each marked by who keeps
 *   it: a rule a program enforces (Token-2022, Meteora's or a lock's), or a
 *   policy Ryntra's server runs — listed only while it runs.
 *
 * Whatever was not read is said as not read — `null`, never a zero.
 *
 * Pure and client-safe: the chain is read by `lib/launch/health.server.ts`.
 */

/** The ten states of a market's cycle and its two states of failure. */
export const MARKET_CYCLE_STATES = [
  "CREATED",
  "PRICE_DISCOVERY",
  "GRADUATION_READY",
  "MIGRATING",
  "CORE_MARKET_LIVE",
  "ENDOWMENT_FUNDED",
  "LADDER_ACTIVE",
  "MAINTAINING",
  "PAUSED_RISK",
  "MATURE",
  "MIGRATION_FAILED",
  "ENDOWMENT_EXHAUSTED",
] as const;
export type MarketCycleState = (typeof MARKET_CYCLE_STATES)[number];

/** How far along the cycle a state stands — the order a list ranks markets by within «live» and «quiet». */
export const CYCLE_RANK: Readonly<Record<MarketCycleState, number>> = Object.freeze({
  CREATED: 0,
  PRICE_DISCOVERY: 1,
  GRADUATION_READY: 2,
  MIGRATING: 3,
  MIGRATION_FAILED: 3,
  CORE_MARKET_LIVE: 4,
  ENDOWMENT_FUNDED: 5,
  ENDOWMENT_EXHAUSTED: 5,
  LADDER_ACTIVE: 6,
  MAINTAINING: 7,
  PAUSED_RISK: 7,
  MATURE: 8,
});

/** A full curve not migrated after this long is a graduation that did not go through: anyone may send it again. */
export const MIGRATION_LATE_SECONDS = 10 * 60;

/**
 * A market this long on the DEX is mature (the decision of 2026-10-09: until a market's own constitution sets
 * thresholds of depth and holders, maturity is the time on the DEX alone).
 */
export const MATURE_AFTER_SECONDS = 30 * 86_400;

/** `migration_progress` of a Meteora DBC curve. */
export const DBC_MIGRATION_PROGRESS = Object.freeze({ PRE_BONDING_CURVE: 0, POST_BONDING_CURVE: 1, LOCKED_VESTING: 2, CREATED_POOL: 3 });

export type CycleInput = Readonly<{
  migrated: boolean;
  /** The curve's `migration_progress`; null when not read. */
  migrationProgress: number | null;
  reserveRaw: bigint;
  thresholdRaw: bigint;
  /** When the curve was filled for the DEX, unix seconds; null while it is not. */
  finishedAt: number | null;
  /** The launch's creation, unix seconds. */
  launchedAt: number;
  /** A trade on the curve by a wallet other than the creator: seen (with its time when known), not there (`false` — the whole history was read), or not known. */
  foreignTrade: Readonly<{ seen: boolean | null; at: number | null }>;
  /** When the market reached the DEX, unix seconds; null before or when not known. */
  graduatedAt: number | null;
  /** Ryntra's steps on this market: placed, and maintained (moved up or added to) since. */
  ladder: Readonly<{ placedAt: number | null; maintainedAt: number | null }>;
  /** The market's budget as the executor accounts it: funded or exhausted; null while it is not accounted. */
  budget: Readonly<{ state: "FUNDED" | "EXHAUSTED"; at: number | null }> | null;
  /** A pause of Ryntra's acts on this market — a risk limit, or the operator's stop; null when there is none. */
  pause: Readonly<{ at: number | null }> | null;
  /**
   * A migration the executor sent and the chain has not confirmed yet. A DAMM v2 migration is one transaction, so the
   * chain itself never shows one half done: without the executor's record of a send in flight this is false.
   */
  migrationSent?: boolean;
  /**
   * When the executor's last graduation of a full curve failed — refused, failed on chain or expired unseen — and it has
   * not gone through since; the executor sends it again. Absent or null when none failed.
   */
  migrationFailedAt?: number | null;
  now: number;
}>;

export type CycleRead = Readonly<{ state: MarketCycleState; since: number | null }>;

/**
 * The market's state now, from the chain and the executor's records. On the curve: created, then price discovery from
 * the first trade of a wallet other than the creator's — a history too long to read whole counts as traded —, then ready
 * for the DEX once the curve is full (its `migration_progress` past the curve, or its reserve at the threshold),
 * migrating only while the executor's own migration is in flight, and a failed migration when a full curve has waited
 * longer than `MIGRATION_LATE_SECONDS` or the executor's own graduation of it failed. After the DEX: the core market, the
 * budget funded, the ladder placed, then maintained, and mature after `MATURE_AFTER_SECONDS` on the DEX; a pause or an
 * exhausted budget overrides. A state the executor has not recorded is never inferred.
 */
export function marketCycleState(input: CycleInput): CycleRead {
  if (input.pause) return { state: "PAUSED_RISK", since: input.pause.at };
  if (!input.migrated) {
    /* A full curve: Meteora marks it past the curve (1, or 2 when no locker is needed — every Ryntra preset), and its finish time. */
    const full =
      input.finishedAt !== null ||
      (input.migrationProgress !== null && input.migrationProgress >= DBC_MIGRATION_PROGRESS.POST_BONDING_CURVE) ||
      (input.thresholdRaw > 0n && input.reserveRaw >= input.thresholdRaw);
    if (full && input.migrationSent) return { state: "MIGRATING", since: input.finishedAt };
    if (full && input.migrationFailedAt != null) return { state: "MIGRATION_FAILED", since: input.migrationFailedAt };
    if (full) {
      if (input.finishedAt !== null && input.now - input.finishedAt > MIGRATION_LATE_SECONDS) return { state: "MIGRATION_FAILED", since: input.finishedAt + MIGRATION_LATE_SECONDS };
      return { state: "GRADUATION_READY", since: input.finishedAt };
    }
    if (input.foreignTrade.seen === false) return { state: "CREATED", since: input.launchedAt };
    return { state: "PRICE_DISCOVERY", since: input.foreignTrade.at };
  }
  if (input.budget?.state === "EXHAUSTED") return { state: "ENDOWMENT_EXHAUSTED", since: input.budget.at };
  if (input.graduatedAt !== null && input.now - input.graduatedAt >= MATURE_AFTER_SECONDS) return { state: "MATURE", since: input.graduatedAt + MATURE_AFTER_SECONDS };
  if (input.ladder.maintainedAt !== null) return { state: "MAINTAINING", since: input.ladder.maintainedAt };
  if (input.ladder.placedAt !== null) return { state: "LADDER_ACTIVE", since: input.ladder.placedAt };
  if (input.budget?.state === "FUNDED") return { state: "ENDOWMENT_FUNDED", since: input.budget.at };
  return { state: "CORE_MARKET_LIVE", since: input.graduatedAt };
}

/* ------------------------------------------------------------ executable depth */

/** The drops executable depth is measured at, basis points of the price now. */
export const DEPTH_DROPS_BPS = [200, 500, 1000] as const;
export type DepthDropBps = (typeof DEPTH_DROPS_BPS)[number];

const ONE_E18 = 10n ** 18n;
const Q128 = 1n << 128n;

/** ⌊√n⌋ of a non-negative bigint (Newton's method). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("No square root of a negative number.");
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length + 1) >> 1n);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** √(1 − drop), scaled by 10¹⁸: the factor a square-root price moves by when the price falls by `dropBps`. */
export function sqrtDropFactor(dropBps: number): bigint {
  if (!Number.isInteger(dropBps) || dropBps <= 0 || dropBps >= 10_000) throw new Error("A drop is a whole number of basis points between 0 and 10 000.");
  return isqrt(BigInt(10_000 - dropBps) * 10n ** 32n);
}

/** One segment of a DBC curve as its config writes it: the square-root price it reaches (Q64.64) and its liquidity. */
export type CurvePoint = Readonly<{ sqrtPrice: bigint; liquidity: bigint }>;

/** The pair currency a DBC curve holds at a square-root price — Meteora's own `getQuoteReserveFromNextSqrtPrice`, rounded down. */
export function curveQuoteAt(sqrtPrice: bigint, sqrtStartPrice: bigint, points: readonly CurvePoint[]): bigint {
  let total = 0n;
  for (let index = 0; index < points.length; index += 1) {
    const lower = index === 0 ? sqrtStartPrice : points[index - 1]!.sqrtPrice;
    if (sqrtPrice <= lower) continue;
    const point = points[index]!;
    const upper = sqrtPrice < point.sqrtPrice ? sqrtPrice : point.sqrtPrice;
    total += (point.liquidity * (upper - lower)) / Q128;
  }
  return total;
}

/** On the curve: what it releases while sales move its price `dropBps` down. */
export function curveDepthRaw(args: Readonly<{ sqrtPrice: bigint; sqrtStartPrice: bigint; points: readonly CurvePoint[] }>, dropBps: number): bigint {
  const lower = (args.sqrtPrice * sqrtDropFactor(dropBps)) / ONE_E18;
  const now = curveQuoteAt(args.sqrtPrice, args.sqrtStartPrice, args.points);
  const after = curveQuoteAt(lower, args.sqrtStartPrice, args.points);
  return now > after ? now - after : 0n;
}

/** A DAMM v2 pool as its account states it, the token on side A or B. */
export type DammPoolDepthInput = Readonly<{
  /** `collect_fee_mode` 2: the pool compounds and prices by its two reserves (x · y = k). */
  compounding: boolean;
  tokenIsA: boolean;
  pairReserveRaw: bigint;
  sqrtPrice: bigint;
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  liquidity: bigint;
}>;

/**
 * After graduation: what the DAMM v2 pool releases while sales move the token's price `dropBps` down. A compounding pool
 * prices by its reserves, so the pair side gives `y · (1 − √(1 − drop))`; a concentrated one gives its liquidity's
 * amount between the two square-root prices, inside its range.
 */
export function poolDepthRaw(pool: DammPoolDepthInput, dropBps: number): bigint {
  const factor = sqrtDropFactor(dropBps);
  if (pool.compounding) return pool.pairReserveRaw - (pool.pairReserveRaw * factor) / ONE_E18;
  if (pool.liquidity <= 0n || pool.sqrtPrice <= 0n) return 0n;
  if (pool.tokenIsA) {
    /* The token is A, priced in B by √P: a sale moves √P down; the pair (B) out is L·Δ√P >> 128. */
    let lower = (pool.sqrtPrice * factor) / ONE_E18;
    if (lower < pool.sqrtMinPrice) lower = pool.sqrtMinPrice;
    return lower >= pool.sqrtPrice ? 0n : (pool.liquidity * (pool.sqrtPrice - lower)) / Q128;
  }
  /* The token is B, priced in A by 1/P: a sale moves √P up by 1/√(1 − drop); the pair (A) out is L·Δ√P / (√P·√P'). */
  let upper = (pool.sqrtPrice * ONE_E18) / factor;
  if (upper > pool.sqrtMaxPrice) upper = pool.sqrtMaxPrice;
  return upper <= pool.sqrtPrice ? 0n : (pool.liquidity * (upper - pool.sqrtPrice)) / (pool.sqrtPrice * upper);
}

/** One of Ryntra's steps: its price (pair currency per token) and the pair currency it holds. */
export type LadderBin = Readonly<{ price: number; pairRaw: bigint }>;

/** Ryntra's steps a sale reaches before the price is `dropBps` below `priceNow`: every one at or above the lower price. */
export function ladderDepthRaw(bins: readonly LadderBin[], priceNow: number, dropBps: number): bigint {
  if (!(priceNow > 0)) return 0n;
  const floor = priceNow * (1 - dropBps / 10_000);
  /* A hair below the exact price so a step priced exactly at the drop is reached. */
  return bins.reduce((total, bin) => (bin.price >= floor * (1 - 1e-12) && bin.price <= priceNow * (1 + 1e-12) ? total + bin.pairRaw : total), 0n);
}

/* ------------------------------------------------------------ holders and concentration */

/** A token account of the mint as the chain lists it. */
export type MintAccount = Readonly<{ account: string; owner: string; amountRaw: bigint }>;

/** What a holder count and a concentration leave out: pools (by their vault or the program's authority that owns it), locks and Ryntra's own wallets. */
export type HolderExclusions = Readonly<{
  /** Token accounts that are pools' vaults. */
  poolAccounts: ReadonlySet<string>;
  /** Owners that are pools: a program's pool authority, a DLMM pool. */
  poolOwners: ReadonlySet<string>;
  /** Owners that are locks: an escrow. */
  lockOwners: ReadonlySet<string>;
  /** Ryntra's own wallets: its identities and its internal wallets. */
  ryntraOwners: ReadonlySet<string>;
}>;

/** A holder needs more than this in dollars at the price now. */
export const HOLDER_MIN_USD = 1;
/** Concentration above this share of the tokens outside pools and locks is marked. */
export const CONCENTRATION_MARK_BPS = 6_000;

export type HoldersRead = Readonly<{
  /** Wallets worth more than `HOLDER_MIN_USD`, without pools, locks and Ryntra's wallets; null when the dollar price is not known. */
  holders: number | null;
  /** The accounts were not every account of the mint — the ones found: `holders` is a floor. */
  atLeast: boolean;
  /** The ten largest balances without pools and locks, basis points of the tokens outside pools and locks; null when not known. */
  top10Bps: number | null;
  /** `top10Bps` from the mint's largest accounts, not every account: a wallet holding more than one account may be more — a floor. */
  top10AtLeast: boolean;
  /** The tokens outside pools and locks, raw. */
  circulatingRaw: bigint;
}>;

/**
 * Holders and concentration from every account of the mint — or, where the node will not list them all, from the ones
 * found (the largest among them). Balances are merged by owner. A wallet counts as a holder when what it holds is worth
 * more than a dollar at the price now; concentration ranks the same balances, Ryntra's own wallets among them, without
 * pools and locks, as a share of the tokens outside pools and locks.
 */
export function holdersAndConcentration(args: Readonly<{
  accounts: readonly MintAccount[];
  /** False when `accounts` are only the ones found, not every account of the mint: the count is then a floor. */
  whole?: boolean;
  /**
   * With only the ones found: whether they include the mint's largest accounts. Then the ten largest are known, and the
   * tokens outside pools and locks are the supply less every pool's and lock's balance — the share is exact.
   */
  largestRead?: boolean;
  /** The mint's supply, raw — what the tokens outside pools and locks are counted from when not every account was scanned. */
  supplyRaw?: bigint;
  /** Pools whose balance the found accounts may miss — Ryntra's DLMM steps — by owner, with what they hold. */
  poolsNotListed?: readonly Readonly<{ owner: string; amountRaw: bigint }>[];
  exclusions: HolderExclusions;
  tokenDecimals: number;
  /** The token's price in dollars now; null when its pair is not a dollar and no rate is known. */
  usdPerToken: number | null;
}>): HoldersRead {
  const { exclusions } = args;
  const whole = args.whole !== false;
  const byOwner = new Map<string, bigint>();
  const pooledOwners = new Set<string>();
  let pooledRaw = 0n;
  for (const row of args.accounts) {
    if (row.amountRaw <= 0n) continue;
    if (exclusions.poolAccounts.has(row.account) || exclusions.poolOwners.has(row.owner) || exclusions.lockOwners.has(row.owner)) {
      pooledRaw += row.amountRaw;
      pooledOwners.add(row.owner);
      continue;
    }
    byOwner.set(row.owner, (byOwner.get(row.owner) ?? 0n) + row.amountRaw);
  }
  const balances = [...byOwner.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  const top10 = balances.slice(0, 10).reduce((total, [, amount]) => total + amount, 0n);
  let circulatingRaw: bigint | null = null;
  if (whole) circulatingRaw = balances.reduce((total, [, amount]) => total + amount, 0n);
  else if (args.largestRead && args.supplyRaw !== undefined) {
    /* The found accounts hold the vaults and the escrow, read by address; a pool they may miss is taken by what it holds. */
    const missing = (args.poolsNotListed ?? []).filter((pool) => !pooledOwners.has(pool.owner)).reduce((total, pool) => total + pool.amountRaw, 0n);
    circulatingRaw = args.supplyRaw - pooledRaw - missing;
  }
  const top10Bps = circulatingRaw !== null && circulatingRaw > 0n ? Math.min(10_000, Number((top10 * 10_000n) / circulatingRaw)) : null;
  let holders: number | null = null;
  if (args.usdPerToken !== null && Number.isFinite(args.usdPerToken) && args.usdPerToken >= 0) {
    const scale = 10 ** args.tokenDecimals;
    holders = balances.filter(([owner, amount]) => !exclusions.ryntraOwners.has(owner) && (Number(amount) / scale) * args.usdPerToken! > HOLDER_MIN_USD).length;
  }
  return { holders, atLeast: !whole, top10Bps, top10AtLeast: !whole && top10Bps !== null, circulatingRaw: circulatingRaw ?? 0n };
}

/* ------------------------------------------------------------ rules and policies */

/** Who keeps a rule of the market: a program enforces a rule; Ryntra's server runs a policy. */
export const MARKET_ENFORCEMENT = ["rule", "policy"] as const;
export type MarketEnforcement = (typeof MARKET_ENFORCEMENT)[number];

/** Who enforces or runs it. */
export const MARKET_KEEPERS = ["token-2022", "meteora-dbc", "meteora-damm-v2", "met-lock", "dynamic-fee-sharing", "solana-loader", "ryntra"] as const;
export type MarketKeeper = (typeof MARKET_KEEPERS)[number];

/** The token's own rules, as its launch receipt reads them from the mint: they hold whatever happens to its market. */
export const TOKEN_RULE_CODES = ["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK", "TRANSFER_FEE_UNTIL_DEX", "CURVE_RULES_UNTIL_DEX"] as const;
export type TokenRuleCode = (typeof TOKEN_RULE_CODES)[number];

/** The rules and policies that keep a market now — only what is live on it. */
export const MARKET_RULE_CODES = [
  ...TOKEN_RULE_CODES,
  /** «Правила на кривій» (SOL-L8): the rule program is frozen or upgraded only by one of Ryntra's multisigs — read at the program's own account. */
  "CURVE_RULES_PROGRAM_GOVERNED",
  "CONFIG_FIXED",
  "CURVE_HOLDS_FUNDS",
  "GRADUATION_AT_THRESHOLD",
  "LP_LOCKED_FOREVER",
  "CREATOR_LOCK",
  "CREATOR_FEES_SHARED",
  "CREATOR_FIRST_BUY_CAP",
  "GRADUATION_BY_RYNTRA",
  "FEE_FUNDED_LADDER",
  "CREATOR_SALE_MARK",
  "CONCENTRATION_MARK",
] as const;
export type MarketRuleCode = (typeof MARKET_RULE_CODES)[number];

export const MARKET_RULE_KEEPING: Readonly<Record<MarketRuleCode, Readonly<{ enforcement: MarketEnforcement; by: MarketKeeper }>>> = Object.freeze({
  MINT_REVOKED: { enforcement: "rule", by: "token-2022" },
  NO_FREEZE: { enforcement: "rule", by: "token-2022" },
  METADATA_FIXED: { enforcement: "rule", by: "token-2022" },
  NO_TRANSFER_HOOK: { enforcement: "rule", by: "token-2022" },
  TRANSFER_FEE_UNTIL_DEX: { enforcement: "rule", by: "token-2022" },
  CURVE_RULES_UNTIL_DEX: { enforcement: "rule", by: "token-2022" },
  CURVE_RULES_PROGRAM_GOVERNED: { enforcement: "rule", by: "solana-loader" },
  CONFIG_FIXED: { enforcement: "rule", by: "meteora-dbc" },
  CURVE_HOLDS_FUNDS: { enforcement: "rule", by: "meteora-dbc" },
  GRADUATION_AT_THRESHOLD: { enforcement: "rule", by: "meteora-dbc" },
  LP_LOCKED_FOREVER: { enforcement: "rule", by: "meteora-damm-v2" },
  CREATOR_LOCK: { enforcement: "rule", by: "met-lock" },
  CREATOR_FEES_SHARED: { enforcement: "rule", by: "dynamic-fee-sharing" },
  CREATOR_FIRST_BUY_CAP: { enforcement: "policy", by: "ryntra" },
  GRADUATION_BY_RYNTRA: { enforcement: "policy", by: "ryntra" },
  FEE_FUNDED_LADDER: { enforcement: "policy", by: "ryntra" },
  CREATOR_SALE_MARK: { enforcement: "policy", by: "ryntra" },
  CONCENTRATION_MARK: { enforcement: "policy", by: "ryntra" },
});

export type MarketRuleSource = Readonly<{ kind: "tx" | "account"; id: string }>;

export type MarketRule = Readonly<{
  code: MarketRuleCode;
  enforcement: MarketEnforcement;
  by: MarketKeeper;
  /** Where anyone can see it on chain; null for a policy of Ryntra's server. */
  source: MarketRuleSource | null;
  /** The figures its words name: shares in basis points, amounts raw, times in unix seconds. */
  values: Readonly<Record<string, number | string>>;
}>;

export type MarketRulesInput = Readonly<{
  migrated: boolean;
  /** The token's marks its launch receipt read from the mint — each with the account it is seen at; empty when not read. */
  tokenMarks: readonly Readonly<{ code: string; account: string }>[];
  /** «Комісія за переказ» (SOL-L10): the rate on the curve the receipt read; absent or null — none. */
  transferFeeBps?: number | null;
  /**
   * «Правила на кривій» (SOL-L8): the launch's rules as its receipt holds them — the audited program read from the
   * mint, the set its config was made with and the governance of that program; absent or null — the token runs none.
   */
  curveRules?: Readonly<{ program: string; rules: readonly string[]; upgrade: string; upgradeAuthority: string | null; audit: string }> | null;
  config: string;
  curve: string;
  /** The launch's creation — where the cap on the creator's first buy was applied. */
  launchSignature: string;
  thresholdRaw: string;
  /** The graduated pool's positions locked for ever, from the launch receipt, each with whose share it is; empty when not read or not graduated. */
  lockedPositions: readonly Readonly<{ position: string; owner: "creator" | "partner" | "other" }>[];
  /** The creator's lock: its escrow and when it frees the tokens; null when there is none. */
  creatorLock: Readonly<{ escrow: string; cliffAt: number | null; endsAt: number | null }> | null;
  /** The vault sharing the creator's fees; null when they are not shared. */
  feeVault: string | null;
  /** The preset's cap on the creator's first buy, basis points of the supply. */
  firstBuyCapBps: number | null;
  /** Ryntra's executor when it acts on this network now — its key here and Launch open; null otherwise, and then nothing of Ryntra's sends a graduation. */
  executor: string | null;
  /** Ryntra's steps on this market while the executor moves them: the DLMM pool; null when there are none or they stand still. */
  ladderPool: string | null;
  /** Whether the concentration and the creator's sales were read: a mark is live only on what was read. */
  concentrationRead: boolean;
  creatorSalesRead: boolean;
  now: number;
}>;

/** What keeps the market now, rules first: only what is live on it — a lock that has ended or an executor not running is not listed. */
export function marketRules(input: MarketRulesInput): MarketRule[] {
  const rules: MarketRule[] = [];
  const add = (code: MarketRuleCode, source: MarketRuleSource | null, values: Readonly<Record<string, number | string>> = {}) =>
    rules.push({ code, ...MARKET_RULE_KEEPING[code], source, values });
  for (const code of TOKEN_RULE_CODES) {
    const mark = input.tokenMarks.find((entry) => entry.code === code);
    if (!mark) continue;
    if (code === "TRANSFER_FEE_UNTIL_DEX") add(code, { kind: "account", id: mark.account }, { bps: input.transferFeeBps ?? 0 });
    else if (code === "CURVE_RULES_UNTIL_DEX") {
      const rules = input.curveRules;
      if (!rules) continue;
      add(code, { kind: "account", id: mark.account }, { program: rules.program, rules: rules.rules.join(",") });
      /* Where anyone checks who may change the rules: the program's own account, which the loader holds. */
      add("CURVE_RULES_PROGRAM_GOVERNED", { kind: "account", id: rules.program }, { upgrade: rules.upgrade, ...(rules.upgradeAuthority ? { multisig: rules.upgradeAuthority } : {}), audit: rules.audit });
    } else add(code, { kind: "account", id: mark.account });
  }
  /* The curve's numbers and the graduated pool's starting fees are the config's, and a config never changes. */
  add("CONFIG_FIXED", { kind: "account", id: input.config });
  if (!input.migrated) {
    add("CURVE_HOLDS_FUNDS", { kind: "account", id: input.curve });
    add("GRADUATION_AT_THRESHOLD", { kind: "account", id: input.config }, { thresholdRaw: input.thresholdRaw });
  }
  for (const locked of input.lockedPositions) add("LP_LOCKED_FOREVER", { kind: "account", id: locked.position }, { owner: locked.owner });
  if (input.creatorLock && (input.creatorLock.endsAt === null || input.creatorLock.endsAt > input.now)) {
    add("CREATOR_LOCK", { kind: "account", id: input.creatorLock.escrow }, { ...(input.creatorLock.cliffAt !== null ? { cliffAt: input.creatorLock.cliffAt } : {}), ...(input.creatorLock.endsAt !== null ? { endsAt: input.creatorLock.endsAt } : {}) });
  }
  if (input.feeVault) add("CREATOR_FEES_SHARED", { kind: "account", id: input.feeVault });
  if (input.firstBuyCapBps !== null) add("CREATOR_FIRST_BUY_CAP", { kind: "tx", id: input.launchSignature }, { capBps: input.firstBuyCapBps });
  if (input.executor && !input.migrated) add("GRADUATION_BY_RYNTRA", { kind: "account", id: input.executor });
  if (input.ladderPool) add("FEE_FUNDED_LADDER", { kind: "account", id: input.ladderPool });
  if (input.creatorSalesRead) add("CREATOR_SALE_MARK", null);
  if (input.concentrationRead) add("CONCENTRATION_MARK", null, { markBps: CONCENTRATION_MARK_BPS });
  return rules.sort((a, b) => (a.enforcement === b.enforcement ? 0 : a.enforcement === "rule" ? -1 : 1));
}

/* ------------------------------------------------------------ survival */

export type Survival = Readonly<{
  /** Whole days since the market reached the DEX; null before it or when the moment is not known. */
  daysSinceDex: number | null;
  /** The price now against the price the pool opened at, basis points, signed; null before the DEX or when not read. */
  priceVsDexBps: number | null;
  /** Whether a trade happened in the last 24 hours: null when the day's trades were not read whole and none was seen. */
  traded24h: boolean | null;
}>;

export function survival(args: Readonly<{
  graduatedAt: number | null;
  priceNow: number | null;
  priceAtDex: number | null;
  lastTradeAt: number | null;
  dayReadWhole: boolean;
  now: number;
}>): Survival {
  const daysSinceDex = args.graduatedAt !== null && args.graduatedAt <= args.now ? Math.floor((args.now - args.graduatedAt) / 86_400) : null;
  const priceVsDexBps =
    args.graduatedAt !== null && args.priceNow !== null && args.priceAtDex !== null && args.priceAtDex > 0 ? Math.round((args.priceNow / args.priceAtDex - 1) * 10_000) : null;
  const traded24h = args.lastTradeAt !== null && args.lastTradeAt >= args.now - 86_400 ? true : args.dayReadWhole ? false : null;
  return { daysSinceDex, priceVsDexBps, traded24h };
}
