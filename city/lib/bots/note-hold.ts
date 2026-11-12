/**
 * How long the line an action answers with stays on screen (CITY-237; CITY-235's phone pass, ask 3).
 *
 * A «yes» is seen at a glance and the window moves on — eight seconds. A «no» is read: «Stopped before your wallet —
 * nothing was sent» stood under the ladder for the same eight seconds, below the edge of a phone's half-screen window,
 * and was gone before the person scrolled to it. A «no» now stays half a minute — or until the next tap, which clears
 * it first (`placeDraft`, `tapEnable`). «Costs changed» stays until the next tap answers it, as before.
 */
export const NOTE_YES_MS = 8_000;
export const NOTE_NO_MS = 30_000;

/** Lines that say an action did not go through: the wallet's «no», the engine's stop before it, a network that kept silent. */
const NO: ReadonlySet<string> = new Set(['walletNo', 'refused', 'unreachable', 'overCap']);

/** Whether a line says «no»: it is about the settings as they stood at the tap, so changed settings take it away. */
export const saysNo = (kind: string): boolean => NO.has(kind);

/** Milliseconds a line of this kind stays; `null` — until the next tap. */
export function noteHoldMs(kind: string): number | null {
  if (kind === 'costsChanged') return null;
  return NO.has(kind) ? NOTE_NO_MS : NOTE_YES_MS;
}

/**
 * Milliseconds a line still has, counted from when it was said — not from when a window began to show it. A window
 * closed and opened again an hour later must not bring an old «Nothing was signed» back for another half minute: its
 * time is up, and `0` takes it away at once. `null` — until the next tap.
 */
export function noteLeftMs(note: Readonly<{ kind: string; at: number }>, now: number): number | null {
  const hold = noteHoldMs(note.kind);
  return hold === null ? null : Math.max(0, note.at + hold - now);
}
