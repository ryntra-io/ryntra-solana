/**
 * The autopay book in the database: one call to one `public.autopay_*` function per question, each gated by
 * the app secret and each one transaction (`supabase/migrations/20261121090000_contacts_autopay_v1.sql`). The tables
 * live in the `private` schema with every grant revoked; the server never holds the service key. The transport is the
 * server's usual one (`rpcResult`, which adds the secret); a test passes its own.
 *
 * The rules the database keeps for the executor:
 * - the queue — only the autopays whose moment has come (`next_at`, kept from each autopay's own numbers), the earliest
 *   first; a batch taken is held from an overlapping pass;
 * - a window's payment is claimed before it is built — a row keyed by the autopay and the window, so two executors (two
 *   cron calls that overlap, a retry) never pay the same window twice; each claim is an attempt, and only the latest
 *   attempt may write its signature, which is written before the payment leaves;
 * - a claim that never got a signature lapses and its window may be claimed again; a signature the chain never saw goes
 *   back only by that signature, once its blockhash is past.
 * Until the migration is applied a function that is not there is a store that did not answer.
 */

import { eventOf, type AutopayEvent } from "./events.ts";
import type { AutopayNetwork } from "./policy.ts";
import { recordOf, type AutopayRecord, type PaymentState } from "./record.ts";

export type AutopayRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

/** The server's usual transport, loaded on first use (it reads the deployment's database settings). */
export const autopayRpc: AutopayRpc = async (fn, args) => (await import("../supabase-rpc.ts")).rpcResult("autopay", fn, args);

export class AutopayUnavailable extends Error {
  constructor(reason: string) {
    super(`The autopay store did not answer: ${reason}.`);
    this.name = "AutopayUnavailable";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export type AutopayStore = Readonly<{
  /** A new autopay, once the person's transactions landed and the chain carries its policy. */
  put(record: AutopayRecord): Promise<"stored" | "exists">;
  /** The wallet's autopays on the network, the newest first, each with its windows. */
  list(network: AutopayNetwork, owner: string): Promise<readonly AutopayRecord[]>;
  /** One autopay of the wallet; null — none. */
  one(network: AutopayNetwork, owner: string, id: string): Promise<AutopayRecord | null>;
  /** The executor's batch: the autopays whose moment has come, the earliest first, each held `holdSeconds` from another pass. */
  due(network: AutopayNetwork, limit: number, holdSeconds: number): Promise<readonly AutopayRecord[]>;
  /** Claim a window's payment for `holdSeconds`: the attempt that may sign it, or null — it is someone else's or done. */
  claim(network: AutopayNetwork, id: string, window: number, holdSeconds: number): Promise<number | null>;
  /** Write the claim's signature before sending: false — the attempt no longer holds the window (do not send). */
  sign(network: AutopayNetwork, id: string, window: number, attempt: number, signature: string, validHeight: number): Promise<boolean>;
  /**
   * Give a window back: an unsigned claim by its attempt, or a signature the chain never saw by that signature. The window
   * may be claimed again after `retrySeconds`, or is missed when it has closed.
   */
  release(network: AutopayNetwork, id: string, window: number, by: Readonly<{ attempt: number } | { signature: string }>, retrySeconds: number): Promise<"sending" | "missed" | null>;
  /**
   * What became of a window's payment; each change is also an event for the drive. Paid or failed — by its signature (or,
   * unsigned, by its attempt); missed — a closed window. False — nothing changed.
   */
  settle(network: AutopayNetwork, id: string, window: number, state: Exclude<PaymentState, "sending">, by: Readonly<{ signature: string } | { attempt: number } | null>): Promise<boolean>;
  /** The autopay stopped by its owner or ended by its schedule; also an event. `owner` — only that wallet's. */
  status(network: AutopayNetwork, id: string, status: "stopped" | "ended", owner: string | null): Promise<boolean>;
  /** The event log after `afterId`, oldest first, at most `limit`. */
  events(network: AutopayNetwork, afterId: number, limit: number): Promise<readonly AutopayEvent[]>;
}>;

export function autopayStore(rpc: AutopayRpc = autopayRpc): AutopayStore {
  const call = async (fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new AutopayUnavailable(answer.error);
    if (!isRecord(answer.data) || answer.data.ok !== true) throw new AutopayUnavailable(`${fn}: ${isRecord(answer.data) && typeof answer.data.error === "string" ? answer.data.error : "unreadable answer"}`);
    return answer.data;
  };
  const records = (data: Record<string, unknown>, fn: string): readonly AutopayRecord[] => {
    if (!Array.isArray(data.autopays)) throw new AutopayUnavailable(`${fn}: no list`);
    return data.autopays.map(recordOf).filter((record): record is AutopayRecord => record !== null);
  };
  return {
    async put(record) {
      const data = await call("autopay_put", { p_network: record.network, p_record: record });
      return data.exists === true ? "exists" : "stored";
    },
    async list(network, owner) {
      return records(await call("autopay_list", { p_network: network, p_owner: owner }), "autopay_list");
    },
    async one(network, owner, id) {
      const data = await call("autopay_one", { p_network: network, p_owner: owner, p_id: id });
      return data.autopay ? recordOf(data.autopay) : null;
    },
    async due(network, limit, holdSeconds) {
      return records(await call("autopay_due", { p_network: network, p_limit: limit, p_hold: holdSeconds }), "autopay_due");
    },
    async claim(network, id, window, holdSeconds) {
      const data = await call("autopay_claim", { p_network: network, p_id: id, p_window: window, p_hold: holdSeconds });
      return data.claimed === true && typeof data.attempt === "number" && Number.isSafeInteger(data.attempt) && data.attempt > 0 ? data.attempt : null;
    },
    async sign(network, id, window, attempt, signature, validHeight) {
      const data = await call("autopay_sign", { p_network: network, p_id: id, p_window: window, p_attempt: attempt, p_signature: signature, p_valid_height: validHeight });
      return data.signed === true;
    },
    async release(network, id, window, by, retrySeconds) {
      const data = await call("autopay_release", {
        p_network: network,
        p_id: id,
        p_window: window,
        p_attempt: "attempt" in by ? by.attempt : null,
        p_signature: "signature" in by ? by.signature : null,
        p_retry: Math.round(retrySeconds),
      });
      return data.released === true && (data.state === "sending" || data.state === "missed") ? data.state : null;
    },
    async settle(network, id, window, state, by) {
      const data = await call("autopay_settle", {
        p_network: network,
        p_id: id,
        p_window: window,
        p_state: state,
        p_signature: by && "signature" in by ? by.signature : null,
        p_attempt: by && "attempt" in by ? by.attempt : null,
      });
      return data.changed === true;
    },
    async status(network, id, status, owner) {
      const data = await call("autopay_status", { p_network: network, p_id: id, p_status: status, p_owner: owner });
      return data.changed === true;
    },
    async events(network, afterId, limit) {
      const data = await call("autopay_events", { p_network: network, p_after: afterId, p_limit: limit });
      if (!Array.isArray(data.events)) throw new AutopayUnavailable("autopay_events: no list");
      return data.events.map(eventOf).filter((event): event is AutopayEvent => event !== null);
    },
  };
}

/** The drive's read: the events after the last one it has seen, oldest first. */
export async function readAutopayEvents(network: AutopayNetwork, afterId: number, limit = 100, store: AutopayStore = autopayStore()): Promise<readonly AutopayEvent[]> {
  return store.events(network, Math.max(0, Math.floor(afterId)), Math.max(1, Math.min(500, Math.floor(limit))));
}
