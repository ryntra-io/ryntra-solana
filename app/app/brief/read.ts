import type { AttentionSeverity } from "@/lib/home/portfolio/attention";
import type { HomePortfolioProjection, HomeRiskCategory } from "@/lib/home/portfolio/read-model";
import type { ResearchProjection } from "@/lib/home/research/read-model";
import type { DecisionsProjection } from "@/lib/home/advice/read-model";
import { buildDailyBrief, type BriefEntry, type BriefQuietCheck, type DailyBrief } from "@/lib/home/brief/daily-brief";
import { DEFAULT_BRIEF_WINDOW_SECONDS, briefWindow } from "@/lib/home/brief/window";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { HomeReads } from "@/app/app/home-reads";

/**
 * Where each brief line comes from — and every one of them comes from a surface
 * that already owns it.
 *
 * The mapping is deliberately dull. A decision line is the decision queue's own
 * open question; a change line is the Radar's own material change; a portfolio
 * line is the Portfolio's own attention item or exceeded risk category; a
 * monitoring line is a source that did not answer or a rule with nothing
 * enrolled to run it. Nothing is recomputed and no severity is invented — where
 * the owning projection records one, it is carried; where it does not, the
 * default is stated here once rather than guessed per line.
 *
 * The window is the one thing this layer decides, and it decides it by refusing:
 * a server render cannot read the reader's last-visit marker, so it binds
 * `NOT_SERVER_READABLE` and the client island re-computes with the real value.
 */

/**
 * The reader-facing literals this mapping layer authors, per locale, in this
 * file — release checks regex this source for the exact English strings.
 * English is byte-identical to what shipped; `uk` is its twin. Labels and
 * reasons carried from the owning projections (`lib/`) pass through untouched.
 */
type BriefReadCopy = Readonly<{
  /**
   * The five risk categories, written out.
   *
   * The projection carries the id and nothing else, and an id on a brief line
   * is a word the reader has to decode. Kept here rather than added to the
   * projection because the Portfolio surface renders the id deliberately — it
   * is a column header there and a sentence here.
   */
  riskLabel: Readonly<Record<HomeRiskCategory["id"], string>>;
  riskTitle: (label: string) => string;
  riskDetail: string;
  staleSource: string;
  failedSource: string;
  unenrolledRule: string;
  surfaces: Readonly<{ decisions: string; research: string; portfolio: string; coverage: string }>;
  quiet: Readonly<{ portfolio: string; research: string; decisions: string }>;
}>;

const COPY = {
  en: {
    riskLabel: {
      EXPOSURE: "Exposure",
      CONCENTRATION: "Concentration",
      LIQUIDITY: "Liquidity",
      COMMITMENTS: "Commitments",
      EVIDENCE: "Evidence quality",
    },
    riskTitle: (label: string) => label + " above its declared limit",
    riskDetail: "The category is outside the bound you declared.",
    staleSource: "Answered, but outside its freshness window.",
    failedSource: "The last read did not succeed.",
    unenrolledRule: "This rule declares a schedule and nothing is enrolled to run it.",
    surfaces: {
      decisions: "Decisions",
      research: "Research",
      portfolio: "Portfolio",
      coverage: "Coverage",
    },
    quiet: {
      portfolio: "Portfolio valuation and risk categories",
      research: "Monitor rules and material-change thresholds",
      decisions: "The decision queue",
    },
  },
  uk: {
    riskLabel: {
      EXPOSURE: "Експозиція",
      CONCENTRATION: "Концентрація",
      LIQUIDITY: "Ліквідність",
      COMMITMENTS: "Зобовʼязання",
      EVIDENCE: "Якість доказів",
    },
    riskTitle: (label: string) => label + " — вище задекларованої межі",
    riskDetail: "Категорія поза межею, яку ви задекларували.",
    staleSource: "Відповіло, але поза своїм вікном свіжості.",
    failedSource: "Останнє читання не вдалося.",
    unenrolledRule: "Це правило декларує розклад, і ніщо не зареєстровано його запускати.",
    surfaces: {
      decisions: "Рішення",
      research: "Дослідження",
      portfolio: "Портфель",
      coverage: "Покриття",
    },
    quiet: {
      portfolio: "Оцінка портфеля та категорії ризику",
      research: "Правила моніторингу та пороги суттєвих змін",
      decisions: "Черга рішень",
    },
  },
} as const satisfies Record<WorkspaceLocale, BriefReadCopy>;

function decisionEntries(decisions: DecisionsProjection | null, c: BriefReadCopy): readonly BriefEntry[] {
  if (decisions === null) return [];
  return decisions.queue.map<BriefEntry>((entry) => ({
    id: entry.caseId,
    title: entry.trigger.subjectLabel,
    detail: entry.openQuestion,
    severity: "HIGH",
    observedAt: entry.trigger.observedAt,
    href: "/app/action-cases/" + entry.caseId,
    surface: c.surfaces.decisions,
  }));
}

function changeEntries(research: ResearchProjection | null, c: BriefReadCopy): readonly BriefEntry[] {
  if (research === null) return [];
  return research.changes
    .filter((change) => change.state === "MATERIAL")
    .map<BriefEntry>((change) => ({
      id: change.id,
      title: change.subjectLabel,
      detail: change.factKey + (change.measured === null ? "" : " · " + change.measured.value + (change.measured.unit ?? "")),
      severity: change.severity,
      observedAt: change.observedAt,
      href: "/app/research/" + change.id,
      surface: c.surfaces.research,
    }));
}

function portfolioEntries(portfolio: HomePortfolioProjection | null, c: BriefReadCopy): readonly BriefEntry[] {
  if (portfolio === null) return [];

  const attention = portfolio.attention.map<BriefEntry>((item) => ({
    id: "attention-" + item.id,
    title: item.title,
    detail: item.reason,
    severity: item.severity,
    observedAt: item.observedAt,
    href: item.detailHref ?? "/app/portfolio",
    surface: c.surfaces.portfolio,
  }));

  const exceeded = portfolio.risk
    .filter((category) => category.status === "EXCEEDED")
    .map<BriefEntry>((category) => ({
      id: "risk-" + category.id,
      title: c.riskTitle(c.riskLabel[category.id]),
      detail: category.limitations[0] ?? c.riskDetail,
      severity: "HIGH" as AttentionSeverity,
      observedAt: portfolio.asOf,
      href: category.detailHref ?? "/app/portfolio",
      surface: c.surfaces.portfolio,
    }));

  return [...attention, ...exceeded];
}

function monitoringEntries(
  research: ResearchProjection | null,
  portfolio: HomePortfolioProjection | null,
  c: BriefReadCopy,
): readonly BriefEntry[] {
  const entries: BriefEntry[] = [];

  for (const source of research?.sources ?? []) {
    if (source.state === "OK") continue;
    entries.push({
      id: "source-" + source.sourceId,
      title: source.label,
      detail: source.reason ?? (source.state === "STALE" ? c.staleSource : c.failedSource),
      severity: source.state === "FAILED" ? "HIGH" : "MEDIUM",
      observedAt: research?.asOf ?? null,
      href: "/app/coverage",
      surface: c.surfaces.coverage,
    });
  }

  for (const source of portfolio?.sources ?? []) {
    if (source.state === "OK") continue;
    entries.push({
      id: "portfolio-source-" + source.sourceId,
      title: source.label,
      detail: source.reason ?? c.failedSource,
      severity: source.state === "FAILED" ? "HIGH" : "MEDIUM",
      observedAt: source.observedAt,
      href: "/app/coverage",
      surface: c.surfaces.coverage,
    });
  }

  for (const rule of research?.rules ?? []) {
    if (rule.mode !== "SCHEDULE" || rule.run.enrolled) continue;
    entries.push({
      id: "rule-" + rule.ruleId,
      title: rule.label,
      detail: c.unenrolledRule,
      severity: "MEDIUM",
      observedAt: null,
      href: "/app/research",
      surface: c.surfaces.research,
    });
  }

  return entries;
}

/**
 * What was looked at and found unchanged.
 *
 * Only things that were genuinely checked go in here. A projection that failed
 * to load contributes nothing — "unchanged" would be a claim about data nobody
 * read.
 */
function quietChecks(reads: HomeReads, c: BriefReadCopy): readonly BriefQuietCheck[] {
  const quiet: BriefQuietCheck[] = [];
  if (reads.portfolio !== null && reads.portfolio.attention.length === 0) {
    quiet.push({ title: c.quiet.portfolio, surface: c.surfaces.portfolio, href: "/app/portfolio" });
  }
  if (reads.research !== null && reads.research.changes.every((change) => change.state !== "MATERIAL")) {
    quiet.push({ title: c.quiet.research, surface: c.surfaces.research, href: "/app/research" });
  }
  if (reads.decisions !== null && reads.decisions.counts.queue === 0) {
    quiet.push({ title: c.quiet.decisions, surface: c.surfaces.decisions, href: "/app/action-cases" });
  }
  return quiet;
}

export function projectBriefSurface(input: Readonly<{
  reads: HomeReads;
  asOf: string;
  lastSeenAt: string | null;
  serverReadable: boolean;
  locale?: WorkspaceLocale;
}>): DailyBrief {
  const c = COPY[input.locale ?? "en"];
  return buildDailyBrief({
    asOf: input.asOf,
    window: briefWindow({
      lastSeenAt: input.lastSeenAt,
      asOf: input.asOf,
      defaultWindowSeconds: DEFAULT_BRIEF_WINDOW_SECONDS,
      serverReadable: input.serverReadable,
    }),
    decisions: decisionEntries(input.reads.decisions, c),
    changes: changeEntries(input.reads.research, c),
    portfolio: portfolioEntries(input.reads.portfolio, c),
    monitoring: monitoringEntries(input.reads.research, input.reads.portfolio, c),
    quiet: quietChecks(input.reads, c),
  });
}
