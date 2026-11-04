'use client';

import { useEffect } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { DISCOUNT_ON } from '@/city/lib/partners/discount';
import { OFFER, percent } from '@/city/lib/partners/facts';
import { devAskOf } from '@/city/lib/partners/landing';
import { usePartners } from '@/city/lib/partners/store';
import { PARTNER_TERMS, termsRows } from '@/city/lib/partners/terms';
import { contactMailto } from '@/lib/site/contacts';
import { DocumentShell } from '../pages/DocumentPage';
import { More } from '../pages/parts';
import { PAGES } from '../pages/words';
import { artOf, Demo, Status } from './bits';
import { Calculator } from './Calculator';
import { CopyLink } from './CopyLink';
import { ArrowGlyph } from './glyphs';
import p from './page.module.css';
import s from './partners.module.css';
import { PARTNERS } from './words';

/** The still at the head: the home quarter's lit windows, filmed from our own live city. */
const ART = artOf('district-home');

/**
 * `/partners` (CITY-177): how partners earn, as one short page of the site — not a deck. On top the one thing: the
 * partner's share of Ryntra's fee and the friend's discount (decision 93, `city/lib/partners/terms.ts`), and «Copy my
 * link» at once. Below, three steps, the calculator, and the rules behind «Details». The city's «Partners» window
 * carries the same button and the same numbers.
 */
export function PartnersPage() {
  return (
    <DocumentShell doc="partners" current="partners" wide>
      <PartnersBody />
    </DocumentShell>
  );
}

function PartnersBody() {
  const lang = useLang();
  const w = useWords(PARTNERS);
  const pw = useWords(PAGES);
  const demo = usePartners((st) => st.demo);

  // Development only: `?partners=demo` shows a ready link under the «DEMO» mark.
  useEffect(() => {
    const ask = process.env.NODE_ENV === 'production' ? { demo: false } : devAskOf(window.location.search);
    usePartners.getState().setup({ demo: ask.demo });
  }, []);

  const terms = termsRows(lang, PARTNER_TERMS);
  const steps = [
    { title: w.stepCopy, line: w.stepCopyLine },
    { title: w.stepShare, line: w.stepShareLine },
    { title: w.stepEarn, line: OFFER ? w.stepEarnLine(percent(OFFER.firstPercent, lang), OFFER.firstDays, percent(OFFER.afterPercent, lang)) : w.soon },
  ];

  return (
    <div className={p.page} data-partners-page="">
      <header className={p.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={p.art} src={ART.src} srcSet={ART.srcSet} sizes="100vw" alt="" decoding="async" fetchPriority="high" />
        <div className={p.heroBody} data-words="">
          <span className={`${s.display} ${s.kicker}`}>{w.kicker}</span>
          <h1 className={`${s.display} ${p.title}`}>{w.pageTitle}</h1>
        </div>
      </header>

      <section className={p.top} aria-label={w.title} data-words="">
        {OFFER ? (
          <div className={`${s.offer} ${p.offer}`}>
            <div className={`${s.side} ${s.sideYou}`}>
              <span className={s.sideLabel}>{w.you}</span>
              <b className={`${s.display} ${s.sideBig} ${p.big}`}>{percent(OFFER.firstPercent, lang)}</b>
              <span className={s.sideLine}>{w.youLine(OFFER.firstDays, percent(OFFER.afterPercent, lang))}</span>
            </div>
            <div className={s.side}>
              <span className={s.sideLabel}>{w.friend}</span>
              <b className={`${s.display} ${s.sideBig} ${p.big}`}>{percent(OFFER.discountPercent, lang)}</b>
              <span className={s.sideLine}>{DISCOUNT_ON ? w.friendLine : w.friendLineSoon}</span>
            </div>
          </div>
        ) : (
          <b className={`${s.display} ${s.big}`}>{w.soon}</b>
        )}
        <div className={p.copyBox} data-partners-copy="">
          <CopyLink />
          <div className={p.status}>
            <Status />
          </div>
        </div>
      </section>

      <section className={p.block} aria-labelledby="partners-how" data-words="">
        <h2 id="partners-how" className={`${s.display} ${p.head}`}>
          {w.howTitle}
        </h2>
        <ol className={p.steps}>
          {steps.map((step, i) => (
            <li key={step.title} className={p.step}>
              <span className={`${s.display} ${p.stepNo}`}>{i + 1}</span>
              <span className={p.stepText}>
                <b>{step.title}</b>
                {step.line}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${p.block} ${s.calcWide}`} aria-labelledby="partners-calc" data-words="">
        <h2 id="partners-calc" className={`${s.display} ${p.head}`}>
          {w.calcTitle}
        </h2>
        <Calculator />
      </section>

      <div data-words="">
        <More label={pw.details}>
          <dl className={`${s.terms} ${p.terms}`}>
            {terms.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className={s.termsNote}>{terms.note}</p>
          <ul className={p.rules}>
            {[
              [w.ruleFee, w.ruleFeeLine],
              [w.ruleNever, w.ruleNeverLine],
              [w.ruleSeen, w.ruleSeenLine],
            ].map(([title, line]) => (
              <li key={title}>
                <b>{title}</b>
                {line}
              </li>
            ))}
          </ul>
          <a className={p.row} href={contactMailto('Partner programme')}>
            <span>{w.writeUs}</span>
            <ArrowGlyph />
          </a>
        </More>
      </div>
      {demo ? <Demo text={w.demo} /> : null}
    </div>
  );
}
