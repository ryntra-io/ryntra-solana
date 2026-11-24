import { create } from 'zustand';
import { AUTOPILOT_NET } from '../autopilot/flag.ts';
import { useAutopilot } from '../autopilot/store.ts';
import { MANDATE_NET } from '../bots/mandate.ts';
import { openBots } from '../bots/open.ts';
import { EARN_OPEN } from '../earn/flag.ts';
import { openEarn } from '../earn/open.ts';
import { launchOpenHere, useLaunch } from '../launch/district.ts';
import { PILOT_OPEN, usePilot } from '../pilot/store.ts';
import { openCommand } from '../command/store.ts';
import { terminalOpen } from '../../../terminal/shell/flag.ts';
import { PILOT_PAGE, pilotHireWay } from './pilot-way.ts';
import type { CrewGates, Role } from './read.ts';

/**
 * «Hire»: each agent's own card, opened where it already lives — the Trader's budget on top of «Bots», the
 * Autopilot's plan card, the pool keeper on Earn's piers, the Launcher's prepared launch. A hire only opens a card: the
 * person reads it there and signs once in their own wallet; nothing here builds, signs or sends anything.
 */

/** The pool keeper's switch (`city/lib/earn/care.ts`), read here without the care window's signing half. */
const CARE_OPEN = ['devnet', 'mainnet'].includes(process.env.NEXT_PUBLIC_RYNTRA_AGENT_CARE?.trim().toLowerCase() ?? '');

/** The agents open on this deployment, by the switches their cards already read. */
export function crewGatesNow(): CrewGates {
  return {
    trader: AUTOPILOT_NET !== null && MANDATE_NET !== null,
    pilot: PILOT_OPEN,
    keeper: EARN_OPEN && CARE_OPEN,
    launcher: AUTOPILOT_NET !== null && launchOpenHere(useLaunch.getState()),
  };
}

/**
 * The Autopilot's starter plan — its parts, never its sum: the sum in it only marks where the person's own goes (the
 * terminal's card asks her for it, decision 108). Nothing is planned or signed with this sum.
 */
export const PILOT_STARTER = { en: 'Work with my 0.2 SOL: some into savings, some trade, some into pools', uk: 'Працюй з моїми 0,2 SOL: частину в скарбничку, частину торгуй, частину в пули' } as const;

type CrewState = {
  /** The agent the person was sent to: its tile glows a moment in «Bots». */
  focus: Role | null;
  at: number;
  point: (role: Role | null) => void;
};

export const useCrew = create<CrewState>((set) => ({
  focus: null,
  at: 0,
  point: (role) => set({ focus: role, at: Date.now() }),
}));

/** The Trader's card is the budget on top of «Bots → Start»: the window opens there with the Trader in view. */
function openTrader(): void {
  useCrew.getState().point('trader');
  openBots('launch');
}

/** Opens the agent's own card — or, for `null` or an agent shut on this deployment, the crew in «Bots». */
export function hire(role: Role | null): void {
  const gates = crewGatesNow();
  if (!role || !gates[role]) {
    useCrew.getState().point(role);
    return openBots('launch');
  }
  if (role === 'trader') return openTrader();
  if (role === 'keeper') {
    useCrew.getState().point(null);
    return openEarn('piers');
  }
  if (role === 'launcher') {
    useCrew.getState().point(null);
    return useAutopilot.getState().show({ kind: 'launch', said: '', name: null, symbol: null });
  }
  // The Autopilot working already: its card on what it did. Else the plan's sum is hers to say — never one of Ryntra's
  // (decision 108): the terminal's Autopilot page asks her for it; without the terminal, the line does, and the plan
  // card opens with the sum she said.
  const pilot = usePilot.getState();
  const way = pilotHireWay(pilot.view?.status === 'working', terminalOpen());
  if (way === 'live') return pilot.showLive();
  useCrew.getState().point(null);
  if (way === 'terminal' && typeof window !== 'undefined') return window.location.assign(PILOT_PAGE);
  openCommand();
}
