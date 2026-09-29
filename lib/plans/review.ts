/**
 * The Strategy block of the one Review — canon Part A §9.3, §9.5, §10.1
 * (`RYN-STRATEGY-PLAN-001` stage B).
 *
 * A plan's current version judged on the order in front of the person, as
 * the contract's `PlanReview`: seventeen typed checks, each `pass`, `fail` or
 * `unknown`, with what was expected and what was found. **An unknown is
 * never a pass**: a required check that fails or is unknown makes the verdict
 * `blocked` and the order route builds no bytes; an advisory one makes it
 * `attention` and the person decides. Pure: the plan, the quote and the
 * stock row in, the block out; the clock is a parameter.
 *
 * Figures are compared on one basis — USD per underlying share, the token
 * leg through the mint's own multiplier applied once (units.ts) — and the
 * `expected` / `actual` strings are figures with a few state words, so both
 * languages read them.
 *
 * **The money at this price is the sizing's own model (§9.4), nothing else.**
 * `sizing.ts` sized the version at the planned entry; here the same formula
 * runs with the executable per-share price in the entry's place:
 *
 *   lossPerShare(quote) = executable − invalidation + executable × costBufferBps / 10 000
 *   modelledLoss        = units × lossPerShare(quote)          ≤ plannedRiskUsd   (`risk`, required)
 *   spend               = usd                                   ≤ budget − reserve (`spend`, required)
 *   invalidation        = executable                            > invalidation     (`invalidation`, required)
 *   size                = usd                                   ≤ sized notional   (`size`, advisory)
 *
 * The executable price already holds this quote's fee and impact; the plan's
 * cost buffer is the plan's own allowance for the round trip and is applied
 * once, exactly as the sizing applied it. Nothing here subtracts the quote's
 * fee a second time. A deal that fits the budget and not the planned risk is
 * refused; the block also says the amount that would fit at this price.
 *
 * **The evidence checks (1.5.0, `RYN-NANSEN-EVIDENCE-001`).** A version that
 * carries evidence conditions is judged on the observations the caller
 * fetched for the windows the conditions name — one `evidence` check per
 * condition, in the version's order, each judged by the evidence layer's own
 * evaluator (`lib/evidence/conditions.ts`): required blocks on unmet, stale,
 * unknown or unavailable; advisory names it. The block records what it knew
 * — the provider, the reads with their times and states, each condition's
 * figure — and how long the figures are retained with it. The caller that
 * fetched nothing for a window has, for that window, an unknown; nothing
 * here reaches a provider, and a version without conditions gains no check.
 *
 * **A token plan (1.7.0, `RYN-PLAN-CRYPTO-001`).** A `crypto` or `meme` asset
 * is judged on the mint's own decimals (no multiplier, no activation window)
 * and on the catalogue's liquidity the caller read; the reference and the
 * deviation are not applicable to it and say so — advisory, passing — because
 * a token has no issuer reference and the write already refused a version
 * that required one. Every other check is the same check.
 */

import { isTokenPlanAsset, planUnitBasis, type PlanCheck, type PlanCheckId, type PlanReview, type PlanReviewEvidence, type PlanRules, type PlanSizing, type TradingPlan } from "../api/v1/contract.ts";
import { judgeEvidenceCondition, providerOfCondition } from "../evidence/conditions.ts";
import { providerOfWindow, type EvidenceProvider, type EvidenceWindow } from "../evidence/metrics.ts";
import { providerRights } from "../evidence/rights.ts";
import type { MarketEvidenceRead } from "../evidence/snapshot.ts";

/** One read per window the version's conditions name, made by the caller before the Review is built. */
/** One read the caller made for the Review: the window, the provider (absent, the window names it) and the read. */
export type EvidenceReadByWindow = Readonly<{ window: EvidenceWindow; provider?: EvidenceProvider; read: MarketEvidenceRead }>;
import { referenceStateOf, type ReferenceState } from "../stocks/session.ts";
import { deviationPct, multiplierState, perShareExecutable, scaledAmountString } from "../stocks/units.ts";
import type { StockRow } from "../stocks/universe.server.ts";

export type PlanReviewOrder = Readonly<{
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  slippageBps: number;
  priceImpactPct: string;
  totalFeeBasisPoints: number;
  observedAt: string;
  reviewExpiresAt: string;
  /** The operation's own id — the order's request id; the Review, the execution and the Receipt carry it. */
  requestId: string;
}>;

/** What the caller read from the Spot catalogue for a token plan (1.7.0): the venue's liquidity, where it states one. */
export type PlanReviewMarket = Readonly<{ liquidityUsd: number | null }>;

const USDC_DECIMALS = 6;

/**
 * Money in the checks' strings: two decimals from a cent up; below a cent (a
 * meme priced in fractions of a cent, 1.7.0) enough significant digits to
 * say the figure rather than `$0.00`.
 */
export const usd = (value: number): string =>
  value > 0 && value < 0.01 ? `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}` : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const unitsText = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 });

function floorCents(value: number): number {
  return Math.max(0, Math.floor(value * 100 + 1e-9) / 100);
}

/** The loss per underlying share to the invalidation at a price, on the sizing's formula. */
export function lossPerShareAt(executablePerShare: number, rules: Pick<PlanRules, "risk">): number {
  return executablePerShare - rules.risk.invalidationPerShare + (executablePerShare * rules.risk.costBufferBps) / 10_000;
}

/** The loss a deal of `units` models at a price; never below zero, because the figure is a loss. */
export function modelledLossUsd(units: number, executablePerShare: number, rules: Pick<PlanRules, "risk">): number {
  const loss = units * lossPerShareAt(executablePerShare, rules);
  return Number.isFinite(loss) ? Math.max(0, Math.round(loss * 100) / 100) : 0;
}

/** The USD amount that fits the plan at a price: the smaller of the risk-limited and the spendable size, in cents. */
export function fitUsdAt(executablePerShare: number, rules: Pick<PlanRules, "risk" | "capital">): number {
  const lossPerShare = lossPerShareAt(executablePerShare, rules);
  const spendable = rules.capital.budgetUsd - rules.capital.reserveForCostsUsd;
  const riskLimitedUnits = lossPerShare > 0 ? rules.risk.plannedRiskUsd / lossPerShare : 0;
  const capitalLimitedUnits = spendable > 0 ? spendable / executablePerShare : 0;
  return floorCents(Math.min(riskLimitedUnits, capitalLimitedUnits) * executablePerShare);
}

export type MoneyCheckInput = Readonly<{
  rules: PlanRules;
  sizing: PlanSizing;
  usdAmount: number;
  /** Underlying units the deal buys, or null when the units are unknown. */
  units: number | null;
  perShare: number | null;
  symbol: string;
  /** The word after a per-unit figure: `share` (the default, every plan before 1.4.0) or `token` (a pre-IPO instrument). */
  unitWord?: "share" | "token";
}>;

/**
 * The checks about the money, judged the same way before the signature (on
 * the quote) and after it (on the fill): the budget, the spendable part, the
 * entry bound, the invalidation, the planned risk and the version's size.
 */
export function moneyChecks(input: MoneyCheckInput): PlanCheck[] {
  const { rules, sizing, usdAmount, units, perShare, symbol } = input;
  const unit = input.unitWord ?? "share";
  const checks: PlanCheck[] = [];
  const check = (id: PlanCheckId, outcome: PlanCheck["outcome"], required: boolean, expected: string, actual: string | null) => checks.push({ id, outcome, required, expected, actual });

  check("budget", usdAmount <= rules.capital.budgetUsd ? "pass" : "fail", true, `at most ${usd(rules.capital.budgetUsd)}`, usd(usdAmount));
  const spendable = rules.capital.budgetUsd - rules.capital.reserveForCostsUsd;
  check("spend", usdAmount <= spendable ? "pass" : "fail", true, `at most ${usd(spendable)} · ${usd(rules.capital.reserveForCostsUsd)} kept for costs`, usd(usdAmount));

  if (rules.entry.maxPricePerShare === null) {
    check("entryPrice", perShare === null ? "unknown" : "pass", true, "no bound · reported", perShare === null ? null : `${usd(perShare)} / ${unit}`);
  } else {
    check("entryPrice", perShare === null ? "unknown" : perShare <= rules.entry.maxPricePerShare ? "pass" : "fail", true, `at most ${usd(rules.entry.maxPricePerShare)} / ${unit}`, perShare === null ? null : `${usd(perShare)} / ${unit}`);
  }

  check("invalidation", perShare === null ? "unknown" : perShare > rules.risk.invalidationPerShare ? "pass" : "fail", true, `above ${usd(rules.risk.invalidationPerShare)} / ${unit}`, perShare === null ? null : `${usd(perShare)} / ${unit}`);

  const loss = units !== null && perShare !== null ? modelledLossUsd(units, perShare, rules) : null;
  check(
    "risk",
    loss === null ? "unknown" : loss <= rules.risk.plannedRiskUsd ? "pass" : "fail",
    true,
    `modelled loss at most ${usd(rules.risk.plannedRiskUsd)}`,
    loss === null || units === null || perShare === null ? null : `${usd(loss)} · ${unitsText(units)} ${symbol} at ${usd(perShare)}`,
  );

  check("size", usdAmount <= sizing.notionalUsd + 0.005 ? "pass" : "fail", false, `about ${usd(sizing.notionalUsd)} · ${unitsText(sizing.units)} ${symbol} sized`, units === null ? usd(usdAmount) : `${usd(usdAmount)} · ${unitsText(units)} ${symbol}`);
  return checks;
}

function contractReferenceState(state: ReferenceState): PlanReview["quote"]["referenceState"] {
  if (state === "unavailable") return "unavailable";
  if (state === "stale") return "stale";
  /* `last-available` and `confirmed-close` are current by age; only the exchange is closed. */
  return "current";
}

function referenceWord(state: ReferenceState): string {
  return state === "last-available" ? "last available" : state === "confirmed-close" ? "confirmed close" : state;
}

/**
 * The evidence checks and the block, from the version's conditions and the
 * reads the caller made. Exported for the order route's test and for the
 * public slice; pure.
 */
export function evidenceChecks(
  input: Readonly<{ rules: PlanRules; reads: readonly EvidenceReadByWindow[]; nowMs: number }>,
): Readonly<{ checks: PlanCheck[]; evidence: PlanReviewEvidence | null }> {
  /* A version written before the field existed carries none; a fixture may omit it. Neither gains a check. */
  const conditions: readonly PlanRules["evidenceConditions"][number][] = Array.isArray(input.rules.evidenceConditions) ? input.rules.evidenceConditions : [];
  if (conditions.length === 0) return { checks: [], evidence: null };
  /* A read is matched by provider and window: a condition's metric names
     its provider in the registry (1.6.0); a caller that handed reads without
     one named the first provider's windows, as 1.5.0 did. */
  const providerOf = (entry: EvidenceReadByWindow): EvidenceProvider => entry.provider ?? providerOfWindow(entry.window);
  const readFor = (provider: EvidenceProvider, window: EvidenceWindow): MarketEvidenceRead =>
    input.reads.find((entry) => entry.window === window && providerOf(entry) === provider)?.read ?? { state: "UNAVAILABLE", snapshot: null, reason: `No observation was read for ${window}.`, served: "none" };
  const checks: PlanCheck[] = [];
  const judged: PlanReviewEvidence["conditions"][number][] = [];
  const keys: { provider: EvidenceProvider; window: EvidenceWindow }[] = [];
  for (const condition of conditions) {
    const provider = providerOfCondition(condition) ?? providerOfWindow(condition.window);
    if (!keys.some((key) => key.provider === provider && key.window === condition.window)) keys.push({ provider, window: condition.window });
    const read = readFor(provider, condition.window);
    const judgement = judgeEvidenceCondition(condition, read, input.nowMs);
    checks.push({ id: "evidence", outcome: judgement.outcome, required: condition.mode === "required", expected: judgement.expected.slice(0, 160), actual: judgement.actual === null ? null : judgement.actual.slice(0, 160) });
    judged.push({ metric: condition.metric, window: condition.window, operator: condition.operator, threshold: condition.threshold, mode: condition.mode, outcome: judgement.outcome, value: judgement.value, unit: judgement.unit });
  }
  const reads: PlanReviewEvidence["reads"][number][] = keys.map(({ provider, window }) => {
    const read = readFor(provider, window);
    return {
      provider,
      window,
      state: read.state,
      fetchedAt: read.snapshot?.fetchedAt ?? null,
      observedAt: read.snapshot?.observedAt ?? null,
      providerLagSeconds: read.snapshot?.providerLagSeconds ?? null,
      reason: read.reason === null ? null : read.reason.slice(0, 240),
    };
  });
  const providers = [...new Set(keys.map((key) => key.provider))];
  const sources = providers.map((provider) => ({ provider, attribution: providerRights(provider).attribution }));
  /* The figures stay with the review for the shortest retention among the sources read. */
  const retainSeconds = Math.min(...providers.map((provider) => providerRights(provider).retainJudgedValueSeconds));
  return {
    checks,
    evidence: {
      provider: sources[0].provider,
      attribution: sources[0].attribution,
      sources,
      reads,
      conditions: judged,
      retainedUntil: new Date(input.nowMs + retainSeconds * 1000).toISOString(),
    },
  };
}

export function evaluatePlanReview(
  input: Readonly<{ plan: TradingPlan; requestedVersion: number; order: PlanReviewOrder; row: StockRow | null; market?: PlanReviewMarket | null; usdcMint: string; nowMs: number; evidence?: readonly EvidenceReadByWindow[] }>,
): PlanReview {
  const { plan, order, nowMs } = input;
  /* A token plan (1.7.0) is judged on the mint's own decimals and the catalogue's liquidity: a stock row handed for it is not its reference and is not read. */
  const tokenAsset = isTokenPlanAsset(plan.asset);
  const row = tokenAsset ? null : input.row;
  const rules = plan.current.rules;
  const checks: PlanCheck[] = [];
  const check = (id: PlanCheckId, outcome: PlanCheck["outcome"], required: boolean, expected: string, actual: string | null) => checks.push({ id, outcome, required, expected, actual });

  /* Identity and state of the plan. */
  check("status", plan.status === "active" ? "pass" : "fail", true, "active", plan.status);
  const mintMatches = order.outputMint === plan.asset.mint || order.inputMint === plan.asset.mint;
  const shortMint = `${plan.asset.mint.slice(0, 6)}…${plan.asset.mint.slice(-5)}`;
  check("asset", order.outputMint === plan.asset.mint ? "pass" : "fail", true, `${plan.asset.symbol} · ${shortMint}`, mintMatches ? `${plan.asset.symbol} · ${shortMint}` : `${order.outputMint.slice(0, 6)}…${order.outputMint.slice(-5)}`);
  const isBuy = order.inputMint === input.usdcMint && order.outputMint === plan.asset.mint;
  check("side", isBuy ? "pass" : "fail", true, "BUY", isBuy ? "BUY" : order.inputMint === plan.asset.mint ? "SELL" : "other pair");
  check("version", input.requestedVersion === plan.version ? "pass" : "fail", true, `version ${plan.version} is current`, `version ${input.requestedVersion}`);
  const validUntil = rules.entry.validUntil;
  const validity = validUntil === null ? "pass" : Date.parse(validUntil) > nowMs ? "pass" : "fail";
  check("validity", validity, true, validUntil === null ? "no expiry" : `until ${validUntil.slice(0, 10)}`, new Date(nowMs).toISOString().slice(0, 10));

  /* The units. A stock's units go through the mint's multiplier once; a
     token plan's (1.7.0) are the mint's own decimals — a plain token has no
     multiplier and no activation window, so its amount is always known. */
  const usdAmount = Number(BigInt(order.inAmountRaw)) / 10 ** USDC_DECIMALS;
  const decimals = row?.representation.decimals ?? plan.asset.decimals;
  const multiplier = tokenAsset ? null : (row?.multiplier?.current ?? null);
  const state = row?.multiplier ? multiplierState(row.multiplier, nowMs) : null;
  const unitsKnown = tokenAsset ? decimals !== null : multiplier !== null;
  const scaled = decimals !== null && multiplier !== null ? scaledAmountString(BigInt(order.outAmountRaw), decimals, multiplier, 6) : decimals !== null ? scaledAmountString(BigInt(order.outAmountRaw), decimals, 1, 6) : "0";
  const units = unitsKnown ? Number(scaled) : null;
  const perShare = unitsKnown ? perShareExecutable(usdAmount, scaled) : null;
  /* The unit the plan was written in (1.4.0): a token plan's figures are per token as the wallet shows it. */
  const unitBasis = planUnitBasis(plan.asset);
  /* Judged from the reference's own observation time (a feed's publish time), never from the fetch. */
  const refState: ReferenceState = row ? referenceStateOf(row.reference, row.session.exchangeOpen, nowMs) : "unavailable";
  const referencePerShare = row && refState !== "unavailable" ? row.reference.perShare : null;
  const deviation = deviationPct(perShare, referencePerShare);

  /* The money, on the sizing's own model. */
  checks.push(...moneyChecks({ rules, sizing: plan.current.sizing, usdAmount, units: units !== null && units > 0 ? units : null, perShare, symbol: plan.asset.underlying.symbol, unitWord: unitBasis }));

  if (tokenAsset) {
    /* A token has no issuer reference: the two reference checks are not
       applicable and say so — advisory and passing, never an unknown that
       would refuse every order for a figure that cannot exist. The write
       already refused a version that required them. */
    check("reference", "pass", false, "none · a token has no issuer reference", "not applicable");
    check("deviation", "pass", false, "none · no reference to deviate from", "not applicable");
  } else {
    const referenceRequired = rules.execution.referenceRequired;
    const referenceOutcome: PlanCheck["outcome"] = refState === "unavailable" ? "unknown" : refState === "stale" ? "fail" : "pass";
    check("reference", referenceOutcome, referenceRequired, "a current reference", referencePerShare === null ? "unavailable" : `${usd(referencePerShare)} · ${referenceWord(refState)}`);

    /* A bound the person wrote is a bound: required whenever it exists, whatever
       the reference flag says — a rule that could turn into advice through
       another switch is not a rule. Without a reference the bound cannot be
       judged, which is an unknown, which does not sign. */
    const deviationBound = rules.execution.maxReferenceDeviationPct;
    if (deviationBound === null) {
      check("deviation", deviation === null ? "unknown" : "pass", false, "no bound · reported", deviation === null ? null : pct(deviation));
    } else {
      check("deviation", deviation === null ? "unknown" : Math.abs(deviation) <= deviationBound ? "pass" : "fail", true, `within ${deviationBound.toFixed(2)}%`, deviation === null ? null : pct(deviation));
    }
  }

  check("slippage", order.slippageBps <= rules.execution.maxSlippageBps ? "pass" : "fail", true, `at most ${(rules.execution.maxSlippageBps / 100).toFixed(2)}%`, `${(order.slippageBps / 100).toFixed(2)}%`);
  const ageSeconds = Math.max(0, Math.round((nowMs - Date.parse(order.observedAt)) / 1000));
  check("quoteAge", Number.isFinite(ageSeconds) && ageSeconds <= rules.execution.maxQuoteAgeSeconds ? "pass" : "fail", true, `at most ${rules.execution.maxQuoteAgeSeconds} s`, `${ageSeconds} s`);

  const liquidity = tokenAsset ? (input.market?.liquidityUsd ?? null) : (row?.market.liquidityUsd ?? null);
  if (rules.execution.minLiquidityUsd === null) {
    check("liquidity", "pass", false, "no floor", liquidity === null ? null : usd(liquidity));
  } else {
    check("liquidity", liquidity === null ? "unknown" : liquidity >= rules.execution.minLiquidityUsd ? "pass" : "fail", true, `at least ${usd(rules.execution.minLiquidityUsd)}`, liquidity === null ? null : usd(liquidity));
  }

  if (tokenAsset) {
    check("units", decimals === null ? "unknown" : "pass", true, "tokens as the wallet shows them, from the mint's decimals", decimals === null ? null : `tokens · ${decimals} decimals · no multiplier`);
  } else {
    check(
      "units",
      multiplier === null ? "unknown" : state === "activation-window" ? "fail" : "pass",
      true,
      "a known multiplier, no activation window",
      multiplier === null
        ? null
        : unitBasis === "token"
          ? `tokens as the wallet shows them · chain multiplier ${multiplier.toFixed(6)}${state === "activation-window" ? " · changing now" : ""}`
          : `1 ${plan.asset.symbol} = ${multiplier.toFixed(6)} ${plan.asset.underlying.symbol}${state === "activation-window" ? " · changing now" : ""}`,
    );
  }

  /* The person's own rules on observations, last: judged on the reads the
     caller made for the windows the version names. */
  const judged = evidenceChecks({ rules, reads: input.evidence ?? [], nowMs });
  checks.push(...judged.checks);

  const blocked = checks.some((entry) => entry.required && entry.outcome !== "pass");
  const attention = !blocked && checks.some((entry) => entry.outcome !== "pass");
  const impact = Number(order.priceImpactPct);
  return {
    ...(judged.evidence ? { evidence: judged.evidence } : {}),
    planId: plan.id,
    version: plan.version,
    latestVersion: plan.version,
    reviewId: order.requestId,
    checkedAt: new Date(nowMs).toISOString(),
    verdict: blocked ? "blocked" : attention ? "attention" : "ready",
    checks,
    quote: {
      side: "BUY",
      usd: usdAmount,
      amount: scaled,
      /* `underlying` only where the plan's unit is a share and the multiplier is known; a token plan answers `token` on the same scaled amount (a crypto or meme plan with no multiplier at all, 1.7.0). */
      unit: multiplier === null || unitBasis === "token" ? "token" : "underlying",
      multiplier,
      perShareUsd: perShare,
      referencePerShareUsd: referencePerShare,
      referenceState: contractReferenceState(refState),
      deviationPct: deviation,
      priceImpactPct: Number.isFinite(impact) ? impact : null,
      slippageBps: order.slippageBps,
      feeBps: order.totalFeeBasisPoints,
      observedAt: order.observedAt,
      reviewExpiresAt: order.reviewExpiresAt,
      modelledLossUsd: units !== null && units > 0 && perShare !== null ? modelledLossUsd(units, perShare, rules) : null,
      fitUsd: perShare !== null ? fitUsdAt(perShare, rules) : null,
    },
  };
}
