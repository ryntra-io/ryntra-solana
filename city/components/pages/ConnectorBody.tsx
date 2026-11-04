'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { CALLS_A_MINUTE, CONNECTOR_ROWS, CONNECTOR_URL } from '@/city/lib/pages/connector';
import { ArrowGlyph } from './glyphs';
import { Hero, More, PageDoor, PageFrame, Tile } from './parts';
import s from './pages.module.css';
import { CONNECTOR } from './words';

/**
 * «AI chats» (CITY-170): Ryntra in a person's AI chat. Three steps to connect and one action — the connector's address
 * to the clipboard; what it does in four tiles; one line on what it never does, a door to what it keeps (the Privacy
 * Policy) and a door to Help. The addresses, each chat's own menus, the limits and the way out are behind «Technical
 * details». The page links to no chat's site.
 */
export function ConnectorBody() {
  const w = useWords(CONNECTOR);
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
    <PageFrame id="connector">
      <Hero id="connector" kicker={w.kicker} title={w.title}>
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
      <button
        type="button"
        className={`${s.display} ${s.action}`}
        onClick={() => {
          void navigator.clipboard?.writeText(CONNECTOR_URL).then(
            () => setCopied(true),
            () => {},
          );
        }}
      >
        {copied ? w.copied : w.copy}
      </button>
      <span className={`${s.display} ${s.kicker}`} data-words="">
        {w.can}
      </span>
      <div className={s.tiles} data-words="">
        <Tile title={w.passportTitle} line={w.passportLine} />
        <Tile title={w.towerTitle} line={w.towerLine} />
        <Tile title={w.checkTitle} line={w.checkLine} />
        <Tile title={w.marketTitle} line={w.marketLine} />
      </div>
      <div className={s.contacts} data-words="">
        <span className={`${s.display} ${s.kicker}`}>{w.trust}</span>
        <p className={`${s.moreRow} ${s.plainRow}`}>{w.readsOnly}</p>
        <PageDoor id="privacy" className={s.moreRow}>
          <span>{w.yourData}</span>
          <ArrowGlyph />
        </PageDoor>
        <PageDoor id="help" className={s.moreRow}>
          <span>{w.support}</span>
          <ArrowGlyph />
        </PageDoor>
      </div>
      <More label={w.technical}>
        <dl className={s.code}>
          {CONNECTOR_ROWS.map((row) => (
            <div key={row.what} className={s.codeRow}>
              <dt>{w[row.what]}</dt>
              <dd>
                <code>{row.value}</code>
              </dd>
            </div>
          ))}
        </dl>
        <p className={s.moreLine}>{w.limits(CALLS_A_MINUTE)}</p>
        <p className={s.moreLine}>{w.access}</p>
        <p className={s.moreLine}>{w.disconnect}</p>
        <p className={s.moreLine}>{w.advice}</p>
      </More>
    </PageFrame>
  );
}
