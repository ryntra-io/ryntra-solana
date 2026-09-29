import { ArrowRight, ArrowUpRight, Check, HourglassMedium } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { CompanyPath, CompanyPathStep } from "@/lib/stocks/company-path";

import company from "./company.module.css";
import { PATH_WORDS, sourceLine, stepLines, stepName, swapLines, swapRuleLine, tokenNature } from "./company-path-words";

type Lang = "en" | "uk";

/**
 * «Шлях компанії» (`RYN-COMPANY-PATH-001`, canon v5.2 В27, §7) — one strip on
 * the company page, under the company's name: Приватна · PreStocks → IPO →
 * Біржа → Solana, each step passed, current or not announced, with its day.
 * The token of this page stands at its step as «цей токен»; the company's
 * other token stands at its own step as a link to its page — SPACEX and
 * SPCXx are one company at two steps, each leading to the other, each saying
 * what it is. Under the steps the one line that matters to a holder: the
 * private token's swap deadline with the issuer's minute, or, for a company
 * still private, the issuer's rule after an IPO. Where each fact was read sits
 * one press deeper, under «Джерела».
 *
 * `footer` replaces the line under the steps where the page has more to say
 * there — the private token's own page puts the holder's swap in it.
 */
export function CompanyPathStrip({ path, locale, privateFeeBps, footer = null }: { path: CompanyPath; locale: WorkspaceLocale; privateFeeBps: number | null; footer?: ReactNode }) {
  const lang: Lang = locale === "uk" ? "uk" : "en";
  const line = footer ?? <PathLine path={path} lang={lang} />;
  return (
    <section className={company.path} aria-labelledby="company-path-title" data-company-path={path.at}>
      <h2 id="company-path-title" className={company.pathTitle}>
        {PATH_WORDS.title[lang]}
      </h2>
      <ol className={company.pathSteps}>
        {path.steps.map((step) => (
          <PathStep key={step.step} step={step} here={step.step === path.at} lang={lang} privateFeeBps={privateFeeBps} />
        ))}
      </ol>
      {line}
      {path.sources.length > 0 ? (
        <details className={company.pathSources}>
          <summary>{PATH_WORDS.sources[lang]}</summary>
          <ul>
            {path.sources.map((source) => (
              <li key={source.url}>
                <a className={company.sourceLink} href={source.url} target="_blank" rel="noopener noreferrer">
                  {sourceLine(source, lang)}
                  <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function PathStep({ step, here, lang, privateFeeBps }: { step: CompanyPathStep; here: boolean; lang: Lang; privateFeeBps: number | null }) {
  const lines = stepLines(step, lang);
  const token = step.token;
  return (
    <li className={company.pathStep} data-state={step.state} data-step={step.step} aria-current={step.state === "current" ? "step" : undefined}>
      <span className={company.pathDot} aria-hidden="true">
        {step.state === "passed" ? <Check size={11} weight="bold" /> : null}
      </span>
      <div className={company.pathBody}>
        <p className={company.pathName}>{stepName(step.step, lang)}</p>
        <div className={company.pathLines}>
          {lines.map((text) => (
            <p key={text} className={company.pathLine}>
              {text}
            </p>
          ))}
        </div>
        {token && (step.step === "private" || step.step === "solana") ? (
          <div className={company.pathToken}>
            {here ? (
              <span className={company.pathChip} data-here="true" translate="no">
                {token.symbol}
                <span className={company.pathChipHere}>{PATH_WORDS.thisToken[lang]}</span>
              </span>
            ) : (
              <Link className={company.pathChip} href={`/app/stocks/${encodeURIComponent(token.symbol)}`} prefetch={false} translate="no" data-path-link={token.symbol}>
                {token.symbol}
                <ArrowRight size={13} weight="bold" aria-hidden="true" />
              </Link>
            )}
            <span className={company.pathNature}>{tokenNature(step.step, lang, step.step === "private" ? privateFeeBps : null)}</span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The line under the steps: the swap deadline for everyone, or the issuer's rule while the company is private. */
function PathLine({ path, lang }: { path: CompanyPath; lang: Lang }) {
  if (path.swap) {
    return (
      <p className={company.pathSwap} data-path-swap={path.swap.open ? "open" : "closed"}>
        <HourglassMedium size={16} weight="bold" aria-hidden="true" />
        <span>{swapLines(path.swap, lang).everyone}</span>
      </p>
    );
  }
  if (path.swapMonths !== null) {
    return (
      <p className={company.pathRule} data-path-rule>
        {swapRuleLine(path.swapMonths, lang)}
      </p>
    );
  }
  return null;
}
