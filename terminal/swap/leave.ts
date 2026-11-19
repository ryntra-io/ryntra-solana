/* The Swap screen's old tabs and where they lead now — pure and server-safe: the Swap page reads it before anything is
   drawn, so it imports nothing. */

/* ── the old tabs' addresses (decision 109) ───────────────────────────── */

/**
 * Where an address of the Swap screen's old tabs leads now: the limit to the coin's
 * own page (the spot), the bridge to its own page, a transfer to the Portfolio, where it stands until «Money» has a
 * screen; the swap, or nothing, stays. One step: the old address is replaced, never kept in the history.
 */
export type Leave = 'coin' | 'bridge' | 'send' | null;

/** The Bridge's own page: the bridge is no longer a tab of the Swap screen. */
export const BRIDGE_PATH = '/bridge';

export function leaveOf(tab: string | null | undefined): Leave {
  if (tab === 'limit') return 'coin';
  if (tab === 'bridge') return 'bridge';
  if (tab === 'send') return 'send';
  return null;
}
