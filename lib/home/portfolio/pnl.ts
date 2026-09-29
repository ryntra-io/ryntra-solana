import { addDecimal, decimal, type MoneyValue, type RoundingMode } from "./decimal.ts";
import { parseExplicitInstant } from "./freshness.ts";

/**
 * P&L decomposition — four components, two books, one conditional Net.
 *
 * The load-bearing refusal is Net. A profit-and-loss figure is only a fact if
 * every part of it was measured the same way: the same currency, the same
 * period, the same measurement basis and the same sign convention. Add a
 * mark-to-market unrealized figure to a cash-settled realized one and the
 * result is a number with no referent, which is worse than no number because it
 * looks like an answer. So Net is withheld with its reasons rather than
 * estimated, and it is computed here — the surface renders it and never
 * arithmetics it.
 *
 * The second refusal is zero. A source that reports `0` fees reported a fact; a
 * source that has no fee contract reported nothing. Both used to render as
 * `$0`, and only one of them was true.
 */
export const PNL_COMPONENTS = ["REALIZED", "UNREALIZED", "FEES", "FUNDING"] as const;

export type PnlComponent = (typeof PNL_COMPONENTS)[number];

export const PNL_BOOKS = ["LIVE", "PAPER"] as const;

export type PnlBook = (typeof PNL_BOOKS)[number];

/** How a component was measured. Two components agree only if these agree. */
export type PnlBasis = Readonly<{
  periodStart: string;
  periodEnd: string;
  sign: string;
  measure: string;
}>;

export type PnlObservation =
  | Readonly<{
      component: PnlComponent;
      book: PnlBook;
      state: "REPORTED";
      value: MoneyValue;
      sourceRef: string;
      observedAt: string;
      basis: PnlBasis;
    }>
  | Readonly<{
      component: PnlComponent;
      book: PnlBook;
      state: "UNKNOWN" | "UNAVAILABLE";
      reason: string;
      sourceRef: string | null;
      observedAt: string | null;
    }>;

export type PnlComponentProjection = Readonly<{
  component: PnlComponent;
  book: PnlBook;
  state: "REPORTED" | "UNKNOWN" | "UNAVAILABLE";
  value: MoneyValue | null;
  reason: string | null;
  sourceRef: string | null;
  observedAt: string | null;
  basis: PnlBasis | null;
}>;

export type PnlNet =
  | Readonly<{
      state: "AVAILABLE";
      value: MoneyValue;
      basis: PnlBasis;
      sourceRefs: readonly string[];
    }>
  | Readonly<{ state: "WITHHELD"; reasons: readonly string[] }>;

export type PnlProjection = Readonly<{
  book: PnlBook;
  components: readonly PnlComponentProjection[];
  net: PnlNet;
}>;

export type PnlBooks = Readonly<{ live: PnlProjection; paper: PnlProjection }>;

function requireInstant(value: string, label: string): void {
  if (parseExplicitInstant(value) === null) {
    throw new TypeError(`${label} requires an explicit-offset instant`);
  }
}

function missing(component: PnlComponent, book: PnlBook): PnlComponentProjection {
  return Object.freeze({
    component,
    book,
    state: "UNKNOWN" as const,
    value: null,
    reason: "no source reported this component for this book",
    sourceRef: null,
    observedAt: null,
    basis: null,
  });
}

function projectComponent(observation: PnlObservation): PnlComponentProjection {
  if (observation.state === "REPORTED") {
    requireInstant(observation.observedAt, `${observation.book} ${observation.component} observation`);
    requireInstant(observation.basis.periodStart, `${observation.book} ${observation.component} period start`);
    requireInstant(observation.basis.periodEnd, `${observation.book} ${observation.component} period end`);
    /* Validating the magnitude through the foundation rather than trusting the
       caller's object shape: a component that cannot be added is not a value. */
    decimal(observation.value.amount.units, observation.value.amount.scale);
    return Object.freeze({
      component: observation.component,
      book: observation.book,
      state: "REPORTED" as const,
      value: observation.value,
      reason: null,
      sourceRef: observation.sourceRef,
      observedAt: observation.observedAt,
      basis: observation.basis,
    });
  }
  if (observation.observedAt !== null) {
    requireInstant(observation.observedAt, `${observation.book} ${observation.component} observation`);
  }
  return Object.freeze({
    component: observation.component,
    book: observation.book,
    state: observation.state,
    value: null,
    reason: observation.reason,
    sourceRef: observation.sourceRef,
    observedAt: observation.observedAt,
    basis: null,
  });
}

function projectNet(
  components: readonly PnlComponentProjection[],
  settings: Readonly<{ scale: number; roundingMode: RoundingMode; displayCurrency: string }>,
): PnlNet {
  const incomplete = components.filter((entry) => entry.state !== "REPORTED");
  if (incomplete.length > 0) {
    return Object.freeze({
      state: "WITHHELD" as const,
      reasons: Object.freeze(incomplete.map((entry) => `${entry.component} is ${entry.state}`)),
    });
  }

  const reference = components[0];
  const basis = reference.basis as PnlBasis;
  const reasons: string[] = [];
  for (const entry of components) {
    const value = entry.value as MoneyValue;
    const entryBasis = entry.basis as PnlBasis;
    if (value.currency !== settings.displayCurrency) {
      reasons.push(`${entry.component} currency ${value.currency} is not the projection currency ${settings.displayCurrency}`);
      continue;
    }
    if (entryBasis.periodStart !== basis.periodStart || entryBasis.periodEnd !== basis.periodEnd) {
      reasons.push(`${entry.component} period ${entryBasis.periodStart}/${entryBasis.periodEnd} is not the projection period ${basis.periodStart}/${basis.periodEnd}`);
      continue;
    }
    if (entryBasis.measure !== basis.measure) {
      reasons.push(`${entry.component} measure ${entryBasis.measure} is not the projection measure ${basis.measure}`);
      continue;
    }
    if (entryBasis.sign !== basis.sign) {
      reasons.push(`${entry.component} sign ${entryBasis.sign} is not the projection sign ${basis.sign}`);
    }
  }
  if (reasons.length > 0) return Object.freeze({ state: "WITHHELD" as const, reasons: Object.freeze(reasons) });

  let total = decimal("0", settings.scale);
  for (const entry of components) {
    total = addDecimal(total, (entry.value as MoneyValue).amount, settings.scale, settings.roundingMode);
  }
  return Object.freeze({
    state: "AVAILABLE" as const,
    value: Object.freeze({ amount: total, currency: settings.displayCurrency }),
    basis,
    sourceRefs: Object.freeze(
      components
        .map((entry) => entry.sourceRef as string)
        .filter((value, index, all) => all.indexOf(value) === index)
        .sort(),
    ),
  });
}

/**
 * Both books, always both, and never each other's facts.
 *
 * Returning the pair rather than one book on request is what keeps them
 * separate at the call site: a surface cannot accidentally render the Live
 * decomposition under a Paper heading, because it never asks for "the" P&L.
 */
export function projectPnlBooks(input: Readonly<{
  scale: number;
  roundingMode: RoundingMode;
  displayCurrency: string;
  observations: readonly PnlObservation[];
}>): PnlBooks {
  const seen = new Set<string>();
  const byBook = new Map<PnlBook, Map<PnlComponent, PnlComponentProjection>>(
    PNL_BOOKS.map((book) => [book, new Map<PnlComponent, PnlComponentProjection>()]),
  );

  for (const observation of input.observations) {
    if (!PNL_COMPONENTS.includes(observation.component)) {
      throw new TypeError("unregistered P&L component");
    }
    if (!PNL_BOOKS.includes(observation.book)) throw new TypeError("unregistered P&L book");
    const key = `${observation.book}:${observation.component}`;
    if (seen.has(key)) {
      throw new TypeError(`duplicate ${observation.book} ${observation.component} observation`);
    }
    seen.add(key);
    (byBook.get(observation.book) as Map<PnlComponent, PnlComponentProjection>)
      .set(observation.component, projectComponent(observation));
  }

  const settings = {
    scale: input.scale,
    roundingMode: input.roundingMode,
    displayCurrency: input.displayCurrency,
  };
  const projections = PNL_BOOKS.map((book) => {
    const observed = byBook.get(book) as Map<PnlComponent, PnlComponentProjection>;
    const components = Object.freeze(
      PNL_COMPONENTS.map((component) => observed.get(component) ?? missing(component, book)),
    );
    return Object.freeze({ book, components, net: projectNet(components, settings) });
  });

  return Object.freeze({ live: projections[0], paper: projections[1] });
}
