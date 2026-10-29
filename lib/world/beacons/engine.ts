/**
 * The rules engine of the city's beacons (CITY-72, decision 74). It began as
 * the price-alert engine of a trading terminal and came over whole: it never
 * read a chain, so nothing was cut.
 *
 * A rule says when a tower lights its beacon: conditions joined by «and»
 * inside a group, groups joined by «or». What a condition reads — a price, a
 * move over a period, a pool's depth — is the family's (`rules.ts`); how a
 * rule fires is the engine's:
 *
 * - a level fires on its crossing, never because it already held when the
 *   rule was first seen;
 * - it must hold for the rule's time without a break;
 * - after it fired it arms again only once it went back past its line by more
 *   than its slack (hysteresis), so a price that hovers on the line does not
 *   fire again and again;
 * - a happening fires on the happening;
 * - never inside the rule's pause, never after its end;
 * - a number that is not known is never a reason to fire, nor to arm again.
 *
 * A rule only tells. It never signs, sends or changes an order.
 *
 * Plain data and plain functions: the server that tells Telegram and the city
 * that lights the tower agree on what holds and when a rule fires.
 *
 * Relative imports only: `node --test` imports this module directly.
 */

/* -------------------------------------------------------------- rules -- */

export type AlertOp = "above" | "below";

/** Hours of quiet: from and to in minutes of the day, in the person's own time zone. */
export type QuietHours = Readonly<{ from: number; to: number; zone: string }>;

/** What every rule has, whatever its conditions read. */
export type RuleFrame<C> = Readonly<{
  id: string;
  /** Grows with every edit: what a rule said when it fired is told apart from what it says now. */
  version: number;
  /** «Or» over the groups; «and» inside each. */
  groups: readonly (readonly C[])[];
  /** It must hold this long without a break before it fires. */
  holdSeconds: number;
  /** How far back past its line a condition must go before the rule may fire again: a fraction of the line. */
  hysteresis: number;
  /** After it fired, the rule is quiet at least this long. */
  cooldownSeconds: number;
  /** Fire every time it holds again (after the pause), or once — then it turns itself off. */
  repeat: boolean;
  expiresAt: number | null;
  quiet: QuietHours | null;
  on: boolean;
  createdAt: number;
}>;

export const RULE_LIMIT = 30;
export const GROUP_LIMIT = 3;
export const CONDITION_LIMIT = 6;
export const GROUP_CONDITION_LIMIT = 4;
export const HYSTERESIS_DEFAULT = 0.002;
export const COOLDOWN_DEFAULT = 300;

const ID = /^[a-z0-9]{4,24}$/;

/* ------------------------------------------------------------ checked -- */

export const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
export const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
export const isOp = (value: unknown): value is AlertOp => value === "above" || value === "below";
export const within = (value: unknown, min: number, max: number): number | null => {
  const n = num(value);
  return n !== null && n >= min && n <= max ? n : null;
};

export function sanitizeQuiet(raw: unknown): QuietHours | null {
  const q = record(raw);
  if (!q) return null;
  const from = within(q.from, 0, 1439);
  const to = within(q.to, 0, 1439);
  const zone = typeof q.zone === "string" && q.zone.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(q.zone) ? q.zone : null;
  if (from === null || to === null || !Number.isInteger(from) || !Number.isInteger(to) || from === to || !zone || !knownZone(zone)) return null;
  return { from, to, zone };
}

function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * What every rule has, from anywhere — storage, a request — checked whole:
 * a rule with a condition that does not read is not a rule. The family adds
 * its own fields on top.
 */
export function sanitizeFrame<C>(raw: unknown, sanitizeCondition: (raw: unknown) => C | null): RuleFrame<C> | null {
  const r = record(raw);
  if (!r || typeof r.id !== "string" || !ID.test(r.id) || !Array.isArray(r.groups)) return null;
  const version = within(r.version, 1, 1e9);
  const createdAt = within(r.createdAt, 0, 1e15);
  if (version === null || !Number.isInteger(version) || createdAt === null) return null;
  if (r.groups.length < 1 || r.groups.length > GROUP_LIMIT) return null;
  const groups: C[][] = [];
  let total = 0;
  for (const rawGroup of r.groups) {
    if (!Array.isArray(rawGroup) || rawGroup.length < 1 || rawGroup.length > GROUP_CONDITION_LIMIT) return null;
    const group: C[] = [];
    for (const entry of rawGroup) {
      const condition = sanitizeCondition(entry);
      if (!condition) return null;
      group.push(condition);
    }
    total += group.length;
    groups.push(group);
  }
  if (total > CONDITION_LIMIT) return null;
  return {
    id: r.id,
    version,
    groups,
    holdSeconds: within(r.holdSeconds, 0, 3600) ?? 0,
    hysteresis: within(r.hysteresis, 0, 0.2) ?? HYSTERESIS_DEFAULT,
    cooldownSeconds: within(r.cooldownSeconds, 0, 86_400) ?? COOLDOWN_DEFAULT,
    repeat: r.repeat === true,
    expiresAt: within(r.expiresAt, 0, 1e15),
    quiet: sanitizeQuiet(r.quiet),
    on: r.on !== false,
    createdAt,
  };
}

/** A list from anywhere: every rule checked, ids unique, at most `RULE_LIMIT`. */
export function sanitizeList<R extends Readonly<{ id: string }>>(raw: unknown, sanitizeRule: (raw: unknown) => R | null): readonly R[] {
  if (!Array.isArray(raw)) return [];
  const out: R[] = [];
  for (const entry of raw) {
    if (out.length >= RULE_LIMIT) break;
    const rule = sanitizeRule(entry);
    if (rule && !out.some((kept) => kept.id === rule.id)) out.push(rule);
  }
  return out;
}

export function ruleId(random: () => number = Math.random, now: number = Date.now()): string {
  return `${Math.floor(random() * 36 ** 6).toString(36)}${now.toString(36)}`.replace(/[^a-z0-9]/g, "").slice(0, 24).padEnd(4, "0");
}

/* -------------------------------------------------------------- truth -- */

export type Truth = boolean | null;

/** A view of the world as one check reads it: never newer than a few seconds past now, never older than its limit. */
export const fresh = <T extends { at: number }>(view: T | null, now: number, limit: number): T | null => (view && now - view.at <= limit && view.at <= now + 5_000 ? view : null);

/** The least a line moves back by before a rule may fire again: a share of the line, never under the kind's floor. */
export function slackOf(line: number, hysteresis: number, floor: number): number {
  return Math.max(Math.abs(line) * hysteresis, floor);
}

/**
 * Whether a level holds: not known when its number is not read; known and
 * false when there is nothing to read (NaN — say, no position). `slack` moves
 * the line back: a loose look asks whether it went back past it.
 */
export function levelTruth(value: number | null, op: AlertOp, line: number, slack = 0): Truth {
  if (value === null) return null;
  if (Number.isNaN(value)) return false;
  return op === "above" ? value > line - slack : value < line + slack;
}

/** What a family tells the engine about its conditions. */
export type ConditionKit<C, W extends Readonly<{ now: number }>, R extends RuleFrame<C> = RuleFrame<C>> = Readonly<{
  /** A happening — it fires on what happened since the last check, not on a level. */
  isEvent(condition: C): boolean;
  /**
   * Whether a condition holds in this world: null when it is not known. A
   * happening holds when it happened since the last check, and never loosely.
   * `loose` moves a level's line back by its slack.
   */
  truth(condition: C, world: W, rule: R, loose: boolean): Truth;
}>;

function ruleTruth<C, W extends Readonly<{ now: number }>, R extends RuleFrame<C>>(kit: ConditionKit<C, W, R>, rule: R, world: W, loose: boolean): Truth {
  let unknown = false;
  for (const group of rule.groups) {
    let groupTruth: Truth = true;
    for (const condition of group) {
      const truth = kit.isEvent(condition) && loose ? false : kit.truth(condition, world, rule, loose);
      if (truth === false) {
        groupTruth = false;
        break;
      }
      if (truth === null) groupTruth = null;
    }
    if (groupTruth === true) return true;
    if (groupTruth === null) unknown = true;
  }
  return unknown ? null : false;
}

/* --------------------------------------------------------------- step -- */

export type RuleState = Readonly<{
  /** It may fire: it was seen not holding — past its slack — since it last fired. */
  armed: boolean;
  /** Since when it has held without a break. */
  since: number | null;
  firedAt: number | null;
  /** It has been looked at once with everything known. */
  seen: boolean;
}>;

export const FRESH_STATE: RuleState = Object.freeze({ armed: false, since: null, firedAt: null, seen: false });

export type RuleStatus = "off" | "expired" | "unknown" | "waiting" | "holding" | "armed";

export type Step = Readonly<{ state: RuleState; fire: boolean; status: RuleStatus }>;

export function expired(rule: Pick<RuleFrame<unknown>, "expiresAt">, now: number): boolean {
  return rule.expiresAt !== null && now >= rule.expiresAt;
}

type LevelStep = Readonly<{ armed: boolean; since: number | null; seen: boolean; ready: boolean; status: RuleStatus }>;

/** The groups on levels: they fire on a crossing, held for the rule's time. */
function levelStep<C, W extends Readonly<{ now: number }>, R extends RuleFrame<C>>(kit: ConditionKit<C, W, R>, rule: R, state: RuleState, world: W): LevelStep {
  const now = world.now;
  const truth = ruleTruth(kit, rule, world, false);
  /* Not known: nothing changes but the hold, which starts over. */
  if (truth === null) return { armed: state.armed, since: null, seen: state.seen, ready: false, status: "unknown" };
  /* First look: not holding — it may fire on the crossing; holding already — it waits for the next one. */
  if (!state.seen) return { armed: !truth, since: null, seen: true, ready: false, status: truth ? "holding" : "armed" };
  const armed = state.armed || ruleTruth(kit, rule, world, true) === false;
  if (!truth) return { armed, since: null, seen: true, ready: false, status: armed ? "armed" : "waiting" };
  const since = state.since ?? now;
  return { armed, since, seen: true, ready: armed && now - since >= rule.holdSeconds * 1000, status: armed ? "armed" : "holding" };
}

/**
 * One check of one rule. Groups on levels fire when they start to hold — a
 * rule that already holds when it is first seen waits for the next crossing —
 * and only after they have held for the rule's time and armed again since the
 * rule last fired. Groups with a happening fire on the happening. Either way,
 * never inside the rule's pause. Turning a rule off after it fired once is the
 * caller's.
 */
export function stepRule<C, W extends Readonly<{ now: number }>, R extends RuleFrame<C>>(kit: ConditionKit<C, W, R>, rule: R, state: RuleState, world: W): Step {
  const now = world.now;
  if (!rule.on) return { state: { ...state, since: null }, fire: false, status: "off" };
  if (expired(rule, now)) return { state: { ...state, since: null }, fire: false, status: "expired" };
  const cooled = state.firedAt === null || now - state.firedAt >= rule.cooldownSeconds * 1000;
  const eventGroups = rule.groups.filter((group) => group.some((condition) => kit.isEvent(condition)));
  const levelGroups = rule.groups.filter((group) => !group.some((condition) => kit.isEvent(condition)));
  /* A level beside a happening never fires on its own while it merely holds: the two are told apart. */
  const happened = eventGroups.length ? ruleTruth(kit, { ...rule, groups: eventGroups }, world, false) : false;
  const level = levelGroups.length ? levelStep(kit, { ...rule, groups: levelGroups }, state, world) : null;
  if (cooled && (happened === true || level?.ready)) {
    const crossed = Boolean(level?.ready);
    return { state: { armed: crossed ? false : (level?.armed ?? true), since: crossed ? null : (level?.since ?? null), firedAt: now, seen: true }, fire: true, status: crossed ? "holding" : "armed" };
  }
  if (!level) return { state: { armed: true, since: null, firedAt: state.firedAt, seen: true }, fire: false, status: happened === null ? "unknown" : "armed" };
  return { state: { armed: level.armed, since: level.since, firedAt: state.firedAt, seen: level.seen }, fire: false, status: level.status };
}

/** The key one firing is known by everywhere — a tab, another tab, the server — so it is told once per channel. */
export function firingKey(rule: Pick<RuleFrame<unknown>, "id" | "version">, firedAt: number): string {
  return `${rule.id}:${rule.version}:${firedAt}`;
}

/** Inside the person's hours of quiet: the city still lights the tower, Telegram does not say it. */
export function inQuiet(quiet: QuietHours | null, now: number): boolean {
  if (!quiet) return false;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: quiet.zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
    minutes = hour * 60 + minute;
  } catch {
    return false;
  }
  return quiet.from < quiet.to ? minutes >= quiet.from && minutes < quiet.to : minutes >= quiet.from || minutes < quiet.to;
}
