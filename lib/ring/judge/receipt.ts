/**
 * The receipt of a match (CITY-68): what was played, under which rules, by which judge, on which log — and the verdict
 * with its reason, the replayed result and the time. Anyone holding the rules, the log and the game checks a receipt
 * without trusting Ryntra: the hashes either match or they do not, and a replay verdict is played again.
 *
 *   Receipt = { format: "ryntra-ring-receipt/1", matchId, seat, contest, class, money, rulesHash, judge, logHash,
 *               verdict, reason, level, detail, result, seal, at, hash }
 *
 * `hash` is SHA-256 of the canonical JSON of every other field. `seal` is `verified` when code decided — a verified
 * contest that ended in PASS or FAIL — and `null` otherwise: a show, BLOCKED or NEEDS_REVIEW carries no seal.
 *
 * What a check proves: the receipt is whole, it names these rules and this log, and — with the game — the log played
 * again gives this verdict for this seat. It does not prove the harness recorded that log: that is the memo's job, the
 * receipt's hash written on chain by the pools module next to the log's hash.
 *
 * Pure: the time comes in, nothing is stored or sent.
 */

import { canonicalJson, hashOf, isHex32, isRecord, isWellFormed, sha256Hex } from "./hash.ts";
import { JUDGE_VERSION, type Judgement, type Level, type ReasonCode, type Verdict } from "./judge.ts";
import { memoOf } from "./memo.ts";
import { verifyLog, type GameResult, type ReplayGame } from "./replay.ts";
import { rulesHash as hashRules, type ContestClass, type Money, type Rules } from "./rules.ts";

export const RECEIPT_FORMAT = "ryntra-ring-receipt/1";

export type Receipt = {
  format: typeof RECEIPT_FORMAT;
  matchId: string;
  seat: number;
  /** The Ring format, e.g. `market-replay`. */
  contest: string;
  class: ContestClass;
  money: Money;
  rulesHash: string;
  judge: string;
  logHash: string | null;
  verdict: Verdict;
  reason: ReasonCode;
  level: Level;
  detail: string;
  /** The replayed result, winner included; `null` when there was no replay or it did not get that far. */
  result: GameResult | null;
  seal: "verified" | null;
  /** ISO 8601, UTC. */
  at: string;
  hash: string;
};

export type ReceiptInput = { matchId: string; seat: number; rules: Rules; judgement: Judgement; at: number };

/** The receipt of a verdict at a time (unix ms). */
export function makeReceipt({ matchId, seat, rules, judgement, at }: ReceiptInput): Receipt {
  const body: Omit<Receipt, "hash"> = {
    format: RECEIPT_FORMAT,
    matchId,
    seat,
    contest: rules.format,
    class: rules.class,
    money: rules.money,
    rulesHash: hashRules(rules),
    judge: JUDGE_VERSION,
    logHash: judgement.logHash,
    verdict: judgement.verdict,
    reason: judgement.reason,
    level: judgement.level,
    detail: judgement.detail,
    result: judgement.result ?? null,
    seal: rules.class === "verified" && (judgement.verdict === "PASS" || judgement.verdict === "FAIL") ? "verified" : null,
    at: new Date(at).toISOString(),
  };
  return { ...body, hash: hashOf(body) };
}

export type ReceiptIssue = "FORMAT" | "HASH" | "RULES" | "LOG" | "MATCH" | "VERDICT" | "SEAL" | "JUDGE";

export type ReceiptCheck = {
  rules?: Rules;
  /** The submission's bytes as handed in. */
  log?: string;
  /** The engine of a replay: with `rules` and `log`, a PASS or FAIL is played again. */
  game?: ReplayGame<unknown>;
};

/**
 * What does not hold in a receipt; empty when it checks out. With `rules`, their hash must be the receipt's; with
 * `log`, its hash must be the receipt's log hash and its match the receipt's match; with `rules`, `log` and `game` of a
 * replay, the log played again must give the receipt's verdict, reason and result for the receipt's seat. A WON or
 * NOT_WON must agree with the receipt's own result even with nothing to check against.
 */
export function checkReceipt(receipt: Receipt, against: ReceiptCheck = {}): ReceiptIssue[] {
  const issues: ReceiptIssue[] = [];
  if (receipt?.format !== RECEIPT_FORMAT || !isHex32(receipt.rulesHash) || !isHex32(receipt.hash)) return ["FORMAT"];
  const { hash, ...body } = receipt;
  if (!hashes(body, hash)) issues.push("HASH");
  if (receipt.judge !== JUDGE_VERSION) issues.push("JUDGE");
  const sealed = receipt.class === "verified" && (receipt.verdict === "PASS" || receipt.verdict === "FAIL");
  if ((receipt.seal === "verified") !== sealed) issues.push("SEAL");
  if (!agreesWithResult(receipt)) issues.push("VERDICT");
  if (against.rules && hashRules(against.rules) !== receipt.rulesHash) issues.push("RULES");

  const log = against.log;
  if (log !== undefined) {
    if (!isWellFormed(log) || sha256Hex(log) !== receipt.logHash) issues.push("LOG");
    const parsed = parse(log);
    if (isRecord(parsed) && parsed.matchId !== receipt.matchId) issues.push("MATCH");
    const { rules, game } = against;
    if (rules?.decider === "replay" && game && (receipt.verdict === "PASS" || receipt.verdict === "FAIL")) {
      const again = replayed(rules, parsed, game, receipt.seat);
      if (!again || again.verdict !== receipt.verdict || again.reason !== receipt.reason || canonicalJson(again.result) !== canonicalJson(receipt.result)) {
        if (!issues.includes("VERDICT")) issues.push("VERDICT");
      }
    }
  }
  return issues;
}

/** The memo line of a receipt, for the Memo program; throws when the receipt has no log hash. */
export function receiptMemo(receipt: Receipt): string {
  if (!receipt.logHash) throw new TypeError("a receipt without a log has no memo");
  return memoOf({ matchId: receipt.matchId, logHash: receipt.logHash, receiptHash: receipt.hash });
}

/** A replay's verdict names its own result: WON is the seat's win, NOT_WON is a decided match the seat did not win. */
function agreesWithResult(receipt: Receipt): boolean {
  const result = isRecord(receipt.result) ? receipt.result : null;
  if (receipt.reason === "WON") return receipt.verdict === "PASS" && result !== null && result.winner === receipt.seat;
  if (receipt.reason === "NOT_WON") return receipt.verdict === "FAIL" && result !== null && result.winner !== receipt.seat;
  return true;
}

/** The verdict a replay of this log gives this seat, as the judge decides it; `null` when it gives none. */
function replayed(rules: Rules, log: unknown, game: ReplayGame<unknown>, seat: number): { verdict: Verdict; reason: ReasonCode; result: GameResult } | null {
  if (!rules.game || game.id !== rules.game.id || game.version !== rules.game.version || !isRecord(log)) return null;
  try {
    if (canonicalJson(log.config ?? null) !== canonicalJson(rules.game.config)) return null;
    if (rules.limits.steps !== undefined && Array.isArray(log.entries) && log.entries.length > rules.limits.steps) return null;
    const verification = verifyLog(game, log);
    if (!verification.ok || !verification.result) return null;
    const { result } = verification;
    return result.winner === seat ? { verdict: "PASS", reason: "WON", result } : { verdict: "FAIL", reason: "NOT_WON", result };
  } catch {
    return null;
  }
}

function hashes(body: unknown, hash: string): boolean {
  try {
    return hashOf(body) === hash;
  } catch {
    return false;
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
