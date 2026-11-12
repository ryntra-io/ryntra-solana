'use client';

import { useAgent } from '@/city/lib/agent/store';
import { useCity } from '@/city/lib/city/store';
import { useHudPanels } from '@/city/lib/city/windows';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { usePredict } from '@/city/lib/districts/predict/store';
import { PLAY_OPEN } from '@/city/lib/game/flag';
import { layerNow, useLayer } from '@/city/lib/game/layer';
import { useGameMap } from '@/city/lib/game/map';
import { useHall } from '@/city/lib/launch/hall-store';
import { cityAccount } from '@/city/lib/quarter/account-live';
import { linkKindOf } from '@/city/lib/quarter/objects';
import { quarterStore } from '@/city/lib/quarter/store';
import { vaultStore } from '@/city/lib/vault/store';
import { windowOpenNow } from '../hud/useWindowOpen';

/**
 * What the Play layer does to the rest of the city (CITY-81). Leaving Play shuts the game's own places — the Map, the
 * Hall's boards, the Vault's room, your quarter — and the camera comes home; the money windows (Predict, Harbor,
 * Exchange, Money) stay as they are in both layers. A phone's Back and Escape return from Play to City.
 */

let installed = false;

/** Once per page: the layer's watchers. Idempotent; they live as long as the page. */
export function installPlay(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  useLayer.subscribe((st, before) => {
    if (st.layer === before.layer) return;
    useHudPanels.setState({ menu: false, settings: false });
    if (st.layer === 'city') leaveGame();
  });
  // Your quarter and the Vault's room are places of Play: opened from anywhere else (the wallet's menu, a sign-in that
  // lands at home), the layer follows, so the way out leads back to Play and Back to City.
  quarterStore.subscribe((st, before) => {
    if (st.mode !== 'city' && before.mode === 'city') useLayer.getState().set('play');
    // Out of the quarter, or its card put away: back to the City.
    else if ((st.mode === 'city' && before.mode !== 'city') || (before.asked && !st.asked)) backToCity();
  });
  vaultStore.subscribe((st, before) => {
    if (st.open && !before.open) useLayer.getState().set('play');
    else if (!st.open && before.open) backToCity();
  });
  // The Map's view holds until the city is asked for something else: a tower picked, the logo pressed.
  useCity.subscribe((st, before) => {
    if ((st.selectedId && st.selectedId !== before.selectedId) || st.homeAt !== before.homeAt) useGameMap.getState().clear();
  });
}

/**
 * Without Play's switch (decision 86) the layer is only the place of play the menu opened: out of your quarter or the
 * Vault's room, the city is the City again. With the switch, Play stays until it is switched back.
 */
function backToCity(): void {
  if (PLAY_OPEN || quarterStore.getState().mode !== 'city' || vaultStore.getState().open) return;
  useLayer.getState().set('city');
}

function leaveGame(): void {
  const map = useGameMap.getState();
  map.close();
  map.clear();
  const hall = useHall.getState();
  if (hall.panel) hall.close();
  if (vaultStore.getState().open) vaultStore.getState().leave();
  const quarter = quarterStore.getState();
  if (quarter.mode !== 'city') quarter.leave();
  // Asked for in Play, the quarter's card waits there.
  quarterStore.setState({ asked: false });
}

/**
 * Escape, after the city's own panels had theirs (city/components/hud/Hud.tsx): the Map, then the Hall's boards close —
 * in the City layer too, where a link (`/?open=hall`) and the boards over the towers open the Hall (CITY-236: Escape did
 * nothing there). In Play, a window that closes itself is left to it; with nothing left open, back to City. True when it
 * took the press.
 */
export function playEscape(): boolean {
  const map = useGameMap.getState();
  if (map.open) {
    map.close();
    return true;
  }
  const hall = useHall.getState();
  if (hall.panel) {
    hall.close();
    return true;
  }
  if (layerNow() !== 'play') return false;
  if (windowOpenNow()) return false;
  useLayer.getState().set('city');
  return true;
}

/** One game panel at a time over the city: the money windows give way to the quarter, as the old «Home» did. */
function clearForQuarter(): void {
  useHudPanels.setState({ menu: false, settings: false });
  useGameMap.getState().close();
  useAgent.getState().closePanel();
  useHarbor.getState().hide();
  usePredict.getState().hide();
  useCity.getState().select(null);
}

/**
 * «My quarter»: fly in to it; no quarter yet, its card opens on the wallet and the claim — asked for, so it shows for
 * this visit even with the «Arrivals card» switch off.
 */
export function goQuarter(): void {
  clearForQuarter();
  const quarter = quarterStore.getState();
  if (quarter.status === 'resident') quarter.enter();
  else {
    quarterStore.setState({ later: false, asked: true });
    void cityAccount.getState().begin('claim', 'card');
  }
}

/** The Ring: into your quarter, on the garage where your agent lives (CITY-50). No quarter yet, the claim first. */
export function goRing(): void {
  const quarter = quarterStore.getState();
  const garage = quarter.me?.buildings.find((b) => linkKindOf(b.kind) === 'agent');
  goQuarter();
  if (quarter.status !== 'resident' || !garage) return;
  // The garage's sheet opens once the camera has landed and the quarter takes picks.
  const stop = quarterStore.subscribe((st) => {
    if (st.mode === 'city') return stop();
    if (st.mode !== 'build') return;
    stop();
    st.pick(garage.slot);
  });
}
