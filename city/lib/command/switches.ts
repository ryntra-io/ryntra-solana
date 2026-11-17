import { AUTOPILOT_NET } from '../autopilot/flag.ts';
import { MANDATE_NET } from '../bots/mandate.ts';
import { HARBOR_OPEN } from '../districts/harbor/flag.ts';
import { DOLLAR_OPEN } from '../earn/dollar-gate.ts';
import { EARN_OPEN } from '../earn/flag.ts';
import { ONE_SENTENCE_OPEN } from '../instruct/flag.ts';
import { MONEY_OPEN } from '../money/flag.ts';
import { SPOT_OPEN, TRADE_OPEN } from '../trade/gates.ts';
import type { Gates } from './parse.ts';

/**
 * The command line's gates that are this deployment's own switches, readable on any page: every gate but the three the
 * city's stores decide — Launch's district, the money autopilot and the ladders (`doors.ts` `gatesNow` adds them). The
 * terminal's agent line reads the same switches, so a sentence never offers what the engines keep shut.
 */
export type SwitchGates = Omit<Gates, 'launch' | 'pilot' | 'ladder'>;

export function switchGates(): SwitchGates {
  return {
    trade: TRADE_OPEN,
    spot: SPOT_OPEN,
    money: MONEY_OPEN,
    earn: EARN_OPEN || HARBOR_OPEN,
    // The agent's instructions trade through the trade window's engines: shut with them.
    instruct: ONE_SENTENCE_OPEN && TRADE_OPEN,
    // The agent on its word: trading rides on the mandate's devnet switch, launches on the launch district's.
    agentTrade: AUTOPILOT_NET !== null && MANDATE_NET !== null,
    agentLaunch: AUTOPILOT_NET !== null,
    dollar: EARN_OPEN && DOLLAR_OPEN,
  };
}
