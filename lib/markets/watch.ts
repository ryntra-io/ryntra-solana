import { uiMultiplierToNumber } from "../token/ui-multiplier.ts";
import type { InstrumentClass, RadarRow } from "./radar.ts";
import type { EventSource } from "./scan.ts";

/**
 * The Watchlist: an entry that survives what happens to the thing it watches.
 *
 * The canon's §5 opens with the whole module in three words — **not a star.**
 * A star is a boolean on a row: it says *this symbol interests me* and it
 * carries nothing, so the first time the venue renames a token, withdraws a
 * route or applies a corporate action, the star is either wrong or gone. What
 * is asked for instead is an object that remembers, and the acceptance says
 * exactly what it has to survive:
 *
 *   > a watchlist entry survives a route change and a corporate action with
 *   > its history intact, and an alert states the condition that fired rather
 *   > than the value that moved.
 *
 * Both halves are held here by structure rather than by discipline:
 *
 *   1. **Identity is the contract address, and nothing else is identity.**
 *      There is no writable symbol on `WatchEntry`. The symbol, the name, the
 *      class, the verification flag, the routes, the price and the multiplier
 *      are *observations* — reconciled on every read, with every difference
 *      appended to an append-only history that names its feed and field. A
 *      renamed token is an event on the same entry. A delisting is an event,
 *      not a deletion.
 *   2. **A fired alert's headline is derived from the alert.** `FiredAlert`
 *      has no parameter through which a caller could pass a value-shaped
 *      headline: `condition` comes from `describeAlert()` and the figure lives
 *      in a different field. *Price moves at least 5% from the reference* is
 *      the line; `−6.31%` is beside it, with its source.
 *
 * And one thing this module can do that `scan.ts` could not, for a reason
 * worth stating: **a watchlist is bounded.** The Scanner registered *a
 * corporate action is scheduled* with no source because sweeping 231 tokens
 * meant an on-chain read per token on every page load. Measured 2026-08-19,
 * 100 `eth_call`s against Robinhood Chain returned in 632 ms — so over a list
 * capped at 25 entries the same read costs three calls each and the condition
 * becomes one this surface simply performs. The cap is not a storage limit; it
 * is what makes the deepest signal affordable.
 */

/* ---------------------------------------------------------------- identity */

/**
 * The key. Lowercased, because the venue returns mixed case and a map keyed by
 * the raw string would hold the same token twice.
 *
 * The **wrapped** address is not this. All 231 tokens carry a
 * `wrappedTokenAddress` that differs from `address` on every row, and
 * `uiMultiplier()` reverts on it — an entry keyed by the wrong one would read
 * as "not a Stock Token" forever, which looks exactly like a community token.
 */
export type WatchKey = string;

export function watchKey(address: string): WatchKey {
  return address.trim().toLowerCase();
}

/** A 20-byte hex address, and nothing that merely looks like one. */
export function isAddress(raw: unknown): raw is string {
  return typeof raw === "string" && /^0x[0-9a-fA-F]{40}$/.test(raw.trim());
}

/* ------------------------------------------------------------- observation */

/** The four ERC-8056 reads, as strings so an entry survives `JSON.stringify`. */
export type ChainRead = Readonly<{
  /** 1e18 fixed point, as a decimal string. `null` = not read, never 1.0. */
  uiMultiplier: string | null;
  newUiMultiplier: string | null;
  /** Unix seconds the current multiplier took effect. `0` = never; `null` = unread. */
  effectiveAt: number | null;
  oraclePaused: boolean | null;
}>;

export type VenueMarket = Readonly<{ status: string; isOutsideRth: boolean | null }>;

/**
 * Everything currently known about one watched address.
 *
 * `row: null` is a real state and the important one: the venue's registry no
 * longer lists this token. The entry stays, and says so.
 */
export type Observation = Readonly<{
  address: string;
  row: RadarRow | null;
  market: VenueMarket | null;
  chain: ChainRead | null;
  at: number;
}>;

/**
 * The route, named with its provider.
 *
 * "Routes and providers" is one fact in the canon, and writing only the symbol
 * would make a provider change invisible — the route would look unchanged
 * while the thing executing it had been replaced.
 */
export const ROUTE_PROVIDER = "arcus-spot-rfq";

export function routeIds(row: RadarRow | null): readonly string[] {
  if (!row) return Object.freeze([]);
  return Object.freeze(row.tradability.executableRoutes.map((symbol) => `${ROUTE_PROVIDER}:${symbol}`));
}

/** Spot always; perps only where the venue runs a market for the base asset. */
export type MarketType = "spot" | "perp";

export function marketTypes(observation: Observation): readonly MarketType[] {
  if (!observation.row) return Object.freeze([]);
  return Object.freeze<MarketType[]>(observation.market ? ["spot", "perp"] : ["spot"]);
}

/* -------------------------------------------------------------- seen state */

/**
 * The last state each observed dimension was seen in.
 *
 * This is what a change is measured against, and it is the only mutable part
 * of an entry. Every field here has a counterpart event; a dimension that
 * cannot raise an event does not belong in this type, because it would be
 * state nobody could ever be told about.
 */
export type WatchSeen = Readonly<{
  symbol: string;
  name: string;
  listed: boolean;
  venueVerified: boolean;
  instrumentClass: InstrumentClass | null;
  classAgreed: boolean;
  routes: readonly string[];
  marketTypes: readonly MarketType[];
  priced: boolean;
  /** The figure movement is measured from, and when it was set. */
  reference: Readonly<{ price: number; at: number }> | null;
  uiMultiplier: string | null;
  /** Unix seconds of the corporate action currently in force. `0` = none ever. */
  corporateActionAt: number | null;
  scheduledAction: boolean;
  oraclePaused: boolean | null;
}>;

/* ------------------------------------------------------------------ events */

export type WatchEventKind =
  | "watched"
  | "symbol-changed"
  | "name-changed"
  | "delisted"
  | "relisted"
  | "verification-granted"
  | "verification-withdrawn"
  | "class-changed"
  | "class-disagreement-appeared"
  | "class-disagreement-resolved"
  | "route-appeared"
  | "route-withdrawn"
  | "market-type-appeared"
  | "market-type-withdrawn"
  | "price-unavailable"
  | "price-restored"
  | "corporate-action-applied"
  | "corporate-action-scheduled"
  | "oracle-paused"
  | "oracle-resumed"
  | "alert-fired";

/**
 * One thing that happened to the watched instrument.
 *
 * `at` is when it happened; `recordedAt` is when this browser learned of it.
 * They differ for the events read back off the chain, and an entry can
 * therefore carry an event that predates it — which is the point of reading
 * `effectiveAt()` rather than diffing against a snapshot. *Inherited* is
 * `at < entry.addedAt`, derived rather than stored: a flag beside the two
 * timestamps would be a third copy of the same fact, free to disagree.
 *
 * `headline` says what happened. `observed` carries the figure, deliberately
 * apart, for the same reason `FiredAlert` splits them.
 */
export type WatchEvent = Readonly<{
  kind: WatchEventKind;
  at: number;
  recordedAt: number;
  headline: string;
  observed: string | null;
  source: EventSource;
}>;

/** The only constructor. Provenance is an argument, so an event without one does not typecheck. */
export function record(
  kind: WatchEventKind,
  at: number,
  recordedAt: number,
  headline: string,
  observed: string | null,
  source: EventSource,
): WatchEvent {
  return Object.freeze({ kind, at, recordedAt, headline, observed, source });
}

const feed = (feedName: string, field: string, observedAt: number): EventSource =>
  Object.freeze({ feed: feedName, field, observedAt });

/**
 * A multiplier as the rest of the product states it.
 *
 * The **stored** value stays the exact 1e18 integer, because comparison is what
 * decides whether a corporate action happened and a rounded number cannot do
 * that. Only what a person reads is converted — the Asset Passport shows
 * `1.000566080061` for this same fact, and a card beside it showing
 * `1000566080061092436` is the storage format leaking onto the page.
 */
function showMultiplier(raw: string | null): string {
  return raw === null ? "unread" : uiMultiplierToNumber(raw).toFixed(12);
}

/* ------------------------------------------------------------------ alerts */

export type WatchAlertKind =
  | "price-moves"
  | "underlying-closes"
  | "route-appears"
  | "corporate-action"
  | "spread-exceeds"
  | "depth-passes"
  | "strategy-condition";

export type AlertThreshold = Readonly<{ label: string; unit: string; fallback: number; min: number; max: number }>;

/**
 * Every condition the canon names, plus the one this surface earned.
 *
 * `source: null` is not "not implemented yet". It means no endpoint or
 * contract this product reads carries the figure at all, and `gate` states
 * exactly what would change that. They are registered rather than dropped
 * because an alert list missing three of its conditions reads as complete,
 * which is the more expensive error — the same rule `scan.ts` states.
 */
export type AlertSpec = Readonly<{
  kind: WatchAlertKind;
  label: string;
  /** The standing condition, in the person's words. */
  question: string;
  source: Readonly<{ feed: string; field: string }> | null;
  gate: string | null;
  threshold: AlertThreshold | null;
}>;

export const ALERT_SPECS: readonly AlertSpec[] = Object.freeze([
  Object.freeze({
    kind: "price-moves" as const,
    label: "Price moves from the reference",
    question: "Has this moved far enough from where I last looked to be worth looking again?",
    source: Object.freeze({ feed: "arcus:spot-overview", field: "quote.price" }),
    gate: null,
    threshold: Object.freeze({ label: "Move", unit: "%", fallback: 5, min: 0.1, max: 100 }),
  }),
  Object.freeze({
    kind: "underlying-closes" as const,
    label: "The underlying market closes",
    question: "Is the token trading while the market that prices it is shut?",
    /* The venue's own calendar fact, and it lives on the perps market list —
       so it joins only the instruments that have one, 33 of 231 measured
       2026-08-19. An entry without a perps market cannot be judged on this and
       is reported as such rather than counted as quiet. */
    source: Object.freeze({ feed: "arcus:/v1/markets", field: "isOutsideRth" }),
    gate: null,
    threshold: null,
  }),
  Object.freeze({
    kind: "route-appears" as const,
    label: "A new route appears",
    question: "Did this become executable, or executable another way?",
    source: Object.freeze({ feed: "ryntra:spot-exec-policy", field: "executable routes" }),
    /* Honest about its own narrowness: with one provider and one allowlist the
       only change this can currently see is Ryntra's own configuration. It
       still fires truthfully for the person watching — what changed for them
       is that the instrument became executable — and it stops being merely
       self-observation when a second adapter exists (RYN-TM-005). */
    gate: null,
    threshold: null,
  }),
  Object.freeze({
    kind: "corporate-action" as const,
    label: "A corporate action takes effect or is scheduled",
    question: "Has the multiplier moved, or is it about to?",
    source: Object.freeze({ feed: "chain:robinhood", field: "uiMultiplier() / newUIMultiplier() / effectiveAt()" }),
    gate: null,
    threshold: null,
  }),
  Object.freeze({
    kind: "spread-exceeds" as const,
    label: "The spread exceeds a threshold",
    question: "Has it become expensive to get in or out?",
    source: null,
    gate: "No endpoint this product reads returns a bid, an ask or a book. The spot overview carries a single price and the token registry carries none, so there is nothing to threshold.",
    threshold: null,
  }),
  Object.freeze({
    kind: "depth-passes" as const,
    label: "Depth passes a threshold",
    question: "Could I still get out at size?",
    source: null,
    gate: "The venue reports 24-hour volume, which is not depth. Depth needs pool state and a source for it.",
    threshold: null,
  }),
  Object.freeze({
    kind: "strategy-condition" as const,
    label: "A Strategy condition becomes true",
    question: "Did this asset enter a condition one of my strategies is waiting for?",
    source: null,
    gate: "Strategy Lab is RYN-SLAB-001 and is owner-parked BLOCKED. There is no strategy to bind to, so this is registered as the condition the canon names rather than as a field that could only ever be empty.",
    threshold: null,
  }),
]);

export function alertSpec(kind: WatchAlertKind): AlertSpec | undefined {
  return ALERT_SPECS.find((spec) => spec.kind === kind);
}

export type WatchAlert = Readonly<{ kind: WatchAlertKind; threshold: number | null }>;

/**
 * Arm a condition, or refuse.
 *
 * A condition with no source cannot be armed, because arming it would be a
 * promise to raise something that can never be raised. The refusal is the
 * whole reason this is a function rather than an object literal.
 */
export function arm(kind: WatchAlertKind, threshold: number | null): WatchAlert | null {
  const spec = alertSpec(kind);
  if (!spec || !spec.source) return null;
  if (!spec.threshold) return Object.freeze({ kind, threshold: null });
  const raw = typeof threshold === "number" && Number.isFinite(threshold) ? threshold : spec.threshold.fallback;
  const clamped = Math.min(spec.threshold.max, Math.max(spec.threshold.min, raw));
  return Object.freeze({ kind, threshold: clamped });
}

/** The condition as a person reads it. The single source of an alert's headline. */
export function describeAlert(alert: WatchAlert): string {
  const spec = alertSpec(alert.kind);
  if (!spec) return alert.kind;
  if (!spec.threshold || alert.threshold === null) return spec.label;
  return `${spec.label} by at least ${alert.threshold}${spec.threshold.unit}`;
}

/**
 * A condition that was true.
 *
 * `condition` is not a parameter. It is computed from the alert, which is what
 * makes "states the condition that fired rather than the value that moved"
 * structural: there is no call site at which a caller could pass `NVDA −6.31%`
 * as the headline, because there is no headline argument.
 */
export type FiredAlert = Readonly<{
  kind: WatchAlertKind;
  condition: string;
  /** What was read. Beside the condition, never instead of it. */
  observed: string;
  source: EventSource;
}>;

function fire(alert: WatchAlert, observed: string, source: EventSource): FiredAlert {
  return Object.freeze({ kind: alert.kind, condition: describeAlert(alert), observed, source });
}

/** An armed condition that could not be judged, and the reason. Never silently quiet. */
export type UnjudgedAlert = Readonly<{ kind: WatchAlertKind; reason: string }>;

export type AlertEvaluation = Readonly<{ fired: readonly FiredAlert[]; unjudged: readonly UnjudgedAlert[] }>;

/**
 * What one armed condition is currently saying.
 *
 * The fourth state is the one that matters and the one a surface gets wrong by
 * accident: **`unchecked` is not `quiet`.** An entry that has not been
 * evaluated yet — just added, or the venue read failed — has nothing to say
 * about its conditions, and rendering that as *not true right now* is the same
 * defect as scoring an absent price/earnings ratio a miss. It reports a
 * finding nobody made.
 *
 * It lives here rather than in the component for exactly that reason: a
 * four-way decision written inline in JSX collapses to a three-way one the
 * first time somebody writes `fired ? … : quiet`, and no test would see it.
 */
export type ConditionState =
  | Readonly<{ state: "fired"; fired: FiredAlert }>
  | Readonly<{ state: "unjudged"; reason: string }>
  | Readonly<{ state: "quiet" }>
  | Readonly<{ state: "unchecked" }>;

export function conditionState(alert: WatchAlert, evaluation: AlertEvaluation | null): ConditionState {
  if (evaluation === null) return Object.freeze({ state: "unchecked" as const });
  const fired = evaluation.fired.find((candidate) => candidate.kind === alert.kind);
  if (fired) return Object.freeze({ state: "fired" as const, fired });
  const unjudged = evaluation.unjudged.find((candidate) => candidate.kind === alert.kind);
  if (unjudged) return Object.freeze({ state: "unjudged" as const, reason: unjudged.reason });
  return Object.freeze({ state: "quiet" as const });
}

/* ------------------------------------------------------------------ entries */

export const MAX_ENTRIES = 25;
/** Bounded history, and the bound is reported rather than hidden — see `dropped`. */
export const MAX_EVENTS = 40;
export const MAX_ALERTS = 6;
export const MAX_NOTE = 280;

export type WatchEntry = Readonly<{
  /** Identity. The one field with no event, because it is what events happen to. */
  address: string;
  addedAt: number;
  note: string;
  alerts: readonly WatchAlert[];
  seen: WatchSeen;
  history: readonly WatchEvent[];
  /**
   * Events the cap has discarded.
   *
   * "History intact" cannot be claimed by a list that silently forgets its
   * oldest entries, so the count survives even when the events do not, and the
   * surface says *40 shown, 12 older dropped*.
   */
  dropped: number;
}>;

function seenFrom(observation: Observation, reference: Readonly<{ price: number; at: number }> | null): WatchSeen {
  const row = observation.row;
  const chain = observation.chain;
  return Object.freeze({
    symbol: row?.symbol ?? "",
    name: row?.name ?? "",
    listed: row !== null,
    venueVerified: row?.venueVerified ?? false,
    instrumentClass: row?.instrumentClass ?? null,
    classAgreed: row ? row.origin.agreed : true,
    routes: routeIds(row),
    marketTypes: marketTypes(observation),
    priced: row ? row.price.known : false,
    reference,
    uiMultiplier: chain?.uiMultiplier ?? null,
    corporateActionAt: chain?.effectiveAt ?? null,
    scheduledAction:
      chain?.uiMultiplier != null && chain.newUiMultiplier != null && chain.newUiMultiplier !== chain.uiMultiplier,
    oraclePaused: chain?.oraclePaused ?? null,
  });
}

/**
 * Start watching an address.
 *
 * The entry is born with its history already carrying what the chain knows:
 * `effectiveAt()` is the corporate action **that already happened**, dated, so
 * an entry created today can state an action from three weeks ago. Measured
 * 2026-08-19: eight of the 196 stock-class tokens carry a multiplier off unity
 * and `effectiveAt` is non-zero on exactly those eight — the two sets are
 * equal, which is what makes the field readable as history rather than as a
 * schedule.
 */
export function watch(observation: Observation, note: string, alerts: readonly WatchAlert[]): WatchEntry {
  const price = observation.row?.price.known ? observation.row.price.value : null;
  const seen = seenFrom(observation, price === null ? null : Object.freeze({ price, at: observation.at }));
  const history: WatchEvent[] = [
    record(
      "watched",
      observation.at,
      observation.at,
      seen.listed ? `Watching ${seen.symbol} — ${seen.name}` : "Watching an address the venue does not list",
      null,
      feed("arcus:spot-tokens", "address", observation.at),
    ),
  ];

  const effectiveAt = observation.chain?.effectiveAt ?? 0;
  if (effectiveAt && observation.chain?.uiMultiplier) {
    history.push(
      record(
        "corporate-action-applied",
        effectiveAt * 1000,
        observation.at,
        "A corporate action was already in force when this entry was created",
        `uiMultiplier ${showMultiplier(observation.chain.uiMultiplier)}`,
        feed("chain:robinhood", "effectiveAt()", observation.at),
      ),
    );
  }

  return Object.freeze({
    address: observation.address,
    addedAt: observation.at,
    note: note.slice(0, MAX_NOTE),
    alerts: Object.freeze(alerts.slice(0, MAX_ALERTS)),
    seen,
    history: Object.freeze(history.sort((a, b) => a.at - b.at)),
    dropped: 0,
  });
}

/* ------------------------------------------------------------- reconciling */

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value) => b.includes(value));

/**
 * Compare what an entry last saw against what is true now, and say what
 * changed.
 *
 * Nothing here edits an observation into the entry destructively: every
 * difference produces an event first, and the new `seen` is what the *next*
 * comparison runs against. That ordering is what "survives a route change with
 * its history intact" means in code — the old route is not overwritten, it is
 * superseded by a record of its withdrawal.
 */
export function reconcile(
  entry: WatchEntry,
  observation: Observation,
  now: number,
): Readonly<{ seen: WatchSeen; events: readonly WatchEvent[] }> {
  const before = entry.seen;
  const row = observation.row;
  const events: WatchEvent[] = [];
  const add = (
    kind: WatchEventKind,
    headline: string,
    observed: string | null,
    feedName: string,
    field: string,
    at = now,
  ) => events.push(record(kind, at, now, headline, observed, feed(feedName, field, observation.at)));

  /* Listing. A delisted entry is not judged on anything else this pass: the
     venue is no longer describing it, so every other difference would be a
     comparison against nothing. */
  if (before.listed && !row) {
    add(
      "delisted",
      `The venue's registry no longer lists this address as ${before.symbol}`,
      before.symbol,
      "arcus:spot-tokens",
      "address",
    );
    return Object.freeze({ seen: seenFrom(observation, before.reference), events: Object.freeze(events) });
  }
  if (!before.listed && row) {
    add("relisted", `The venue lists this address again, as ${row.symbol}`, row.symbol, "arcus:spot-tokens", "address");
  }

  if (row) {
    if (before.listed && before.symbol && before.symbol !== row.symbol) {
      add(
        "symbol-changed",
        `The venue now calls this contract ${row.symbol}; it was ${before.symbol} when this entry was made`,
        `${before.symbol} → ${row.symbol}`,
        "arcus:spot-tokens",
        "symbol",
      );
    }
    if (before.listed && before.name && before.name !== row.name) {
      add("name-changed", `Renamed to ${row.name}`, `${before.name} → ${row.name}`, "arcus:spot-tokens", "name");
    }
    if (before.listed && before.venueVerified !== row.venueVerified) {
      add(
        row.venueVerified ? "verification-granted" : "verification-withdrawn",
        row.venueVerified
          ? "The venue's registry now marks this token verified"
          : "The venue's registry no longer marks this token verified",
        String(row.venueVerified),
        "arcus:spot-tokens",
        "verified",
      );
    }
    if (before.listed && before.instrumentClass && before.instrumentClass !== row.instrumentClass) {
      add(
        "class-changed",
        `Class changed to ${row.instrumentClass}`,
        `${before.instrumentClass} → ${row.instrumentClass}`,
        "arcus:spot-tokens + spot-overview",
        "category",
      );
    }
    if (before.listed && before.classAgreed !== row.origin.agreed) {
      add(
        row.origin.agreed ? "class-disagreement-resolved" : "class-disagreement-appeared",
        row.origin.agreed
          ? "The venue's two endpoints agree about this token's class again"
          : "The venue's two endpoints now disagree about this token's class",
        row.origin.agreed ? null : `${row.origin.tokenCategory} vs ${row.origin.overviewCategory}`,
        "arcus:spot-tokens + spot-overview",
        "category",
      );
    }
    if (before.listed && before.priced !== row.price.known) {
      add(
        row.price.known ? "price-restored" : "price-unavailable",
        row.price.known ? "The venue prices this token again" : row.price.reason,
        row.price.known ? row.price.value.toString() : null,
        "arcus:spot-overview",
        "quote.price",
      );
    }
  }

  /* Routes. A set comparison rather than a length one: a route replaced by a
     different provider keeps the count and changes everything. */
  const routes = routeIds(row);
  if (before.listed && !sameSet(before.routes, routes)) {
    for (const route of routes) {
      if (!before.routes.includes(route)) {
        add("route-appeared", `A route appeared: ${route}`, route, "ryntra:spot-exec-policy", "executable routes");
      }
    }
    for (const route of before.routes) {
      if (!routes.includes(route)) {
        add("route-withdrawn", `A route was withdrawn: ${route}`, route, "ryntra:spot-exec-policy", "executable routes");
      }
    }
  }

  const types = marketTypes(observation);
  if (before.listed) {
    for (const type of types) {
      if (!before.marketTypes.includes(type)) {
        add("market-type-appeared", `The venue runs a ${type} market for this asset`, type, "arcus:/v1/markets", "baseAsset");
      }
    }
    for (const type of before.marketTypes) {
      if (!types.includes(type)) {
        add("market-type-withdrawn", `The venue no longer runs a ${type} market for this asset`, type, "arcus:/v1/markets", "baseAsset");
      }
    }
  }

  /* The chain. An unread multiplier changes nothing: `null` means the read did
     not happen, and treating it as a change would raise a corporate action out
     of an RPC timeout. */
  const chain = observation.chain;
  if (chain?.uiMultiplier != null) {
    const appliedAt = chain.effectiveAt ?? 0;
    const multiplierMoved = before.uiMultiplier != null && before.uiMultiplier !== chain.uiMultiplier;
    const dateMoved = appliedAt > 0 && (before.corporateActionAt ?? 0) !== appliedAt;
    if (multiplierMoved || dateMoved) {
      add(
        "corporate-action-applied",
        "A corporate action took effect: the on-chain multiplier changed",
        `${showMultiplier(before.uiMultiplier)} → ${showMultiplier(chain.uiMultiplier)}`,
        "chain:robinhood",
        "uiMultiplier() / effectiveAt()",
        appliedAt > 0 ? appliedAt * 1000 : now,
      );
    }
    const scheduled = chain.newUiMultiplier != null && chain.newUiMultiplier !== chain.uiMultiplier;
    if (scheduled && !before.scheduledAction) {
      add(
        "corporate-action-scheduled",
        "A multiplier change is scheduled on chain",
        `${showMultiplier(chain.uiMultiplier)} → ${showMultiplier(chain.newUiMultiplier)}`,
        "chain:robinhood",
        "newUIMultiplier()",
      );
    }
  }
  if (chain?.oraclePaused != null && before.oraclePaused != null && chain.oraclePaused !== before.oraclePaused) {
    add(
      chain.oraclePaused ? "oracle-paused" : "oracle-resumed",
      chain.oraclePaused ? "The price oracle for this token is paused" : "The price oracle for this token resumed",
      String(chain.oraclePaused),
      "chain:robinhood",
      "oraclePaused()",
    );
  }

  return Object.freeze({ seen: seenFrom(observation, before.reference), events: Object.freeze(events) });
}

/* ------------------------------------------------------- alert evaluation */

/**
 * Evaluate the armed conditions against the current observation.
 *
 * An armed condition that cannot be read is reported in `unjudged` rather than
 * left out, for the reason the Screener returns a third verdict: silence that
 * means *nothing fired* and silence that means *nothing could be checked* look
 * identical on a page, and only one of them is good news.
 */
export function evaluateAlerts(entry: WatchEntry, observation: Observation, now: number): AlertEvaluation {
  const fired: FiredAlert[] = [];
  const unjudged: UnjudgedAlert[] = [];
  const source = (feedName: string, field: string) => feed(feedName, field, observation.at);

  for (const alert of entry.alerts) {
    const spec = alertSpec(alert.kind);
    if (!spec?.source) {
      unjudged.push(Object.freeze({ kind: alert.kind, reason: spec?.gate ?? "this condition has no source" }));
      continue;
    }

    if (alert.kind === "price-moves") {
      const reference = entry.seen.reference;
      const price = observation.row?.price.known ? observation.row.price.value : null;
      if (!reference || price === null) {
        unjudged.push(
          Object.freeze({
            kind: alert.kind,
            reason: !reference
              ? "no reference price was recorded, so there is nothing to measure movement from"
              : (observation.row?.price.known === false ? observation.row.price.reason : "the venue does not list this token"),
          }),
        );
        continue;
      }
      const percent = ((price - reference.price) / reference.price) * 100;
      if (Math.abs(percent) >= (alert.threshold ?? Number.POSITIVE_INFINITY)) {
        fired.push(
          fire(
            alert,
            `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)}% against ${reference.price} recorded ${new Date(reference.at).toISOString().slice(0, 10)}`,
            source("arcus:spot-overview", "quote.price"),
          ),
        );
      }
      continue;
    }

    if (alert.kind === "underlying-closes") {
      if (!observation.market || observation.market.isOutsideRth === null) {
        unjudged.push(
          Object.freeze({
            kind: alert.kind,
            reason: "the venue runs no perps market for this asset, and market hours are only reported there — 33 of 231 instruments can be judged on this",
          }),
        );
        continue;
      }
      if (observation.market.isOutsideRth) {
        fired.push(fire(alert, "the underlying market is outside regular trading hours", source("arcus:/v1/markets", "isOutsideRth")));
      }
      continue;
    }

    if (alert.kind === "route-appears") {
      const appeared = routeIds(observation.row).filter((route) => !entry.seen.routes.includes(route));
      if (appeared.length) {
        fired.push(fire(alert, appeared.join(", "), source("ryntra:spot-exec-policy", "executable routes")));
      }
      continue;
    }

    if (alert.kind === "corporate-action") {
      const chain = observation.chain;
      if (!chain || chain.uiMultiplier == null) {
        unjudged.push(
          Object.freeze({
            kind: alert.kind,
            reason: "the on-chain multiplier could not be read; only a Stock Token carries one, and an unread value is never taken as 1.0",
          }),
        );
        continue;
      }
      const scheduled = chain.newUiMultiplier != null && chain.newUiMultiplier !== chain.uiMultiplier;
      const applied =
        (entry.seen.uiMultiplier != null && entry.seen.uiMultiplier !== chain.uiMultiplier) ||
        ((chain.effectiveAt ?? 0) > 0 && (entry.seen.corporateActionAt ?? 0) !== (chain.effectiveAt ?? 0));
      if (scheduled || applied) {
        fired.push(
          fire(
            alert,
            scheduled ? `scheduled: ${showMultiplier(chain.uiMultiplier)} → ${showMultiplier(chain.newUiMultiplier)}` : `in force since ${new Date((chain.effectiveAt ?? 0) * 1000).toISOString().slice(0, 10)}`,
            source("chain:robinhood", scheduled ? "newUIMultiplier()" : "effectiveAt()"),
          ),
        );
      }
      continue;
    }

    /* Unreachable while ALERT_SPECS and WatchAlertKind agree — and reported
       rather than dropped if they ever stop agreeing. */
    unjudged.push(Object.freeze({ kind: alert.kind, reason: "this condition has no evaluator" }));
  }

  void now;
  return Object.freeze({ fired: Object.freeze(fired), unjudged: Object.freeze(unjudged) });
}

/* ---------------------------------------------------------------- applying */

/**
 * Fold a reconciliation and any fired alerts into the entry.
 *
 * History is append-only and capped. When the cap bites, `dropped` grows by
 * exactly what was discarded — the count is the difference between a bounded
 * history and a history that quietly lies about being complete.
 *
 * A fired price condition re-bases the reference to the price that fired it.
 * Without that, one 5% move keeps firing forever and the alert becomes a
 * permanent state rather than an event.
 */
export function apply(
  entry: WatchEntry,
  reconciliation: Readonly<{ seen: WatchSeen; events: readonly WatchEvent[] }>,
  evaluation: AlertEvaluation,
  observation: Observation,
  now: number,
): WatchEntry {
  const alertEvents = evaluation.fired.map((firedAlert) =>
    record("alert-fired", now, now, firedAlert.condition, firedAlert.observed, firedAlert.source),
  );

  const merged = [...entry.history, ...reconciliation.events, ...alertEvents].sort((a, b) => a.at - b.at);
  const overflow = Math.max(0, merged.length - MAX_EVENTS);
  const history = overflow ? merged.slice(overflow) : merged;

  const priceFired = evaluation.fired.some((firedAlert) => firedAlert.kind === "price-moves");
  const price = observation.row?.price.known ? observation.row.price.value : null;
  const reference =
    priceFired && price !== null
      ? Object.freeze({ price, at: now })
      : reconciliation.seen.reference ?? (price === null ? null : Object.freeze({ price, at: now }));

  return Object.freeze({
    address: entry.address,
    addedAt: entry.addedAt,
    note: entry.note,
    alerts: entry.alerts,
    seen: Object.freeze({ ...reconciliation.seen, reference }),
    history: Object.freeze(history),
    dropped: entry.dropped + overflow,
  });
}

/**
 * The last meaningful change, derived.
 *
 * Never stored beside the history it summarises. Two lists that must agree
 * will not — this repository has written that sentence after each of the times
 * it happened — and a `lastChange` field is the smallest possible version of
 * the same mistake.
 */
export function lastMeaningfulChange(entry: WatchEntry): WatchEvent | null {
  const changes = entry.history.filter((event) => event.kind !== "watched");
  return changes.length ? changes[changes.length - 1] : null;
}

/** Whether an event predates the entry — read off the chain rather than witnessed. */
export function isInherited(entry: WatchEntry, event: WatchEvent): boolean {
  return event.at < entry.addedAt;
}
