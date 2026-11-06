import { create } from 'zustand';
import { AUTOPILOT_NET } from '../autopilot/flag.ts';
import { useAutopilot } from '../autopilot/store.ts';
import { MANDATE_NET } from '../bots/mandate.ts';
import { openBots } from '../bots/open.ts';
import { EARN_OPEN } from '../earn/flag.ts';
import { openEarn } from '../earn/open.ts';
import { launchOpenHere, useLaunch } from '../launch/district.ts';
import { PILOT_OPEN, usePilot } from '../pilot/store.ts';
import { readPilotAsk } from '../pilot/read.ts';
import type { Book } from '../command/parse.ts';
import type { CrewGates, Role } from './read.ts';

/**
 * «Hire» (CITY-205): each agent's own card, opened where it already lives — the Trader's budget on top of «Bots», the
 * Autopilot's plan card, the pool keeper on Earn's piers, the Launcher's prepared launch. A hire only opens a card: the
 * person reads it there and signs once in their own wallet; nothing here builds, signs or sends anything.
 */

/** The pool keeper's switch (CITY-203, `city/lib/earn/care.ts`), read here without the care window's signing half. */
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

/** The Autopilot's first plan when no amount was said: a small budget the card shows before anything is signed. */
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

/**
 * Opens the agent's own card — or, for `null` or an agent shut on this deployment, the crew in «Bots». `book` names the
 * coins a plan may trade (the command line's); the opening lines are the language on screen.
 */
export function hire(role: Role | null, book: Book, lang: 'en' | 'uk', open: Readonly<{ pilot: (ask: NonNullable<ReturnType<typeof readPilotAsk>>) => void }>): void {
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
  // The Autopilot working already: its card on what it did; else the plan from the starter sentence, for her to read.
  const pilot = usePilot.getState();
  if (pilot.view?.status === 'working') return pilot.showLive();
  const ask = readPilotAsk(PILOT_STARTER[lang], book) ?? readPilotAsk(PILOT_STARTER.en, book);
  if (ask) return open.pilot(ask);
  useCrew.getState().point('pilot');
  openBots('launch');
}
