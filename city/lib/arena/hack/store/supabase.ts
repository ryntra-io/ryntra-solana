/**
 * Hack's store in the database (CITY-226): one call to one `public.hack_*` function per step, each gated by the app
 * secret and each one transaction under its lock (`supabase/migrations/20261108180000_hack_v1.sql`). Every server
 * instance reads the same orders, takes and findings, so «a finding is filed once», «who first» and «the owner's move
 * is the owner's» hold however many instances answer at once.
 *
 * An answer that does not read as Hack's is `HackStoreUnavailable` — nothing is guessed.
 */

import { checkFinding, isSeverity, FINDING_STATUSES, type Finding } from "../finding.ts";
import { ORDER_STATUSES, type Order } from "../order.ts";
import type { StoredOrder } from "../registry.ts";
import {
  HackStoreRefused,
  HackStoreUnavailable,
  isHackRole,
  moveToward,
  recordedVerdict,
  type FiledFinding,
  type FiledReason,
  type HackDb,
  type Take,
} from "./contract.ts";

/** PostgREST's door as `lib/supabase-rpc.ts` gives it: the function by name, the secret added there. */
export type HackRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);
const isMs = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const REASON = /^[A-Z_]{2,32}$/;

/** An order as the database keeps it: the record with its status column laid over. */
export function orderOf(value: unknown, fn: string): StoredOrder {
  if (!isRecord(value) || !isRecord(value.record)) throw new HackStoreUnavailable(`${fn}: no order`);
  const { order, grant } = value.record;
  if (!isRecord(order) || !isRecord(grant) || typeof order.id !== "string" || typeof order.protocol !== "string") throw new HackStoreUnavailable(`${fn}: unreadable order`);
  if (!(ORDER_STATUSES as readonly unknown[]).includes(value.status)) throw new HackStoreUnavailable(`${fn}: unreadable status`);
  return { order: { ...(order as unknown as Order), status: value.status as Order["status"] }, grant: grant as unknown as StoredOrder["grant"] };
}

/** A finding as the database keeps it: the record with its status column laid over, and the verdict on it. */
export function filedOf(value: unknown, fn: string): FiledFinding {
  if (!isRecord(value) || !isRecord(value.record)) throw new HackStoreUnavailable(`${fn}: no finding`);
  const { record, status, reason, severity, payable, dedupeKey, detail, resolvedBy, resolvedAt, updatedAt } = value;
  const ok =
    (FINDING_STATUSES as readonly unknown[]).includes(status) &&
    typeof reason === "string" &&
    REASON.test(reason) &&
    (severity === null || isSeverity(severity)) &&
    typeof payable === "boolean" &&
    typeof dedupeKey === "string" &&
    typeof detail === "string" &&
    (resolvedBy === null || typeof resolvedBy === "string") &&
    (resolvedAt === null || isMs(resolvedAt)) &&
    isMs(updatedAt);
  const finding = { ...record, status } as unknown as Finding;
  if (!ok || checkFinding(finding).length > 0) throw new HackStoreUnavailable(`${fn}: unreadable finding`);
  return {
    finding,
    reason: reason as FiledReason,
    severity: severity as FiledFinding["severity"],
    payable: payable as boolean,
    dedupeKey: dedupeKey as string,
    detail: detail as string,
    resolvedBy: resolvedBy as string | null,
    resolvedAt: resolvedAt as number | null,
    updatedAt: updatedAt as number,
  };
}

export function takeOf(value: unknown, fn: string): Take {
  if (!isRecord(value)) throw new HackStoreUnavailable(`${fn}: no take`);
  const { order, hunter, owner, role, takenAt } = value;
  if (typeof order !== "string" || typeof hunter !== "string" || typeof owner !== "string" || !isHackRole(role) || !isMs(takenAt)) throw new HackStoreUnavailable(`${fn}: unreadable take`);
  return { order, hunter, owner, role, takenAt };
}

const list = <T>(value: unknown, fn: string, read: (v: unknown, fn: string) => T): T[] => {
  if (!Array.isArray(value)) throw new HackStoreUnavailable(`${fn}: unreadable list`);
  return value.map((v) => read(v, fn));
};

export function createSupabaseHackDb(rpc: HackRpc, options: { now?: () => number } = {}): HackDb {
  const clock = options.now ?? Date.now;

  async function call(fn: string, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, args);
    if (!answer.ok) throw new HackStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new HackStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new HackStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }

  const unreadable = (fn: string, data: Answer): never => {
    throw new HackStoreUnavailable(`${fn}: ${String(data.error ?? "unreadable")}`);
  };

  const db: HackDb = {
    durable: true,

    async open(stored, limit, now) {
      const { order } = stored;
      if (order.status !== "draft" && order.status !== "open") throw new HackStoreRefused(`an order is kept from draft or open, not ${order.status}`);
      const data = await call("hack_order_open", {
        p_id: order.id,
        p_protocol: order.protocol,
        p_status: order.status,
        p_record: stored,
        p_opens: iso(order.opensAt),
        p_closes: iso(order.closesAt),
        p_since: limit ? iso(limit.since) : null,
        p_per_owner: limit ? limit.perOwner : null,
        p_now: iso(now),
      });
      if (data.opened === true) return { ok: true, order: orderOf(data.order, "hack_order_open").order };
      if (data.error === "exists") return { ok: false, reason: "EXISTS" };
      if (data.error === "rate_limited") return { ok: false, reason: "RATE_LIMITED" };
      return unreadable("hack_order_open", data);
    },

    async move(id, move, by, now) {
      if (move === "open") return { ok: false, reason: "BAD_MOVE" };
      const data = await call("hack_order_move", { p_id: id, p_move: move, p_by: by, p_now: iso(now) });
      if (data.moved === true) return { ok: true, order: orderOf(data.order, "hack_order_move").order };
      const reasons = { no_order: "NOT_FOUND", not_owner: "NOT_OWNER", not_yet: "NOT_YET", bad_move: "BAD_MOVE", unresolved: "UNRESOLVED" } as const;
      const reason = reasons[data.error as keyof typeof reasons];
      if (!reason) return unreadable("hack_order_move", data);
      return reason === "BAD_MOVE" && (ORDER_STATUSES as readonly unknown[]).includes(data.status) ? { ok: false, reason, status: data.status as Order["status"] } : { ok: false, reason };
    },

    async take(input, limit, now) {
      const data = await call("hack_take", {
        p_order: input.order,
        p_hunter: input.hunter,
        p_owner: input.owner,
        p_role: input.role,
        p_since: limit ? iso(limit.since) : null,
        p_per_owner: limit ? limit.perOwner : null,
        p_now: iso(now),
      });
      if (data.taken === true) return { ok: true, take: takeOf(data.take, "hack_take"), again: data.again === true };
      const reasons = { no_order: "NOT_FOUND", closed: "CLOSED", window: "WINDOW", self_audit: "SELF_AUDIT", both_sides: "BOTH_SIDES", hunter_taken: "HUNTER_TAKEN", rate_limited: "RATE_LIMITED" } as const;
      const reason = reasons[data.error as keyof typeof reasons];
      if (!reason) return unreadable("hack_take", data);
      return reason === "CLOSED" && (ORDER_STATUSES as readonly unknown[]).includes(data.status) ? { ok: false, reason, status: data.status as Order["status"] } : { ok: false, reason };
    },

    async takes(orderId) {
      const data = await call("hack_takes", { p_order: orderId });
      return list(data.takes, "hack_takes", takeOf);
    },

    async file({ finding, verdict }, { needTake, limit }, now) {
      const { status: _status, ...record } = finding;
      const data = await call("hack_finding_file", {
        p_id: finding.id,
        p_order: finding.order,
        p_hunter: finding.hunter,
        p_owner: finding.hunterOwner,
        p_dedupe: verdict.dedupeKey,
        p_status: verdict.status,
        p_reason: verdict.reason,
        p_severity: verdict.severity,
        p_payable: verdict.payable,
        p_record: record,
        p_detail: verdict.detail.slice(0, 160),
        p_need_take: needTake,
        p_since: limit ? iso(limit.since) : null,
        p_per_owner: limit ? limit.perOwner : null,
        p_per_hunter: limit?.perHunter ?? null,
        p_submitted: iso(finding.submittedAt),
        p_now: iso(now),
      });
      if (data.filed === true) return { ok: true, filed: filedOf(data.finding, "hack_finding_file") };
      const reasons = { no_order: "NOT_FOUND", exists: "EXISTS", not_taken: "NOT_TAKEN", rate_limited: "RATE_LIMITED" } as const;
      const reason = reasons[data.error as keyof typeof reasons];
      return reason ? { ok: false, reason } : unreadable("hack_finding_file", data);
    },

    async resolve({ id, by, verdict, payable }, now) {
      const data = await call("hack_finding_resolve", { p_id: id, p_by: by, p_verdict: verdict, p_payable: payable, p_now: iso(now) });
      if (data.resolved === true) return { ok: true, filed: filedOf(data.finding, "hack_finding_resolve") };
      const reasons = { no_finding: "NOT_FOUND", not_owner: "NOT_OWNER", settled: "SETTLED", not_pending: "NOT_PENDING", no_run: "NO_RUN" } as const;
      const reason = reasons[data.error as keyof typeof reasons];
      if (!reason) return unreadable("hack_finding_resolve", data);
      return reason === "NOT_PENDING" && (FINDING_STATUSES as readonly unknown[]).includes(data.status) ? { ok: false, reason, status: data.status as Finding["status"] } : { ok: false, reason };
    },

    async filed(id) {
      const data = await call("hack_finding_get", { p_id: id });
      return data.finding === null || data.finding === undefined ? null : filedOf(data.finding, "hack_finding_get");
    },

    async filedForOrder(orderId) {
      const data = await call("hack_findings", { p_order: orderId, p_limit: 1000 });
      return list(data.findings, "hack_findings", filedOf);
    },

    async hit(key, cap, now) {
      const data = await call("hack_hit", { p_key: key, p_cap: cap, p_now: iso(now) });
      if (data.allowed === true) return { allowed: true, retryAfterS: 0 };
      if (data.allowed === false && Number.isSafeInteger(data.retryAfterS)) return { allowed: false, retryAfterS: data.retryAfterS as number };
      return unreadable("hack_hit", data);
    },

    async answer(key, now) {
      const data = await call("hack_answer", { p_key: key, p_now: iso(now) });
      return data.body ?? null;
    },

    async keepAnswer(key, body, now) {
      await call("hack_keep_answer", { p_key: key, p_body: body, p_now: iso(now) });
    },

    // ------------------------------------------------------------ the library's HackStore, over the same steps --

    async putOrder(stored) {
      // An id never overwrites another: a second put of one id leaves the first.
      await db.open(stored, null, clock());
    },
    async getOrder(id) {
      const data = await call("hack_order_get", { p_id: id });
      return data.order === null || data.order === undefined ? null : orderOf(data.order, "hack_order_get");
    },
    async listOrders(filter) {
      const data = await call("hack_orders", { p_status: filter?.status ?? null, p_protocol: filter?.protocol ?? null, p_limit: 100 });
      return list(data.orders, "hack_orders", orderOf);
    },
    async setOrderStatus(id, status) {
      const stored = await db.getOrder(id);
      if (!stored) throw new HackStoreRefused("no such order");
      if (stored.order.status === status) return;
      const move = moveToward(stored.order.status, status);
      if (!move) throw new HackStoreRefused(`an order cannot go from ${stored.order.status} to ${status}`);
      const moved = await db.move(id, move, stored.order.protocol, clock());
      if (!moved.ok) throw new HackStoreRefused(`an order cannot ${move}: ${moved.reason}`);
    },
    async putFinding(finding) {
      const filed = await db.file({ finding, verdict: recordedVerdict(finding) }, { needTake: false, limit: null }, clock());
      if (!filed.ok && filed.reason === "NOT_FOUND") throw new HackStoreRefused("no such order");
    },
    async getFinding(id) {
      return (await db.filed(id))?.finding ?? null;
    },
    async findingsForOrder(orderId) {
      return (await db.filedForOrder(orderId)).map((f) => f.finding);
    },
  };
  return db;
}
