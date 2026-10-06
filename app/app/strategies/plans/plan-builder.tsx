"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ISSUER_SHORT, type SlimStockRow } from "@/app/app/stocks/stock-model";
import { Help, HelpLabel } from "@/app/shell/help";
import type { HelpTopicId } from "@/app/shell/help-topics";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { PlanRulesSchema, isTokenPlanAsset, planAssetKind, planUnitBasis, type AgentDraftResponse, type MarketEvidenceReadDto, type PlanAssetRead, type PlanRules, type TradingPlan } from "@/lib/api/v1/contract";
import { judgeEvidenceCondition, validateEvidenceConditions } from "@/lib/evidence/conditions";
import { EVIDENCE_METRICS, evidenceMetric, type EvidenceMetricId, type EvidenceOperator, type EvidenceWindow } from "@/lib/evidence/metrics";
import { INVALIDATION_EXAMPLE_UNDER_ENTRY, MAX_PRICE_OVER_ENTRY, startingPrice, type CarriedCondition, type StartingPriceSource } from "@/lib/plans/builder-defaults";
import { decimalReadingDiffers, parseDecimalInput } from "@/lib/plans/decimal-input";
import { computePlanSizing, validatePlanRules, type PlanIssue, type PlanSizingContext } from "@/lib/plans/sizing";
import type { SpotMarketListRow } from "@/lib/spot/markets";
import type { StockAsset } from "@/lib/stocks/asset.server";

import { conditionSentence, fmtByUnit, fmtClock, operatorWord, windowWord } from "@/app/solana/workspace/evidence/evidence-words";

import { fmtUnits, fmtUsd, fmtWhen, issueSentence, planWordsFor, type IssueFigures, type PlanWord } from "./plan-words";
import styles from "./plans.module.css";

/**
 * The plan builder.
 *
 * Three steps a person can answer without reading — *why this stock*, *money*
 * (the budget and the planned risk), *prices* (the entry, the invalidation,
 * the bound) — and every other rule behind *More rules* with a sensible
 * default: the entry valid thirty days, one per cent kept for costs, one per
 * cent modelled for costs and slippage, slippage 0.50 %, a quote no older
 * than 60 s, 1.5 % from the reference. Just as professional, only much
 * simpler (2026-09-15): the same rules schema, the same deterministic size
 * and check, nothing hidden that the Review will judge — only the order and
 * the words changed. Beside the form, live, one card: the plan estimate and
 * what the model says you can lose.
 *
 * The UX audit of 2026-09-16 changed what the form *assumes*: money is the
 * person's — no budget or risk is prefilled, a sum chosen on the asset page
 * arrives as `?budget=`; the entry says which price it was prefilled with, or
 * that none is available (no invented figure); the invalidation is an example
 * in the placeholder, never a value; a comma is a decimal separator and the
 * field shows the reading it will send; a bound's switch stands beside its
 * own field; a disabled button says what is still needed. A plan with no
 * stock in the address starts from a picker over the same universe the
 * Stocks page searches.
 *
 * The asset is read from the confirmed universe, never typed. A new plan is
 * saved as a draft or activated; an existing one is edited into a new version
 * with `ifVersion`, so an edit made elsewhere in the meantime is refused, not
 * overwritten. Saving needs the wallet's proof, the same one Spot uses.
 *
 * **Conditions on what the market did**: the person's own rules on the token's
 * onchain figures — a figure from the registry, a window, above or below, a
 * threshold, and whether an unmet or unjudgeable rule warns or refuses the
 * order. The row shows the figure as it stands now, read through the same route
 * the card uses, so a threshold is written against a real number; the server
 * judges the rule again at the Review. A row arrives prefilled from the
 * analysis card (`?evidence=`).
 *
 * **A plan on a token** (contract 1.7.0). The same form names SOL, a verified
 * crypto or a verified meme of the Spot catalogue: every mint is resolved by
 * `GET /api/v1/plans/asset` the way the create will resolve it, so the
 * builder never shows an asset the server would refuse. A token plan is per
 * token; its entry is prefilled with the market indication Jupiter stated,
 * named with its time as *planning context* and never as the price the
 * person will get — or, when none is available, left for the person's own
 * figure (nothing is invented). A token has no issuer reference, so the
 * deviation bound and the reference rule are not offered on it. A
 * contradiction between rules is said with the person's own figures and the
 * next action (`issueSentence`), never as the validator's sentence.
 */

type ConditionDraft = {
  metric: EvidenceMetricId;
  window: EvidenceWindow;
  operator: EvidenceOperator;
  threshold: string;
  mode: "advisory" | "required";
};

type Draft = {
  thesis: string;
  whyNow: string;
  horizonUnit: "days" | "weeks" | "months" | "none";
  horizonValue: string;
  sources: string;
  assumptions: string;
  entryPrice: string;
  maxPrice: string;
  maxPriceOn: boolean;
  validUntil: string;
  budget: string;
  reserve: string;
  invalidation: string;
  plannedRisk: string;
  costBufferPct: string;
  target: string;
  timeExit: string;
  maxSlippagePct: string;
  maxQuoteAge: string;
  maxDeviationPct: string;
  deviationOn: boolean;
  referenceRequired: boolean;
  minLiquidity: string;
  reason: string;
  conditions: ConditionDraft[];
};

/**
 * The asset the builder holds: the plan asset the server resolved (any
 * kind), the stock's own row where the asset is a stock (the reference, the
 * issuer's mark, the session), and the catalogue's row where it is a token
 * (the picture, the day's change).
 */
type BuilderAsset = Readonly<{ read: PlanAssetRead; stock: StockAsset | null; market: SpotMarketListRow | null }>;

/** Where the entry figure came from: the asset's reference, the token's per-share price, the market indication of a token plan, nothing, or the person. */
type EntrySource = StartingPriceSource | "indication" | "none" | "yours";

/** The entry's source in the form's words, from the planning price the server read. */
function entrySourceOf(asset: BuilderAsset): EntrySource {
  const price = asset.read.planningPrice;
  if (!price) return "none";
  if (price.source === "issuer-reference") return "reference";
  if (price.source === "jupiter-per-share") return "token-per-share";
  return isTokenPlanAsset(asset.read.asset) ? "indication" : "token-price";
}

/** The figures a rule sentence names, off the rules as parsed. */
function figuresOf(rules: PlanRules | null): IssueFigures {
  if (!rules) return {};
  return {
    entry: rules.entry.pricePerShare,
    maxPrice: rules.entry.maxPricePerShare,
    invalidation: rules.risk.invalidationPerShare,
    budget: rules.capital.budgetUsd,
    reserve: rules.capital.reserveForCostsUsd,
    risk: rules.risk.plannedRiskUsd,
    target: rules.exit.targetPerShare,
    validUntil: rules.entry.validUntil,
    timeExit: rules.exit.timeExitAt,
  };
}

/** A typed number as the person meant it; blank or unreadable is NaN, which the schema refuses by name — never zero, never another number. */
const num = (value: string): number => parseDecimalInput(value) ?? Number.NaN;
/** A figure as the field shows it: two decimals from a cent up; below a cent (a meme's per-token price) its significant digits, so a prefilled entry is never "0". */
const money = (value: number): string => (!Number.isFinite(value) ? "" : Math.abs(value) > 0 && Math.abs(value) < 0.01 ? String(Number(value.toPrecision(4))) : String(Math.round(value * 100) / 100));
const isoOf = (local: string): string | null => {
  if (!local) return null;
  const at = Date.parse(local);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};
const localOf = (iso: string | null): string => {
  if (!iso) return "";
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
/** One per cent of the budget kept for costs, and never less than ten cents — the Jupiter fee is 0.50 % and the slippage bound another 0.50 %. */
const reserveFor = (budget: number): string => (Number.isFinite(budget) && budget > 0 ? money(Math.max(0.1, Math.round(budget) / 100)) : "");
const lines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
const blank = (value: string): boolean => value.trim() === "";

function draftFromRules(rules: PlanRules): Draft {
  return {
    thesis: rules.thesis.text,
    whyNow: rules.thesis.whyNow ?? "",
    horizonUnit: rules.thesis.horizon?.unit ?? "none",
    horizonValue: rules.thesis.horizon ? String(rules.thesis.horizon.value) : "",
    sources: rules.thesis.sources.join("\n"),
    assumptions: rules.thesis.assumptions.join("\n"),
    entryPrice: money(rules.entry.pricePerShare),
    maxPrice: rules.entry.maxPricePerShare === null ? "" : money(rules.entry.maxPricePerShare),
    maxPriceOn: rules.entry.maxPricePerShare !== null,
    validUntil: localOf(rules.entry.validUntil),
    budget: money(rules.capital.budgetUsd),
    reserve: money(rules.capital.reserveForCostsUsd),
    invalidation: money(rules.risk.invalidationPerShare),
    plannedRisk: money(rules.risk.plannedRiskUsd),
    costBufferPct: String(rules.risk.costBufferBps / 100),
    target: rules.exit.targetPerShare === null ? "" : money(rules.exit.targetPerShare),
    timeExit: localOf(rules.exit.timeExitAt),
    maxSlippagePct: String(rules.execution.maxSlippageBps / 100),
    maxQuoteAge: String(rules.execution.maxQuoteAgeSeconds),
    maxDeviationPct: rules.execution.maxReferenceDeviationPct === null ? "" : String(rules.execution.maxReferenceDeviationPct),
    deviationOn: rules.execution.maxReferenceDeviationPct !== null,
    referenceRequired: rules.execution.referenceRequired,
    minLiquidity: rules.execution.minLiquidityUsd === null ? "" : money(rules.execution.minLiquidityUsd),
    reason: "",
    conditions: rules.evidenceConditions.map((condition) => ({ metric: condition.metric, window: condition.window, operator: condition.operator, threshold: String(condition.threshold), mode: condition.mode })),
  };
}

/** A row from the analysis card, only when the registry knows the figure it names. */
function conditionFromCarried(carried: CarriedCondition | null): ConditionDraft[] {
  if (!carried) return [];
  const metric = evidenceMetric(carried.metric);
  if (!metric || !(metric.windows as readonly string[]).includes(carried.window)) return [];
  return [{ metric: metric.id, window: carried.window as EvidenceWindow, operator: carried.operator, threshold: String(carried.threshold), mode: "advisory" }];
}

/**
 * A new plan from the asset's own figures: the entry at the price the desk
 * knows for a share (named by its source), the bound two per cent above it,
 * the entry valid thirty days, the execution defaults. Money is the person's:
 * the budget only when they chose it on the asset page, the risk never.
 */
function draftFromAsset(asset: BuilderAsset, budget: number | null, carried: CarriedCondition | null): Draft {
  /* The starting price is the planning price the server read — the same figure, the same source, the same time the version will record. */
  const start = asset.read.planningPrice ? { perShare: asset.read.planningPrice.perUnit } : asset.stock ? startingPrice(asset.stock.row) : null;
  const validUntil = new Date(Date.now() + 30 * 86_400_000);
  /* A token has no issuer reference (1.7.0): neither rule is offered on it. */
  const hasReference = !isTokenPlanAsset(asset.read.asset) && (asset.stock?.row.reference.perShare ?? null) !== null;
  return {
    thesis: "",
    whyNow: "",
    horizonUnit: "none",
    horizonValue: "",
    sources: "",
    assumptions: "",
    entryPrice: start ? money(start.perShare) : "",
    maxPrice: start ? money(start.perShare * MAX_PRICE_OVER_ENTRY) : "",
    maxPriceOn: true,
    validUntil: localOf(validUntil.toISOString()),
    budget: budget !== null ? money(budget) : "",
    reserve: budget !== null ? reserveFor(budget) : "",
    invalidation: "",
    plannedRisk: "",
    costBufferPct: "1",
    target: "",
    timeExit: "",
    maxSlippagePct: "0.5",
    maxQuoteAge: "60",
    maxDeviationPct: "1.5",
    deviationOn: hasReference,
    referenceRequired: hasReference,
    minLiquidity: "",
    reason: "",
    conditions: conditionFromCarried(carried),
  };
}

/** What a field the schema refuses needs, said in the person's language rather than the validator's. */
function needWordFor(path: string): PlanWord {
  if (path === "thesis.text") return "needThesis";
  if (path.startsWith("thesis.sources")) return "needLink";
  if (path === "entry.validUntil" || path === "exit.timeExitAt") return "needDate";
  return "needNumber";
}

/** The draft as rules, or the fields the schema itself refuses (a blank number, a bad link), each named by what it needs. */
function rulesOf(draft: Draft, word: (key: PlanWord) => string): Readonly<{ ok: true; rules: PlanRules }> | Readonly<{ ok: false; issues: readonly PlanIssue[] }> {
  const candidate = {
    thesis: {
      text: draft.thesis.trim(),
      whyNow: draft.whyNow.trim() || null,
      horizon: draft.horizonUnit === "none" ? null : { unit: draft.horizonUnit, value: Math.round(num(draft.horizonValue)) },
      sources: lines(draft.sources),
      assumptions: lines(draft.assumptions),
    },
    entry: { pricePerShare: num(draft.entryPrice), maxPricePerShare: draft.maxPriceOn ? num(draft.maxPrice) : null, validUntil: isoOf(draft.validUntil) },
    capital: { budgetUsd: num(draft.budget), reserveForCostsUsd: blank(draft.reserve) ? 0 : num(draft.reserve) },
    risk: { invalidationPerShare: num(draft.invalidation), plannedRiskUsd: num(draft.plannedRisk), costBufferBps: Math.round(num(draft.costBufferPct) * 100) },
    exit: { targetPerShare: blank(draft.target) ? null : num(draft.target), timeExitAt: isoOf(draft.timeExit), invalidationIsOrder: false as const },
    execution: {
      maxSlippageBps: Math.round(num(draft.maxSlippagePct) * 100),
      maxQuoteAgeSeconds: Math.round(num(draft.maxQuoteAge)),
      maxReferenceDeviationPct: draft.deviationOn ? num(draft.maxDeviationPct) : null,
      referenceRequired: draft.referenceRequired,
      minLiquidityUsd: blank(draft.minLiquidity) ? null : num(draft.minLiquidity),
    },
    /* A blank threshold is NaN, which the schema refuses by name (`evidenceConditions.N.threshold`); the mode decides the unknown policy — the two are one decision. */
    evidenceConditions: draft.conditions.map((condition) => ({ metric: condition.metric, window: condition.window, operator: condition.operator, threshold: num(condition.threshold), mode: condition.mode, onUnknown: condition.mode === "required" ? ("block" as const) : ("warn" as const) })),
  };
  const parsed = PlanRulesSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, rules: parsed.data };
  const seen = new Set<string>();
  const issues: PlanIssue[] = [];
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    const field = path.startsWith("thesis.sources") ? "thesis.sources" : path;
    if (seen.has(field)) continue;
    seen.add(field);
    issues.push({ path, message: word(needWordFor(path)) });
  }
  return { ok: false, issues };
}

const FIELD_OF: Readonly<Record<string, keyof Draft>> = {
  "thesis.text": "thesis",
  "thesis.sources": "sources",
  "thesis.horizon.value": "horizonValue",
  "entry.pricePerShare": "entryPrice",
  "entry.maxPricePerShare": "maxPrice",
  "entry.validUntil": "validUntil",
  "capital.budgetUsd": "budget",
  "capital.reserveForCostsUsd": "reserve",
  "risk.invalidationPerShare": "invalidation",
  "risk.plannedRiskUsd": "plannedRisk",
  "risk.costBufferBps": "costBufferPct",
  "exit.targetPerShare": "target",
  "exit.timeExitAt": "timeExit",
  "execution.maxSlippageBps": "maxSlippagePct",
  "execution.maxQuoteAgeSeconds": "maxQuoteAge",
  "execution.maxReferenceDeviationPct": "maxDeviationPct",
  "execution.minLiquidityUsd": "minLiquidity",
};

/** The fields a plan cannot be sized without, in the order the form asks for them — what a disabled button names. */
const REQUIRED: readonly Readonly<{ field: keyof Draft; word: PlanWord }>[] = [
  { field: "thesis", word: "needWhy" },
  { field: "budget", word: "needBudget" },
  { field: "plannedRisk", word: "needRisk" },
  { field: "entryPrice", word: "needEntry" },
  { field: "invalidation", word: "needInvalidation" },
];

export function PlanBuilder({ mint, planId, budget, locale, carried = null, agentDraftId = null }: { mint: string | null; planId: string | null; budget: number | null; locale: WorkspaceLocale; carried?: CarriedCondition | null; agentDraftId?: string | null }) {
  const router = useRouter();
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;

  const [asset, setAsset] = useState<{ status: "loading" | "ready" | "unknown" | "failed"; asset: BuilderAsset | null }>({ status: mint || planId ? "loading" : "unknown", asset: null });
  /* The words in the unit the plan is in: per token for a pre-IPO instrument and for every crypto or meme (1.7.0), per share otherwise. */
  const unitBasis = asset.asset ? planUnitBasis(asset.asset.read.asset) : "share";
  const tokenAsset = asset.asset ? isTokenPlanAsset(asset.asset.read.asset) : false;
  const sizingContext = useMemo<PlanSizingContext>(() => ({ unitWord: unitBasis, tokenAsset }), [unitBasis, tokenAsset]);
  const word = useMemo(() => planWordsFor(locale, unitBasis), [locale, unitBasis]);
  const [existing, setExisting] = useState<TradingPlan | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [entrySource, setEntrySource] = useState<EntrySource>("none");
  /* A field says what it needs once the person has been in it; a fresh form does not open with warnings. */
  const [touched, setTouched] = useState<ReadonlySet<keyof Draft>>(() => new Set());
  const [save, setSave] = useState<{ status: "idle" | "saving" | "failed"; message: string | null; issues: readonly PlanIssue[] }>({ status: "idle", message: null, issues: [] });
  /* Ryn's draft: read back through the wallet's proof once it exists; the form opens on the mint meanwhile. */
  const [agentDraft, setAgentDraft] = useState<{ status: "idle" | "loading" | "applied" | "missing" | "unproven" }>({ status: agentDraftId ? "idle" : "applied" });

  /* An existing plan first (its mint names the asset), else the mint from the address bar. */
  useEffect(() => {
    let live = true;
    (async () => {
      let planMint = mint;
      if (planId) {
        const response = await fetch(`/api/v1/plans/${encodeURIComponent(planId)}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
        if (!live) return;
        if (response.ok) {
          const body = (await response.json()) as { plan: TradingPlan };
          setExisting(body.plan);
          setDraft(draftFromRules(body.plan.current.rules));
          setEntrySource("yours");
          planMint = body.plan.asset.mint;
        } else {
          setAsset({ status: "failed", asset: null });
          return;
        }
      }
      if (!planMint) {
        setAsset({ status: "unknown", asset: null });
        return;
      }
      /* Any mint, resolved the way the create will resolve it (1.7.0): the
         plan asset, the planning price now, the liquidity — or the server's
         own refusal, so the form never shows an asset a save would refuse. */
      const resolved = await fetch(`/api/v1/plans/asset?mint=${encodeURIComponent(planMint)}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
      if (!live) return;
      if (resolved.status === 422) {
        setAsset({ status: "unknown", asset: null });
        return;
      }
      if (!resolved.ok) {
        setAsset({ status: "failed", asset: null });
        return;
      }
      const read = (await resolved.json()) as PlanAssetRead;
      let stock: StockAsset | null = null;
      let market: SpotMarketListRow | null = null;
      if (isTokenPlanAsset(read.asset)) {
        /* The catalogue's row for the picture and the day's change; the plan does not depend on it. */
        market = await fetch(`/api/spot/market?mint=${encodeURIComponent(planMint)}`, { headers: { accept: "application/json" } })
          .then(async (response) => (response.ok ? (((await response.json()) as { market: SpotMarketListRow | null }).market ?? null) : null))
          .catch(() => null);
      } else {
        /* The stock's own row: the reference, the issuer's mark, the session — what the strip and the rules read. */
        const response = await fetch(`/api/stocks/asset?ticker=${encodeURIComponent(planMint)}`, { headers: { accept: "application/json" } });
        if (!live) return;
        if (!response.ok) {
          setAsset({ status: response.status === 404 ? "unknown" : "failed", asset: null });
          return;
        }
        stock = (await response.json()) as StockAsset;
      }
      if (!live) return;
      const held: BuilderAsset = { read, stock, market };
      setAsset({ status: "ready", asset: held });
      /* Ryn's draft over the asset: the rules the person saw, or the prices it established with the money left for them; the thesis stays theirs. */
      let fromAgent: Draft | null = null;
      if (agentDraftId) {
        if (!proven) {
          setAgentDraft({ status: "unproven" });
        } else {
          setAgentDraft({ status: "loading" });
          const response = await fetch(`/api/v1/agent/drafts/${encodeURIComponent(agentDraftId)}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
          if (!live) return;
          const body = response.ok ? ((await response.json()) as AgentDraftResponse) : null;
          const card = body?.draft.kind === "planDraft" && body.draft.asset.mint === planMint ? body.draft : null;
          if (card) {
            fromAgent = card.rules ? { ...draftFromRules(card.rules), thesis: card.rules.thesis.text === "—" ? "" : card.rules.thesis.text } : draftFromAsset(held, card.prefill.budgetUsd ?? budget, carried);
            if (!card.rules) {
              fromAgent = {
                ...fromAgent,
                entryPrice: card.prefill.entryUsd !== null ? money(card.prefill.entryUsd) : fromAgent.entryPrice,
                maxPrice: card.prefill.maxPriceUsd !== null ? money(card.prefill.maxPriceUsd) : fromAgent.maxPrice,
                maxPriceOn: card.prefill.maxPriceUsd !== null || fromAgent.maxPriceOn,
                invalidation: card.prefill.invalidationUsd !== null ? money(card.prefill.invalidationUsd) : fromAgent.invalidation,
                target: card.prefill.targetUsd !== null ? money(card.prefill.targetUsd) : fromAgent.target,
                plannedRisk: card.prefill.riskUsd !== null ? money(card.prefill.riskUsd) : fromAgent.plannedRisk,
                validUntil: card.prefill.validUntil ? localOf(card.prefill.validUntil) : fromAgent.validUntil,
              };
            }
            setAgentDraft({ status: "applied" });
          } else {
            setAgentDraft({ status: "missing" });
          }
        }
      }
      setDraft((current) => {
        if (fromAgent) {
          setEntrySource("indication");
          return fromAgent;
        }
        if (current) return current;
        setEntrySource(entrySourceOf(held));
        return draftFromAsset(held, budget, carried);
      });
    })().catch(() => {
      if (live) setAsset({ status: "failed", asset: null });
    });
    return () => {
      live = false;
    };
  }, [mint, planId, budget, proven, carried, agentDraftId]);

  /* The figures the conditions name, as they stand now — one read per window in use, through the card's own route; refreshed when a window joins. */
  const evidenceMint = asset.asset?.read.asset.mint ?? null;
  const windowsInUse = useMemo(() => [...new Set((draft?.conditions ?? []).map((condition) => condition.window))].sort().join(","), [draft?.conditions]);
  const [reads, setReads] = useState<Readonly<Record<string, MarketEvidenceReadDto | "loading">>>({});
  useEffect(() => {
    if (!evidenceMint || windowsInUse === "") return;
    let live = true;
    for (const window of windowsInUse.split(",")) {
      if (reads[window]) continue;
      setReads((current) => ({ ...current, [window]: "loading" }));
      fetch(`/api/v1/research/evidence?mint=${encodeURIComponent(evidenceMint)}&window=${window}`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } })
        .then(async (response) => (response.ok ? ((await response.json()) as MarketEvidenceReadDto) : null))
        .catch(() => null)
        .then((read) => {
          if (!live) return;
          setReads((current) => ({ ...current, [window]: read ?? { state: "UNAVAILABLE", snapshot: null, reason: null, served: "none" } }));
        });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a window already read is not read again; `reads` is the cache this effect fills
  }, [evidenceMint, windowsInUse]);

  const setCondition = (index: number, patch: Partial<ConditionDraft>) => {
    setDraft((current) => {
      if (!current) return current;
      const conditions = current.conditions.map((condition, at) => (at === index ? { ...condition, ...patch } : condition));
      return { ...current, conditions };
    });
    setTouched((current) => (current.has("conditions") ? current : new Set(current).add("conditions")));
  };
  const addCondition = () => {
    setDraft((current) => (current ? { ...current, conditions: [...current.conditions, { metric: "dex_volume_usd", window: "24h", operator: "gte", threshold: "", mode: "advisory" }] } : current));
  };
  const removeCondition = (index: number) => {
    setDraft((current) => (current ? { ...current, conditions: current.conditions.filter((_, at) => at !== index) } : current));
  };

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) => {
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, [key]: value };
        /* The reserve follows the budget until the person writes it, on a new plan. */
        if (key === "budget" && !existing && !touched.has("reserve")) next.reserve = reserveFor(num(String(value)));
        return next;
      });
      if (key === "entryPrice") setEntrySource("yours");
      setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
    },
    [existing, touched],
  );

  const outcome = useMemo(() => {
    if (!draft) return null;
    const rules = rulesOf(draft, word);
    /* The money rules by the size module (in the asset's context: the unit, whether the reference rules apply), the conditions by the evidence layer's registry — the same two validators the server runs; each contradiction said with the person's own figures. A contradiction between two prices is named as soon as both are written, before the thesis exists: the rules are judged on a stand-in thesis when only the words are missing, so the person is not told to write the thesis first and the contradiction second. */
    const judged = rules.ok ? rules : rulesOf({ ...draft, thesis: draft.thesis.trim() || "·" }, word);
    const figures = figuresOf(judged.ok ? judged.rules : null);
    const ruleIssues = judged.ok ? [...validatePlanRules(judged.rules, Date.now(), sizingContext), ...validateEvidenceConditions(judged.rules.evidenceConditions)].map((issue) => ({ ...issue, message: issueSentence(issue, figures, locale, unitBasis) })) : [];
    if (!rules.ok) return { rules: null, issues: [...rules.issues, ...ruleIssues], sizing: null };
    const sized = ruleIssues.length === 0 ? computePlanSizing(rules.rules, Date.now(), sizingContext) : null;
    return { rules: rules.rules, issues: ruleIssues, sizing: sized && sized.ok ? sized.sizing : null };
  }, [draft, word, locale, sizingContext, unitBasis]);

  /* The plan estimate, as the numbers stand — before the thesis is written.
     The same size function over the same rules with a stand-in thesis; saving
     still needs the real one. */
  const preview = useMemo(() => {
    if (!draft) return null;
    if (outcome?.sizing && outcome.rules) return { rules: outcome.rules, sizing: outcome.sizing };
    if (draft.thesis.trim()) return null;
    const rules = rulesOf({ ...draft, thesis: "·" }, word);
    if (!rules.ok) return null;
    if (validatePlanRules(rules.rules, Date.now(), sizingContext).length > 0) return null;
    const sized = computePlanSizing(rules.rules, Date.now(), sizingContext);
    return sized.ok ? { rules: rules.rules, sizing: sized.sizing } : null;
  }, [draft, outcome, word, sizingContext]);

  /* Field-level: what the schema refuses shows once the field was touched; what the server refused shows at once. A condition's issue names its row (`evidenceConditions[i].field` from the registry, `evidenceConditions.i.field` from the schema). */
  const fieldOf = (issue: PlanIssue): keyof Draft | undefined => (issue.path.startsWith("evidenceConditions") ? "conditions" : FIELD_OF[issue.path.startsWith("thesis.sources") ? "thesis.sources" : issue.path]);
  const conditionIssue = (index: number): string | null => {
    const mine = (issue: PlanIssue) => new RegExp(`^evidenceConditions[.\\[]${index}[\\].]`).test(issue.path);
    const own = touched.has("conditions") ? (outcome?.issues ?? []).find(mine) : undefined;
    const server = save.issues.find(mine);
    return own?.message ?? server?.message ?? null;
  };
  const issueOf = (field: keyof Draft): string | null => {
    const own = (outcome?.issues ?? []).find((issue) => fieldOf(issue) === field && touched.has(field));
    const server = save.issues.find((issue) => fieldOf(issue) === field);
    return own?.message ?? server?.message ?? null;
  };
  /* The check panel: a contradiction between rules is named at once; a field not yet written is waited for, not shouted about. */
  const checkIssues = (outcome?.issues ?? []).filter((issue) => {
    const field = fieldOf(issue);
    return field === undefined || touched.has(field) || outcome?.rules !== null;
  });
  const checkState: "pass" | "fail" | "waiting" = !outcome ? "waiting" : outcome.issues.length === 0 ? "pass" : checkIssues.length > 0 ? "fail" : "waiting";
  /* What a disabled button is waiting for, by name. */
  const missing = draft ? REQUIRED.filter(({ field }) => blank(String(draft[field]))).map(({ word: key }) => word(key)) : [];

  /* The figure a money or price field will send, shown when the text could be read two ways (a comma, a grouping space). */
  const reading = (text: string, kind: "usd" | "pct" | "plain"): string | null => {
    if (!decimalReadingDiffers(text)) return null;
    const value = parseDecimalInput(text);
    if (value === null) return null;
    const shown = kind === "usd" ? fmtUsd(value, locale) : kind === "pct" ? `${value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 4 })}%` : value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 6 });
    return `${word("readsAs")} ${shown}`;
  };
  const utcOf = (local: string): string | null => {
    const iso = isoOf(local);
    return iso ? `${word("localTime")} · ${fmtWhen(iso, locale)}` : null;
  };

  const submit = async (mode: "draft" | "activate" | "version") => {
    if (!outcome?.rules || !draft) return;
    setSave({ status: "saving", message: null, issues: [] });
    try {
      const headers = { "content-type": "application/json", accept: "application/json", "X-Ryntra-API": "1" };
      const response = existing
        ? await fetch(`/api/v1/plans/${encodeURIComponent(existing.id)}`, { method: "PUT", headers, body: JSON.stringify({ rules: outcome.rules, ifVersion: existing.version, reason: draft.reason.trim() || null }) })
        : await fetch("/api/v1/plans", { method: "POST", headers, body: JSON.stringify({ asset: { mint: asset.asset?.read.asset.mint }, rules: outcome.rules, activate: mode === "activate" }) });
      const body = (await response.json()) as { plan?: TradingPlan; error?: { code: string; message: string; issues?: PlanIssue[] } };
      if (response.ok && body.plan) {
        router.push(`/app/strategies/plans/${body.plan.id}`);
        return;
      }
      const code = body.error?.code ?? "";
      const message = code === "PLAN_VERSION_CONFLICT" ? word("conflict") : code === "UNAUTHORIZED" ? word("signInToSave") : code === "ASSET_UNCONFIRMED" ? word("assetUnknownAny") : word("saveFailed");
      /* The server's refusals in the same words as the form's own: the person's figures and the next action. */
      const figures = figuresOf(outcome.rules);
      setSave({ status: "failed", message, issues: (body.error?.issues ?? []).map((issue) => ({ ...issue, message: issueSentence(issue, figures, locale, unitBasis) })) });
    } catch {
      setSave({ status: "failed", message: word("saveFailed"), issues: [] });
    }
  };

  const row = asset.asset?.stock?.row ?? null;
  const rep = row?.representation ?? null;
  const planAsset = asset.asset?.read.asset ?? null;
  const planningPrice = asset.asset?.read.planningPrice ?? null;
  const symbolUnderlying = planAsset?.underlying.symbol ?? "";
  const start = planningPrice ? { perShare: planningPrice.perUnit } : row ? startingPrice(row) : null;
  const entryHint =
    entrySource === "reference" ? word("entryFromReference")
    : entrySource === "token-per-share" ? word("entryFromToken")
    : entrySource === "token-price" ? word("entryFromTokenPrice")
    : entrySource === "indication" ? word("entryFromIndication")
    : entrySource === "yours" ? word("entryYours")
    : tokenAsset ? word("entryNoneToken") : word("entryNone");
  const invalidationExample = start ? `${word("example")} ${money(start.perShare * INVALIDATION_EXAMPLE_UNDER_ENTRY)}` : undefined;
  /* Where the asset lives: a stock on its desk page, a token on the Spot market. */
  const assetHref = planAsset ? (isTokenPlanAsset(planAsset) ? `/app/spot?view=${planAssetKind(planAsset)}&mint=${encodeURIComponent(planAsset.mint)}` : `/app/stocks/${encodeURIComponent(planAsset.symbol)}`) : null;
  const kindWord = planAsset ? (planAssetKind(planAsset) === "meme" ? word("kindMeme") : planAssetKind(planAsset) === "crypto" ? word("kindCrypto") : word("kindStock")) : "";
  const planningLine = planningPrice
    ? `${word("planningPriceAsOf")} ${fmtWhen(planningPrice.observedAt, locale)}${planningPrice.state === "stale" ? ` · ${word("planningPriceStale")}` : ""}`
    : word("planningPriceNone");
  /* The estimate needs the money and the prices, not the thesis; its empty state names what is still blank. */
  const estimateMissing = draft ? REQUIRED.filter(({ field }) => field !== "thesis" && blank(String(draft[field]))).map(({ word: key }) => word(key)) : [];

  return (
    <section className={styles.page} aria-labelledby="plan-builder-title">
      <p className={styles.crumbs}>
        <Link href="/app/bots" prefetch={false}>
          {word("back")}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{existing ? word("builderTitleEdit") : word("builderTitle")}</span>
      </p>
      <header className={styles.head}>
        <h1 id="plan-builder-title">{existing ? `${word("builderTitleEdit")} · v${existing.version + 1}` : word("builderTitle")}</h1>
        <span className={styles.headSpacer} />
        {assetHref ? (
          <Link className="rw-btn" href={assetHref} prefetch={false}>
            {tokenAsset ? word("seeMarket") : word("seeAsset")}
          </Link>
        ) : null}
      </header>
      <p className={styles.lead}>{word("builderLead")}</p>
      {agentDraft.status === "unproven" || agentDraft.status === "missing" || agentDraft.status === "loading" ? (
        <p className={styles.lead} data-agent-draft={agentDraft.status}>
          {agentDraft.status === "unproven"
            ? locale === "uk" ? "Чернетка від Ryntra відкриється після підтвердження гаманця — вона твоя і нічия більше." : "The draft Ryntra prepared opens once the wallet is confirmed — it is yours and nobody else's."
            : agentDraft.status === "missing"
              ? locale === "uk" ? "Чернетка від Ryntra не знайдена або її термін минув; форма відкрита на активі." : "The draft Ryntra prepared was not found or has expired; the form is open on the asset."
              : locale === "uk" ? "Читаємо чернетку від Ryntra…" : "Reading the draft Ryntra prepared…"}
        </p>
      ) : null}

      {asset.status === "unknown" ? (
        <AssetPicker locale={locale} note={mint || planId ? word("assetUnknownAny") : null} onPick={(picked) => router.replace(`/app/strategies/new?mint=${encodeURIComponent(picked)}${budget !== null ? `&budget=${budget}` : ""}`)} />
      ) : asset.status === "failed" ? (
        <section className={styles.card}>
          <div className={styles.cardBody}>
            <p className={styles.error}>{planId && !proven ? word("signInToSave") : word("couldNotLoad")}</p>
            {planId && !proven && address ? (
              <div className={styles.actions}>
                <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
                  {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : !draft || !planAsset || (!tokenAsset && (!row || !rep)) ? (
        <section className={styles.card}>
          <div className={styles.cardBody}>
            <p className={styles.muted} aria-busy="true">
              {word("assetLoadingAny")}
            </p>
          </div>
        </section>
      ) : (
        <div className={styles.builder}>
          <form
            className={styles.card}
            onSubmit={(event) => {
              event.preventDefault();
              void submit(existing ? "version" : "draft");
            }}
          >
            {/* The asset, as the desk lists it: the picture, the symbol, the price it trades at and the issuer's reference — or, for a token (1.7.0), the catalogue's own words and the market indication as planning context. */}
            {tokenAsset || !row || !rep ? (
            <div className={styles.assetStrip} data-kind={planAssetKind(planAsset)}>
              <MarketIcon mint={planAsset.mint} icon={asset.asset?.market?.icon ?? null} symbol={planAsset.symbol} size={40} className={styles.assetIcon} />
              <div className={styles.assetText}>
                <b translate="no">{planAsset.symbol}</b>
                <span className={styles.muted}>
                  {planAsset.underlying.name ?? planAsset.symbol} · {kindWord} · {word("verifiedOnJupiter")}
                </span>
              </div>
              <div className={styles.assetPrices}>
                <span className={styles.assetPrice} translate="no">
                  {planningPrice ? fmtUsd(planningPrice.perUnit, locale) : "—"}
                  <span className={styles.assetPriceUnit}>{` · ${word("tokenPrice").toLowerCase()}`}</span>
                </span>
                <span className={styles.assetRef} translate="no" data-testid="builder-indication">
                  {planningLine}
                  {asset.asset?.read.liquidityUsd != null ? ` · ${word("liquidity")} ${fmtUsd(asset.asset.read.liquidityUsd, locale, 0)}` : ""}
                  {asset.asset?.market?.change24hPct != null ? ` · ${word("changeDay")} ${asset.asset.market.change24hPct >= 0 ? "+" : ""}${asset.asset.market.change24hPct.toFixed(1)}%` : ""}
                </span>
              </div>
            </div>
            ) : (
            <div className={styles.assetStrip}>
              <MarketIcon mint={rep.mint} icon={row.market.icon} symbol={rep.symbol} size={40} className={styles.assetIcon} />
              <div className={styles.assetText}>
                <b translate="no">{rep.symbol}</b>
                <span className={styles.muted}>
                  {rep.underlying.name ?? rep.underlying.symbol} · {rep.issuer.label}
                </span>
              </div>
              <div className={styles.assetPrices}>
                <span className={styles.assetPrice} translate="no">
                  {row.tokenPerShareUsd !== null ? fmtUsd(row.tokenPerShareUsd, locale) : fmtUsd(row.market.priceUsd, locale)}
                  <span className={styles.assetPriceUnit}>{row.tokenPerShareUsd !== null ? word("perShareShort") : ` · ${word("tokenPrice").toLowerCase()}`}</span>
                </span>
                {/* A pre-IPO row names the issuer's mark and the token's premium to it, so the bound is written knowingly; a listed row its reference. */}
                {row.issuerMark?.perUnit != null ? (
                  <span className={styles.assetRef} translate="no" data-testid="builder-mark">
                    {word("issuerMark")} {fmtUsd(row.issuerMark.perUnit, locale)}
                    {row.markPremiumPct !== null ? ` · ${row.markPremiumPct >= 0 ? "+" : ""}${row.markPremiumPct.toFixed(1)}% ${word("vsMark")}` : ""}
                    {row.companyIndex?.valueUsd != null ? ` · ${word("companyIndex")} ${fmtUsd(row.companyIndex.valueUsd, locale)}` : ""}
                  </span>
                ) : (
                <span className={styles.assetRef} translate="no">
                  {word("reference")} {row.reference.perShare === null ? "—" : fmtUsd(row.reference.perShare, locale)}
                  {row.reference.perShare !== null && row.reference.state !== "current" ? ` · ${row.reference.state === "last-available" ? (locale === "uk" ? "останній" : "last available") : row.reference.state === "confirmed-close" ? (locale === "uk" ? "закриття" : "close") : row.reference.state}` : ""}
                </span>
                )}
              </div>
            </div>
            )}
            {tokenAsset ? <p className={styles.hint}>{word("planningPriceNote")}</p> : null}

            {/* 1 · Why */}
            <div className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.stepNumber} aria-hidden="true">
                  1
                </span>
                <h2>{word("stepWhy")}</h2>
              </div>
              <Field label={word("thesisText")} issue={issueOf("thesis")}>
                <textarea value={draft.thesis} onChange={(e) => set("thesis", e.target.value)} maxLength={2000} required placeholder={word("thesisPlaceholder")} />
              </Field>
              <details className={styles.more}>
                <summary>{word("moreThesis")}</summary>
                <div className={styles.fields}>
                  <Field className={styles.wide} label={word("whyNow")}>
                    <input value={draft.whyNow} onChange={(e) => set("whyNow", e.target.value)} maxLength={500} />
                  </Field>
                  <Field label={word("horizon")} topic="horizon" locale={locale}>
                    <select value={draft.horizonUnit} onChange={(e) => set("horizonUnit", e.target.value as Draft["horizonUnit"])}>
                      <option value="none">{word("noHorizon")}</option>
                      <option value="days">{word("days")}</option>
                      <option value="weeks">{word("weeks")}</option>
                      <option value="months">{word("months")}</option>
                    </select>
                  </Field>
                  <Field label={word("horizonCount")} issue={issueOf("horizonValue")}>
                    <input value={draft.horizonValue} onChange={(e) => set("horizonValue", e.target.value)} inputMode="numeric" disabled={draft.horizonUnit === "none"} />
                  </Field>
                  <Field className={styles.wide} label={word("sources")} issue={issueOf("sources")}>
                    <textarea value={draft.sources} onChange={(e) => set("sources", e.target.value)} />
                  </Field>
                  <Field className={styles.wide} label={word("assumptions")}>
                    <textarea value={draft.assumptions} onChange={(e) => set("assumptions", e.target.value)} />
                  </Field>
                </div>
              </details>
            </div>

            {/* 2 · Money — the person's figures, never prefilled */}
            <div className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.stepNumber} aria-hidden="true">
                  2
                </span>
                <h2>{word("stepMoney")}</h2>
              </div>
              <div className={styles.fields}>
                <Field label={`${word("budgetLabel")}, $`} topic="budget" locale={locale} issue={issueOf("budget")} hint={reading(draft.budget, "usd") ?? (draft.reserve ? `${fmtUsd(num(draft.reserve), locale)} ${word("keptAuto")} · ${word("budgetHint")}` : word("budgetHint"))}>
                  <input value={draft.budget} onChange={(e) => set("budget", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label={`${word("riskLabel")}, $`} topic="plannedRisk" locale={locale} issue={issueOf("plannedRisk")} hint={reading(draft.plannedRisk, "usd") ?? word("riskHint")}>
                  <input value={draft.plannedRisk} onChange={(e) => set("plannedRisk", e.target.value)} inputMode="decimal" />
                </Field>
              </div>
            </div>

            {/* 3 · Prices */}
            <div className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.stepNumber} aria-hidden="true">
                  3
                </span>
                <h2>{word("stepPrices")}</h2>
                <span className={styles.stepUnit}>{word("perShareUnit")}</span>
              </div>
              <div className={`${styles.fields} ${styles.fieldsThree}`}>
                <Field label={word("entryLabel")} topic="plannedEntry" locale={locale} issue={issueOf("entryPrice")} hint={reading(draft.entryPrice, "usd") ?? entryHint}>
                  <input value={draft.entryPrice} onChange={(e) => set("entryPrice", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label={word("invalidationLabel")} topic="invalidation" locale={locale} issue={issueOf("invalidation")} hint={reading(draft.invalidation, "usd") ?? word("invalidationHint")}>
                  <input value={draft.invalidation} onChange={(e) => set("invalidation", e.target.value)} inputMode="decimal" placeholder={invalidationExample} />
                </Field>
                {/* The bound and its own switch, together: what is limited stands beside what limits it. */}
                <div className={styles.fieldGroup}>
                  <Field label={word("maxPriceLabel")} topic="maxPrice" locale={locale} issue={issueOf("maxPrice")} hint={draft.maxPriceOn ? (reading(draft.maxPrice, "usd") ?? word("maxPriceHint")) : word("noMaxPrice")}>
                    <input value={draft.maxPrice} onChange={(e) => set("maxPrice", e.target.value)} inputMode="decimal" disabled={!draft.maxPriceOn} />
                  </Field>
                  <label className={styles.checkbox}>
                    <input type="checkbox" checked={draft.maxPriceOn} onChange={(e) => set("maxPriceOn", e.target.checked)} />
                    {word("limitPrice")}
                  </label>
                </div>
              </div>
            </div>

            {/* 4 · Conditions on what the market did — the person's own rules on observations, judged again by the server at the Review. */}
            <div className={styles.step}>
              <div className={styles.stepHead}>
                <span className={styles.stepNumber} aria-hidden="true">
                  4
                </span>
                <h2>
                  <HelpLabel topic="evidenceCondition" locale={locale}>
                    {word("stepEvidence")}
                  </HelpLabel>
                </h2>
              </div>
              <p className={styles.hint}>{word("evidenceLead")}</p>
              {draft.conditions.length === 0 ? <p className={styles.muted}>{word("evidenceNone")}</p> : null}
              {draft.conditions.map((condition, index) => {
                const metric = evidenceMetric(condition.metric);
                const read = reads[condition.window];
                const issue = conditionIssue(index);
                const cohort = metric?.aggregation === "cohort";
                const flag = metric?.unit === "flag";
                const unit = metric?.unit ?? "usd";
                const thresholdKind = unit === "usd" ? "usd" : unit === "percent" ? "pct" : "plain";
                const thresholdSuffix = unit === "usd" ? ", $" : unit === "percent" ? ", %" : "";
                const threshold = num(condition.threshold);
                const sentence = metric && Number.isFinite(threshold) ? conditionSentence({ metric: metric.id, window: condition.window, operator: condition.operator, threshold }, locale) : null;
                const judged = metric && Number.isFinite(threshold) && read && read !== "loading" ? judgeEvidenceCondition({ metric: metric.id, window: condition.window, operator: condition.operator, threshold, mode: condition.mode, onUnknown: condition.mode === "required" ? "block" : "warn" }, read, Date.now()) : null;
                const figure = read && read !== "loading" && read.snapshot ? (read.snapshot.metrics.find((entry) => entry.id === condition.metric) ?? null) : null;
                const nowLine =
                  read === "loading" || read === undefined
                    ? word("evidenceReading")
                    : figure && figure.value !== null && read.snapshot
                      ? `${word("evidenceNow")} ${fmtByUnit(figure.value, unit, locale)} · ${word("evidenceAsked")} ${fmtClock(read.snapshot.fetchedAt, locale)}${judged ? ` · ${judged.outcome === "pass" ? word("evidenceMet") : judged.outcome === "fail" ? word("evidenceNotMet") : word("evidenceUnknownNow")}` : ""}`
                      : word("evidenceNowUnknown");
                /* A metric from the other provider changes the window with it (a structural figure has only `now`), and an authority is a state, not a number: its rule is renounced (at most 0) or present (at least 1). */
                const pickMetric = (id: string) => {
                  const next = evidenceMetric(id);
                  if (!next) return;
                  const window = (next.windows as readonly string[]).includes(condition.window) ? condition.window : next.windows[0];
                  const toFlag = next.unit === "flag";
                  const fromFlag = metric?.unit === "flag";
                  setCondition(index, {
                    metric: next.id,
                    window,
                    mode: next.conditionModes.includes(condition.mode) ? condition.mode : "advisory",
                    ...(toFlag ? { operator: "lte", threshold: "0" } : fromFlag ? { operator: "gte", threshold: "" } : {}),
                  });
                };
                return (
                  <div key={index} className={styles.conditionRow} data-issue={issue ? "true" : "false"}>
                    <div className={`${styles.fields} ${styles.conditionFields}`} data-flag={flag ? "true" : "false"}>
                      <Field label={word("evidenceMetric")}>
                        <select value={condition.metric} onChange={(e) => pickMetric(e.target.value)}>
                          <optgroup label={word("evidenceGroupMarket")}>
                            {EVIDENCE_METRICS.filter((entry) => entry.provider === "nansen").map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.words[locale].label}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label={word("evidenceGroupStructure")}>
                            {EVIDENCE_METRICS.filter((entry) => entry.provider === "ddxyz").map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.words[locale].label}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </Field>
                      <Field label={word("evidenceWindow")}>
                        <select value={condition.window} onChange={(e) => setCondition(index, { window: e.target.value as EvidenceWindow })} disabled={(metric?.windows.length ?? 2) < 2}>
                          {(metric?.windows ?? ["24h", "7d"]).map((window) => (
                            <option key={window} value={window}>
                              {windowWord(window, locale)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {flag ? (
                        <Field label={word("evidenceState")} hint={nowLine}>
                          <select value={condition.operator === "gte" ? "present" : "renounced"} onChange={(e) => setCondition(index, e.target.value === "present" ? { operator: "gte", threshold: "1" } : { operator: "lte", threshold: "0" })}>
                            <option value="renounced">{fmtByUnit(0, "flag", locale)}</option>
                            <option value="present">{fmtByUnit(1, "flag", locale)}</option>
                          </select>
                        </Field>
                      ) : (
                        <Field label={word("evidenceOperator")}>
                          <select value={condition.operator} onChange={(e) => setCondition(index, { operator: e.target.value as EvidenceOperator })}>
                            {(["gte", "gt", "lte", "lt"] as const).map((operator) => (
                              <option key={operator} value={operator}>
                                {operatorWord(operator, locale)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      <Field label={`${word("evidenceThreshold")}${thresholdSuffix}`} issue={issue} hint={flag ? nowLine : (reading(condition.threshold, thresholdKind) ?? nowLine)}>
                        {flag ? <input value={fmtByUnit(condition.operator === "gte" ? 1 : 0, "flag", locale)} readOnly tabIndex={-1} aria-hidden="true" /> : <input value={condition.threshold} onChange={(e) => setCondition(index, { threshold: e.target.value })} inputMode={unit === "wallets" || unit === "count" ? "numeric" : "decimal"} />}
                      </Field>
                      <Field label={word("evidenceMode")} hint={cohort ? (metric?.provider === "ddxyz" ? word("evidenceLabelNote") : word("evidenceCohortNote")) : null}>
                        <select value={condition.mode} onChange={(e) => setCondition(index, { mode: e.target.value as ConditionDraft["mode"] })} disabled={cohort}>
                          <option value="advisory">{word("evidenceWarn")}</option>
                          {!cohort ? <option value="required">{word("evidenceRequire")}</option> : null}
                        </select>
                      </Field>
                    </div>
                    <div className={styles.conditionFoot}>
                      <span className={styles.conditionSentence}>{sentence ? `${word("evidenceRule")}: ${sentence} · ${condition.mode === "required" ? word("evidenceRequireShort") : word("evidenceWarnShort")}` : word("evidenceThreshold")}</span>
                      <button type="button" className={styles.conditionRemove} onClick={() => removeCondition(index)}>
                        {word("removeEvidence")}
                      </button>
                    </div>
                  </div>
                );
              })}
              {draft.conditions.length < 10 ? (
                <div className={styles.actions}>
                  <button type="button" className="rw-btn" onClick={addCondition}>
                    {word("addEvidence")}
                  </button>
                </div>
              ) : null}
            </div>

            {/* Everything else, with its defaults, one click deep. Collapsing keeps every value — nothing here is switched off by folding it. */}
            <details className={`${styles.more} ${styles.moreRules}`}>
              <summary>
                {word("moreRules")}
                <span className={styles.moreSub}>{word("moreRulesSub")}</span>
              </summary>
              <div className={styles.fields}>
                <Field label={word("validUntil")} topic="validUntil" locale={locale} issue={issueOf("validUntil")} hint={draft.validUntil ? utcOf(draft.validUntil) : word("noValidUntil")}>
                  <input type="datetime-local" value={draft.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
                </Field>
                <Field label={word("reserve")} topic="budget" locale={locale} issue={issueOf("reserve")} hint={reading(draft.reserve, "usd")}>
                  <input value={draft.reserve} onChange={(e) => set("reserve", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label={word("costBuffer")} topic="costBuffer" locale={locale} issue={issueOf("costBufferPct")} hint={reading(draft.costBufferPct, "pct")}>
                  <input value={draft.costBufferPct} onChange={(e) => set("costBufferPct", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label={word("target")} topic="target" locale={locale} issue={issueOf("target")} hint={reading(draft.target, "usd")}>
                  <input value={draft.target} onChange={(e) => set("target", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label={word("timeExit")} topic="timeExit" locale={locale} issue={issueOf("timeExit")} hint={draft.timeExit ? utcOf(draft.timeExit) : null}>
                  <input type="datetime-local" value={draft.timeExit} onChange={(e) => set("timeExit", e.target.value)} />
                </Field>
                <Field label={word("maxSlippage")} topic="maxSlippage" locale={locale} issue={issueOf("maxSlippagePct")} hint={reading(draft.maxSlippagePct, "pct")}>
                  <input value={draft.maxSlippagePct} onChange={(e) => set("maxSlippagePct", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label={word("maxQuoteAge")} topic="maxQuoteAge" locale={locale} issue={issueOf("maxQuoteAge")}>
                  <input value={draft.maxQuoteAge} onChange={(e) => set("maxQuoteAge", e.target.value)} inputMode="numeric" />
                </Field>
                {!tokenAsset ? (
                <div className={styles.fieldGroup}>
                  <Field label={word("maxDeviation")} topic="maxDeviation" locale={locale} issue={issueOf("maxDeviationPct")} hint={draft.deviationOn ? reading(draft.maxDeviationPct, "pct") : word("noDeviationBound")}>
                    <input value={draft.maxDeviationPct} onChange={(e) => set("maxDeviationPct", e.target.value)} inputMode="decimal" disabled={!draft.deviationOn} />
                  </Field>
                  <label className={styles.checkbox}>
                    <input type="checkbox" checked={draft.deviationOn} onChange={(e) => set("deviationOn", e.target.checked)} />
                    {word("checkDeviation")}
                  </label>
                </div>
                ) : null}
                <Field label={word("minLiquidity")} topic="minLiquidity" locale={locale} issue={issueOf("minLiquidity")} hint={reading(draft.minLiquidity, "usd")}>
                  <input value={draft.minLiquidity} onChange={(e) => set("minLiquidity", e.target.value)} inputMode="decimal" />
                </Field>
                {!tokenAsset ? (
                <label className={styles.checkbox}>
                  <input type="checkbox" checked={draft.referenceRequired} onChange={(e) => set("referenceRequired", e.target.checked)} />
                  {word("referenceRequired")}
                </label>
                ) : (
                <p className={`${styles.hint} ${styles.wide}`}>{word("noReferenceForToken")}</p>
                )}
              </div>
            </details>

            <div className={styles.step}>
              {existing ? (
                <Field label={word("reason")}>
                  <input value={draft.reason} onChange={(e) => set("reason", e.target.value)} maxLength={240} />
                </Field>
              ) : null}
              {/* The check, right above the buttons: a contradiction between rules is named at once; a field not yet written is waited for. */}
              <div className={styles.check} data-ok={checkState === "pass" ? "true" : checkState === "fail" ? "false" : "waiting"}>
                <p className={styles.checkLead}>{checkState === "pass" ? word("checkPasses") : checkState === "fail" ? word("checkFails") : word("checkWaiting")}</p>
                {checkState === "fail" ? (
                  <ul className={styles.list}>
                    {checkIssues.map((issue) => (
                      <li key={issue.path + issue.message}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {save.status === "failed" && save.message ? <p className={styles.error}>{save.message}</p> : null}
              {!proven ? (
                <div className={styles.actions}>
                  <p className={styles.muted}>{word("signInToSave")}</p>
                  {address ? (
                    <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
                      {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
                    </button>
                  ) : null}
                </div>
              ) : existing ? (
                <div className={styles.actions}>
                  <button type="submit" className="rw-btn rw-btn--primary" disabled={!outcome?.sizing || save.status === "saving"}>
                    {save.status === "saving" ? word("saving") : word("saveVersion")}
                  </button>
                </div>
              ) : (
                <div className={styles.actions}>
                  <button type="submit" className="rw-btn" disabled={!outcome?.sizing || save.status === "saving"}>
                    {save.status === "saving" ? word("saving") : word("saveDraft")}
                  </button>
                  <button type="button" className="rw-btn rw-btn--primary" disabled={!outcome?.sizing || save.status === "saving"} onClick={() => void submit("activate")}>
                    {word("activate")}
                  </button>
                </div>
              )}
              {/* A disabled button says what it waits for; an enabled Activate says what it does not do. */}
              {proven && !outcome?.sizing && missing.length > 0 ? (
                <p className={styles.hint} role="status">
                  {word("stillNeeded")} {missing.join(" · ")}
                </p>
              ) : proven && !existing ? (
                <p className={styles.hint}>{word("activateNote")}</p>
              ) : null}
            </div>
          </form>

          {/* One card: the plan estimate at the planning price, and what the model says you can lose. */}
          <aside className={styles.aside}>
            <section className={`${styles.card} ${styles.buyCard}`} aria-label={word("youBuy")}>
              <div className={styles.cardHead}>
                <h2>
                  <HelpLabel topic="size" locale={locale}>
                    {word("youBuy")}
                  </HelpLabel>
                </h2>
                <span className={styles.cardHeadSpacer} />
                {preview ? (
                  <span className={styles.muted} translate="no">
                    {word("atPlanningPrice")} {fmtUsd(preview.rules.entry.pricePerShare, locale)}
                  </span>
                ) : null}
              </div>
              <div className={styles.cardBody}>
                {preview ? (
                  <>
                    <div className={styles.buyBig}>
                      <b translate="no">
                        {fmtUnits(preview.sizing.units, locale)} {symbolUnderlying}
                      </b>
                      <span translate="no">≈ {fmtUsd(preview.sizing.notionalUsd, locale)}</span>
                    </div>
                    <span className={styles.buyChip}>{preview.sizing.limitedBy === "risk" ? word("limitedByRisk") : word("limitedByCapital")}</span>
                    <ul className={styles.buyFacts}>
                      <li>
                        {word("lossIfPrefix")} <b translate="no">{fmtUsd(preview.rules.risk.invalidationPerShare, locale)}</b>, {word("lossIfSuffix")}{" "}
                        <b translate="no">{fmtUsd(preview.sizing.units * preview.sizing.lossPerShareUsd, locale)}</b>
                        <Help topic="plannedRisk" locale={locale} />
                      </li>
                      <li>
                        {word("costsModelled")} <b translate="no">{(preview.rules.risk.costBufferBps / 100).toFixed(2)}%</b>
                        <Help topic="costBuffer" locale={locale} />
                      </li>
                      <li>
                        {word("validUntil")} <b translate="no">{preview.rules.entry.validUntil ? fmtWhen(preview.rules.entry.validUntil, locale) : word("noValidUntil")}</b>
                        <Help topic="validUntil" locale={locale} />
                      </li>
                      {preview.rules.evidenceConditions.map((condition, index) => (
                        <li key={`condition-${index}`}>
                          {conditionSentence(condition, locale)}
                          {condition.mode === "required" ? ` · ${word("evidenceRequireShort")}` : ""}
                          {index === 0 ? <Help topic="evidenceCondition" locale={locale} /> : null}
                        </li>
                      ))}
                    </ul>
                    <p className={styles.footnote}>{word("modelNote")}</p>
                  </>
                ) : (
                  <p className={styles.muted}>{estimateMissing.length > 0 ? `${word("stillNeeded")} ${estimateMissing.join(" · ")}` : word("fillTheRules")}</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

/**
 * Which asset the plan is for — one field over the confirmed stock universe
 * (`/api/stocks/universe?shape=slim&q=`, the same match the Stocks page
 * searches) and the Spot catalogue's verified crypto and memes
 * (`/api/spot/markets?q=`, 1.7.0), eight of each at a time, a press carries
 * the mint into the address. An unverified copy is not offered: the server
 * would refuse it, and the picker says only what a plan can name.
 */
type PickRow = Readonly<{ mint: string; symbol: string; name: string; icon: string | null; price: number | null; sub: string }>;

function AssetPicker({ locale, note, onPick }: { locale: WorkspaceLocale; note: string | null; onPick: (mint: string) => void }) {
  const word = planWordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ status: "idle" | "searching" | "ready" | "failed"; stocks: readonly PickRow[]; tokens: readonly PickRow[] }>({ status: "idle", stocks: [], tokens: [] });
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResult({ status: "idle", stocks: [], tokens: [] });
      return;
    }
    let live = true;
    setResult((current) => ({ ...current, status: "searching" }));
    const timer = window.setTimeout(() => {
      const term = encodeURIComponent(q.slice(0, 64));
      const stocks = fetch(`/api/stocks/universe?shape=slim&q=${term}&limit=8`, { headers: { accept: "application/json" } })
        .then(async (response) => (response.ok ? ((await response.json()) as { rows: SlimStockRow[] }).rows : null))
        .catch(() => null);
      const tokens = fetch(`/api/spot/markets?q=${term}&limit=16`, { headers: { accept: "application/json" } })
        .then(async (response) => (response.ok ? ((await response.json()) as { rows: SpotMarketListRow[] }).rows : null))
        .catch(() => null);
      Promise.all([stocks, tokens]).then(([stockRows, tokenRows]) => {
        if (!live) return;
        if (stockRows === null && tokenRows === null) {
          setResult({ status: "failed", stocks: [], tokens: [] });
          return;
        }
        const kindWords = { crypto: word("kindCrypto"), meme: word("kindMeme") };
        setResult({
          status: "ready",
          stocks: (stockRows ?? []).map((row) => ({ mint: row.mint, symbol: row.symbol, name: row.name, icon: row.icon, price: row.price, sub: `${row.name} · ${ISSUER_SHORT[row.issuer]}` })),
          /* Only what a plan can name: the venue's verified list, a crypto or a meme, never a stock tag (a stock is confirmed by its issuer above), never a copy flagged suspicious. */
          tokens: (tokenRows ?? [])
            .filter((row) => row.verified && !row.suspicious && (row.category === "crypto" || row.category === "meme"))
            .slice(0, 8)
            .map((row) => ({ mint: row.mint, symbol: row.symbol, name: row.name, icon: row.icon, price: row.price, sub: `${row.name} · ${kindWords[row.category as "crypto" | "meme"]} · ${word("verifiedOnJupiter")}` })),
        });
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a pure function of the locale; the search re-runs on the query alone
  }, [query]);
  const rows = result.stocks.length + result.tokens.length;
  const group = (label: string, list: readonly PickRow[]) =>
    list.length === 0 ? null : (
      <li key={label} className={styles.pickGroup}>
        <span className={styles.pickGroupLabel}>{label}</span>
        <ul className={styles.pickList}>
          {list.map((row) => (
            <li key={row.mint}>
              <button type="button" className={styles.pickRow} onClick={() => onPick(row.mint)}>
                <MarketIcon mint={row.mint} icon={row.icon} symbol={row.symbol} size={32} className={styles.pickIcon} />
                <span className={styles.pickText}>
                  <b translate="no">{row.symbol}</b>
                  <span className={styles.muted}>{row.sub}</span>
                </span>
                <span className={styles.pickPrice} translate="no">
                  {row.price === null ? "—" : fmtUsd(row.price, locale)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </li>
    );
  return (
    <section className={styles.card} aria-label={word("pickAssetAny")}>
      <div className={styles.cardBody}>
        {note ? <p className={styles.muted}>{note}</p> : null}
        <label className={styles.field}>
          <span>{word("pickAssetAny")}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={word("searchAssets")} autoComplete="off" spellCheck={false} autoFocus lang={numberLocale} />
          <span className={styles.hint}>{word("startFromAsset")}</span>
        </label>
        {result.status === "failed" ? (
          <p className={styles.error}>{word("pickerUnavailable")}</p>
        ) : result.status === "searching" && rows === 0 ? (
          <p className={styles.muted} aria-busy="true">
            {word("searching")}
          </p>
        ) : result.status === "ready" && rows === 0 ? (
          <p className={styles.muted}>{word("noMatches")}</p>
        ) : rows > 0 ? (
          <ul className={styles.pickGroups} data-stale={result.status === "searching" ? "true" : "false"}>
            {group(word("pickGroupStocks"), result.stocks)}
            {group(word("pickGroupTokens"), result.tokens)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Field({ label, topic, locale, issue, hint, className, children }: { label: string; topic?: HelpTopicId; locale?: WorkspaceLocale; issue?: string | null; hint?: string | null; className?: string; children: React.ReactNode }) {
  return (
    <label className={`${styles.field}${className ? ` ${className}` : ""}`} data-issue={issue ? "true" : "false"}>
      {topic && locale ? (
        <HelpLabel topic={topic} locale={locale}>
          {label}
        </HelpLabel>
      ) : (
        <span>{label}</span>
      )}
      {children}
      {issue ? <span className={styles.issue}>{issue}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  );
}
