"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "@/app/app/account/account-context";
import { INTENT_EVENT, rememberIntent, type PendingIntent } from "@/lib/account/intent.client";
import {
  Brain,
  CheckCircle,
  Copy,
  DownloadSimple,
  FileCode,
  Flask,
  Plus,
  ShieldCheck,
  Sparkle,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { localeDir, type LocaleCode } from "@/app/i18n/locales";
import { useShell } from "@/app/shell/shell-state";
import { resolveDepth } from "@/app/shell/layout-store";
import { applyReviewChanges, type AIReviewProposal } from "@/lib/strategy-lab/ai-schemas";
import type { StrategyApprovalArtifact } from "@/lib/strategy-lab/approval";
import { changedStrategySpecTopLevelFields } from "@/lib/strategy-lab/lineage";
import type {
  EvidenceReport,
  NormalizedTrade,
  RuleNode,
  RuleValue,
  StrategySpec,
} from "@/lib/strategy-lab/types";
import { getLabApiError, getLabCopy } from "./copy";

type Brief = {
  assetClass: StrategySpec['universe']['assetClass'];
  symbol: string;
  timeframe: string;
  thesis: string;
  entryIdea: string;
  exitIdea: string;
  stopPercent: number;
  riskPercent: number;
  maxDrawdownPercent: number;
  costModel: StrategySpec['costModel'];
};

type CompileResult = {
  code: string;
  compilerVersion: string;
  pineHash: string;
  warnings: string[];
};

type PersistenceStatus = "disabled" | "stored";

type PersistedVersion = {
  strategyId: string;
  versionId: string;
  versionNumber: number;
};

type EvidenceIdentity = {
  experimentId: string | null;
  evidenceReportId: string | null;
  evidenceHash: string;
};

type PersistedRun = {
  experimentId: string;
  importId: string;
  evidenceReportId: string;
  evidenceHash: string;
  replay: boolean;
  iterationNumber: number;
};

type PersistedProposal = {
  proposalId: string;
  replay: boolean;
};

type ExperimentLineage = {
  parentRunId: string | null;
  hypothesis: string;
  changedFields: string[];
  userAttestedTestWindowSeenBeforeChange: boolean;
  iterationNumber: number;
};

type ApprovalResult = {
  approval?: StrategyApprovalArtifact;
  persistence?: PersistenceStatus;
  persistedVersion?: PersistedVersion | null;
  replay?: boolean;
  error?: unknown;
  issues?: unknown;
};

type ImportResult = {
  manifest: Record<string, unknown>;
  providerMetrics: Record<string, number>;
  rawFilesStored: false;
  evidence: EvidenceReport;
  evidenceProof: string | null;
  tradeCount: number;
  tradesPreview: NormalizedTrade[];
  persistence: PersistenceStatus;
  persistedRun: PersistedRun | null;
  evidenceIdentity: EvidenceIdentity;
};

type ReviewResult = {
  proposal?: AIReviewProposal;
  persistence?: PersistenceStatus;
  persistedProposal?: PersistedProposal | null;
  error?: unknown;
  issues?: unknown;
};

type ProposalNotes = {
  assumptionsAdded: string[];
  unsupported: string[];
  clarificationQuestions: string[];
};

type AiRequestAttempt = {
  payloadJson: string;
  requestId: string;
};

function rootExperimentLineage(): ExperimentLineage {
  return {
    parentRunId: null,
    hypothesis: "",
    changedFields: [],
    userAttestedTestWindowSeenBeforeChange: false,
    iterationNumber: 1,
  };
}

const INITIAL_BRIEF: Brief = {
  assetClass: 'crypto',
  symbol: "BYBIT:BTCUSDT",
  timeframe: "4h",
  thesis: "Test whether confirmed RSI recovery works only above a long-term trend filter.",
  entryIdea: "RSI crosses above 30 while the close remains above EMA 200.",
  exitIdea: "Exit when RSI rises above 55 or the protective stop is reached.",
  stopPercent: 2.5,
  riskPercent: 1,
  maxDrawdownPercent: 12,
  costModel: { commissionBps: 10, spreadBps: 5, slippageBps: 8, fundingBpsPerDay: 0 },
};

function safeTemplate(brief: Brief): StrategySpec {
  const symbol = brief.symbol.trim().toUpperCase().replace(/[^A-Z0-9._:-]/g, "").slice(0, 64) || "BYBIT:BTCUSDT";
  const universe: StrategySpec['universe'] = {
    provider: 'tradingview',
    symbol,
    assetClass: brief.assetClass,
  };
  const thesis = brief.thesis.trim().length >= 10
    ? brief.thesis.trim().slice(0, 500)
    : "Test a confirmed RSI recovery above a long-term trend filter.";
  const template: StrategySpec = {
    schemaVersion: 1,
    name: `${symbol.split(":").at(-1) ?? symbol} RSI recovery`.slice(0, 80),
    universe,
    timeframe: /^(?:[1-9]\d*[mhdw]|[1-9]\d*)$/i.test(brief.timeframe) ? brief.timeframe : "4h",
    thesis,
    indicators: [
      { id: "rsi-main", kind: "rsi", source: "close", length: 14 },
      { id: "ema-filter", kind: "ema", source: "close", length: 200 },
    ],
    entry: {
      kind: "all",
      rules: [
        { kind: "compare", left: { kind: "indicator", id: "rsi-main" }, operator: "crosses_above", right: { kind: "number", value: 30 } },
        { kind: "compare", left: { kind: "price", source: "close" }, operator: "above", right: { kind: "indicator", id: "ema-filter" } },
      ],
    },
    exit: {
      kind: "any",
      rules: [
        { kind: "compare", left: { kind: "indicator", id: "rsi-main" }, operator: "above", right: { kind: "number", value: 55 } },
      ],
    },
    stop: { kind: "percent", value: Math.min(25, Math.max(0.1, Number(brief.stopPercent) || 2.5)) },
    sizing: { kind: "risk_percent", value: Math.min(5, Math.max(0.05, Number(brief.riskPercent) || 1)) },
    filters: [],
    riskPolicy: { maxDrawdownPercent: Math.min(50, Math.max(1, Number(brief.maxDrawdownPercent) || 12)), maxOpenPositions: 1, allowShort: false },
    costModel: structuredClone(brief.costModel),
    assumptions: [
      "Signals execute only after a confirmed bar close.",
      "TradingView broker-emulator fills are simulations.",
      "Costs are applied deterministically after import.",
    ],
  };
  return template;
}

function directRules(node: RuleNode): Extract<RuleNode, { kind: "compare" }>[] | null {
  if (node.kind === "compare") return [node];
  return node.rules.every((rule) => rule.kind === "compare")
    ? node.rules as Extract<RuleNode, { kind: "compare" }>[]
    : null;
}

function withDirectRules(
  node: RuleNode,
  rules: Extract<RuleNode, { kind: "compare" }>[],
): RuleNode {
  if (node.kind === "compare" && rules.length === 1) return rules[0];
  return { kind: node.kind === "any" ? "any" : "all", rules };
}

function encodedValue(value: RuleValue): string {
  if (value.kind === "number") return "number";
  if (value.kind === "price") return `price:${value.source}`;
  return `indicator:${value.id}`;
}

function decodedValue(value: string): RuleValue {
  if (value === "number") return { kind: "number", value: 0 };
  if (value.startsWith("indicator:")) return { kind: "indicator", id: value.slice(10) };
  return { kind: "price", source: value.slice(6) as "open" | "high" | "low" | "close" | "hl2" };
}

function humanize(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toneForVerdict(value: EvidenceReport["verdict"]): "bad" | "warn" | "good" {
  if (value === "blocked" || value === "weak-evidence") return "bad";
  if (value === "sufficient-for-paper-forward") return "good";
  return "warn";
}

const EVIDENCE_DIMENSION_MAX: Record<keyof EvidenceReport['dimensions'], number> = {
  dataCompleteness: 10,
  sampleSize: 12,
  costs: 12,
  oos: 12,
  regimes: 10,
  leakage: 14,
  parameterSensitivity: 10,
  forwardEvidence: 10,
  reproducibility: 5,
  executionRealism: 5,
};

function formatPreviewCount(template: string, chartShown: number, tableShown: number, total: number): string {
  return template
    .replace('{chartShown}', String(chartShown))
    .replace('{tableShown}', String(tableShown))
    .replaceAll('{total}', String(total));
}
function describeRuleTree(node: RuleNode): string {
  if (node.kind === 'compare') {
    const describe = (value: RuleValue) => value.kind === 'number'
      ? String(value.value)
      : value.kind === 'indicator'
        ? value.id
        : value.source;
    return `${describe(node.left)} ${node.operator.replace('_', ' ')} ${describe(node.right)}`;
  }
  return `${node.kind.toUpperCase()} (${node.rules.map(describeRuleTree).join('; ')})`;
}

type ReviewChange = AIReviewProposal["nextHypothesis"]["changes"][number];

function reviewChangeTarget(change: ReviewChange): string {
  if (change.kind === "indicator-length") return `indicators.${change.indicatorId}.length`;
  if (change.kind === "entry-number" || change.kind === "exit-number") {
    const section = change.kind === "entry-number" ? "entry" : "exit";
    return `${section}.rules.${change.ruleIndex}.${change.side}.value`;
  }
  if (change.kind === "stop-percent") return "stop.value";
  if (change.kind === "risk-percent") return "sizing.value";
  if (change.kind === "max-drawdown-percent") return "riskPolicy.maxDrawdownPercent";
  return `costModel.${change.field}`;
}

function currentReviewValue(strategy: StrategySpec, change: ReviewChange): number | string {
  if (change.kind === "indicator-length") {
    return strategy.indicators.find((indicator) => indicator.id === change.indicatorId)?.length ?? "unsupported";
  }
  if (change.kind === "entry-number" || change.kind === "exit-number") {
    const root = change.kind === "entry-number" ? strategy.entry : strategy.exit;
    const value = directRules(root)?.[change.ruleIndex]?.[change.side];
    return value?.kind === "number" ? value.value : "unsupported";
  }
  if (change.kind === "stop-percent") return strategy.stop.value;
  if (change.kind === "risk-percent") return strategy.sizing.value;
  if (change.kind === "max-drawdown-percent") return strategy.riskPolicy.maxDrawdownPercent;
  return strategy.costModel[change.field];
}

function EquityChart({ trades, label, emptyLabel }: { trades: NormalizedTrade[]; label: string; emptyLabel: string }) {
  const points = useMemo(() => {
    let equity = 0;
    const values = [0, ...trades.map((trade) => (equity += trade.netPnl))];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    return values.map((value, index) => ({
      x: values.length === 1 ? 0 : (index / (values.length - 1)) * 100,
      y: 88 - ((value - min) / span) * 72,
    }));
  }, [trades]);
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  return (
    <div className="sl-chart" aria-label={label}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
        <title>{label}</title>
        <line x1="0" y1="88" x2="100" y2="88" />
        {trades.length ? <path d={path} /> : null}
      </svg>
      {!trades.length ? <span>{emptyLabel}</span> : null}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sl-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
type CompareRule = Extract<RuleNode, { kind: "compare" }>;

function RuleEditor({
  title,
  root,
  indicators,
  onChange,
  disabled = false,
}: {
  title: string;
  root: RuleNode;
  indicators: StrategySpec["indicators"];
  onChange: (next: RuleNode) => void;
  disabled?: boolean;
}) {
  const rules = directRules(root);
  if (!rules) return <p className="sl-empty">Nested rules are inspectable but require a future advanced editor.</p>;
  const valueOptions = [
    { value: "price:close", label: "Close" },
    { value: "price:open", label: "Open" },
    { value: "price:high", label: "High" },
    { value: "price:low", label: "Low" },
    ...indicators.map((indicator) => ({ value: `indicator:${indicator.id}`, label: indicator.id })),
    { value: "number", label: "Number" },
  ];
  const update = (index: number, next: CompareRule) => {
    const copy = rules.map((rule, i) => i === index ? next : rule);
    onChange(withDirectRules(root, copy));
  };
  const remove = (index: number) => {
    if (rules.length <= 1) return;
    onChange(withDirectRules(root, rules.filter((_, i) => i !== index)));
  };
  const add = () => {
    const fallback = indicators[0]?.id;
    const next: CompareRule = {
      kind: "compare",
      left: fallback ? { kind: "indicator", id: fallback } : { kind: "price", source: "close" },
      operator: "above",
      right: { kind: "number", value: 0 },
    };
    onChange(withDirectRules(root, [...rules, next]));
  };
  return (
    <div className="sl-rule-group">
      <div className="sl-subhead">
        <strong>{title}</strong>
        <div className="sl-inline">
          <select
            aria-label={`${title} logic`}
            value={root.kind === "any" ? "any" : "all"}
            disabled={disabled}
            onChange={(event) => onChange({ kind: event.target.value as "all" | "any", rules })}
          >
            <option value="all">ALL</option>
            <option value="any">ANY</option>
          </select>
          <button type="button" className="sl-icon-btn" onClick={add} disabled={disabled} title="Add rule" aria-label="Add rule">
            <Plus size={14} weight="bold" />
          </button>
        </div>
      </div>
      {rules.map((rule, index) => (
        <div className="sl-rule-row" key={index}>
          <div className={`sl-rule-operand sl-rule-left ${rule.left.kind === "number" ? "has-number" : ""}`}>
            <select
              aria-label={`${title} rule ${index + 1} left value`}
              value={encodedValue(rule.left)}
              disabled={disabled}
              onChange={(event) => update(index, { ...rule, left: decodedValue(event.target.value) })}
            >
              {valueOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {rule.left.kind === "number" ? (
              <input
                aria-label={`${title} rule ${index + 1} left number`}
                type="number"
                value={rule.left.value}
                disabled={disabled}
                onChange={(event) => update(index, { ...rule, left: { kind: "number", value: Number(event.target.value) } })}
              />
            ) : null}
          </div>
          <select
            className="sl-rule-operator"
            aria-label={`${title} rule ${index + 1} operator`}
            value={rule.operator}
            disabled={disabled}
            onChange={(event) => update(index, { ...rule, operator: event.target.value as CompareRule["operator"] })}
          >
            <option value="above">above</option>
            <option value="below">below</option>
            <option value="crosses_above">crosses above</option>
            <option value="crosses_below">crosses below</option>
          </select>
          <div className={`sl-rule-operand sl-rule-right ${rule.right.kind === "number" ? "has-number" : ""}`}>
            <select
              aria-label={`${title} rule ${index + 1} right value`}
              value={encodedValue(rule.right)}
              disabled={disabled}
              onChange={(event) => update(index, { ...rule, right: decodedValue(event.target.value) })}
            >
              {valueOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {rule.right.kind === "number" ? (
              <input
                aria-label={`${title} rule ${index + 1} right number`}
                type="number"
                value={rule.right.value}
                disabled={disabled}
                onChange={(event) => update(index, { ...rule, right: { kind: "number", value: Number(event.target.value) } })}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="sl-icon-btn danger"
            onClick={() => remove(index)}
            disabled={disabled || rules.length <= 1}
            title="Remove rule"
            aria-label="Remove rule"
          >
            <Trash size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function StrategyLabWorkspace({ initialLocale, paidAiAvailable }: { initialLocale: LocaleCode; paidAiAvailable: boolean }) {
  /* The locale is the workspace's, not this page's. The server resolves
     ?lang → ryntra_hub_locale cookie → bot language and passes it down; the
     shell's language toggle refreshes the route, so a page-local select here
     was a second language control with ten answers inside a two-language
     workspace — the exact drift lock 4 of RYN-WS-HOME-AC-001 forbids. */
  const locale = initialLocale;
  /* Depth is the shell's too: one Simple/Pro control, in the top bar, for the
     whole cabinet. The lab's editor previously kept a private guided/pro pair
     beside it — two controls, one vocabulary, free to disagree. */
  const { prefs, setMode: setWorkspaceMode } = useShell();
  const mode = resolveDepth(prefs.mode);
  const setMode = (next: "guided" | "pro") => setWorkspaceMode(next);
  const [brief, setBrief] = useState<Brief>(INITIAL_BRIEF);
  const [strategy, setStrategy] = useState<StrategySpec | null>(null);
  const pathname = usePathname();
  const { openLogin } = useAccount();
  /* A draft that met the login sheet comes back through the intent event
     after the round trip, on this path only, exactly once. */
  useEffect(() => {
    const onIntent = (event: Event) => {
      const intent = (event as CustomEvent<PendingIntent>).detail;
      if (!intent || intent.kind !== "save_plan" || !intent.draft || typeof intent.draft !== "object") return;
      const draft = intent.draft as { brief?: Brief; strategy?: StrategySpec | null };
      if (draft.brief) setBrief(draft.brief);
      if (draft.strategy) setStrategy(draft.strategy);
    };
    window.addEventListener(INTENT_EVENT, onIntent);
    return () => window.removeEventListener(INTENT_EVENT, onIntent);
  }, []);
  const askToSignIn = () => {
    rememberIntent({ kind: "save_plan", path: pathname, draft: { brief, strategy } });
    openLogin("save_plan");
  };
  const [notes, setNotes] = useState<ProposalNotes | null>(null);
  const [approval, setApproval] = useState<StrategyApprovalArtifact | null>(null);
  const [persistedVersion, setPersistedVersion] = useState<PersistedVersion | null>(null);
  const [experimentLineage, setExperimentLineage] = useState<ExperimentLineage>(() => rootExperimentLineage());
  const [humanApprovalConfirmed, setHumanApprovalConfirmed] = useState(false);
  const [proposalWarningsAcknowledged, setProposalWarningsAcknowledged] = useState(false);
  const [formalizePaidConfirmed, setFormalizePaidConfirmed] = useState(false);
  const [reviewPaidConfirmed, setReviewPaidConfirmed] = useState(false);
  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [tradesFile, setTradesFile] = useState<File | null>(null);
  const [performanceFile, setPerformanceFile] = useState<File | null>(null);
  const [initialCapital, setInitialCapital] = useState(10_000);
  const [oos, setOos] = useState<"none" | "self-attested">("none");
  const [syntheticPrices, setSyntheticPrices] = useState(false);
  const [run, setRun] = useState<ImportResult | null>(null);
  const [review, setReview] = useState<AIReviewProposal | null>(null);
  const [parentApproval, setParentApproval] = useState<StrategyApprovalArtifact | null>(null);
  const [windowStart, setWindowStart] = useState("2024-01-01");
  const [windowEnd, setWindowEnd] = useState("2025-12-31");
  const [busy, setBusy] = useState<"formalize" | "approve" | "compile" | "import" | "review" | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [retryAction, setRetryAction] = useState<"formalize" | "approve" | "compile" | "import" | "review" | null>(null);
  const [fileInputResetKey, setFileInputResetKey] = useState(0);
  const requestGenerationRef = useRef(0);
  const formalizeAttemptRef = useRef<AiRequestAttempt | null>(null);
  const approveAttemptRef = useRef<AiRequestAttempt | null>(null);
  const importAttemptRef = useRef<AiRequestAttempt | null>(null);
  const reviewAttemptRef = useRef<AiRequestAttempt | null>(null);

  const c = getLabCopy(locale);
  // The workspace root.dir = localeDir(locale) remains local to this preview.
  const approved = approval !== null;
  const immutableApprovedVersion = approved && persistedVersion !== null;
  const hasProposalWarnings = Boolean(notes?.unsupported.length || notes?.clarificationQuestions.length);
  const stage = !strategy
    ? 0
    : !humanApprovalConfirmed
      ? 1
      : !approval
        ? 2
        : !compiled
          ? 3
          : !run
            ? 4
            : review
              ? 6
              : 5;

  const invalidatePendingRequests = () => {
    requestGenerationRef.current += 1;
  };
  const captureRequestGeneration = () => requestGenerationRef.current;
  const isCurrentRequest = (generation: number) => requestGenerationRef.current === generation;
  const requestIdFor = (ref: { current: AiRequestAttempt | null }, payload: unknown) => {
    const payloadJson = JSON.stringify(payload);
    if (ref.current?.payloadJson === payloadJson) return ref.current.requestId;
    const next = { payloadJson, requestId: crypto.randomUUID() };
    ref.current = next;
    return next.requestId;
  };

  const clearAfterSpec = (nextLineage: ExperimentLineage = rootExperimentLineage()) => {
    invalidatePendingRequests();
    if (approval) setParentApproval(approval);
    setPersistedVersion(null);
    setExperimentLineage(nextLineage);
    approveAttemptRef.current = null;
    importAttemptRef.current = null;
    setApproval(null);
    setHumanApprovalConfirmed(false);
    setProposalWarningsAcknowledged(false);
    setCompiled(null);
    setTradesFile(null);
    setPerformanceFile(null);
    setFileInputResetKey((value) => value + 1);
    setRun(null);
    setReview(null);
    setReviewPaidConfirmed(false);
    setRetryAction(null);
    setFlash('');
    setError("");
  };

  const invalidateExperimentBinding = () => {
    invalidatePendingRequests();
    importAttemptRef.current = null;
    setFlash('');
    setCompiled(null);
    setTradesFile(null);
    setPerformanceFile(null);
    setFileInputResetKey((value) => value + 1);
    setRun(null);
    setReview(null);
    setReviewPaidConfirmed(false);
    setRetryAction(null);
    setError("");
  };

  const updateBrief = (next: Brief) => {
    invalidatePendingRequests();
    setBrief(next);
  };

  const changeApprovalConfirmation = (next: boolean) => {
    invalidatePendingRequests();
    setHumanApprovalConfirmed(next);
    if (!next && approval) {
      setParentApproval(approval);
      setExperimentLineage(rootExperimentLineage());
    }
    setPersistedVersion(null);
    approveAttemptRef.current = null;
    importAttemptRef.current = null;
    setApproval(null);
    setCompiled(null);
    setTradesFile(null);
    setPerformanceFile(null);
    setFileInputResetKey((value) => value + 1);
    setRun(null);
    setReview(null);
    setReviewPaidConfirmed(false);
    setRetryAction(null);
    setFlash('');
    setError('');
  };

  const changeEvidenceBinding = (update: () => void) => {
    invalidatePendingRequests();
    importAttemptRef.current = null;
    update();
    setRun(null);
    setReview(null);
    setReviewPaidConfirmed(false);
    setRetryAction(null);
    setFlash('');
    setError('');
  };

  const startDraft = (next: StrategySpec, proposalNotes: ProposalNotes | null, reason: string) => {
    if (immutableApprovedVersion) {
      setError(c.immutableApprovedVersionNotice);
      return;
    }
    if (approval) setParentApproval(approval);
    setStrategy(next);
    setNotes(proposalNotes);
    clearAfterSpec();
    setFlash(reason);
  };

  const mutateSpec = (mutator: (draft: StrategySpec) => void) => {
    if (!strategy) return;
    if (immutableApprovedVersion) {
      setError(c.immutableApprovedVersionNotice);
      return;
    }
    const next = structuredClone(strategy);
    mutator(next);
    const nextLineage = approval === null && experimentLineage.parentRunId !== null && parentApproval
      ? {
          ...experimentLineage,
          changedFields: changedStrategySpecTopLevelFields(parentApproval.spec, next),
        }
      : rootExperimentLineage();
    setStrategy(next);
    clearAfterSpec(nextLineage);
  };

  const setRecoverableError = (
    action: "formalize" | "approve" | "compile" | "import" | "review",
    message: string,
  ) => {
    setError(message);
    setRetryAction(action);
  };

  const formalize = async () => {
    if (!paidAiAvailable) {
      setError(c.aiUnavailable);
      return;
    }
    if (!formalizePaidConfirmed) {
      setError(c.confirmPaidAiRequired);
      return;
    }
    const requestGeneration = captureRequestGeneration();
    setBusy("formalize");
    setError("");
    setFlash("");
    setRetryAction(null);
    try {
      const payload = { locale, brief, confirmPaidAi: true as const };
      const requestId = requestIdFor(formalizeAttemptRef, payload);
      const response = await fetch("/api/strategy-lab/formalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
      });
      const data = await response.json() as {
        strategy?: StrategySpec;
        proposal?: ProposalNotes;
        error?: unknown;
        issues?: unknown;
      };
      if (!isCurrentRequest(requestGeneration)) return;
      if (response.status === 401 || response.status === 403) {
        askToSignIn();
        return;
      }
      if (!response.ok || !data.strategy) {
        setRecoverableError("formalize", getLabApiError(locale, { error: data.error, issues: data.issues }, c.aiUnavailable));
        return;
      }
      formalizeAttemptRef.current = null;
      setFormalizePaidConfirmed(false);
      setRetryAction(null);
      startDraft(data.strategy, data.proposal ?? null, "GPT proposal received; human review required");
    } catch {
      if (isCurrentRequest(requestGeneration)) setRecoverableError("formalize", c.networkError);
    } finally {
      setBusy(null);
    }
  };

  const useTemplate = () => {
    formalizeAttemptRef.current = null;
    setMode("pro");
    startDraft(safeTemplate(brief), {
      assumptionsAdded: ["Explicit Ryntra RSI template selected by the user."],
      unsupported: [],
      clarificationQuestions: [],
    }, c.manualTemplate);
  };

  const approveStrategy = async () => {
    if (!strategy || !humanApprovalConfirmed) {
      setError(c.needsApprovalConfirmation);
      return;
    }
    if (hasProposalWarnings && !proposalWarningsAcknowledged) {
      setError(c.needsProposalWarningAcknowledgement);
      return;
    }
    const requestGeneration = captureRequestGeneration();
    setBusy("approve");
    setError("");
    setFlash("");
    setRetryAction(null);
    try {
      const payload = {
        strategy,
        ...(parentApproval ? { parentApproval } : {}),
        confirmImmutableVersion: true as const,
        acknowledgeProposalWarnings: true as const,
      };
      const requestId = requestIdFor(approveAttemptRef, payload);
      const response = await fetch("/api/strategy-lab/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
      });
      const data = await response.json() as ApprovalResult;
      if (!isCurrentRequest(requestGeneration)) return;
      if (response.status === 401 || response.status === 403) {
        askToSignIn();
        return;
      }
      if (!response.ok || !data.approval) {
        setRecoverableError("approve", getLabApiError(locale, { error: data.error, issues: data.issues }, c.approvalUnavailable));
        return;
      }
      const storedVersion = data.persistence === "stored"
        && data.persistedVersion?.versionId === data.approval.versionId
        ? data.persistedVersion
        : null;
      const persistenceContractValid = typeof data.replay === "boolean"
        && ((data.persistence === "disabled" && data.persistedVersion === null)
          || (data.persistence === "stored" && storedVersion !== null));
      if (!persistenceContractValid) {
        setRecoverableError("approve", c.approvalUnavailable);
        return;
      }
      approveAttemptRef.current = null;
      setApproval(data.approval);
      setPersistedVersion(storedVersion);
      setStrategy(data.approval.spec);
      setRetryAction(null);
      setFlash(c.approved);
    } catch {
      if (isCurrentRequest(requestGeneration)) setRecoverableError("approve", c.networkError);
    } finally {
      setBusy(null);
    }
  };

  const compile = async () => {
    if (!approval) {
      setError(c.needsApproval);
      return;
    }
    const requestGeneration = captureRequestGeneration();
    setBusy("compile");
    setError("");
    setRetryAction(null);
    try {
      const response = await fetch("/api/strategy-lab/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approval,
          window: { start: windowStart, end: windowEnd },
          initialCapital,
        }),
      });
      const data = await response.json() as CompileResult & { error?: unknown; issues?: unknown };
      if (!isCurrentRequest(requestGeneration)) return;
      if (!response.ok || !data.code) {
        setRecoverableError("compile", getLabApiError(locale, { error: data.error, issues: data.issues }, c.invalidStrategy));
        return;
      }
      setTradesFile(null);
      setPerformanceFile(null);
      setFileInputResetKey((value) => value + 1);
      setCompiled(data);
      setRun(null);
      setReview(null);
      setRetryAction(null);
      setFlash(c.compiled);
    } catch {
      if (isCurrentRequest(requestGeneration)) setRecoverableError("compile", c.networkError);
    } finally {
      setBusy(null);
    }
  };

  const copyPine = async () => {
    if (!compiled) return;
    try {
      await navigator.clipboard.writeText(compiled.code);
      setFlash(c.copied);
    } catch {
      setError(c.clipboardFailed);
    }
  };

  const downloadPine = () => {
    if (!compiled || !strategy) return;
    const blob = new Blob([compiled.code], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${strategy.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "ryntra-strategy"}.pine`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const replaceImportFile = (kind: 'trades' | 'performance', file: File | null) => {
    invalidatePendingRequests();
    importAttemptRef.current = null;
    if (kind === 'trades') setTradesFile(file);
    else setPerformanceFile(file);
    setRun(null);
    setReview(null);
    setReviewPaidConfirmed(false);
    setRetryAction(null);
    setFlash('');
    setError('');
  };

  const importBacktest = async () => {
    if (!approval || !compiled || !tradesFile || !performanceFile) {
      setError(c.importError);
      return;
    }
    const requestGeneration = captureRequestGeneration();
    setBusy("import");
    setError("");
    setRetryAction(null);
    try {
      const [tradesCsv, performanceCsv] = await Promise.all([tradesFile.text(), performanceFile.text()]);
      if (!isCurrentRequest(requestGeneration)) return;
      const payload = {
        approval,
        manifest: {
          schemaVersion: 1,
          provider: "tradingview",
          strategyVersionId: approval.versionId,
          compilerVersion: compiled.compilerVersion,
          pineHash: compiled.pineHash,
          symbol: approval.spec.universe.symbol,
          timeframe: approval.spec.timeframe,
          timezone: "UTC",
          compileWindow: { start: windowStart, end: windowEnd },
          initialCapital,
          exportedAt: new Date(Math.max(tradesFile.lastModified, performanceFile.lastModified)).toISOString(),
        },
        tradesCsv,
        performanceCsv,
        oos,
        usesSyntheticPrices: syntheticPrices,
      };
      const persistRun = persistedVersion?.versionId === approval.versionId;
      const requestId = requestIdFor(importAttemptRef, {
        ...payload,
        ...(persistRun ? { persistence: { lineage: experimentLineage } } : {}),
      });
      const response = await fetch("/api/strategy-lab/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          ...(persistRun ? { persistence: { requestId, lineage: experimentLineage } } : {}),
        }),
      });
      const data = await response.json() as ImportResult & { error?: unknown; issues?: unknown };
      if (!isCurrentRequest(requestGeneration)) return;
      if (!response.ok || !data.evidence) {
        setRecoverableError("import", getLabApiError(locale, { error: data.error, issues: data.issues }, c.importError));
        return;
      }
      const storedRunValid = data.persistence === "stored"
        && data.persistedRun !== null
        && data.evidenceIdentity?.experimentId === data.persistedRun.experimentId
        && data.evidenceIdentity.evidenceReportId === data.persistedRun.evidenceReportId
        && data.evidenceIdentity.evidenceHash === data.persistedRun.evidenceHash
        && data.persistedRun.iterationNumber === experimentLineage.iterationNumber;
      const disabledRunValid = data.persistence === "disabled"
        && data.persistedRun === null
        && data.evidenceIdentity?.experimentId === null
        && data.evidenceIdentity.evidenceReportId === null;
      if ((!storedRunValid && !disabledRunValid) || (persistRun && !storedRunValid)) {
        setRecoverableError("import", c.importError);
        return;
      }
      importAttemptRef.current = null;
      setRun(data);
      setReview(null);
      setReviewPaidConfirmed(false);
      setRetryAction(null);
      setFlash(data.evidenceProof
        ? `${humanize(data.evidence.quality)} evidence / ${humanize(data.evidence.verdict)}`
        : c.proofUnavailable);
    } catch {
      if (isCurrentRequest(requestGeneration)) setRecoverableError("import", c.networkError);
    } finally {
      setBusy(null);
    }
  };

  const requestReview = async () => {
    if (!paidAiAvailable) {
      setError(c.aiUnavailable);
      return;
    }
    if (!approval || !run) return;
    if (!run.evidenceProof) {
      setError(c.proofUnavailable);
      return;
    }
    if (!reviewPaidConfirmed) {
      setError(c.confirmAdversarialAiRequired);
      return;
    }
    const requestGeneration = captureRequestGeneration();
    setBusy("review");
    setError("");
    setRetryAction(null);
    try {
      const persistedEvidence = run.persistence === "stored"
        && run.persistedRun !== null
        && run.evidenceIdentity.experimentId === run.persistedRun.experimentId
        && run.evidenceIdentity.evidenceReportId === run.persistedRun.evidenceReportId
        ? {
            experimentId: run.persistedRun.experimentId,
            evidenceReportId: run.persistedRun.evidenceReportId,
          }
        : null;
      const payload = {
        locale, approval, evidence: run.evidence, evidenceProof: run.evidenceProof, confirmAdversarialReview: true as const,
        ...(persistedEvidence ? { persistence: persistedEvidence } : {}),
      };
      const requestId = requestIdFor(reviewAttemptRef, payload);
      const response = await fetch("/api/strategy-lab/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          requestId,
        }),
      });
      const data = await response.json() as ReviewResult;
      if (!isCurrentRequest(requestGeneration)) return;
      if (!response.ok || !data.proposal) {
        setRecoverableError("review", getLabApiError(locale, { error: data.error, issues: data.issues }, c.aiUnavailable));
        return;
      }
      const proposalPersistenceValid = persistedEvidence
        ? data.persistence === "stored" && data.persistedProposal !== null && data.persistedProposal !== undefined
        : data.persistence === "disabled" && data.persistedProposal === null;
      if (!proposalPersistenceValid) {
        setRecoverableError("review", c.aiUnavailable);
        return;
      }
      reviewAttemptRef.current = null;
      setReview(data.proposal);
      setReviewPaidConfirmed(false);
      setRetryAction(null);
      setFlash("Inspectable hypothesis received");
    } catch {
      if (isCurrentRequest(requestGeneration)) setRecoverableError("review", c.networkError);
    } finally {
      setBusy(null);
    }
  };

  const createVersionDraft = () => {
    if (!strategy || !review) return;
    const applied = applyReviewChanges(strategy, review);
    if (!applied.ok) {
      setError(c.invalidDraft);
      return;
    }
    const persistedParentRun = run?.persistence === "stored" ? run.persistedRun : null;
    const nextLineage: ExperimentLineage = persistedParentRun
      ? {
          parentRunId: persistedParentRun.experimentId,
          hypothesis: review.nextHypothesis.statement,
          changedFields: changedStrategySpecTopLevelFields(strategy, applied.strategy),
          userAttestedTestWindowSeenBeforeChange: true,
          iterationNumber: persistedParentRun.iterationNumber + 1,
        }
      : rootExperimentLineage();
    setStrategy(applied.strategy);
    setNotes(null);
    clearAfterSpec(nextLineage);
    setFlash("New immutable lineage draft created; review required");
  };

  const retryLastAction = () => {
    if (retryAction === "formalize") void formalize();
    else if (retryAction === "approve") void approveStrategy();
    else if (retryAction === "compile") void compile();
    else if (retryAction === "import") void importBacktest();
    else if (retryAction === "review") void requestReview();
  };

  const evidence = run?.evidence ?? null;

  return (
    <div className="sl-root" lang={locale} dir={localeDir(locale)}>
      <header className="sl-header">
        <div className="sl-title-block">
          <span className="sl-kicker"><Flask size={15} weight="fill" /> {c.preview}</span>
          <div className="sl-title-row">
            <h1>{c.title}</h1>
            <span className="sl-version">
              {approval ? approval.versionId.slice(0, 8) : c.draftStatus}
            </span>
          </div>
          <p>{c.subtitle}</p>
        </div>
        <div className="sl-header-controls">
          <span className="sl-local"><ShieldCheck size={14} /> {c.localMode}</span>
        </div>
      </header>

      <ol className="sl-stages" aria-label={c.workflow}>
        {c.stages.map((label, index) => (
          <li key={label} aria-current={index === stage ? 'step' : undefined} className={index < stage ? "done" : index === stage ? "active" : ""}>
            <span>{index + 1}</span>
            <b>{label}</b>
          </li>
        ))}
      </ol>

      {(error || flash) ? (
        <div className={`sl-notice ${error ? "error" : "ok"}`} role={error ? "alert" : "status"}>
          {error ? <WarningCircle size={16} weight="fill" /> : <CheckCircle size={16} weight="fill" />}
          <span>{error || flash}</span>
          {error && retryAction ? <button type="button" onClick={retryLastAction}>{c.retry}</button> : null}
          <button type="button" onClick={() => { setError(""); setFlash(""); setRetryAction(null); }} aria-label={c.dismiss}><X size={14} /></button>
        </div>
      ) : null}

      <div className="sl-workspace">
        <aside className="sl-column sl-left">
          <section className="sl-section">
            <div className="sl-section-head">
              <div>
                <span>01 / IDEA</span>
                <h2>{c.briefHeading}</h2>
              </div>
              <Sparkle size={18} />
            </div>
            <p className="sl-section-copy">{c.briefBody}</p>
            <div className="sl-form-grid two">
              <label>
                <span>{c.market}</span>
                <input dir="ltr" value={brief.symbol} onChange={(event) => updateBrief({ ...brief, symbol: event.target.value })} />
              </label>
              <label>
                <span>{c.timeframe}</span>
                <select value={brief.timeframe} onChange={(event) => updateBrief({ ...brief, timeframe: event.target.value })}>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1d">1d</option>
                </select>
              </label>
              <label>
                <span>{c.assetClass}</span>
                <select value={brief.assetClass} onChange={(event) => updateBrief({ ...brief, assetClass: event.target.value as Brief['assetClass'] })}>
                  <option value="crypto">Crypto</option>
                  <option value="tokenized-equity">Tokenized equity</option>
                  <option value="forex">Forex</option>
                  <option value="index">Index</option>
                </select>
              </label>
            </div>
            <label className="sl-field">
              <span>{c.thesis}</span>
              <textarea dir='auto' rows={3} maxLength={500} value={brief.thesis} onChange={(event) => updateBrief({ ...brief, thesis: event.target.value })} />
            </label>
            <label className="sl-field">
              <span>{c.entryIdea}</span>
              <textarea dir='auto' rows={2} maxLength={1500} value={brief.entryIdea} onChange={(event) => updateBrief({ ...brief, entryIdea: event.target.value })} />
            </label>
            <label className="sl-field">
              <span>{c.exitIdea}</span>
              <textarea dir='auto' rows={2} maxLength={1500} value={brief.exitIdea} onChange={(event) => updateBrief({ ...brief, exitIdea: event.target.value })} />
            </label>
            <div className="sl-form-grid four">
              <label>
                <span>{c.stop}</span>
                <input type="number" min="0.1" max="25" step="0.1" value={brief.stopPercent} onChange={(event) => updateBrief({ ...brief, stopPercent: Number(event.target.value) })} />
              </label>
              <label>
                <span>{c.risk}</span>
                <input type="number" min="0.05" max="5" step="0.05" value={brief.riskPercent} onChange={(event) => updateBrief({ ...brief, riskPercent: Number(event.target.value) })} />
              </label>
              <label>
                <span>{c.maxDrawdownPolicy}</span>
                <input type="number" min="1" max="50" step="0.5" value={brief.maxDrawdownPercent} onChange={(event) => updateBrief({ ...brief, maxDrawdownPercent: Number(event.target.value) })} />
              </label>
            </div>
            <div className="sl-form-grid four">
              <label><span>{c.commission}</span><input type="number" min="0" max="500" value={brief.costModel.commissionBps} onChange={(event) => updateBrief({ ...brief, costModel: { ...brief.costModel, commissionBps: Number(event.target.value) } })} /></label>
              <label><span>{c.spread}</span><input type="number" min="0" max="500" value={brief.costModel.spreadBps} onChange={(event) => updateBrief({ ...brief, costModel: { ...brief.costModel, spreadBps: Number(event.target.value) } })} /></label>
              <label><span>{c.slippage}</span><input type="number" min="0" max="500" value={brief.costModel.slippageBps} onChange={(event) => updateBrief({ ...brief, costModel: { ...brief.costModel, slippageBps: Number(event.target.value) } })} /></label>
              <label><span>{c.funding}</span><input type="number" min="0" max="500" value={brief.costModel.fundingBpsPerDay} onChange={(event) => updateBrief({ ...brief, costModel: { ...brief.costModel, fundingBpsPerDay: Number(event.target.value) } })} /></label>
            </div>
            <div className="sl-action-row">
              <button type="button" className="sl-btn primary" disabled={busy !== null || immutableApprovedVersion} onClick={useTemplate}>
                <Flask size={15} /> {c.template}
              </button>
              <button type="button" className="sl-btn" disabled={!paidAiAvailable || busy !== null || !formalizePaidConfirmed || immutableApprovedVersion} onClick={() => void formalize()}>
                <Sparkle size={15} weight="fill" /> {busy === "formalize" ? c.loading : c.formalize}
              </button>
            </div>
            <div className="sl-ai-contract">
              <Brain size={16} />
              <span><b>{c.assistant}</b>{paidAiAvailable ? c.aiNote : c.aiUnavailable}</span>
            </div>
            <label className="sl-approval">
              <input type="checkbox" checked={formalizePaidConfirmed} disabled={!paidAiAvailable || busy !== null || immutableApprovedVersion} onChange={(event) => setFormalizePaidConfirmed(event.target.checked)} />
              <span>{c.confirmPaidAi}</span>
            </label>
          </section>

          <section className="sl-section">
            <div className="sl-section-head">
              <div>
                <span>02 / STRATEGY SPEC</span>
                <h2>{c.structuredHeading}</h2>
              </div>
              <span className={`sl-status-dot ${approved ? "good" : ""}`}>{approved ? c.approved : "DRAFT"}</span>
            </div>
            <p className="sl-section-copy">{c.structuredBody}</p>
            {immutableApprovedVersion ? <p className="sl-empty">{c.immutableApprovedVersionNotice}</p> : null}
            {!strategy ? <p className="sl-empty">{c.noDraft}</p> : (
              <>
                {mode === "pro" ? (
                  <>
                    <div className="sl-form-grid two">
                      <label>
                        <span>{c.strategyName}</span>
                        <input dir="auto" value={strategy.name} disabled={immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.name = event.target.value; })} />
                      </label>
                      <label>
                        <span>{c.market}</span>
                        <input dir="ltr" value={strategy.universe.symbol} disabled={immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.universe.symbol = event.target.value.toUpperCase(); })} />
                      </label>
                      <label>
                        <span>{c.assetClass}</span>
                        <select value={strategy.universe.assetClass} disabled={immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.universe.assetClass = event.target.value as Brief['assetClass']; })}>
                          <option value="crypto">Crypto</option><option value="tokenized-equity">Tokenized equity</option><option value="forex">Forex</option><option value="index">Index</option>
                        </select>
                      </label>
                      <label>
                        <span>{c.timeframe}</span>
                        <input dir="ltr" value={strategy.timeframe} disabled={immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.timeframe = event.target.value; })} />
                      </label>
                    </div>
                    <label className="sl-field"><span>{c.thesis}</span><textarea dir="auto" rows={3} maxLength={500} value={strategy.thesis} disabled={immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.thesis = event.target.value; })} /></label>
                  </>
                ) : (
                  <div className="sl-spec-summary">
                    <strong>{strategy.name}</strong>
                    <span>{strategy.universe.symbol} / {strategy.timeframe}</span>
                    <p>{strategy.thesis}</p>
                  </div>
                )}

                <div className="sl-canonical-meta" aria-label={c.structuredHeading}>
                  <div><b>{c.schemaVersion}</b><code>{strategy.schemaVersion}</code></div>
                  <div><b>{c.provider}</b><code>{strategy.universe.provider}</code></div>
                  <div><b>{c.assetClass}</b><code>{strategy.universe.assetClass}</code></div>
                  <div><b>{c.market}</b><code dir="ltr">{strategy.universe.symbol}</code></div>
                  <div><b>{c.timeframe}</b><code dir="ltr">{strategy.timeframe}</code></div>
                  <div className="wide"><b>{c.thesis}</b><span>{strategy.thesis}</span></div>
                </div>

                <div className="sl-subhead"><strong>{c.indicators}</strong><span>{strategy.indicators.length}</span></div>
                <div className="sl-indicators">
                  {strategy.indicators.map((indicator, index) => (
                    <div className="sl-indicator-row" key={indicator.id}>
                      <code>{indicator.id}</code>
                      <span>{indicator.kind.toUpperCase()}</span>
                      <span>{indicator.source}</span>
                      {mode === "pro" ? (
                        <input
                          aria-label={`${indicator.id} length`}
                          type='number'
                          min='2'
                          max='1000'
                          value={indicator.length}
                          disabled={immutableApprovedVersion}
                          onChange={(event) => mutateSpec((draft) => { draft.indicators[index].length = Number(event.target.value); })}
                        />
                      ) : <b>{indicator.length}</b>}
                    </div>
                  ))}
                </div>

                {mode === "pro" ? (
                  <>
                    <RuleEditor title={c.entryRules} root={strategy.entry} indicators={strategy.indicators} disabled={immutableApprovedVersion} onChange={(next) => mutateSpec((draft) => { draft.entry = next; })} />
                    <RuleEditor title={c.exitRules} root={strategy.exit} indicators={strategy.indicators} disabled={immutableApprovedVersion} onChange={(next) => mutateSpec((draft) => { draft.exit = next; })} />
                  </>
                ) : null}
                <div className="sl-rule-summary" aria-label={c.structuredHeading}>
                  <div><b>{c.entryRules}</b><span>{describeRuleTree(strategy.entry)}</span></div>
                  <div><b>{c.exitRules}</b><span>{describeRuleTree(strategy.exit)}</span></div>
                  <div>
                    <b>{c.filters}</b>
                    {strategy.filters.length
                      ? strategy.filters.map((filter, index) => <span key={index}>{describeRuleTree(filter)}</span>)
                      : <span>{c.none}</span>}
                  </div>
                </div>

                <div className="sl-subhead"><strong>{c.riskCosts}</strong></div>
                <div className="sl-form-grid four">
                  <label><span>{c.stop} ({strategy.stop.kind})</span><input type="number" min="0.1" max="25" value={strategy.stop.value} disabled={mode !== "pro" || immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.stop.value = Number(event.target.value); })} /></label>
                  <label><span>{c.risk} ({strategy.sizing.kind})</span><input type="number" min="0.05" max="5" value={strategy.sizing.value} disabled={mode !== "pro" || immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.sizing.value = Number(event.target.value); })} /></label>
                  <label><span>{c.maxDrawdownPolicy}</span><input type="number" min="1" max="50" value={strategy.riskPolicy.maxDrawdownPercent} disabled={mode !== "pro" || immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.riskPolicy.maxDrawdownPercent = Number(event.target.value); })} /></label>
                  <label><span>{c.maxOpenPositions}</span><input type='number' min='1' max='1' value={strategy.riskPolicy.maxOpenPositions} disabled readOnly /></label>
                  <label><span>{c.allowShort}</span><input value={strategy.riskPolicy.allowShort ? c.yes : c.no} disabled /></label>
                  <label><span>{c.commission}</span><input type='number' min='0' max='500' value={strategy.costModel.commissionBps} disabled={mode !== 'pro' || immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.costModel.commissionBps = Number(event.target.value); })} /></label>
                  <label><span>{c.spread}</span><input type='number' min='0' max='500' value={strategy.costModel.spreadBps} disabled={mode !== 'pro' || immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.costModel.spreadBps = Number(event.target.value); })} /></label>
                  <label><span>{c.slippage}</span><input type='number' min='0' max='500' value={strategy.costModel.slippageBps} disabled={mode !== 'pro' || immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.costModel.slippageBps = Number(event.target.value); })} /></label>
                  <label><span>{c.funding}</span><input type='number' min='0' max='500' value={strategy.costModel.fundingBpsPerDay} disabled={mode !== 'pro' || immutableApprovedVersion} onChange={(event) => mutateSpec((draft) => { draft.costModel.fundingBpsPerDay = Number(event.target.value); })} /></label>
                </div>

                <div className="sl-notes sl-canonical-assumptions">
                  <div><b>{c.assumptions}</b>{strategy.assumptions.map((item, index) => <span key={`${index}-${item}`}>{item}</span>)}</div>
                </div>

                {notes && (notes.assumptionsAdded.length || notes.unsupported.length || notes.clarificationQuestions.length) ? (
                  <div className="sl-notes">
                    {notes.assumptionsAdded.length ? <div><b>{c.assumptions}</b>{notes.assumptionsAdded.map((item) => <span key={item}>{item}</span>)}</div> : null}
                    {notes.unsupported.length ? <div className="warn"><b>{c.unsupported}</b>{notes.unsupported.map((item) => <span key={item}>{item}</span>)}</div> : null}
                    {notes.clarificationQuestions.length ? <div><b>{c.questions}</b>{notes.clarificationQuestions.map((item) => <span key={item}>{item}</span>)}</div> : null}
                  </div>
                ) : null}

                <label className="sl-approval">
                  <input type="checkbox" checked={humanApprovalConfirmed} disabled={approved || busy !== null} onChange={(event) => changeApprovalConfirmation(event.target.checked)} />
                  <span><ShieldCheck size={17} /> {c.approve}</span>
                </label>
                {hasProposalWarnings ? (
                  <label className="sl-approval">
                    <input type="checkbox" checked={proposalWarningsAcknowledged} disabled={approved || busy !== null} onChange={(event) => setProposalWarningsAcknowledged(event.target.checked)} />
                    <span>{c.acknowledgeProposalWarnings}</span>
                  </label>
                ) : null}
                <button type="button" className="sl-btn primary wide" disabled={!humanApprovalConfirmed || (hasProposalWarnings && !proposalWarningsAcknowledged) || approved || busy !== null} onClick={() => void approveStrategy()}>
                  <ShieldCheck size={16} /> {busy === "approve" ? c.loading : c.approveVersion}
                </button>
                {approval ? (
                  <div className="sl-canonical-meta" aria-label={c.approvalArtifact}>
                    <div><b>{c.versionId}</b><code>{approval.versionId}</code></div>
                    <div><b>{c.specHash}</b><code>{approval.specHash}</code></div>
                    <div><b>{c.approvedAt}</b><code>{approval.approvedAt}</code></div>
                    <div><b>{c.parentVersion}</b><code>{approval.parentVersionId ?? c.none}</code></div>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </aside>

        <main className="sl-column sl-center">
          <section className="sl-section sl-compile">
            <div className="sl-section-head">
              <div>
                <span>03 / ADAPTER</span>
                <h2>{c.compileHeading}</h2>
              </div>
              <FileCode size={18} />
            </div>
            <div className="sl-compile-bar">
              <label><span>{c.from}</span><input type="date" value={windowStart} onChange={(event) => { setWindowStart(event.target.value); invalidateExperimentBinding(); }} /></label>
              <label><span>{c.to}</span><input type="date" value={windowEnd} onChange={(event) => { setWindowEnd(event.target.value); invalidateExperimentBinding(); }} /></label>
              <label><span>{c.capital}</span><input type="number" min="1" value={initialCapital} onChange={(event) => { setInitialCapital(Number(event.target.value)); invalidateExperimentBinding(); }} /></label>
              <button type="button" className="sl-btn primary" disabled={!strategy || !approved || busy !== null} onClick={() => void compile()}>
                <FileCode size={15} /> {busy === "compile" ? c.loading : c.compile}
              </button>
            </div>
            {compiled ? (
              <div className="sl-code">
                <div className="sl-code-head">
                  <span><CheckCircle size={14} weight="fill" /> {c.compiled}</span>
                  <code>{compiled.compilerVersion} / {compiled.pineHash.slice(0, 12)}</code>
                  <div>
                    <button type="button" className="sl-icon-btn" onClick={() => void copyPine()} title={c.copy} aria-label={c.copy}><Copy size={14} /></button>
                    <button type="button" className="sl-icon-btn" onClick={downloadPine} title={c.download} aria-label={c.download}><DownloadSimple size={14} /></button>
                  </div>
                </div>
                <pre><code>{compiled.code}</code></pre>
                <p>{c.exportHelp}</p>
              </div>
            ) : <p className="sl-empty">{approved ? c.exportHelp : c.needsApproval}</p>}
          </section>

          <section className="sl-section">
            <div className="sl-section-head">
              <div>
                <span>04 / IMPORT</span>
                <h2>{c.importHeading}</h2>
              </div>
              <UploadSimple size={18} />
            </div>
            <p className="sl-section-copy">{c.importBody}</p>
            <div className="sl-files">
              <label className={[tradesFile ? "ready" : "", !compiled || busy !== null ? 'disabled' : ''].filter(Boolean).join(' ')}>
                <UploadSimple size={17} />
                <span><b>{c.tradesCsv}</b><small>{tradesFile?.name ?? c.selectFile}</small></span>
                <input key={`trades-${fileInputResetKey}`} type="file" accept=".csv,text/csv" disabled={!compiled || busy !== null} onChange={(event) => replaceImportFile('trades', event.target.files?.[0] ?? null)} />
              </label>
              <label className={[performanceFile ? "ready" : "", !compiled || busy !== null ? 'disabled' : ''].filter(Boolean).join(' ')}>
                <UploadSimple size={17} />
                <span><b>{c.performanceCsv}</b><small>{performanceFile?.name ?? c.selectFile}</small></span>
                <input key={`performance-${fileInputResetKey}`} type="file" accept=".csv,text/csv" disabled={!compiled || busy !== null} onChange={(event) => replaceImportFile('performance', event.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="sl-form-grid two">
              <label>
                <span>{c.oos}</span>
                <select value={oos} onChange={(event) => changeEvidenceBinding(() => setOos(event.target.value as "none" | "self-attested"))}>
                  <option value="none">{c.oosNone}</option>
                  <option value="self-attested">{c.oosSelf}</option>
                </select>
              </label>
              <label className="sl-check-field">
                <span>{c.syntheticChart}</span>
                <input type="checkbox" checked={syntheticPrices} onChange={(event) => changeEvidenceBinding(() => setSyntheticPrices(event.target.checked))} />
              </label>
            </div>
            <button
              type="button"
              className="sl-btn primary wide"
              disabled={!approved || !compiled || !tradesFile || !performanceFile || busy !== null}
              onClick={() => void importBacktest()}
            >
              <UploadSimple size={16} /> {busy === "import" ? c.loading : c.runEvidence}
            </button>
          </section>

          <section className="sl-section sl-evidence-main">
            <div className="sl-section-head">
              <div>
                <span>05 / EVIDENCE</span>
                <h2>{c.evidenceHeading}</h2>
              </div>
              {evidence ? <span className={`sl-status-dot ${toneForVerdict(evidence.verdict)}`}>{humanize(evidence.quality)}</span> : null}
            </div>
            <EquityChart trades={run?.tradesPreview ?? []} label={c.importedEquityCurve} emptyLabel={c.noImportedTrades} />
            {evidence ? (
              <>
                <div className="sl-metrics">
                  <Metric label={c.trades} value={String(evidence.metrics.trades)} />
                  <Metric label={c.netPnl} value={evidence.metrics.netPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
                  <Metric label={c.totalReturn} value={`${evidence.metrics.totalReturnPercent.toFixed(2)}%`} />
                  <Metric label={c.benchmarkLabel} value={evidence.metrics.benchmarkReturnPercent === null ? "n/a" : `${evidence.metrics.benchmarkReturnPercent.toFixed(2)}%`} />
                  <Metric label={c.winRate} value={`${evidence.metrics.winRatePercent.toFixed(1)}%`} />
                  <Metric label={c.closedTradeDrawdown} value={`${evidence.metrics.maxDrawdownPercent.toFixed(2)}%`} />
                  <Metric label={c.expectancy} value={evidence.metrics.expectancy.toFixed(2)} />
                  <Metric label={c.profitFactor} value={evidence.metrics.profitFactor === null ? "n/a" : evidence.metrics.profitFactor.toFixed(2)} />
                </div>
                {run ? (
                  <p className="sl-preview-note">
                    {formatPreviewCount(c.previewCount, run.tradesPreview.length, Math.min(run.tradesPreview.length, 12), run.tradeCount)}
                  </p>
                ) : null}
                <div className="sl-table-wrap">
                  <table className="sl-trade-table">
                    <caption>{c.tradeTableCaption}</caption>
                    <thead><tr><th scope='col'>#</th><th scope='col'>{c.side}</th><th scope='col'>{c.entry}</th><th scope='col'>{c.exit}</th><th scope='col'>{c.gross}</th><th scope='col'>{c.costs}</th><th scope='col'>{c.net}</th></tr></thead>
                    <tbody>
                      {run?.tradesPreview.slice(0, 12).map((trade) => (
                        <tr key={trade.id}>
                          <td>{trade.id}</td>
                          <td><span className={`sl-side ${trade.side}`}>{trade.side}</span></td>
                          <td>{trade.entryPrice.toLocaleString()}</td>
                          <td>{trade.exitPrice.toLocaleString()}</td>
                          <td>{trade.grossPnl.toFixed(2)}</td>
                          <td>{trade.fees.toFixed(2)}</td>
                          <td className={trade.netPnl >= 0 ? "positive" : "negative"}>{trade.netPnl.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <p className="sl-empty">{c.evidenceEmpty}</p>}
          </section>
        </main>

        <aside className="sl-column sl-right">
          <section className="sl-section sl-score">
            <div className="sl-section-head">
              <div>
                <span>QUALITY GATE</span>
                <h2>{c.quality}</h2>
              </div>
              <ShieldCheck size={18} />
            </div>
            {evidence ? (
              <>
                <div className="sl-score-top">
                  <div>
                    <strong>{evidence.score}</strong><span>/100</span>
                  </div>
                  <div>
                    <b>{humanize(evidence.quality)}</b>
                    <span className={`sl-verdict ${toneForVerdict(evidence.verdict)}`}>{humanize(evidence.verdict)}</span>
                  </div>
                </div>
                <div className="sl-dimensions">
                  {Object.entries(evidence.dimensions).map(([key, value]) => {
                    const maximum = EVIDENCE_DIMENSION_MAX[key as keyof EvidenceReport['dimensions']];
                    return (
                      <div key={key}>
                        <span><b>{humanize(key)}</b><em>{value}/{maximum}</em></span>
                        <i><u style={{ width: `${Math.min(100, (value / maximum) * 100)}%` }} /></i>
                      </div>
                    );
                  })}
                </div>
                {evidence.warnings.length ? (
                  <div className="sl-warnings">
                    {evidence.warnings.map((warning) => <span key={warning}><WarningCircle size={13} /> {humanize(warning)}</span>)}
                  </div>
                ) : null}
              </>
            ) : <p className="sl-empty">{c.evidenceEmpty}</p>}
          </section>

          <section className="sl-section sl-review">
            <div className="sl-section-head">
              <div>
                <span>EXPLICIT AI ACTION</span>
                <h2>{c.reviewHeading}</h2>
              </div>
              <Brain size={18} />
            </div>
            {!review ? (
              <>
                <p className="sl-section-copy">{run ? (paidAiAvailable ? c.reviewCostNote : c.aiUnavailable) : c.reviewEmpty}</p>
                {run && !run.evidenceProof ? <p className="sl-empty" role="alert">{c.proofUnavailable}</p> : null}
                {run ? <label className="sl-approval">
                  <input type="checkbox" checked={reviewPaidConfirmed} disabled={!paidAiAvailable || !run.evidenceProof || busy !== null} onChange={(event) => setReviewPaidConfirmed(event.target.checked)} />
                  <span>{c.confirmAdversarialAi}</span>
                </label> : null}
                <button type="button" className="sl-btn wide" disabled={!paidAiAvailable || !run?.evidenceProof || !reviewPaidConfirmed || busy !== null} onClick={() => void requestReview()}>
                  <Brain size={16} /> {busy === "review" ? c.loading : c.adversarial}
                </button>
              </>
            ) : (
              <div className="sl-review-proposal">
                <p>{review.explanation}</p>
                <div className="sl-hypothesis">
                  <span>{c.hypothesis}</span>
                  <h3>{review.nextHypothesis.statement}</h3>
                  <dl>
                    <dt>{c.rationale}</dt><dd>{review.nextHypothesis.rationale}</dd>
                    <dt>{c.expected}</dt><dd>{review.nextHypothesis.expectedObservation}</dd>
                    <dt>{c.falsification}</dt><dd>{review.nextHypothesis.falsificationCriterion}</dd>
                  </dl>
                </div>
                <div className="sl-change-set">
                  {review.nextHypothesis.changes.map((change, index) => (
                    <div key={index}>
                      <code>{reviewChangeTarget(change)}</code>
                      <span>
                        {approval ? currentReviewValue(approval.spec, change) : c.unavailable}
                        {" → "}{change.value}
                      </span>
                    </div>
                  ))}
                </div>
                {review.risks.length ? <div className="sl-review-list"><b>{c.risks}</b>{review.risks.map((item) => <span key={item}>{item}</span>)}</div> : null}
                <div className="sl-review-list"><b>{c.references}</b>{review.evidenceReferences.map((item) => <code key={item}>{item}</code>)}</div>
                <div className="sl-action-row">
                  <button type="button" className="sl-btn primary" onClick={createVersionDraft}><Plus size={15} /> {c.createDraft}</button>
                  <button type="button" className="sl-btn" onClick={() => setReview(null)}><X size={15} /> {c.reject}</button>
                </div>
              </div>
            )}
          </section>

          <section className="sl-section sl-lineage">
            <div className="sl-section-head">
              <div><span>LINEAGE</span><h2>{c.versionRecord}</h2></div>
              <span className="sl-version">{approval ? c.approved : c.draftStatus}</span>
            </div>
            {approval ? (
              <div className="sl-canonical-meta" aria-label={c.approvalArtifact}>
                <div><b>{c.versionId}</b><code>{approval.versionId}</code></div>
                <div><b>{c.specHash}</b><code>{approval.specHash}</code></div>
                <div><b>{c.approvedAt}</b><code>{approval.approvedAt}</code></div>
                <div><b>{c.parentVersion}</b><code>{approval.parentVersionId ?? c.none}</code></div>
              </div>
            ) : (
              <div className="sl-lineage-current">
                <code>{c.draftStatus}</code>
                <span>{parentApproval ? `${c.parentVersion} ${parentApproval.versionId}` : c.rootDraft}</span>
              </div>
            )}
          </section>
        </aside>
      </div>

      <footer className="sl-disclosure">
        <ShieldCheck size={16} />
        <p>{c.disclosure}</p>
      </footer>
    </div>
  );
}
// Strategy Lab V1 intentionally exposes no execution tools.
