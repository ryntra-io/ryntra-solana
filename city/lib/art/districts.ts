import { DISTRICT_IDS, type DistrictId } from './frames.ts';
import { HOW } from './words.ts';

/**
 * The words of each district for «How the city works» (CITY-64), in the language on screen (`./words.ts`, CITY-79):
 * what it is, and what you do there, a short sentence each. Present tense and plain; a district that is not open says «Soon» on its own chip
 * rather than promising anything in its words, and no line speaks of profit (the brandbook's voice,
 * `docs/city/brand/BRANDBOOK.md` §4). The facts are the city's own (`docs/city/HOW-IT-WORKS.md`); the rules wait
 * behind their own control.
 */
export type DistrictWords = Readonly<{ name: string; what: string; doing: string }>;

type HowWords = (typeof HOW)['en'];

/** The district's three lines out of the words of one language. */
export function districtWords(w: HowWords, id: DistrictId): DistrictWords {
  return { name: w[`${id}Name`], what: w[`${id}What`], doing: w[`${id}Doing`] };
}

/** How the city reads the market — the rules a visitor can check on any tower. */
export const cityRules = (w: HowWords): readonly string[] => [w.rule1, w.rule2, w.rule3, w.rule4];

/** What the city never does. */
export const cityNever = (w: HowWords): readonly string[] => [w.never1, w.never2, w.never3];

const EN = HOW.en;

/* The English words by their old names, as the brand's voice test reads them. */
export const DISTRICT_WORDS: Readonly<Record<DistrictId, DistrictWords>> = Object.fromEntries(DISTRICT_IDS.map((id) => [id, districtWords(EN, id)])) as Record<DistrictId, DistrictWords>;

/** The one line under the title. */
export const HOW_LEAD = EN.lead;

export const CITY_RULES: readonly string[] = cityRules(EN);

/** Said only where the Skyline Run is open. */
export const RUN_RULE = EN.runRule;

export const CITY_NEVER: readonly string[] = cityNever(EN);

/** The line under every page that shows the market. */
export const MARKET_SOURCE = EN.source;
