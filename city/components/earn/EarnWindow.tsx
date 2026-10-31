'use client';

import { useEffect, useMemo } from 'react';
import { EARN_TABS } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import { useEarnData } from '@/city/lib/earn/store';
import { earnWords } from '@/city/lib/earn/words';
import { useLang } from '@/city/lib/i18n/lang';
import { useMoneyStore } from '@/city/lib/money/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { LST_BY_MINT, SOL_MINT } from '@/city/lib/earn/lst';
import { Line, SolFigure, TabGlyph } from './bits';
import { Mine } from './Mine';
import { Piers } from './Piers';
import { Product } from './Product';
import { Saver } from './Saver';
import { Shelf } from './Shelf';
import { useMine } from './useMine';
import s from './earn.module.css';

/** The wallet's coins asked about as stocks at most: the rest are SOL, LSTs and dollars. */
const DOLLARS = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

/**
 * The Earn window's contents: «Earned» and «Vs holding» side by side at the same size, then Shelf · Piers · Mine. The
 * frame (CITY-65) brings the head, the moving and the whole screen on a computer and the bottom sheet on a phone;
 * while a signature is out it holds the window on that signature.
 */
export default function EarnWindow() {
  const lang = useLang();
  const words = useMemo(() => earnWords(lang), [lang]);
  const tab = useEarn((st) => st.tab);
  const product = useEarn((st) => st.product);
  const busy = useEarn((st) => st.busy);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const wallet = useMoneyStore((st) => st.wallet);
  const mine = useMine(owner);

  // The window's reads: the feeds for everybody, the wallet's own for its owner.
  useEffect(() => {
    const data = useEarnData.getState();
    void data.loadFeed();
    void data.loadPiers();
    void data.loadLend();
  }, []);
  useEffect(() => {
    useEarnData.getState().follow(owner);
    useMoneyStore.getState().follow(owner);
  }, [owner]);
  // The coins that may be stocks are asked about once the wallet is read.
  const candidates = useMemo(() => {
    if (!wallet || wallet.owner !== owner) return null;
    return wallet.assets
      .filter((a) => a.mint && a.mint !== SOL_MINT && !LST_BY_MINT.has(a.mint) && !DOLLARS.has(a.mint))
      .sort((a, b) => (b.usdPrice ?? 0) * Number(b.amountRaw) / 10 ** b.decimals - (a.usdPrice ?? 0) * Number(a.amountRaw) / 10 ** a.decimals)
      .slice(0, 24)
      .map((a) => a.mint as string);
  }, [wallet, owner]);
  const candidateKey = candidates?.join(',') ?? null;
  useEffect(() => {
    if (owner && candidates) void useEarnData.getState().loadStocks(owner, candidates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, candidateKey]);

  const head = mine.head;
  const nothing = head.unmeasured === 0 ? '0' : '—';

  return (
    <div className={s.framed} aria-label={words.title}>
      {owner && mine.ready && !mine.empty && !(tab === 'shelf' && product) ? (
        <Line
          label={words.details}
          line={
            <span className={s.headline}>
              <span className={s.headFigure}>
                <span className={s.kicker}>{words.earned} · SOL</span>
                <SolFigure lamports={head.earned} empty={nothing} unit={false} />
              </span>
              <span className={s.headFigure}>
                <span className={s.kicker}>{words.vsHold} · SOL</span>
                <SolFigure lamports={head.vsHold} empty={nothing} unit={false} />
              </span>
            </span>
          }
        >
          <p className={s.fine}>{words.mine.vsHoldFine}</p>
          {head.unmeasured > 0 ? <p className={s.fine}>{words.mine.unmeasured}: {head.unmeasured}</p> : null}
        </Line>
      ) : null}
      <nav className={s.tabs} role="tablist" aria-label={words.title}>
        {EARN_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`${s.tab} ${tab === id ? s.tabOn : ''}`}
            onClick={() => useEarn.getState().setTab(id)}
            disabled={busy && tab !== id}
          >
            <TabGlyph tab={id} />
            <span>{words.tabs[id]}</span>
          </button>
        ))}
      </nav>
      <div className={s.body} key={`${tab}:${product ?? ''}`}>
        {tab === 'shelf' ? (
          product === 'saver' ? (
            <Saver words={words} />
          ) : product ? (
            <Product id={product} words={words} />
          ) : (
            <Shelf words={words} />
          )
        ) : tab === 'piers' ? (
          <Piers words={words} />
        ) : (
          <Mine words={words} owner={owner} mine={mine} />
        )}
      </div>
    </div>
  );
}
