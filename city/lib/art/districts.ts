import type { DistrictId } from './frames.ts';

/**
 * The words of each district for «How the city works» (CITY-64), in the city's language: what it is, and what you do
 * there, a short sentence each. Present tense and plain; a district that is not open says «Soon» on its own chip
 * rather than promising anything in its words, and no line speaks of profit (the brandbook's voice,
 * `docs/city/brand/BRANDBOOK.md` §4). The facts are the city's own (`docs/city/HOW-IT-WORKS.md`); the rules wait
 * behind their own control.
 */
export type DistrictWords = Readonly<{ name: string; what: string; doing: string }>;

export const DISTRICT_WORDS: Readonly<Record<DistrictId, DistrictWords>> = {
  market: {
    name: 'Market',
    what: 'Every Solana coin is a tower, as tall as its market cap and the liquidity behind it allow.',
    doing: 'Tap a tower to see it, and buy from your own wallet with one signature.',
  },
  launch: {
    name: 'Launch Docks',
    what: 'New pools land at the docks, unverified. Most fade within hours.',
    doing: 'Raise your own coin as a tower: a picture, a name, a ticker and one signature.',
  },
  harbor: {
    name: 'Harbor',
    what: 'The pools of Solana, moored in one place.',
    doing: 'Add to a pool from your own wallet for a share of its trading fees while the price stays in your range.',
  },
  agents: {
    name: 'Agents',
    what: 'A scout that watches the market by a rule you give it.',
    doing: 'It brings you the towers that fit. You sign every buy.',
  },
  vault: {
    name: 'Vault',
    what: 'A vault kept by an AI guard.',
    doing: 'Talk the guard out of the phrase that opens the door.',
  },
  ring: {
    name: 'Ring',
    what: 'The rooftop arena where AI agents meet in weight classes.',
    doing: 'Watch every bout and every move in the open.',
  },
  home: {
    name: 'Home',
    what: 'A quarter of the city of your own, kept under your wallet.',
    doing: 'Claim a spot for free and build your home, storey by storey.',
  },
};

/** The one line under the title. */
export const HOW_LEAD = 'The Solana market as a living night city. Every action with your coins is yours to sign.';

/** How the city reads the market — the rules a visitor can check on any tower. */
export const CITY_RULES: readonly string[] = [
  'The light on top of a tower is the day’s move: mint up, red down, amber flat.',
  'Prices come from Jupiter and refresh every minute. Data older than five minutes moves nothing, and the top bar says Delayed.',
  'Only coins Jupiter verifies carry a name and a logo. New pools stand in the docks unnamed and marked unverified.',
  'A moment needs real liquidity, and every figure names its window: +18.4% · 24H.',
];

/** Said only where the Skyline Run is open. */
export const RUN_RULE = 'Runs are counted anonymously on this device: no name, no wallet.';

/** What the city never does. */
export const CITY_NEVER: readonly string[] = [
  'Hold your keys or sign for you: every action with your coins is your signature in your own wallet.',
  'Show a number it made up: every amount has its source, its window and its transaction.',
  'Pay for visits, likes or posts.',
];

/** The line under every page that shows the market. */
export const MARKET_SOURCE = 'Market data: Jupiter · not financial advice';
