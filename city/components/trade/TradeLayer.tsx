'use client';

import { useEffect } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useRun } from '@/city/lib/run/store';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import { useSpot } from '@/city/lib/trade/spot-store';
import { stopsKey } from '@/city/lib/trade/stops';
import { BUSY, renewAt, useTrade } from '@/city/lib/trade/store';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { MinePanel } from './MinePanel';
import { TradeSheet } from './TradeSheet';
import s from './trade.module.css';

/** The price is read again this often while the card is open and nothing else is happening. */
const QUOTE_REFRESH_MS = 20_000;
/** A wallet is connected and a price is on screen: the exact order follows after this pause. */
const AUTO_ORDER_MS = 450;
/** The stops of this device are asked about this often while the page is in front. */
const STOP_WATCH_MS = 20_000;

/**
 * Trading in the city: the wallet comes back by itself if this site was granted it, a signature left open before a
 * reload is read back, and the trade card stands over the tower card while it is open. A run owns the whole screen,
 * unless a trade is mid-way. «Mine» — the wallet's own towers and orders — lives here too, and so does the watch over
 * the stops kept on this device: a reached stop opens its sale on the card, for the wallet to sign.
 */
export function TradeLayer() {
  const open = useTrade((st) => st.open);
  const phase = useTrade((st) => st.phase);
  const quoteKey = useTrade((st) => (st.quote.status === 'ready' ? st.quote.key : null));
  const review = useTrade((st) => st.review);
  const autoKey = useTrade((st) => st.autoKey);
  const address = useWallet((st) => st.connection?.address ?? null);
  const running = useRun((st) => st.phase !== 'off');

  useEffect(() => startWallets(), []);

  // A signature this tab left unresolved is read back once its wallet is here again. Reading only.
  useEffect(() => {
    if (address) void useTrade.getState().recoverQuietly();
  }, [address]);

  // The stops of this wallet on this device: read when it connects, again when another tab changes them, and asked
  // about while the page is in front. A reached stop opens its sale when nothing else is on the card.
  useEffect(() => {
    if (!SPOT_OPEN) return;
    useSpot.getState().loadStops();
    if (!address) return;
    const onStorage = (event: StorageEvent) => event.key === stopsKey(address) && useSpot.getState().loadStops();
    const watch = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const reached = await useSpot.getState().watchStops();
      const first = reached[0];
      const trade = useTrade.getState();
      // A card in use is never taken over: the reached stop waits in «My orders», the «Mine» pill marked.
      if (!first || trade.open || useRun.getState().phase !== 'off') return;
      const city = useCity.getState();
      city.select(city.layout.towers.some((placed) => placed.tower.id === first.base.mint) ? first.base.mint : null);
      useSpot.getState().openSale(first);
    };
    window.addEventListener('storage', onStorage);
    const timer = setInterval(() => void watch(), STOP_WATCH_MS);
    void watch();
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
    };
  }, [address]);

  // Another tower picked, or the tower card closed: the trade card goes too, unless a trade is under way.
  useEffect(
    () =>
      useCity.subscribe((city, before) => {
        if (city.selectedId === before.selectedId) return;
        const trade = useTrade.getState();
        if (trade.open && trade.tower && city.selectedId !== trade.tower.mint && !BUSY.has(trade.phase) && !trade.held) trade.close();
      }),
    [],
  );

  // Escape closes the card, never under a signature.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useTrade.getState().close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A price on screen stays a recent one; an exact order on screen replaces it.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      const trade = useTrade.getState();
      if (trade.phase !== 'idle' || trade.review || document.visibilityState !== 'visible' || !navigator.onLine) return;
      void trade.refreshQuote();
    }, QUOTE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);

  // With a wallet connected, the exact order is built while the person reads the price, once per choice.
  useEffect(() => {
    if (!open || !address || !quoteKey || phase !== 'idle' || review?.key === quoteKey || autoKey === quoteKey) return;
    const timer = setTimeout(() => void useTrade.getState().prepare(true), AUTO_ORDER_MS);
    return () => clearTimeout(timer);
  }, [open, address, quoteKey, review, autoKey, phase]);

  // The order's bytes live about thirty seconds: rebuilt shortly before they run out, at most twice.
  useEffect(() => {
    const at = renewAt(review);
    if (!open || at === null || phase !== 'idle') return;
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') void useTrade.getState().renew();
    }, Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [open, review, phase]);

  return (
    <>
      <MinePanel />
      {open && !(running && !BUSY.has(phase)) && (
        <div className={s.layer}>
          <TradeSheet />
        </div>
      )}
    </>
  );
}
