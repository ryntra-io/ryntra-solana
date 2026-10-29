/**
 * «Пресейл і ранній доступ» — early access before public trading (SOL-L5), the rules a launch carries and a buyer reads.
 *
 * Why it is a launch of its own, not a DBC preset: Meteora's Alpha Vault works with DLMM, DAMM v1 and DAMM v2 only —
 * never with a bonding curve —, and Meteora's Presale Vault hands the money raised to the creator, who must make the
 * market later: a rug path Ryntra does not offer. So the early-access format keeps «Чесний лаунч» another way:
 *
 * 1. An honest Token-2022 mint, made by the creator's own transaction: a fixed supply, the metadata in the mint
 *    (metadata pointer + token metadata), nobody may change the metadata, no freeze authority, the mint authority
 *    revoked once the supply is minted, no transfer hook.
 * 2. A DAMM v2 pool seeded single-sided with the whole supply — a price range from the start price up, so only the token
 *    is needed —, made with an alpha vault (`hasAlphaVault`) and opening for trading at a set time; the creator's
 *    position is permanently locked in the same transaction: nobody can ever withdraw the liquidity.
 * 3. A Meteora Alpha Vault on that pool: people deposit USDC before trading opens; in the last hour before it opens the
 *    vault buys from the pool for all of them at once (a crank anyone may send), and each depositor claims their tokens
 *    as they vest and, where the vault did not spend all of it, takes the rest of their USDC back.
 *
 * Timing is the programs' own (DAMM v2 `TIME_BUFFER`, `FIVE_MINUTES_TIME_BUFFER`; the Alpha Vault SDK's `vaultPoint`):
 * the vault may buy only in the hour before activation, and deposits close five minutes before that hour. So the
 * deposit window's end is not the activation: trading opens 65 minutes after the last deposit
 * (`EARLY_ACCESS_TIMING.fillWindowSeconds`), and that hour is when the vault buys.
 *
 * The vault's share of the supply is not an input: it follows from the cap and the start price on the pool's own curve
 * (`earlyAccessFill`) — a share the rules could contradict would be a promise the pool does not keep. The bounds cap it
 * (`maxPresaleBps`).
 *
 * Ryntra takes nothing on this format and is a fee claimer nowhere: the creator earns the locked position's LP fees.
 *
 * Pure and client-safe: numbers and words only, no SDK, no network, no clock (times are unix seconds passed in).
 */

/* ------------------------------------------------------------ constants */

export const EARLY_ACCESS_MODES = ["FCFS", "PRO_RATA"] as const;
export type EarlyAccessMode = (typeof EARLY_ACCESS_MODES)[number];

/** The token of an early-access launch: Token-2022, six decimals, a fixed supply by default. */
export const EARLY_ACCESS_TOKEN = { decimals: 6, defaultSupply: 1_000_000_000, minSupply: 1_000_000, maxSupply: 1_000_000_000_000 } as const;

/** The pair: USDC, six decimals, a dollar. */
export const EARLY_ACCESS_QUOTE_DECIMALS = 6;

/**
 * The programs' timing for an alpha vault on a DAMM v2 pool with timestamp activation (seconds).
 * - `preActivationSeconds` — DAMM v2 lets the vault swap only from this long before activation (`TIME_BUFFER`).
 * - `lastJoinBufferSeconds` — deposits close this long before the vault may buy (`FIVE_MINUTES_TIME_BUFFER`).
 * - `maxActivationSeconds` — a pool opens for trading at most 31 days after it is made (`MAX_ACTIVATION_TIME_DURATION`).
 * - `minDepositSeconds` — the vault refuses a deposit window shorter than this (`DepositingTimePointIsInvalid`, 6021):
 *   measured on devnet 20.10 for both modes — deposits opening 1 200 s before the last join point are taken, 1 199 s are
 *   not. A shorter window would leave the mint and the pool on chain without their vault.
 * - `minLeadSeconds` — Ryntra's rule: deposits open at least this long after the build, so the creation's three
 *   transactions land before the window opens.
 */
export const EARLY_ACCESS_TIMING = {
  preActivationSeconds: 3_600,
  lastJoinBufferSeconds: 300,
  fillWindowSeconds: 3_900,
  maxActivationSeconds: 31 * 24 * 3_600,
  minDepositSeconds: 1_200,
  minLeadSeconds: 120,
} as const;

/**
 * The pool's fee, by time from activation, as the presets' protected curve has it: 50 % at the first second, falling
 * exponentially to 1 % over ten minutes, with a volatility fee on top. Before activation DAMM v2 charges the end fee —
 * the vault buys at 1 % —, so the high fee falls on whoever snipes the first minutes of public trading, and goes to the
 * locked position, the creator's. Collected in USDC.
 */
export const EARLY_ACCESS_POOL_FEE = { startBps: 5_000, endBps: 100, periods: 60, seconds: 600, dynamicFee: true, collectIn: "QUOTE" } as const;

/** A depositor opens an escrow for nothing: the vault's escrow fee is zero. */
export const EARLY_ACCESS_ESCROW_FEE_RAW = 0;

/**
 * Ryntra's share of anything on this format: none. Ryntra is a fee claimer nowhere here — not on the pool, not on the
 * vault, not on the position.
 */
export const RYNTRA_EARLY_ACCESS_SHARE_BPS = 0;

/* --------------------------------------------------------------- rules */

export type EarlyAccessRules = Readonly<{
  mode: EarlyAccessMode;
  /** Unix seconds: the first deposit is taken. */
  depositStartsAt: number;
  /** Unix seconds: the last deposit is taken (the vault's last join point); trading opens 65 minutes later. */
  depositEndsAt: number;
  /** USDC raw. FCFS: the most the vault takes in deposits. Pro Rata: the most it spends; deposits above it are refunded pro rata. */
  maxCapRaw: string;
  /** USDC raw, FCFS only: the most one wallet deposits. Null on Pro Rata. */
  individualCapRaw: string | null;
  /** How long the vault's tokens vest after trading opens, in hours (fractions allowed); 0 — all at once. */
  vestingHours: number;
  /** The market cap the pool opens at, in US dollars (USDC). */
  startMarketCapUsd: number;
  /** Whole tokens; all of it goes into the pool. */
  supply: number;
}>;

/** What a network allows: the stand's bounds are DEVNET's, mainnet's come from configuration. */
export type EarlyAccessBounds = Readonly<{
  modes: readonly EarlyAccessMode[];
  minCapRaw: string;
  maxCapRaw: string;
  minIndividualCapRaw: string;
  minDepositMinutes: number;
  maxDepositHours: number;
  /** How far ahead of the build the deposit window may open. */
  maxStartDelayHours: number;
  minVestingHours: number;
  maxVestingHours: number;
  minStartMarketCapUsd: number;
  maxStartMarketCapUsd: number;
  /** The most of the supply the vault may buy for its whole cap, basis points. */
  maxPresaleBps: number;
}>;

/** The devnet stand: small amounts, short windows — a whole cycle runs in a little over an hour. */
export const DEVNET_EARLY_ACCESS_BOUNDS: EarlyAccessBounds = Object.freeze({
  modes: EARLY_ACCESS_MODES,
  minCapRaw: "1000000",
  maxCapRaw: "100000000000",
  minIndividualCapRaw: "100000",
  minDepositMinutes: 20,
  maxDepositHours: 7 * 24,
  maxStartDelayHours: 7 * 24,
  minVestingHours: 0,
  maxVestingHours: 30 * 24,
  minStartMarketCapUsd: 1_000,
  maxStartMarketCapUsd: 10_000_000,
  maxPresaleBps: 5_000,
});

const RAW = /^(0|[1-9]\d{0,19})$/;
const U64_MAX = 18_446_744_073_709_551_615n;
const isRaw = (value: unknown): value is string => typeof value === "string" && RAW.test(value) && BigInt(value) <= U64_MAX;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** What is wrong with a bounds object as configured (`RYNTRA_LAUNCH_EARLY_ACCESS_BOUNDS`); empty — usable. */
export function earlyAccessBoundsProblems(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["the bounds are not an object"];
  const bounds = value as Record<string, unknown>;
  const problems: string[] = [];
  const known = new Set(Object.keys(DEVNET_EARLY_ACCESS_BOUNDS));
  for (const key of Object.keys(bounds)) if (!known.has(key)) problems.push(`unknown field ${key}`);
  const modes = bounds.modes;
  if (!Array.isArray(modes) || modes.length === 0 || !modes.every((mode) => (EARLY_ACCESS_MODES as readonly unknown[]).includes(mode))) problems.push("modes must name FCFS and/or PRO_RATA");
  for (const key of ["minCapRaw", "maxCapRaw", "minIndividualCapRaw"] as const) if (!isRaw(bounds[key])) problems.push(`${key} must be a raw amount`);
  for (const key of ["minDepositMinutes", "maxDepositHours", "maxStartDelayHours", "minVestingHours", "maxVestingHours", "minStartMarketCapUsd", "maxStartMarketCapUsd", "maxPresaleBps"] as const) {
    if (!finite(bounds[key]) || (bounds[key] as number) < 0) problems.push(`${key} must be a number not below zero`);
  }
  if (problems.length) return problems;
  if (BigInt(bounds.minCapRaw as string) <= 0n || BigInt(bounds.minCapRaw as string) > BigInt(bounds.maxCapRaw as string)) problems.push("the cap bounds are out of order");
  if (BigInt(bounds.minIndividualCapRaw as string) <= 0n) problems.push("minIndividualCapRaw must be above zero");
  if ((bounds.minDepositMinutes as number) <= 0 || (bounds.minDepositMinutes as number) / 60 > (bounds.maxDepositHours as number)) problems.push("the deposit window bounds are out of order");
  if ((bounds.minDepositMinutes as number) * 60 < EARLY_ACCESS_TIMING.minDepositSeconds) problems.push(`minDepositMinutes must be at least ${EARLY_ACCESS_TIMING.minDepositSeconds / 60}: the vault refuses a shorter window`);
  if ((bounds.minVestingHours as number) > (bounds.maxVestingHours as number)) problems.push("the vesting bounds are out of order");
  if ((bounds.minStartMarketCapUsd as number) <= 0 || (bounds.minStartMarketCapUsd as number) > (bounds.maxStartMarketCapUsd as number)) problems.push("the market cap bounds are out of order");
  if ((bounds.maxPresaleBps as number) <= 0 || (bounds.maxPresaleBps as number) > 9_000) problems.push("maxPresaleBps must be above zero and at most 9 000");
  return problems;
}

/* ------------------------------------------------------------ schedule */

export type EarlyAccessSchedule = Readonly<{
  depositStartsAt: number;
  depositEndsAt: number;
  /** The vault may buy from here until activation. */
  fillStartsAt: number;
  /** Public trading opens; the pool's `activationPoint`. */
  activatesAt: number;
  vestingStartsAt: number;
  vestingEndsAt: number;
}>;

/** The vault's vesting length in seconds: at least one, so the end is always after the start. */
export const vestingSecondsOf = (hours: number) => Math.max(1, Math.round(hours * 3_600));

/** Every point of the launch from its rules: the activation follows the deposit window's end by the programs' 65 minutes. */
export function earlyAccessSchedule(rules: Pick<EarlyAccessRules, "depositStartsAt" | "depositEndsAt" | "vestingHours">): EarlyAccessSchedule {
  const activatesAt = rules.depositEndsAt + EARLY_ACCESS_TIMING.fillWindowSeconds;
  /* One second after activation: the vault's last buying point is the second before it, and vesting starts after that. */
  const vestingStartsAt = activatesAt + 1;
  return {
    depositStartsAt: rules.depositStartsAt,
    depositEndsAt: rules.depositEndsAt,
    fillStartsAt: activatesAt - EARLY_ACCESS_TIMING.preActivationSeconds,
    activatesAt,
    vestingStartsAt,
    vestingEndsAt: vestingStartsAt + vestingSecondsOf(rules.vestingHours),
  };
}

export const EARLY_ACCESS_PHASES = ["UPCOMING", "DEPOSITS", "FILLING", "VESTING", "DONE"] as const;
export type EarlyAccessPhase = (typeof EARLY_ACCESS_PHASES)[number];

/** Where the launch is at `now` (unix seconds), by its schedule alone; the chain says whether the vault actually bought. */
export function earlyAccessPhase(schedule: EarlyAccessSchedule, now: number): EarlyAccessPhase {
  if (now < schedule.depositStartsAt) return "UPCOMING";
  if (now <= schedule.depositEndsAt) return "DEPOSITS";
  if (now < schedule.activatesAt) return "FILLING";
  if (now < schedule.vestingEndsAt) return "VESTING";
  return "DONE";
}

/* --------------------------------------------------------------- price */

const TEN6 = 10n ** 6n;
export const supplyRawOf = (rules: Pick<EarlyAccessRules, "supply">) => BigInt(rules.supply) * 10n ** BigInt(EARLY_ACCESS_TOKEN.decimals);
/** The start market cap in USDC raw. */
export const startMarketCapRawOf = (rules: Pick<EarlyAccessRules, "startMarketCapUsd">) => BigInt(Math.round(rules.startMarketCapUsd * 1_000_000));

/** The pool's start price in USDC per whole token: the start market cap over the supply. */
export function startPriceUsd(rules: Pick<EarlyAccessRules, "startMarketCapUsd" | "supply">): number {
  return rules.startMarketCapUsd / rules.supply;
}

export type EarlyAccessFill = Readonly<{
  /** What the vault spends: everything deposited up to its cap. */
  spentRaw: string;
  /** The pool's fee on that purchase (the end fee — the vault buys before activation). */
  feeRaw: string;
  tokensOutRaw: string;
  /** Share of the supply bought, basis points. */
  shareBps: number;
  /** The average price the vault pays, USDC per whole token, fee included. */
  averagePriceUsd: number;
  /** The pool's price and market cap right after the purchase, when public trading opens. */
  priceAfterUsd: number;
  marketCapAfterUsd: number;
  /** Deposited above the cap and refunded (Pro Rata). */
  refundRaw: string;
}>;

/**
 * What the vault buys for a deposited total, on the pool's own curve. The pool holds the whole supply from the start
 * price up to the program's highest price, single-sided: its liquidity is the supply's at the start price, and a
 * purchase of `q` (after the fee) out of such a range is a constant-product trade on virtual reserves — `supply` tokens
 * against `M0` USDC, `M0` the start market cap: it buys `supply · q / (M0 + q)` and leaves the price at
 * `P0 · ((M0 + q) / M0)²`. The upper end of the range is so far above (the program's maximum) that it does not move the
 * answer; the server's test checks it against the SDK's concentrated-liquidity math.
 */
export function earlyAccessFill(rules: EarlyAccessRules, depositedRaw: string | bigint = rules.maxCapRaw): EarlyAccessFill {
  const deposited = BigInt(depositedRaw);
  const cap = BigInt(rules.maxCapRaw);
  const spent = deposited < cap ? deposited : cap;
  const fee = (spent * BigInt(EARLY_ACCESS_POOL_FEE.endBps) + 9_999n) / 10_000n;
  const net = spent - fee;
  const supply = supplyRawOf(rules);
  const m0 = startMarketCapRawOf(rules);
  const out = m0 + net > 0n ? (supply * net) / (m0 + net) : 0n;
  const p0 = startPriceUsd(rules);
  const ratio = m0 > 0n ? Number(m0 + net) / Number(m0) : 1;
  const priceAfter = p0 * ratio * ratio;
  return {
    spentRaw: spent.toString(),
    feeRaw: fee.toString(),
    tokensOutRaw: out.toString(),
    shareBps: supply > 0n ? Number((out * 10_000n) / supply) : 0,
    averagePriceUsd: out > 0n ? Number(spent) / 1e6 / (Number(out) / Number(TEN6)) : 0,
    priceAfterUsd: priceAfter,
    marketCapAfterUsd: priceAfter * rules.supply,
    refundRaw: (deposited - spent).toString(),
  };
}

/** The most of the supply the vault can buy: its fill at the whole cap — the «presale» share. */
export function presaleBpsOf(rules: EarlyAccessRules): number {
  return earlyAccessFill(rules, rules.maxCapRaw).shareBps;
}

/* ------------------------------------------------------------ problems */

/** What would make these rules a launch Ryntra does not build, each in a plain line; empty — the rules hold. `now` in unix seconds. */
export function earlyAccessProblems(rules: EarlyAccessRules, bounds: EarlyAccessBounds, now: number): readonly string[] {
  const problems: string[] = [];
  if (!(EARLY_ACCESS_MODES as readonly string[]).includes(rules.mode)) problems.push("the mode is neither FCFS nor Pro Rata");
  else if (!bounds.modes.includes(rules.mode)) problems.push(`the ${rules.mode} mode is not offered here`);
  if (!Number.isInteger(rules.supply) || rules.supply < EARLY_ACCESS_TOKEN.minSupply || rules.supply > EARLY_ACCESS_TOKEN.maxSupply) problems.push("the supply is not a whole number of tokens in range");
  for (const [name, at] of [["the deposit start", rules.depositStartsAt], ["the deposit end", rules.depositEndsAt]] as const) {
    if (!Number.isInteger(at)) problems.push(`${name} is not a time`);
  }
  if (!isRaw(rules.maxCapRaw)) problems.push("the cap is not a raw amount");
  if (rules.individualCapRaw !== null && !isRaw(rules.individualCapRaw)) problems.push("the wallet cap is not a raw amount");
  if (!finite(rules.vestingHours) || !finite(rules.startMarketCapUsd)) problems.push("the vesting or the market cap is not a number");
  if (problems.length) return problems;

  if (rules.depositStartsAt < now + EARLY_ACCESS_TIMING.minLeadSeconds) problems.push(`deposits must open at least ${EARLY_ACCESS_TIMING.minLeadSeconds / 60} minutes from now`);
  if (rules.depositStartsAt > now + bounds.maxStartDelayHours * 3_600) problems.push(`deposits must open within ${bounds.maxStartDelayHours} hours`);
  const window = rules.depositEndsAt - rules.depositStartsAt;
  const shortest = Math.max(bounds.minDepositMinutes * 60, EARLY_ACCESS_TIMING.minDepositSeconds);
  if (window < shortest) problems.push(`the deposit window is shorter than ${shortest / 60} minutes`);
  if (window > bounds.maxDepositHours * 3_600) problems.push(`the deposit window is longer than ${bounds.maxDepositHours} hours`);
  const schedule = earlyAccessSchedule(rules);
  /* The pool refuses an activation past 31 days; a margin of an hour for the creation to land. */
  if (schedule.activatesAt - now > EARLY_ACCESS_TIMING.maxActivationSeconds - 3_600) problems.push("trading would open more than 31 days from now");

  const cap = BigInt(rules.maxCapRaw);
  if (cap < BigInt(bounds.minCapRaw) || cap > BigInt(bounds.maxCapRaw)) problems.push("the cap is outside the bounds");
  if (rules.mode === "FCFS") {
    if (rules.individualCapRaw === null) problems.push("a first-come vault needs a cap per wallet");
    else {
      const individual = BigInt(rules.individualCapRaw);
      if (individual < BigInt(bounds.minIndividualCapRaw)) problems.push("the cap per wallet is below the bounds");
      if (individual > cap) problems.push("the cap per wallet is above the vault's cap");
    }
  } else if (rules.individualCapRaw !== null) problems.push("a pro rata vault has no cap per wallet");

  if (rules.vestingHours < bounds.minVestingHours || rules.vestingHours > bounds.maxVestingHours) problems.push("the vesting is outside the bounds");
  if (rules.startMarketCapUsd < bounds.minStartMarketCapUsd || rules.startMarketCapUsd > bounds.maxStartMarketCapUsd) problems.push("the start market cap is outside the bounds");

  const fill = earlyAccessFill(rules, cap);
  if (BigInt(fill.tokensOutRaw) <= 0n) problems.push("the cap buys no tokens at this price");
  if (fill.shareBps > bounds.maxPresaleBps) problems.push(`the vault's cap would buy ${(fill.shareBps / 100).toFixed(1)} % of the supply, above ${(bounds.maxPresaleBps / 100).toFixed(1)} %`);
  return problems;
}

/* ---------------------------------------------------------- the mint */

/** A mint as the chain stores it, the fields «Чесний лаунч» judges an early-access token on. */
export type EarlyAccessMintFields = Readonly<{
  mint: string;
  /** "token-2022", or the owner program's address when it is not. */
  program: string;
  supplyRaw: string;
  decimals: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** The extensions by their names in `@solana/spl-token`'s `ExtensionType`. */
  extensions: readonly string[];
  transferHookProgram: string | null;
  metadataPointerAuthority: string | null;
  metadataPointerAddress: string | null;
  /** Null when no one may change the metadata; undefined when the metadata was not read. */
  metadataUpdateAuthority: string | null | undefined;
}>;

/** The extensions an early-access mint carries: its metadata, in the mint, and the pointer to it. Nothing else. */
export const EARLY_ACCESS_MINT_EXTENSIONS = ["MetadataPointer", "TokenMetadata"] as const;

/** What breaks «Чесний лаунч» in a mint read back from the chain; empty — it keeps every rule. */
export function earlyAccessMintProblems(fields: EarlyAccessMintFields, expected: Readonly<{ supplyRaw: string }>): readonly string[] {
  const problems: string[] = [];
  if (fields.program !== "token-2022") problems.push("the token is not Token-2022");
  if (fields.decimals !== EARLY_ACCESS_TOKEN.decimals) problems.push("the token's decimals are not six");
  if (fields.supplyRaw !== expected.supplyRaw) problems.push("the supply is not the one the launch named");
  if (fields.mintAuthority !== null) problems.push("someone can still mint more tokens");
  if (fields.freezeAuthority !== null) problems.push("someone can freeze token accounts");
  if (fields.transferHookProgram !== null || fields.extensions.includes("TransferHook")) problems.push("the token has a transfer hook");
  const extra = fields.extensions.filter((name) => !(EARLY_ACCESS_MINT_EXTENSIONS as readonly string[]).includes(name));
  if (extra.length) problems.push(`the token carries other extensions: ${extra.join(", ")}`);
  if (fields.metadataPointerAuthority !== null) problems.push("someone can move the metadata pointer");
  if (fields.metadataPointerAddress !== fields.mint) problems.push("the metadata does not live in the mint");
  if (fields.metadataUpdateAuthority === undefined) problems.push("the metadata was not read");
  else if (fields.metadataUpdateAuthority !== null) problems.push("someone can change the metadata");
  return problems;
}

/* --------------------------------------------------------------- words */

export type EarlyAccessLocale = "uk" | "en";

function amount(raw: string | bigint, locale: EarlyAccessLocale, decimals = 6): string {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString();
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, locale === "uk" ? " " : ",");
  return fraction ? `${grouped}${locale === "uk" ? "," : "."}${fraction}` : grouped;
}

function decimal(value: number, locale: EarlyAccessLocale, digits: number): string {
  const text = value.toFixed(digits);
  return locale === "uk" ? text.replace(".", ",") : text;
}

/** A price as a person reads it: enough significant digits for a tiny one. */
function price(value: number, locale: EarlyAccessLocale): string {
  const text = value >= 1 ? value.toFixed(2) : value.toPrecision(3);
  const plain = text.includes("e") ? value.toFixed(12).replace(/0+$/, "") : text;
  return locale === "uk" ? plain.replace(".", ",") : plain;
}

const usd = (value: number, locale: EarlyAccessLocale) => `${amount(BigInt(Math.round(value)), locale, 0)} $`;
const when = (at: number) => `${new Date(at * 1_000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const hours = (value: number, locale: EarlyAccessLocale) => (Number.isInteger(value) ? String(value) : decimal(value, locale, 1));

/**
 * The plain lines a buyer reads before depositing: how the mode shares the tokens, when, at what price, the vesting,
 * that the liquidity is locked for ever and that Ryntra takes nothing. Facts only — the format promises no outcome.
 */
export function earlyAccessRuleLines(rules: EarlyAccessRules, locale: EarlyAccessLocale): readonly string[] {
  const schedule = earlyAccessSchedule(rules);
  const fill = earlyAccessFill(rules, rules.maxCapRaw);
  const cap = amount(rules.maxCapRaw, locale);
  const share = decimal(fill.shareBps / 100, locale, 1);
  const p0 = price(startPriceUsd(rules), locale);
  const supply = amount(supplyRawOf(rules), locale);
  const vesting = rules.vestingHours > 0;
  const fee = decimal(EARLY_ACCESS_POOL_FEE.endBps / 100, locale, 0);
  if (locale === "uk") {
    return [
      rules.mode === "FCFS"
        ? `Хто перший, той купує: внески приймаються, доки разом не наберуть ${cap} USDC; один гаманець вносить до ${amount(rules.individualCapRaw ?? "0", locale)} USDC.`
        : `Пропорційно: внески приймаються без загальної межі, сховище купує токени на ${cap} USDC, і кожен отримує частку за своїм внеском.`,
      rules.mode === "FCFS"
        ? "Внесок у режимі «Хто перший» забрати назад не можна: програма сховища цього не дозволяє."
        : "Поки триває збір, внесок можна забрати. Що зібрано понад межу, повертається кожному пропорційно після купівлі.",
      `Збір внесків: з ${when(schedule.depositStartsAt)} до ${when(schedule.depositEndsAt)}.`,
      `Сховище купує в пулі в годину перед відкриттям торгівлі, одним замовленням для всіх, коли купівлю запустить будь-хто (кнопка є на сторінці токена), за тією самою кривою, що й будь-хто: від ${p0} USDC за токен (ринкова капіталізація ${usd(rules.startMarketCapUsd, locale)}), з комісією пулу ${fee} %. За весь ліміт це до ${share} % пропозиції.`,
      `Публічна торгівля відкривається ${when(schedule.activatesAt)}; у перші хвилини комісія пулу висока й спадає до ${fee} % за ${EARLY_ACCESS_POOL_FEE.seconds / 60} хвилин.`,
      vesting
        ? `Куплені токени розблоковуються рівномірно протягом ${hours(rules.vestingHours, locale)} год після відкриття торгівлі; забрати їх можна частинами або наприкінці.`
        : "Куплені токени можна забрати одразу після відкриття торгівлі.",
      "Що сховище не витратило, можна забрати назад після відкриття торгівлі. Якщо сховище не купило до відкриття, назад можна забрати весь внесок.",
      "Уся ліквідність пулу заблокована назавжди: ні творець, ні Ryntra, ні будь-хто інший не може її забрати.",
      `Токен: фіксована пропозиція ${supply}; нових токенів випустити не можна, рахунки не можна заморозити, назву й опис не можна змінити.`,
      "Ryntra нічого не бере з цього формату. Творець заробляє лише комісії пулу зі своєї заблокованої позиції.",
      "Внесок — це купівля токена, а не вклад: після відкриття ціна може стати нижчою, ніж заплатило сховище.",
    ];
  }
  return [
    rules.mode === "FCFS"
      ? `First come, first served: deposits are taken until they reach ${cap} USDC together; one wallet deposits up to ${amount(rules.individualCapRaw ?? "0", locale)} USDC.`
      : `Pro rata: deposits are taken with no overall limit, the vault buys tokens for ${cap} USDC, and each depositor gets a share by their deposit.`,
    rules.mode === "FCFS"
      ? "A first-come deposit cannot be taken back: the vault's program does not allow it."
      : "While deposits are open, a deposit can be taken back. What was deposited above the limit is returned to each depositor pro rata after the purchase.",
    `Deposits: from ${when(schedule.depositStartsAt)} to ${when(schedule.depositEndsAt)}.`,
    `The vault buys from the pool in the hour before trading opens, in one order for everyone, once anyone starts the purchase (the token's page has the button), on the same curve as anyone: from ${p0} USDC a token (a market cap of ${usd(rules.startMarketCapUsd, locale)}), paying the pool's ${fee} % fee. Its whole limit buys up to ${share} % of the supply.`,
    `Public trading opens ${when(schedule.activatesAt)}; in its first minutes the pool's fee is high and falls to ${fee} % over ${EARLY_ACCESS_POOL_FEE.seconds / 60} minutes.`,
    vesting
      ? `The tokens bought unlock evenly over ${hours(rules.vestingHours, locale)} h after trading opens; they can be claimed in parts or at the end.`
      : "The tokens bought can be claimed as soon as trading opens.",
    "What the vault did not spend can be taken back after trading opens. If the vault did not buy before trading opened, the whole deposit can be taken back.",
    "All of the pool's liquidity is locked for ever: neither the creator, nor Ryntra, nor anyone else can withdraw it.",
    `The token: a fixed supply of ${supply}; no more tokens can be minted, no account can be frozen, the name and details cannot be changed.`,
    "Ryntra takes nothing on this format. The creator earns only the pool's fees from their locked position.",
    "A deposit buys the token; it is not a savings deposit: after trading opens the price may fall below what the vault paid.",
  ];
}
