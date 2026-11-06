import { learnAsk } from '../learn/ask.ts';

/**
 * Two kinds of help in the city: **Ryntra, the consultant** — asked from the top
 * bar, reads the market and advises, signs nothing, costs credits — and **the agents**, the workers a person hires in
 * «Bots»: each has one job, its own budget in the person's Squads vault, and a stop. A sentence that hands money work
 * over («trade for me», «доглядай мій пул», «запусти бота») is a job for an agent, not a question: the consultant does
 * not answer it in words, it shows the agent and «Hire».
 *
 * This file reads that sentence. Pure: no store, no wallet, no network — the command line, the consultant's panel and
 * the tests read it as it is. The sentences the agents' own readers fill in (`readAsk`, `readPilotAsk`,
 * `readDollarAsk`, `readInstruction`: an amount, a coin, a rhythm) go to them first; this reader takes the rest.
 */

/** The agents a person hires, one job each, in the order «Bots» shows them. */
export const CREW = ['trader', 'pilot', 'keeper', 'launcher'] as const;
export type Role = (typeof CREW)[number];

/**
 * What each agent may do — its skills, inside the policy the person signs once — and what it is paid. The skills are
 * the engine's own (named for the reader of the Details, never on the first screen); the pay is the trade fee of the
 * engine's table, never credits.
 */
export const ROLE_FACTS: Readonly<Record<Role, Readonly<{ skills: readonly string[]; paid: 'trade-fee' | 'none' | 'launch-fee' }>>> = {
  /** CITY-136/174/186: buys and sells one coin by a tested strategy, in the day's and the trade's limits. */
  trader: { skills: ['buy', 'sell', 'dayLimit', 'autostop'], paid: 'trade-fee' },
  /** CITY-204: one plan for the whole budget — savings on Jupiter Lend, a share traded, a share in pools. */
  pilot: { skills: ['save', 'trade', 'pool', 'rebalance'], paid: 'trade-fee' },
  /** CITY-203: a Meteora pier looked after — fees claimed, the range kept around the price, out at the person's stop. */
  keeper: { skills: ['claim', 'range', 'exit'], paid: 'none' },
  /** The launch prepared from one sentence: name, ticker, picture — the person signs once (Meteora's curve). */
  launcher: { skills: ['prepare', 'curve', 'tower'], paid: 'launch-fee' },
};

export type HireAsk = Readonly<{ said: string; role: Role | null }>;

/** A whole word of the sentence, Latin or Cyrillic: JavaScript's `\b` knows only Latin. */
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'u');

/** «For me», «instead of me»: the work is handed over. */
const FOR_ME = /(?<![\p{L}])(за мене|замість мене|для мене|за меня|вместо меня|для меня|for me|on my behalf|instead of me|сам(а|і)?|itself|automatically|автоматично|на автопілоті)(?![\p{L}])/u;
const AGENT = word('бот\\p{L}*|агент\\p{L}*|bot|bots|agent|agents|трейдер\\p{L}*|trader|traders|робот\\p{L}*|robot');
const HIRE = word('найм\\p{L}*|найня\\p{L}*|найми|hire|запусти|запустити|запустіть|увімкни|включи|start|launch|run|create|make|build|створ\\p{L}*|зроби|постав\\p{L}*|хочу|want|need|потрібен|потрібна|нужен|дай|give|set|налаштуй|заведи|get');
const TRADE = word('торгу\\p{L}*|поторгу\\p{L}*|trade|trades|trading|торгов\\p{L}*|скальп\\p{L}*|scalp\\p{L}*|купуй і продавай|buy and sell');
const EARN = word('заробля\\p{L}*|заробл\\p{L}*|заробит\\p{L}*|зароби|earn|grow|примнож\\p{L}*|керуй|керувати|manage|managing|розпоряджа\\p{L}*|працюй|work|стейк\\p{L}*|stake|staking|інвесту\\p{L}*|invest|розподіли|розподіляй|allocate');
const MY_MONEY = word('мо\\p{L}* (грош\\p{L}*|кошт\\p{L}*|sol|usdc|портфел\\p{L}*|заощаджен\\p{L}*)|my (money|funds|savings|sol|usdc|portfolio|cash)|гроші|грошима|кошти|коштами|money|funds|portfolio|портфел\\p{L}*');
const POOL = word('пул\\p{L}*|причал\\p{L}*|pool|pools|pier|piers|liquidity|ліквідн\\p{L}*|lp|позиці\\p{L}*|position');
const CARE = word('доглядай|доглядати|догляда\\p{L}*|look after|tend|watch|стеж\\p{L}*|ребаланс\\p{L}*|rebalanc\\p{L}*|збирай|collect|keep|тримай|керуй|manage');
const TRADER = word('трейдер\\p{L}*|trader|traders');
const AUTOPILOT = word('автопілот\\p{L}*|autopilot|auto-pilot|автопилот\\p{L}*');
const TOKEN = word('токен\\p{L}*|монет\\p{L}*|token|tokens|coin|coins|мем\\p{L}*|meme\\p{L}*|memecoin');
const LAUNCH = word('запусти|запустити|запускай|launch|створи|create|deploy|зроби|make');
const NOT = word('не|ні|ніколи|never|dont|don\'t|not|no|нет|никогда|stop|стоп|зупини');

/**
 * The agent a sentence hires, or null when it is not a job: a role when the job names one, `role: null` when it asks
 * for an agent without saying which («запусти бота», «hire an agent»). A question about how agents work is the guide's
 * (`learnAsk`), and a refusal or a stop is never a hire.
 */
export function readHire(input: string): HireAsk | null {
  const said = input.slice(0, 140).trim();
  if (!said) return null;
  if (learnAsk(said) !== undefined) return null;
  const line = said.toLowerCase().replace(/[’`]/gu, "'").replace(/[«»"“”„()?!.,;:]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (NOT.test(line)) return null;
  const forMe = FOR_ME.test(line);
  const agent = AGENT.test(line);
  if (AUTOPILOT.test(line)) return { said, role: 'pilot' };
  if (POOL.test(line) && (CARE.test(line) || forMe || agent)) return { said, role: 'keeper' };
  if (TOKEN.test(line) && LAUNCH.test(line) && (forMe || agent)) return { said, role: 'launcher' };
  if (TRADE.test(line) && (forMe || agent)) return { said, role: 'trader' };
  if (EARN.test(line) && (forMe || agent) && (MY_MONEY.test(line) || forMe)) return { said, role: 'pilot' };
  if (EARN.test(line) && MY_MONEY.test(line) && /^(manage|grow|invest|керуй|примнож|інвесту|розподіл|стейк|stake|заробля|зароби|працюй)/u.test(line)) return { said, role: 'pilot' };
  if (TRADER.test(line) && HIRE.test(line)) return { said, role: 'trader' };
  if (agent && HIRE.test(line)) return { said, role: null };
  return null;
}

/** The agents open on this deployment, by the switches the menu reads; a shut one shows «coming». */
export type CrewGates = Readonly<{ trader: boolean; pilot: boolean; keeper: boolean; launcher: boolean }>;

/** The hire as this deployment can take it: an agent whose switch is shut hands the person the whole crew instead. */
export function hireFit(ask: HireAsk, gates: CrewGates): HireAsk {
  return ask.role && !gates[ask.role] ? { ...ask, role: null } : ask;
}
