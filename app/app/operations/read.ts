import type { HomePortfolioProjection } from "@/lib/home/portfolio/read-model";
import type { ResearchProjection } from "@/lib/home/research/read-model";
import { ADVICE_AUTHORITY } from "@/lib/home/advice/advice-case";
import {
  buildOperations,
  type KillSwitch,
  type OperationsProjection,
  type ProviderHealth,
} from "@/lib/home/operations/operations";
import { regulatoryPerimeter, type RegulatoryPerimeter } from "@/lib/home/regulatory/capability-state";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { HomeReads } from "@/app/app/home-reads";

/**
 * Where operational truth comes from — and none of it is authored here.
 *
 * **Provider health is the source states the product already computes.** The
 * Radar and the Portfolio each read their sources and each record `OK / STALE /
 * FAILED`; this layer maps those onto `UP / DEGRADED / DOWN` and attaches the
 * capabilities that depend on each one. No new probe, no new endpoint, no
 * synthetic uptime figure — a second measurement of the same provider would
 * eventually disagree with the first, and the reader would have no way to know
 * which page was lying.
 *
 * **The kill switches are derived from real constants**, not from a hand-written
 * list of things that are off. Personalized advice reads its state from
 * `ADVICE_AUTHORITY`; order transmission and discretion read theirs from the
 * regulatory perimeter. That is why they are all `TRIPPED` today and why the
 * day one of them is not, this page changes without anybody editing it.
 *
 * **No record exists for the perimeter, and that is the honest input.** No
 * provider contract, counsel opinion or product-perimeter record has been
 * captured for this product, so the perimeter is evaluated against an empty
 * record set and every regulated operation fails closed with `NO_RECORD`.
 * Nothing here fabricates a record to make the page look complete.
 */

/** Instrument class the perimeter is evaluated for today. */
export const PERIMETER_INSTRUMENT_CLASS = "TOKENIZED_EQUITY";

/* Deliberately not localized: `lib/home/operations` concatenates this policy
   onto its own English sentence ("Served from the last observation. …"), and a
   half-translated sentence is worse than a consistent English one. */
const DEGRADATION_POLICY: Readonly<Record<string, string>> = {
  DEFAULT: "Serve the last observation with its age; refuse any calculation that needs a current one.",
};

/**
 * The reader-facing literals this mapping layer authors, per locale, in this
 * file — release checks regex this source for the exact English strings.
 * English is byte-identical to what shipped; `uk` is its twin. Reasons carried
 * from the regulatory perimeter (`lib/`) pass through untouched, so a kill
 * switch can end in an English perimeter sentence by design.
 */
type OperationsReadCopy = Readonly<{
  affectsChanges: string;
  affectsEvidence: string;
  affectsValuation: string;
  researchSurface: string;
  connectionsSurface: string;
  decisionsSurface: string;
  capabilitiesSurface: string;
  adviceLabel: string;
  adviceAuthority: string;
  adviceReason: (authority: string) => string;
  transmissionLabel: string;
  transmissionAuthority: string;
  transmissionFallback: string;
  discretionLabel: string;
  discretionAuthority: string;
  discretionFallback: string;
  executionLabel: string;
  executionAuthority: string;
  executionReason: string;
}>;

const COPY = {
  en: {
    affectsChanges: "Material change detection",
    affectsEvidence: "Research evidence",
    affectsValuation: "Portfolio valuation",
    researchSurface: "Research",
    connectionsSurface: "Connections",
    decisionsSurface: "Decisions",
    capabilitiesSurface: "Capabilities",
    adviceLabel: "Personalized advice",
    adviceAuthority: "Product perimeter",
    adviceReason: (authority: string) => "Every decision record carries adviceAuthority " + authority
      + " and a recommendation typed null. The product issues no personalized recommendation and structurally cannot. ",
    transmissionLabel: "Live order transmission",
    transmissionAuthority: "Regulatory perimeter",
    transmissionFallback: "No record permits order transmission.",
    discretionLabel: "Autonomy and discretion",
    discretionAuthority: "Regulatory perimeter and Agent Control",
    discretionFallback: "No record permits discretionary management.",
    executionLabel: "Execution kill switch",
    executionAuthority: "The signing session",
    executionReason: "This switch lives in the browser session that would prepare an execution, so no server render can read its state.",
  },
  uk: {
    affectsChanges: "Виявлення суттєвих змін",
    affectsEvidence: "Дослідницькі докази",
    affectsValuation: "Оцінка портфеля",
    researchSurface: "Дослідження",
    connectionsSurface: "Підключення",
    decisionsSurface: "Рішення",
    capabilitiesSurface: "Можливості",
    adviceLabel: "Персональні поради",
    adviceAuthority: "Периметр продукту",
    adviceReason: (authority: string) => "Кожен запис рішення несе adviceAuthority " + authority
      + " і рекомендацію з типом null. Продукт не видає персональних рекомендацій і структурно не може. ",
    transmissionLabel: "Передача ордерів наживо",
    transmissionAuthority: "Регуляторний периметр",
    transmissionFallback: "Жоден запис не дозволяє передачу ордерів.",
    discretionLabel: "Автономія та дискреція",
    discretionAuthority: "Регуляторний периметр і Agent Control",
    discretionFallback: "Жоден запис не дозволяє дискреційне управління.",
    executionLabel: "Аварійний вимикач виконання",
    executionAuthority: "Сесія підпису",
    executionReason: "Цей вимикач живе в сесії браузера, яка готувала б виконання, тому жоден серверний рендер не може зчитати його стан.",
  },
} as const satisfies Record<WorkspaceLocale, OperationsReadCopy>;

function providersFrom(
  research: ResearchProjection | null,
  portfolio: HomePortfolioProjection | null,
  c: OperationsReadCopy,
): readonly ProviderHealth[] {
  const providers = new Map<string, ProviderHealth>();

  const map = (state: "OK" | "STALE" | "FAILED"): ProviderHealth["state"] =>
    state === "OK" ? "UP" : state === "STALE" ? "DEGRADED" : "DOWN";

  for (const source of research?.sources ?? []) {
    providers.set(source.sourceId, {
      providerId: source.sourceId,
      label: source.label,
      state: map(source.state),
      observedAt: source.state === "OK" ? (research?.asOf ?? null) : null,
      firstFailureAt: null,
      reason: source.reason,
      affects: [c.affectsChanges, c.affectsEvidence],
      degradationPolicy: DEGRADATION_POLICY.DEFAULT,
      owner: { surface: c.researchSurface, href: "/app/research" },
    });
  }

  for (const source of portfolio?.sources ?? []) {
    const existing = providers.get(source.sourceId);
    if (existing !== undefined) {
      providers.set(source.sourceId, {
        ...existing,
        affects: [...existing.affects, c.affectsValuation],
      });
      continue;
    }
    providers.set(source.sourceId, {
      providerId: source.sourceId,
      label: source.label,
      state: map(source.state),
      observedAt: source.state === "OK" ? source.observedAt : null,
      firstFailureAt: null,
      reason: source.reason,
      affects: [c.affectsValuation],
      degradationPolicy: DEGRADATION_POLICY.DEFAULT,
      owner: { surface: c.connectionsSurface, href: "/app/connect" },
    });
  }

  return [...providers.values()];
}

/**
 * The switches, read from what actually decides each one.
 *
 * Every entry names the constant or record that holds it, so a reader can check
 * the claim rather than take the chip's word for it. None of them can be thrown
 * from this page and one of them cannot be read from a server at all.
 */
function killSwitches(perimeter: RegulatoryPerimeter, c: OperationsReadCopy): readonly KillSwitch[] {
  const advice = perimeter.operations.find((entry) => entry.operation === "PERSONALIZED_ADVICE");
  const transmission = perimeter.operations.find((entry) => entry.operation === "ORDER_TRANSMISSION");
  const discretion = perimeter.operations.find((entry) => entry.operation === "DISCRETIONARY_MANAGEMENT");

  return [
    {
      switchId: "advice",
      label: c.adviceLabel,
      state: ADVICE_AUTHORITY === "NONE" ? "TRIPPED" : "ARMED",
      authority: c.adviceAuthority,
      reason: c.adviceReason(ADVICE_AUTHORITY) + (advice?.reason ?? ""),
      owner: { surface: c.decisionsSurface, href: "/app/action-cases" },
    },
    {
      switchId: "order-transmission",
      label: c.transmissionLabel,
      state: transmission?.state === "ALLOWED" ? "ARMED" : "TRIPPED",
      authority: c.transmissionAuthority,
      reason: transmission?.reason ?? c.transmissionFallback,
      owner: { surface: c.capabilitiesSurface, href: "/docs/current-capabilities" },
    },
    {
      switchId: "discretion",
      label: c.discretionLabel,
      state: discretion?.state === "ALLOWED" ? "ARMED" : "TRIPPED",
      authority: c.discretionAuthority,
      reason: discretion?.reason ?? c.discretionFallback,
      owner: { surface: "Agent Control", href: "/agents/workspace" },
    },
    {
      switchId: "execution",
      label: c.executionLabel,
      /* Genuinely unreadable from a server: the switch lives in the session
         that would prepare an execution. Saying UNKNOWN is the fact. */
      state: "UNKNOWN",
      authority: c.executionAuthority,
      reason: c.executionReason,
      owner: { surface: "Agent Control", href: "/agents/workspace" },
    },
  ];
}

export function projectOperationsSurface(input: Readonly<{
  reads: HomeReads;
  asOf: string;
  userContextVersion: string;
  locale?: WorkspaceLocale;
}>): OperationsProjection {
  const c = COPY[input.locale ?? "en"];
  const perimeter = regulatoryPerimeter({
    /* Empty, and that is the input. No provider contract, counsel opinion or
       perimeter record has been captured, so every regulated operation fails
       closed with the reason rather than being quietly permitted. */
    records: [],
    userContextVersion: input.userContextVersion,
    instrumentClass: PERIMETER_INSTRUMENT_CLASS,
    asOf: input.asOf,
  });

  return buildOperations({
    asOf: input.asOf,
    providers: providersFrom(input.reads.research, input.reads.portfolio, c),
    killSwitches: killSwitches(perimeter, c),
    perimeter,
  });
}
