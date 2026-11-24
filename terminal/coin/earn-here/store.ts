import { useEffect } from 'react';
import { create } from 'zustand';
import { pick, ticketHeld, useTicket, type Ticket } from '../../earn/ticket.ts';

/**
 * The drawer of Earn's ticket on the coin's screen. What stands in it is Earn's own pick (`useTicket` of
 * `terminal/earn/ticket.ts`): a pool's add, a position's take or exit, a pool shown to compare — so a ticket's own tabs
 * (a position's «Take · Exit») move it as they do on Earn. This store says only whether the drawer is open, and which
 * coin waits for its best pool once the pools are read («Earn on it» after a buy).
 *
 * `need` counts what on the screen draws Earn's figures (the tabs, the drawer): the reads run only while one does.
 */
type EarnHereState = { open: boolean; want: string | null; need: number };

export const useEarnHere = create<EarnHereState>(() => ({ open: false, want: null, need: 0 }));

/** The tag a pick from the coin's screen carries: no tab of Earn's own is it, so Earn never opens on it by itself. */
export const ON_COIN = 'coin';

/** A row's or a position's ticket in the drawer: placed in its own store exactly as Earn places it. False when held. */
export function openTicket(ticket: Ticket): boolean {
  if (!pick(ticket, ON_COIN)) return false;
  useEarnHere.setState({ open: true, want: null });
  return true;
}

/** «Earn on it»: the drawer opens on the coin, and its best pool is put in front once the pools are read. */
export function openBest(mint: string): void {
  if (ticketHeld()) return;
  useEarnHere.setState({ open: true, want: mint });
}

/** The drawer put away; never while a signature is out or a part landed and is not read. */
export function closeDrawer(): boolean {
  if (ticketHeld()) return false;
  useEarnHere.setState({ open: false, want: null });
  useTicket.setState({ sheet: false });
  return true;
}

/** A part of the screen that draws Earn's figures: the reads run while one is mounted. */
export function useEarnNeed(on = true): void {
  useEffect(() => {
    if (!on) return;
    useEarnHere.setState((st) => ({ need: st.need + 1 }));
    return () => useEarnHere.setState((st) => ({ need: Math.max(0, st.need - 1) }));
  }, [on]);
}

/** The drawer starts shut on every coin, and is put away when the screen is left. */
export function useDrawerReset(mint: string): void {
  useEffect(() => {
    useEarnHere.setState({ open: false, want: null });
    return () => useEarnHere.setState({ open: false, want: null });
  }, [mint]);
}
