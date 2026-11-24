'use client';

import { useEffect, useState } from 'react';

import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { ISSUER_TERMS } from '@/lib/stocks/issuer-terms';
import { issuerPowersLine, type PoolFacts } from '@/lib/stocks/pool-facts';
import { coinHref } from '@/terminal/shell/shelves';
import { Chip, Icon, Info, QuietLink } from '@/terminal/ui';
import { chipKey, chipOf, guardKey, guardOf, timeText } from './facts-view';
import { useStockPoolFacts } from './useStockPoolFacts';
import { STOCK_COIN, STOCK_FACTS } from './words';
import s from './stocks.module.css';

/** The clock the times are judged by: a minute is fine enough for an exchange's hours. */
const TICK_MS = 60_000;

/**
 * A stock's facts on the coin's page, one small block on the stock's own facts (`StockPoolFacts`'s read):
 * what the token is and whose («Stock token · Backpack Securities»), the exchange's chip with the time it next changes,
 * what the issuer can do to the token, the guard around a dividend or a split, and the issuer's terms — who issues it,
 * where it is not offered, its document — behind «i». A private token whose company now trades says so, with its
 * share one tap away. A coin that is no stock shows nothing. The coin's page mounts it in one line —
 * `<StockCoinFacts mint={mint} />`. `headSays` — the page's head already says whose token it is and how the exchange
 * stands (a desk): the block keeps the rest and does not say them twice.
 */
export function StockCoinFacts({ mint, facts: given, headSays = false }: { mint: string; facts?: PoolFacts | null; headSays?: boolean }) {
  const facts = useStockPoolFacts(mint, given);
  const d = useWords(STOCK_FACTS);
  const w = useWords(STOCK_COIN);
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
  const terms = ISSUER_TERMS[facts.issuer.id];
  const excluded = terms ? terms.excluded.map((place) => place[lang]).join(', ') : '';
  const powers = issuerPowersLine(facts.powers, lang);
  return (
    <section className={s.facts} aria-label={d.label} data-session={facts.session} data-stock-coin="">
      <div className={s.row}>
        {headSays ? (
          <span className={s.issuerKind}>{d.terms}</span>
        ) : (
          <span className={s.issuer}>
            <span className={s.issuerKind}>{facts.kind === 'pre-ipo' ? w.preIpo : w.share}</span>
            <span className={s.issuerName}>{facts.issuer.label}</span>
          </span>
        )}
        <Info label={d.terms}>
          <span className={s.terms}>
            <span className={s.termsHead}>{d.terms}</span>
            <span>{d.issuedBy(facts.issuer.label)}</span>
            {excluded ? <span>{w.notOffered(excluded)}</span> : null}
            {facts.termsUrl ? (
              <a className={s.termsLink} href={facts.termsUrl} target="_blank" rel="noopener noreferrer">
                {d.read}
                <Icon name="arrow" size="s" />
              </a>
            ) : null}
          </span>
        </Info>
      </div>
      {chip && !headSays ? (
        <span className={s.chip}>
          <Chip tone={chip.tone} dot>
            <span className={s.chipText} data-key={chipKey(chip)}>
              {chipText}
            </span>
          </Chip>
        </span>
      ) : null}
      {facts.listed ? (
        <div className={s.listed}>
          <span className={s.listedText}>{w.listedNow(facts.listed.company, facts.listed.ticker)}</span>
          <QuietLink size="s" href={coinHref(facts.listed.solana.mint, 'live')}>
            {w.open(facts.listed.solana.symbol)}
          </QuietLink>
        </div>
      ) : null}
      {powers ? (
        <span className={s.powers} data-tone="warn">
          <Icon name="shield" size="s" />
          <span>{powers}</span>
        </span>
      ) : null}
      {guard ? (
        <span className={s.guard} data-tone={guard.now ? 'warn' : undefined}>
          <Icon name="shield" size="s" />
          <span>{d[guardKey(guard)](when(guard.at))}</span>
        </span>
      ) : null}
    </section>
  );
}
