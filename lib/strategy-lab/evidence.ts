import type { EvidenceReport, NormalizedTrade, StrategyCostModel } from "./types.ts";

// Mirrors the strict EvidenceBundleSchema money envelope and caps per-leg exposure before proof creation.
const MAX_EVIDENCE_MONEY_ABS = 1_000_000_000_000_000;
const MAX_TRADE_NOTIONAL = 1_000_000_000_000_000;
const MAX_EVIDENCE_RATIO_ABS = 1_000_000_000;

export type EvidenceInput = {
  trades: NormalizedTrade[];
  initialCapital: number;
  maxAllowedClosedTradeDrawdownPercent?: number;
  benchmarkReturnPercent: number | null;
  protocol: {
    oos: "none" | "self-attested" | "blind";
    costsIncluded: boolean;
    regimesCovered: number;
    parameterSensitivity: "not-tested" | "fragile" | "stable";
    forwardEvidence: boolean;
  };
  leakage: {
    repaintRisk: "none" | "low" | "medium" | "high" | "unknown";
    usesSyntheticPrices: boolean;
    usesLookahead: boolean;
    usesIntrabarAssumptions: boolean;
  };
  reproducible: boolean;
  executionRealism: "low" | "medium" | "high";
};

function round(value: number, places = 4): number {
  if (!Number.isFinite(value)) throw new TypeError("Derived evidence value must be finite.");
  const factor = 10 ** places;
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) throw new TypeError("Derived evidence value overflowed.");
  const rounded = Math.round(scaled) / factor;
  if (!Number.isFinite(rounded)) throw new TypeError("Derived evidence value overflowed.");
  return rounded;
}

function finiteDerived(value: number, message: string): number {
  if (!Number.isFinite(value)) throw new TypeError(message);
  return value;
}

function boundedDerived(value: number, maximumAbsolute: number, message: string): number {
  const finite = finiteDerived(value, message);
  if (Math.abs(finite) > maximumAbsolute) throw new TypeError(message);
  return finite;
}

export function applyCostModel(trades: NormalizedTrade[], model: StrategyCostModel): NormalizedTrade[] {
  const rates = Object.values(model);
  if (rates.some((value) => !Number.isFinite(value) || value < 0 || value > 10_000)) {
    throw new TypeError("Cost model values must be finite basis points between 0 and 10000.");
  }
  const executionBps = finiteDerived(
    model.commissionBps + model.spreadBps + model.slippageBps,
    "Combined execution costs overflowed.",
  );
  return trades.map((trade) => {
    if (![trade.entryAt, trade.exitAt, trade.entryPrice, trade.exitPrice, trade.quantity, trade.grossPnl].every(Number.isFinite)
      || trade.entryPrice <= 0 || trade.exitPrice <= 0 || trade.quantity <= 0 || trade.exitAt < trade.entryAt) {
      throw new TypeError("Trade contains invalid values.");
    }
    boundedDerived(trade.grossPnl, MAX_EVIDENCE_MONEY_ABS, "Gross PnL exceeds the evidence money bound.");
    const entryNotional = boundedDerived(
      Math.abs(trade.entryPrice * trade.quantity),
      MAX_TRADE_NOTIONAL,
      "Entry notional exceeds the supported bound.",
    );
    const exitNotional = boundedDerived(
      Math.abs(trade.exitPrice * trade.quantity),
      MAX_TRADE_NOTIONAL,
      "Exit notional exceeds the supported bound.",
    );
    const durationMs = finiteDerived(trade.exitAt - trade.entryAt, "Trade duration overflowed.");
    const durationDays = finiteDerived(Math.max(0, durationMs) / 86_400_000, "Trade duration overflowed.");
    const combinedNotional = finiteDerived(entryNotional + exitNotional, "Combined notional overflowed.");
    const executionCosts = boundedDerived(
      (combinedNotional * executionBps) / 10_000,
      MAX_EVIDENCE_MONEY_ABS,
      "Execution costs exceed the evidence money bound.",
    );
    const fundingCosts = boundedDerived(
      (entryNotional * model.fundingBpsPerDay * durationDays) / 10_000,
      MAX_EVIDENCE_MONEY_ABS,
      "Funding costs exceed the evidence money bound.",
    );
    const fees = round(boundedDerived(
      executionCosts + fundingCosts,
      MAX_EVIDENCE_MONEY_ABS,
      "Total costs exceed the evidence money bound.",
    ));
    const netPnl = round(boundedDerived(
      trade.grossPnl - fees,
      MAX_EVIDENCE_MONEY_ABS,
      "Net PnL exceeds the evidence money bound.",
    ));
    return { ...trade, fees, netPnl };
  });
}

function metrics(
  trades: NormalizedTrade[],
  initialCapital: number,
  benchmarkReturnPercent: number | null,
): { report: EvidenceReport["metrics"]; closedTradeMaxDrawdownPercent: number } {
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw new TypeError("Initial capital must be a positive finite value.");
  }
  if (benchmarkReturnPercent !== null
    && (!Number.isFinite(benchmarkReturnPercent) || benchmarkReturnPercent < -100 || benchmarkReturnPercent > 100_000)) {
    throw new TypeError("Benchmark return is outside the evidence schema bound.");
  }
  let equity = initialCapital;
  let peak = initialCapital;
  let closedTradeMaxDrawdownPercent = 0;
  let wins = 0;
  let positive = 0;
  let negative = 0;
  for (const trade of trades) {
    boundedDerived(trade.netPnl, MAX_EVIDENCE_MONEY_ABS, "Trade net PnL exceeds the evidence money bound.");
    equity = finiteDerived(equity + trade.netPnl, "Closed-trade equity overflowed.");
    peak = Math.max(peak, equity);
    if (peak > 0) {
      const drawdown = finiteDerived(((peak - equity) / peak) * 100, "Closed-trade drawdown overflowed.");
      closedTradeMaxDrawdownPercent = Math.min(100, Math.max(closedTradeMaxDrawdownPercent, drawdown));
    }
    if (trade.netPnl > 0) {
      wins += 1;
      positive = boundedDerived(
        positive + trade.netPnl,
        MAX_EVIDENCE_MONEY_ABS,
        "Positive PnL sum exceeds the evidence money bound.",
      );
    }
    if (trade.netPnl < 0) {
      negative = boundedDerived(
        negative + Math.abs(trade.netPnl),
        MAX_EVIDENCE_MONEY_ABS,
        "Negative PnL sum exceeds the evidence money bound.",
      );
    }
  }
  const netPnl = boundedDerived(
    equity - initialCapital,
    MAX_EVIDENCE_MONEY_ABS,
    "Net PnL exceeds the evidence money bound.",
  );
  const profitFactor = negative > 0
    ? round(boundedDerived(positive / negative, MAX_EVIDENCE_RATIO_ABS, "Profit factor exceeds the evidence schema bound."))
    : positive > 0
      ? null
      : 0;
  const report: EvidenceReport["metrics"] = {
    trades: trades.length,
    netPnl: round(netPnl),
    totalReturnPercent: round(boundedDerived(
      (netPnl / initialCapital) * 100,
      MAX_EVIDENCE_RATIO_ABS,
      "Total return exceeds the evidence schema bound.",
    )),
    benchmarkReturnPercent: benchmarkReturnPercent === null ? null : round(benchmarkReturnPercent),
    winRatePercent: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    maxDrawdownPercent: round(closedTradeMaxDrawdownPercent, 2),
    expectancy: trades.length
      ? round(boundedDerived(
        netPnl / trades.length,
        MAX_EVIDENCE_MONEY_ABS,
        "Expectancy exceeds the evidence money bound.",
      ))
      : 0,
    profitFactor,
  };
  return { report, closedTradeMaxDrawdownPercent };
}

export function evaluateEvidence(input: EvidenceInput): EvidenceReport {
  const criticalLeakage = input.leakage.repaintRisk === "unknown" || input.leakage.repaintRisk === "high" || input.leakage.usesLookahead || input.leakage.usesSyntheticPrices;
  const calculatedMetrics = metrics(input.trades, input.initialCapital, input.benchmarkReturnPercent);
  const drawdownBudget = input.maxAllowedClosedTradeDrawdownPercent;
  const validDrawdownBudget = typeof drawdownBudget === "number"
    && Number.isFinite(drawdownBudget)
    && drawdownBudget >= 1
    && drawdownBudget <= 50;
  const drawdownBudgetBreached = validDrawdownBudget
    && calculatedMetrics.closedTradeMaxDrawdownPercent > drawdownBudget;
  const warnings: string[] = ["intratrade-drawdown-unavailable"];
  if (!validDrawdownBudget) warnings.push("closed-trade-drawdown-budget-missing-or-invalid");
  if (drawdownBudgetBreached) warnings.push("closed-trade-drawdown-exceeds-risk-budget");
  if (!input.trades.length) warnings.push("trade-sample-empty");
  if (input.benchmarkReturnPercent === null) warnings.push("benchmark-missing");
  if (!input.protocol.costsIncluded) warnings.push("costs-missing");
  if (input.protocol.oos === "none") warnings.push("oos-missing");
  if (input.protocol.oos === "self-attested") warnings.push("oos-self-attested");
  if (!input.protocol.forwardEvidence) warnings.push("forward-evidence-missing");
  if (input.protocol.parameterSensitivity === "not-tested") warnings.push("parameter-sensitivity-missing");
  if (criticalLeakage) warnings.push("leakage-risk-blocking");
  if (input.leakage.usesIntrabarAssumptions) warnings.push("intrabar-assumptions");

  const dimensions = {
    dataCompleteness: input.trades.length ? (input.benchmarkReturnPercent === null ? 6 : 10) : 0,
    sampleSize: input.trades.length >= 100 ? 12 : input.trades.length >= 50 ? 8 : input.trades.length >= 20 ? 4 : 0,
    costs: input.protocol.costsIncluded ? 12 : 0,
    oos: input.protocol.oos === "blind" ? 12 : input.protocol.oos === "self-attested" ? 7 : 0,
    regimes: input.protocol.regimesCovered >= 4 ? 10 : input.protocol.regimesCovered >= 2 ? 6 : 0,
    leakage: criticalLeakage ? 0 : input.leakage.repaintRisk === "none" ? 14 : input.leakage.repaintRisk === "low" ? 11 : 5,
    parameterSensitivity: input.protocol.parameterSensitivity === "stable" ? 10 : input.protocol.parameterSensitivity === "fragile" ? 2 : 0,
    forwardEvidence: input.protocol.forwardEvidence ? 10 : 0,
    reproducibility: input.reproducible ? 5 : 0,
    executionRealism: input.executionRealism === "high" ? 5 : input.executionRealism === "medium" ? 3 : 0,
  };
  const score = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  const quality: EvidenceReport["quality"] = criticalLeakage || !input.trades.length
    ? "incomplete"
    : score >= 80 && input.protocol.forwardEvidence && input.protocol.oos === "blind"
      ? "strong"
      : score >= 55
        ? "moderate"
        : score >= 30
          ? "basic"
          : "incomplete";
  const verdict: EvidenceReport["verdict"] = criticalLeakage || !input.trades.length || !validDrawdownBudget || drawdownBudgetBreached
    ? "blocked"
    : score < 45
      ? "weak-evidence"
      : score >= 75 && input.protocol.forwardEvidence
        ? "sufficient-for-paper-forward"
        : "mixed-evidence";
  return { quality, verdict, score, metrics: calculatedMetrics.report, dimensions, warnings };
}
