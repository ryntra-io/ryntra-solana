'use client';

import { useMemo, useState } from 'react';
import { compactUsd, leverage, price, signedPercent } from '@/city/lib/exchange/format';
import { marketFacts, marketMatchesText, marketRows, STATE_WORDS } from '@/city/lib/exchange/markets';
import { useExchange } from '@/city/lib/exchange/store';
import { symbolKey } from '@/lib/phoenix/market-data';
import s from './exchange.module.css';

/** Phoenix's markets to pick from: what trades now first, then the day's volume; each with Phoenix's own figures. */
export function MarketPicker() {
  const markets = useExchange((st) => st.markets);
  const symbol = useExchange((st) => st.symbol);
  const choose = useExchange((st) => st.choose);
  const setPicking = useExchange((st) => st.setPicking);
  const [text, setText] = useState('');
  const rows = useMemo(() => marketRows(markets.value?.markets ?? []).filter((market) => marketMatchesText(market, text)), [markets.value, text]);
  return (
    <div className={s.block}>
      <div className={s.labelRow}>
        <div className={s.label}>Markets</div>
        <button className={s.linkButton} onClick={() => setPicking(false)}>
          Back
        </button>
      </div>
      <label className={`${s.field} ${s.search}`}>
        <input className={s.input} placeholder="Search markets" aria-label="Search markets" value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      </label>
      {markets.status === 'failed' && !markets.value ? (
        <div className={s.empty}>Phoenix isn’t answering</div>
      ) : !markets.value ? (
        <span className={s.shimmer} />
      ) : rows.length === 0 ? (
        <div className={s.empty}>No market by that name.</div>
      ) : (
        <div className={s.list}>
          {rows.map((market) => {
            const facts = marketFacts(market, null);
            const on = symbol !== null && symbolKey(symbol) === symbolKey(market.symbol);
            return (
              <button key={market.symbol} className={`${s.item} ${on ? s.itemOn : ''}`} onClick={() => choose(market.symbol)} aria-current={on || undefined}>
                <span className={`${s.display} ${s.itemName}`}>
                  <span>{market.symbol}</span>
                  <span className={s.tag}>{leverage(market.maxLeverage)}</span>
                  {!facts.tradable && (
                    <span className={s.tag} title={STATE_WORDS[facts.state]}>
                      Closed
                    </span>
                  )}
                </span>
                <span className={s.itemFigure}>{price(facts.mark)}</span>
                <span className={s.itemLine}>
                  <b className={facts.changePercent === null ? undefined : facts.changePercent >= 0 ? s.up : s.down}>{signedPercent(facts.changePercent)}</b> 24H · Vol <b>{compactUsd(market.dayVolumeUsd)}</b>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
