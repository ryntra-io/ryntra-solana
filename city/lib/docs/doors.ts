import { AGENTS_OPEN } from '../agent/flag.ts';
import { HARBOR_OPEN } from '../districts/harbor/flag.ts';
import { EARN_OPEN } from '../earn/flag.ts';
import { LIMIT_MODE } from '../earn/limit-gate.ts';
import { GUARD_OPEN } from '../guard/flag.ts';
import { ONE_SENTENCE_OPEN } from '../instruct/flag.ts';
import { cityLaunchOpen } from '../launch/gate.ts';
import { MONEY_OPEN } from '../money/flag.ts';
import { SPOT_OPEN, STOPS_ENGINE, TRADE_OPEN } from '../trade/gates.ts';
import { docsStatus, type DocsDoors, type DocsStatus } from './status.ts';

/**
 * Whether each of the city's doors is open in this build, for the documentation (CITY-180): the deployment's own switches, the ones
 * the city's menu and the roadmap read (`lib/roadmap/roadmap.test.mjs` holds this table to the roadmap's). Launching from the city
 * follows the deployment's switch and the word in `city/lib/launch/gate.ts`, so the release that opens it opens its section.
 */
export const CITY_DOORS: DocsDoors = {
  launch: cityLaunchOpen('solana:mainnet'),
  trade: TRADE_OPEN,
  spot: SPOT_OPEN,
  stops: STOPS_ENGINE,
  earn: EARN_OPEN || HARBOR_OPEN,
  earnWindow: EARN_OPEN,
  guard: GUARD_OPEN,
  money: MONEY_OPEN,
  bots: AGENTS_OPEN,
};

/**
 * The agent's budget has no door of the menu: it stands behind the mandate's own switch, which today says only `devnet`, a test
 * network nobody's money is on. It opens to people with the release that lets it say more.
 */
export function budgetOpen(value: string | undefined): boolean {
  const said = value?.trim();
  return said === 'mainnet' || said === 'open';
}

export const CITY_STATUS: DocsStatus = docsStatus(CITY_DOORS, {
  oneSentence: ONE_SENTENCE_OPEN,
  budget: budgetOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_MANDATE),
  poolLimits: LIMIT_MODE === 'open',
});
