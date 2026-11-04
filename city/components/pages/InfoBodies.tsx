'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { howStore } from '@/city/lib/art/how';
import { CITY_STATUS } from '@/city/lib/docs/doors';
import { docPath } from '@/city/lib/docs/model';
import { navOf } from '@/city/lib/docs/nav';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { API_BASE, DEV_ROWS } from '@/city/lib/pages/developers';
import { CONTACTS, contactMailto } from '@/lib/site/contacts';
import { ArrowGlyph, ChevronGlyph, XGlyph } from './glyphs';
import { Hero, More, PageDoor, PageFrame, Tile } from './parts';
import s from './pages.module.css';
import { ABOUT, DEVS, DOCS, PAGES } from './words';

/**
 * «Docs» as a window of the city (CITY-157, CITY-180): the opening and every section, each one a door to its own address, where
 * the documentation stands in full; and the city's own film. Which sections say «Soon» is read from this build's doors.
 */
export function DocsBody() {
  const w = useWords(DOCS);
  const lang = useLang();
  const nav = navOf(lang, CITY_STATUS);
  return (
    <PageFrame id="docs">
      <Hero id="docs" kicker={w.kicker} title={w.title}>
        <p className={s.lead}>{w.lead}</p>
      </Hero>
      <Link className={`${s.display} ${s.action}`} href={docPath('start')} prefetch={false}>
        {w.start}
      </Link>
      <div className={s.contacts} data-words="">
        {nav.map((group) => (
          <Fragment key={group.id}>
            <span className={`${s.display} ${s.kicker} ${s.docsGroup}`}>{group.title}</span>
            {group.items.map((item) => (
              <Link key={item.key} className={s.moreRow} href={item.href} prefetch={false}>
                <span>{item.title}</span>
                {item.soon ? <span className={s.soonTag}>{w.soon}</span> : <ChevronGlyph />}
              </Link>
            ))}
          </Fragment>
        ))}
      </div>
      <button type="button" className={s.moreRow} data-words="" onClick={() => howStore.getState().show()}>
        <span>{w.how}</span>
        <ChevronGlyph />
      </button>
    </PageFrame>
  );
}

/**
 * «Developers» (CITY-157): connect an agent in three steps — sign in with Solana, read what is open, prepare then sign —
 * and one action, the API's address to the clipboard. The addresses themselves are behind «Technical details». The
 * AI-chat connector is live (CITY-154): a door to its own page (CITY-170).
 */
export function DevelopersBody() {
  const w = useWords(DEVS);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const steps = [
    [w.step1, w.step1Line],
    [w.step2, w.step2Line],
    [w.step3, w.step3Line],
  ] as const;
  return (
    <PageFrame id="developers">
      <Hero id="developers" kicker={w.kicker} title={w.title}>
        <p className={s.lead}>{w.lead}</p>
      </Hero>
      <ol className={s.steps} data-words="">
        {steps.map(([title, line], i) => (
          <li key={title} className={s.step}>
            <span className={`${s.display} ${s.stepNo}`} aria-hidden="true">
              {i + 1}
            </span>
            <span className={s.stepText}>
              <b>{title}</b>
              <span>{line}</span>
            </span>
          </li>
        ))}
      </ol>
      <div data-words="">
        <Tile title={w.chatsTitle} line={w.chatsLine} door="connector" />
      </div>
      <div className={s.soon} data-words="">
        <span>{w.soonLine}</span>
        <span className={s.soonTag}>{w.soon}</span>
      </div>
      <button
        type="button"
        className={`${s.display} ${s.action}`}
        onClick={() => {
          void navigator.clipboard?.writeText(API_BASE).then(
            () => setCopied(true),
            () => {},
          );
        }}
      >
        {copied ? w.copied : w.copy}
      </button>
      <More label={w.technical}>
        <dl className={s.code}>
          {DEV_ROWS.map((row) => (
            <div key={row.what} className={s.codeRow}>
              <dt>{w[row.what]}</dt>
              <dd>
                <code>{row.value}</code>
              </dd>
            </div>
          ))}
        </dl>
      </More>
    </PageFrame>
  );
}

/**
 * «About» (CITY-157): Ryntra in one line, three things it stands on, how to reach it; one action, Help.
 */
export function AboutBody() {
  const w = useWords(ABOUT);
  const p = useWords(PAGES);
  return (
    <PageFrame id="about">
      <Hero id="about" kicker={w.kicker} title="Ryntra">
        <p className={s.lead}>{w.lead}</p>
      </Hero>
      <div className={s.tiles} data-words="">
        <Tile title={w.custodyTitle} line={w.custodyLine} />
        <Tile title={w.honestTitle} line={w.honestLine} />
        <Tile title={w.solanaTitle} line={w.solanaLine} />
      </div>
      <div className={s.contacts} data-words="">
        <span className={`${s.display} ${s.kicker}`}>{w.contact}</span>
        <a className={s.moreRow} href={contactMailto()}>
          <span>{w.email}</span>
          <span className={s.moreValue}>{CONTACTS.email}</span>
        </a>
        <a className={s.moreRow} href={CONTACTS.companyX} target="_blank" rel="noopener">
          <span className={s.rowIcon}>
            <XGlyph />
            {p.onX}
          </span>
          <ArrowGlyph />
        </a>
        <a className={s.moreRow} href="/.well-known/security.txt" target="_blank" rel="noopener">
          <span>{w.securityReports}</span>
          <ArrowGlyph />
        </a>
      </div>
      <PageDoor id="help" className={`${s.display} ${s.action}`}>
        {w.getHelp}
      </PageDoor>
    </PageFrame>
  );
}
