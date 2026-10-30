'use client';

import { useEffect } from 'react';
import { useAgent } from '@/city/lib/agent/store';
import { useAssistant } from '@/city/lib/assistant/store';
import { howStore } from '@/city/lib/art/how';
import { closePanel, useBackPanels } from '@/city/lib/back/panels';
import { browserBackStack } from '@/city/lib/back/stack';
import { useBeacons } from '@/city/lib/beacon/store';
import { useTowerChart } from '@/city/lib/chart/store';
import { useCity } from '@/city/lib/city/store';
import { openWindows, useHudPanels, type WindowName } from '@/city/lib/city/windows';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { usePredict } from '@/city/lib/districts/predict/store';
import { useExchange } from '@/city/lib/exchange/store';
import { useFeedPanel } from '@/city/lib/feed/panel';
import { useLayer } from '@/city/lib/game/layer';
import { useGameMap } from '@/city/lib/game/map';
import { useLaunch } from '@/city/lib/launch/district';
import { useHall } from '@/city/lib/launch/hall-store';
import { useMoments } from '@/city/lib/moments/stage';
import { useMoney } from '@/city/lib/money/open';
import { awayStore } from '@/city/lib/quarter/away-store';
import { freeStore } from '@/city/lib/quarter/kit/free/store';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { useScouts } from '@/city/lib/scouts/store';
import { useMine } from '@/city/lib/trade/mine-store';
import { useTrade } from '@/city/lib/trade/store';
import { vaultStore } from '@/city/lib/vault/store';
import { useWindows } from '@/city/lib/window/store';
import { closable } from './Hud';
import { windowSources } from './useWindowOpen';

/** Each window closed as its own close button closes it: one that is under a signature refuses, as there. */
const CLOSE: Readonly<Record<WindowName, () => void>> = {
  predict: () => usePredict.getState().hide(),
  trade: () => useTrade.getState().close(),
  money: () => useMoney.getState().close(),
  chart: () => useTowerChart.getState().close(),
  exchange: () => useExchange.getState().hide(),
  harbor: () => useHarbor.getState().hide(),
  mine: () => useMine.getState().close(),
  scouts: () => useScouts.getState().close(),
  vault: () => vaultStore.getState().leave(),
  hall: () => useHall.getState().close(),
  agent: () => useAgent.getState().closePanel(),
  beacon: () => useBeacons.getState().close(),
  assistant: () => useAssistant.getState().hide(),
  how: () => howStore.getState().hide(),
  moments: () => useMoments.setState({ sheet: null }),
  launch: () => {
    const sheet = useLaunch.getState();
    if (sheet.sheet && closable(sheet.phase)) sheet.closeSheet();
  },
  build: () => freeStore.getState().close(),
  menu: () => useHudPanels.getState().closeMenu(),
  settings: () => useHudPanels.getState().closeSettings(),
};

type Layer = Readonly<{ id: string; open: () => boolean; close: () => void }>;

/**
 * The layers «Back» closes, besides the windows: the Play layer under everything (Back returns from it to City once
 * nothing over it is open — CITY-150), the tower's card, your quarter, the run, the «While you were away» reel. Bottom
 * first: opened together (a coin's link opens its tower and its trade card), the one listed later stands on top.
 */
const EXTRA_BELOW: readonly Layer[] = [
  { id: 'play', open: () => useLayer.getState().layer === 'play', close: () => useLayer.getState().set('city') },
  { id: 'tower', open: () => useCity.getState().selectedId !== null, close: () => useCity.getState().select(null) },
  { id: 'quarter', open: () => quarterStore.getState().mode !== 'city', close: () => quarterStore.getState().leave() },
  { id: 'run', open: () => useRun.getState().phase !== 'off', close: () => useRun.getState().exit() },
  { id: 'away', open: () => awayStore.getState().status === 'playing', close: () => awayStore.getState().finish() },
];
/**
 * Over the windows: a page inside one (a market of Predict: Back returns to the list, not out of Predict), a window on
 * the whole screen, the Map of Play and the events under the bell (CITY-150).
 */
const EXTRA_ABOVE: readonly Layer[] = [
  {
    id: 'predict-page',
    open: () => usePredict.getState().open && usePredict.getState().page.kind !== 'markets',
    close: () => usePredict.getState().back(),
  },
  { id: 'full', open: () => useWindows.getState().layout.full !== null, close: () => useWindows.getState().exitFull() },
  { id: 'map', open: () => useGameMap.getState().open, close: () => useGameMap.getState().close() },
  { id: 'feed', open: () => useFeedPanel.getState().open, close: () => useFeedPanel.getState().close() },
];

/** The small panels with an «open» of their own (the search, the wallet's menu, the Deck's tray) stand on top. */
const PANEL = 'panel:';

function read(): string[] {
  return [
    ...EXTRA_BELOW.filter((l) => l.open()).map((l) => l.id),
    ...openWindows(windowSources()),
    ...EXTRA_ABOVE.filter((l) => l.open()).map((l) => l.id),
    ...useBackPanels.getState().open.map((id) => PANEL + id),
  ];
}

function close(id: string) {
  // A window its frame holds (real money on its way, a signature in the wallet) is not closed by «Back», as its own
  // «Close» waits: some stores' own close does not ask (Predict's `hide`), the frame does.
  if (useWindows.getState().specs[id]?.held) return;
  if (id in CLOSE) return CLOSE[id as WindowName]();
  if (id.startsWith(PANEL)) return void closePanel(id.slice(PANEL.length));
  [...EXTRA_BELOW, ...EXTRA_ABOVE].find((l) => l.id === id)?.close();
}

const STORES: readonly { subscribe: (listener: () => void) => () => void }[] = [
  useLayer, useCity, quarterStore, useRun, awayStore, useWindows, useGameMap, useFeedPanel, useBackPanels,
  usePredict, useTrade, useMoney, useTowerChart, useExchange, useHarbor, useMine, useScouts, vaultStore, useHall, useAgent,
  useBeacons, useAssistant, howStore, useMoments, useLaunch, freeStore, useHudPanels,
];

/**
 * «Back» closes the city's top layer (CITY-6e): the system «Back» of the Ryntra app on Android and a browser's «Back»
 * alike. On the city's own view «Back» leaves, as before (`city/lib/back/stack.ts`).
 */
export function useBackLayers(): void {
  useEffect(() => {
    const stack = browserBackStack({ read, close });
    const stops = STORES.map((store) => store.subscribe(stack.changed));
    return () => {
      for (const stop of stops) stop();
      stack.dispose();
    };
  }, []);
}
