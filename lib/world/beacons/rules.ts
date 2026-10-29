import {
  FRESH_STATE, expired, fresh, inQuiet, isOp, levelTruth, num, record, ruleId, sanitizeFrame, sanitizeList, slackOf, stepRule,
  type AlertOp, type ConditionKit, type RuleFrame, type RuleState, type Truth,
} from "./engine.ts";

/**
 * The beacons' family of conditions: what a rule on a tower reads. Three kinds,
 * each a level the engine fires on its crossing:
 *
 * - `price` — the tower's price in dollars, above or below a line;
 * - `move` — how far the price moved over 5 minutes, an hour or a day, in
 *   percent;
 * - `liquidity` — the depth of the coin's pools in dollars.
 *
 * Every number is the city's own market read (`/api/city`, the engine of the
 * market the city already stands on): no second source of prices. A read
 * older than five minutes is not known, as it starts nothing in the city.
 *
 * Plain data: the server keeps the rules and tells Telegram, the city lights
 * the tower; both check the same rules the same way.
 */

export type BeaconKind = "price" | "move" | "liquidity";
export type MovePeriod = "5m" | "1h" | "24h";

export type BeaconCondition =
  | Readonly<{ kind: "price"; op: AlertOp; value: number }>
  | Readonly<{ kind: "move"; period: MovePeriod; op: AlertOp; value: number }>
  | Readonly<{ kind: "liquidity"; op: AlertOp; value: number }>;

export type BeaconRule = RuleFrame<BeaconCondition> &
  Readonly<{
    /** The tower: the coin's mint. */
    mint: string;
    /** The coin's ticker when the rule was set, for the message; the city shows the tower's own. */
    symbol: string;
    /** Tell Telegram too, when the account has a chat connected. */
    notify: boolean;
  }>;

/** What one check of a tower reads: the city's market read and when it was made. */
export type TowerRead = Readonly<{ price: number; liquidity: number; change5m: number; change1h: number; change24h: number }>;
export type BeaconWorld = Readonly<{ now: number; at: number | null; tower: TowerRead | null }>;

/** A read older than this is not known: data older than five minutes starts nothing in the city. */
export const READ_FRESH_MS = 5 * 60_000;
/** A lit beacon stays lit this long after it fired. */
export const LIT_MS = 30 * 60_000;
/** Beacons on one tower. */
export const TOWER_LIMIT = 3;
/** A beacon's defaults: a pause of an hour between two firings, every time it crosses again. */
export const BEACON_COOLDOWN = 3600;
export const HOLD_CHOICES = [0, 60, 300, 900] as const;
export const COOLDOWN_CHOICES = [300, 3600, 86_400] as const;
export const PERIODS: readonly MovePeriod[] = ["5m", "1h", "24h"];

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL = /^[A-Za-z0-9$._-]{1,16}$/;

/** The least a line moves back by before a rule may fire again, by kind: a move of 0 % still has a slack. */
const FLOOR: Readonly<Record<BeaconKind, number>> = { price: 0, move: 0.1, liquidity: 0 };

/* ------------------------------------------------------------ checked -- */

export function sanitizeCondition(raw: unknown): BeaconCondition | null {
  const c = record(raw);
  if (!c || !isOp(c.op)) return null;
  const value = num(c.value);
  if (value === null) return null;
  if (c.kind === "price") return value > 0 && value < 1e9 ? { kind: "price", op: c.op, value } : null;
  if (c.kind === "liquidity") return value > 0 && value < 1e13 ? { kind: "liquidity", op: c.op, value } : null;
  if (c.kind === "move") {
    const period = PERIODS.find((p) => p === c.period);
    return period && value >= -100 && value <= 10_000 ? { kind: "move", period, op: c.op, value } : null;
  }
  return null;
}

/** A beacon from anywhere — storage, a request — checked whole; null when any part does not read. */
export function sanitizeBeacon(raw: unknown): BeaconRule | null {
  const r = record(raw);
  if (!r || typeof r.mint !== "string" || !MINT.test(r.mint)) return null;
  const frame = sanitizeFrame(raw, sanitizeCondition);
  if (!frame) return null;
  const symbol = typeof r.symbol === "string" && SYMBOL.test(r.symbol) ? r.symbol : "";
  return { ...frame, mint: r.mint, symbol, notify: r.notify === true };
}

/** A list from anywhere: every beacon checked, ids unique, at most `RULE_LIMIT` in all and `TOWER_LIMIT` a tower. */
export function sanitizeBeacons(raw: unknown): readonly BeaconRule[] {
  const perTower = new Map<string, number>();
  return sanitizeList(raw, sanitizeBeacon).filter((rule) => {
    const n = perTower.get(rule.mint) ?? 0;
    perTower.set(rule.mint, n + 1);
    return n < TOWER_LIMIT;
  });
}

/* -------------------------------------------------------------- truth -- */

function readOf(condition: BeaconCondition, tower: TowerRead): number | null {
  switch (condition.kind) {
    case "price":
      return tower.price > 0 ? num(tower.price) : null;
    case "liquidity":
      return tower.liquidity >= 0 ? num(tower.liquidity) : null;
    case "move":
      return num(condition.period === "5m" ? tower.change5m : condition.period === "1h" ? tower.change1h : tower.change24h);
  }
}

export const BEACON_KIT: ConditionKit<BeaconCondition, BeaconWorld, BeaconRule> = {
  isEvent: () => false,
  truth(condition, world, rule, loose): Truth {
    const view = world.at === null || !world.tower ? null : fresh({ at: world.at }, world.now, READ_FRESH_MS);
    const value = view && world.tower ? readOf(condition, world.tower) : null;
    return levelTruth(value, condition.op, condition.value, loose ? slackOf(condition.value, rule.hysteresis, FLOOR[condition.kind]) : 0);
  },
};

/* -------------------------------------------------------------- check -- */

/** What the engine remembers of one beacon: the rule's version it is about, and whether a one-time beacon is spent. */
export type BeaconState = Readonly<{ version: number; state: RuleState; spent: boolean }>;
export type BeaconStates = Readonly<Record<string, BeaconState>>;

function sanitizeRuleState(raw: unknown): RuleState | null {
  const s = record(raw);
  if (!s) return null;
  const at = (v: unknown) => (v === null ? null : num(v));
  const since = at(s.since);
  const firedAt = at(s.firedAt);
  if ((s.since !== null && since === null) || (s.firedAt !== null && firedAt === null)) return null;
  return { armed: s.armed === true, since, firedAt, seen: s.seen === true };
}

/** States from anywhere, kept only for beacons that exist. */
export function sanitizeStates(raw: unknown, rules: readonly BeaconRule[]): BeaconStates {
  const all = record(raw);
  if (!all) return {};
  const out: Record<string, BeaconState> = {};
  for (const rule of rules) {
    const entry = record(all[rule.id]);
    const state = entry ? sanitizeRuleState(entry.state) : null;
    const version = entry ? num(entry.version) : null;
    if (entry && state && version !== null) out[rule.id] = { version, state, spent: entry.spent === true };
  }
  return out;
}

/** The state a beacon starts from at its version: an edit starts it over. */
export function stateOf(rule: Pick<BeaconRule, "id" | "version">, states: BeaconStates): BeaconState {
  const kept = states[rule.id];
  return kept && kept.version === rule.version ? kept : { version: rule.version, state: FRESH_STATE, spent: false };
}

export type Firing = Readonly<{ rule: BeaconRule; firedAt: number; tower: TowerRead }>;

/**
 * One check of every beacon against one market read. A beacon whose tower is
 * not in the read sees nothing known: it neither fires nor arms. A one-time
 * beacon that fired is spent and stays dark until it is edited.
 */
export function checkBeacons(
  rules: readonly BeaconRule[],
  states: BeaconStates,
  towers: ReadonlyMap<string, TowerRead>,
  at: number | null,
  now: number,
): { states: BeaconStates; fired: Firing[] } {
  const next: Record<string, BeaconState> = {};
  const fired: Firing[] = [];
  for (const rule of rules) {
    const before = stateOf(rule, states);
    if (before.spent) {
      next[rule.id] = before;
      continue;
    }
    const tower = towers.get(rule.mint) ?? null;
    const step = stepRule(BEACON_KIT, rule, before.state, { now, at, tower });
    next[rule.id] = { version: rule.version, state: step.state, spent: step.fire && !rule.repeat };
    if (step.fire && tower) fired.push({ rule, firedAt: now, tower });
  }
  return { states: next, fired };
}

/** Lit: the beacon fired within `LIT_MS`. */
export function isLit(rule: BeaconRule, state: BeaconState | undefined, now: number): boolean {
  if (!rule.on || expired(rule, now) || !state || state.version !== rule.version) return false;
  const at = state.state.firedAt;
  return at !== null && now - at < LIT_MS;
}

/** Two states of one beacon — the city's and the server's — as one: the later firing wins. */
export function mergeStates(rules: readonly BeaconRule[], a: BeaconStates, b: BeaconStates): BeaconStates {
  const out: Record<string, BeaconState> = {};
  for (const rule of rules) {
    const x = a[rule.id]?.version === rule.version ? a[rule.id] : undefined;
    const y = b[rule.id]?.version === rule.version ? b[rule.id] : undefined;
    const pick = !x ? y : !y ? x : (y.state.firedAt ?? 0) > (x.state.firedAt ?? 0) ? y : x;
    if (pick) out[rule.id] = pick;
  }
  return out;
}

/** Whether Telegram may say this firing now: the person asked for it and it is not their hours of quiet. */
export function tellsTelegram(rule: BeaconRule, now: number): boolean {
  return rule.notify && !inQuiet(rule.quiet, now);
}

/* -------------------------------------------------------------- draft -- */

export type Draft = Readonly<{
  conditions: readonly BeaconCondition[];
  /** How the second condition joins the first: «and» in one group, «or» as a group of its own. */
  join: "and" | "or";
  holdSeconds: number;
  cooldownSeconds: number;
  repeat: boolean;
  notify: boolean;
}>;

/** The beacon a draft makes: a new id, or the same id one version on. */
export function beaconOf(draft: Draft, tower: Readonly<{ id: string; symbol: string }>, before: BeaconRule | null, now: number, random: () => number = Math.random): BeaconRule | null {
  const [first, ...rest] = draft.conditions;
  if (!first) return null;
  const groups = draft.join === "and" ? [[first, ...rest]] : [[first], ...rest.map((c) => [c])];
  return sanitizeBeacon({
    id: before?.id ?? ruleId(random, now),
    version: (before?.version ?? 0) + 1,
    groups,
    holdSeconds: draft.holdSeconds,
    hysteresis: before?.hysteresis,
    cooldownSeconds: draft.cooldownSeconds,
    repeat: draft.repeat,
    expiresAt: null,
    quiet: before?.quiet ?? null,
    on: true,
    createdAt: before?.createdAt ?? now,
    mint: tower.id,
    symbol: tower.symbol.replace(/^\$/, "").slice(0, 16),
    notify: draft.notify,
  });
}

/** A beacon back as a draft, to edit it. */
export function draftOf(rule: BeaconRule): Draft {
  const join = rule.groups.length > 1 ? "or" : "and";
  return { conditions: rule.groups.flat(), join, holdSeconds: rule.holdSeconds, cooldownSeconds: rule.cooldownSeconds, repeat: rule.repeat, notify: rule.notify };
}

/** A first draft for a tower: a price line a little above where it stands now. */
export function firstDraft(tower: Pick<TowerRead, "price">): Draft {
  return {
    conditions: [{ kind: "price", op: "above", value: roundLine(tower.price * 1.05) || 1 }],
    join: "and",
    holdSeconds: 0,
    cooldownSeconds: BEACON_COOLDOWN,
    repeat: true,
    /* Telegram is the person's own choice: off until they turn it on (CITY-72). */
    notify: false,
  };
}

/** A line people would type: three significant digits. */
export function roundLine(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toPrecision(3));
}
