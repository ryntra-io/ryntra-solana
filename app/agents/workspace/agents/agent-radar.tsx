"use client";

import {
  ArrowRight,
  CheckCircle,
  Eye,
  FileText,
  Funnel,
  Info,
  MagnifyingGlass,
  Prohibit,
  Question,
  SealCheck,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AgentPassport, AgentPassportSource } from "@/lib/agent-control/agent-passport";
import {
  agentPassportDisplayName,
  agentPassportSearchText,
  deriveAgentCapabilities,
  type AgentCapabilityState,
} from "@/lib/agent-control/agent-capability";
import { AGENT_PASSPORT_DIRECTORY_LIMIT } from "@/lib/agent-control/passport-directory";

import { useAgentI18n } from "../i18n/provider";
import { usePassportDirectory } from "../passport-directory-store";

type RadarFilter = "ALL" | "CONFLICTS" | "UNKNOWNS" | "SOURCE_GAPS" | "ALL_SOURCES";

const FILTER_VALUES: readonly RadarFilter[] = ["ALL", "CONFLICTS", "UNKNOWNS", "SOURCE_GAPS", "ALL_SOURCES"];

type RadarCopy = {
  filters: Record<RadarFilter, string>;
  emptyFilteredTitle: string;
  emptyTitle: string;
  emptyFilteredBody: string;
  emptyBody: string;
  emptyAction: string;
  sourcePreview: string;
  openPassport: string;
  removeFromTab: string;
  sourceLedger: string;
  sourceLedgerHint: string;
  observed: (time: string) => string;
  sourceKind: Record<AgentPassportSource["kind"], string>;
  claimedTitle: string;
  claimedHint: string;
  conflictsUnknowns: (conflicts: number, unknowns: number) => string;
  capabilityTableLabel: string;
  colCapability: string;
  colState: string;
  colClaim: string;
  colEvidence: string;
  evidenceSummary: string;
  dtAuthority: string;
  dtObserved: string;
  dtMethod: string;
  dtSources: string;
  dtLimit: string;
  proofLimit: string;
  lead: string;
  readOnly: string;
  scope: (count: number, limit: number) => string;
  retentionSession: string;
  retentionMemory: string;
  toolbarLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  boundaryLabel: string;
  clearTab: string;
  restoring: string;
  directoryTitle: string;
  directoryCount: (count: number) => string;
  clearFilters: string;
  sourcesFact: (available: number) => string;
  conflictsFact: (count: number) => string;
  unknownsFact: (count: number) => string;
};

const COPY = {
  en: {
    filters: {
      ALL: "All records",
      CONFLICTS: "Conflicts present",
      UNKNOWNS: "Unknowns present",
      SOURCE_GAPS: "Source gaps",
      ALL_SOURCES: "All sources available",
    },
    emptyFilteredTitle: "No record matches this view",
    emptyTitle: "No inspected Passports in this tab",
    emptyFilteredBody:
      "Change the evidence filter or search text. Radar will not fill a gap with discovery or sample actors.",
    emptyBody:
      "Inspect one exact Agentverse address. Only a successfully parsed canonical Passport enters this directory.",
    emptyAction: "Inspect an exact address",
    sourcePreview: "Source preview · provider-global public read",
    openPassport: "Open Passport",
    removeFromTab: "Remove from this tab",
    sourceLedger: "Source ledger",
    sourceLedgerHint: "Availability from this exact read, not actor reachability.",
    observed: (time: string) => `Observed ${time}`,
    sourceKind: {
      SEARCH: "Search record",
      REGISTRY: "Registry",
      MANIFESTS: "Protocol manifests",
    },
    claimedTitle: "Claimed against observed",
    claimedHint: "Per capability. No combined trust state, rank or recommendation.",
    conflictsUnknowns: (conflicts: number, unknowns: number) => `${conflicts} conflicts · ${unknowns} unknowns`,
    capabilityTableLabel: "Agent capability evidence",
    colCapability: "Capability",
    colState: "State",
    colClaim: "Claim / observation",
    colEvidence: "Evidence",
    evidenceSummary: "Evidence",
    dtAuthority: "Authority",
    dtObserved: "Observed",
    dtMethod: "Method",
    dtSources: "Sources",
    dtLimit: "Limit",
    proofLimit:
      "No current capability is PROVEN: this path reads public records and performs no invocation or control proof.",
    lead: "Keep exact public reads together and compare what an actor claims with what Ryntra actually observed.",
    readOnly: "READ ONLY",
    scope: (count: number, limit: number) => `THIS TAB · ${count} / ${limit} RECORDS`,
    retentionSession: "Reload keeps this directory; a new tab starts empty. No server record exists.",
    retentionMemory:
      "Browser storage is unavailable. Records last only while this workspace stays open; no server record exists.",
    toolbarLabel: "Agent Radar filters",
    searchLabel: "Search this tab",
    searchPlaceholder: "Name, address or protocol",
    boundaryLabel: "Evidence boundary",
    clearTab: "Clear this tab",
    restoring: "Restoring this tab's bounded Passport directory…",
    directoryTitle: "Inspected records",
    directoryCount: (count: number) => `${count} shown · newest exact read first`,
    clearFilters: "Clear Radar filters",
    sourcesFact: (available: number) => `${available}/3 sources`,
    conflictsFact: (count: number) => `${count} conflicts`,
    unknownsFact: (count: number) => `${count} unknowns`,
  },
  uk: {
    filters: {
      ALL: "Усі записи",
      CONFLICTS: "Є конфлікти",
      UNKNOWNS: "Є невідомі",
      SOURCE_GAPS: "Прогалини в джерелах",
      ALL_SOURCES: "Усі джерела доступні",
    },
    emptyFilteredTitle: "Жоден запис не відповідає цьому фільтру",
    emptyTitle: "У цій вкладці немає оглянутих Passport",
    emptyFilteredBody:
      "Змініть фільтр доказів або пошуковий запит. Radar не заповнює прогалини discovery чи зразковими акторами.",
    emptyBody:
      "Огляньте одну точну адресу Agentverse. До цього каталогу потрапляє лише успішно розібраний канонічний Passport.",
    emptyAction: "Оглянути точну адресу",
    sourcePreview: "Превʼю джерел · публічне читання на рівні провайдера",
    openPassport: "Відкрити Passport",
    removeFromTab: "Прибрати з цієї вкладки",
    sourceLedger: "Журнал джерел",
    sourceLedgerHint: "Доступність за цим точним читанням, а не досяжність актора.",
    observed: (time: string) => `Спостережено ${time}`,
    sourceKind: {
      SEARCH: "Запис пошуку",
      REGISTRY: "Реєстр",
      MANIFESTS: "Маніфести протоколів",
    },
    claimedTitle: "Заявлене проти спостереженого",
    claimedHint: "За кожною можливістю. Без зведеного стану довіри, рейтингу чи рекомендації.",
    conflictsUnknowns: (conflicts: number, unknowns: number) => `конфліктів: ${conflicts} · невідомих: ${unknowns}`,
    capabilityTableLabel: "Докази можливостей агента",
    colCapability: "Можливість",
    colState: "Стан",
    colClaim: "Заявка / спостереження",
    colEvidence: "Докази",
    evidenceSummary: "Докази",
    dtAuthority: "Підстава",
    dtObserved: "Спостережено",
    dtMethod: "Метод",
    dtSources: "Джерела",
    dtLimit: "Обмеження",
    proofLimit:
      "Жодна поточна можливість не має стану PROVEN: цей шлях читає публічні записи і не виконує виклику чи доказу контролю.",
    lead: "Тримайте точні публічні читання разом і порівнюйте заявлене актором із тим, що Ryntra фактично спостерігала.",
    readOnly: "ЛИШЕ ЧИТАННЯ",
    scope: (count: number, limit: number) => `ЦЯ ВКЛАДКА · ${count} / ${limit} ЗАПИСІВ`,
    retentionSession: "Перезавантаження зберігає цей каталог; нова вкладка починає порожньою. Серверного запису не існує.",
    retentionMemory:
      "Сховище браузера недоступне. Записи живуть, лише поки цей робочий простір відкритий; серверного запису не існує.",
    toolbarLabel: "Фільтри Agent Radar",
    searchLabel: "Пошук у цій вкладці",
    searchPlaceholder: "Назва, адреса або протокол",
    boundaryLabel: "Межа доказів",
    clearTab: "Очистити цю вкладку",
    restoring: "Відновлюємо обмежений каталог Passport цієї вкладки…",
    directoryTitle: "Оглянуті записи",
    directoryCount: (count: number) => `показано ${count} · найновіше точне читання першим`,
    clearFilters: "Скинути фільтри Radar",
    sourcesFact: (available: number) => `джерел: ${available}/3`,
    conflictsFact: (count: number) => `конфліктів: ${count}`,
    unknownsFact: (count: number) => `невідомих: ${count}`,
  },
} as const satisfies Record<WorkspaceLocale, RadarCopy>;

function StateIcon({ state }: { state: AgentCapabilityState }) {
  if (state === "PROVEN") return <SealCheck size={16} weight="fill" aria-hidden />;
  if (state === "OBSERVED") return <Eye size={16} weight="bold" aria-hidden />;
  if (state === "DISCOVERED") return <CheckCircle size={16} weight="bold" aria-hidden />;
  if (state === "DECLARED") return <FileText size={16} weight="bold" aria-hidden />;
  if (state === "CONFLICTING") return <Warning size={16} weight="fill" aria-hidden />;
  if (state === "UNAVAILABLE") return <Prohibit size={16} weight="bold" aria-hidden />;
  return <Question size={16} weight="bold" aria-hidden />;
}

function CapabilityState({ state }: { state: AgentCapabilityState }) {
  return (
    <span className="acw-radar-state" data-state={state}>
      <StateIcon state={state} />
      {state}
    </span>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 12)}…${address.slice(-8)}`;
}

function compactTime(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function sourceTone(availability: AgentPassportSource["availability"]): "ok" | "warn" | "bad" {
  if (availability === "AVAILABLE") return "ok";
  if (availability === "PARTIAL" || availability === "NOT_REQUESTED") return "warn";
  return "bad";
}

function matchesFilter(passport: AgentPassport, filter: RadarFilter): boolean {
  if (filter === "CONFLICTS") return passport.conflicts.length > 0;
  if (filter === "UNKNOWNS") return passport.unknowns.length > 0;
  if (filter === "SOURCE_GAPS") return passport.sources.some((source) => source.availability !== "AVAILABLE");
  if (filter === "ALL_SOURCES") return passport.sources.every((source) => source.availability === "AVAILABLE");
  return true;
}

function RadarEmpty({ filtered }: { filtered: boolean }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  return (
    <div className="acw-radar-empty">
      <MagnifyingGlass size={30} weight="thin" aria-hidden />
      <h2>{filtered ? copy.emptyFilteredTitle : copy.emptyTitle}</h2>
      <p>{filtered ? copy.emptyFilteredBody : copy.emptyBody}</p>
      {!filtered ? (
        <Link className="acw-radar-primary" href="/agents/workspace/passport">
          {copy.emptyAction} <ArrowRight size={15} weight="bold" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function RadarDetail({ passport, onRemove }: { passport: AgentPassport; onRemove: () => void }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const capabilities = deriveAgentCapabilities(passport);
  const name = agentPassportDisplayName(passport);

  return (
    <article className="acw-radar-detail" aria-labelledby="acw-radar-detail-title">
      <header className="acw-radar-detail-head">
        <div>
          <h2 id="acw-radar-detail-title">{name}</h2>
          <span>{copy.sourcePreview}</span>
          <code title={passport.request.address}>{passport.request.address}</code>
        </div>
        <div className="acw-radar-detail-actions">
          <Link href={`/agents/workspace/passport?address=${passport.request.address}`}>
            {copy.openPassport} <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
          <button type="button" onClick={onRemove}>
            <Trash size={14} weight="bold" aria-hidden /> {copy.removeFromTab}
          </button>
        </div>
      </header>

      <section className="acw-radar-sources" aria-labelledby="acw-radar-sources-title">
        <div className="acw-radar-section-head">
          <div>
            <h3 id="acw-radar-sources-title">{copy.sourceLedger}</h3>
            <p>{copy.sourceLedgerHint}</p>
          </div>
          <span>{copy.observed(compactTime(passport.createdAt))}</span>
        </div>
        <div className="acw-radar-source-row">
          {passport.sources.map((source) => (
            <div key={source.id}>
              <span className="acw-radar-source-mark" data-tone={sourceTone(source.availability)}>
                {source.availability === "AVAILABLE" ? <CheckCircle size={15} weight="bold" aria-hidden /> : <Warning size={15} weight="bold" aria-hidden />}
                {source.availability}
              </span>
              <b>{copy.sourceKind[source.kind]}</b>
              <small>{source.id} · {compactTime(source.observedAt)}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="acw-radar-capabilities" aria-labelledby="acw-radar-capabilities-title">
        <div className="acw-radar-section-head">
          <div>
            <h3 id="acw-radar-capabilities-title">{copy.claimedTitle}</h3>
            <p>{copy.claimedHint}</p>
          </div>
          <span>{copy.conflictsUnknowns(passport.conflicts.length, passport.unknowns.length)}</span>
        </div>

        <div className="acw-radar-capability-table" role="table" aria-label={copy.capabilityTableLabel}>
          <div className="acw-radar-capability-head" role="row">
            <span role="columnheader">{copy.colCapability}</span>
            <span role="columnheader">{copy.colState}</span>
            <span role="columnheader">{copy.colClaim}</span>
            <span role="columnheader">{copy.colEvidence}</span>
          </div>
          {capabilities.map((capability) => (
            <div className="acw-radar-capability-row" role="row" key={capability.id}>
              <div role="cell">
                <b>{capability.label}</b>
                <span>{capability.detail}</span>
              </div>
              <div role="cell"><CapabilityState state={capability.state} /></div>
              <span className="acw-radar-axis" role="cell">
                {capability.claimed} / {capability.observed}
              </span>
              <details role="cell">
                <summary><Info size={14} weight="bold" aria-hidden /> {copy.evidenceSummary}</summary>
                <dl>
                  <div><dt>{copy.dtAuthority}</dt><dd>{capability.authority}</dd></div>
                  <div><dt>{copy.dtObserved}</dt><dd>{compactTime(capability.observedAt)}</dd></div>
                  <div><dt>{copy.dtMethod}</dt><dd>{capability.verificationMethod}</dd></div>
                  <div><dt>{copy.dtSources}</dt><dd>{capability.sourceIds.join(" + ")}</dd></div>
                  <div><dt>{copy.dtLimit}</dt><dd>{capability.limitation}</dd></div>
                </dl>
              </details>
            </div>
          ))}
        </div>

        <p className="acw-radar-proof-limit">
          <Warning size={15} weight="bold" aria-hidden />
          {copy.proofLimit}
        </p>
      </section>
    </article>
  );
}

/**
 * THESIS: Radar is a working evidence ledger, not a marketplace grid or trust leaderboard.
 * OWN-WORLD: Quiet Intelligence panels, paper-clear rows, Iris focus, semantic evidence states.
 * STORY: inspect an exact Passport, find its record here, filter gaps, then open every claim's evidence.
 * FIRST VIEWPORT: scope and filters lead; a compact directory anchors the left and one evidence sheet owns the right.
 * FORM: evidence ledger, assigned structural candidate 5, seed 991b4762.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.
 */
export function AgentRadar() {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const { clear, ready, records, remove, retention } = usePassportDirectory();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RadarFilter>("ALL");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return records.filter((passport) =>
      matchesFilter(passport, filter)
      && (!needle || agentPassportSearchText(passport).includes(needle)),
    );
  }, [filter, query, records]);
  const selected = filtered.find((passport) => passport.request.address === selectedAddress) ?? filtered[0] ?? null;
  const hasActiveFilter = filter !== "ALL" || query.trim().length > 0;

  return (
    <div className="acw-page acw-radar-page">
      <span
        hidden
        aria-hidden="true"
        data-design-comment="991b4762"
        dangerouslySetInnerHTML={{ __html: "<!-- design-seed:991b4762 -->" }}
      />
      <header className="acw-head acw-radar-head">
        <div>
          <h1>Agent Radar</h1>
          <p>{copy.lead}</p>
        </div>
        <span className="acw-environment">{copy.readOnly}</span>
      </header>

      <div className="acw-radar-scope" role="status">
        <span><Eye size={16} weight="bold" aria-hidden /> {copy.scope(records.length, AGENT_PASSPORT_DIRECTORY_LIMIT)}</span>
        <p>{retention === "SESSION" ? copy.retentionSession : copy.retentionMemory}</p>
      </div>

      <div className="acw-radar-toolbar" aria-label={copy.toolbarLabel}>
        <label>
          <span>{copy.searchLabel}</span>
          <span className="acw-radar-input">
            <MagnifyingGlass size={16} weight="bold" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
            />
          </span>
        </label>
        <label>
          <span>{copy.boundaryLabel}</span>
          <span className="acw-radar-select">
            <Funnel size={16} weight="bold" aria-hidden />
            <select value={filter} onChange={(event) => setFilter(event.target.value as RadarFilter)}>
              {FILTER_VALUES.map((value) => <option value={value} key={value}>{copy.filters[value]}</option>)}
            </select>
          </span>
        </label>
        {records.length ? (
          <button className="acw-radar-clear" type="button" onClick={clear}>
            <Trash size={15} weight="bold" aria-hidden /> {copy.clearTab}
          </button>
        ) : null}
      </div>

      {!ready ? (
        <div className="acw-radar-restoring" role="status">{copy.restoring}</div>
      ) : filtered.length === 0 ? (
        <RadarEmpty filtered={hasActiveFilter && records.length > 0} />
      ) : (
        <div className="acw-radar-layout">
          <aside className="acw-radar-directory" aria-labelledby="acw-radar-directory-title">
            <header>
              <div>
                <h2 id="acw-radar-directory-title">{copy.directoryTitle}</h2>
                <p>{copy.directoryCount(filtered.length)}</p>
              </div>
              {hasActiveFilter ? (
                <button type="button" onClick={() => { setFilter("ALL"); setQuery(""); }} aria-label={copy.clearFilters}>
                  <X size={16} weight="bold" aria-hidden />
                </button>
              ) : null}
            </header>
            <ul>
              {filtered.map((passport) => {
                const available = passport.sources.filter((source) => source.availability === "AVAILABLE").length;
                const active = passport.request.address === selected?.request.address;
                return (
                  <li key={passport.request.address}>
                    <button
                      type="button"
                      className={active ? "acw-radar-record acw-radar-record--active" : "acw-radar-record"}
                      onClick={() => setSelectedAddress(passport.request.address)}
                      aria-pressed={active}
                    >
                      <span className="acw-radar-record-name">{agentPassportDisplayName(passport)}</span>
                      <code title={passport.request.address}>{shortAddress(passport.request.address)}</code>
                      <span className="acw-radar-record-facts">
                        <span><CheckCircle size={13} weight="bold" aria-hidden /> {copy.sourcesFact(available)}</span>
                        <span><Warning size={13} weight="bold" aria-hidden /> {copy.conflictsFact(passport.conflicts.length)}</span>
                        <span><Question size={13} weight="bold" aria-hidden /> {copy.unknownsFact(passport.unknowns.length)}</span>
                      </span>
                      <small>{compactTime(passport.createdAt)}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {selected ? (
            <RadarDetail passport={selected} onRemove={() => remove(selected.request.address)} />
          ) : null}
        </div>
      )}
    </div>
  );
}
