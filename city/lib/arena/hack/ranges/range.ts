/**
 * A range: the copy an order's runs play on, and the checks they may claim to break (CITY-238; spec
 * `docs/research/city-hack-2026-11-08/SPEC.md` — «тренувальні замовлення Ryntra, форк-цілі з відкритих контрактів»).
 *
 * The sandbox needs three things an order does not carry: the recorded state of its copy (`Snapshot`), the pin of that
 * state on the engine that runs it (`ForkPin`), and the order's checks. They are kept together as a range, found by the
 * order's target — the program and the slot the owner's grant already signs. The server reads a range to build an
 * agent's session (the pin, the accounts to read, the claim); the machine with no network holds the same ranges and
 * plays only a pin it holds itself, so a job can never bring its own state or its own checks.
 *
 * The first store of ranges is the catalogue that ships with the deployment (`catalogue.ts`): Ryntra's own training
 * ranges. A protocol's own contract — its bytes, its recorded accounts, its checks — is the same shape from another
 * store, when that store exists.
 *
 * Pure: no store, no clock, no network.
 */

import { checkSnapshot, pinOf, type EngineRef, type ForkPin, type HackClaim, type Invariant, type Snapshot } from "../sandbox/index.ts";
import { isAddress, isName, type TargetRef } from "../scope.ts";
import { checksIssue, invariantsOf, type CheckSpec } from "./checks.ts";

/** The engine every range of the deployment runs on: LiteSVM, pinned to the version the machine's image installs. */
export const RANGE_ENGINE: EngineRef = { id: "litesvm", version: "1.6.2" };

/** A range as it is kept: plain data. */
export type RangeRecord = {
  readonly id: string;
  /** For a person, in a window's «Details» — never a rule. */
  readonly title: string;
  readonly target: { readonly kind: "fork"; readonly program: string; readonly slot: number };
  /** The accounts an agent is pointed at first. Reading any account of the copy is allowed. */
  readonly watch: readonly string[];
  readonly snapshot: Snapshot;
  readonly checks: readonly CheckSpec[];
};

/** A range ready to run: its pin on an engine, and its checks as the sandbox takes them. */
export type Range = RangeRecord & {
  readonly pin: ForkPin;
  readonly invariants: readonly Invariant[];
  /** The check a run claims: the range's first. */
  readonly claim: HackClaim;
};

/** What is wrong with a range as kept; `null` when it can run. */
export function rangeIssue(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "a range is an object";
  const r = value as Record<string, unknown>;
  if (!isName(r.id)) return "a range needs an id";
  if (typeof r.title !== "string" || r.title.trim().length === 0 || r.title.length > 120) return `range ${r.id}: a title of 1…120 characters`;
  const target = r.target as Record<string, unknown> | null;
  if (target === null || typeof target !== "object" || target.kind !== "fork" || !isAddress(target.program) || !Number.isSafeInteger(target.slot) || (target.slot as number) < 0) {
    return `range ${r.id}: the target is a fork — a program and a slot`;
  }
  if (!Array.isArray(r.watch) || r.watch.length > 16 || !r.watch.every(isAddress)) return `range ${r.id}: watch is at most 16 addresses`;
  const snapshot = checkSnapshot(r.snapshot);
  if (snapshot) return `range ${r.id}: ${snapshot.detail}`;
  if ((r.snapshot as Snapshot).slot !== target.slot) return `range ${r.id}: the state was recorded at another slot than the target's`;
  const checks = checksIssue(r.checks);
  if (checks) return `range ${r.id}: ${checks}`;
  return null;
}

/** The range ready to run on an engine. Throws `TypeError` for a record that does not read. */
export function readyRange(record: RangeRecord, engine: EngineRef = RANGE_ENGINE): Range {
  const issue = rangeIssue(record);
  if (issue) throw new TypeError(issue);
  const first = record.checks[0]!;
  return { ...record, pin: pinOf(record.snapshot, record.target, engine), invariants: invariantsOf(record.checks), claim: { invariant: first.id, version: first.version } };
}

/** Where ranges are kept. */
export type RangeStore = {
  /** The range of an order's copy, or `null` when no range is kept for it. */
  forTarget(target: TargetRef): Range | null;
  /** The range that holds exactly this pin, or `null`: what the machine plays, and nothing else. */
  forPin(pin: ForkPin): Range | null;
  list(): readonly Range[];
};

/** A store over records, each made ready once. Throws for a record that does not read, or two ranges of one target. */
export function createRangeStore(records: readonly RangeRecord[], engine: EngineRef = RANGE_ENGINE): RangeStore {
  const ranges = records.map((record) => readyRange(record, engine));
  const keyOf = (target: { program: string; slot: number }) => `${target.program}@${target.slot}`;
  const byTarget = new Map<string, Range>();
  for (const range of ranges) {
    if (byTarget.has(keyOf(range.target))) throw new TypeError(`two ranges share the target ${keyOf(range.target)}`);
    byTarget.set(keyOf(range.target), range);
  }
  return {
    forTarget(target) {
      return target?.kind === "fork" ? (byTarget.get(keyOf(target)) ?? null) : null;
    },
    forPin(pin) {
      const range = pin?.target ? byTarget.get(keyOf(pin.target)) : undefined;
      if (!range) return null;
      const same = range.pin.stateHash === pin.stateHash && range.pin.engine.id === pin.engine?.id && range.pin.engine.version === pin.engine?.version && range.pin.clock.unixTimestamp === pin.clock?.unixTimestamp;
      return same ? range : null;
    },
    list: () => ranges,
  };
}
