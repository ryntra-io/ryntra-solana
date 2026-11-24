'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { RECURRING_STOCKS } from '@/terminal/bots/words';
import { OneLine } from '@/terminal/earn/bits';
import { stockLineOf } from '@/terminal/stocks/position-line';
import { useStockPoolFacts } from '@/terminal/stocks/useStockPoolFacts';
import { STOCK_FACTS, STOCK_POSITION } from '@/terminal/stocks/words';
import { Icon } from '@/terminal/ui';
import { PRIVATE_STOCK } from './words';
import b from '@/terminal/bots/bots.module.css';

/**
 * The issuer's rights and the exchange's hours, in the very line «Recurring buys» shows before its signature
 * (`terminal/bots/StockBuys.tsx`, `StockTerms`): while the exchange is not open, its one line; then the issuer's line with
 * «i» — whose token it is and what it can do, what the exchange's hours mean, where the issuer does not offer it, and its
 * terms. The words of the line are «Recurring buys»' own (`RECURRING_STOCKS`); behind «i» only the bot's sentence is
 * left out — a one-off buy has no bot that waits. Ryntra blocks no country: the issuer's terms are shown, never enforced.
 * `facts` — the stock's facts a stand already holds; a ticket leaves it out and the line reads them itself.
 */
export function PrivateIssuerLine({ mint, facts: given }: { mint: string; facts?: PoolFacts | null }) {
  const r = useWords(RECURRING_STOCKS);
  const w = useWords(PRIVATE_STOCK);
  const p = useWords(STOCK_POSITION);
  const d = useWords(STOCK_FACTS);
  const lang = useLang();
  const facts = useStockPoolFacts(mint, given);
  const view = stockLineOf(facts, lang);
  const closed = facts?.isStock === true && facts.session !== 'open';
  return (
    <div className={b.stockTerms} data-private-stock-terms="">
      {closed ? (
        <span className={b.warnCap} data-private-stock-closed="">
          {r.closedLine}
        </span>
      ) : null}
      <OneLine line={r.issuerLine} label={r.issuerLabel} tone="warn">
        {facts?.issuer ? <p>{w.issuerWhy(facts.issuer.label)}</p> : null}
        <p>{p.hoursWhy}</p>
        {view.excluded ? <p>{p.notOffered(view.excluded)}</p> : null}
        {view.limited ? <p>{p.limited(view.limited)}</p> : null}
        {view.termsUrl ? (
          <a className={b.termsLink} href={view.termsUrl} target="_blank" rel="noopener noreferrer">
            {d.read}
            <Icon name="arrow" size="s" />
          </a>
        ) : null}
      </OneLine>
    </div>
  );
}
