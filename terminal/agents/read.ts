import { readAsk } from '../../city/lib/autopilot/read.ts';
import { fit, keyOf, type Book, type Command, type Context, type Gates, type Row } from '../../city/lib/command/parse.ts';
import { hireFit, readHire, type CrewGates } from '../../city/lib/crew/read.ts';
import { readDollarAsk } from '../../city/lib/earn/dollar-read.ts';
import { readPilotAsk } from '../../city/lib/pilot/read.ts';
import { readLadderAsk } from '../../city/lib/trade/pro-read.ts';
import type { Coin } from '../../city/lib/command/parse.ts';
import { SOL_MINT, USDC_MINT, type AgentPlan } from '../../lib/sentence/plan.ts';
import { readSchedule, type ScheduleCadence } from '../../lib/sentence/schedule.ts';

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
  // «Buy TSLAx every week for $50»: a regular purchase — Recurring buys with its rhythm, sum and coin, never a
  // one-off buy of the coin. The bot stands where the mandate's engine does.
  const schedule = gates.agentTrade === true ? readSchedule(input, book.coins) : null;
  if (schedule) return recurringOf(schedule.said, schedule.coin, schedule.amount?.unit === 'usd' ? schedule.amount.text : null, schedule.cadence);
  const job = readHire(input);
  return job ? { kind: 'hire', ask: hireFit(job, crew) } : null;
}

/** The row the agent's line puts first for a sentence, or null. */
export function agentRow(input: string, book: Book, context: Context, gates: Gates, earnOn: boolean): Row | null {
  const command = agentCommand(input, book, context, gates, crewOpen(gates, earnOn));
  return command ? { key: keyOf(command), command } : null;
}



/**
 * A regular purchase as the line carries it to Recurring buys: the instruction's own shape — the sentence, the
 * coin, the dollars and the rhythm, as said. The bot's page reads the sentence again for a sum in SOL (`readSchedule`)
 * and fills its card; nothing here signs.
 */
function recurringOf(said: string, coin: Coin | null, usd: string | null, cadence: ScheduleCadence | null): Command {
  return { kind: 'instruct', instruction: { kind: 'recurring', said, coin, usd, cadence, weekday: null, time: null, options: {} } };
}

/**
 * The model's plan of a regular purchase (`dca`) as Recurring buys, where the bot stands — its numbers are the
 * person's own, checked by `readDraft`. A rhythm of buying SOL or USDC themselves is no bot's: null, and the line reads
 * the sentence as before.
 */
export function planRecurring(plan: AgentPlan<Coin>, gates: Gates): Command | null {
  if (plan.action !== 'dca' || gates.agentTrade !== true) return null;
  if (plan.coin && (plan.coin.mint === SOL_MINT || plan.coin.mint === USDC_MINT)) return null;
  return recurringOf(plan.said, plan.coin, plan.usd, plan.cadence);
}
