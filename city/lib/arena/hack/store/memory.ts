/**
 * Hack's store in one instance's memory (CITY-226): a developer's machine, the stand and the tests. Every step is the
 * database's own step (`supabase/migrations/20261108180000_hack_v1.sql`) rule for rule — each method's body runs
 * without an `await`, so in one process a step is as atomic as under the database's lock. It is not `durable`:
 * production never opens on it (`ready.ts`), since two instances would each keep their own orders.
 */

import { nextStatus, type Order } from "../order.ts";
import type { Finding } from "../finding.ts";
import type { StoredOrder } from "../registry.ts";
import {
  ANSWER_MS,
  HackStoreRefused,
  moveToward,
  recordedVerdict,
  type DayLimit,
  type FiledFinding,
  type HackDb,
  type Take,
} from "./contract.ts";

type OrderRow = { stored: StoredOrder; status: Order["status"]; createdAt: number; updatedAt: number };
type FindingRow = Omit<FiledFinding, "finding"> & { record: Finding; status: Finding["status"]; submittedAt: number };

const copy = <T>(value: T): T => structuredClone(value);
const KEEP = 2_000;
const HOUR_MS = 3_600_000;

export function createMemoryHackDb(options: { now?: () => number } = {}): HackDb {
  const clock = options.now ?? Date.now;
  const orders = new Map<string, OrderRow>();
  const takes = new Map<string, Take>();
  const findings = new Map<string, FindingRow>();
  const answers = new Map<string, { body: unknown; until: number }>();
  const hits = new Map<string, { hour: number; hits: number }>();

  const orderOf = (row: OrderRow): Order => copy({ ...row.stored.order, status: row.status });
  const storedOf = (row: OrderRow): StoredOrder => ({ order: orderOf(row), grant: copy(row.stored.grant) });
  const filedOf = (row: FindingRow): FiledFinding => {
    const { record, status, submittedAt: _at, ...rest } = row;
    return copy({ ...rest, finding: { ...record, status } });
  };
  const takeKey = (order: string, hunter: string) => `${order}\n${hunter}`;
  const takesOf = (order: string) => [...takes.values()].filter((t) => t.order === order);
  const findingsOf = (order: string) => [...findings.values()].filter((f) => f.record.order === order);
  const confirmedOf = (order: string, key: string) => findingsOf(order).some((f) => f.status === "confirmed" && f.dedupeKey === key);

  const db: HackDb = {
    durable: false,

    async open(stored, limit, now) {
      const { order } = stored;
      if (order.status !== "draft" && order.status !== "open") throw new HackStoreRefused(`an order is kept from draft or open, not ${order.status}`);
      if (orders.has(order.id)) return { ok: false, reason: "EXISTS" };
      if (limit && [...orders.values()].filter((o) => o.stored.order.protocol === order.protocol && o.createdAt >= limit.since).length >= limit.perOwner) {
        return { ok: false, reason: "RATE_LIMITED" };
      }
      const row: OrderRow = { stored: copy(stored), status: order.status, createdAt: now, updatedAt: now };
      orders.set(order.id, row);
      return { ok: true, order: orderOf(row) };
    },

    async move(id, move, by, now) {
      if (move === "open") return { ok: false, reason: "BAD_MOVE" };
      const row = orders.get(id);
      if (!row) return { ok: false, reason: "NOT_FOUND" };
      if (move !== "deadline" && by !== row.stored.order.protocol) return { ok: false, reason: "NOT_OWNER" };
      if (move === "deadline" && now <= row.stored.order.closesAt) return { ok: false, reason: "NOT_YET" };
      const next = nextStatus(row.status, move);
      if (next === null) return { ok: false, reason: "BAD_MOVE", status: row.status };
      if (move === "settle" && findingsOf(id).some((f) => f.status === "submitted" || f.status === "needs_review")) return { ok: false, reason: "UNRESOLVED" };
      row.status = next;
      row.updatedAt = now;
      return { ok: true, order: orderOf(row) };
    },

    async take(input, limit, now) {
      const row = orders.get(input.order);
      if (!row) return { ok: false, reason: "NOT_FOUND" };
      const held = takes.get(takeKey(input.order, input.hunter));
      if (held) return held.owner === input.owner && held.role === input.role ? { ok: true, take: copy(held), again: true } : { ok: false, reason: "HUNTER_TAKEN" };
      const order = row.stored.order;
      if (row.status !== "open") return { ok: false, reason: "CLOSED", status: row.status };
      if (now < order.opensAt || now > order.closesAt) return { ok: false, reason: "WINDOW" };
      if (input.role === "attacker" && input.owner === order.protocol) return { ok: false, reason: "SELF_AUDIT" };
      if (takesOf(input.order).some((t) => t.owner === input.owner && t.role !== input.role)) return { ok: false, reason: "BOTH_SIDES" };
      if (limit && [...takes.values()].filter((t) => t.owner === input.owner && t.takenAt >= limit.since).length >= limit.perOwner) {
        return { ok: false, reason: "RATE_LIMITED" };
      }
      const take: Take = { order: input.order, hunter: input.hunter, owner: input.owner, role: input.role, takenAt: now };
      takes.set(takeKey(input.order, input.hunter), take);
      return { ok: true, take: copy(take), again: false };
    },

    async takes(orderId) {
      return copy(takesOf(orderId).sort((a, b) => a.takenAt - b.takenAt || a.hunter.localeCompare(b.hunter)));
    },

    async file({ finding, verdict }, { needTake, limit }, now) {
      const row = orders.get(finding.order);
      if (!row) return { ok: false, reason: "NOT_FOUND" };
      if (findings.has(finding.id)) return { ok: false, reason: "EXISTS" };
      if (needTake) {
        const take = takes.get(takeKey(finding.order, finding.hunter));
        if (!take || take.owner !== finding.hunterOwner || take.role !== "attacker") return { ok: false, reason: "NOT_TAKEN" };
      }
      if (limit) {
        const all = [...findings.values()].filter((f) => f.submittedAt >= limit.since);
        if (all.filter((f) => f.record.hunterOwner === finding.hunterOwner).length >= limit.perOwner) return { ok: false, reason: "RATE_LIMITED" };
        const mine = all.filter((f) => f.record.hunterOwner === finding.hunterOwner && f.record.hunter === finding.hunter);
        if (limit.perHunter !== undefined && mine.length >= limit.perHunter) return { ok: false, reason: "RATE_LIMITED" };
      }
      let { status, reason, severity, payable, detail } = verdict;
      // The order moved while the rules read it: they would have said it is not open.
      if (row.status !== "open" && reason !== "BAD_FINDING" && reason !== "WRONG_ORDER") {
        status = "blocked";
        reason = "ORDER_CLOSED";
        severity = null;
        payable = false;
        detail = `the order is ${row.status}, not open`;
      }
      // Who first: one confirmed finding to a vulnerability.
      if (status === "confirmed" && confirmedOf(finding.order, verdict.dedupeKey)) {
        status = "duplicate";
        reason = "DUPLICATE";
        payable = false;
        detail = "the same vulnerability is already confirmed";
      }
      const kept: FindingRow = {
        record: copy(finding),
        status,
        reason,
        severity,
        payable: payable && status === "confirmed",
        dedupeKey: verdict.dedupeKey,
        detail: detail.slice(0, 160),
        resolvedBy: null,
        resolvedAt: null,
        updatedAt: now,
        submittedAt: finding.submittedAt,
      };
      findings.set(finding.id, kept);
      return { ok: true, filed: filedOf(kept) };
    },

    async resolve({ id, by, verdict, payable }, now) {
      const row = findings.get(id);
      if (!row) return { ok: false, reason: "NOT_FOUND" };
      const order = orders.get(row.record.order)!;
      if (by !== order.stored.order.protocol) return { ok: false, reason: "NOT_OWNER" };
      if (order.status === "settled") return { ok: false, reason: "SETTLED" };
      if (row.status !== "needs_review") return { ok: false, reason: "NOT_PENDING", status: row.status };
      const done = { resolvedBy: by, resolvedAt: now, updatedAt: now };
      if (verdict === "reject") {
        Object.assign(row, { status: "rejected", reason: "OWNER_REJECTED", severity: null, payable: false, detail: "the protocol owner rejected it", ...done });
        return { ok: true, filed: filedOf(row) };
      }
      if (row.reason !== "NEEDS_REVIEW" || row.record.logHash === null) return { ok: false, reason: "NO_RUN" };
      if (confirmedOf(row.record.order, row.dedupeKey)) {
        Object.assign(row, { status: "duplicate", reason: "DUPLICATE", severity: row.record.severity, payable: false, detail: "the same vulnerability is already confirmed", ...done });
      } else {
        Object.assign(row, { status: "confirmed", reason: "OWNER_CONFIRMED", severity: row.record.severity, payable, detail: "the protocol owner confirmed the run", ...done });
      }
      return { ok: true, filed: filedOf(row) };
    },

    async filed(id) {
      const row = findings.get(id);
      return row ? filedOf(row) : null;
    },

    async filedForOrder(orderId) {
      return findingsOf(orderId)
        .sort((a, b) => a.submittedAt - b.submittedAt || a.record.id.localeCompare(b.record.id))
        .map(filedOf);
    },

    async hit(key, cap, now) {
      const hour = now - (now % HOUR_MS);
      for (const [k, v] of hits) if (v.hour < hour - 24 * HOUR_MS) hits.delete(k);
      const bucket = `${key}\n${hour}`;
      const kept = hits.get(bucket) ?? { hour, hits: 0 };
      kept.hits += 1;
      hits.set(bucket, kept);
      if (kept.hits > cap) return { allowed: false, retryAfterS: Math.max(1, Math.ceil((hour + HOUR_MS - now) / 1_000)) };
      return { allowed: true, retryAfterS: 0 };
    },

    async answer(key, now) {
      const kept = answers.get(key);
      return kept && kept.until > now ? copy(kept.body) : null;
    },

    async keepAnswer(key, body, now) {
      for (const [k, v] of answers) if (v.until <= now) answers.delete(k);
      while (answers.size >= KEEP) answers.delete(answers.keys().next().value as string);
      answers.set(key, { body: copy(body), until: now + ANSWER_MS });
    },

    // ------------------------------------------------------------ the library's HackStore, over the same steps --

    async putOrder(stored) {
      // An id never overwrites another: a second put of one id leaves the first.
      await db.open(stored, null as DayLimit, clock());
    },
    async getOrder(id) {
      const row = orders.get(id);
      return row ? storedOf(row) : null;
    },
    async listOrders(filter) {
      return [...orders.values()]
        .filter((row) => (!filter?.status || row.status === filter.status) && (!filter?.protocol || row.stored.order.protocol === filter.protocol))
        .sort((a, b) => b.createdAt - a.createdAt || a.stored.order.id.localeCompare(b.stored.order.id))
        .slice(0, 100)
        .map(storedOf);
    },
    async setOrderStatus(id, status) {
      const row = orders.get(id);
      if (!row) throw new HackStoreRefused("no such order");
      if (row.status === status) return;
      const move = moveToward(row.status, status);
      if (!move) throw new HackStoreRefused(`an order cannot go from ${row.status} to ${status}`);
      const moved = await db.move(id, move, row.stored.order.protocol, clock());
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
