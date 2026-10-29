/**
 * Ring · Dice (CITY-69): two agents play Liar's Dice through tool calls; the dice come from both agents' committed
 * seeds and a public drand round (`hostedAgent` keeps the seed for a model); a timeout, an illegal move or a forged
 * reveal loses; a beacon that never comes voids the match; spectators see the dice only after a challenge; a finished log replays to the same result; brackets keep one owner's agents apart. A library with
 * no UI and no money — the description is in `README.md`.
 */

export {
  RULES,
  SEATS,
  checkBid,
  compareBids,
  countFace,
  nextBid,
  other,
  settleChallenge,
  type Bid,
  type BidProblem,
  type ChallengeOutcome,
  type Seat,
} from "./rules";
export {
  DRAND_QUICKNET,
  MOCK_BEACON_INFO,
  checkBeaconRound,
  createMockBeacon,
  latestRound,
  mockBeaconRound,
  roundTime,
  type Beacon,
  type BeaconInfo,
  type BeaconRound,
} from "./beacon";
export { HashRng, combineSeeds, commitmentFor, drawOpener, randomSeed, rollHands } from "./randomness";
export { HEX32, canonicalJson, sha256Hex } from "./hash";
export {
  LOG_FORMAT,
  MatchConfigSchema,
  MatchEventSchema,
  MatchLogSchema,
  MoveCall,
  PLAY_TOOLS,
  TOOLS,
  type Limits,
  type MatchConfig,
  type ToolDefinition,
  type ToolName,
} from "./schema";
export {
  DEFAULT_BEACON_DELAY_ROUNDS,
  DEFAULT_LIMITS,
  DiceError,
  DiceMatch,
  defineMatch,
  isInput,
  type AgentView,
  type Applied,
  type BeaconEvent,
  type BidEntry,
  type DerivedEntry,
  type EndReason,
  type Fault,
  type FaultCode,
  type LogEntry,
  type MatchEvent,
  type MatchLog,
  type MatchResult,
  type MatchSetup,
  type MoveEvent,
  type Phase,
  type PublicEntry,
  type PublicView,
  type Showdown,
  type TickEvent,
} from "./match";
export { createManualClock, runMatch, systemClock, type Clock, type DiceAgent, type ManualClock, type RunOutcome } from "./driver";
export { firstDifference, logDigest, replay, verify, type Difference, type Divergence, type Replay, type RoundRoll, type Verification } from "./replay";
export {
  champion,
  createBracket,
  isFinished,
  matchConfigFor,
  pairing,
  ratingRecord,
  ratingRecords,
  readyMatches,
  recordResult,
  seedOrder,
  type Bracket,
  type BracketMatch,
  type Entrant,
  type RatingRecord,
  type Slot,
} from "./tournament";
export { hostedAgent, type ModelPlayer } from "./hosted";
export { RECEIPT_FORMAT, configDigest, diceReceipt, isDrandQuicknet, type DiceReceipt, type DiceVerdict, type ReceiptOptions } from "./receipt";
