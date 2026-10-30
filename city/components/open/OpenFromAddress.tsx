'use client';

import { useEffect } from 'react';
import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { useAgent } from '@/city/lib/agent/store';
import { useAssistant } from '@/city/lib/assistant/store';
import { hotTower } from '@/city/lib/city/hot';
import { useCity } from '@/city/lib/city/store';
import { useHudPanels } from '@/city/lib/city/windows';
import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { PREDICT_OPEN } from '@/city/lib/districts/predict/flag';
import { usePredict } from '@/city/lib/districts/predict/store';
import { EXCHANGE_OPEN } from '@/city/lib/exchange/flag';
import { useExchange } from '@/city/lib/exchange/store';
import { launchOpenHere, startDistrict, useLaunch } from '@/city/lib/launch/district';
import { hallShown, useHall } from '@/city/lib/launch/hall-store';
import { openMoney } from '@/city/lib/money/open';
import { readOpenAsk, withoutAsk, type OpenAsk } from '@/city/lib/open/address';
import { TRADE_OPEN } from '@/city/lib/trade/gates';
import { useMine } from '@/city/lib/trade/mine-store';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { openPredictions } from '../districts/PredictDockItem';

/** How long a window that opens with the district's first read (Launch, the Hall, a remembered wallet) is waited for. */
const WAIT_MS = 12_000;

type Store<T> = { getState: () => T; subscribe: (listener: (state: T) => void) => () => void };

/** Resolves with true once the store says so, false when it has not by the deadline. */
function until<T>(store: Store<T>, ready: (state: T) => boolean, settled: (state: T) => boolean = ready, ms = WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (settled(store.getState())) return resolve(ready(store.getState()));
    const timer = setTimeout(() => (stop(), resolve(ready(store.getState()))), ms);
    const stop = store.subscribe((state) => {
      if (!settled(state)) return;
      clearTimeout(timer);
      stop();
      resolve(ready(state));
    });
  });
}

/** Opens what the ask names, as its own door in the dock would; a window closed in this deployment leaves the home as it is. */
async function openAsk(ask: OpenAsk): Promise<void> {
  switch (ask.window) {
    case 'trade': {
      if (!TRADE_OPEN) return;
      // The trade window opens on a coin: the one the home offers now.
      if (!(await until(useCity, (st) => st.layout.towers.length > 0))) return;
      const hot = hotTower(useCity.getState().layout);
      if (hot) useTrade.getState().openFor(hot.tower);
      return;
    }
    case 'exchange':
      if (EXCHANGE_OPEN) useExchange.getState().show();
      return;
    case 'oracle':
      if (!PREDICT_OPEN) return;
      openPredictions();
      if (ask.market) usePredict.getState().openMarket(ask.market);
      else if (ask.positions) usePredict.getState().go({ kind: 'positions' });
      return;
    case 'money':
      openMoney(ask.tab);
      return;
    case 'mine': {
      // «My towers» are a wallet's: with none connected, the wallet's portfolio in Money asks for one.
      const connected = await until(useWallet, (st) => st.connection !== null, (st) => st.connection !== null, 2_500);
      if (connected) useMine.setState({ open: true, tab: 'coins' });
      else openMoney('portfolio');
      return;
    }
    case 'launch':
      startDistrict();
      if (await until(useLaunch, launchOpenHere, (st) => st.status !== 'reading')) useLaunch.getState().openSheet();
      return;
    case 'hall':
      if (await until(useHall, hallShown, (st) => st.status !== 'reading')) useHall.getState().show();
      return;
    case 'harbor':
      if (HARBOR_OPEN) useHarbor.getState().show();
      return;
    case 'agents':
      if (AGENTS_OPEN && useAgent.getState().panel === 'none') useAgent.getState().toggle();
      return;
    case 'assistant':
      useAssistant.getState().show(null);
      return;
    case 'settings':
      useHudPanels.getState().openSettings();
      return;
  }
}

/**
 * An old address of the cabinet opens its place in the city (CITY-13): `/?open=<window>` names the window, and once
 * the home is up it opens, then the ask leaves the address so a reload is the plain city. Mounted once, in the city.
 */
export function OpenFromAddress() {
  useEffect(() => {
    const ask = readOpenAsk(location.search);
    if (!ask) return;
    history.replaceState(history.state, '', withoutAsk(location.pathname, location.search, location.hash));
    void openAsk(ask);
  }, []);
  return null;
}

/**
 * A link of the city to one of its own windows (`/?open=…`), opened in place when the city is the page: no reload, the
 * window simply opens. True when it did; any other link is the browser's to follow.
 */
export function openInCity(href: string): boolean {
  if (typeof window === 'undefined' || !href.startsWith('/?')) return false;
  const ask = readOpenAsk(href.slice(1));
  if (!ask) return false;
  void openAsk(ask);
  return true;
}
