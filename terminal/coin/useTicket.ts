import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { tradePrefsNow } from '@/city/lib/settings/trade';
import { TRADE_OPEN } from '@/city/lib/trade/gates';
import { SHARES } from '@/city/lib/trade/size';
import { balanceOf, renewAt, useTrade, type CoinRef, type View } from '@/city/lib/trade/store';
import { payAssetFor, type Side } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { quickSums } from './staples';
import {
  NO_GUARD,
  QUICK_KEPT_START,
  QUICK_KEY,
  guardNext,
  pressHeld,
  quickActionAt,
  quickActions,
  readQuick,
  standOf,
  ticketFree,
  writeQuick,
  type CoinStand,
  type Guard,
  type ProtectSet,
  type QuickAction,
  type QuickInput,
  type QuickKept,
  type QuickPay,
  type StandRow,
} from './ticket-rules';

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

/* ── the person's quick sums, take-profit and stop: kept in this browser ─────────────────────────────────────────── */

type Extras = {
  kept: QuickKept;
  ready: boolean;
  /** Take-profit and stop at the buy: off until the person turns them on, and never kept past the page. */
  protectOn: boolean;
  setProtectOn: (on: boolean) => void;
  setSums: (pay: QuickPay, row: readonly string[]) => void;
  setProtect: (set: ProtectSet) => void;
  resetSums: () => void;
};

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function keep(kept: QuickKept): void {
  try {
    store()?.setItem(QUICK_KEY, writeQuick(kept));
  } catch {
    /* A browser that keeps nothing still has the sums for this page. */
  }
}

/** The ticket's own choices of this browser: read once, every change kept at once. */
export const useTicketExtras = create<Extras>((set, get) => ({
  kept: QUICK_KEPT_START,
  ready: false,
  protectOn: false,
  setProtectOn: (protectOn) => set({ protectOn }),
  setSums: (pay, row) => {
    const kept = { ...get().kept, sums: { ...get().kept.sums, [pay]: [...row] } };
    keep(kept);
    set({ kept });
  },
  setProtect: (protect) => {
    const kept = { ...get().kept, protect };
    keep(kept);
    set({ kept });
  },
  resetSums: () => {
    const kept = { ...get().kept, sums: QUICK_KEPT_START.sums };
    keep(kept);
    set({ kept });
  },
}));

/** Reads what this browser kept, once. */
export function hydrateTicketExtras(): void {
  if (useTicketExtras.getState().ready || typeof window === 'undefined') return;
  let text: string | null = null;
  try {
    text = store()?.getItem(QUICK_KEY) ?? null;
  } catch {
    text = null;
  }
  useTicketExtras.setState({ kept: readQuick(text), ready: true });
}

/** What a buy's quick sums are written in for the coin that pays: SOL, dollars, or none (another coin of the wallet). */
export function quickPayOf(payMint: string): QuickPay | null {
  const sums = quickSums(payMint);
  return sums ? (sums.dollars ? 'usd' : 'sol') : null;
}

/** The quick row of the ticket as it stands now: its side, what pays, the person's sums and sale shares. */
export function quickInputNow(): QuickInput | null {
  hydrateTicketExtras();
  const card = useTrade.getState();
  if (!card.tower) return null;
  const pay = payAssetFor(card.tower.mint, card.pay, card.other);
  return {
    side: card.side,
    pay: quickPayOf(pay.mint),
    sums: useTicketExtras.getState().kept.sums,
    shares: card.side === 'sell' ? tradePrefsNow().sells : SHARES,
  };
}

/** One quick deed on the trade card, as the card takes an amount or a share; nothing while a trade is under way. */
export function runQuick(action: QuickAction): boolean {
  const card = useTrade.getState();
  if (!card.open || card.phase !== 'idle' || card.held) return false;
  if (action.kind === 'amount') card.setTyped(action.amount);
  else card.setShare(action.share);
  return true;
}

/**
 * Quick button `slot` (1–4) on the open ticket — what the keys 1–4 call: the same deed as the button, on the same card.
 * Returns the deed done, or null where there was none (no ticket, a trade under way, no such slot).
 */
export function quickNow(slot: number): QuickAction | null {
  const input = quickInputNow();
  const action = input ? quickActionAt(input, slot) : null;
  return action && runQuick(action) ? action : null;
}

export { quickActions };

/* ── what this wallet did in the coin ────────────────────────────────────────────────────────────────────────────── */

/** After a trade of this card lands, the record is read again — once the chain has it. */
const STAND_AFTER_TRADE_MS = 8_000;

type WalletRecord = Readonly<{
  gap: boolean;
  skipped: number;
  solUsd: number | null;
  tokens: readonly (StandRow & Readonly<{ mint: string; priceUsd: number | null }>)[];
  trades: readonly Readonly<{ mint: string; quote: string | null; paidBy: string | null }>[];
}>;

/** The parts of `/api/wallet-watch/wallet` the strip reads; anything else is no record. */
function recordOf(body: unknown): WalletRecord | null {
  const view = body && typeof body === 'object' ? (body as { view?: unknown }).view : null;
  if (!view || typeof view !== 'object') return null;
  const v = view as Record<string, unknown>;
  if (!Array.isArray(v.tokens) || !Array.isArray(v.trades)) return null;
  return {
    gap: v.gap === true,
    skipped: typeof v.skipped === 'number' ? v.skipped : 0,
    solUsd: typeof v.solUsd === 'number' && v.solUsd > 0 ? v.solUsd : null,
    tokens: v.tokens as WalletRecord['tokens'],
    trades: v.trades as WalletRecord['trades'],
  };
}

/**
 * Bought · sold · holding · result of the connected wallet in this coin (`standOf`), from the wallet's own trades on
 * the chain — any venue — as «Стеження за гаманцями» reads them (`GET /api/wallet-watch/wallet?q=`, public data of a
 * public address). Read when the wallet or the coin changes, and again after a trade of this card lands. Null — the
 * strip is not drawn. Reads only: nothing here signs or sends.
 */
export function useCoinStand(mint: string, usd: number | null, on = true): CoinStand | null {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const holdings = useWallet((st) => st.holdings);
  const [record, setRecord] = useState<Readonly<{ key: string; record: WalletRecord | null }> | null>(null);
  const key = on && owner ? `${owner}|${mint}` : null;

  useEffect(() => {
    if (!key || !owner) return;
    let live = true;
    const read = async () => {
      try {
        const answer = await fetch(`/api/wallet-watch/wallet?${new URLSearchParams({ q: owner })}`, { cache: 'no-store', headers: { accept: 'application/json' } });
        const body = answer.ok ? await answer.json() : null;
        if (live) setRecord((was) => (body === null && was?.key === key ? was : { key, record: recordOf(body) }));
      } catch {
        /* A read that failed keeps what is on screen. */
      }
    };
    void read();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = useTrade.subscribe((card, before) => {
      if (card.phase === before.phase || card.phase !== 'done' || card.tower?.mint !== mint) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void read(), STAND_AFTER_TRADE_MS);
    });
    return () => {
      live = false;
      off();
      if (timer) clearTimeout(timer);
    };
  }, [key, owner, mint]);

  const kept = record && record.key === key ? record.record : null;
  if (!kept) return null;
  const row = kept.tokens.find((token) => token.mint === mint) ?? null;
  const priceUsd = usd ?? row?.priceUsd ?? null;
  const balance = balanceOf(holdings, mint);
  const held = balance && /^\d+$/.test(balance.spendableRaw) ? Number(balance.spendableRaw) / 10 ** balance.decimals : null;
  return standOf({
    row,
    whole: !kept.gap && kept.skipped === 0,
    unpriced: kept.trades.some((trade) => trade.mint === mint && (trade.quote === null || trade.paidBy !== null)),
    held,
    priceSol: priceUsd !== null && kept.solUsd !== null ? priceUsd / kept.solUsd : null,
  });
}
