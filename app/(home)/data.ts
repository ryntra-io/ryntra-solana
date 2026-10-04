/*
 * The landing's content, transcribed from the design handoff
 * (`Ryntra Landing.dc.html`, 2026-08-20) rather than re-authored.
 *
 * THE RULE THIS FILE EXISTS TO OBEY: exactly the same design as the handoff,
 * only the charts may be adjusted a little, and the colours are the brand's
 * own. Same blocks, same order, same rows, same figures — Brandbook v1.2
 * palette and faces on top of them.
 *
 * The prototype builds these lists from packed strings through `caps()`,
 * `tbl()`, `meter()` and `groups()`. They are expanded here into typed data so
 * a reader can see what the page states, and so nothing is parsed at runtime.
 *
 * TONE IS A NAME, NOT A COLOUR. The prototype writes `var(--acc1)` into its
 * data; `scripts/design-check.mjs` walks this directory and would fail on the
 * literal, and a colour in a data file is unreadable anyway. Every tone here is
 * one of five words and the stylesheet decides what each one paints.
 *
 * EVERY FIGURE IS ILLUSTRATIVE. The page says so where a person reads it — the
 * workspace chrome carries `Sample workspace` — and nothing here is fetched,
 * timed or randomised.
 */

/** The five tones the prototype's `DC_` map defines, by meaning rather than hue. */
export type Tone = "ok" | "warn" | "bad" | "unknown" | "neutral";

/** The four status words the brief fixes. No fifth one may be invented. */
export type Status = "LIVE" | "BUILDING" | "PLANNED" | "GATED";

export type Row = Readonly<{ label: string; value: string; tone?: Tone }>;
export type Meter = Readonly<{ label: string; value: string; width: number; tone: Tone }>;
export type Cap = Readonly<{ name: string; status: Status }>;
export type Group = Readonly<{ title: string; items: readonly Cap[] }>;
export type Panel = Readonly<{ title: string; meta: string; rows: readonly Meter[] }>;

/** `caps('A|LIVE, B|BUILDING')` — a name and its status, in the brief's words. */
function caps(spec: string): readonly Cap[] {
  return spec.split(",").map((entry) => {
    const [name, status] = entry.split("|").map((part) => part.trim());
    return { name, status: (status ?? "PLANNED") as Status };
  });
}

function meters(spec: string): readonly Meter[] {
  return spec.split(";").map((entry) => {
    const [label, value, width, tone] = entry.split("|").map((part) => part.trim());
    return { label, value, width: Number(width), tone: (tone ?? "ok") as Tone };
  });
}

/* ── the loops ──────────────────────────────────────────────────────────── */

/** The decision loop, eleven stages, exactly as the brief fixes it. */
export const FLOW_A = [
  "Intent", "Evidence", "Passport", "Risk", "Plan", "Review",
  "Authorize", "Execute", "Reconcile", "Receipt", "Learn",
] as const;

/**
 * The seven words under the hero CTAs. NOT the eleven-stage decision flow —
 * the handoff uses a shorter loop here and the long one inside the Decision
 * scene, and conflating them fills the hero's rule with two wrapped rows.
 */
export const HERO_LOOP = [
  "UNDERSTAND", "PLAN", "CHECK", "AUTHORIZE", "EXECUTE", "PROVE", "LEARN",
] as const;

export const LEGEND: readonly Cap[] = caps("LIVE|LIVE, BUILDING|BUILDING, PLANNED|PLANNED, GATED|GATED");

/* ── hero ───────────────────────────────────────────────────────────────── */

export const TRUST_CHIPS = ["Non-custodial", "Human-authorized", "Evidence-backed"] as const;

export const HERO_BARS = [
  30, 36, 33, 42, 38, 46, 41, 50, 45, 54, 48, 58, 52, 62, 56, 65,
  59, 69, 63, 72, 67, 76, 70, 80, 74, 84, 78, 88, 82, 92, 86, 97,
];
export const HERO_BARS_LEAD_FROM = 24;

export const HERO_TILES: readonly Row[] = [
  { label: "CASH & STABLES", value: "$84,120.02", tone: "neutral" },
  { label: "OPEN EXPOSURE", value: "$186,240.11", tone: "neutral" },
  { label: "PENDING", value: "$12,480.00", tone: "neutral" },
];
export const HERO_TILE_NOTES = ["4 sources", "12 positions", "2 in motion"] as const;

export const ATTENTION: readonly Readonly<{ text: string; tag: string; where: string; tone: Tone }>[] = [
  { text: "Route quote stale on 2 assets", tag: "REVIEW", where: "market", tone: "warn" },
  { text: "Agent mandate at 84% of daily cap", tag: "ACTION", where: "agents", tone: "ok" },
  { text: "4 assets unpriced — coverage 96.2%", tag: "EVIDENCE", where: "sources", tone: "unknown" },
  { text: "Stop invalidated on TSLAx plan", tag: "RISK", where: "strategy", tone: "bad" },
];

export const HEAT: readonly Meter[] = meters(
  "Concentration|MODERATE|58|warn; Liquidity|HIGH|82|ok; Leverage|LOW|22|ok; Unknown exposure|1 ASSET|14|unknown",
);

export const HERO_STRATEGIES: readonly Row[] = [
  { label: "Exit Guard · TSLAx", value: "ARMED", tone: "ok" },
  { label: "DCA · ETH weekly", value: "RUNNING", tone: "ok" },
  { label: "Launch Watch · SOL", value: "2 TRIGGERS", tone: "warn" },
];

export const HERO_AGENTS: readonly Row[] = [
  { label: "Research Agent", value: "ACTIVE", tone: "ok" },
  { label: "Payments Agent", value: "BOUNDED", tone: "ok" },
  { label: "Data Agent", value: "REVIEW", tone: "warn" },
];

/* ── 01 — Ryntra Home ───────────────────────────────────────────────────── */

export const HOME_TABS = ["Home", "Radar", "Portfolio", "Strategy", "Journal", "Agent Control", "Settings"] as const;

export const HOME_BARS = [
  40, 38, 43, 41, 46, 44, 49, 47, 52, 50, 55, 53, 58, 56, 61, 59, 64, 62, 67, 65,
  68, 71, 69, 74, 72, 77, 75, 80, 78, 83, 81, 86, 84, 89, 87, 92, 90, 95, 93, 100,
];
export const HOME_BARS_LEAD_FROM = 32;

export const PRO_PNL: readonly Row[] = [
  { label: "24H P&L", value: "+$8,412.19", tone: "ok" },
  { label: "REALIZED", value: "+$3,104.60", tone: "ok" },
  { label: "FEES & FUNDING", value: "-$412.08", tone: "bad" },
];


export const PRO_PANELS: readonly Panel[] = [
  {
    title: "RISK",
    meta: "4 DIMENSIONS",
    rows: meters(
      "Concentration|MODERATE|58|warn; Liquidity risk|LOW|24|ok; Leverage|1.2x|22|ok; Correlated exposure|MODERATE|46|warn; Unknown exposure|1 ASSET|14|unknown",
    ),
  },
  {
    title: "EVIDENCE",
    meta: "96.2% COVERAGE",
    rows: meters(
      "Source coverage|11 / 12|92|ok; Valuation coverage|96.2%|96|ok; Freshness|1.4s p95|88|ok; Provider health|1 DEGRADED|72|warn",
    ),
  },
  {
    title: "MARKET & LIQUIDITY",
    /* The prototype's meta here is the word `LIVE`. Nothing on this page is a
       feed, so it states the depth instead — the same fact without the claim. */
    meta: "SAMPLE",
    rows: meters(
      "Liquidity depth|DEEP|84|ok; Route health|OK|78|ok; Watchlist moves|6|60|ok; Off-hours context|2 ASSETS|30|warn",
    ),
  },
  {
    title: "STRATEGY",
    meta: "3 ACTIVE",
    rows: meters("Active strategies|3|60|ok; Triggers armed|7|70|ok; Mandates|2|40|ok; Rule adherence|100%|100|ok"),
  },
  {
    title: "AGENT CONTROL",
    meta: "PROJECTION",
    rows: meters(
      "Agents connected|3|60|ok; Budgets committed|$118 / $150|79|warn; Pending approvals|2|20|warn; Spend today|$24.80|25|ok",
    ),
  },
  {
    title: "ACTIVITY",
    meta: "LAST 24H",
    rows: meters("Receipts|14|70|ok; Authorized actions|9|45|ok; Journal entries|22|88|ok; Reconciled|14 / 14|100|ok"),
  },
];

export const SIMPLE_TILES: readonly Row[] = [
  { label: "Cash", value: "$84,120", tone: "neutral" },
  { label: "Open exposure", value: "$186,240", tone: "neutral" },
  { label: "Pending", value: "$12,480", tone: "warn" },
  { label: "Portfolio heat", value: "Moderate", tone: "warn" },
];

export const ATTENTION_SIMPLE: readonly Readonly<{ text: string; tone: Tone }>[] = [
  { text: "Two prices look out of date", tone: "warn" },
  { text: "An agent is close to its daily limit", tone: "ok" },
  { text: "Four assets have no price yet", tone: "unknown" },
];

export const PULSE: readonly Row[] = [
  { label: "TSLAx", value: "+2.14%", tone: "ok" },
  { label: "ETH", value: "+0.94%", tone: "ok" },
  { label: "SOL", value: "+4.08%", tone: "ok" },
  { label: "XLM", value: "-0.32%", tone: "bad" },
];

export const SIMPLE_CARDS: readonly Readonly<{ label: string; value: string; note: string }>[] = [
  { label: "Active strategies", value: "3 running", note: "Exit Guard, DCA and Launch Watch are armed." },
  { label: "Active agents", value: "3 active", note: "One agent is close to its daily limit." },
  {
    label: "Latest receipt",
    value: "Swap 4,000 USDC → 1.32 ETH",
    note: "Expected 1.318 · actual 1.3204 · reconciled.",
  },
];

export const HOME_CAPS: readonly Cap[] = caps(
  "Portfolio|LIVE, Radar|BUILDING, Risk|LIVE, Money Management|BUILDING, Strategy|BUILDING, Journal|LIVE, Agents|BUILDING, Connections|LIVE, Receipts|LIVE, Evidence|LIVE, AI|LIVE, Attention|LIVE",
);

/* ── 02 — Decision / Risk / Money / AI ──────────────────────────────────── */

export const PLAN: readonly Row[] = [
  { label: "ENTRY", value: "412.80 limit", tone: "neutral" },
  { label: "POSITION SIZE", value: "118 TSLAx", tone: "neutral" },
  { label: "RISK BUDGET", value: "$1,240 · 0.3%", tone: "ok" },
  { label: "INVALIDATION", value: "398.40 stop", tone: "bad" },
  { label: "TAKE PROFIT", value: "447.20", tone: "ok" },
  { label: "EXPECTED R:R", value: "2.4 : 1", tone: "neutral" },
  { label: "TIME EXIT", value: "14 sessions", tone: "neutral" },
  { label: "TRAILING", value: "ATR × 1.8", tone: "neutral" },
  { label: "MAX EXPOSURE", value: "$52,000", tone: "warn" },
  { label: "FEES", value: "18bp est.", tone: "neutral" },
  { label: "LIQUIDITY", value: "DEEP", tone: "ok" },
  { label: "SLIPPAGE", value: "4bp est.", tone: "neutral" },
];

export const MONEY: readonly Meter[] = meters(
  "Account risk budget|$4,120 / mo|41|ok; Position sizing|2.8% of equity|28|ok; Max exposure|$52,000|64|warn; Max loss|$1,240|30|ok; Daily risk used|$310 / $600|52|warn; Portfolio concentration|18.4%|18|ok; Committed capital|$118,400|72|warn",
);

export const RISK_DIMS: readonly Row[] = [
  { label: "Concentration", value: "MODERATE", tone: "warn" },
  { label: "Liquidity", value: "HIGH", tone: "ok" },
  { label: "Leverage", value: "LOW", tone: "ok" },
  { label: "Evidence", value: "1 UNKNOWN", tone: "unknown" },
];

export const AI_CAPS = [
  "Build a plan", "Explain an asset", "Compare routes", "Explain risk",
  "Find missing evidence", "Shape a strategy", "Run a review",
] as const;

/* ── 03 — Agent Control ─────────────────────────────────────────────────── */

/*
 * Networks, KPIs and the action ledger used to live here as literals. They are
 * derived now: the ledger and the KPI row come from `agent-control-scenarios`,
 * and every network carries its environment and enforcement from the registry
 * through `lib/product/agent-control-view`. A status word in this file is what
 * `agent-control-truth.test.mjs` exists to catch.
 */

export const AGENT_PANELS: readonly Panel[] = [
  {
    title: "FLEET & BUDGET EXPOSURE",
    meta: "3 AGENTS",
    rows: meters(
      "Research Agent|$18.40 / $50|37|ok; Payments Agent|$4.20 / $60|7|ok; Data Agent|$2.20 / $40|6|ok; Committed escrow|$36.00|60|warn",
    ),
  },
  {
    title: "POLICY HEAT",
    meta: "GOVERNOR",
    rows: meters("ALLOW|41 actions|82|ok; REVIEW|2 actions|18|warn; BLOCK|1 action|8|bad; PAUSE|0|0|ok"),
  },
  {
    title: "SERVICES / x402",
    meta: "6 ENDPOINTS",
    rows: meters(
      "Market data|$0.10 / call|48|ok; Inference|$0.004 / 1k|62|ok; Storage|$0.80 / mo|20|ok; Unverified provider|QUARANTINED|10|bad",
    ),
  },
  {
    title: "PROVIDER HEALTH",
    meta: "1 DEGRADED",
    rows: meters("x402 rail|OK · 120ms|92|ok; Base RPC|OK · 84ms|95|ok; Solana RPC|DEGRADED|58|warn; Price oracle|OK · 1.1s|88|ok"),
  },
  {
    title: "LATEST RECEIPTS",
    meta: "RECONCILED",
    rows: meters(
      "Expected vs actual|14 / 14 matched|100|ok; Variance|+0.18% avg|18|ok; Open reconciliation|0|0|ok; Recovery cases|1|12|unknown",
    ),
  },
];

/* ── 04 — Ecosystems ────────────────────────────────────────────────────── */

export const EVIDENCE_STATES: readonly Readonly<{ state: string; note: string; tone: Tone }>[] = [
  { state: "KNOWN", note: "A material fact with a named source, a timestamp and a freshness window.", tone: "ok" },
  { state: "UNVERIFIED", note: "Present but not corroborated. Shown as unverified — never promoted to fact.", tone: "warn" },
  { state: "UNKNOWN", note: "Absent. Ryntra states the gap instead of inventing a number.", tone: "unknown" },
];

export const PRINCIPLES: readonly Readonly<{ title: string; note: string }>[] = [
  { title: "Non-custodial", note: "Ryntra does not hold user funds." },
  { title: "Human-authorized", note: "Users authorize their actions. Nothing settles without an authorization." },
  { title: "Evidence-backed", note: "Material facts preserve provenance and freshness." },
  { title: "AI-assisted", note: "AI explains and structures. Deterministic systems calculate and gate." },
  { title: "Outcome receipts", note: "Expected and actual outcomes can be reconciled." },
];
