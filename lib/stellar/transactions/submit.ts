import { DEFAULT_LIMITS, fetchText, type ClientLimits } from "../client.ts";
import { stellarSourceRef, type StellarNetwork } from "../network.ts";
import type { ClearedTransaction } from "./fingerprint.ts";

/**
 * The write boundary — the one place a transaction may reach a network.
 *
 * It is a separate module from `client.ts` on purpose, and the separation is
 * the design rather than tidiness. `client.ts` is the read adapter: it holds a
 * method allowlist, refuses `sendTransaction` by name, and every page in this
 * product reads through it. Adding submission there would have deleted that
 * property for the sake of one screen.
 *
 * Three rules hold here, and each closes a specific way this goes wrong.
 *
 * **1. Only a cleared transaction can be submitted, and it is cleared by type.**
 * The argument is `ClearedTransaction` — the `allowed: true` branch of the
 * verdict — which carries the exact bytes that were compared against what a
 * person authorized. There is no signature for submitting an XDR alongside a
 * boolean, so bytes that skipped the gate have no way in.
 *
 * **2. The signed transaction never reaches a Ryntra server.** This runs where
 * the wallet is, and posts to the public Stellar endpoint directly. What Ryntra
 * can honestly claim is therefore narrow and checkable: it holds no key, signs
 * nothing, and never relays a signed transaction. It is not the broader claim
 * that no software written by Ryntra ever calls submit — that claim would be
 * false the moment this file exists, and a boundary stated wrongly is worse
 * than one stated modestly.
 *
 * **3. A submission whose answer never arrives is `UNKNOWN`, never "failed".**
 * A timed-out POST may already have been broadcast. Reporting that as a failure
 * invites a second submission of the same intent, so the outcome says exactly
 * what is known — nothing — and carries the transaction hash, which was
 * computed from the signed bytes before any of this started.
 *
 * Live-verification note, 2026-08-13: `getTransaction` was probed against
 * `soroban-testnet.stellar.org` for a real classic payment and for an absent
 * hash, and the shapes below are what it returned. `sendTransaction` was probed
 * only with malformed input, which returned the JSON-RPC error path. Its
 * `PENDING` and `ERROR` result shapes are implemented from the documented
 * contract and are **not** live-verified; the first owner-signed run is what
 * verifies them.
 */

export type SubmissionOutcome =
  /** The network accepted it for inclusion. Not yet a ledger fact. */
  | Readonly<{ kind: "SUBMITTED"; transactionHash: string; acceptedAt: string; sourceRef: string; note?: string }>
  /** The network refused it outright. It is not on any ledger and will not be. */
  | Readonly<{ kind: "REJECTED"; transactionHash: string; reason: string; code: string; sourceRef: string }>
  /**
   * We do not know. It may or may not have been broadcast.
   *
   * Deliberately not merged into `REJECTED`: the two demand opposite next
   * actions, and guessing costs either a duplicate payment or a lost one.
   */
  | Readonly<{ kind: "UNKNOWN"; transactionHash: string; reason: string; sourceRef: string }>;

export type SubmitOptions = Readonly<{
  limits?: ClientLimits;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => Date;
}>;

type RpcAnswer = Readonly<{ ok: true; result: Record<string, unknown> } | { ok: false; reason: string }>;

async function rpcCall(
  network: StellarNetwork,
  method: "sendTransaction" | "getTransaction",
  params: unknown,
  options: SubmitOptions,
): Promise<RpcAnswer> {
  const body = await fetchText(
    network.rpcUrl,
    {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      headers: { "content-type": "application/json" },
    },
    options.limits ?? DEFAULT_LIMITS,
    options.fetchImpl ?? globalThis.fetch,
  );
  if (!body.ok) return { ok: false, reason: body.reason };

  let payload: { result?: unknown; error?: { message?: string; code?: number } };
  try {
    payload = JSON.parse(body.value) as typeof payload;
  } catch {
    return { ok: false, reason: `${method} answered with a body that is not JSON.` };
  }
  if (payload?.error) {
    return { ok: false, reason: `${method} returned an RPC error: ${payload.error.message ?? "unspecified"}.` };
  }
  if (!payload || typeof payload.result !== "object" || payload.result === null) {
    return { ok: false, reason: `${method} returned no result object.` };
  }
  return { ok: true, result: payload.result as Record<string, unknown> };
}

/**
 * Submit exactly the bytes that cleared the gate.
 *
 * The hash is taken from the cleared transaction rather than from the network's
 * answer. A submission is identified by what was signed, not by what a server
 * chose to echo back, and an endpoint returning a different hash is a mismatch
 * to report rather than a value to adopt.
 */
export async function submitCleared(
  network: StellarNetwork,
  cleared: ClearedTransaction,
  options: SubmitOptions = {},
): Promise<SubmissionOutcome> {
  const sourceRef = stellarSourceRef(network, "rpc", "sendTransaction");
  const at = () => (options.now?.() ?? new Date()).toISOString();

  if (cleared.fingerprint.networkPassphrase !== network.passphrase) {
    /* Belt and braces over the signature check that already happened: the
       verdict proved the signature is valid for the authorized network, and
       this proves the endpoint being posted to is that same network. Different
       failures, one line apart, and neither implies the other. */
    return {
      kind: "REJECTED",
      transactionHash: cleared.transactionHash,
      code: "NETWORK_MISMATCH",
      reason: `This transaction was authorized for "${cleared.fingerprint.networkPassphrase}" and would have been submitted to ${network.label}.`,
      sourceRef,
    };
  }

  const answer = await rpcCall(network, "sendTransaction", { transaction: cleared.signedXdr }, options);
  if (!answer.ok) {
    return {
      kind: "UNKNOWN",
      transactionHash: cleared.transactionHash,
      reason: `${answer.reason} The transaction may or may not have been broadcast; look the hash up before signing anything again.`,
      sourceRef,
    };
  }

  const status = String(answer.result.status ?? "");
  const errorResultXdr = typeof answer.result.errorResultXdr === "string" ? answer.result.errorResultXdr : null;

  switch (status) {
    case "PENDING":
      return { kind: "SUBMITTED", transactionHash: cleared.transactionHash, acceptedAt: at(), sourceRef };
    case "DUPLICATE":
      /* Already submitted. That is success for this intent, not a failure —
         the ledger will hold exactly one of it either way. */
      return {
        kind: "SUBMITTED",
        transactionHash: cleared.transactionHash,
        acceptedAt: at(),
        sourceRef,
        note: "This transaction had already been submitted. A duplicate is not a second payment.",
      };
    case "TRY_AGAIN_LATER":
      return {
        kind: "UNKNOWN",
        transactionHash: cleared.transactionHash,
        reason: "The endpoint asked to be tried again later, so it neither accepted nor refused this transaction.",
        sourceRef,
      };
    case "ERROR":
      return {
        kind: "REJECTED",
        transactionHash: cleared.transactionHash,
        code: "SUBMISSION_ERROR",
        reason: errorResultXdr
          ? `The network refused this transaction. Its result XDR is ${errorResultXdr}.`
          : "The network refused this transaction and returned no result detail.",
        sourceRef,
      };
    default:
      return {
        kind: "UNKNOWN",
        transactionHash: cleared.transactionHash,
        reason: `The endpoint answered with an unrecognised status "${status || "(none)"}".`,
        sourceRef,
      };
  }
}

/** Where a transaction ended up, once a ledger has one. */
export type LedgerInclusion = Readonly<{
  transactionHash: string;
  status: "SUCCESS" | "FAILED";
  ledger: number;
  closedAt: string;
  sourceRef: string;
}>;

export type InclusionResult =
  | Readonly<{ kind: "INCLUDED"; inclusion: LedgerInclusion }>
  /** Still not on a ledger when we stopped asking. Not a failure. */
  | Readonly<{ kind: "PENDING"; transactionHash: string; reason: string; waitedSeconds: number }>
  | Readonly<{ kind: "UNKNOWN"; transactionHash: string; reason: string }>;

export type AwaitOptions = SubmitOptions &
  Readonly<{
    /** How long to keep asking. Testnet ledgers close in about five seconds. */
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }>;

/**
 * Wait for a ledger to hold it.
 *
 * `NOT_FOUND` is the subtle one. The endpoint returns it with HTTP 200 both for
 * a transaction that has not been included yet and for one that fell outside
 * its retention window — the probe measured that window at roughly seven days
 * of ledgers on testnet. While we are still inside our own deadline the honest
 * reading is "not yet"; after it, the honest answer is that we stopped asking,
 * not that nothing happened.
 */
export async function awaitInclusion(
  network: StellarNetwork,
  transactionHash: string,
  options: AwaitOptions = {},
): Promise<InclusionResult> {
  const sourceRef = stellarSourceRef(network, "rpc", `getTransaction/${transactionHash}`);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const startedAt = Date.now();

  let lastReason = "The endpoint was never reached.";
  for (let attempt = 0; ; attempt += 1) {
    const answer = await rpcCall(network, "getTransaction", { hash: transactionHash }, options);
    if (answer.ok) {
      const status = String(answer.result.status ?? "");
      if (status === "SUCCESS" || status === "FAILED") {
        const ledger = Number(answer.result.ledger);
        /* `createdAt` is unix seconds as a string — measured, not assumed. A
           value that is not a number becomes an unknown close time rather than
           an `Invalid Date` rendered as a timestamp. */
        const seconds = Number(answer.result.createdAt);
        if (!Number.isFinite(ledger) || !Number.isFinite(seconds)) {
          return {
            kind: "UNKNOWN",
            transactionHash,
            reason: `The transaction was found with status ${status}, but its ledger or close time was unreadable.`,
          };
        }
        return {
          kind: "INCLUDED",
          inclusion: {
            transactionHash,
            status,
            ledger,
            closedAt: new Date(seconds * 1000).toISOString(),
            sourceRef,
          },
        };
      }
      lastReason =
        status === "NOT_FOUND"
          ? "No ledger holds this transaction yet, and the endpoint reports the same status for one it no longer retains."
          : `The endpoint answered with an unrecognised status "${status || "(none)"}".`;
    } else {
      lastReason = answer.reason;
    }

    const waited = Date.now() - startedAt;
    if (waited + intervalMs >= timeoutMs) {
      return {
        kind: "PENDING",
        transactionHash,
        reason: `${lastReason} Asked ${attempt + 1} time(s) over ${Math.round(waited / 1000)}s.`,
        waitedSeconds: Math.round(waited / 1000),
      };
    }
    await sleep(intervalMs);
  }
}
