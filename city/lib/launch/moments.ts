import type { SceneEvent } from '../../../lib/mission-control/types.ts';
import type { EventDraft } from '../city/events.ts';
import { usd } from './format.ts';
import type { LaunchTower } from './towers.ts';

/**
 * What of a launch's life the whole city sees as a moment: a new tower in the docks, its climb up the curve, the move
 * into the skyline at its pool, and the checks of days 7, 30 and 90 it passed. Each moment comes from one change between
 * two reads of the engine (`eventsBetween` of Mission Control's live scene), so it names nothing the chain did not do. A
 * check with no trade by anyone but the creator and Ryntra is said calmly on the tower's card, not played as drama.
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
      return { kind: 'pump', towerId: tower.token, symbol, title: 'Into the skyline', value: tower.graduationUsd ? `${usd(tower.graduationUsd)} · POOL OPEN` : 'POOL OPEN' };
    case 'check':
      return { kind: 'pump', towerId: tower.token, symbol, title: `Day ${event.day} check`, value: 'STILL TRADING' };
    case 'star':
      return { kind: 'pump', towerId: tower.token, symbol, title: 'Day 90 landmark', value: 'SURVIVED 90 DAYS' };
    default:
      return null;
  }
}
