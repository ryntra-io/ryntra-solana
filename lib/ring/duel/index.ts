/** The Ring's duels (CITY-51): the public face of `lib/ring/duel`. See `README.md`. */

export { FAULTS, SEATS, THOUGHT_MAX, faultEnding, isFault, readRound, type Ending, type Fault, type Pair, type RoundInput, type Seat } from "./rounds.ts";
export { PHRASE_LENGTH, PHRASE_WORDS, drawPhrase, normalizePhrase } from "./phrases.ts";
export { CRACK, CRACK_DEFAULTS, GUESS_MAX, HIDDEN, crack, crackSeatView, phraseCommit, readCrackConfig, redact, type CrackConfig, type CrackMove, type CrackSeatView, type CrackState } from "./crack.ts";
export { MARKET, MARKET_DEFAULTS, SIDES, fix, market, marketSeatView, readMarketConfig, type Bar, type MarketConfig, type MarketMove, type MarketSeatView, type MarketState, type Side } from "./market.ts";
export { pickSegment, type Segment } from "./segment.ts";
export { CODE, CODE_DEFAULTS, CODE_TOOLS, codeRules, codeWinner, suiteHash, type CodeSandbox, type CodeTask } from "./code.ts";
export {
  DUEL_FORMATS,
  DUEL_GAMES,
  HARNESS_ID,
  MOVE_MS,
  costCapOf,
  duelRules,
  isDuelFormat,
  roundsOf,
  runDuel,
  settle,
  type AgentReply,
  type DuelAgent,
  type DuelFormat,
  type DuelRun,
  type RunInput,
  type SeatUsage,
  type SeatView,
  type Settlement,
} from "./harness.ts";
export { pairRefusal, rateGame, seatsOf, seriesPlan, seriesState, sideOf, type Contender, type PairRefusal, type SeriesPlan, type SeriesState } from "./pairing.ts";
export { HOUSE_AGENTS, HOUSE_FORMAT, houseAgent, isHouseAgent, type HouseAgent } from "./house.ts";
export { CRACK_SCHEMA, MARKET_SCHEMA, WHY_MAX, crackMessages, marketMessages, quote, readReply } from "./prompt.ts";
export { MOVE_TOKENS, modelAgent, type ModelAgentInput } from "./model-agent.ts";
export { moments, publicDuel, type Moment, type PublicDuel, type PublicRound } from "./spectate.ts";
