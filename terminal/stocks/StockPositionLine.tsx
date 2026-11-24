'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { OneLine } from '@/terminal/earn/bits';
import { Icon } from '@/terminal/ui';
import { stockLineOf, stockWhyOf } from './position-line';
import { useStockPoolFacts } from './useStockPoolFacts';
import { STOCK_FACTS, STOCK_POSITION } from './words';
import s from './stocks.module.css';

/**
 * The one line before the signature of a position in a pool of a stock (the DLMM Pro ticket draws it in place
 * of the volatile pair's line): the issuer can pause its token — one short line. Behind «i»: whose token it
 * is, what its pause does and that it can take the token back, outside the exchange's regular session that the open
 * may jump, the exchange's hours, where the issuer does not offer it, who looks after the position, and the issuer's terms. Nothing
 * here promises an income. `issuer` — the engine's own name for the issuer, said before the facts are read; `facts` —
 * facts a page has read already (the stand), taken as they are.
 */
export function StockPositionLine({ mint, issuer, facts: given }: { mint: string; issuer: string; facts?: PoolFacts | null }) {
  const facts = useStockPoolFacts(mint, given);
  const lang = useLang();
  const w = useWords(STOCK_POSITION);
  const d = useWords(STOCK_FACTS);
  const view = stockLineOf(facts, lang);
  return (
    <div className={s.line} data-stock-line="" data-off-hours={view.offHours ? '' : undefined}>
      <OneLine line={w.line} label={w.label} tone="warn">
        {stockWhyOf(w, view, facts?.issuer?.label ?? issuer).map((why) => (
          <p key={why}>{why}</p>
        ))}
        {view.termsUrl ? (
          <a className={s.termsLink} href={view.termsUrl} target="_blank" rel="noopener noreferrer">
            {d.read}
            <Icon name="arrow" size="s" />
          </a>
        ) : null}
      </OneLine>
    </div>
  );
}
