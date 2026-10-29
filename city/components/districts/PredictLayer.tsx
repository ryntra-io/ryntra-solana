'use client';

import { useEffect, useMemo } from 'react';
import { useAgent } from '@/city/lib/agent/store';
import { useCity } from '@/city/lib/city/store';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { PREDICT_OPEN, PREDICT_REAL } from '@/city/lib/districts/predict/flag';
import { realBusy, useReal } from '@/city/lib/districts/predict/real-store';
import { usePredict } from '@/city/lib/districts/predict/store';
import { useLaunch } from '@/city/lib/launch/district';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { vaultStore } from '@/city/lib/vault/store';
import { useCityWindow } from '../window/useCityWindow';
import { PredictWindow, windowTitle } from './PredictWindow';
import { PredictGlyph } from './predictGlyphs';
import s from './predict.module.css';

/** The open tab is read again this often while the window is open. */
const LIST_MS = 30_000;
/** The open market's page, a little more often: its price is the one a buy is taken at. */
const PAGE_MS = 20_000;
/** Practice holdings whose markets have closed are asked about this often. */
const SETTLE_MS = 60_000;
/** The real account, while Real is open. */
const ACCOUNT_MS = 30_000;

const renderPredict = () => (
  <div className={s.framed}>
    <PredictWindow />
  </div>
);
const closePredict = () => {
  if (!realBusy()) usePredict.getState().hide();
};

/**
 * Predictions over the city, once the district is open, in the city's one window frame (CITY-65): one window — the markets, a market's page, your positions and
 * money. While it is open the cards and the open page stay recent reads and practice holdings settle. It gives way to
 * the rest of the city at once — Escape, a tower picked, a run, your quarter, another district's panel — unless an
 * order or a withdrawal is on its way, which is always shown to its end.
 */
export function PredictLayer() {
  if (!PREDICT_OPEN) return null;
  return <Layer />;
}

function Layer() {
  const open = usePredict((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const mode = usePredict((st) => st.mode);
  const address = useWallet((st) => st.connection?.address ?? null);

  useEffect(() => {
    if (!open) return;
    const st = usePredict.getState();
    void st.loadList();
    void st.settleDue();
    void st.priceHeld();
    const visible = () => document.visibilityState === 'visible';
    const list = setInterval(() => {
      if (!visible()) return;
      void usePredict.getState().loadList();
      // Your positions are priced off their pages too: each held market read again now and then.
      if (usePredict.getState().mode === 'practice') void usePredict.getState().priceHeld();
    }, LIST_MS);
    const page = setInterval(() => {
      if (visible() && usePredict.getState().page.kind === 'market') void usePredict.getState().loadDetail();
    }, PAGE_MS);
    const settle = setInterval(() => {
      if (visible()) void usePredict.getState().settleDue();
    }, SETTLE_MS);
    const hide = () => {
      if (!realBusy()) usePredict.getState().hide();
    };
    // Escape inside the window: back to the markets, then closed. Never the press that gave the whole screen back (the
    // frame takes that one first and marks it), and never a press meant for another window of the frame.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const box = document.querySelector('[data-window="predict"]');
      if (!box || !box.contains(document.activeElement)) return;
      const page = usePredict.getState().page;
      if (page.kind !== 'markets' && !realBusy()) usePredict.getState().back();
      else hide();
    };
    window.addEventListener('keydown', onKey);
    const offs = [
      useCity.subscribe((st, before) => {
        if (st.selectedId && st.selectedId !== before.selectedId) hide();
      }),
      quarterStore.subscribe((st) => {
        if (st.mode !== 'city') hide();
      }),
      useHarbor.subscribe((st) => {
        if (st.open) hide();
      }),
      useAgent.subscribe((st) => {
        if (st.panel !== 'none') hide();
      }),
      useTrade.subscribe((st) => {
        if (st.open) hide();
      }),
      useLaunch.subscribe((st) => {
        if (st.sheet) hide();
      }),
      vaultStore.subscribe((st) => {
        if (st.open) hide();
      }),
    ];
    return () => {
      clearInterval(list);
      clearInterval(page);
      clearInterval(settle);
      window.removeEventListener('keydown', onKey);
      for (const off of offs) off();
    };
  }, [open]);

  // Real money reads only the connected wallet's account, and only while Real is open.
  useEffect(() => {
    if (!PREDICT_REAL || !open || mode !== 'real') return;
    if (!address) {
      useReal.getState().forget();
      return;
    }
    void useReal.getState().refresh(address);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useReal.getState().refresh(address);
    }, ACCOUNT_MS);
    return () => clearInterval(timer);
  }, [open, mode, address]);

  useEffect(() => {
    // A run takes the whole screen — unless real money is on its way, which is always shown to its end.
    if (running && !realBusy()) usePredict.getState().hide();
  }, [running]);

  // The frame holds the window while real money is on its way: its «Close» waits, as the window's own close did.
  const held = useReal((st) => st.trade.step === 'placing' || st.withdraw.step === 'sending' || st.opening !== null || st.collecting === 'sending');
  const page = usePredict((st) => st.page.kind);
  const title = windowTitle(page, mode);
  const spec = useMemo(
    () => ({ id: 'predict', title, icon: <PredictGlyph />, render: renderPredict, size: { width: 1240, height: 800 }, min: { width: 720, height: 520 }, held, onClose: closePredict }),
    [title, held],
  );
  useCityWindow(open && (!running || held), spec);
  return null;
}
