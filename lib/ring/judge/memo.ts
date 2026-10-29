/**
 * The memo a match leaves on Solana (CITY-68): one short ASCII line with the log's hash and the receipt's hash, ready
 * for the Memo program. Building it is all this file does — writing it to a chain belongs to the pools program
 * (CITY-46, CITY-52), and on mainnet it moves real money.
 *
 *   ryntra-ring/1|<matchId>|<logHash>|<receiptHash>      at most 256 bytes
 */

import { isHex32 } from "./hash.ts";

export const MEMO_PREFIX = "ryntra-ring/1";
export const MEMO_MAX_BYTES = 256;

/** A match id: 1–64 characters of A-Z a-z 0-9 . _ : - — never `|`, which separates the fields of a memo and a stamp. */
export const MATCH_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export type MemoFields = { matchId: string; logHash: string; receiptHash: string };

/** The memo line; throws for a field that does not fit. */
export function memoOf({ matchId, logHash, receiptHash }: MemoFields): string {
  if (!MATCH_ID.test(matchId)) throw new TypeError("matchId: 1-64 characters of A-Z a-z 0-9 . _ : -");
  if (!isHex32(logHash) || !isHex32(receiptHash)) throw new TypeError("hashes are 64 lowercase hex characters");
  const memo = `${MEMO_PREFIX}|${matchId}|${logHash}|${receiptHash}`;
  if (Buffer.byteLength(memo, "utf8") > MEMO_MAX_BYTES) throw new TypeError("memo is too long");
  return memo;
}

/** The fields of a memo line, or `null` when it is not one. */
export function parseMemo(memo: string): MemoFields | null {
  const parts = memo.split("|");
  if (parts.length !== 4 || parts[0] !== MEMO_PREFIX) return null;
  const [, matchId, logHash, receiptHash] = parts as [string, string, string, string];
  if (!MATCH_ID.test(matchId) || !isHex32(logHash) || !isHex32(receiptHash)) return null;
  return { matchId, logHash, receiptHash };
}
