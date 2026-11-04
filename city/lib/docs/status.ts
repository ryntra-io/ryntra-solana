import type { DocId } from './model.ts';

/**
 * What is open in this build, as the documentation reads it (CITY-180). Nothing here is written by hand: the doors are the
 * deployment's own switches (`doors.ts`, the same the city's menu and the roadmap read). So opening a door in a release opens its
 * section on its own, and what is shut stands as «Soon», never described as working.
 */
export type DocsDoors = Readonly<Record<'launch' | 'trade' | 'spot' | 'stops' | 'earn' | 'earnWindow' | 'guard' | 'money' | 'bots', boolean>>;

export type DocsStatus = Readonly<{
  trade: boolean;
  /** Limit orders and stops on the trade card. */
  limits: boolean;
  /** A stop watched around the clock under the wallet; shut, a stop is watched while Ryntra is open on the device. */
  stopsAlways: boolean;
  /** One sentence to the agent: a regular purchase, a limit or a stop. */
  oneSentence: boolean;
  /** Scouts and bots, the Agents place of the menu. */
  bots: boolean;
  /** The agent with a budget: one signature, then it acts alone. */
  budget: boolean;
  launch: boolean;
  pools: boolean;
  /** The Earn window with the SOL Saver. */
  saver: boolean;
  /** «Sell higher, buy lower» in a pool. */
  poolLimits: boolean;
  guard: boolean;
  /** Send, the move between networks and a deposit from another network. */
  moneyPaths: boolean;
}>;

export function docsStatus(doors: DocsDoors, extra: Readonly<{ oneSentence: boolean; budget: boolean; poolLimits: boolean }>): DocsStatus {
  return {
    trade: doors.trade,
    limits: doors.trade && doors.spot,
    stopsAlways: doors.trade && doors.spot && doors.stops,
    oneSentence: extra.oneSentence,
    bots: doors.bots,
    budget: extra.budget,
    launch: doors.launch,
    pools: doors.earn,
    saver: doors.earnWindow,
    poolLimits: doors.earnWindow && extra.poolLimits,
    guard: doors.guard,
    moneyPaths: doors.money,
  };
}

/** A section's own «Soon»: its main thing is shut here. The rest always stand open: they describe what is. */
export function sectionSoon(id: DocId, status: DocsStatus): boolean {
  switch (id) {
    case 'trade':
      return !status.trade;
    case 'orders':
      return !status.limits && !status.oneSentence;
    case 'launch':
      return !status.launch;
    case 'earn':
      return !status.pools && !status.saver;
    case 'guard':
      return !status.guard;
    default:
      return false;
  }
}
