'use client';

import { useMemo, useState } from 'react';
import { compactUsd, leverage, price, signedPercent } from '@/city/lib/exchange/format';
import { marketFacts, marketMatchesText, marketRows, STATE_WORDS } from '@/city/lib/exchange/markets';
import { useExchange } from '@/city/lib/exchange/store';
import { useWords } from '@/city/lib/i18n/dict';
import { symbolKey } from '@/lib/phoenix/market-data';
import { EX } from './words';
import s from './exchange.module.css';

/** Phoenix's markets to pick from: what trades now first, then the day's volume; each with Phoenix's own figures. */
export function MarketPicker() {
  const markets = useExchange((st) => st.markets);
  const symbol = useExchange((st) => st.symbol);
  const choose = useExchange((st) => st.choose);
  const setPicking = useExchange((st) => st.setPicking);
  const [text, setText] = useState('');
  const w = useWords(EX);
  const rows = useMemo(() => marketRows(markets.value?.markets ?? []).filter((market) => marketMatchesText(market, text)), [markets.value, text]);
  return (
    <div className={s.block}>
      <div className={s.labelRow}>
        <div className={s.label}>{w.markets}</div>
        <button className={s.linkButton} onClick={() => setPicking(false)}>
          {w.back}
        </button>
      </div>
      <label className={`${s.field} ${s.search}`}>
        <input className={s.input} placeholder={w.searchMarkets} aria-label={w.searchMarkets} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      </label>
      {markets.status === 'failed' && !markets.value ? (
        <div className={s.empty}>{w.phoenixSilent}</div>
      ) : !markets.value ? (
        <span className={s.shimmer} />
      ) : rows.length === 0 ? (
        <div className={s.empty}>{w.noMarket}</div>
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
                      {w.closed}
                    </span>
                  )}
                </span>
                <span className={s.itemFigure}>{price(facts.mark)}</span>
                <span className={s.itemLine}>
                  <b className={facts.changePercent === null ? undefined : facts.changePercent >= 0 ? s.up : s.down}>{signedPercent(facts.changePercent)}</b> {w.h24} · {w.vol} <b>{compactUsd(market.dayVolumeUsd)}</b>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
