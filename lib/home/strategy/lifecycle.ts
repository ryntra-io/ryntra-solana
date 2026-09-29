/**
 * The strategy lifecycle, as a table rather than as a paragraph.
 *
 * Home canon §10: *Strategy is versioned: Idea → Draft → Backtest → Forward
 * paper → Approved → Active → Review, plus Paused, Invalidated, Expired and
 * Archived where relevant. Material rule changes create a new version.*
 *
 * Written as prose that is a sequence somebody has to respect. Written here it
 * is a graph, and the two edges that matter most are the ones that **do not
 * exist**: `DRAFT → APPROVED` and `BACKTEST → ACTIVE`. Those are the shortcuts
 * a strategy takes when a curve looks good, and the canon's whole point is that
 * an in-sample curve is never proof. They are absent from the table, so they
 * cannot be taken by a caller in a hurry — only by editing this file beside the
 * test that names them.
 *
 * **A terminal state has no outgoing edge at all.** Expired and Archived are
 * ends. Reviving one would mean a strategy that was retired quietly becoming
 * live again with its old evidence attached.
 *
 * **Materiality is a list, not a judgement.** Renaming a strategy is not a rule
 * change; moving its stop is. `materialDiff` compares only the declared fields,
 * and treats a field that disappeared as a change — because "no stop" and "a 2%
 * stop" are different rules, and a diff that ignores absence would let one
 * become the other inside a version.
 */

export const STRATEGY_STATES = [
  "IDEA",
  "DRAFT",
  "BACKTEST",
  "FORWARD_PAPER",
  "APPROVED",
  "ACTIVE",
  "REVIEW",
  "PAUSED",
  "INVALIDATED",
  "EXPIRED",
  "ARCHIVED",
] as const;

export type StrategyState = (typeof STRATEGY_STATES)[number];

export const STRATEGY_TERMINAL_STATES = ["EXPIRED", "ARCHIVED"] as const;

export const STRATEGY_STATE_LABEL: Readonly<Record<StrategyState, string>> = {
  IDEA: "Idea",
  DRAFT: "Draft",
  BACKTEST: "Backtest",
  FORWARD_PAPER: "Forward paper",
  APPROVED: "Approved",
  ACTIVE: "Active",
  REVIEW: "Review",
  PAUSED: "Paused",
  INVALIDATED: "Invalidated",
  EXPIRED: "Expired",
  ARCHIVED: "Archived",
};

/**
 * The forward path, and the interruptions every live stage shares.
 *
 * `PAUSED` and `ARCHIVED` are reachable from everything that is not already an
 * end, because stopping and shelving are always available; `INVALIDATED` is
 * reachable from every stage that carries evidence, because evidence is what
 * gets invalidated.
 */
const FORWARD: Readonly<Record<StrategyState, readonly StrategyState[]>> = {
  IDEA: ["DRAFT"],
  DRAFT: ["BACKTEST"],
  BACKTEST: ["FORWARD_PAPER", "DRAFT"],
  FORWARD_PAPER: ["APPROVED", "BACKTEST"],
  APPROVED: ["ACTIVE", "REVIEW", "EXPIRED"],
  ACTIVE: ["REVIEW", "EXPIRED"],
  REVIEW: ["ACTIVE", "DRAFT", "EXPIRED"],
  PAUSED: ["ACTIVE", "REVIEW", "ARCHIVED"],
  INVALIDATED: ["DRAFT", "ARCHIVED"],
  EXPIRED: [],
  ARCHIVED: [],
};

const INTERRUPTIBLE: readonly StrategyState[] = [
  "IDEA",
  "DRAFT",
  "BACKTEST",
  "FORWARD_PAPER",
  "APPROVED",
  "ACTIVE",
  "REVIEW",
];

const EVIDENCE_BEARING: readonly StrategyState[] = ["BACKTEST", "FORWARD_PAPER", "APPROVED", "ACTIVE", "REVIEW"];

function edges(from: StrategyState): readonly StrategyState[] {
  if ((STRATEGY_TERMINAL_STATES as readonly StrategyState[]).includes(from)) return [];
  const out = new Set<StrategyState>(FORWARD[from]);
  if (INTERRUPTIBLE.includes(from)) {
    out.add("PAUSED");
    out.add("ARCHIVED");
  }
  if (EVIDENCE_BEARING.includes(from)) out.add("INVALIDATED");
  if (from === "PAUSED") out.add("ARCHIVED");
  return [...out];
}

export function strategyState(value: unknown): StrategyState {
  if (typeof value !== "string" || !(STRATEGY_STATES as readonly string[]).includes(value)) {
    throw new Error("Not a registered strategy state: " + String(value));
  }
  return value as StrategyState;
}

export function transitionsFrom(from: StrategyState): readonly StrategyState[] {
  return edges(strategyState(from));
}

export function canTransition(from: StrategyState, to: StrategyState): boolean {
  return transitionsFrom(from).includes(strategyState(to));
}

/**
 * The fields a change to which is a change to the rule.
 *
 * Deliberately narrow: everything here changes what the strategy would do.
 * Title, description and tags are not on the list, and a version bump for a
 * rename would make the version history unreadable at exactly the moment
 * somebody needs to find the change that mattered.
 */
export const STRATEGY_MATERIAL_FIELDS = [
  "assetClass",
  "symbol",
  "timeframe",
  "direction",
  "entry",
  "exit",
  "stopPercent",
  "takeProfitPercent",
  "riskPercent",
  "maxDrawdownPercent",
  "positionSizing",
  "commissionBps",
  "spreadBps",
  "slippageBps",
  "fundingBpsPerDay",
] as const;

export type StrategyMaterialField = (typeof STRATEGY_MATERIAL_FIELDS)[number];

type SpecLike = Readonly<Record<string, unknown>>;

/** Which declared rule fields differ. A field present on one side only counts. */
export function materialDiff(previous: SpecLike, next: SpecLike): readonly string[] {
  const changed: string[] = [];
  for (const field of STRATEGY_MATERIAL_FIELDS) {
    const before = previous[field];
    const after = next[field];
    const missingBefore = before === undefined || before === null;
    const missingAfter = after === undefined || after === null;
    if (missingBefore && missingAfter) continue;
    if (missingBefore !== missingAfter) {
      changed.push(field);
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(field);
  }
  return changed;
}

/**
 * What version this change belongs to.
 *
 * A material diff always advances. An immaterial one never does — so a rename
 * cannot create a version, and a rule change cannot hide inside one.
 */
export function nextVersionNumber(input: Readonly<{
  previous: SpecLike;
  next: SpecLike;
  versionNumber: number;
}>): number {
  if (!Number.isSafeInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("A strategy version number is a positive integer; refused: " + String(input.versionNumber));
  }
  return materialDiff(input.previous, input.next).length > 0
    ? input.versionNumber + 1
    : input.versionNumber;
}
