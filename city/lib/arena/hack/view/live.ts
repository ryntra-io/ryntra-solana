import { useStore } from 'zustand';
import { arenaStore, fighterOf, openArena } from '../../../ring/arena.ts';
import { RING_OPEN } from '../../../ring/flag.ts';
import type { MyAgent } from './contract.ts';
import { createHackStore, type HackState } from './store.ts';

/**
 * The city's own Hack window (CITY-227), wired to the Arena: the agent that goes on orders is the person's Ring agent
 * (the Arena's own read of «my agent», CITY-217), the sign-in is the Arena's (the city's wallet), and a first agent is
 * made in the Arena's garage.
 */

/** The person's agent that goes on orders: the Ring's first active one. */
export function myAgent(): MyAgent | null {
  const agent = fighterOf(arenaStore.getState().mine);
  return agent ? { id: agent.id, name: agent.name, archetype: agent.archetype } : null;
}

export const hackStore = createHackStore({
  agent: myAgent,
  signedIn: () => arenaStore.getState().mine.signedIn,
  readAgent: () => (RING_OPEN ? arenaStore.getState().readMine() : Promise.resolve()),
  signIn: () => arenaStore.getState().signIn(),
  makeAgent: () => {
    if (!RING_OPEN) return;
    openArena('agent');
    void arenaStore.getState().makeAgent();
  },
});

export function useHack<T>(pick: (state: HackState) => T): T {
  return useStore(hackStore, pick);
}

/** The Arena's Hack door: opens the window, or closes it when it is open. */
export function toggleHack(): void {
  const st = hackStore.getState();
  if (st.open) st.close();
  else st.show();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __hack: hackStore });
