import { useCallback, useEffect, useRef } from 'react';
import { TRADE_OPEN } from '@/city/lib/trade/gates';
import { renewAt, useTrade, type CoinRef, type View } from '@/city/lib/trade/store';
import type { Side } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { NO_GUARD, guardNext, pressHeld, ticketFree, type Guard } from './ticket-rules';

/* The trade card's own beats, as the city's trade layer keeps them (`city/components/trade/TradeLayer.tsx`). */
/** The price is read again this often while the ticket is open and nothing else is happening. */
const QUOTE_REFRESH_MS = 20_000;
/** A wallet is connected and a price is on screen: the exact order follows after this pause. */
const AUTO_ORDER_MS = 450;

/**
 * The ticket's tie to the trade card's logic (`city/lib/trade/store.ts`), which every trade of Ryntra runs on: the
 * quote, the route, the fee, the exact order, the wallet's signature and the reading of the outcome are that store's,
 * as they are. A screen names its coin; this opens the card on it, keeps the price recent, has the exact order built
 * while the person reads, renews its bytes before they age, and reads back a signature left open before a reload.
 * Leaving the screen lets the card go — never under a signature.
 *
 * A trade under way, or its result, keeps the card on its own coin: the ticket shows that trade until the person lets
 * it go, then takes the screen's coin.
 *
 * Returns the ticket's press: the card's one step, held back for a moment when the order's figures came right after a
 * price that failed — so a tap aimed at «Try again» never opens the wallet.
 *
 * `side`: the side the card opens on for a newly named coin — buying unless the screen says otherwise (the Swap screen
 * keeps a sale a sale when the coin sold changes). The person's own switch of sides on the same coin is never undone.
 */
export function useTicket(coin: CoinRef | null, view: View = 'spot', side: Side = 'buy'): () => Promise<'connect' | 'ok'> {
  const latest = useRef(coin);
  latest.current = coin;
  const sideNow = useRef(side);
  sideNow.current = side;
  const mint = coin?.id ?? null;

  useEffect(() => {
    if (!mint) return;
    const take = () => {
      const card = useTrade.getState();
      const wanted = latest.current;
      if (!wanted || (card.open && card.tower?.mint === mint && card.view === view)) return;
      if (ticketFree(card)) card.openFor(wanted, sideNow.current, { view });
    };
    take();
    // Another coin named: the card follows it once it rests (`ticketFree`) — a trade's result stays until it is let go.
    return useTrade.subscribe(take);
  }, [mint, view]);

  // The screen goes: the card goes with it — never under a signature (`close` refuses then).
  useEffect(() => () => useTrade.getState().close(), []);

  const open = useTrade((st) => st.open);
  const phase = useTrade((st) => st.phase);
  const quoteKey = useTrade((st) => (st.quote.status === 'ready' ? st.quote.key : null));
  const review = useTrade((st) => st.review);
  const autoKey = useTrade((st) => st.autoKey);
  const address = useWallet((st) => st.connection?.address ?? null);

  // A signature this tab left unresolved is read back once its wallet is here again. Reading only.
  useEffect(() => {
    if (address) void useTrade.getState().recoverQuietly();
  }, [address]);

  // A price on screen stays a recent one; an exact order on screen replaces it.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      const card = useTrade.getState();
      if (card.phase !== 'idle' || card.review || document.visibilityState !== 'visible' || !navigator.onLine) return;
      void card.refreshQuote();
    }, QUOTE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);

  // With a wallet connected, the exact order is built while the person reads the price, once per choice.
  useEffect(() => {
    if (!TRADE_OPEN || !open || !address || !quoteKey || phase !== 'idle' || review?.key === quoteKey || autoKey === quoteKey) return;
    const timer = setTimeout(() => void useTrade.getState().prepare(true), AUTO_ORDER_MS);
    return () => clearTimeout(timer);
  }, [open, address, quoteKey, review, autoKey, phase]);

  // The order's bytes live about thirty seconds: rebuilt shortly before they run out.
  useEffect(() => {
    const at = renewAt(review);
    if (!open || at === null || phase !== 'idle') return;
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') void useTrade.getState().renew();
    }, Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [open, review, phase]);

  // What the screen showed of a failed price, for the press below.
  const guard = useRef<Guard>(NO_GUARD);
  useEffect(() => {
    const look = () => {
      const card = useTrade.getState();
      guard.current = guardNext(guard.current, { quoteFailed: card.quote.status === 'error', exact: card.review !== null }, Date.now());
    };
    look();
    return useTrade.subscribe(look);
  }, []);

  return useCallback(async () => {
    if (pressHeld(guard.current, Date.now())) return 'ok';
    return useTrade.getState().press();
  }, []);
}
