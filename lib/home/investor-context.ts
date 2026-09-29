/** RYN-HOME-001 — versioned user-declared InvestorContext. */

export const INVESTOR_CONTEXT_MAX_VERSIONS = 50;

export const INVESTOR_CONTEXT_CURRENCIES = ["USD", "EUR", "GBP", "UAH", "OTHER", "UNDECLARED"] as const;
export const INVESTOR_CONTEXT_HORIZONS = [
  "UNDER_1_YEAR",
  "ONE_TO_THREE_YEARS",
  "THREE_TO_SEVEN_YEARS",
  "SEVEN_PLUS_YEARS",
  "UNDECLARED",
] as const;
export const INVESTOR_CONTEXT_LEVELS = ["LOW", "MEDIUM", "HIGH", "UNDECLARED"] as const;
export const INVESTOR_CONTEXT_GOALS = [
  "CAPITAL_PRESERVATION",
  "INCOME",
  "GROWTH",
  "TRADING_DISCIPLINE",
  "UNDECLARED",
] as const;
export const INVESTOR_CONTEXT_EXCLUSIONS = [
  "LEVERAGE",
  "PERPETUALS",
  "ILLIQUID_ASSETS",
  "AUTOMATED_EXECUTION",
] as const;

type Currency = (typeof INVESTOR_CONTEXT_CURRENCIES)[number];
type Horizon = (typeof INVESTOR_CONTEXT_HORIZONS)[number];
type Level = (typeof INVESTOR_CONTEXT_LEVELS)[number];
type Goal = (typeof INVESTOR_CONTEXT_GOALS)[number];
type Exclusion = (typeof INVESTOR_CONTEXT_EXCLUSIONS)[number];

export type InvestorContextDraft = Readonly<{
  displayCurrency: Currency;
  horizon: Horizon;
  liquidityNeed: Level;
  lossCapacity: Level;
  riskTolerance: Level;
  goals: readonly Goal[];
  excludedActivities: readonly Exclusion[];
  notes: string;
}>;

export type InvestorContextVersion = InvestorContextDraft &
  Readonly<{
    id: string;
    version: number;
    declaredBy: "USER";
    createdAt: string;
    supersedesVersion: number | null;
  }>;

type ContextOptions = Readonly<{ id: string; now: string }>;

const CONTEXT_ID = /^ictx_[A-Za-z0-9_-]{1,64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRAFT_KEYS = [
  "displayCurrency",
  "horizon",
  "liquidityNeed",
  "lossCapacity",
  "riskTolerance",
  "goals",
  "excludedActivities",
  "notes",
] as const;
const VERSION_KEYS = ["id", "version", "declaredBy", "createdAt", "supersedesVersion", ...DRAFT_KEYS] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function uniqueAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
  minimum: number,
): readonly T[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > allowed.length) return null;
  const result: T[] = [];
  for (const item of value) {
    if (!allowed.includes(item as T)) return null;
    if (!result.includes(item as T)) result.push(item as T);
  }
  return result.length >= minimum ? result : null;
}

export function normalizeInvestorContextDraft(value: unknown): InvestorContextDraft | null {
  if (!isObject(value) || !hasExactKeys(value, DRAFT_KEYS)) return null;
  if (!INVESTOR_CONTEXT_CURRENCIES.includes(value.displayCurrency as Currency)) return null;
  if (!INVESTOR_CONTEXT_HORIZONS.includes(value.horizon as Horizon)) return null;
  for (const field of [value.liquidityNeed, value.lossCapacity, value.riskTolerance]) {
    if (!INVESTOR_CONTEXT_LEVELS.includes(field as Level)) return null;
  }
  const goals = uniqueAllowed(value.goals, INVESTOR_CONTEXT_GOALS, 1);
  const excludedActivities = uniqueAllowed(value.excludedActivities, INVESTOR_CONTEXT_EXCLUSIONS, 0);
  if (!goals || excludedActivities === null || typeof value.notes !== "string") return null;
  const notes = value.notes.trim();
  if (notes.length > 500 || CONTROL.test(notes)) return null;
  return {
    displayCurrency: value.displayCurrency as Currency,
    horizon: value.horizon as Horizon,
    liquidityNeed: value.liquidityNeed as Level,
    lossCapacity: value.lossCapacity as Level,
    riskTolerance: value.riskTolerance as Level,
    goals,
    excludedActivities,
    notes,
  };
}

function semanticDraft(value: InvestorContextDraft): string {
  const goalRank = new Map(INVESTOR_CONTEXT_GOALS.map((item, index) => [item, index]));
  const exclusionRank = new Map(INVESTOR_CONTEXT_EXCLUSIONS.map((item, index) => [item, index]));
  return JSON.stringify({
    displayCurrency: value.displayCurrency,
    horizon: value.horizon,
    liquidityNeed: value.liquidityNeed,
    lossCapacity: value.lossCapacity,
    riskTolerance: value.riskTolerance,
    goals: [...value.goals].sort((a, b) => (goalRank.get(a) ?? 0) - (goalRank.get(b) ?? 0)),
    excludedActivities: [...value.excludedActivities].sort(
      (a, b) => (exclusionRank.get(a) ?? 0) - (exclusionRank.get(b) ?? 0),
    ),
    notes: value.notes,
  });
}

export function createInvestorContextVersion(
  history: readonly InvestorContextVersion[],
  draftValue: unknown,
  options: ContextOptions,
):
  | Readonly<{ ok: true; history: readonly InvestorContextVersion[]; version: InvestorContextVersion }>
  | Readonly<{ ok: false; error: "INVALID_CONTEXT" | "UNCHANGED_CONTEXT" | "CONTEXT_VERSION_LIMIT_REACHED" }> {
  if (history.length >= INVESTOR_CONTEXT_MAX_VERSIONS) {
    return { ok: false, error: "CONTEXT_VERSION_LIMIT_REACHED" };
  }
  const draft = normalizeInvestorContextDraft(draftValue);
  if (!draft || !CONTEXT_ID.test(options.id) || !isIsoTime(options.now)) {
    return { ok: false, error: "INVALID_CONTEXT" };
  }
  const previous = history.at(-1) ?? null;
  if (previous && semanticDraft(previous) === semanticDraft(draft)) {
    return { ok: false, error: "UNCHANGED_CONTEXT" };
  }
  const version: InvestorContextVersion = {
    id: options.id,
    version: previous ? previous.version + 1 : 1,
    declaredBy: "USER",
    createdAt: options.now,
    supersedesVersion: previous?.version ?? null,
    ...draft,
  };
  return { ok: true, history: [...history, version], version };
}

export function missingInvestorContextFields(
  value: InvestorContextDraft,
): readonly (keyof InvestorContextDraft)[] {
  const missing: (keyof InvestorContextDraft)[] = [];
  if (value.displayCurrency === "UNDECLARED") missing.push("displayCurrency");
  if (value.horizon === "UNDECLARED") missing.push("horizon");
  if (value.liquidityNeed === "UNDECLARED") missing.push("liquidityNeed");
  if (value.lossCapacity === "UNDECLARED") missing.push("lossCapacity");
  if (value.riskTolerance === "UNDECLARED") missing.push("riskTolerance");
  if (value.goals.length === 0 || value.goals.every((goal) => goal === "UNDECLARED")) missing.push("goals");
  return missing;
}

export function parseInvestorContextHistory(value: unknown): readonly InvestorContextVersion[] | null {
  if (!Array.isArray(value) || value.length > INVESTOR_CONTEXT_MAX_VERSIONS) return null;
  const history: InvestorContextVersion[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!isObject(raw) || !hasExactKeys(raw, VERSION_KEYS)) return null;
    const draft = normalizeInvestorContextDraft(Object.fromEntries(DRAFT_KEYS.map((key) => [key, raw[key]])));
    if (!draft || typeof raw.id !== "string" || !CONTEXT_ID.test(raw.id) || ids.has(raw.id)) return null;
    if (raw.declaredBy !== "USER" || raw.version !== index + 1 || !isIsoTime(raw.createdAt)) return null;
    const expectedSupersedes = index === 0 ? null : index;
    if (raw.supersedesVersion !== expectedSupersedes) return null;
    ids.add(raw.id);
    history.push({
      id: raw.id,
      version: raw.version,
      declaredBy: "USER",
      createdAt: raw.createdAt,
      supersedesVersion: expectedSupersedes,
      ...draft,
    });
  }
  return history;
}
