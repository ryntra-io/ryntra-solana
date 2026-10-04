"use client";

import { ArrowSquareOut, ArrowsClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Help, HelpLabel } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { MarketEvidenceReadDto, MarketEvidenceSnapshotDto } from "@/lib/api/v1/contract";
import { structureStateOf, type StructureFlag } from "@/lib/evidence/flags";
import { metricOf } from "@/lib/evidence/snapshot";
import { evidenceMetric, type EvidenceMetricId } from "@/lib/evidence/metrics";

import styles from "./evidence.module.css";
import risk from "./risk.module.css";
import { fmtFigure, fmtWhen, riskWordsFor, type RiskWord } from "./risk-words";

/**
 * The *Risk & due diligence* card — the second sensor's card on the asset,
 * beside the market card and visibly not the same thing: the market card
 * says what people did with the token, this one says how the token is
 * built. Four facts a person can act on — who holds it, whether its supply
 * can still change, whether accounts can be frozen, whether it taxes
 * transfers — each with the source's own reading and one line of meaning;
 * the early-holder labels (snipers, bundled buyers, the developer) as one
 * line where they mean something and under *Details* where they do not.
 *
 * The context is the asset's kind. On an issuer-backed instrument (a
 * tokenized stock, a pre-IPO token) a concentrated supply and a kept freeze
 * right are the design, and the card says so beside the figure instead of
 * dressing them as a warning; on a token launched long ago the early-holder
 * labels mean little and stay folded. No threshold, no score, no verdict:
 * the compact state in the head counts facts (an authority present, a tax
 * above zero) and never says "safe".
 *
 * The card remembers, in this browser only, what it last showed for the
 * token — the facts that stood and the top-ten share — and when the next
 * look differs it says so in one line (*Changed since your last look*): the
 * change semantic Portfolio needs without a score, and the honest form of
 * it — what this person saw, not a promise that nothing else moved.
 *
 * Nothing loads until *Check* is pressed; the answer is whatever the server
 * says — fresh, cached, the last copy held while the source is silent, *the
 * source does not analyse this token*, or *not available* with the reason —
 * and a figure the source did not answer is a dash, never a zero.
 * `planHref` is where *Add a condition to the plan* goes, the rule prefilled
 * from what stands now; absent, the button is not drawn.
 */

export type RiskAssetKind = "meme" | "crypto" | "issuer-backed" | "unknown";

type Fetched = Readonly<{ status: "idle" } | { status: "loading"; previous: MarketEvidenceReadDto | null } | { status: "done"; read: MarketEvidenceReadDto; at: number }>;

export type RiskCompactState = Readonly<{ tone: "none" | "flags" | "muted"; label: string; detail: string | null }>;

/** What this browser last saw of a token's structure, per mint. */
type Seen = Readonly<{ flags: readonly StructureFlag[]; top10: number | null; at: string }>;
const SEEN_KEY = "ryntra.risk.seen.v1";

function readSeen(mint: string): Seen | null {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? "{}") as Record<string, Seen>;
    return all[mint] ?? null;
  } catch {
    return null;
  }
}

function writeSeen(mint: string, seen: Seen): void {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? "{}") as Record<string, Seen>;
    all[mint] = seen;
    /* A bounded memory: the forty most recent tokens. */
    const kept = Object.entries(all)
      .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
      .slice(0, 40);
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage may be off */
  }
}

/** The differences between what this browser saw last and what stands now, in the person's words; empty when nothing material moved. */
function changesSince(previous: Seen, snapshot: MarketEvidenceSnapshotDto, locale: WorkspaceLocale): string[] {
  const word = riskWordsFor(locale);
  const now = structureStateOf(snapshot);
  const out: string[] = [];
  const had = (flag: StructureFlag) => previous.flags.includes(flag);
  const has = (flag: StructureFlag) => now.flags.includes(flag);
  if (!had("mint_authority") && has("mint_authority")) out.push(word("changedMintPresent"));
  if (had("mint_authority") && !has("mint_authority") && metricOf(snapshot, "mint_authority")?.value === 0) out.push(word("changedMintRenounced"));
  if (!had("freeze_authority") && has("freeze_authority")) out.push(word("changedFreezePresent"));
  if (had("freeze_authority") && !has("freeze_authority") && metricOf(snapshot, "freeze_authority")?.value === 0) out.push(word("changedFreezeRenounced"));
  if (!had("transfer_tax") && has("transfer_tax")) out.push(word("changedTaxOn"));
  if (had("transfer_tax") && !has("transfer_tax") && metricOf(snapshot, "transfer_tax_pct")?.value === 0) out.push(word("changedTaxOff"));
  const top = metricOf(snapshot, "top10_holder_share_pct")?.value ?? null;
  if (previous.top10 !== null && top !== null && Math.abs(top - previous.top10) >= 5) out.push(`${word("changedTop10")} ${fmtFigure(previous.top10, "percent", locale)} → ${fmtFigure(top, "percent", locale)}`);
  return out;
}

function figureOf(snapshot: MarketEvidenceSnapshotDto, id: EvidenceMetricId) {
  return snapshot.metrics.find((metric) => metric.id === id) ?? null;
}

const FLAG_WORD: Readonly<Record<StructureFlag, RiskWord>> = { mint_authority: "flagMint", freeze_authority: "flagFreeze", transfer_tax: "flagTax" };

/** The one line the head and any list may say about the read; exported so Spot's header can say the same words. */
export function compactRiskState(read: MarketEvidenceReadDto | null, locale: WorkspaceLocale, nowMs: number): RiskCompactState {
  const word = riskWordsFor(locale);
  if (!read) return { tone: "muted", label: word("stateNotChecked"), detail: null };
  if (!read.snapshot) return { tone: "muted", label: read.state === "UNKNOWN" ? word("stateNoData") : word("stateUnavailable"), detail: null };
  const { flags, unanswered } = structureStateOf(read.snapshot);
  const stale = read.state === "STALE" || Date.parse(read.snapshot.expiresAt) <= nowMs;
  const suffix = stale ? ` · ${word("stateStale")}` : "";
  if (flags.length === 0) {
    if (unanswered.length > 0) return { tone: "muted", label: `${word("stateNoData")}${suffix}`, detail: null };
    return { tone: "none", label: `${word("stateNoFlags")}${suffix}`, detail: null };
  }
  const names = flags.map((flag) => word(FLAG_WORD[flag]));
  if (flags.length === 1) return { tone: "flags", label: `${names[0]}${suffix}`, detail: null };
  const count = locale === "uk" ? `${flags.length} ${flags.length < 5 ? word("stateFlagsTwo") : word("stateFlags")}` : `${flags.length} ${word("stateFlags")}`;
  return { tone: "flags", label: `${count}${suffix}`, detail: names.join(" · ") };
}

export function RiskCard({ mint, locale, planHref, assetKind = "unknown", onRead }: { mint: string; locale: WorkspaceLocale; planHref: string | null; assetKind?: RiskAssetKind; onRead?: (read: MarketEvidenceReadDto | null) => void }) {
  const word = useMemo(() => riskWordsFor(locale), [locale]);
  const [state, setState] = useState<Fetched>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [changed, setChanged] = useState<Readonly<{ since: string; lines: readonly string[] }> | null>(null);

  const load = useCallback(async () => {
    setState((current) => ({ status: "loading", previous: current.status === "done" ? current.read : null }));
    let read: MarketEvidenceReadDto;
    try {
      const response = await fetch(`/api/v1/research/evidence?mint=${encodeURIComponent(mint)}&window=now`, { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
        const rate = body?.error?.code === "RATE_LIMITED";
        read = { state: "UNAVAILABLE", snapshot: null, reason: rate ? (locale === "uk" ? "Забагато запитів із цієї адреси; зачекай хвилину." : "Too many reads from this address; wait a minute.") : null, served: "none" };
      } else {
        read = (await response.json()) as MarketEvidenceReadDto;
      }
    } catch {
      read = { state: "UNAVAILABLE", snapshot: null, reason: null, served: "none" };
    }
    setState({ status: "done", read, at: Date.now() });
    setNow(Date.now());
    onRead?.(read);
    /* What this browser saw last against what stands now; then remember now. */
    if (read.snapshot) {
      const previous = readSeen(mint);
      const lines = previous ? changesSince(previous, read.snapshot, locale) : [];
      setChanged(previous && lines.length > 0 ? { since: previous.at, lines } : null);
      writeSeen(mint, { flags: structureStateOf(read.snapshot).flags, top10: metricOf(read.snapshot, "top10_holder_share_pct")?.value ?? null, at: read.snapshot.observedAt ?? read.snapshot.fetchedAt });
    }
  }, [mint, locale, onRead]);

  /* The clock the expiry is judged against, once a minute while a snapshot is shown. */
  useEffect(() => {
    if (state.status !== "done" || !state.read.snapshot) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [state]);

  const read = state.status === "done" ? state.read : state.status === "loading" ? state.previous : null;
  const snapshot = read?.snapshot ?? null;
  const expired = snapshot ? Date.parse(snapshot.expiresAt) <= now : false;
  const stale = read?.state === "STALE";
  const lagMinutes = snapshot ? Math.round(snapshot.providerLagSeconds / 60) : 0;
  const compact = state.status === "idle" ? null : compactRiskState(read, locale, now);
  const issuer = assetKind === "issuer-backed";

  const top = snapshot ? figureOf(snapshot, "top10_holder_share_pct") : null;
  const holders = snapshot ? figureOf(snapshot, "holder_count") : null;
  const mintAuthority = snapshot ? figureOf(snapshot, "mint_authority") : null;
  const freezeAuthority = snapshot ? figureOf(snapshot, "freeze_authority") : null;
  const tax = snapshot ? figureOf(snapshot, "transfer_tax_pct") : null;
  const snipers = snapshot ? figureOf(snapshot, "sniper_holding_pct") : null;
  const bundlers = snapshot ? figureOf(snapshot, "bundler_holding_pct") : null;
  const developer = snapshot ? figureOf(snapshot, "dev_holding_pct") : null;

  /* The rule the builder starts from: the top-ten share at most the next whole percent above what stands now, or the mint authority renounced when the share was not measured. */
  const prefill = top?.value !== null && top?.value !== undefined ? `top10_holder_share_pct:now:lte:${Math.min(100, Math.ceil(top.value))}` : mintAuthority?.value !== null && mintAuthority?.value !== undefined ? "mint_authority:now:lte:0" : null;
  const conditionHref = planHref && prefill ? `${planHref}${planHref.includes("?") ? "&" : "?"}evidence=${encodeURIComponent(prefill)}` : planHref;

  const launchLine =
    snipers && bundlers && developer && (snipers.value !== null || bundlers.value !== null || developer.value !== null) ? (
      <p className={risk.launch}>
        <span className={risk.launchTitle}>
          {word("launchTitle")}
          <Help topic="launchCohort" locale={locale} />
        </span>
        <span translate="no">
          {[
            [word("snipers"), snipers],
            [word("bundlers"), bundlers],
            [word("developer"), developer],
          ]
            .map(([label, figure]) => (typeof label === "string" && figure && typeof figure === "object" ? `${label} ${figure.value === null ? "—" : fmtFigure(figure.value, "percent", locale)}` : ""))
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className={risk.launchNote}>{issuer ? word("launchIssuer") : assetKind === "crypto" ? word("launchMeansLittle") : word("launchLead")}</span>
      </p>
    ) : null;

  const authorityRow = (id: "mint_authority" | "freeze_authority", figure: MarketEvidenceSnapshotDto["metrics"][number] | null) => {
    const metric = evidenceMetric(id);
    if (!metric) return null;
    const value = figure?.value ?? null;
    const present = value === 1;
    const note = value === null ? word("notMeasured") : id === "mint_authority" ? (present ? word("mintPresent") : word("mintRenounced")) : present ? word("freezePresent") : word("freezeRenounced");
    return (
      <div key={id} data-flag={present ? "true" : "false"}>
        <dt>
          {metric.words[locale].label}
          <Help topic="tokenAuthorities" locale={locale} />
        </dt>
        <dd data-absent={value === null ? "true" : "false"}>
          <span className={risk.figure}>{value === null ? <span className={styles.dash}>—</span> : fmtFigure(value, "flag", locale)}</span>
          <span className={risk.note}>
            {note}
            {present && issuer ? ` · ${word("issuerAuthorityNote")}` : ""}
          </span>
        </dd>
      </div>
    );
  };

  return (
    <section className={`${styles.card} ${risk.card}`} aria-labelledby={`risk-title-${mint}`} data-state={read?.state ?? state.status} data-kind={assetKind}>
      <div className={styles.head}>
        <h2 id={`risk-title-${mint}`}>
          <HelpLabel topic="riskDueDiligence" locale={locale}>
            {word("title")}
          </HelpLabel>
        </h2>
        <span className={styles.spacer} />
        {compact ? (
          <span className={risk.state} data-tone={compact.tone} title={compact.detail ?? undefined}>
            {compact.label}
          </span>
        ) : null}
      </div>

      <div className={styles.body}>
        {state.status === "idle" ? (
          <div className={styles.idle}>
            <p className={styles.lead}>{word("lead")}</p>
            {/* A sensor, not the screen's action: quiet, so the page keeps one orange action. */}
            <button type="button" className="rw-btn" onClick={() => void load()}>
              {word("check")}
            </button>
          </div>
        ) : null}

        {state.status === "loading" && !snapshot ? (
          <div className={styles.skeleton} aria-busy="true" aria-live="polite">
            <span />
            <span />
            <span />
            <p className={styles.muted}>{word("loading")}</p>
          </div>
        ) : null}

        {snapshot ? (
          <>
            <dl className={risk.rows} aria-busy={state.status === "loading"} data-dim={state.status === "loading" ? "true" : "false"}>
              <div>
                <dt>
                  {evidenceMetric("top10_holder_share_pct")?.words[locale].label}
                  <Help topic="riskDueDiligence" locale={locale} />
                </dt>
                <dd data-absent={top?.value === null || top?.value === undefined ? "true" : "false"}>
                  <span className={risk.figure} translate="no">
                    {top?.value === null || top?.value === undefined ? <span className={styles.dash}>—</span> : fmtFigure(top.value, "percent", locale)}
                  </span>
                  <span className={risk.note} translate="no">
                    {top?.value === null || top?.value === undefined
                      ? word("notMeasured")
                      : holders?.value !== null && holders?.value !== undefined
                        ? `${word("holdersOf")} ${fmtFigure(holders.value, "count", locale)} ${word("holders")}`
                        : word("holdersNotCounted")}
                    {issuer && top?.value !== null && top?.value !== undefined ? ` · ${word("issuerConcentrationNote")}` : ""}
                  </span>
                </dd>
              </div>
              {authorityRow("mint_authority", mintAuthority)}
              {authorityRow("freeze_authority", freezeAuthority)}
              <div data-flag={tax?.value !== null && tax?.value !== undefined && tax.value > 0 ? "true" : "false"}>
                <dt>{evidenceMetric("transfer_tax_pct")?.words[locale].label}</dt>
                <dd data-absent={tax?.value === null || tax?.value === undefined ? "true" : "false"}>
                  <span className={risk.figure} translate="no">
                    {tax?.value === null || tax?.value === undefined ? <span className={styles.dash}>—</span> : tax.value === 0 ? word("taxNone") : fmtFigure(tax.value, "percent", locale)}
                  </span>
                  <span className={risk.note}>{tax?.value === null || tax?.value === undefined ? (tax?.note?.includes("without its size") ? word("taxUnknownSize") : word("notMeasured")) : tax.value === 0 ? "" : word("taxOnEveryTransfer")}</span>
                </dd>
              </div>
            </dl>
            {assetKind === "meme" || assetKind === "unknown" ? launchLine : null}
            {changed ? (
              <p className={risk.changed} role="status">
                <b>
                  {word("changedSince")} ({fmtWhen(changed.since, locale, now)}):
                </b>{" "}
                {changed.lines.join(" · ")}
              </p>
            ) : null}
            <p className={styles.meta}>
              {snapshot.observedAt ? (
                <span translate="no">
                  {word("observedAt")} {fmtWhen(snapshot.observedAt, locale, now)}
                </span>
              ) : (
                <span translate="no">
                  {word("askedAt")} {fmtWhen(snapshot.fetchedAt, locale, now)}
                </span>
              )}
              {lagMinutes > 0 ? (
                <span>
                  · {word("sourceLag")} {lagMinutes} {word("minutes")}
                </span>
              ) : null}
              {stale ? <span className={styles.flag}>· {word("stale")}</span> : expired ? <span className={styles.flag}>· {word("expired")}</span> : null}
              <span className={styles.attribution}>
                ·{" "}
                <a href={snapshot.attribution.href} target="_blank" rel="noreferrer noopener">
                  {snapshot.attribution.text}
                  <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
                </a>
              </span>
            </p>
            <div className={styles.actions}>
              {conditionHref ? (
                <Link className="rw-btn" href={conditionHref} prefetch={false}>
                  {word("addCondition")}
                </Link>
              ) : null}
              {expired || stale ? (
                <button type="button" className="rw-btn" onClick={() => void load()} disabled={state.status === "loading"}>
                  <ArrowsClockwise size={14} weight="bold" aria-hidden="true" /> {word("refresh")}
                </button>
              ) : null}
              <button type="button" className={styles.detailsButton} aria-expanded={detailsOpen} aria-controls={`risk-details-${mint}`} onClick={() => setDetailsOpen((open) => !open)}>
                {word("details")}
              </button>
            </div>
            {detailsOpen ? (
              <div id={`risk-details-${mint}`} className={styles.details}>
                {assetKind === "meme" || assetKind === "unknown" ? null : launchLine}
                <dl className={styles.detailFacts}>
                  <div>
                    <dt>{word("families")}</dt>
                    <dd>{snapshot.families.map((family) => (family === "trading-lite" ? word("familyTradingLite") : family)).join("; ")}</dd>
                  </div>
                  {snapshot.observedAt ? (
                    <div>
                      <dt>{word("askedAt")}</dt>
                      <dd translate="no">{fmtWhen(snapshot.fetchedAt, locale, now)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{word("expiresAt")}</dt>
                    <dd translate="no">{fmtWhen(snapshot.expiresAt, locale, now)}</dd>
                  </div>
                  {snapshot.warnings.length > 0 ? (
                    <div>
                      <dt>{word("coverage")}</dt>
                      <dd>{coverageWords(snapshot.warnings, locale)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{word("method")}</dt>
                    <dd>{word("methodText")}</dd>
                  </div>
                  <div>
                    <dt>{word("notVerdict")}</dt>
                    <dd>{word("notVerdictText")}</dd>
                  </div>
                </dl>
                <p className={styles.footnote}>{word("rights")}</p>
              </div>
            ) : null}
          </>
        ) : null}

        {state.status === "done" && !snapshot ? (
          <div className={styles.empty} role="status">
            <p className={styles.lead}>{read?.state === "UNKNOWN" ? word("noData") : word("unavailable")}</p>
            {read?.state === "UNAVAILABLE" && read.reason ? (
              <p className={styles.muted}>
                {word("reasonPrefix")}: {read.reason}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button type="button" className="rw-btn" onClick={() => void load()}>
                {word("tryAgain")}
              </button>
              <span className={styles.attribution}>
                <a href="https://dd.xyz" target="_blank" rel="noreferrer noopener">
                  Data provided by DD.xyz
                  <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
                </a>
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The mapper's coverage notes in the person's language; a note the card does not recognise is summarised, not quoted. */
function coverageWords(warnings: readonly string[], locale: WorkspaceLocale): string {
  const uk = locale === "uk";
  const said = new Set<string>();
  for (const warning of warnings) {
    const lower = warning.toLowerCase();
    if (lower.includes("top-ten share")) said.add(uk ? "Джерело не виміряло частку десяти найбільших для цього токена." : "The source did not measure the top-ten share for this token.");
    else if (lower.includes("count the holders")) said.add(uk ? "Джерело не порахувало власників цього токена." : "The source did not count the holders of this token.");
    else if (lower.includes("authority")) said.add(uk ? "Джерело не відповіло про стан прав." : "The source did not answer the authority state.");
    else if (warning.trim().length > 0) said.add(uk ? "Джерело зазначає обмеження щодо частини цифр." : "The source notes a limitation on part of the figures.");
  }
  return [...said].join(" ");
}
