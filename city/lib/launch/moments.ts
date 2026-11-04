import type { SceneEvent } from '../../../lib/mission-control/types.ts';
import type { EventDraft } from '../city/events.ts';
import { usd } from './format.ts';
import { silhouetteOf } from './silhouette.ts';
import type { LaunchTower } from './towers.ts';

/**
 * What of a launch's life the whole city sees as a moment: a new tower in the docks, its climb up the curve, its
 * graduation to its pool — the move into the skyline when it passed the city's rule (L7, `silhouette.ts`) — and the
 * checks of days 7, 30 and 90 it passed. Each moment comes from one change between two reads of the engine
 * (`eventsBetween` of Mission Control's live scene), so it names nothing the chain did not do. A check with no trade by
 * anyone but the creator and Ryntra is said calmly on the tower's card, not played as drama.
 */
export function cityMoment(event: SceneEvent, tower: LaunchTower | undefined): EventDraft | null {
  if (event.quiet || !tower || !('id' in event) || event.id !== tower.token) return null;
  const symbol = tower.symbol;
  switch (event.type) {
    case 'ignite':
      return { kind: 'launch', towerId: tower.token, symbol, title: 'New tower', value: 'LAUNCHED ON RYNTRA' };
    case 'booster':
      return { kind: 'pump', towerId: tower.token, symbol, title: 'Climbing', value: `${[25, 50, 75][event.n - 1]}% TO THE SKYLINE` };
    case 'orbit':
      /* A graduation below the city's rule, or one whose facts are not read yet, keeps its tower in the Docks. */
      return silhouetteOf(tower).stand === 'skyline' ? skylineMoment(tower) : { kind: 'pump', towerId: tower.token, symbol, title: 'Graduated', value: poolOpen(tower) };
    case 'check':
      return { kind: 'pump', towerId: tower.token, symbol, title: `Day ${event.day} check`, value: 'STILL TRADING' };
    case 'star':
      return { kind: 'pump', towerId: tower.token, symbol, title: 'Day 90 landmark', value: 'SURVIVED 90 DAYS' };
    default:
      return null;
  }
}

const poolOpen = (tower: LaunchTower) => (tower.graduationUsd ? `${usd(tower.graduationUsd)} · POOL OPEN` : 'POOL OPEN');

/** The move into the skyline: a graduated tower whose graduation passed the city's rule takes its place there. */
export function skylineMoment(tower: LaunchTower): EventDraft {
  return { kind: 'pump', towerId: tower.token, symbol: tower.symbol, title: 'Into the skyline', value: poolOpen(tower) };
}
