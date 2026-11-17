import type { Gates } from '../../city/lib/command/parse.ts';
import { switchGates } from '../../city/lib/command/switches.ts';
import { CITY_LAUNCH_SWITCH } from '../../city/lib/launch/gate.ts';
import { proLimitsWindow } from '../../lib/pro-limits/gate.ts';

/**
 * The engines behind the agent's line: the deployment's own switches, as the city's command line reads them. Three
 * gates are their screens' to open, each by the city's own rule — Launch (the district's `launchOpenHere`), the money
 * autopilot (`PILOT_OPEN`) and the ladders (`LADDER_OPEN`): the screen that takes those sentences sets its gate here,
 * in the same change that turns its shelf on. One gate per line, so two screens never edit the same one.
 */
export function engineGates(): Gates {
  const switches = switchGates();
  return {
    ...switches,
    // The Launch screen takes «launch me a token» by the city's own rule (`city/lib/launch/district.ts`
    // `launchOpenHere`): the deployment's switch over a network the city may launch on — every network the engine
    // serves, since launching on mainnet is open. Where the engine serves no Launch, the screen itself says so.
    launch: CITY_LAUNCH_SWITCH,
    // The Agents screen takes the autopilot's plan, by the city's own rule (`city/lib/pilot/store.ts` `PILOT_OPEN`): its
    // switch over the agent's and the mandate's — written out here, so the frame does not load the autopilot's store.
    pilot: process.env.NEXT_PUBLIC_RYNTRA_CITY_PILOT?.trim() === 'open' && switches.agentTrade === true,
    // The agent's one-sentence instructions have no screen in the terminal yet: the line does not offer them.
    instruct: false,
    // The coin's screen takes «buy cheaper», «sell higher» on its Limit tab, by the city's own rule (`city/lib/command/doors.ts`
    // `gatesNow`): the ladders' window switch (`LADDER_OPEN` of `city/lib/trade/pro-store.ts`) over the trade's — written
    // out here, so the frame does not load the ladders' store. The engine's own gate still answers: mainnet stays shut until it opens there.
    ladder: proLimitsWindow(process.env.NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS) !== null && switches.trade,
  };
}
