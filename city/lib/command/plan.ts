import type { AgentAsk } from '../autopilot/read.ts';
import { hireFit, type CrewGates } from '../crew/read.ts';
import type { AgentPlan } from '../../../lib/sentence/plan.ts';
import { fit, type Coin, type Command, type Gates } from './parse.ts';

/**
 * The agent's plan, read from a sentence by the model and checked by the engine (`lib/sentence/plan.ts`), as
 * the command the line already opens: the same card each shelf fills from the line's own reading. A trade or the scout
 * is the agent's card with the day, the trade's limit, the term and the strategy said; a pool's care is the keeper's
 * hire; a schedule is the regular purchase's card; a launch is the launch sheet with the name and ticker said.
 *
 * The card shows what was said and asks for the rest; the person signs there. Nothing here signs, sends or holds
 * anything, and no window that is shut on this deployment is opened (`fit`). Pure.
 */
export function planCommand(plan: AgentPlan<Coin>, gates: Gates, crew: CrewGates): Command | null {
  switch (plan.action) {
    case 'trade':
    case 'scout': {
      const ask: AgentAsk = {
        kind: 'trade',
        said: plan.said,
        perDaySol: plan.perDaySol,
        coin: plan.coin,
        ...(plan.strategy ? { plan: plan.strategy } : {}),
        ...(plan.perTradeSol ? { perTradeSol: plan.perTradeSol } : {}),
        ...(plan.days ? { days: plan.days } : {}),
      };
      return fit({ kind: 'autopilot', ask }, gates);
    }
    case 'care':
      // The keeper where its pools are open here; otherwise the crew in «Bots», as the line's own hire reads it.
      return { kind: 'hire', ask: hireFit({ said: plan.said, role: 'keeper' }, crew) };
    case 'dca':
      return fit({ kind: 'instruct', instruction: { kind: 'recurring', said: plan.said, coin: plan.coin, usd: plan.usd, cadence: plan.cadence, weekday: null, time: null, options: {} } }, gates);
    case 'launch':
      return fit({ kind: 'launch', symbol: plan.symbol, name: plan.name }, gates);
  }
}
