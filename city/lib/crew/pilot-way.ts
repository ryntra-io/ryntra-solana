/**
 * Where «Hire» the money Autopilot leads (decision 108: the plan's sum is the person's, never one of Ryntra's): its card
 * on what it does while a plan works; else the terminal's Autopilot page, whose card asks her for the sum; and where the
 * terminal is not open, the command line, where she says the plan with her own sum. Pure.
 */

/** The terminal's Autopilot page (`terminal/bots/kinds.ts` `botHref('autopilot')`). */
export const PILOT_PAGE = '/bots/autopilot';

export type PilotHireWay = 'live' | 'terminal' | 'line';

export function pilotHireWay(working: boolean, terminal: boolean): PilotHireWay {
  if (working) return 'live';
  return terminal ? 'terminal' : 'line';
}
