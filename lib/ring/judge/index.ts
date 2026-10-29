/** The Ring's judge and match receipt (CITY-68): the public face of `lib/ring/judge`. See `README.md`. */

export { canonicalJson, firstDifference, hashOf, isWellFormed, sha256Hex, HEX32, type Difference } from "./hash.ts";
export {
  checkRules,
  classOf,
  rulesHash,
  CONTEST_CLASSES,
  MAX_SUBMISSION_BYTES,
  DECIDERS,
  MONEY,
  RING_FORMATS,
  SHOW_MONEY,
  type ContestClass,
  type Decider,
  type Limits,
  type Money,
  type RuleIssue,
  type Rules,
} from "./rules.ts";
export { createStamper, signerOf, stampVerifier, stampText, type Stamp, type Stamped, type Stamper, type StampVerifier } from "./stamp.ts";
export {
  logHash,
  recordLog,
  verifyLog,
  MoveRejected,
  LOG_FORMAT,
  type Divergence,
  type GameResult,
  type Input,
  type LogEntry,
  type MatchLog,
  type ReplayGame,
  type Verification,
} from "./replay.ts";
export {
  judge,
  JUDGE_VERSION,
  DETAIL_MAX,
  UNCLEAR_REASONS,
  VERDICTS,
  type Claim,
  type JudgeContext,
  type JudgeInput,
  type Judgement,
  type Level,
  type ModelScore,
  type PriorVerdict,
  type ReasonCode,
  type Submission,
  type TestRun,
  type Usage,
  type Verdict,
} from "./judge.ts";
export { checkReceipt, makeReceipt, receiptMemo, RECEIPT_FORMAT, type Receipt, type ReceiptCheck, type ReceiptIssue } from "./receipt.ts";
export { memoOf, parseMemo, MATCH_ID, MEMO_MAX_BYTES, MEMO_PREFIX, type MemoFields } from "./memo.ts";
