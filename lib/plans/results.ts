/**
 * Plan vs Actual — for the entry and beyond it.
 *
 * Three columns for one execution: **Plan** — the version the execution was
 * bound to before the signature; **Before signing** — the Strategy block the
 * order route judged and the plan kept; **Actual** — the History row the
 * chain settled, read off `in` / `out` and never off the quote. The actual
 * leg goes through the multiplier the Review stored, so a result from a
 * month ago is explained in the units of its own moment, not today's.
 *
 * **What an execution did (1.9.0).** The side is read off the signed
 * bundle's origin — carried on the execution ref, and on the History row
 * when the ref predates the field — never inferred afterwards from which of
 * two legs happens to be the stablecoin. A `BUY` under a long plan is the
 * entry: dollars leave on `out`, units arrive on `in`. A `SELL` is the exit:
 * units leave on `out`, dollars arrive on `in`. An execution whose side
 * nothing established is neither, and every figure that depends on knowing
 * which leg is which stays null.
 *
 * **The parts, never one number.** `costs` keeps the market's own move
 * between the plan being written and the Review apart from what execution
 * added between the Review and the fill, and both apart from the service fee
 * the settled row recorded. Each part says how it was established; a part
 * nothing established is `unknown` with a reason, not a zero. What the
 * Review modelled stays under `expected` and is never spoken of as paid.
 *
 * **The exit is judged only by rules that existed before it.** The version
 * in force is the newest one written at or before the exit's own settled
 * time; a rule the person wrote afterwards is not applied backwards, and the
 * result says so. Nothing here claims a realised profit — that is the
 * position's business (`position.ts`), and only when every leg is valued.
 *
 * Pure; the clock is a value.
 */

import { isTokenPlanAsset, planUnitBasis, type PlanCheck, type PlanCheckId, type PlanCosts, type PlanCostPart, type PlanExitAdherence, type PlanResult, type PlanReview, type PlanRules, type PlanVersion } from "../api/v1/contract.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { scaledAmountString } from "../stocks/units.ts";
import { redactExpiredEvidence } from "../evidence/retention.ts";
import { modelledLossUsd, moneyChecks } from "./review.ts";
import type { StoredPlanExecution, TradingPlanRecord } from "./store.ts";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

function usdOf(movement: SolanaWalletAction["out"]): number | null {
  if (!movement || movement.mint !== USDC_MINT) return null;
  return Number(BigInt(movement.amountRaw)) / 10 ** USDC_DECIMALS;
}

/** The row's service fee in USD, and how it was established: none recorded is null; explicitly not taken is zero; taken is the provider's own measurement, or the USDC amount at par. */
function feeOf(fee: SolanaWalletAction["fee"]): Readonly<{ usd: number | null; basis: PlanResult["actual"]["feeBasis"] }> {
  if (!fee) return { usd: null, basis: null };
  if (!fee.collected) return { usd: 0, basis: "NOT_TAKEN" };
  if (fee.usd !== null && Number.isFinite(fee.usd)) return { usd: Math.max(0, fee.usd), basis: "PROVIDER_STATED" };
  if (fee.amountRaw !== null && fee.decimals !== null && fee.asset === USDC_MINT) return { usd: Number(BigInt(fee.amountRaw)) / 10 ** fee.decimals, basis: "PAR" };
  return { usd: null, basis: null };
}

/** The asset leg of a movement in the plan's own unit, through the multiplier the Review stored. */
function unitsOf(movement: SolanaWalletAction["out"], mint: string, decimals: number | null, multiplier: number | null): string | null {
  if (!movement || movement.mint !== mint || decimals === null) return null;
  return scaledAmountString(BigInt(movement.amountRaw), decimals, multiplier ?? 1, 6);
}

/** A cost part nothing established. */
function unestablished(reason: string): PlanCostPart {
  return { usd: null, pct: null, basis: "unknown", reason };
}

function part(usd: number | null, pct: number | null, basis: PlanCostPart["basis"]): PlanCostPart {
  return { usd: usd === null ? null : Math.round(usd * 1e6) / 1e6, pct: pct === null ? null : Math.round(pct * 1e4) / 1e4, basis, reason: null };
}

/** The version whose rules were in force at a moment: the newest one written at or before it. */
export function versionInForceAt(record: TradingPlanRecord, atMs: number): PlanVersion | null {
  let found: PlanVersion | null = null;
  for (const entry of record.history) {
    if (Date.parse(entry.createdAt) <= atMs) found = entry;
  }
  return found;
}

/** Whether a version's rules name any exit rule at all. */
function hasExitRule(rules: PlanRules): boolean {
  return rules.exit.targetPerShare !== null || rules.exit.timeExitAt !== null;
}

/**
 * The exit judged against the rules that existed before it. `perUnit` is the
 * price the exit actually got; `atMs` its settled time. Only the version in
 * force at that moment is read — a target or a time exit written afterwards
 * is reported as not applied, never as a rule the exit broke.
 */
export function exitAdherenceFor(record: TradingPlanRecord, perUnit: number | null, atMs: number, unitWord: string): PlanExitAdherence {
  const ruling = versionInForceAt(record, atMs);
  const current = record.history[record.history.length - 1];
  const notBackdated = ruling !== null && ruling.version !== current.version && hasExitRule(current.rules) && !hasExitRule(ruling.rules);
  if (!ruling) return { ruledByVersion: null, checks: [], verdict: "unknown", notBackdated: false };
  const rules = ruling.rules;
  const checks: PlanCheck[] = [];
  const money = (value: number) => `$${value.toFixed(value < 1 ? 6 : 2)}`;
  const push = (id: PlanCheckId, outcome: PlanCheck["outcome"], required: boolean, expected: string, actual: string | null) => checks.push({ id, outcome, required, expected, actual });
  const priceText = perUnit === null ? null : `${money(perUnit)} / ${unitWord}`;

  if (rules.exit.targetPerShare !== null) {
    const target = rules.exit.targetPerShare;
    push("exitTarget", perUnit === null ? "unknown" : perUnit >= target ? "pass" : "fail", true, `at least ${money(target)} / ${unitWord}`, priceText);
  }
  push("exitInvalidation", perUnit === null ? "unknown" : perUnit > rules.risk.invalidationPerShare ? "pass" : "fail", true, `above ${money(rules.risk.invalidationPerShare)} / ${unitWord}`, priceText);
  if (rules.exit.timeExitAt !== null) {
    const due = Date.parse(rules.exit.timeExitAt);
    push("exitTime", !Number.isFinite(due) ? "unknown" : atMs <= due ? "pass" : "fail", false, `by ${rules.exit.timeExitAt}`, new Date(atMs).toISOString());
  }

  const judged = checks.filter((check) => check.outcome !== "unknown");
  const verdict: PlanExitAdherence["verdict"] = judged.length === 0 ? "unknown" : checks.some((check) => check.required && check.outcome === "fail") ? "deviated" : "followed";
  return { ruledByVersion: ruling.version, checks, verdict, notBackdated };
}

/** Where the difference between the planned price and the paid one came from, in parts that are not added together. */
function costsFor(input: Readonly<{ planned: number | null; review: PlanReview | null; filled: number | null; units: number | null; fee: number | null }>): PlanCosts {
  const { planned, review, filled, units, fee } = input;
  const quoted = review?.quote.perShareUsd ?? null;
  const marketMove =
    planned === null || quoted === null
      ? unestablished(planned === null ? "no-planned-price" : "no-review")
      : part(units !== null ? (quoted - planned) * units : null, planned > 0 ? ((quoted - planned) / planned) * 100 : null, "known");
  const execution =
    quoted === null || filled === null
      ? unestablished(quoted === null ? "no-review" : "no-fill-price")
      : part(units !== null ? (filled - quoted) * units : null, quoted > 0 ? ((filled - quoted) / quoted) * 100 : null, "known");
  /* A fee is known only where the settled row measured one — the quoted fee under `expected` is never charged as paid. */
  const feePart = fee === null ? unestablished("fee-not-recorded") : part(fee, quoted !== null && quoted > 0 && units !== null && units > 0 ? (fee / (quoted * units)) * 100 : null, "known");
  return {
    plannedPerUnitUsd: planned,
    quotedPerUnitUsd: quoted,
    filledPerUnitUsd: filled,
    marketMove,
    execution,
    fee: feePart,
    expected: {
      feeBps: review?.quote.feeBps ?? null,
      slippageBps: review?.quote.slippageBps ?? null,
      priceImpactPct: review?.quote.priceImpactPct ?? null,
      quotedUsd: review?.quote.usd ?? null,
      referencePerUnitUsd: review?.quote.referencePerShareUsd ?? null,
    },
  };
}

/**
 * The result for one execution the plan holds. `row` is the History row for
 * the same signature, or null when History has none readable — the actual
 * column is then the outcome the plan recorded and nothing more.
 *
 * `matchedBy` says how the operation came to be here: `binding` when the
 * person declared it under the plan before signing, `asset` when the product
 * paired a settled sell of this plan's mint to it. A matched operation is a
 * projection and nothing about it is written onto the plan.
 */
export function planResultFor(record: TradingPlanRecord, execution: StoredPlanExecution, row: SolanaWalletAction | null, nowMs: number = Date.now(), matchedBy: PlanResult["actual"]["matchedBy"] = "binding"): PlanResult {
  const version = record.history.find((entry) => entry.version === execution.version) ?? record.history[record.history.length - 1];
  const { rules, sizing } = version;
  /* The Review as it stood before the signature — its judged evidence figures redacted once the rights map's retention window has passed; the verdict stays. */
  const review: PlanReview | null = execution.review ? redactExpiredEvidence(execution.review, nowMs) : null;
  const decimals = record.asset.decimals;
  const multiplier = review?.quote.multiplier ?? null;
  const unitWord = planUnitBasis(record.asset);

  const outcome = row ? outcomeOfRow(row) : execution.outcome;
  /* The side off the signed bundle's origin: the execution ref carries it since 1.9.0, the History row since Spot existed. Never read backwards off the legs. */
  const side = execution.side ?? row?.origin?.side ?? null;
  const leg: PlanResult["actual"]["leg"] = side === "BUY" ? "entry" : side === "SELL" ? "exit" : null;

  /* An entry spends dollars on `out` and receives units on `in`; an exit does the opposite. A side nothing established values neither. */
  const spent = leg === "entry" && row ? usdOf(row.out) : null;
  const proceeds = leg === "exit" && row ? usdOf(row.in) : null;
  const unitsInText = leg === "entry" && row ? unitsOf(row.in, record.asset.mint, decimals, multiplier) : null;
  const unitsOutText = leg === "exit" && row ? unitsOf(row.out, record.asset.mint, decimals, multiplier) : null;
  const amountText = unitsInText ?? unitsOutText;
  /* A stock's units are countable only through a known multiplier; a crypto or meme token has none and its own decimals are the unit (1.7.0). */
  const units = amountText !== null && (multiplier !== null || isTokenPlanAsset(record.asset)) ? Number(amountText) : null;
  const usd = leg === "exit" ? proceeds : spent;
  const perShare = usd !== null && units !== null && units > 0 && usd > 0 ? usd / units : null;
  const modelledLoss = leg === "entry" && units !== null && units > 0 && perShare !== null ? modelledLossUsd(units, perShare, rules) : null;
  const valueBasis: PlanResult["actual"]["valueBasis"] = usd !== null ? "PAR" : null;
  const fee = feeOf(row?.fee ?? null);

  /* The entry's money checks are re-judged on the fill. They do not speak of an exit, so an exit carries none and `exit.verdict` is the verdict that does. */
  const settledEntry = leg === "entry" && outcome === "DONE" && usd !== null && perShare !== null;
  const checks: PlanCheck[] = settledEntry ? moneyChecks({ rules, sizing, usdAmount: usd, units, perShare, symbol: record.asset.underlying.symbol, unitWord }) : [];
  const verdict: PlanResult["verdict"] = !settledEntry ? "unknown" : checks.some((check) => check.required && check.outcome !== "pass") ? "deviated" : "followed";

  const settledAt = row?.updatedAt ?? execution.recordedAt;
  const exit = leg === "exit" && outcome === "DONE" ? exitAdherenceFor(record, perShare, Date.parse(settledAt), unitWord) : null;

  return {
    planId: record.id,
    version: execution.version,
    asset: record.asset,
    plan: {
      entryPerShareUsd: rules.entry.pricePerShare,
      maxPricePerShareUsd: rules.entry.maxPricePerShare,
      budgetUsd: rules.capital.budgetUsd,
      spendableUsd: Math.max(0, rules.capital.budgetUsd - rules.capital.reserveForCostsUsd),
      plannedRiskUsd: rules.risk.plannedRiskUsd,
      invalidationPerShareUsd: rules.risk.invalidationPerShare,
      costBufferBps: rules.risk.costBufferBps,
      sizedUnits: sizing.units,
      sizedNotionalUsd: sizing.notionalUsd,
    },
    beforeSigning: review,
    actual: {
      signature: execution.signature,
      outcome,
      settledAt,
      usd: spent,
      amount: unitsInText,
      unit: multiplier === null ? "token" : "underlying",
      perShareUsd: perShare,
      modelledLossUsd: modelledLoss,
      feeUsd: fee.usd,
      receiptHash: row?.receiptHash ?? null,
      side,
      leg,
      proceedsUsd: proceeds,
      unitsOut: unitsOutText,
      valueBasis,
      feeBasis: fee.basis,
      matchedBy,
    },
    checks,
    verdict,
    /* An exit's planned price is the plan's own target, not its entry price. */
    costs: costsFor({ planned: leg === "exit" ? rules.exit.targetPerShare : rules.entry.pricePerShare, review, filled: perShare, units, fee: fee.usd }),
    exit,
  };
}

/** The plan's three words for a History row's outcome. */
export function outcomeOfRow(row: Pick<SolanaWalletAction, "outcome">): PlanResult["actual"]["outcome"] {
  if (row.outcome === "DONE") return "DONE";
  if (row.outcome === "FAILED") return "FAILED";
  return "UNKNOWN";
}

/**
 * The exits a plan's position had, paired from History rather than declared.
 *
 * A plan binds an order before the signature, and the Review that judges it
 * only passes a buy — so today an exit is made on Spot like any other sale
 * and arrives with no plan on it. Rather than leave every position reading
 * *open* forever, a settled **sell of this plan's exact mint** by this
 * wallet, made after the plan's own entry and declared under no plan at all,
 * is paired to the plan and marked `matchedBy: "asset"`, so a surface can
 * say it was matched rather than chosen.
 *
 * `competing` is how many of the wallet's other plans name the same mint.
 * With any, nothing is paired: two plans on one mint make the association a
 * guess, and a guess about which plan a sale belongs to is exactly the thing
 * this product does not do.
 */
export function matchedExitRows(record: TradingPlanRecord, rows: readonly SolanaWalletAction[], competing: number): readonly SolanaWalletAction[] {
  if (competing > 0) return [];
  const declared = new Set(record.executions.map((execution) => execution.signature));
  const entries = record.executions.filter((execution) => execution.outcome === "DONE" && execution.side !== "SELL");
  if (entries.length === 0) return [];
  /* The entry's own settled time, off its History row — `recordedAt` is when the plan wrote it down, which can be long after the chain settled it. */
  const firstEntryMs = entries.reduce((earliest, execution) => {
    const row = rows.find((candidate) => candidate.signature === execution.signature);
    return Math.min(earliest, Date.parse(row?.updatedAt ?? execution.recordedAt));
  }, Number.POSITIVE_INFINITY);
  return rows.filter(
    (row) =>
      row.signature !== null &&
      !declared.has(row.signature) &&
      row.outcome === "DONE" &&
      row.origin?.side === "SELL" &&
      row.origin.plan === undefined &&
      row.out?.mint === record.asset.mint &&
      Date.parse(row.updatedAt) >= firstEntryMs,
  );
}

/** A matched exit row as a result: the version in force when it settled, no Review (there was none), and the pairing said plainly. */
export function matchedExitResult(record: TradingPlanRecord, row: SolanaWalletAction, nowMs: number = Date.now()): PlanResult {
  const at = Date.parse(row.updatedAt);
  const version = versionInForceAt(record, at) ?? record.history[record.history.length - 1];
  const execution: StoredPlanExecution = {
    signature: row.signature as string,
    version: version.version,
    reviewedAt: row.startedAt,
    recordedAt: row.updatedAt,
    outcome: "DONE",
    reviewId: null,
    side: "SELL",
    review: null,
  };
  return planResultFor(record, execution, row, nowMs, "asset");
}
