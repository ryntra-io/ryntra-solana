"use client";

import { CaretDown, CaretRight, CheckCircle, CircleDashed, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";

import { numberLocale } from "@/app/app/invest/invest-words";
import { usePortfolioRisk } from "@/app/app/invest/use-portfolio-risk";
import watch from "@/app/app/invest/watch.module.css";
import { Help } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PortfolioRiskFinding } from "@/lib/api/v1/contract";
import { riskFindingLine, riskGapLine, riskMoreWord, riskStateWord, riskWord, type RiskLang, type RiskWord } from "@/lib/monitoring/risk-words";

import home from "./home.module.css";

/**
 * «Ризик портфеля» on Home (canon v5 §11; `RYN-PROTECT-SIGNAL-001`, subtask 2):
 * the server's one word for the wallet — «Нормальний», «Увага» with its first
 * reason and one action, or «Не вдалося перевірити» with what could not be
 * read. Nothing here judges.
 *
 * Drawn as «Розподіл» is: its name as a quiet label with «?», then the state —
 * an icon, the word in its colour, the reason as a sentence after it — and the
 * one action as a small capsule under it, the way a position's state speaks in
 * Portfolio. Where: on a wide head under «Розподіл», beside the shares it
 * speaks of; on a narrow one — a phone — under the day's change, where
 * «Розподіл» is not drawn. Further reasons open under the first as quiet rows,
 * each a way to where it is acted on; the one amber action stays the first's.
 * «Увага» on what was read while something else was not says so under it, so
 * no one reads the rest as checked.
 */

type Tone = "calm" | "caution" | "quiet";

const ICON = { calm: CheckCircle, caution: Warning, quiet: CircleDashed } as const;

/** Where a reason's one action leads, and its word: the sale, the company's watch, the asset, Portfolio. */
function findingAction(finding: PortfolioRiskFinding): { href: string; word: RiskWord } {
  const company = finding.symbol ? `/app/stocks/${encodeURIComponent(finding.symbol)}` : "/app/portfolio";
  switch (finding.reason) {
    case "action":
      return { href: finding.symbol ? `${company}?sell=1` : company, word: "openSale" };
    case "weekend-no-limit":
      /* The company's page with «Ryntra попередить» open. */
      return { href: finding.symbol ? `${company}?watch=1` : company, word: "setUp" };
    case "concentration":
      return { href: finding.kind === "crypto" && finding.mint ? `/app/spot?mint=${encodeURIComponent(finding.mint)}` : company, word: "look" };
    case "private-share":
      return { href: "/app/portfolio", word: "look" };
  }
}

function Capsule({ children, caret = "right", quiet = false }: { children: string; caret?: "right" | "down"; quiet?: boolean }) {
  return (
    <span className={quiet ? `${watch.capsule} ${home.quietCapsule}` : watch.capsule}>
      {children}
      {caret === "down" ? <CaretDown size={12} weight="bold" aria-hidden="true" className={watch.caret} /> : <CaretRight size={12} weight="bold" aria-hidden="true" />}
    </span>
  );
}

export function PortfolioRisk({ locale, place }: { locale: WorkspaceLocale; place: "main" | "side" }) {
  const lang: RiskLang = locale === "uk" ? "uk" : "en";
  const risk = usePortfolioRisk();
  const [open, setOpen] = useState(false);
  const listId = useId();
  /* Shares as «Розподіл» writes them beside — «42,3%», «33,0%» — and a cap as the rule states it: «25%». */
  const [pct, capPct] = useMemo(() => {
    const share = new Intl.NumberFormat(numberLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const cap = new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 0 });
    return [(value: number) => `${share.format(value)}%`, (value: number) => `${cap.format(value)}%`] as const;
  }, [locale]);

  if (risk.phase === "guest") return null;
  const verdict = risk.body?.risk ?? null;
  const state = verdict?.state ?? null;
  const tone: Tone = state === "normal" ? "calm" : state === "attention" ? "caution" : "quiet";
  const Icon = ICON[tone];
  const [first, ...rest] = verdict?.findings ?? [];

  const retry = (
    <button type="button" className={`${watch.inlineAction} ${home.riskAction}`} onClick={risk.reload} data-risk-action="retry">
      <Capsule quiet>{riskWord("tryAgain", lang)}</Capsule>
    </button>
  );
  /* The state as a sentence: its word, then what it stands on; before a verdict, what is happening. */
  let said: ReactNode = null;
  let actions: ReactNode = null;
  let restUnread: ReactNode = null;
  if (verdict && state) {
    const reason = state === "attention" && first ? riskFindingLine(first, lang, pct, capPct) : state === "unknown" ? riskGapLine(verdict.gaps, lang) : null;
    said = (
      <>
        <b className={home.riskState}>{riskStateWord(state, lang)}</b>
        {reason ? (
          <span className={home.riskText}>
            {" · "}
            {reason}
          </span>
        ) : null}
      </>
    );
    if (state === "attention" && first) {
      const action = findingAction(first);
      actions = (
        <>
          <Link className={`${watch.inlineAction} ${home.riskAction}`} href={action.href} prefetch={false} data-risk-action={first.reason}>
            <Capsule>{riskWord(action.word, lang)}</Capsule>
          </Link>
          {rest.length > 0 ? (
            <button type="button" className={`${watch.inlineAction} ${home.riskAction}`} aria-expanded={open} aria-controls={listId} onClick={() => setOpen((shown) => !shown)} data-risk-action="more">
              <Capsule caret="down" quiet>
                {riskMoreWord(rest.length, lang)}
              </Capsule>
            </button>
          ) : null}
        </>
      );
    } else if (state === "unknown") {
      actions = retry;
    }
    /* «Увага» on what was read, while something else was not: said under it, with the retry. */
    if (state === "attention" && verdict.gaps.length > 0) {
      restUnread = (
        <p className={home.riskRest}>
          <span>
            {riskWord("restUnread", lang)} · {riskGapLine(verdict.gaps, lang)}
          </span>
          {retry}
        </p>
      );
    }
  } else if (risk.phase === "unproven") {
    said = <span className={home.riskPending}>{riskWord("unproven", lang)}</span>;
    actions = (
      <button type="button" className={`${watch.inlineAction} ${home.riskAction}`} onClick={risk.prove} disabled={risk.signing} data-risk-action="confirm">
        <Capsule>{riskWord(risk.signing ? "confirming" : "confirm", lang)}</Capsule>
      </button>
    );
  } else if (risk.phase === "failed") {
    said = <span className={home.riskPending}>{riskWord("unread", lang)}</span>;
    actions = retry;
  } else {
    said = (
      <span className={home.riskPending} aria-busy="true">
        {riskWord("checking", lang)}
      </span>
    );
  }

  return (
    <div className={`${home.risk} ${place === "side" ? home.riskSide : home.riskMain}`} data-tone={tone} data-risk={state ?? risk.phase} data-block="risk" data-place={place}>
      <p className={home.riskName}>
        {riskWord("title", lang)}
        <Help topic="portfolioRisk" locale={locale} />
      </p>
      <div className={home.riskBody}>
        <Icon size={16} weight="bold" aria-hidden="true" className={home.riskIcon} />
        <div className={home.riskCopy}>
          <p className={home.riskSaid} aria-live="polite">
            {said}
          </p>
          {actions ? <p className={home.riskActions}>{actions}</p> : null}
          {restUnread}
          {rest.length > 0 && open ? (
            <ul id={listId} className={home.riskMore}>
              {/* The rest are quiet rows, each a way to where it is acted on. */}
              {rest.map((finding) => (
                <li key={`${finding.reason}:${finding.mint ?? "class"}`}>
                  <Link className={home.riskMoreLink} href={findingAction(finding).href} prefetch={false} data-risk-action={finding.reason}>
                    <span>{riskFindingLine(finding, lang, pct, capPct)}</span>
                    <CaretRight size={12} weight="bold" aria-hidden="true" className={home.riskMoreCaret} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
