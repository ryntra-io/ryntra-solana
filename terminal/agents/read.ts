import { readAsk } from '../../city/lib/autopilot/read.ts';
import { fit, keyOf, type Book, type Command, type Context, type Gates, type Row } from '../../city/lib/command/parse.ts';
import { hireFit, readHire, type CrewGates, type Role } from '../../city/lib/crew/read.ts';
import { firstSentences, type Say } from '../../city/lib/crew/say.ts';
import { readDollarAsk } from '../../city/lib/earn/dollar-read.ts';
import { readPilotAsk } from '../../city/lib/pilot/read.ts';
import { readLadderAsk } from '../../city/lib/trade/pro-read.ts';

/**
 * The sentences that are a job for an agent, read the city's own way and in the city's own order: one plan for a whole
 * budget («work with my 2 SOL: some into savings, some trade»), then a budget a day («trade BONK with 0.1 SOL a day»,
 * «buy BONK on dips»), then a hire («trade for me», «hire an agent»). The readers are the city's
 * (`city/lib/pilot/read.ts`, `city/lib/autopilot/read.ts`, `city/lib/crew/read.ts`); here is only which of them the
 * terminal asks, and when.
 *
 * Two readers stand before the agent's in the city and belong to other screens — the dollar saver's (Earn) and the
 * ladder's (a coin's screen). Where their engines are open, a sentence of theirs is left to them: the agent never takes
 * «buy BONK cheaper» for a strategy while a ladder can take it. A launch said to the agent is the Launch shelf's own
 * sentence, read by the plain list. Nothing here opens, fills or signs.
 *
 * Pure: the frame's line, the screen and the tests read it as it is.
 */

/** The pool keeper's switch on this deployment, written out in full so the build inlines it. */
const CARE_OPEN = ['devnet', 'mainnet'].includes(process.env.NEXT_PUBLIC_RYNTRA_AGENT_CARE?.trim().toLowerCase() ?? '');

/**
 * The agents a person can hire in the terminal: each by the line's own gate, the keeper where the Earn shelf is on
 * (its pools are that screen's), the launcher where the Launch shelf is.
 */
export function crewOpen(gates: Gates, earnOn: boolean, careOpen: boolean = CARE_OPEN): CrewGates {
  return {
    trader: gates.agentTrade === true,
    pilot: gates.pilot === true,
    keeper: careOpen && earnOn && gates.earn,
    launcher: gates.agentLaunch === true && gates.launch,
  };
}

/** The agent's own reading of a sentence, or null when it is not a job for an agent here. */
export function agentCommand(input: string, book: Book, context: Context, gates: Gates, crew: CrewGates): Command | null {
  const pilot = gates.pilot === true ? readPilotAsk(input, book) : null;
  if (pilot) return fit({ kind: 'pilot', ask: pilot }, gates);
  // Another screen's sentence, where its engine is open: left to it.
  if (gates.dollar === true && readDollarAsk(input)) return null;
  // «Buy BONK cheaper», «sell half at 2x»: the coin's ladder, first — its Limit tab, filled; never the dip strategy over it.
  const ladder = gates.ladder === true ? readLadderAsk(input, book, context) : null;
  if (ladder) return fit({ kind: 'ladder', ask: ladder }, gates);
  const ask = gates.agentTrade === true ? readAsk(input, book, context.pools === true) : null;
  if (ask?.kind === 'trade') return fit({ kind: 'autopilot', ask }, gates);
  // A launch the agent prepares is the Launch shelf's sentence: the plain list reads it.
  if (ask) return null;
  const job = readHire(input);
  return job ? { kind: 'hire', ask: hireFit(job, crew) } : null;
}

/** The row the agent's line puts first for a sentence, or null. */
export function agentRow(input: string, book: Book, context: Context, gates: Gates, earnOn: boolean): Row | null {
  const command = agentCommand(input, book, context, gates, crewOpen(gates, earnOn));
  return command ? { key: keyOf(command), command } : null;
}

/** The sentences ready to say in one tap: the city's first sentences, for the agents open here. */
export function readySentences(lang: 'en' | 'uk', book: Book, crew: CrewGates): readonly Say[] {
  return firstSentences(lang, book, { trade: crew.trader, launch: crew.launcher });
}

/** Where a hire leads: the trader's and the autopilot's cards are this screen's own; the keeper's pools and a launch are their shelves'. */
export function hireWay(role: Role): 'here' | 'earn' | 'launch' {
  return role === 'keeper' ? 'earn' : role === 'launcher' ? 'launch' : 'here';
}
