'use client';

import { useStore } from 'zustand';
import { garageView, useGarage } from '@/city/lib/agent/garage/store';
import { useAgent } from '@/city/lib/agent/store';
import { useAssistant } from '@/city/lib/assistant/store';
import { howStore } from '@/city/lib/art/how';
import { useBeacons } from '@/city/lib/beacon/store';
import { useTowerChart } from '@/city/lib/chart/store';
import { useHudPanels, windowOpen, type WindowSources } from '@/city/lib/city/windows';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { useGuides } from '@/city/lib/how/store';
import { usePredict } from '@/city/lib/districts/predict/store';
import { useExchange } from '@/city/lib/exchange/store';
import { useLaunch } from '@/city/lib/launch/district';
import { useBerth } from '@/city/lib/launch/berth-store';
import { useHall } from '@/city/lib/launch/hall-store';
import { useMoments } from '@/city/lib/moments/stage';
import { freeStore, useFree } from '@/city/lib/quarter/kit/free/store';
import { useMoney } from '@/city/lib/money/open';
import { usePartners } from '@/city/lib/partners/store';
import { useScouts } from '@/city/lib/scouts/store';
import { usePages } from '@/city/lib/pages/store';
import { useMine } from '@/city/lib/trade/mine-store';
import { useTrade } from '@/city/lib/trade/store';
import { vaultStore } from '@/city/lib/vault/store';
import { useWindows } from '@/city/lib/window/store';

/** Every window's store as it stands now. A window out on another screen (CITY-75) is not over the city. */
export function windowSources(): WindowSources {
  const out = useWindows.getState().out;
  return {
    predict: usePredict.getState(),
    trade: useTrade.getState(),
    money: useMoney.getState(),
    chart: out.chart ? { mint: null } : useTowerChart.getState(),
    exchange: out.exchange ? { open: false } : useExchange.getState(),
    harbor: useHarbor.getState(),
    mine: useMine.getState(),
    scouts: useScouts.getState(),
    partners: usePartners.getState(),
    vault: vaultStore.getState(),
    hall: useHall.getState(),
    berth: useBerth.getState(),
    agent: useAgent.getState(),
    garage: garageView(useGarage.getState()),
    beacon: useBeacons.getState(),
    assistant: useAssistant.getState(),
    how: howStore.getState(),
    guides: useGuides.getState(),
    moments: useMoments.getState(),
    launch: useLaunch.getState(),
    build: freeStore.getState(),
    pages: usePages.getState(),
    hud: useHudPanels.getState(),
  };
}

/** «A window is open», asked once, outside React (the moments' line in CityApp). */
export function windowOpenNow(): boolean {
  return windowOpen(windowSources());
}

/** «A window is open», for a component: true while any window or panel of the city is open. */
export function useWindowOpen(): boolean {
  const predict = usePredict((st) => st.open);
  const trade = useTrade((st) => st.open);
  const money = useMoney((st) => st.open);
  const chart = useTowerChart((st) => st.mint);
  const exchange = useExchange((st) => st.open);
  const harbor = useHarbor((st) => st.open);
  const mine = useMine((st) => st.open);
  const scouts = useScouts((st) => st.open);
  const partners = usePartners((st) => st.open);
  const landing = usePartners((st) => st.landing);
  const vault = useStore(vaultStore, (st) => st.open);
  const hall = useHall((st) => st.panel);
  const berth = useBerth((st) => st.open);
  const agent = useAgent((st) => st.panel);
  const garage = useGarage((st) => garageView(st).open);
  const beacon = useBeacons((st) => st.openFor);
  const assistant = useAssistant((st) => st.open);
  const how = useStore(howStore, (st) => st.open);
  const guides = useGuides((st) => st.open);
  const moments = useMoments((st) => st.sheet);
  const launch = useLaunch((st) => st.sheet);
  const entry = useLaunch((st) => st.entry);
  const build = useFree((st) => st.on);
  const pages = usePages((st) => st.open);
  const menu = useHudPanels((st) => st.menu);
  const settings = useHudPanels((st) => st.settings);
  const chartOut = useWindows((st) => Boolean(st.out.chart));
  const exchangeOut = useWindows((st) => Boolean(st.out.exchange));
  return windowOpen({
    predict: { open: predict },
    trade: { open: trade },
    money: { open: money },
    chart: { mint: chartOut ? null : chart },
    exchange: { open: exchange && !exchangeOut },
    harbor: { open: harbor },
    mine: { open: mine },
    scouts: { open: scouts },
    partners: { open: partners, landing },
    vault: { open: vault },
    hall: { panel: hall },
    berth: { open: berth },
    agent: { panel: agent },
    garage: { open: garage },
    beacon: { openFor: beacon },
    assistant: { open: assistant },
    how: { open: how },
    guides: { open: guides },
    moments: { sheet: moments },
    launch: { sheet: launch, entry },
    build: { on: build },
    pages: { open: pages },
    hud: { menu, settings },
  });
}
