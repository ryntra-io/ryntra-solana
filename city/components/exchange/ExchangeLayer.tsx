'use client';

import { useEffect, useMemo, useRef } from 'react';
import { accountKind, hasBook } from '@/city/lib/exchange/account';
import { BOOK_MS } from '@/city/lib/exchange/depth';
import { EXCHANGE_SHOWN } from '@/city/lib/exchange/flag';
import { figuresKeyOf } from '@/city/lib/exchange/ticket';
import { BUSY, LOCKED, setExchangeEnv, ticketView, useExchange } from '@/city/lib/exchange/store';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useQuarter } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import type { Params } from '@/city/lib/window/detach';
import { cityInView } from '@/city/lib/window/out';
import { useWindows } from '@/city/lib/window/store';
import { useCityWindow } from '../window/useCityWindow';
import { ExchangeWindow } from './ExchangeWindow';
import { ExchangeGlyph } from './glyphs';
import { EX } from './words';

/** While the window is open: the markets (the mark and the funding move), the account, the history, how often. */
// The mark every 4 s: the route keeps a read 5 s at the edge, so the price on screen is never older than that.
const MARKETS_MS = 4_000;
const FUNDING_MS = 60_000;
const ACCOUNT_MS = 15_000;
const HISTORY_MS = 30_000;
/** The ticket asks the engine once the typing settles, and again while the question stands. */
const SETTLE_MS = 350;
const FIGURES_MS = 10_000;

/** The page is seen: its tab, or the window out in Picture-in-Picture while the tab is behind another (CITY-75). */
const visible = () => cityInView();

/** Every `ms` while `on` and the page is in view, the read runs again. */
function useEvery(on: boolean, ms: number, read: () => void) {
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => {
      if (visible()) read();
    }, ms);
    return () => clearInterval(timer);
  }, [on, ms, read]);
}

/**
 * The Exchange in the city: closed for people until the switch says `open` (or `exit`, closing out). Open, it follows
 * the connected wallet, keeps Phoenix's markets, the funding, the account and the history recent while the window is
 * open, asks the engine for the ticket's figures once the typing settles, and stands in the city's one window frame
 * (CITY-65). A run or building your quarter owns the screen, unless a signature holds the window — and holds it in the
 * frame too.
 */
export function ExchangeLayer() {
  if (!EXCHANGE_SHOWN) return null;
  return <OpenExchange />;
}

/** The markets again; and the funding with them while its last read failed and nothing of it is on screen. */
const loadMarkets = () => {
  const exchange = useExchange.getState();
  void exchange.loadMarkets(true);
  if (exchange.funding.status === 'failed' && !exchange.funding.value) void exchange.loadFunding();
};
const loadFunding = () => void useExchange.getState().loadFunding();
const loadAccount = () => void useExchange.getState().loadAccount();
/** The account again, and the gates while either has not answered yet: a gate is never left «reading» for good. */
const loadAccountAndGates = () => {
  const exchange = useExchange.getState();
  void exchange.loadAccount();
  if (exchange.orderStates === null || exchange.collateralStates === null) void exchange.loadGates();
};
const loadHistory = () => void useExchange.getState().loadHistory();
const loadBook = () => void useExchange.getState().loadBook();
const renderExchange = () => <ExchangeWindow />;
const hideExchange = () => useExchange.getState().hide();

const readFigures = () => {
  if (!BUSY.has(useExchange.getState().phase)) void useExchange.getState().readFigures();
};

function OpenExchange() {
  const w = useWords(EX);
  const open = useExchange((st) => st.open);
  const phase = useExchange((st) => st.phase);
  const tab = useExchange((st) => st.tab);
  const symbol = useExchange((st) => st.symbol);
  const owner = useExchange((st) => st.owner);
  const markets = useExchange((st) => st.markets);
  const draft = useExchange((st) => st.draft);
  const figures = useExchange((st) => st.figures);
  const maxFor = useExchange((st) => st.maxFor);
  const orderStates = useExchange((st) => st.orderStates);
  const address = useWallet((st) => st.connection?.address ?? null);
  const running = useRun((st) => st.phase !== 'off');
  const building = useQuarter((st) => st.mode !== 'city');
  // Out on a page of its own (CITY-75) the window reads there: the city's copy waits, so nothing is read twice.
  const away = useWindows((st) => st.out.exchange?.via === 'tab');

  useEffect(() => startWallets(), []);
  useEffect(() => setExchangeEnv({ refreshHoldings: (delays) => useWallet.getState().refreshHoldings(delays) }), []);

  // The reads follow the wallet connected now: another wallet's account is never this one's.
  useEffect(() => useExchange.getState().follow(address), [address]);
  useEffect(() => {
    if (!open || !owner || away) return;
    loadAccount();
    void useExchange.getState().loadGates();
  }, [open, owner, away]);

  // Reads run while the window is on screen: a run or building your quarter hides it, and they wait.
  const shown = open && (!(running || building) || LOCKED.has(phase));
  const reading = shown && !away;
  // Back from its own page: the markets are read at once, not at the next beat.
  const wasAway = useRef(false);
  useEffect(() => {
    if (away) wasAway.current = true;
    else if (wasAway.current) {
      wasAway.current = false;
      loadMarkets();
    }
  }, [away]);
  useEvery(reading, MARKETS_MS, loadMarkets);
  useEffect(() => {
    if (reading && symbol) loadFunding();
  }, [reading, symbol]);
  useEvery(reading && Boolean(symbol), FUNDING_MS, loadFunding);
  useEvery(reading && Boolean(owner), ACCOUNT_MS, loadAccountAndGates);

  // The history is read while it is on screen: on a phone its tab, on a desk the left column's.
  const historyOn = reading && Boolean(owner) && tab === 'history';
  const historyKind = useExchange((st) => st.historyKind);
  useEffect(() => {
    if (historyOn) loadHistory();
  }, [historyOn, historyKind]);
  useEvery(historyOn, HISTORY_MS, loadHistory);

  // The book is read while its tab is on screen, every couple of seconds: the market's depth moves by the second.
  const booked = useExchange((st) => hasBook(accountKind(Boolean(address), st.account)));
  const bookOn = reading && Boolean(symbol) && booked && tab === 'book';
  useEffect(() => {
    if (bookOn) loadBook();
  }, [bookOn, symbol]);
  useEvery(bookOn, BOOK_MS, loadBook);

  // The ticket's question; the engine is asked once it settles, and again while it stands.
  const key = useMemo(() => {
    const view = ticketView({ symbol, markets, owner, draft, figures, maxFor, orderStates });
    return view.query ? figuresKeyOf(view.query) : null;
  }, [symbol, markets, owner, draft, figures, maxFor, orderStates]);
  useEffect(() => {
    // A question the engine already answered — the most's own read answers a share's — is not asked twice.
    if (!reading || !key || useExchange.getState().figures?.key === key) return;
    const timer = setTimeout(readFigures, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [reading, key]);
  useEvery(reading && Boolean(key), FIGURES_MS, readFigures);

  // Home from the logo closes the window; on a phone a tower picked from the city does too — the sheet and the tower
  // card never stand together there. A signature holds it either way.
  useEffect(
    () =>
      useCity.subscribe((city, before) => {
        const exchange = useExchange.getState();
        // Out on another screen (CITY-75) the window is not over the city: home leaves it there.
        if (!exchange.open || LOCKED.has(exchange.phase) || useWindows.getState().out.exchange) return;
        if (city.homeAt !== before.homeAt) return exchange.hide();
        if (city.selectedId && city.selectedId !== before.selectedId && !useWindows.getState().desk) exchange.hide();
      }),
    [],
  );
  // Opening the window lets the tower card go on a phone, where both would stand at the bottom.
  useEffect(() => {
    if (open && !useWindows.getState().desk) useCity.getState().select(null);
  }, [open]);

  // The frame holds the window while a signature is out: its «Close» waits, as the window's own close does. Its title
  // follows the language: a switch sends the frame the new word.
  const held = LOCKED.has(phase);
  // Out on another screen (CITY-75) its own page opens on the same market. Its title follows the language (CITY-79).
  const title = w.exchange;
  const spec = useMemo(
    () => ({
      id: 'exchange',
      title,
      icon: <ExchangeGlyph />,
      render: renderExchange,
      size: { width: 860, height: 640 },
      min: { width: 720, height: 480 },
      held,
      onClose: hideExchange,
      detach: (symbol ? { symbol } : {}) as Params,
    }),
    [held, symbol, title],
  );
  useCityWindow(shown, spec);

  // Escape inside the window closes it — never with a signature out, and never with the press that gave the whole
  // screen back (the frame takes that one first and marks it). Heard before the HUD's, the chart's and Money's, which
  // read the mark, so one press closes one window.
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || LOCKED.has(useExchange.getState().phase)) return;
      const box = document.querySelector('[data-window="exchange"]');
      if (!box || !box.contains(document.activeElement)) return;
      event.preventDefault();
      hideExchange();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown]);

  return null;
}
