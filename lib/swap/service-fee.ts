/**
 * The Ryntra service fee — one shape, whichever provider carries the swap.
 *
 * Since fee policy v2 (2026-10-05, `lib/core/fee-policy.ts`) a swap's rate is
 * its flow's — memes, verified tokens, majors, dollars, stocks — and it travels
 * through the fee mechanism each integrated provider already ships. No fee
 * contract of Ryntra’s own was written, no extra transfer was added, and no
 * route was made worse to earn more.
 *
 * ## Four mechanisms, and they are not the same thing
 *
 * A surface that showed one number and implied one pipe would be lying about
 * where the money is. These four differ in what is charged, what it is charged
 * in, and where it ends up:
 *
 * - **Jupiter platform fee** (`JUPITER_PLATFORM_FEE`) — `platformFeeBps` +
 *   `feeAccount` on `/build`. Jupiter keeps nothing of it: the fee is part of
 *   the swap instruction and lands whole in the canonical token account of
 *   Ryntra's fee wallet for the fee mint, in the same transaction. Taken from
 *   the input when the input is one of the fee wallet's mints — exactly
 *   `floor(amount × bps / 10 000)`, known before the signature — else from
 *   the output.
 * - **Jupiter Referral** (`JUPITER_REFERRAL`) — `referralAccount` +
 *   `referralFee` on `/order`. Jupiter picks the fee mint from its own priority
 *   list (SOL, then stables, then LSTs, then bluechips), takes **20% of the
 *   integrator fee** for itself, and pays the rest into a `referralTokenAccount`
 *   that must already exist **for that mint**. If it does not, the order still
 *   executes and the fee is simply not taken — which is why
 *   `NOT_APPLIED` exists below and why an absent account is not a zero.
 * - **Relay App Fees** (`RELAY_APP_FEE`) — `appFees: [{recipient, fee}]` on the
 *   quote. Charged on the **input** value, quoted inside the price Relay
 *   returns, and **not paid out per swap**: it accrues in an off-chain USDC app
 *   balance keyed to an **EVM** claim address, claimed later. Relay's own
 *   warning is load-bearing: on an unsupported operation it returns no error and
 *   collects nothing, so `paidAppFees` is read after the fact rather than
 *   assumed.
 * - **Mayan referrer** (`MAYAN_REFERRER`) — `referrer` (always a **Solana**
 *   address, whatever the chains) + `referrerBps` on the quote, and the matching
 *   `referrerAddresses` at build time or the fee is not collected at all. It
 *   sits **on top of** Mayan's protocol fee rather than inside it, is collected
 *   on chain, and lands on the source chain for Swift and the destination chain
 *   for Fast MCTP — for this product's routes, Solana in both cases.
 * - **Meteora, on a Ryntra launch** (`METEORA_LAUNCH`) — no terminal fee is added
 *   on a launch's curve: the curve's own trading fee is the fee, and Ryntra, the
 *   partner of every Ryntra launch config, takes the partner's part of it, plus
 *   Meteora's referral — a fifth of Meteora's protocol fee, paid by Meteora into
 *   Ryntra's referral account in the swap itself. In the graduated pool the
 *   referral alone. Both are read from the program's swap event and the chain's
 *   balances of the trade's own transaction; the person pays nothing for them
 *   beyond the fee the curve or the pool already charges.
 *
 * ## And one route with no mechanism at all
 *
 * The direct Circle CCTP lane has none. `depositForBurn(uint256,uint32,bytes32,
 * address,bytes32,uint256,uint32)` has seven arguments and not one of them is an
 * integrator fee; `maxFee` is Circle's own fast-transfer charge. Inventing a fee
 * there would mean a second transfer or a contract of our own, and the rule is
 * explicit that neither happens and that nobody is steered off a good rail to
 * earn on a worse one. So USDC moved by CCTP carries `mechanism: "NONE"` and
 * the surface shows a zero that is true.
 *
 * ## Nothing here is income until a provider says it was taken
 *
 * `state` is the whole point of this module. A quoted fee is a quoted fee; only
 * `COLLECTED` means a provider has stated the money was actually taken, and
 * `isServiceFeeIncome` is the single predicate anything counting revenue may
 * use. A fee that was asked for and did not arrive reads `NOT_APPLIED` or
 * `NOT_COLLECTED` — never `0` with no explanation, and never a quoted figure
 * recorded as earnings.
 *
 * Pure and client-safe: no clock, no network, no `process.env`. Configuration is
 * read once, server-side, in `service-fee.server.ts`.
 */

import { z } from "zod";

/** The provider mechanism a route's fee actually travels through. */
export type ServiceFeeMechanism = "JUPITER_REFERRAL" | "JUPITER_PLATFORM_FEE" | "RELAY_APP_FEE" | "MAYAN_REFERRER" | "METEORA_LAUNCH" | "NONE";

/**
 * Ryntra's rate **per mechanism**, in basis points, since 2026-09-11.
 *
 * There used to be one number here for every provider, and that is how the
 * product went a day without a Jupiter fee: the rate moved to 25 for Relay's
 * sake, Jupiter's referral floor is 50 (verified live on 2026-09-11 — HTTP 400,
 * *"must be between 50 and 255 (inclusive)"*), and the one constant could not
 * be right for both. Each mechanism now carries the rate set for it against
 * what its provider takes, and nothing reads a global rate any more:
 *
 * - **Jupiter referral** — Swap and Spot on Solana same-chain — 50 bps, the
 *   provider's own minimum. Half of it goes back to the person as cashback
 *   through the existing Rewards split, so a person's net cost is 25 bps.
 * - **Relay app fee** — Bridge — 25 bps, unchanged. Relay collects a same-chain
 *   app fee only when the fee clears $0.025, so a small swap can quote a fee
 *   and never take it; `paidAppFees` is the only evidence of collection.
 * - **Mayan referrer** — out of default routing; the rate only travels when a
 *   referrer address is configured, which it is not. Unchanged.
 *
 * Deliberately constants rather than variables: a runtime knob is how a
 * configuration mistake produces a quote a provider silently refuses to honour.
 * Nothing may treat a quoted figure as income; `isServiceFeeIncome` is the only
 * predicate allowed to call anything revenue.
 *
 * Since fee policy v2 the Jupiter rates are the flow's (`FEE_POLICY_V2`): the
 * referral rate below is what a flow the table does not name still pays
 * («as now»), and `/build`'s platform fee has no rate of its own here — each
 * flow names it.
 */
export const RYNTRA_SERVICE_FEE_POLICY: Readonly<Record<Exclude<ServiceFeeMechanism, "NONE" | "JUPITER_PLATFORM_FEE" | "METEORA_LAUNCH">, number>> = {
  JUPITER_REFERRAL: 50,
  RELAY_APP_FEE: 25,
  MAYAN_REFERRER: 25,
};

/** The rate Ryntra asks a mechanism for by default; zero for no mechanism, for `/build`'s fee, whose rate is always the flow's, and for a launch, whose fee is the curve's or the pool's own. */
export function serviceFeeRateFor(mechanism: ServiceFeeMechanism): number {
  return mechanism === "NONE" || mechanism === "JUPITER_PLATFORM_FEE" || mechanism === "METEORA_LAUNCH" ? 0 : RYNTRA_SERVICE_FEE_POLICY[mechanism];
}


/** Where the provider puts it, which is not the same question as which pipe. */
export type ServiceFeeAccrual =
  /** A Jupiter `referralTokenAccount` for the fee mint, on Solana, claimable on chain. */
  | "JUPITER_REFERRAL_TOKEN_ACCOUNT"
  /** The canonical token account of Ryntra's fee wallet for the fee mint, on Solana, paid in the swap itself. */
  | "FEE_WALLET_TOKEN_ACCOUNT"
  /** An off-chain USDC balance at Relay, keyed to an EVM claim address. */
  | "RELAY_APP_BALANCE_USDC"
  /** Transferred on chain to the Solana referrer address by the route itself. */
  | "MAYAN_ONCHAIN_REFERRER"
  /** Ryntra's partner vault on Meteora: the partner's part of a launch curve's fee, claimable by it, and the referral paid into its account in the swap. */
  | "METEORA_PARTNER_VAULT"
  | "NONE";

/**
 * How far along the fee is, and it is never guessed.
 *
 * - `NONE` — this route has no provider mechanism for an integrator fee. A true
 *   zero, with a reason.
 * - `UNCONFIGURED` — the mechanism exists and Ryntra has no address for it, so
 *   nothing was asked for. Also a true zero, and a different fact from `NONE`.
 * - `NOT_APPLIED` — asked for, and the provider did not put it in the quote.
 * - `QUOTED` — the provider states it in this quote. Nothing is collected yet.
 * - `COLLECTED` — the provider states it was actually taken. The only income.
 * - `NOT_COLLECTED` — the operation finished and the provider states it was not
 *   taken. Relay's documented silent case, made loud.
 */
export type ServiceFeeState = "NONE" | "UNCONFIGURED" | "NOT_APPLIED" | "QUOTED" | "COLLECTED" | "NOT_COLLECTED";

export type RyntraServiceFee = Readonly<{
  mechanism: ServiceFeeMechanism;
  state: ServiceFeeState;
  /** The gross rate the person is charged. Zero unless a provider is charging it. */
  basisPoints: number;
  /** What Ryntra asked for. Differs from `basisPoints` exactly when it was not applied. */
  requestedBasisPoints: number;
  /** The asset the fee is stated in: mint on Solana, contract on an EVM chain, null when unstated. */
  asset: string | null;
  symbol: string | null;
  decimals: number | null;
  /**
   * Raw base units, **exactly as the provider stated them** — or, for `/build`'s
   * fee on the input side, the program's own exact arithmetic on the amount,
   * proved against the fee account by the simulation of the very bytes the
   * wallet signs. Never an estimate.
   */
  amountRaw: string | null;
  /** The provider's own USD figure, when it states one. Never derived from a price. */
  usd: number | null;
  accrual: ServiceFeeAccrual;
  /**
   * Percentage of the gross the provider keeps before Ryntra sees it, when the
   * provider documents one. Jupiter documents 20%; the others document none.
   * A documented rate, not an estimate of an amount.
   */
  providerRetainedPercent: number | null;
  /**
   * Who ended up with what, in the fee's own asset and in raw units.
   *
   * Separate fields because they are separate facts and conflating them is how a
   * business overstates itself: what the **person paid** is not what **Ryntra
   * received**, and neither is what was **asked for**. Null until an operation has
   * finished and something has actually been read back.
   *
   * `usd` anywhere in this model is the provider's own display figure and is an
   * estimate. These are not.
   */
  settlement: ServiceFeeSettlement | null;
  /** Short, operator-facing, and only present when the state is not `QUOTED` or `COLLECTED`. */
  note: string | null;
}>;

/**
 * The split of one collected fee, in raw base units of the fee asset.
 *
 * `operationRef` is the reason a ledger can add these up without adding one
 * twice. Reading an operation again produces the same reference, so a second
 * read is the same income rather than new income — which is the only defence
 * against a status poll quietly inventing revenue.
 */
export type ServiceFeeSettlement = Readonly<{
  /** What the person was charged. Null where nothing states it. */
  userPaidRaw: string | null;
  /** The provider's own cut of that charge. */
  providerRaw: string | null;
  /** What actually reached Ryntra. The only figure that is ever income. */
  ryntraRaw: string | null;
  /** The asset all three are denominated in: mint on Solana, contract on an EVM chain. */
  asset: string | null;
  symbol: string | null;
  decimals: number | null;
  /**
   * How much of the split was seen rather than worked out.
   *
   * `OBSERVED` — every figure came from a read. `RYNTRA_OBSERVED_SPLIT_DOCUMENTED`
   * — the **gross** was read (what the person paid) and the two shares follow
   * from the provider's published cut, which is a documented rate rather than a
   * measurement. Nothing here is ever an estimate of an unknown.
   */
  basis: "OBSERVED" | "RYNTRA_OBSERVED_SPLIT_DOCUMENTED";
  /** The signature or provider request id this fee belongs to. The dedupe key. */
  operationRef: string;
}>;

const ZERO = {
  basisPoints: 0,
  asset: null,
  symbol: null,
  decimals: null,
  amountRaw: null,
  usd: null,
  providerRetainedPercent: null,
  settlement: null,
} as const;

/** This route has no provider mechanism for an integrator fee. */
export function serviceFeeAbsent(note: string): RyntraServiceFee {
  return { ...ZERO, mechanism: "NONE", state: "NONE", accrual: "NONE", requestedBasisPoints: 0, note };
}

/** The mechanism exists; Ryntra has no address configured for it. */
export function serviceFeeUnconfigured(mechanism: Exclude<ServiceFeeMechanism, "NONE">, note: string, requestedBasisPoints = serviceFeeRateFor(mechanism)): RyntraServiceFee {
  return { ...ZERO, mechanism, state: "UNCONFIGURED", accrual: accrualFor(mechanism), requestedBasisPoints, note };
}

/** Asked for, and the provider's answer does not carry it. */
export function serviceFeeNotApplied(mechanism: Exclude<ServiceFeeMechanism, "NONE">, note: string, requestedBasisPoints = serviceFeeRateFor(mechanism)): RyntraServiceFee {
  return { ...ZERO, mechanism, state: "NOT_APPLIED", accrual: accrualFor(mechanism), requestedBasisPoints, note };
}

/** The provider states this fee in the quote a person is about to review. */
export function serviceFeeQuoted(
  mechanism: Exclude<ServiceFeeMechanism, "NONE">,
  stated: Readonly<{
    basisPoints: number;
    asset?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    amountRaw?: string | null;
    usd?: number | null;
    providerRetainedPercent?: number | null;
    /** The flow's rate asked for; the mechanism's default when absent. */
    requestedBasisPoints?: number;
  }>,
): RyntraServiceFee {
  return {
    mechanism,
    state: "QUOTED",
    basisPoints: stated.basisPoints,
    requestedBasisPoints: stated.requestedBasisPoints ?? serviceFeeRateFor(mechanism),
    asset: stated.asset ?? null,
    symbol: stated.symbol ?? null,
    decimals: stated.decimals ?? null,
    amountRaw: stated.amountRaw ?? null,
    usd: stated.usd ?? null,
    accrual: accrualFor(mechanism),
    providerRetainedPercent: stated.providerRetainedPercent ?? null,
    settlement: null,
    note: null,
  };
}

/**
 * What the provider says happened, after the operation finished.
 *
 * `collected: false` is not an error and not a zero to hide — it is the answer,
 * and it keeps the quoted figure visible beside it so the gap is legible.
 */
export function settleServiceFee(
  quoted: RyntraServiceFee,
  settled: Readonly<{
    collected: boolean;
    amountRaw?: string | null;
    usd?: number | null;
    asset?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    settlement?: ServiceFeeSettlement | null;
    note?: string | null;
  }>,
): RyntraServiceFee {
  if (quoted.mechanism === "NONE") return quoted;
  if (!settled.collected) {
    return {
      ...quoted,
      state: "NOT_COLLECTED",
      /* A settlement is still worth keeping when there is one: it records that
         the person may have paid while Ryntra received nothing, which is a
         different and more useful fact than an empty row. */
      settlement: settled.settlement ?? quoted.settlement,
      note: settled.note ?? "The provider did not state a collected fee for this operation.",
    };
  }
  return {
    ...quoted,
    state: "COLLECTED",
    /* The settled figures win where the provider states them, because a quote
       is an estimate of this and this is the thing that happened. Where it
       states nothing, the quoted figure stands and the state still says the fee
       was taken — which is exactly what the provider told us. */
    amountRaw: settled.amountRaw ?? quoted.amountRaw,
    usd: settled.usd ?? quoted.usd,
    asset: settled.asset ?? quoted.asset,
    symbol: settled.symbol ?? quoted.symbol,
    decimals: settled.decimals ?? quoted.decimals,
    settlement: settled.settlement ?? quoted.settlement,
    note: settled.note ?? null,
  };
}

/**
 * The one predicate anything counting revenue may use.
 *
 * A quoted fee has not been earned. This is the line between a product that
 * knows what it makes and one that reports its intentions as income.
 */
export function isServiceFeeIncome(fee: RyntraServiceFee): boolean {
  return fee.state === "COLLECTED" && fee.basisPoints > 0;
}

/** True when a surface must show a fee row at all. `NONE` and zero still show a zero. */
export function serviceFeeIsCharged(fee: RyntraServiceFee): boolean {
  return fee.basisPoints > 0 && fee.state !== "NOT_APPLIED" && fee.state !== "UNCONFIGURED";
}

export const SERVICE_FEE_MECHANISMS = ["JUPITER_REFERRAL", "JUPITER_PLATFORM_FEE", "RELAY_APP_FEE", "MAYAN_REFERRER", "METEORA_LAUNCH", "NONE"] as const;
export const SERVICE_FEE_STATES = ["NONE", "UNCONFIGURED", "NOT_APPLIED", "QUOTED", "COLLECTED", "NOT_COLLECTED"] as const;
export const SERVICE_FEE_ACCRUALS = [
  "JUPITER_REFERRAL_TOKEN_ACCOUNT",
  "FEE_WALLET_TOKEN_ACCOUNT",
  "RELAY_APP_BALANCE_USDC",
  "MAYAN_ONCHAIN_REFERRER",
  "METEORA_PARTNER_VAULT",
  "NONE",
] as const;

/**
 * The schema every surface that stores or verifies a fee shares.
 *
 * Defined here rather than beside each consumer so a Review, a Receipt and a
 * cross-chain order cannot drift into three subtly different ideas of the same
 * fee — which is how a revenue figure ends up meaning one thing in one ledger
 * and something else in the next.
 */
const RawAmountSchema = z.string().regex(/^[0-9]+$/);

export const ServiceFeeSchema = z
  .object({
    mechanism: z.enum(SERVICE_FEE_MECHANISMS),
    state: z.enum(SERVICE_FEE_STATES),
    basisPoints: z.number().int().min(0).max(10_000),
    requestedBasisPoints: z.number().int().min(0).max(10_000),
    asset: z.string().min(1).max(64).nullable(),
    symbol: z.string().min(1).max(32).nullable(),
    decimals: z.number().int().min(0).max(24).nullable(),
    amountRaw: z
      .string()
      .regex(/^[0-9]+$/)
      .nullable(),
    usd: z.number().finite().nullable(),
    accrual: z.enum(SERVICE_FEE_ACCRUALS),
    providerRetainedPercent: z.number().int().min(0).max(100).nullable(),
    settlement: z
      .object({
        userPaidRaw: RawAmountSchema.nullable(),
        providerRaw: RawAmountSchema.nullable(),
        ryntraRaw: RawAmountSchema.nullable(),
        asset: z.string().min(1).max(64).nullable(),
        symbol: z.string().min(1).max(32).nullable(),
        decimals: z.number().int().min(0).max(24).nullable(),
        basis: z.enum(["OBSERVED", "RYNTRA_OBSERVED_SPLIT_DOCUMENTED"]),
        operationRef: z.string().min(1).max(128),
      })
      .strict()
      .nullable()
      /* `default(null)` rather than `optional()`: a receipt sealed before the
         split existed still parses, and what comes out is always `null` rather
         than sometimes `undefined` — one absent value instead of two. */
      .default(null),
    note: z.string().min(1).max(400).nullable(),
  })
  .strict();

/**
 * The rate, as a person reads it. `0.50%` on Jupiter, `0.25%` on Relay, or
 * `0.00%` when nothing is charged.
 *
 * One function so the Swap card, the cross-chain card and the pre-sign snapshot
 * cannot round the same fee three ways. Two decimal places because 25 bps is
 * 0.25% and a single place would print `0.3%`, a different claim about somebody’s
 * money than the one being made.
 */
export function serviceFeeRateText(fee: RyntraServiceFee): string {
  return `${(fee.basisPoints / 100).toFixed(2)}%`;
}

/**
 * The amount and its asset, when the provider stated both, else null.
 *
 * Null is common and correct: Jupiter states a rate and never an amount, so a
 * Review shows `0.50%` and no figure rather than a figure this code invented.
 */
export function serviceFeeAmountText(fee: RyntraServiceFee): string | null {
  if (fee.amountRaw === null || fee.decimals === null) return null;
  const value = BigInt(fee.amountRaw);
  const unit = 10n ** BigInt(fee.decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(fee.decimals, "0").replace(/0+$/, "");
  const amount = fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  return fee.symbol ? `${amount} ${fee.symbol}` : amount;
}

/** The mints a dollar figure needs no price for: a dollar is a dollar. */
const DOLLAR_FEE_MINTS: ReadonlySet<string> = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const NBSP = " ";

export type ServiceFeeReviewOptions = Readonly<{
  /** Shown when nothing is charged. */
  none?: string;
  /** A locale for the figures («0,25%» in Ukrainian); absent, the cards' own dot. */
  numbers?: string;
  /** The provider's dollar figure of each whole side of the quote, for a dollar anchor beside a fee in a token. */
  usd?: Readonly<{ input: number | null; output: number | null }>;
  /** How the amount follows the rate: «0.25% · 0.0025 USDC» on its own row, «0.25% (0.0025 USDC)» inside a list of costs. */
  joiner?: "dot" | "parentheses";
}>;

/**
 * «Комісія Ryntra» before the signature, the one formatter every surface
 * uses: the rate, and the amount — exact where it is known before the swap
 * (`/build`'s input side), else `≈` a share of the side the fee is taken
 * from — with a dollar anchor when the fee is in a token and the quote states
 * that side's dollar figure. The settled card reads `serviceFeeText`: after
 * the swap the amount is the chain's.
 *
 * No-break spaces keep the figures whole, «0.10% · 0.00001 SOL»: a narrow
 * cell wraps between the label and the figures, never inside them.
 *
 * `sides` names the decimals and the code of the swap's two mints, which the
 * card already holds; a fee whose own scale is stated uses its own.
 */
export function serviceFeeReviewText(
  fee: RyntraServiceFee,
  quote: Readonly<{ inputMint: string; outputMint: string; inputRaw: string; quotedOutputRaw: string }>,
  sides: Readonly<Record<string, Readonly<{ decimals: number | null; code: string | null }>>>,
  options: ServiceFeeReviewOptions | string = {},
): string {
  const { none = "None", numbers, usd, joiner = "dot" } = typeof options === "string" ? { none: options } : options;
  if (fee.basisPoints === 0) return none;
  const fixed = (value: number, digits: number) =>
    numbers ? new Intl.NumberFormat(numbers, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : value.toFixed(digits);
  const rate = `${fixed(fee.basisPoints / 100, 2)}%`;
  const estimate = serviceFeeEstimate(fee, quote);
  const asset = fee.asset;
  const decimals = fee.decimals ?? (asset ? sides[asset]?.decimals ?? null : null);
  const code = fee.symbol ?? (asset ? sides[asset]?.code ?? null : null);
  /* No amount to size: the provider's own dollar figure where it states one, else the rate alone. */
  if (!estimate || decimals === null) return fee.usd !== null && fee.usd > 0 ? serviceFeeText(fee, none) : rate;
  const plain = serviceFeeAmountText({ ...fee, amountRaw: estimate.amountRaw, decimals, symbol: null }) ?? "0";
  const figure = numbers ? new Intl.NumberFormat(numbers, { maximumFractionDigits: decimals }).format(Number(estimate.amountRaw) / 10 ** decimals) : plain;
  /* A dollar anchor for a fee in a token — SOL, a token — from the quote's own dollar figure for that side; a fee in dollars is its own anchor. */
  const sideUsd = asset === quote.inputMint ? usd?.input ?? null : asset === quote.outputMint ? usd?.output ?? null : null;
  const sideRaw = asset === quote.inputMint ? quote.inputRaw : quote.quotedOutputRaw;
  const feeUsd =
    asset && !DOLLAR_FEE_MINTS.has(asset) && sideUsd !== null && sideUsd > 0 && BigInt(sideRaw) > 0n ? (sideUsd * Number(estimate.amountRaw)) / Number(sideRaw) : null;
  const dollars = feeUsd === null ? null : feeUsd < 0.01 ? `<${NBSP}$${fixed(0.01, 2)}` : `≈${NBSP}$${fixed(feeUsd, 2)}`;
  const amount = `${estimate.exact ? "" : `≈${NBSP}`}${figure}${code ? `${NBSP}${code}` : ""}`;
  if (joiner === "parentheses") return `${rate}${NBSP}(${amount}${dollars ? `,${NBSP}${dollars}` : ""})`;
  /* An ordinary space before the dollar anchor: on a narrow screen it is the one place the figure may wrap. */
  return `${rate}${NBSP}·${NBSP}${amount}${dollars ? ` (${dollars})` : ""}`;
}

/**
 * The whole fee as one line: the rate, plus the most specific figure the provider
 * actually stated beside it.
 *
 * Three providers state three different amounts of detail and none of them is
 * negotiable. Relay names a token amount; Mayan names only a dollar figure;
 * Jupiter names neither, only the rate. So this shows a token amount where there
 * is one, a dollar figure where that is all there is, and the rate alone where
 * the provider said nothing more — and never a number this code worked out for
 * itself.
 *
 * `< $0.01` rather than `$0.00` for a real but tiny charge, because rounding a
 * fee to nothing is a small lie in the direction that flatters us.
 */
export function serviceFeeText(fee: RyntraServiceFee, none = "None"): string {
  if (fee.basisPoints === 0) return none;
  const rate = serviceFeeRateText(fee);
  const amount = serviceFeeAmountText(fee);
  if (amount) return `${rate} · ${amount}`;
  if (fee.usd === null || fee.usd <= 0) return rate;
  return `${rate} · ${fee.usd < 0.01 ? "< $0.01" : `≈ $${fee.usd.toFixed(2)}`}`;
}

/**
 * The fee's size before the swap lands. Where the provider stated an amount,
 * that amount; else a share of the side the fee is taken from — on the input
 * side the provider's own arithmetic on the amount typed, on the output side
 * a share of the quoted output, an estimate the receipt replaces with what
 * the chain shows. Null when the fee's asset is neither side.
 */
export function serviceFeeEstimate(
  fee: Pick<RyntraServiceFee, "basisPoints" | "asset" | "amountRaw">,
  quote: Readonly<{ inputMint: string; outputMint: string; inputRaw: string; quotedOutputRaw: string }>,
): Readonly<{ amountRaw: string; exact: boolean }> | null {
  if (fee.amountRaw !== null) return { amountRaw: fee.amountRaw, exact: true };
  if (fee.basisPoints <= 0 || fee.basisPoints >= 10_000 || fee.asset === null) return null;
  const bps = BigInt(fee.basisPoints);
  if (fee.asset === quote.inputMint) return { amountRaw: ((BigInt(quote.inputRaw) * bps) / 10_000n).toString(), exact: false };
  /* Jupiter sizes an output-side fee on the route's own output (a simulation, 2026-10-05: 10 bps of 3 313 283 paid 3 312); the quote's output stands in for it. */
  if (fee.asset === quote.outputMint) return { amountRaw: ((BigInt(quote.quotedOutputRaw) * bps) / 10_000n).toString(), exact: false };
  return null;
}

/** Jupiter's total already includes Ryntra's fee — the referral fee with Jupiter's retained share, or `/build`'s platform fee. */
export function additionalJupiterFeeBps(total: number | null, fee: Pick<RyntraServiceFee, "mechanism" | "basisPoints"> | null): number | null {
  if (total === null || !Number.isFinite(total) || total < 0) return null;
  const included = fee?.mechanism === "JUPITER_REFERRAL" || fee?.mechanism === "JUPITER_PLATFORM_FEE" ? fee.basisPoints : 0;
  return Math.max(0, total - included);
}

export function accrualFor(mechanism: ServiceFeeMechanism): ServiceFeeAccrual {
  switch (mechanism) {
    case "JUPITER_REFERRAL":
      return "JUPITER_REFERRAL_TOKEN_ACCOUNT";
    case "JUPITER_PLATFORM_FEE":
      return "FEE_WALLET_TOKEN_ACCOUNT";
    case "RELAY_APP_FEE":
      return "RELAY_APP_BALANCE_USDC";
    case "MAYAN_REFERRER":
      return "MAYAN_ONCHAIN_REFERRER";
    case "METEORA_LAUNCH":
      return "METEORA_PARTNER_VAULT";
    default:
      return "NONE";
  }
}

/**
 * The addresses the three mechanisms need. Public receiving addresses only —
 * there is no private key here and none is ever required to take a fee.
 */
export type ServiceFeeConfig = Readonly<{
  /** Jupiter Referral account (base58), created once against the Ultra referral project. */
  jupiterReferralAccount: string | null;
  /** EVM claim address for Relay's off-chain app balance. */
  relayAppFeeRecipient: string | null;
  /** Solana address Mayan pays the referrer fee to, on every route. */
  mayanReferrerSolana: string | null;
}>;

export const SERVICE_FEE_CONFIG_UNSET: ServiceFeeConfig = {
  jupiterReferralAccount: null,
  relayAppFeeRecipient: null,
  mayanReferrerSolana: null,
};

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A configured value that is not an address of the right shape is treated as
 * absent rather than sent to a provider.
 *
 * Sending a malformed referral account is the one way this feature could damage
 * a working swap: the provider would refuse the whole order, and a person would
 * be told the market is unavailable because of a typo in an environment
 * variable. So the shape is checked here, once, and a bad value degrades to "no
 * fee" instead of to "no swap".
 */
export function normalizeServiceFeeConfig(
  raw: Readonly<{ jupiterReferralAccount?: string | null; relayAppFeeRecipient?: string | null; mayanReferrerSolana?: string | null }>,
): ServiceFeeConfig {
  const base58 = (value: string | null | undefined): string | null => {
    const text = value?.trim() ?? "";
    return BASE58_ADDRESS.test(text) ? text : null;
  };
  const evm = (value: string | null | undefined): string | null => {
    const text = value?.trim() ?? "";
    return EVM_ADDRESS.test(text) ? text : null;
  };
  return {
    jupiterReferralAccount: base58(raw.jupiterReferralAccount),
    relayAppFeeRecipient: evm(raw.relayAppFeeRecipient),
    mayanReferrerSolana: base58(raw.mayanReferrerSolana),
  };
}
