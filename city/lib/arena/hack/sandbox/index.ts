/**
 * The Hack sandbox (CITY-224), in one import: the pin of a copy, the limits of a run, the wall against the network, the
 * engine a run drives, the run as a game the judge replays, and the sandbox that runs, replays and proves. The made-up
 * engine of the tests (`toy.ts`) is imported on its own. See `README.md`.
 */

export {
  SNAPSHOT_FORMAT,
  PIN_FORMAT,
  SNAPSHOT_MAX,
  isU64,
  fromBase64,
  toBase64,
  accountsHash,
  snapshotAccounts,
  checkSnapshot,
  pinOf,
  pinHash,
  checkPin,
  snapshotMatches,
  type Snapshot,
  type SnapshotAccount,
  type SnapshotProgram,
  type ForkPin,
  type EngineRef,
  type AccountState,
  type PinIssue,
} from "./pin.ts";

export { LIMIT_CAPS, DEFAULT_LIMITS, limitsOf, checkLimits, type SandboxLimits, type LimitIssue } from "./limits.ts";

export { NetworkRefused, offline, isOffline } from "./offline.ts";

export type { ForkEngine, EngineFactory, ExecResult } from "./engine.ts";

export {
  HACK_GAME,
  TX_MAX_BYTES,
  WARP_MAX_SLOTS,
  ACTORS_MAX,
  ACTOR_LAMPORTS,
  checkConfig,
  parseInput,
  createHackGame,
  type Invariant,
  type HackClaim,
  type HackConfig,
  type HackInput,
  type HackDerived,
  type HackResult,
  type HackGameDeps,
  type HackState,
  type LastStep,
  type ParsedInput,
} from "./game.ts";

export {
  HACK_FORMAT,
  ATTACKER_SEAT,
  createHackSandbox,
  type HackAttempt,
  type HackRun,
  type HackSandbox,
  type HackSandboxDeps,
  type ProveContext,
  type ReplayCheck,
  type SandboxRefusal,
  type Stop,
} from "./sandbox.ts";
