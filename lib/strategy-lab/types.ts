export type StrategyAssetClass = "crypto" | "tokenized-equity" | "forex" | "index";
export type IndicatorKind = "rsi" | "ema" | "sma" | "atr";
export type PriceSource = "open" | "high" | "low" | "close" | "hl2";

export type StrategyIndicator = {
  id: string;
  kind: IndicatorKind;
  source: PriceSource;
  length: number;
};

export type RuleValue =
  | { kind: "number"; value: number }
  | { kind: "price"; source: PriceSource }
  | { kind: "indicator"; id: string };

export type CompareOperator = "above" | "below" | "crosses_above" | "crosses_below";
export type RuleNode =
  | { kind: "compare"; left: RuleValue; operator: CompareOperator; right: RuleValue }
  | { kind: "all"; rules: RuleNode[] }
  | { kind: "any"; rules: RuleNode[] };

export type StrategyCostModel = { commissionBps: number; spreadBps: number; slippageBps: number; fundingBpsPerDay: number };

export type StrategySpec = {
  schemaVersion: 1;
  name: string;
  universe: { provider: "tradingview"; symbol: string; assetClass: StrategyAssetClass };
  timeframe: string;
  thesis: string;
  indicators: StrategyIndicator[];
  entry: RuleNode;
  exit: RuleNode;
  stop: { kind: "percent"; value: number };
  sizing: { kind: "risk_percent"; value: number };
  filters: RuleNode[];
  riskPolicy: { maxDrawdownPercent: number; maxOpenPositions: number; allowShort: boolean };
  costModel: StrategyCostModel;
  assumptions: string[];
};

export type ValidationIssue = {
  code:
    | "invalid-spec"
    | "unsupported-indicator"
    | "unknown-indicator"
    | "unsupported-rule"
    | "risk-out-of-range"
    | "unsupported-short";
  path: string;
  message: string;
};

export type NormalizedTrade = {
  id: string;
  side: "long" | "short";
  entryAt: number;
  exitAt: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
};

export type ExperimentWindow = {
  start: string;
  end: string;
};

export type BacktestImportManifest = {
  schemaVersion: 1;
  provider: "tradingview";
  strategyVersionId: string;
  compilerVersion: string;
  pineHash: string;
  symbol: string;
  timeframe: string;
  timezone: "UTC";
  compileWindow: ExperimentWindow;
  initialCapital: number;
  exportedAt: string;
  tradesFileHash?: string;
  metricsFileHash?: string;
};

export type EvidenceQuality = "incomplete" | "basic" | "moderate" | "strong";
export type EvidenceVerdict = "blocked" | "weak-evidence" | "mixed-evidence" | "sufficient-for-paper-forward";

export type EvidenceReport = {
  quality: EvidenceQuality;
  verdict: EvidenceVerdict;
  score: number;
  metrics: {
    trades: number;
    netPnl: number;
    totalReturnPercent: number;
    benchmarkReturnPercent: number | null;
    winRatePercent: number;
    /** Closed-trade equity-curve drawdown only; intratrade excursion is unavailable. */
    maxDrawdownPercent: number;
    expectancy: number;
    profitFactor: number | null;
  };
  dimensions: Record<
    "dataCompleteness" | "sampleSize" | "costs" | "oos" | "regimes" | "leakage" | "parameterSensitivity" | "forwardEvidence" | "reproducibility" | "executionRealism",
    number
  >;
  warnings: string[];
};
