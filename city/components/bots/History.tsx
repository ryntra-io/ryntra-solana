'use client';

import { useMemo } from 'react';
import { receiptsCsv, receiptsOf } from '@/city/lib/bots/receipts';
import { amount, price, usd, when } from '@/city/lib/bots/format';
import { useBotsWindow } from '@/city/lib/bots/open';
import { Empty } from './Hangar';
import { DownloadGlyph } from './glyphs';
import { useBotRows, useWords } from './hooks';
import s from './bots.module.css';

/** «Історія»: a receipt for every fill, newest first, and the same as a CSV file. */
export function History() {
  const rows = useBotRows();
  const receipts = useMemo(() => receiptsOf(rows), [rows]);
  const { w, lang } = useWords();
  // CITY-237: an empty «History» was a picture and a line — no way on. The same one action as «My bots» and «Strategies».
  if (!receipts.length) return <Empty title={w.noReceipts} action={w.startOne} onAction={() => useBotsWindow.getState().setTab('launch')} />;
  const download = () => {
    const url = URL.createObjectURL(new Blob([receiptsCsv(receipts)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ryntra-bots-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className={s.history}>
      <div className={s.historyHead}>
        <span>
          {w.fills}
          <b>{receipts.length}</b>
        </span>
        <button type="button" className={s.control} onClick={download}>
          <DownloadGlyph />
          {w.csv}
        </button>
      </div>
      <ul className={s.receipts}>
        {receipts.slice(0, 300).map((r) => (
          <li key={r.id} className={s.receipt} data-side={r.side}>
            <i className={r.side === 'buy' ? s.dotBuy : s.dotSell} />
            <span className={s.receiptMain}>
              <b>
                {w.side[r.side]} {amount(r.qty, lang)} <span translate="no">{r.pair.split('/')[0]}</span>
              </b>
              <span>
                {w.kind[r.kind]} · {when(r.t, lang)}
              </span>
            </span>
            <span className={s.receiptRight}>
              <b>{usd(r.usd, lang)}</b>
              <span>{price(r.price, lang)}</span>
            </span>
            <i className={s.paperTag}>{w.practice}</i>
          </li>
        ))}
      </ul>
    </div>
  );
}
