'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { SHARES } from '@/city/lib/trade/size';
import { useTrade } from '@/city/lib/trade/store';
import { payAssetFor } from '@/city/lib/trade/tiles';
import { coinDoors } from '@/terminal/coin/doors';
import { quickSums } from '@/terminal/coin/staples';
import { ticketFree } from '@/terminal/coin/ticket-rules';
import { closePanel, useWhere } from './frame';
import { KEY_LIST, coinAt, keyHit, sumFor, typingAt } from './key-map';
import { useDismiss } from './useDismiss';
import { useMarket } from './useMarket';
import { useNarrow } from './useNarrow';
import { KEYS } from './words';
import s from './shell.module.css';

/** The agent's line in front: the header's, or the home page's own field where it stands in for it. */
function focusLine(): void {
  const header = document.querySelector<HTMLInputElement>('[data-city-command] input');
  const hero = document.querySelector<HTMLInputElement>("[data-terminal='hero'] input");
  const field = header?.offsetParent ? header : (hero ?? header);
  closePanel();
  field?.focus();
}

/**
 * The terminal's keys on a desk (`./keys.ts`): «/» puts the keyboard in the agent's line to find a coin; on a coin's
 * screen B and S turn its ticket to a buy or a sale and 1–4 fill the ticket's quick sums; Esc closes; «?» shows the quiet
 * list of keys. A key only opens or fills the ticket — the person reads it and confirms there. A phone has none.
 */
export function Keys() {
  const w = useWords(KEYS);
  const narrow = useNarrow();
  const { pathname } = useWhere();
  const towers = useMarket().towers;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ open, pathname, towers, narrow });
  live.current = { open, pathname, towers, narrow };

  useDismiss(open, box, () => setOpen(false));
  useEffect(() => setOpen(false), [pathname, narrow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const now = live.current;
      const mint = coinAt(now.pathname);
      const hit = keyHit(event, { typing: typingAt(event.target), narrow: now.narrow, coin: mint !== null, listOpen: now.open });
      if (!hit) return;
      if (hit.action === 'close') {
        if (now.open) setOpen(false);
        closePanel();
        return;
      }
      event.preventDefault();
      if (hit.action === 'help') return setOpen((was) => !was);
      setOpen(false);
      if (hit.action === 'search') return focusLine();
      if (!mint) return;
      const card = useTrade.getState();
      const onCoin = card.open && card.tower?.mint === mint;
      if (hit.action === 'buy' || hit.action === 'sell') {
        if (onCoin && ticketFree(card)) {
          if (card.side !== hit.action) card.setSide(hit.action);
          return;
        }
        // The ticket is not on this coin yet: it opens on the side asked, as a sentence would open it.
        const tower = now.towers.find((each) => each.id === mint);
        if (tower) coinDoors(mint).openTrade({ mint, symbol: tower.symbol, name: tower.name, icon: tower.icon, tower: true }, hit.action, 'spot', 'market');
        return;
      }
      if (hit.action !== 'sum' || !onCoin || !card.tower || !ticketFree(card)) return;
      const pay = payAssetFor(card.tower.mint, card.pay, card.other);
      const fill = sumFor(hit.index, card.side, quickSums(pay.mint)?.sums ?? null, SHARES);
      if (fill && 'typed' in fill) card.setTyped(fill.typed);
      else if (fill) card.setShare(fill.share);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open || narrow) return null;
  return (
    <div ref={box} className={`${s.pop} ${s.keys}`} role="dialog" aria-label={w.title}>
      <div className={s.popHead}>{w.title}</div>
      <dl className={s.keyList}>
        {KEY_LIST.map((row) => (
          <Fragment key={row.word}>
            <dt>
              {row.keys.map((key, at) => (
                <Fragment key={key}>
                  {at > 0 ? <span className={s.keyDash}>–</span> : null}
                  <kbd className={s.keyCap}>{key}</kbd>
                </Fragment>
              ))}
            </dt>
            <dd>{w[row.word]}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
