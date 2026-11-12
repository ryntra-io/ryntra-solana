// Run from repo root: node --test city/lib/arena/hack/store/sql.test.mjs
/*
 * CITY-226: Hack's migration, read as text — one transaction, not applied by this repository, a number no other
 * migration has; every table private with row level security forced, no policy and no grant; every server function
 * secret-gated with an empty search path and granted to anon alone; the lists in the tables are the library's lists;
 * the atomic rules take the order's lock before they read. And the wiring: every function the database store calls
 * exists with exactly the arguments it sends. Its behaviour is checked against a real database in `store.test.mjs` when
 * HACK_TEST_DATABASE_URL is set.
 */
import { hack, makeOrder, makeGrant, makeFinding, AT } from "../fixtures.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const { createSupabaseHackDb } = await import("./supabase.ts");
const { HACK_ROLES } = await import("./contract.ts");

const FILE = "20261108180000_hack_v1.sql";
const migrations = new URL("../../../../../supabase/migrations/", import.meta.url);
const sql = readFileSync(new URL(FILE, migrations), "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");
const bodyOf = (fn) => code.slice(code.indexOf(`create function ${fn}(`)).split(/\n\$\$;/)[0];

const TABLES = ["private.hack_orders", "private.hack_takes", "private.hack_findings", "private.hack_answers", "private.hack_hits"];
const PUBLIC = [
  "hack_answer",
  "hack_finding_file",
  "hack_finding_get",
  "hack_finding_resolve",
  "hack_findings",
  "hack_hit",
  "hack_keep_answer",
  "hack_order_get",
  "hack_order_move",
  "hack_order_open",
  "hack_orders",
  "hack_take",
  "hack_takes",
];

test("one migration file, one transaction, not applied anywhere by this repository; its number is its own", () => {
  const all = readdirSync(migrations).filter((f) => f.endsWith(".sql"));
  // The runs (CITY-238) are a file of their own, after this one (`../runs/sql.test.mjs`).
  assert.deepEqual(all.filter((f) => /_hack_/.test(f)).sort(), [FILE, "20261110120000_hack_v2_runs.sql"]);
  const stamp = FILE.split("_")[0];
  assert.deepEqual(all.filter((f) => f.startsWith(`${stamp}_`)), [FILE], "no other migration has this number");
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /Not applied to any Supabase project/);
  assert.match(sql, /through MCP Supabase/);
  assert.doesNotMatch(code, /^\s*(drop|truncate|alter table public\.)/im);
  assert.doesNotMatch(code, /\bdelete from private\.hack_(orders|takes|findings)\b/, "orders, takes and findings are never deleted");
  assert.doesNotMatch(code, /\bupdate private\.hack_findings x\s+set[^;]*\brecord\s*=/, "a finding's evidence is never rewritten");
});

test("every table is a private hack_ table with row level security forced, no policy and no grant", () => {
  const created = [...code.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), [...TABLES].sort());
  for (const table of created) {
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} enable row level security;`));
    assert.match(code, new RegExp(`alter table ${table.replace(".", "\\.")} force row level security;`));
  }
  assert.doesNotMatch(code, /create policy/);
  const revoked = /revoke all privileges on table([\s\S]+?)from public, anon, authenticated, service_role;/.exec(code)[1];
  for (const table of TABLES) assert.ok(revoked.includes(table), table);
  const grants = [...code.matchAll(/^grant ([^\n]+);$/gm)].map((m) => m[1]);
  assert.equal(grants.length, PUBLIC.length);
  for (const grant of grants) assert.match(grant, /^execute on function public\.hack_\w+\([^)]*\) to anon$/, grant);
});

test("every server function is secret-gated, runs with an empty search path and is granted to anon alone", () => {
  const publicFns = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(publicFns.sort(), PUBLIC);
  for (const fn of publicFns) {
    const body = bodyOf(`public.${fn}`);
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /begin\s+perform private\.beta_check_secret\(p_secret\);/, `${fn}: the secret first`);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon;`), fn);
  }
  for (const fn of [...code.matchAll(/create function private\.(\w+)\(/g)].map((m) => m[1])) {
    const body = bodyOf(`private.${fn}`);
    assert.match(body, /set search_path = ''/, fn);
    assert.doesNotMatch(body, /security definer/, fn);
    assert.match(code, new RegExp(`revoke all on function private\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn);
    assert.doesNotMatch(code, new RegExp(`grant execute on function private\\.${fn}`), fn);
  }
});

test("the lists in the tables are the library's lists, and the state machine is the library's", () => {
  const list = (re) => re.exec(code)[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(list(/status in \(('draft'[^)]+)\)/), [...hack.ORDER_STATUSES].sort());
  assert.deepEqual(list(/status in \(('submitted'[^)]+)\)/), [...hack.FINDING_STATUSES].sort());
  assert.deepEqual(list(/severity in \(([^)]+)\)/), [...hack.SEVERITIES].sort());
  assert.deepEqual(list(/role in \(([^)]+)\)/), [...HACK_ROLES].sort());
  const next = bodyOf("private.hack_next");
  for (const [from, moves] of Object.entries(hack.ORDER_TRANSITIONS)) {
    for (const [move, to] of Object.entries(moves)) {
      const pair = new RegExp(`p_from = '${from}' and p_move (= '${move}'|in \\([^)]*'${move}'[^)]*\\)) then '${to}'`);
      assert.match(next, pair, `${from} --${move}--> ${to}`);
    }
  }
  const pairs = [...next.matchAll(/p_from = '(\w+)' and p_move (?:= '(\w+)'|in \(([^)]+)\))/g)].flatMap((m) => (m[2] ? [m[2]] : m[3].split(",").map((s) => s.trim().replace(/'/g, ""))).map((move) => `${m[1]}:${move}`));
  const library = Object.entries(hack.ORDER_TRANSITIONS).flatMap(([from, moves]) => Object.keys(moves).map((move) => `${from}:${move}`));
  assert.deepEqual(pairs.sort(), library.sort(), "no move the library does not know");
});

test("the atomic rules: each write takes the order's lock before it reads; one confirmed finding to a vulnerability", () => {
  assert.match(code, /create unique index hack_findings_first_idx on private\.hack_findings \(order_id, dedupe_key\) where status = 'confirmed';/);
  for (const fn of ["public.hack_order_move", "public.hack_take", "public.hack_finding_file", "public.hack_finding_resolve"]) {
    const body = bodyOf(fn);
    const lock = body.indexOf("from private.hack_orders o where o.id =");
    assert.ok(lock > 0 && /for update;/.test(body.slice(lock, lock + 80)), `${fn} locks the order`);
    for (const write of ["insert into private.hack_", "update private.hack_"]) {
      const at = body.indexOf(write);
      if (at > 0) assert.ok(lock < at, `${fn}: the lock comes before the write`);
    }
  }
  const resolve = bodyOf("public.hack_finding_resolve");
  assert.ok(resolve.indexOf("from private.hack_orders o where o.id = v_order for update") < resolve.indexOf("from private.hack_findings x where x.id = p_id for update"), "the order's lock first, as a filing takes it");
  // The owner's moves and words are the protocol owner's alone.
  assert.match(bodyOf("public.hack_order_move"), /p_move <> 'deadline' and p_by is distinct from r\.protocol/);
  assert.match(bodyOf("public.hack_order_move"), /p_move = 'deadline' and p_now <= r\.closes_at/);
  assert.match(resolve, /p_by is distinct from r\.protocol/);
  // Filed once: the id is checked under the lock and the insert never overwrites.
  const file = bodyOf("public.hack_finding_file");
  assert.match(file, /on conflict \(id\) do nothing/);
  assert.doesNotMatch(file, /do update/);
  assert.match(bodyOf("public.hack_order_open"), /on conflict \(id\) do nothing/);
  // The limits are counted under the wallet's lock.
  assert.match(bodyOf("public.hack_order_open"), /pg_advisory_xact_lock\(hashtextextended\('hack:orders:' \|\| p_protocol, 0\)\)/);
  assert.match(bodyOf("public.hack_take"), /pg_advisory_xact_lock\(hashtextextended\('hack:owner:' \|\| p_owner, 0\)\)/);
  assert.match(file, /pg_advisory_xact_lock\(hashtextextended\('hack:owner:' \|\| p_owner, 0\)\)/);
});

test("no address, key or money in a column", () => {
  const tables = [...code.matchAll(/create table \w+\.\w+ \(([\s\S]+?)\n\);/g)].map((m) => m[1]).join("\n");
  const columns = [...tables.matchAll(/^\s+(\w+) (?:text|integer|bigint|boolean|timestamptz|jsonb)\b/gm)].map((m) => m[1]);
  assert.ok(columns.length >= 30, `${columns.length} columns`);
  for (const column of columns) assert.doesNotMatch(column, /secret|password|private_key|lamports|balance|amount|ip_address/i, column);
});

test("the wiring: every function the database store calls exists with exactly the arguments it sends", async () => {
  const signatures = new Map();
  for (const match of code.matchAll(/create function public\.(\w+)\(([\s\S]*?)\)\nreturns/g)) {
    signatures.set(match[1], match[2].split(",").map((arg) => arg.trim().split(/\s+/)[0]).filter(Boolean));
  }
  const order = makeOrder({ status: "open" });
  const grant = makeGrant(order);
  const finding = makeFinding(order);
  const { status: _s, ...record } = finding;
  const orderJson = { record: { order, grant }, status: "open", createdAt: AT, updatedAt: AT };
  const filedJson = { record, status: "confirmed", reason: "COUNTS", severity: "high", payable: true, dedupeKey: hack.dedupeKey(finding), detail: "x", resolvedBy: null, resolvedAt: null, updatedAt: AT };
  const take = { order: order.id, hunter: "agent-7", owner: finding.hunterOwner, role: "attacker", takenAt: AT };
  const answers = {
    hack_order_open: { ok: true, opened: true, order: orderJson },
    hack_order_get: { ok: true, order: orderJson },
    hack_orders: { ok: true, orders: [orderJson] },
    hack_order_move: { ok: true, moved: true, order: orderJson },
    hack_take: { ok: true, taken: true, again: false, take },
    hack_takes: { ok: true, takes: [take] },
    hack_finding_file: { ok: true, filed: true, finding: filedJson },
    hack_finding_resolve: { ok: true, resolved: true, finding: filedJson },
    hack_finding_get: { ok: true, finding: filedJson },
    hack_findings: { ok: true, findings: [filedJson] },
    hack_hit: { ok: true, allowed: true, left: 1 },
    hack_answer: { ok: true, body: null },
    hack_keep_answer: { ok: true },
  };
  const called = [];
  const rpc = async (fn, args) => {
    called.push(fn);
    const expected = signatures.get(fn);
    assert.ok(expected, `${fn} is not in the migration`);
    assert.deepEqual(["p_secret", ...Object.keys(args)].sort(), [...expected].sort(), fn);
    return { ok: true, data: answers[fn] };
  };
  const db = createSupabaseHackDb(rpc, { now: () => AT });
  const limit = { since: 0, perOwner: 5, perHunter: 3 };
  await db.open({ order, grant }, limit, AT);
  await db.open({ order, grant }, null, AT);
  await db.move(order.id, "pause", order.protocol, AT);
  await db.take({ order: order.id, hunter: "agent-7", owner: finding.hunterOwner, role: "attacker" }, limit, AT);
  await db.takes(order.id);
  await db.file({ finding, verdict: { status: "confirmed", reason: "COUNTS", severity: "high", payable: true, dedupeKey: hack.dedupeKey(finding), detail: "x" } }, { needTake: true, limit }, AT);
  await db.resolve({ id: finding.id, by: order.protocol, verdict: "confirm", payable: true }, AT);
  await db.filed(finding.id);
  await db.filedForOrder(order.id);
  await db.hit("ip:abc", 2, AT);
  await db.answer("k", AT);
  await db.keepAnswer("k", { status: 200 }, AT);
  await db.getOrder(order.id);
  await db.listOrders({ status: "open" });
  assert.deepEqual([...new Set(called)].sort(), [...signatures.keys()].sort(), "every function is used, none is missing");
});
