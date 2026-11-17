/**
 * The terminal's one switch. Until the terminal becomes the home page it is built behind this switch, closed by
 * default: ryntra.io keeps showing the city, and none of the terminal's addresses answers.
 *
 *   NEXT_PUBLIC_RYNTRA_TERMINAL=stand — a stand for the eyes: every shelf that is ready, and the kit page with every
 *                                       shelf in its preview state.
 *   NEXT_PUBLIC_RYNTRA_TERMINAL=open  — for people: every shelf that is ready; the kit page stays shut.
 *   anything else, or nothing         — closed: no address of the terminal answers, and the short addresses lead into
 *                                       the city exactly as they did.
 *
 * Pure data, no imports: the build's config reads this file before anything is compiled.
 */

/** The variable that holds the switch. */
export const TERMINAL_FLAG = 'NEXT_PUBLIC_RYNTRA_TERMINAL';

export const TERMINAL_MODES = ['closed', 'stand', 'open'] as const;
export type TerminalMode = (typeof TERMINAL_MODES)[number];

/** The switch's value as the build reads it: `stand`, `open`, else closed. */
export function terminalMode(value: string | null | undefined): TerminalMode {
  const said = typeof value === 'string' ? value.trim() : '';
  return said === 'open' ? 'open' : said === 'stand' ? 'stand' : 'closed';
}

/** The switch of this build. Written out in full, so the build inlines it into the browser's code too. */
export const TERMINAL_MODE: TerminalMode = terminalMode(process.env.NEXT_PUBLIC_RYNTRA_TERMINAL);

/** Whether the terminal's addresses answer at all. */
export function terminalOpen(mode: TerminalMode = TERMINAL_MODE): boolean {
  return mode !== 'closed';
}

/** Whether the kit page answers: a stand only, never the build people use. */
export function kitOpen(mode: TerminalMode = TERMINAL_MODE): boolean {
  return mode === 'stand';
}
