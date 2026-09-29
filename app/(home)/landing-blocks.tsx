import Link from "next/link";
import {
  AndroidLogo,
  ArrowRight,
  Check,
  CircleDashed,
  Coins,
  DeviceMobile,
  Hammer,
  HourglassMedium,
  Key,
  PenNib,
  Receipt,
} from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties } from "react";

import { companyPathFor } from "@/lib/stocks/company-path";
import { COMPANY_PATHS } from "@/lib/stocks/lifecycle-events";
import { INVEST_WORDS, buyByRuleWord } from "@/app/app/invest/invest-words";
import { stepLines, stepName, swapLines } from "@/app/app/stocks/[ticker]/company-path-words";

import { AutoinvestBlock } from "./autoinvest-block";
import { localizedPath } from "@/lib/site/localized";

import { landingCopy, type LandingLocale } from "./landing-copy";
import { Reveal } from "./reveal";
import { Shot } from "./shot";
import styles from "./blocks.module.css";

/*
 * The landing's new blocks, between the Owner's workflow and the Owner's
 * Rewards (the Owner's word of 2026-09-26: «Твій дизайн + v5.5» — add the
 * phone, Autoinvest and every function, interactive, lit, moving, in the same
 * design). Each block's words are `landing-copy.ts`; each picture of the
 * product is a screen of `ryntra.io`; each figure is the product's own.
 */

const d = (step: number) => ({ "--d": step }) as CSSProperties;

/** «Автоінвест» — the words and the reminder are prepared here, the turns run in the browser. */
export function AutoinvestSection({ locale }: { locale: LandingLocale }) {
  const copy = landingCopy(locale).autoinvest;
  const reminder = {
    head: INVEST_WORDS.timeToBuy[locale],
    text: locale === "uk" ? "$1 в NVIDIA" : "$1 of NVIDIA",
    action: buyByRuleWord(locale, 1),
  };
  return <AutoinvestBlock copy={copy} locale={locale} reminder={reminder} />;
}

/** What you buy, in each issuer's own label — and one company's path from private to its share on Solana. */
export function WhatYouBuy({ locale }: { locale: LandingLocale }) {
  const c = landingCopy(locale);
  const record = COMPANY_PATHS[0];
  /* SpaceX, as its private token's page draws it: every step passed, the company at Solana, the swap's deadline under the strip. */
  const path = record ? companyPathFor({ mint: record.privateMint, symbol: "SPACEX", issuerId: "prestocks", instrumentClass: "pre-ipo" }, Date.now()) : null;
  const swap = path?.swap ? swapLines(path.swap, locale).everyone : null;

  return (
    <Reveal id="what-you-buy" className={styles.block} labelledBy="buy-title">
      <div className={styles.wrap}>
        <div className={styles.head}>
          <p className={`${styles.eyebrow} ${styles.rise}`}>{c.buy.eyebrow}</p>
          <h2 id="buy-title" className={`${styles.title} ${styles.rise}`} style={d(1)}>
            <span>{c.buy.titleLines[0]}</span>{" "}
            <span className={styles.accent}>{c.buy.titleLines[1]}</span>
          </h2>
          <p className={`${styles.lead} ${styles.rise}`} style={d(2)}>{c.buy.lead}</p>
        </div>

        <ul className={styles.issuers}>
          {c.buy.issuers.map((row, index) => (
            <li key={row.id} className={`${styles.tile} ${styles.rise}`} style={d(3 + index)} data-issuer={row.id}>
              <h3 className={styles.issuerName}>{row.issuer}</h3>
              <span className={styles.label}>{row.label}</span>
              <p className={styles.tileBody}>{row.line}</p>
              <p className={styles.examples} translate="no">{row.examples}</p>
            </li>
          ))}
        </ul>

        {path ? (
          <div className={`${styles.panel} ${styles.pathPanel} ${styles.rise}`} style={d(6)}>
            <span className={styles.rim} aria-hidden="true" />
            <div className={styles.pathHead}>
              <p className={styles.pathCompany}>{c.path.company}</p>
              <h3 className={styles.pathTitle}>{c.path.title}</h3>
              <p className={styles.pathLead}>{c.path.lead}</p>
              <Link className={styles.link} href={localizedPath("/app/stocks/SPACEX", locale)} prefetch={false}>
                {c.path.open}
                <ArrowRight size={18} weight="bold" aria-hidden />
              </Link>
            </div>
            <div>
              <ol className={styles.steps}>
                {path.steps.map((step, index) => (
                  <li key={step.step} className={styles.step} data-state={step.state} style={{ "--k": index } as CSSProperties}>
                    <span className={styles.node} aria-hidden="true">
                      {step.state === "passed" ? <Check size={16} weight="bold" /> : null}
                    </span>
                    <span className={styles.stepName}>{stepName(step.step, locale)}</span>
                    {stepLines(step, locale).map((line) => (
                      <span key={line} className={styles.stepLine}>{line}</span>
                    ))}
                    {step.token ? <span className={styles.token} translate="no">{step.token.symbol}</span> : null}
                  </li>
                ))}
              </ol>
              {swap ? (
                <p className={styles.swap} style={{ marginTop: "var(--ry-s6)" }}>
                  <HourglassMedium size={18} weight="bold" aria-hidden />
                  {swap}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <Link className={`${styles.link} ${styles.rise}`} style={{ ...d(7), marginTop: "var(--ry-s5)" }} href={localizedPath("/app/markets", locale)} prefetch={false}>
          {c.buy.open}
          <ArrowRight size={18} weight="bold" aria-hidden />
        </Link>
      </div>
    </Reveal>
  );
}

/** On the phone: three screens of `ryntra.io`, the web on the phone now, the Android app being built. */
export function OnYourPhone({ locale }: { locale: LandingLocale }) {
  const c = landingCopy(locale).mobile;
  return (
    <Reveal id="phone" className={styles.block} labelledBy="phone-title">
      <div className={`${styles.wrap} ${styles.split} ${styles.splitFlip}`}>
        <div className={styles.head}>
          <p className={`${styles.eyebrow} ${styles.rise}`}>{c.eyebrow}</p>
          <h2 id="phone-title" className={`${styles.title} ${styles.rise}`} style={d(1)}>
            <span>{c.titleLines[0]}</span>{" "}
            <span className={styles.accent}>{c.titleLines[1]}</span>
          </h2>
          <p className={`${styles.lead} ${styles.rise}`} style={d(2)}>{c.lead}</p>
          <ul className={styles.states}>
            <li className={`${styles.state} ${styles.rise}`} style={d(3)} data-state="now">
              <span className={styles.pulse} aria-hidden="true" />
              <DeviceMobile size={20} weight="bold" aria-hidden />
              {c.now}
            </li>
            <li className={`${styles.state} ${styles.rise}`} style={d(4)} data-state="building">
              <span className={styles.pulse} aria-hidden="true" />
              <AndroidLogo size={20} weight="bold" aria-hidden />
              {c.building}
            </li>
          </ul>
        </div>
        <div className={`${styles.fan} ${styles.rise}`} style={d(2)}>
          <span className={styles.fanFloor} aria-hidden="true" />
          <Shot name="company" locale={locale} alt={c.shotAlts[0]} className={styles.fanLeft} />
          <Shot name="buy" locale={locale} alt={c.shotAlts[1]} className={styles.fanMid} />
          <Shot name="autoinvest" locale={locale} alt={c.shotAlts[2]} className={styles.fanRight} />
        </div>
      </div>
    </Reveal>
  );
}

const FACT_ICONS = [Key, PenNib, Coins, Receipt] as const;

/** Security: what Ryntra never touches, four facts and the page that says the rest. */
export function Security({ locale }: { locale: LandingLocale }) {
  const c = landingCopy(locale).security;
  return (
    <Reveal id="security" className={styles.block} labelledBy="security-title">
      <span className={styles.bloom} aria-hidden="true" />
      <div className={styles.wrap}>
        <div className={`${styles.head} ${styles.headCenter}`}>
          <p className={`${styles.eyebrow} ${styles.rise}`}>{c.eyebrow}</p>
          <h2 id="security-title" className={`${styles.title} ${styles.rise}`} style={d(1)}>
            <span>{c.titleLines[0]}</span>{" "}
            <span className={styles.accent}>{c.titleLines[1]}</span>
          </h2>
          <p className={`${styles.lead} ${styles.rise}`} style={d(2)}>{c.lead}</p>
        </div>
        <ul className={styles.facts}>
          {c.facts.map((fact, index) => {
            const Icon = FACT_ICONS[index] ?? Key;
            return (
              <li key={fact.title} className={`${styles.tile} ${styles.rise}`} style={d(3 + index)}>
                <span className={styles.icon} aria-hidden="true"><Icon size={24} weight="bold" /></span>
                <h3 className={styles.tileTitle}>{fact.title}</h3>
                <p className={styles.tileBody}>{fact.body}</p>
              </li>
            );
          })}
        </ul>
        <div className={`${styles.headCenter} ${styles.head} ${styles.more}`}>
          <Link className={styles.link} href={localizedPath("/security", locale)} prefetch={false}>
            {c.more}
            <ArrowRight size={18} weight="bold" aria-hidden />
          </Link>
        </div>
      </div>
    </Reveal>
  );
}

/** Where Ryntra is today — what works now, what is being built, what comes next (canon В40). */
export function Today({ locale }: { locale: LandingLocale }) {
  const c = landingCopy(locale).status;
  return (
    <Reveal id="today" className={styles.block} labelledBy="today-title">
      <div className={styles.wrap}>
        <div className={styles.head}>
          <p className={`${styles.eyebrow} ${styles.rise}`}>{c.eyebrow}</p>
          <h2 id="today-title" className={`${styles.title} ${styles.rise}`} style={d(1)}>
            <span>{c.titleLines[0]}</span>{" "}
            <span className={styles.accent}>{c.titleLines[1]}</span>
          </h2>
        </div>
        <div className={styles.today}>
          <div className={`${styles.panel} ${styles.column} ${styles.rise}`} style={d(2)} data-state="now">
            <p className={styles.columnHead}><span className={styles.pulse} aria-hidden="true" />{c.now.title}</p>
            <ul className={styles.items}>
              {c.now.items.map((item) => (
                <li key={item.key}><Check size={16} weight="bold" aria-hidden />{item.text}</li>
              ))}
            </ul>
          </div>
          <div className={`${styles.panel} ${styles.column} ${styles.rise}`} style={d(3)} data-state="building">
            <span className={styles.rim} aria-hidden="true" />
            <p className={styles.columnHead}><span className={styles.pulse} aria-hidden="true" />{c.building.title}</p>
            <ul className={styles.items}>
              {c.building.items.map((item) => (
                <li key={item.key}>
                  {item.key === "android" ? <AndroidLogo size={16} weight="bold" aria-hidden /> : <Hammer size={16} weight="bold" aria-hidden />}
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
          <div className={`${styles.panel} ${styles.column} ${styles.rise}`} style={d(4)} data-state="next">
            <p className={styles.columnHead}><span className={styles.pulse} aria-hidden="true" />{c.next.title}</p>
            <ul className={styles.items}>
              {c.next.items.map((item) => (
                <li key={item.key}><CircleDashed size={16} weight="bold" aria-hidden />{item.text}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/** The questions people ask first — the same words the page's structured data carries. */
export function Questions({ locale }: { locale: LandingLocale }) {
  const c = landingCopy(locale).faq;
  return (
    <Reveal id="questions" className={styles.block} labelledBy="questions-title">
      <div className={styles.wrap}>
        <div className={`${styles.head} ${styles.headCenter}`}>
          <p className={`${styles.eyebrow} ${styles.rise}`}>{c.eyebrow}</p>
          <h2 id="questions-title" className={`${styles.title} ${styles.rise}`} style={d(1)}>
            <span>{c.title}</span>
          </h2>
        </div>
        <div className={styles.faq}>
          {c.items.map((item, index) => (
            <details key={item.q} className={`${styles.question} ${styles.rise}`} style={d(2 + Math.min(index, 6))}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
