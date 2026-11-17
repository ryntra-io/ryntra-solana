'use client';

import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { Figure, Icon, Kick } from '@/terminal/ui';
import { Pair } from './bits';
import { TYPE_NAME } from './Chooser';
import { ageText, dayPctText, type ChooseRow } from './choose';
import { feeText, shortUsd } from './rows';
import { EARN } from './words';
import e from './earn.module.css';

/**
 * A pool shown to compare: its own figures from the venue and its page there. Adding to it from Ryntra is
 * not built yet — said in one line; the pools that take one approval from here are a tap away in the same table.
 */
export function ViewTicket({ row, nowMs }: { row: ChooseRow; nowMs: number }) {
  const w = useWords(EARN);
  const lang = useLang();
  const step = row.step === null ? '—' : digits(String(row.step), lang);
  return (
    <div className={e.view}>
      <div className={e.ticketHead}>
        <Pair coins={row.coins} size="l" />
        <span className={e.cellWords}>
          <span className={e.sym}>{row.name}</span>
          <span className={e.cap}>
            {TYPE_NAME[row.type]} · {w.stepOf(step)} · {w.feeOf(feeText(row.feePct, lang))}
          </span>
        </span>
      </div>
      <div className={e.viewDay}>
        <Kick>{w.viewDayPct}</Kick>
        <Figure value={dayPctText(row.feeTvlPct, lang)} size="l" tone={row.feeTvlPct !== null && row.feeTvlPct > 0 ? 'up' : undefined} />
      </div>
      <dl className={e.kv}>
        <dt>{w.inPool}</dt>
        <dd>{shortUsd(row.tvlUsd, lang)}</dd>
        <dt>{w.volume24}</dt>
        <dd>{shortUsd(row.volume24hUsd, lang)}</dd>
        <dt>{w.fees24}</dt>
        <dd>{shortUsd(row.fees24hUsd, lang)}</dd>
        <dt>{w.cAge}</dt>
        <dd>{ageText(row.createdAt, lang, nowMs)}</dd>
      </dl>
      <p className={e.viewSoon}>{w.viewSoon}</p>
      {row.page ? (
        <a className={e.venue} href={row.page} target="_blank" rel="noopener noreferrer">
          {w.openVenue}
          <Icon name="arrow" size="s" />
        </a>
      ) : null}
    </div>
  );
}
