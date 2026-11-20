'use client';

import { useRouter } from 'next/navigation';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { Action, Figure, Icon, Kick } from '@/terminal/ui';
import { Pair } from './bits';
import { TYPE_NAME, poolPage } from './Chooser';
import { ageText, dayPctText, type ChooseRow } from './choose';
import { feeText, shortUsd } from './rows';
import { EARN } from './words';
import e from './earn.module.css';

/**
 * A pool shown to compare: its own figures from the venue, and its one action — the pool's own desk here,
 * its chart, trades and swap («Adding — coming» was a line with nothing to do); its page at the venue a quiet
 * link under it. The pools that take one approval from here are a tap away in the same table.
 */
export function ViewTicket({ row, nowMs }: { row: ChooseRow; nowMs: number }) {
  const w = useWords(EARN);
  const lang = useLang();
  const router = useRouter();
  // DAMM v2 has no price step: its line says the kind and the fee only.
  const caption = [TYPE_NAME[row.type], row.step === null ? null : w.stepOf(digits(String(row.step), lang)), w.feeOf(feeText(row.feePct, lang))].filter(Boolean).join(' · ');
  return (
    <div className={e.view}>
      <div className={e.ticketHead}>
        <Pair coins={row.coins} size="l" />
        <span className={e.cellWords}>
          <span className={e.sym}>{row.name}</span>
          <span className={e.cap}>{caption}</span>
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
      <Action onClick={() => router.push(poolPage(row))} data-earn-act="open-pool">
        {w.openPool}
      </Action>
      {row.page ? (
        <a className={e.venue} href={row.page} target="_blank" rel="noopener noreferrer">
          {w.openVenue}
          <Icon name="arrow" size="s" />
        </a>
      ) : null}
    </div>
  );
}
