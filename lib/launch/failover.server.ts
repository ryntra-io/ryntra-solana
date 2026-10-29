/**
 * The executor's reads with a second node behind them (SOL-L6): a read the main node does not answer — refused, rate
 * limited, timed out — is asked of the second node at once; after two failures in a row the main node rests a minute
 * and the reads go to the second first, then the main node is tried again. Only reads: a send goes where its caller
 * sends it, and a read's *answer* (an account not found) is an answer, not a failure.
 *
 * The connection handed out is the main node's own `Connection` behind a proxy, so the SDKs of Meteora read through it
 * as they are. Every read is counted for the pass — the operator hears of a main node that stopped answering most reads,
 * or of a read neither node answered (`lib/core/launch/engine.ts`). A node's standing refusal of a kind of read (the
 * public operator's «Indexed requests require a personal token») is counted apart: that node is not down, it never
 * answers that read, and the second answers it every pass (SOL-C9).
 */

import { Connection } from "@solana/web3.js";

/** The `Connection` methods that only read: these alone fail over. */
export const FAILOVER_READS: ReadonlySet<string> = new Set([
  "getAccountInfo",
  "getAccountInfoAndContext",
  "getMultipleAccountsInfo",
  "getMultipleAccountsInfoAndContext",
  "getMultipleParsedAccounts",
  "getParsedAccountInfo",
  "getBalance",
  "getBalanceAndContext",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getParsedTokenAccountsByOwner",
  "getProgramAccounts",
  "getParsedProgramAccounts",
  "getTransaction",
  "getParsedTransaction",
  "getSignatureStatus",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getLatestBlockhash",
  "getLatestBlockhashAndContext",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "getRecentPrioritizationFees",
  "getTokenSupply",
  "getTokenLargestAccounts",
]);

/** Failures of the main node in a row after which it rests. */
export const FAILOVER_TRIP = 2;
/** How long the main node rests before it is tried first again. */
export const FAILOVER_REST_MS = 60_000;
/** A node that says «too many requests» is asked again after a short wait — this many times, the wait growing — before the read moves on. */
export const RATE_RETRIES = 2;
export const RATE_WAIT_MS = 400;

/** Whether a node's failure is its standing refusal of a kind of read — a personal token wanted — not a node that is down. */
export function standingRefusal(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /personal token/i.test(text);
}

/** Whether a node's failure is its rate limit: worth a short wait on the same node, not a node that is down. */
export function rateLimited(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /\b429\b|too many requests|rate limit/i.test(text);
}

export type FailoverHealth = Readonly<{
  /** Reads asked of the connection. */
  reads: number;
  /** Reads the main node failed. */
  mainFailures: number;
  /** Of those, its standing refusals (`standingRefusal`). */
  mainRefused: number;
  /**
   * Reads the main node did not answer for being down — failed for another reason than a standing refusal, or sent to
   * the second while the main node rested after such failures.
   */
  mainDown: number;
  /** Reads the second node answered for the main one. */
  secondReads: number;
  /** Reads no node answered — neither of the two, or the main one alone when there is no second (its refusals aside). */
  bothFailed: number;
  /** Whether the main node rests now. */
  resting: boolean;
}>;

export type Failover = Readonly<{
  connection: Connection;
  health(): FailoverHealth;
  /** Counts start again — once a pass. */
  reset(): void;
}>;

/**
 * A connection whose reads fail over from `main` to `second`. With no second node the main one is returned as it is,
 * counted all the same.
 */
export function failoverConnection(
  main: Connection,
  second: Connection | null,
  clock: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Failover {
  let inRow = 0;
  let restUntil = 0;
  /* Failures in a row that are not a standing refusal, and whether the rest began on enough of them to trip it alone. */
  let downInRow = 0;
  let restDown = false;
  let reads = 0;
  let mainFailures = 0;
  let mainRefused = 0;
  let mainDown = 0;
  let secondReads = 0;
  let bothFailed = 0;
  const once = (target: Connection, name: string, args: unknown[]) => (target as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!.apply(target, args);
  /* A node at its rate limit is given a moment: the same read again after a short, growing wait. */
  const call = async (target: Connection, name: string, args: unknown[]): Promise<unknown> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await once(target, name, args);
      } catch (error) {
        if (attempt >= RATE_RETRIES || !rateLimited(error)) throw error;
        await wait(RATE_WAIT_MS * (attempt + 1));
      }
    }
  };

  /* A failure of the main node, counted by its kind. */
  const mainFailed = (error: unknown) => {
    mainFailures += 1;
    if (standingRefusal(error)) mainRefused += 1;
    else mainDown += 1;
  };

  async function read(name: string, args: unknown[]): Promise<unknown> {
    reads += 1;
    const mainFirst = !second || clock() >= restUntil;
    if (mainFirst) {
      try {
        const answer = await call(main, name, args);
        inRow = 0;
        downInRow = 0;
        return answer;
      } catch (error) {
        mainFailed(error);
        inRow += 1;
        if (!standingRefusal(error)) downInRow += 1;
        if (inRow >= FAILOVER_TRIP) {
          restUntil = clock() + FAILOVER_REST_MS;
          restDown = downInRow >= FAILOVER_TRIP;
        }
        if (!second) {
          /* No second node: a read the main node did not answer for being down reached none. */
          if (!standingRefusal(error)) bothFailed += 1;
          throw error;
        }
        try {
          const answer = await call(second, name, args);
          secondReads += 1;
          return answer;
        } catch (secondError) {
          bothFailed += 1;
          throw secondError;
        }
      }
    }
    /* The main node rests: the second answers first, the main one if the second does not. */
    try {
      const answer = await call(second!, name, args);
      secondReads += 1;
      if (restDown) mainDown += 1;
      return answer;
    } catch {
      try {
        const answer = await call(main, name, args);
        inRow = 0;
        downInRow = 0;
        restUntil = 0;
        return answer;
      } catch (error) {
        bothFailed += 1;
        mainFailed(error);
        throw error;
      }
    }
  }

  const connection = new Proxy(main, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function" || !FAILOVER_READS.has(property)) return typeof value === "function" ? value.bind(target) : value;
      return (...args: unknown[]) => read(property, args);
    },
  });

  return {
    connection,
    health: () => ({ reads, mainFailures, mainRefused, mainDown, secondReads, bothFailed, resting: second !== null && clock() < restUntil }),
    reset: () => {
      reads = 0;
      mainFailures = 0;
      mainRefused = 0;
      mainDown = 0;
      secondReads = 0;
      bothFailed = 0;
    },
  };
}

/** A node's `Connection` for the executor: its own, no silent waits on a rate limit, every request cut off after `timeoutMs`. */
export function executorConnection(url: string, timeoutMs = 10_000): Connection {
  return new Connection(url, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });
}
