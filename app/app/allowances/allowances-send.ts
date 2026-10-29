/**
 * The spending limits' calls from the page (SOL-7) and what a send's answer means: the routes' answers read as one
 * shape; the submit's failures that are final told from those that leave it not known whether the bytes reached the
 * chain; and the read of a sent build until the chain's word is final. No React here: the tests read the same rules.
 */

import type { AllowanceSendStatus } from "../../../lib/solana/allowances/contract.ts";
import type { AllowanceIssue } from "../../../lib/solana/allowances/model.ts";

export type Answer<T> = { ok: true; data: T } | { ok: false; code: string; message: string; issues?: readonly AllowanceIssue[] };

export async function allowanceApi<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string; issues?: AllowanceIssue[] } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "", ...(body?.error?.issues ? { issues: body.error.issues } : {}) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

/** After a PENDING or a lost answer: the chain is read again until its word is final, or until the bound passes. */
export type Follow = "none" | "watching" | "timeout" | "failed" | "notLanded";

/**
 * The submit's refusals that come before anything is sent, or that are final («not done»): every other answer of the
 * submit — a lost connection, a page that is not JSON, a server that could not answer — leaves it not known whether the
 * bytes reached the chain, and is said so, never as «nothing was sent».
 */
export const SUBMIT_FINAL: ReadonlySet<string> = new Set([
  "ALLOWANCE_BUILD_NOT_FOUND",
  "WALLET_MISMATCH",
  "ALLOWANCE_BUILD_EXPIRED",
  "ALLOWANCE_SIGNED_OTHER_BYTES",
  "ALLOWANCE_BUILD_USED",
  "ALLOWANCE_SUBMIT_FAILED",
  "ALLOWANCE_NOT_LANDED",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "ALLOWANCES_UNAVAILABLE",
]);

export type Failure = Readonly<{ code: string; message: string; issues?: readonly AllowanceIssue[] }>;

/** The submit's failure as the page says it: the server's own when it is final, «not known whether sent» otherwise. */
export function submitFailure(failure: Failure): Failure {
  return SUBMIT_FINAL.has(failure.code) ? failure : { code: "ALLOWANCE_SEND_UNKNOWN", message: "" };
}

/** How long and how often a sent build is read again: past its blockhash and the submit's own budget, with a margin. */
export const FOLLOW_MS = 150_000;

/** After these the build's own word is read until final: a lost answer, or a second submit of one already sent. */
export const followsAfter = (code: string) => code === "ALLOWANCE_SEND_UNKNOWN" || code === "ALLOWANCE_BUILD_USED";
export const FOLLOW_EVERY_MS = 5_000;

/**
 * Reads a sent build's word from the chain until it is final: CONFIRMED, FAILED or NOT_LANDED; PENDING and failed
 * reads are read again. Null — the bound passed (or `stopped` said so) with no final word.
 */
export async function followSent(
  where: Readonly<{ build: string; wallet: string }>,
  options: Readonly<{
    read?: (path: string) => Promise<Answer<AllowanceSendStatus>>;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    stopped?: () => boolean;
    boundMs?: number;
    everyMs?: number;
  }> = {},
): Promise<AllowanceSendStatus | null> {
  const read = options.read ?? ((path: string) => allowanceApi<AllowanceSendStatus>(path));
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const until = now() + (options.boundMs ?? FOLLOW_MS);
  const path = `/api/solana/allowances/submit?build=${encodeURIComponent(where.build)}&wallet=${encodeURIComponent(where.wallet)}`;
  while (now() < until) {
    await wait(options.everyMs ?? FOLLOW_EVERY_MS);
    if (options.stopped?.()) return null;
    const answer = await read(path);
    if (options.stopped?.()) return null;
    /* A build the server no longer has, or another wallet's: nothing more can be read — the bound's word stands. */
    if (!answer.ok && (answer.code === "ALLOWANCE_BUILD_NOT_FOUND" || answer.code === "WALLET_MISMATCH")) return null;
    if (answer.ok && answer.data.state !== "PENDING") return answer.data;
  }
  return null;
}
