import { howStore } from '@/city/lib/art/how';
import { useAssistant } from '@/city/lib/assistant/store';
import { useBeacons } from '@/city/lib/beacon/store';
import { openBots } from '@/city/lib/bots/open';
import { useTowerChart } from '@/city/lib/chart/store';
import { openTower } from '@/city/lib/coin/open';
import { hotTower } from '@/city/lib/city/hot';
import { useCity } from '@/city/lib/city/store';
import { useHudPanels } from '@/city/lib/city/windows';
import type { GuideId } from '@/city/lib/how/guides';
import { useGuides } from '@/city/lib/how/store';
import { launchOpenHere, startDistrict, useLaunch } from '@/city/lib/launch/district';
import { isNamed, type Tower } from '@/city/lib/market/types';
import { openMoney } from '@/city/lib/money/open';
import { useTrade } from '@/city/lib/trade/store';
import { goQuarter } from '../game/play';

/**
 * «Try» on a lesson of «How it works» (CITY-43): the lessons step away and that function's own window opens in the
 * city, exactly as its own door opens it — the tower card, its Buy, Chart and Beacon on the tower the home offers now,
 * the Agents' bots window, the Launch sheet, the top bar's search and Ask Ryntra, Money's Send, your quarter.
 */

/** The functions that open on a tower: they wait for the city to stand. */
export const ON_A_TOWER: ReadonlySet<GuideId> = new Set<GuideId>(['city', 'trade', 'chart', 'spot', 'beacons']);

function clear(): void {
  useGuides.getState().hide();
  howStore.getState().hide();
  useHudPanels.getState().closeMenu();
}

/** The tower to try it on: the one already picked, the one the home offers now, else the first the city names. */
function towerToTry(): Tower | null {
  const city = useCity.getState();
  const named = (tower: Tower | null | undefined) => (tower && isNamed(tower) ? tower : null);
  const picked = city.layout.towers.find((placed) => placed.tower.id === city.selectedId)?.tower;
  return named(picked) ?? named(hotTower(city.layout)?.tower) ?? city.layout.towers.find((placed) => isNamed(placed.tower))?.tower ?? null;
}

/** The search of the top bar, opened as a tap on it opens it: it keeps its own state. */
function openSearch(): void {
  document.querySelector<HTMLButtonElement>('[data-city-search-open][aria-expanded="false"]')?.click();
}

/** Opens the function's window; false when it cannot yet (no tower stands in the city). */
export function tryGuide(id: GuideId): boolean {
  if (ON_A_TOWER.has(id)) {
    const tower = towerToTry();
    if (!tower) return false;
    clear();
    // Fly to it and open its card, as a tap on the tower does; the function's window opens over it.
    openTower(tower.id);
    if (id === 'trade') useTrade.getState().openFor(tower);
    else if (id === 'spot') useTrade.getState().openFor(tower, 'buy', { view: 'spot', mode: 'limit' });
    else if (id === 'chart') useTowerChart.getState().open(tower.id);
    else if (id === 'beacons') useBeacons.getState().open(tower.id);
    return true;
  }
  clear();
  switch (id) {
    case 'agents':
      openBots();
      break;
    case 'launch':
      startDistrict();
      if (launchOpenHere(useLaunch.getState())) useLaunch.getState().openSheet();
      else {
        // The district reads its network first: the sheet opens once it says Launch is open here.
        const stop = useLaunch.subscribe((state) => {
          if (state.status === 'reading') return;
          stop();
          if (launchOpenHere(state)) state.openSheet();
        });
      }
      break;
    case 'search':
      useCity.getState().select(null);
      openSearch();
      break;
    case 'assistant':
      useCity.getState().select(null);
      useAssistant.getState().show(null);
      break;
    case 'quarter':
      goQuarter();
      break;
    case 'money':
      openMoney('send');
      break;
  }
  return true;
}
