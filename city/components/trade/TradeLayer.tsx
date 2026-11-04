'use client';

import { useEffect, useMemo } from 'react';
import { useBeacons } from '@/city/lib/beacon/store';
import { useTowerChart } from '@/city/lib/chart/store';
import { useCity } from '@/city/lib/city/store';
import { useExchange } from '@/city/lib/exchange/store';
import { launchTowerIn, useLaunch } from '@/city/lib/launch/district';
import { useRun } from '@/city/lib/run/store';
import { SPOT_OPEN, TRADE_OPEN } from '@/city/lib/trade/gates';
import { useSpot } from '@/city/lib/trade/spot-store';
import { stopsKey } from '@/city/lib/trade/stops';
import { BUSY, renewAt, useTrade } from '@/city/lib/trade/store';
import { escapeTarget, windowTower } from '@/city/lib/trade/tower-window';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { useWords } from '@/city/lib/i18n/dict';
import { SpotGlyph, SwapGlyph } from '../deck/glyphs';
import { useCityWindow } from '../window/useCityWindow';
import { MinePanel } from './MinePanel';
import { TradeSheet } from './TradeSheet';
import { TRADE } from './words';

const renderTrade = () => <TradeSheet />;
const closeTrade = () => useTrade.getState().close();

/** The price is read again this often while the card is open and nothing else is happening. */
const QUOTE_REFRESH_MS = 20_000;
/** A wallet is connected and a price is on screen: the exact order follows after this pause. */
const AUTO_ORDER_MS = 450;
/** The stops of this device are asked about this often while the page is in front. */
const STOP_WATCH_MS = 20_000;

/**
 * Trading in the city: the wallet comes back by itself if this site was granted it, a signature left open before a
 * reload is read back, and a tap on a tower opens its one window — the trade card with the coin on top (CITY-78); the
 * window closed lets the tower go. The tower's chart and its beacon's editor stand in the window's place while they are
 * open, and so does a run, unless a trade is mid-way. «Mine» — the wallet's own towers and orders — lives here too,
 * and so does the watch over the stops kept on this device: a reached stop opens its sale on the card, for the wallet
 * to sign.
 */
export function TradeLayer() {
  const open = useTrade((st) => st.open);
  const phase = useTrade((st) => st.phase);
  const quoteKey = useTrade((st) => (st.quote.status === 'ready' ? st.quote.key : null));
  const review = useTrade((st) => st.review);
  const autoKey = useTrade((st) => st.autoKey);
  const address = useWallet((st) => st.connection?.address ?? null);
  const running = useRun((st) => st.phase !== 'off');
  const held = useTrade((st) => st.held);
  // The chart or the beacon's editor of this coin stands in the window's place; a signature out keeps the window.
  const charting = useTowerChart((st) => st.mint !== null);
  const beacon = useBeacons((st) => st.openFor !== null);
  const aside = charting || beacon;
  const selectedId = useCity((st) => st.selectedId);
  const towers = useCity((st) => st.layout.towers);
  const launchTower = useLaunch((st) => launchTowerIn(st, selectedId) !== null);
  const launchSheet = useLaunch((st) => st.sheet);
  // The id alone: a fresh read of the market brings new tower objects, never a second opening.
  const picked = (launchSheet ? null : windowTower(towers, selectedId, launchTower))?.tower.id ?? null;

  useEffect(() => startWallets(), []);

  // A tap on a named tower opens its window straight away, on buying; the same tower already open keeps its card as it
  // is. A card under a signature for another coin is never taken over (`openFor` refuses it).
  useEffect(() => {
    if (!picked) return;
    const trade = useTrade.getState();
    const tower = useCity.getState().layout.towers.find((placed) => placed.tower.id === picked)?.tower;
    if (!tower || (trade.open && trade.tower?.mint === picked)) return;
    // A launch's tower trades on its own curve or pool through the Launch engine (CITY-138), never through Jupiter.
    trade.openFor(tower, 'buy', { launch: launchTowerIn(useLaunch.getState(), picked) !== null });
  }, [picked]);

  // The window closed, any way it closes, lets its tower go: no card of the tower stays behind it.
  useEffect(
    () =>
      useTrade.subscribe((trade, before) => {
        if (trade.open || !before.open || !before.tower) return;
        const city = useCity.getState();
        if (city.selectedId === before.tower.mint) city.select(null);
      }),
    [],
  );

  // The Exchange opened from the window («Trade futures») takes its place.
  useEffect(
    () =>
      useExchange.subscribe((exchange, before) => {
        if (exchange.open && !before.open) useTrade.getState().close();
      }),
    [],
  );

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
      // A card in use is never taken over: the reached stop waits in «My orders», the «Mine» pill marked. The stop's own
      // coin open — a note's link opens the city on it (CITY-149) — is where its sale belongs.
      if (!first || (trade.open && trade.tower?.mint !== first.base.mint) || useRun.getState().phase !== 'off') return;
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

  // The tower let go, or a pool without a name picked: the window goes too, unless a trade is under way. Another named
  // tower or a launch's tower picked brings its own window (above).
  useEffect(
    () =>
      useCity.subscribe((city, before) => {
        if (city.selectedId === before.selectedId) return;
        const trade = useTrade.getState();
        if (!trade.open || !trade.tower || city.selectedId === trade.tower.mint || BUSY.has(trade.phase) || trade.held) return;
        const next = city.selectedId ? city.layout.towers.find((placed) => placed.tower.id === city.selectedId) : null;
        if (!next || !windowTower([next], next.tower.id, launchTowerIn(useLaunch.getState(), next.tower.id) !== null)) trade.close();
      }),
    [],
  );

  // Escape closes the card, never under a signature; the chart or the beacon's editor in its place closes first, one
  // panel per press. The chart's own layer leaves Escape to an open card, so the card closes the chart standing in its
  // place; the beacon's editor hears the key first and closes itself.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const trade = useTrade.getState();
      const target = escapeTarget({
        prevented: event.defaultPrevented,
        busy: BUSY.has(trade.phase) || trade.held,
        chart: useTowerChart.getState().mint !== null,
        beacon: useBeacons.getState().openFor !== null,
      });
      if (target === 'chart') {
        event.preventDefault();
        useTowerChart.getState().close();
      } else if (target === 'window') trade.close();
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
    if (!TRADE_OPEN || !open || !address || !quoteKey || phase !== 'idle' || review?.key === quoteKey || autoKey === quoteKey) return;
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

  // The card stands in the city's one window frame (CITY-65), as the Exchange does: Swap a narrow window, Spot a wide one
  // with the chart beside the ticket. A trade mid-way or a signature out holds the frame's «Close».
  const w = useWords(TRADE);
  const view = useTrade((st) => (st.view === 'swap' && !st.launch ? 'swap' : 'spot'));
  const shown = open && !((running || aside) && !BUSY.has(phase) && !held);
  const hold = BUSY.has(phase) || held;
  const swapSpec = useMemo(
    () => ({ id: 'swap', title: w.swapTitle, icon: <SwapGlyph />, render: renderTrade, size: { width: 440, height: 620 }, min: { width: 360, height: 460 }, held: hold, onClose: closeTrade }),
    [w.swapTitle, hold],
  );
  const spotSpec = useMemo(
    () => ({ id: 'spot', title: w.spotTitle, icon: <SpotGlyph />, render: renderTrade, size: { width: 980, height: 640 }, min: { width: 380, height: 480 }, held: hold, onClose: closeTrade }),
    [w.spotTitle, hold],
  );
  useCityWindow(shown && view === 'swap', swapSpec);
  useCityWindow(shown && view === 'spot', spotSpec);

  return <MinePanel />;
}
