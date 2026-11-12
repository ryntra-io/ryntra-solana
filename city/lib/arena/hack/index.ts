/**
 * Hack — the Arena's third door (CITY-223): the library behind it, in one import. A protocol brings its own contract
 * and signs a permission; agents break a **copy** of it in a fork (the sandbox is CITY-224); the judge (CITY-68) says
 * whether the fault reproduced; these rules say what counts, what is a duplicate, how severe, and who was first.
 *
 * No network, no database, no money live here. The storage is an interface (`HackStore`) a database fills in CITY-226;
 * the sandbox and the step runner are CITY-224/225; the windows are CITY-227; the money is CITY-229. See `README.md`.
 */

export {
  ADDRESS,
  NAME,
  isAddress,
  isName,
  isFindingTarget,
  checkTarget,
  checkScope,
  inScope,
  targetProgram,
  type TargetRef,
  type Scope,
  type FindingTarget,
  type ScopeIssue,
} from "./scope.ts";

export {
  ORDER_FORMAT,
  ORDER_STATUSES,
  ORDER_MOVES,
  ORDER_TRANSITIONS,
  OrderMoveRejected,
  checkOrder,
  isOrderId,
  nextStatus,
  canMove,
  moveOrder,
  takesFindingAt,
  orderHash,
  type Order,
  type OrderStatus,
  type OrderMove,
  type RewardRef,
  type OrderIssue,
} from "./order.ts";

export {
  GRANT_FORMAT,
  grantText,
  isGrantBody,
  checkGrant,
  scopeHash,
  type GrantBody,
  type GrantSignature,
  type PermissionGrant,
  type PermissionVerifier,
  type GrantIssue,
} from "./permission.ts";

export {
  FINDING_FORMAT,
  SEVERITIES,
  FINDING_STATUSES,
  severityRank,
  isSeverity,
  isFindingId,
  checkFinding,
  dedupeKey,
  withStatus,
  type Severity,
  type FindingStatus,
  type Finding,
  type FindingIssue,
} from "./finding.ts";

export {
  HACK_OUTCOMES,
  MIN_REWARDED,
  assessFinding,
  type HackOutcome,
  type HackReason,
  type HackProof,
  type Assessment,
  type AssessInput,
} from "./rules.ts";

export {
  createMemoryHackStore,
  createHackRegistry,
  type HackStore,
  type StoredOrder,
  type HackRegistry,
  type OpenResult,
  type SubmitResult,
  type MoveResult,
} from "./registry.ts";

export { HACK } from "./words.ts";
