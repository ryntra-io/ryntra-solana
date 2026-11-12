// Run from repo root: node --test city/lib/arena/hack/store/store.test.mjs
/*
 * CITY-226: one behaviour for both of Hack's stores. The same cases run against memory every time and against the
 * real migration on a throwaway PostgreSQL when HACK_TEST_DATABASE_URL names a local server (for example
 * postgres://postgres@127.0.0.1:5432/postgres). Never point it at a real project: the test creates and drops its own
 * database there. On PostgreSQL the atomic rules are also raced: calls at once on their own connections, as PostgREST
 * makes them.
 */
import { hack, makeOrder, makeGrant, makeFinding, makeProof, verify, WINDOW, AT, hashOf } from "../fixtures.mjs";
import assert from "node:assert/strict";
import { describe, test, before, after } from "node:test";

const { createMemoryHackDb } = await import("./memory.ts");
const { createSupabaseHackDb } = await import("./supabase.ts");
const { HackStoreRefused, HackStoreUnavailable, dayStart, DAY_MS, ANSWER_MS } = await import("./contract.ts");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A fresh 44-character base58 wallet, so every case has its own limits. */
const wallet = () => Array.from({ length: 44 }, () => B58[Math.floor(Math.random() * B58.length)]).join("");
let n = 0;
const id = (prefix) => `${prefix}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

/** An open order of a fresh protocol, with its grant, as the store keeps it. */
function stored(over = {}) {
  const order = makeOrder({ id: id("o"), protocol: wallet(), status: "open", ...over });
  return { order, grant: makeGrant(order) };
}

/** The rules' verdict a finding is filed with; a confirmed one by default. */
const verdict = (finding, over = {}) => ({
  status: "confirmed",
  reason: "COUNTS",
  severity: finding.severity,
  payable: true,
  dedupeKey: hack.dedupeKey(finding),
  detail: "reproduced; counts at high",
  ...over,
});
const review = (finding, reason = "NEEDS_REVIEW") => verdict(finding, { status: "needs_review", reason, severity: null, payable: false, detail: "the judge could not tell" });

const NO_LIMIT = { needTake: false, limit: null };
const TAKEN = { needTake: true, limit: null };

function memoryFixture() {
  return { db: createMemoryHackDb({ now: () => AT }), close: async () => {} };
}

async function pgFixture() {
  const { throwawayDatabase } = await import("./testing/pg.mjs");
  const db = await throwawayDatabase(process.env.HACK_TEST_DATABASE_URL);
  return { db: createSupabaseHackDb(db.rpc, { now: () => AT }), close: db.close, raw: db };
}

function suite(name, makeFixture, { skip = false, concurrent = false } = {}) {
  describe(`hack store: ${name}`, { skip }, () => {
    let fx;
    before(async () => {
      fx = await makeFixture();
    });
    after(async () => {
      await fx?.close();
    });

    /** An open order with an attacker's take by a fresh owner: what a filing needs. */
    async function ready(over = {}) {
      const s = stored(over);
      assert.equal((await fx.db.open(s, null, AT)).ok, true);
      const owner = wallet();
      const take = await fx.db.take({ order: s.order.id, hunter: "agent-7", owner, role: "attacker" }, null, AT);
      assert.equal(take.ok, true);
      return { ...s, owner, finding: (over2 = {}) => makeFinding(s.order, { id: id("f"), hunterOwner: owner, ...over2 }) };
    }

    test("an order opens once: the same id never overwrites the first, by either door", async () => {
      const s = stored({ title: "First" });
      const opened = await fx.db.open(s, null, AT);
      assert.equal(opened.ok, true);
      assert.equal(opened.order.status, "open");
      assert.deepEqual(await fx.db.open({ ...s, order: { ...s.order, title: "Second" } }, null, AT), { ok: false, reason: "EXISTS" });
      await fx.db.putOrder({ ...s, order: { ...s.order, title: "Third" } });
      const kept = await fx.db.getOrder(s.order.id);
      assert.equal(kept.order.title, "First");
      assert.deepEqual(kept.grant, s.grant);
      assert.equal(await fx.db.getOrder("no-such-order"), null);
      await assert.rejects(fx.db.open({ ...s, order: { ...s.order, id: id("o"), status: "closed" } }, null, AT), HackStoreRefused);
    });

    test("a protocol opens so many orders a day; the next day it opens again; another protocol is not counted", async () => {
      const protocol = wallet();
      const limit = { since: dayStart(AT), perOwner: 2 };
      for (let i = 0; i < 2; i += 1) assert.equal((await fx.db.open(stored({ protocol }), limit, AT + i)).ok, true);
      assert.deepEqual(await fx.db.open(stored({ protocol }), limit, AT + 5), { ok: false, reason: "RATE_LIMITED" });
      assert.equal((await fx.db.open(stored(), limit, AT + 5)).ok, true, "another protocol has its own day");
      const tomorrow = dayStart(AT) + DAY_MS;
      assert.equal((await fx.db.open(stored({ protocol }), { since: tomorrow, perOwner: 2 }, tomorrow + 1)).ok, true);
    });

    test("orders list newest first, by status and by protocol", async () => {
      const protocol = wallet();
      const a = stored({ protocol });
      const b = stored({ protocol });
      await fx.db.open(a, null, AT + 10);
      await fx.db.open(b, null, AT + 20);
      await fx.db.move(b.order.id, "pause", protocol, AT + 30);
      const mine = await fx.db.listOrders({ protocol });
      assert.deepEqual(mine.map((s) => s.order.id), [b.order.id, a.order.id]);
      assert.deepEqual((await fx.db.listOrders({ protocol, status: "paused" })).map((s) => s.order.id), [b.order.id]);
      assert.equal(mine[0].order.status, "paused");
    });

    test("an owner's move is the protocol owner's alone, along the state machine; the deadline is the system's, after the window", async () => {
      const s = stored();
      const owner = s.order.protocol;
      await fx.db.open(s, null, AT);
      assert.deepEqual(await fx.db.move(s.order.id, "pause", wallet(), AT), { ok: false, reason: "NOT_OWNER" });
      assert.deepEqual(await fx.db.move(s.order.id, "close", null, AT), { ok: false, reason: "NOT_OWNER" }, "an owner's move that names nobody is nobody's");
      assert.deepEqual(await fx.db.move(s.order.id, "open", owner, AT), { ok: false, reason: "BAD_MOVE" });
      assert.deepEqual(await fx.db.move("no-such-order", "pause", owner, AT), { ok: false, reason: "NOT_FOUND" });
      assert.equal((await fx.db.move(s.order.id, "pause", owner, AT)).order.status, "paused");
      assert.deepEqual(await fx.db.move(s.order.id, "pause", owner, AT), { ok: false, reason: "BAD_MOVE", status: "paused" });
      assert.deepEqual(await fx.db.move(s.order.id, "settle", owner, AT), { ok: false, reason: "BAD_MOVE", status: "paused" });
      assert.equal((await fx.db.move(s.order.id, "resume", owner, AT)).order.status, "open");
      assert.deepEqual(await fx.db.move(s.order.id, "deadline", null, WINDOW.closesAt), { ok: false, reason: "NOT_YET" });
      assert.equal((await fx.db.move(s.order.id, "deadline", null, WINDOW.closesAt + 1)).order.status, "closed");
      assert.equal((await fx.db.move(s.order.id, "settle", owner, WINDOW.closesAt + 2)).order.status, "settled");
      assert.deepEqual(await fx.db.move(s.order.id, "close", owner, WINDOW.closesAt + 3), { ok: false, reason: "BAD_MOVE", status: "settled" });
    });

    test("an agent takes an order once; the protocol's owner never attacks it; one owner plays one side", async () => {
      const s = stored();
      await fx.db.open(s, null, AT);
      const a = wallet();
      const first = await fx.db.take({ order: s.order.id, hunter: "agent-1", owner: a, role: "attacker" }, null, AT);
      assert.deepEqual(first, { ok: true, again: false, take: { order: s.order.id, hunter: "agent-1", owner: a, role: "attacker", takenAt: AT } });
      const again = await fx.db.take({ order: s.order.id, hunter: "agent-1", owner: a, role: "attacker" }, null, AT + 5);
      assert.equal(again.again, true);
      assert.equal(again.take.takenAt, AT, "the same take is the same take");
      assert.deepEqual(await fx.db.take({ order: s.order.id, hunter: "agent-1", owner: wallet(), role: "attacker" }, null, AT), { ok: false, reason: "HUNTER_TAKEN" });
      assert.deepEqual(await fx.db.take({ order: s.order.id, hunter: "agent-1", owner: a, role: "defender" }, null, AT), { ok: false, reason: "HUNTER_TAKEN" });
      assert.deepEqual(await fx.db.take({ order: s.order.id, hunter: "agent-2", owner: a, role: "defender" }, null, AT), { ok: false, reason: "BOTH_SIDES" });
      assert.deepEqual(await fx.db.take({ order: s.order.id, hunter: "agent-3", owner: s.order.protocol, role: "attacker" }, null, AT), { ok: false, reason: "SELF_AUDIT" });
      assert.equal((await fx.db.take({ order: s.order.id, hunter: "agent-4", owner: s.order.protocol, role: "defender" }, null, AT)).ok, true, "the protocol may defend its own");
      assert.deepEqual(await fx.db.take({ order: "no-such-order", hunter: "agent-1", owner: a, role: "attacker" }, null, AT), { ok: false, reason: "NOT_FOUND" });
      assert.deepEqual((await fx.db.takes(s.order.id)).map((t) => [t.hunter, t.role]), [["agent-1", "attacker"], ["agent-4", "defender"]]);
    });

    test("a take needs the order open and inside its window, and keeps to the day's limit", async () => {
      const early = stored({ opensAt: AT + 60_000 });
      await fx.db.open(early, null, AT);
      assert.deepEqual(await fx.db.take({ order: early.order.id, hunter: "agent-1", owner: wallet(), role: "attacker" }, null, AT), { ok: false, reason: "WINDOW" });
      const paused = stored();
      await fx.db.open(paused, null, AT);
      await fx.db.move(paused.order.id, "pause", paused.order.protocol, AT);
      assert.deepEqual(await fx.db.take({ order: paused.order.id, hunter: "agent-1", owner: wallet(), role: "attacker" }, null, AT), { ok: false, reason: "CLOSED", status: "paused" });

      const owner = wallet();
      const limit = { since: dayStart(AT), perOwner: 2 };
      for (let i = 0; i < 2; i += 1) {
        const s = stored();
        await fx.db.open(s, null, AT);
        assert.equal((await fx.db.take({ order: s.order.id, hunter: "agent-1", owner, role: "attacker" }, limit, AT)).ok, true);
      }
      const third = stored();
      await fx.db.open(third, null, AT);
      assert.deepEqual(await fx.db.take({ order: third.order.id, hunter: "agent-1", owner, role: "attacker" }, limit, AT), { ok: false, reason: "RATE_LIMITED" });
    });

    test("a finding is filed once: the same id never overwrites the first one's evidence or verdict", async () => {
      const r = await ready();
      const finding = r.finding();
      const filed = await fx.db.file({ finding, verdict: verdict(finding) }, TAKEN, AT);
      assert.equal(filed.ok, true);
      assert.equal(filed.filed.finding.status, "confirmed");
      assert.equal(filed.filed.payable, true);
      assert.equal(filed.filed.severity, "high");

      const forged = { ...finding, title: "Overwritten", logHash: hashOf("another run") };
      assert.deepEqual(await fx.db.file({ finding: forged, verdict: review(forged) }, TAKEN, AT + 1), { ok: false, reason: "EXISTS" });
      await fx.db.putFinding({ ...forged, status: "rejected" });
      const kept = await fx.db.filed(finding.id);
      assert.equal(kept.finding.title, finding.title);
      assert.equal(kept.finding.logHash, finding.logHash);
      assert.equal(kept.finding.status, "confirmed");
      assert.equal(kept.reason, "COUNTS");
      assert.deepEqual(await fx.db.getFinding(finding.id), { ...finding, status: "confirmed" });
    });

    test("a finding needs its agent's attacker take on the order", async () => {
      const r = await ready();
      const stranger = r.finding({ hunterOwner: wallet() });
      assert.deepEqual(await fx.db.file({ finding: stranger, verdict: verdict(stranger) }, TAKEN, AT), { ok: false, reason: "NOT_TAKEN" }, "another owner of the same agent id");
      const other = r.finding({ hunter: "agent-9" });
      assert.deepEqual(await fx.db.file({ finding: other, verdict: verdict(other) }, TAKEN, AT), { ok: false, reason: "NOT_TAKEN" });
      await fx.db.take({ order: r.order.id, hunter: "agent-d", owner: wallet(), role: "defender" }, null, AT);
      const defender = r.finding({ hunter: "agent-d" });
      assert.deepEqual(await fx.db.file({ finding: defender, verdict: verdict(defender) }, TAKEN, AT), { ok: false, reason: "NOT_TAKEN" }, "a defender does not file");
      const orphan = makeFinding({ id: "no-such-order" }, { id: id("f") });
      assert.deepEqual(await fx.db.file({ finding: orphan, verdict: verdict(orphan) }, NO_LIMIT, AT), { ok: false, reason: "NOT_FOUND" });
      await assert.rejects(fx.db.putFinding(orphan), HackStoreRefused);
    });

    test("who first: one confirmed finding to a vulnerability; a later one of the same key is a duplicate, never payable", async () => {
      const r = await ready();
      const first = r.finding({ submittedAt: AT });
      const same = r.finding({ submittedAt: AT + 1, target: { program: first.target.program, instruction: "withdraw", account: first.target.program } });
      const other = r.finding({ submittedAt: AT + 2, vulnClass: "overflow" });
      assert.equal((await fx.db.file({ finding: first, verdict: verdict(first) }, TAKEN, AT)).filed.finding.status, "confirmed");
      const dup = await fx.db.file({ finding: same, verdict: verdict(same) }, TAKEN, AT + 1);
      assert.equal(dup.filed.finding.status, "duplicate");
      assert.equal(dup.filed.reason, "DUPLICATE");
      assert.equal(dup.filed.payable, false);
      assert.equal(dup.filed.severity, "high");
      assert.equal((await fx.db.file({ finding: other, verdict: verdict(other) }, TAKEN, AT + 2)).filed.finding.status, "confirmed", "another vulnerability counts on its own");
      assert.deepEqual((await fx.db.filedForOrder(r.order.id)).map((f) => f.finding.id), [first.id, same.id, other.id]);
    });

    test("a finding of an order no longer open is blocked, as the rules would have said", async () => {
      const r = await ready();
      await fx.db.move(r.order.id, "pause", r.order.protocol, AT);
      const finding = r.finding();
      const filed = await fx.db.file({ finding, verdict: verdict(finding) }, TAKEN, AT + 1);
      assert.equal(filed.filed.finding.status, "blocked");
      assert.equal(filed.filed.reason, "ORDER_CLOSED");
      assert.equal(filed.filed.severity, null);
      assert.equal(filed.filed.payable, false);
      assert.equal(filed.filed.detail, "the order is paused, not open");
    });

    test("a wallet and an agent file so many findings a day", async () => {
      const r = await ready();
      await fx.db.take({ order: r.order.id, hunter: "agent-8", owner: r.owner, role: "attacker" }, null, AT);
      const limit = { since: dayStart(AT), perOwner: 3, perHunter: 2 };
      const file = (over) => {
        const finding = r.finding({ vulnClass: id("c"), ...over });
        return fx.db.file({ finding, verdict: verdict(finding) }, { needTake: true, limit }, AT);
      };
      assert.equal((await file()).ok, true);
      assert.equal((await file()).ok, true);
      assert.deepEqual(await file(), { ok: false, reason: "RATE_LIMITED" }, "the agent's day");
      assert.equal((await file({ hunter: "agent-8" })).ok, true);
      assert.deepEqual(await file({ hunter: "agent-8" }), { ok: false, reason: "RATE_LIMITED" }, "the wallet's day");
    });

    test("The protocol owner alone, a confirmation only of a run, and who first again", async () => {
      const r = await ready();
      const owner = r.order.protocol;
      const unclear = r.finding();
      const unclear2 = r.finding();
      const bare = r.finding({ vulnClass: "overflow", logHash: null });
      const counted = r.finding({ vulnClass: "reentrancy" });
      await fx.db.file({ finding: unclear, verdict: review(unclear) }, TAKEN, AT);
      await fx.db.file({ finding: unclear2, verdict: review(unclear2) }, TAKEN, AT + 1);
      await fx.db.file({ finding: bare, verdict: review(bare, "NO_EVIDENCE") }, TAKEN, AT + 2);
      await fx.db.file({ finding: counted, verdict: verdict(counted) }, TAKEN, AT + 3);

      assert.deepEqual(await fx.db.resolve({ id: unclear.id, by: r.owner, verdict: "confirm", payable: true }, AT), { ok: false, reason: "NOT_OWNER" });
      assert.deepEqual(await fx.db.resolve({ id: "no-such-finding", by: owner, verdict: "confirm", payable: true }, AT), { ok: false, reason: "NOT_FOUND" });
      assert.deepEqual(await fx.db.resolve({ id: counted.id, by: owner, verdict: "reject", payable: false }, AT), { ok: false, reason: "NOT_PENDING", status: "confirmed" });
      assert.deepEqual(await fx.db.resolve({ id: bare.id, by: owner, verdict: "confirm", payable: true }, AT), { ok: false, reason: "NO_RUN" }, "a finding without a run is not a finding");

      const confirmed = await fx.db.resolve({ id: unclear.id, by: owner, verdict: "confirm", payable: true }, AT + 10);
      assert.equal(confirmed.filed.finding.status, "confirmed");
      assert.equal(confirmed.filed.reason, "OWNER_CONFIRMED");
      assert.equal(confirmed.filed.severity, "high");
      assert.equal(confirmed.filed.payable, true);
      assert.equal(confirmed.filed.resolvedBy, owner);
      assert.equal(confirmed.filed.resolvedAt, AT + 10);
      const duplicate = await fx.db.resolve({ id: unclear2.id, by: owner, verdict: "confirm", payable: true }, AT + 11);
      assert.equal(duplicate.filed.finding.status, "duplicate");
      assert.equal(duplicate.filed.payable, false);
      const rejected = await fx.db.resolve({ id: bare.id, by: owner, verdict: "reject", payable: false }, AT + 12);
      assert.equal(rejected.filed.finding.status, "rejected");
      assert.equal(rejected.filed.reason, "OWNER_REJECTED");
      assert.equal(rejected.filed.severity, null);
      assert.deepEqual(await fx.db.resolve({ id: bare.id, by: owner, verdict: "reject", payable: false }, AT + 13), { ok: false, reason: "NOT_PENDING", status: "rejected" }, "the owner's confirmation is given once");
    });

    test("settle waits for every finding under review, and a settled order takes no more words", async () => {
      const r = await ready();
      const owner = r.order.protocol;
      const unclear = r.finding();
      await fx.db.file({ finding: unclear, verdict: review(unclear) }, TAKEN, AT);
      await fx.db.move(r.order.id, "close", owner, AT + 1);
      assert.deepEqual(await fx.db.move(r.order.id, "settle", owner, AT + 2), { ok: false, reason: "UNRESOLVED" });
      assert.equal((await fx.db.resolve({ id: unclear.id, by: owner, verdict: "reject", payable: false }, AT + 3)).ok, true);
      assert.equal((await fx.db.move(r.order.id, "settle", owner, AT + 4)).order.status, "settled");
      assert.deepEqual(await fx.db.resolve({ id: unclear.id, by: owner, verdict: "confirm", payable: true }, AT + 5), { ok: false, reason: "SETTLED" });
      const late = r.finding();
      const filed = await fx.db.file({ finding: late, verdict: review(late) }, TAKEN, AT + 6);
      assert.equal(filed.filed.finding.status, "blocked", "a settled order takes no finding");
    });

    test("a network's hour: so many writes, then the wait until the next hour", async () => {
      const key = `ip:${hashOf(id("net")).slice(0, 32)}`;
      const hour = AT - (AT % 3_600_000);
      assert.deepEqual(await fx.db.hit(key, 2, hour + 1_000), { allowed: true, retryAfterS: 0 });
      assert.deepEqual(await fx.db.hit(key, 2, hour + 2_000), { allowed: true, retryAfterS: 0 });
      assert.deepEqual(await fx.db.hit(key, 2, hour + 3_000), { allowed: false, retryAfterS: 3_597 });
      assert.deepEqual(await fx.db.hit(key, 2, hour + 3_600_000), { allowed: true, retryAfterS: 0 });
    });

    test("a request key's answer is kept ten minutes", async () => {
      const key = `w:${wallet()}:open:${id("k")}`;
      assert.equal(await fx.db.answer(key, AT), null);
      await fx.db.keepAnswer(key, { status: 201, body: { order: { id: "x" } }, hash: "h" }, AT);
      assert.deepEqual(await fx.db.answer(key, AT + ANSWER_MS - 1), { status: 201, body: { order: { id: "x" } }, hash: "h" });
      assert.equal(await fx.db.answer(key, AT + ANSWER_MS), null);
    });

    test("the library's registry runs on this store as it is: open, file, who first, the owner's moves", async () => {
      const registry = hack.createHackRegistry({ verify, store: fx.db });
      const order = makeOrder({ id: id("o"), protocol: wallet() });
      const opened = await registry.openOrder(order, makeGrant(order));
      assert.equal(opened.ok, true);
      assert.equal((await fx.db.getOrder(order.id)).order.status, "open");
      const first = makeFinding(order, { id: id("f") });
      const second = makeFinding(order, { id: id("f"), submittedAt: AT + 1 });
      const a = await registry.submitFinding(first, makeProof());
      assert.equal(a.ok && a.finding.status, "confirmed");
      const b = await registry.submitFinding(second, makeProof());
      assert.equal(b.ok && b.finding.status, "duplicate");
      assert.deepEqual(await registry.submitFinding(first, makeProof({ verdict: "FAIL" })), { ok: false, detail: "this finding was already filed" });
      assert.equal((await registry.finding(first.id)).status, "confirmed");
      assert.deepEqual(await registry.applyMove(order.id, "pause", wallet()), { ok: false, detail: "only the protocol owner may make this move" });
      assert.equal((await registry.applyMove(order.id, "pause", order.protocol)).ok, true);
      assert.equal((await fx.db.getOrder(order.id)).order.status, "paused");
      await fx.db.setOrderStatus(order.id, "closed");
      assert.equal((await fx.db.getOrder(order.id)).order.status, "closed");
      await assert.rejects(fx.db.setOrderStatus(order.id, "open"), HackStoreRefused);
      await assert.rejects(fx.db.setOrderStatus("no-such-order", "open"), HackStoreRefused);
      assert.deepEqual((await registry.findings(order.id)).map((f) => f.status), ["confirmed", "duplicate"]);
    });

    if (concurrent) {
      test("raced: six filings of one vulnerability at once — one is confirmed, the rest are duplicates", async () => {
        const r = await ready();
        const findings = Array.from({ length: 6 }, (_, i) => r.finding({ submittedAt: AT + i }));
        const filed = await Promise.all(findings.map((f) => fx.db.file({ finding: f, verdict: verdict(f) }, TAKEN, AT)));
        const statuses = filed.map((f) => f.filed.finding.status).sort();
        assert.deepEqual(statuses, ["confirmed", "duplicate", "duplicate", "duplicate", "duplicate", "duplicate"]);
        assert.equal(filed.filter((f) => f.filed.payable).length, 1);
      });

      test("raced: one id filed four times at once — filed once, the rest refused; even across orders", async () => {
        const r = await ready();
        const r2 = await ready();
        const finding = r.finding();
        const elsewhere = { ...finding, order: r2.order.id, hunterOwner: r2.owner };
        const tries = await Promise.all([
          ...Array.from({ length: 3 }, (_, i) => fx.db.file({ finding: { ...finding, title: `try ${i}` }, verdict: verdict(finding) }, TAKEN, AT)),
          fx.db.file({ finding: elsewhere, verdict: verdict(elsewhere) }, TAKEN, AT),
        ]);
        assert.equal(tries.filter((t) => t.ok).length, 1);
        assert.deepEqual(tries.filter((t) => !t.ok).map((t) => t.reason), ["EXISTS", "EXISTS", "EXISTS"]);
      });

      test("raced: six opens of one protocol at once against a limit of two — two open", async () => {
        const protocol = wallet();
        const limit = { since: dayStart(AT), perOwner: 2 };
        const opened = await Promise.all(Array.from({ length: 6 }, () => fx.db.open(stored({ protocol }), limit, AT)));
        assert.equal(opened.filter((o) => o.ok).length, 2);
        assert.ok(opened.filter((o) => !o.ok).every((o) => o.reason === "RATE_LIMITED"));
      });

      test("raced: one owner takes both sides at once — one side wins; one agent claimed by many — one owner wins", async () => {
        const s = stored();
        await fx.db.open(s, null, AT);
        const owner = wallet();
        const sides = await Promise.all([
          fx.db.take({ order: s.order.id, hunter: "agent-a", owner, role: "attacker" }, null, AT),
          fx.db.take({ order: s.order.id, hunter: "agent-d", owner, role: "defender" }, null, AT),
        ]);
        assert.equal(sides.filter((t) => t.ok).length, 1);
        assert.equal(sides.find((t) => !t.ok).reason, "BOTH_SIDES");
        const claims = await Promise.all(Array.from({ length: 4 }, () => fx.db.take({ order: s.order.id, hunter: "agent-x", owner: wallet(), role: "attacker" }, null, AT)));
        assert.equal(claims.filter((t) => t.ok).length, 1);
        assert.ok(claims.filter((t) => !t.ok).every((t) => t.reason === "HUNTER_TAKEN"));
      });

      test("raced: the owner confirms two findings of one vulnerability at once — one counts", async () => {
        const r = await ready();
        const a = r.finding();
        const b = r.finding();
        await fx.db.file({ finding: a, verdict: review(a) }, TAKEN, AT);
        await fx.db.file({ finding: b, verdict: review(b) }, TAKEN, AT);
        const words = await Promise.all([a, b].map((f) => fx.db.resolve({ id: f.id, by: r.order.protocol, verdict: "confirm", payable: true }, AT)));
        assert.deepEqual(words.map((w) => w.filed.finding.status).sort(), ["confirmed", "duplicate"]);
      });

      test("raced: a pause and a filing at once — the filing is confirmed before the pause or blocked after it, never both", async () => {
        for (let i = 0; i < 4; i += 1) {
          const r = await ready();
          const finding = r.finding();
          const [filed, paused] = await Promise.all([
            fx.db.file({ finding, verdict: verdict(finding) }, TAKEN, AT),
            fx.db.move(r.order.id, "pause", r.order.protocol, AT),
          ]);
          assert.equal(paused.ok, true);
          assert.ok(["confirmed", "blocked"].includes(filed.filed.finding.status));
        }
      });

      test("without the app secret every function refuses", async () => {
        const answer = await fx.raw.rpc("hack_order_get", { p_id: "x" }, "wrong-secret");
        assert.equal(answer.ok, false);
        assert.match(answer.error, /forbidden/);
        const db = createSupabaseHackDb((fn, args) => fx.raw.rpc(fn, args, "wrong-secret"));
        await assert.rejects(db.getOrder("x"), HackStoreUnavailable);
      });
    }
  });
}

suite("memory", memoryFixture);
suite("postgres (the migration)", pgFixture, { skip: !process.env.HACK_TEST_DATABASE_URL, concurrent: true });

test("memory is not durable and the database is: production opens only on the database", () => {
  assert.equal(createMemoryHackDb().durable, false);
  assert.equal(createSupabaseHackDb(async () => ({ ok: false, error: "x" })).durable, true);
});

test("an answer the database store does not read as Hack's is unavailable, never a guess", async () => {
  const answers = [
    { ok: false, error: "timeout" },
    { ok: true, data: null },
    { ok: true, data: { ok: false, error: "bad_request" } },
    { ok: true, data: { ok: true, order: { record: {}, status: "open" } } },
    { ok: true, data: { ok: true, order: { record: { order: { id: "o", protocol: "p" }, grant: {} }, status: "lost" } } },
  ];
  for (const answer of answers) {
    const db = createSupabaseHackDb(async () => answer);
    await assert.rejects(db.getOrder("o"), HackStoreUnavailable, JSON.stringify(answer));
  }
  const odd = createSupabaseHackDb(async () => ({ ok: true, data: { ok: true, opened: false, error: "mystery" } }));
  await assert.rejects(odd.open(stored(), null, AT), HackStoreUnavailable);
  const unread = createSupabaseHackDb(async () => ({ ok: true, data: { ok: true, finding: { record: { id: "f" }, status: "confirmed" } } }));
  await assert.rejects(unread.filed("f"), HackStoreUnavailable);
});
