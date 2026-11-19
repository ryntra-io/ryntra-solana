'use client';

import { useEffect, useState } from 'react';

import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { Chip, Icon, Info } from '@/terminal/ui';
import { chipKey, chipOf, guardKey, guardOf, timeText } from './facts-view';
import { useStockPoolFacts } from './useStockPoolFacts';
import { STOCK_FACTS } from './words';
import s from './stocks.module.css';

/** The clock the times are judged by: a minute is fine enough for an exchange's hours. */
const TICK_MS = 60_000;

/**
 * A stock's facts on a pool page, one small block: the exchange's chip («Exchange closed · opens Mon 15:30»),
 * the dividend guard's line when one is in sight, and the issuer's terms behind «i». A coin that is no stock shows
 * nothing. The pool page mounts it in one line — `<StockPoolFacts mint={mint} />` — in its left column and above its
 * action; a server page that has read the facts already hands them in as `facts`.
 */
export function StockPoolFacts({ mint, facts: given }: { mint: string; facts?: PoolFacts | null }) {
  const facts = useStockPoolFacts(mint, given);
  const d = useWords(STOCK_FACTS);
  const lang = useLang();
  // Times are the person's own clock, so they are drawn in the browser only — never a server's zone first.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, []);
  if (now === null || !facts?.isStock || !facts.issuer) return null;
  const chip = chipOf(facts, now);
  const guard = guardOf(facts, now);
  const when = (at: number) => timeText(at, now, lang);
  const chipText = chip ? (chip.at === null ? d[chip.key] : d[`${chip.key}Until`](when(chip.at))) : null;
  return (
    <section className={s.facts} aria-label={d.label} data-session={facts.session}>
      <div className={s.row}>
        {chip ? (
          <span className={s.chip}>
            <Chip tone={chip.tone} dot>
              <span className={s.chipText} data-key={chipKey(chip)}>
                {chipText}
              </span>
            </Chip>
          </span>
        ) : (
          <span />
        )}
        <Info label={d.terms}>
          <span className={s.terms}>
            <span className={s.termsHead}>{d.terms}</span>
            <span>{d.issuedBy(facts.issuer.label)}</span>
            {facts.termsUrl ? (
              <a className={s.termsLink} href={facts.termsUrl} target="_blank" rel="noopener noreferrer">
                {d.read}
                <Icon name="arrow" size="s" />
              </a>
            ) : null}
          </span>
        </Info>
      </div>
      {guard ? (
        <p className={s.guard} data-tone={guard.now ? 'warn' : undefined}>
          <Icon name="shield" size="s" />
          <span>{d[guardKey(guard)](when(guard.at))}</span>
        </p>
      ) : null}
    </section>
  );
}
