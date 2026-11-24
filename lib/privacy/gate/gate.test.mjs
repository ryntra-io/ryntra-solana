import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { answerFor, capLamports, capOf, stateOf } from "./answer.ts";
import { checkMove, localGate, serverGate, GATE_PATH, TALLY_PATH } from "./client.ts";
import { ADDRESS, MAX_ADDRESSES, addressesOf, answerJson, decide, readAnswer } from "./core.ts";
import { GATE_ENV, gateSettings } from "./settings.ts";
import { EMPTY_SOURCE, SILENT_SOURCE, listSource, screen, sourceFor } from "./sources.ts";
import { TALLY_MAX_LAMPORTS, dayOf, memoryTally, readReport, tallyJson, totalOf } from "./tally.ts";
import { PrivateError, giveBack, hide, makeLink, send, solText } from "../flows.ts";
import { RING_SOL } from "../network.ts";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const ME = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const FRIEND = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MARKED = "So11111111111111111111111111111111111111112";

const answer = (marks, more = {}) => ({ paused: false, cap: null, marks, ...more });
const hideOf = (amount = 10n) => ({ kind: "hide", owner: ME, amount });

/* ---------------- the decision ---------------- */

test("«Hide»: paused, flagged, unanswered and over the cap are refused, each with its own reason", () => {
  assert.deepEqual(decide(hideOf(), answer({ [ME]: "clear" })), { verdict: "pass" });
  assert.deepEqual(decide(hideOf(), answer({ [ME]: "clear" }, { paused: true })), { verdict: "refuse", code: "GATE_PAUSED" });
  assert.deepEqual(decide(hideOf(), answer({ [ME]: "flagged" }, { paused: true })), { verdict: "refuse", code: "GATE_PAUSED" }, "the pause speaks first");
  assert.deepEqual(decide(hideOf(), answer({ [ME]: "flagged" })), { verdict: "refuse", code: "GATE_FLAGGED" });
  assert.deepEqual(decide(hideOf(), answer({ [ME]: "unchecked" })), { verdict: "refuse", code: "GATE_UNCHECKED" });
  assert.deepEqual(decide(hideOf(), answer({})), { verdict: "refuse", code: "GATE_UNCHECKED" }, "an address missing from the answer is not clear");
  assert.deepEqual(decide(hideOf(), null), { verdict: "refuse", code: "GATE_UNCHECKED" }, "no answer is never a silent yes");
});

test("«Hide»: the cap counts what the private balance holds, and an unpriced cap holds the deposit", () => {
  const capped = (lamports) => answer({ [ME]: "clear" }, { cap: { lamports } });
  assert.deepEqual(decide(hideOf(40n), capped(100n), 60n), { verdict: "pass" }, "exactly up to the cap passes");
  assert.deepEqual(decide(hideOf(41n), capped(100n), 60n), { verdict: "refuse", code: "GATE_OVER_CAP", room: 40n });
  assert.deepEqual(decide(hideOf(1n), capped(100n), 150n), { verdict: "refuse", code: "GATE_OVER_CAP", room: 0n }, "already above — no room");
  assert.deepEqual(decide(hideOf(), capped(null), 0n), { verdict: "refuse", code: "GATE_UNCHECKED" }, "a cap set but not priced");
  assert.deepEqual(decide(hideOf(), capped(100n), null), { verdict: "refuse", code: "GATE_UNCHECKED" }, "a balance not read");
  assert.deepEqual(decide(hideOf(10n ** 15n), answer({ [ME]: "clear" }), null), { verdict: "pass" }, "no cap — no balance needed");
});

test("«Return» to one's own wallet is always open: paused, flagged, unanswered, or no gate at all", () => {
  const back = { kind: "return", owner: ME, to: ME };
  assert.deepEqual(addressesOf(back), [], "nothing is asked");
  for (const a of [null, answer({}), answer({ [ME]: "flagged" }, { paused: true }), answer({ [ME]: "unchecked" }, { paused: true, cap: { lamports: 0n } })]) {
    assert.deepEqual(decide(back, a), { verdict: "pass" }, JSON.stringify(a && answerJson(a)));
  }
});

test("out to anyone else: a flagged owner only back home, a flagged recipient refused, silence holds the move", () => {
  const out = (to) => ({ kind: "send", owner: ME, to });
  assert.deepEqual(decide(out(FRIEND), answer({ [ME]: "clear", [FRIEND]: "clear" })), { verdict: "pass" });
  assert.deepEqual(decide(out(FRIEND), answer({ [ME]: "clear", [FRIEND]: "clear" }, { paused: true })), { verdict: "pass" }, "the pause holds deposits only");
  assert.deepEqual(decide(out(FRIEND), answer({ [ME]: "flagged", [FRIEND]: "clear" })), { verdict: "back", code: "GATE_BACK_ONLY" });
  assert.deepEqual(decide(out(FRIEND), answer({ [ME]: "clear", [FRIEND]: "flagged" })), { verdict: "refuse", code: "GATE_FLAGGED_TO" });
  assert.deepEqual(decide(out(FRIEND), answer({ [ME]: "flagged", [FRIEND]: "flagged" })), { verdict: "refuse", code: "GATE_FLAGGED_TO" });
  assert.deepEqual(decide(out(FRIEND), answer({ [ME]: "clear", [FRIEND]: "unchecked" })), { verdict: "back", code: "GATE_UNCHECKED" });
  assert.deepEqual(decide(out(FRIEND), null), { verdict: "back", code: "GATE_UNCHECKED" });
  assert.deepEqual(decide(out(null), answer({ [ME]: "clear" })), { verdict: "pass" }, "a link: only the sender is asked");
  assert.deepEqual(decide(out(null), answer({ [ME]: "flagged" })), { verdict: "back", code: "GATE_BACK_ONLY" });
  assert.deepEqual(addressesOf(out(FRIEND)), [ME, FRIEND]);
  assert.deepEqual(addressesOf(out(null)), [ME]);
  assert.deepEqual(decide({ kind: "return", owner: ME, to: FRIEND }, answer({ [ME]: "flagged", [FRIEND]: "clear" })), { verdict: "back", code: "GATE_BACK_ONLY" }, "a withdrawal elsewhere follows the same rule");
  assert.ok(addressesOf(out(FRIEND)).length <= MAX_ADDRESSES);
});

test("the answer is read strictly: a mark it does not know is `unchecked`, a broken answer is none", () => {
  const asked = [ME, FRIEND];
  const ok = readAnswer({ paused: false, cap: { lamports: "5000000000" }, marks: { [ME]: "clear", [FRIEND]: "sanctioned-list-x", extra: "flagged" } }, asked);
  assert.deepEqual(ok, { paused: false, cap: { lamports: 5_000_000_000n }, marks: { [ME]: "clear", [FRIEND]: "unchecked" } }, "only the addresses asked, only the known marks");
  assert.deepEqual(readAnswer({ paused: true, cap: null }, [ME]).marks, { [ME]: "unchecked" });
  assert.deepEqual(readAnswer({ paused: false, cap: { lamports: null }, marks: {} }, [ME]).cap, { lamports: null });
  assert.deepEqual(readAnswer({ paused: false, cap: { lamports: "-1" }, marks: {} }, [ME]).cap, { lamports: null });
  for (const bad of [null, "x", {}, { paused: "no", cap: null }, { paused: false }, { paused: false, cap: 5 }]) assert.equal(readAnswer(bad, [ME]), null, JSON.stringify(bad));
  const there = { paused: true, cap: { lamports: 7n }, marks: { [ME]: "flagged" } };
  assert.deepEqual(readAnswer(JSON.parse(JSON.stringify(answerJson(there))), [ME]), there, "JSON there and back, amounts as text");
  assert.match(ME, ADDRESS);
  assert.doesNotMatch("0OIl" + ME.slice(4), ADDRESS);
});

/* ---------------- settings and sources ---------------- */

test("settings: one switch pauses deposits; the cap and the source are read, never guessed", () => {
  for (const on of ["1", "true", "TRUE", " on ", "yes"]) assert.equal(gateSettings({ [GATE_ENV.pause]: on }).paused, true, on);
  for (const off of [undefined, "", "0", "false", "off", "no", "paused?"]) assert.equal(gateSettings({ [GATE_ENV.pause]: off }).paused, false, String(off));
  assert.equal(gateSettings({}).capUsd, null, "no cap unless the owner sets one");
  assert.equal(gateSettings({ [GATE_ENV.capUsd]: "1000" }).capUsd, 1000);
  assert.equal(gateSettings({ [GATE_ENV.capUsd]: "1 000" }).capUsd, 1000);
  assert.equal(gateSettings({ [GATE_ENV.capUsd]: "2500.5" }).capUsd, 2500.5);
  for (const bad of ["0", "-5", "$1000", "abc", "1e3"]) assert.equal(gateSettings({ [GATE_ENV.capUsd]: bad }).capUsd, "unreadable", bad);
  assert.equal(gateSettings({}).source, "none");
  assert.equal(gateSettings({ [GATE_ENV.source]: "List" }).source, "list");
  assert.equal(gateSettings({ [GATE_ENV.source]: "some-provider" }).source, "silent", "a provider not connected yet is silence, not a pass");
  assert.deepEqual(gateSettings({ [GATE_ENV.list]: `${ME}, ${FRIEND}\nnot-an-address ${ME}` }).list, [ME, FRIEND]);
  for (const name of Object.values(GATE_ENV)) assert.doesNotMatch(name, /^NEXT_PUBLIC/, `${name} stays on the server`);
  assert.equal(sourceFor(gateSettings({})), EMPTY_SOURCE);
  assert.equal(sourceFor(gateSettings({ [GATE_ENV.source]: "silent" })), SILENT_SOURCE);
});

test("a source that throws, answers nothing or runs past the deadline leaves every address `unchecked`", async () => {
  const both = [ME, FRIEND];
  assert.deepEqual(await screen(EMPTY_SOURCE, both, { testNetwork: true }), { [ME]: "clear", [FRIEND]: "clear" });
  assert.deepEqual(await screen(EMPTY_SOURCE, both, { testNetwork: false }), { [ME]: "unchecked", [FRIEND]: "unchecked" }, "the empty stand-in counts on the test network only");
  assert.deepEqual(await screen(listSource([FRIEND]), both, { testNetwork: false }), { [ME]: "clear", [FRIEND]: "flagged" });
  assert.deepEqual(await screen(SILENT_SOURCE, both, { testNetwork: true }), { [ME]: "unchecked", [FRIEND]: "unchecked" });
  const throws = { empty: false, flagged: async () => Promise.reject(new Error("503")) };
  assert.deepEqual(await screen(throws, [ME], { testNetwork: true }), { [ME]: "unchecked" });
  let aborted = false;
  const hangs = { empty: false, flagged: (_a, signal) => new Promise(() => signal.addEventListener("abort", () => (aborted = true))) };
  const started = Date.now();
  assert.deepEqual(await screen(hangs, [ME], { testNetwork: true, deadlineMs: 30 }), { [ME]: "unchecked" });
  assert.ok(Date.now() - started < 2_000 && aborted, "the deadline ends the call");
  assert.deepEqual(await screen(listSource([ME]), [], { testNetwork: true }), {});
});

test("the cap is the owner's dollars in lamports at today's price; no price — no cap check passes", async () => {
  const deps = (env, solUsd = async () => 200, testNetwork = true) => ({ settings: gateSettings(env), source: EMPTY_SOURCE, testNetwork, solUsd });
  assert.equal(capLamports(1000, 200), 5_000_000_000n);
  assert.equal(capLamports(1000, null), null);
  assert.equal(capLamports(1000, 0), null);
  assert.equal(capLamports(1000, Number.NaN), null);
  let asked = 0;
  assert.equal(await capOf(deps({}, async () => (asked += 1, 200))), null);
  assert.equal(asked, 0, "no cap — no price is fetched");
  assert.deepEqual(await capOf(deps({ [GATE_ENV.capUsd]: "1000" })), { lamports: 5_000_000_000n });
  assert.deepEqual(await capOf(deps({ [GATE_ENV.capUsd]: "1000" }, async () => null)), { lamports: null });
  assert.deepEqual(await capOf(deps({ [GATE_ENV.capUsd]: "1000" }, async () => Promise.reject(new Error("down")))), { lamports: null });
  assert.deepEqual(await capOf(deps({ [GATE_ENV.capUsd]: "abc" })), { lamports: null }, "a cap that does not read holds deposits");
  assert.deepEqual(await capOf(deps({}, undefined, false)), { lamports: null }, "off the test network a cap must be set");
  assert.deepEqual(await stateOf(deps({ [GATE_ENV.pause]: "1" })), { paused: true, cap: null });
  const full = await answerFor([ME, FRIEND], { ...deps({ [GATE_ENV.pause]: "on" }), source: listSource([ME]) });
  assert.deepEqual(full, { paused: true, cap: null, marks: { [ME]: "flagged", [FRIEND]: "clear" } });
  assert.deepEqual(Object.keys(answerJson(full)).sort(), ["cap", "marks", "paused"], "the answer carries no list name, no source, no reason");
});

/* ---------------- the client ---------------- */

const gateOf = (reply, seen = []) => ({ ask: async (addresses) => (seen.push(addresses), typeof reply === "function" ? reply(addresses) : reply), landed: () => undefined });

test("the client: back home asks nothing; the balance is read only for a cap; a gate down is no answer", async () => {
  const nobody = { ask: () => Promise.reject(new Error("must not be asked")), landed: () => undefined };
  assert.deepEqual(await checkMove(nobody, { kind: "return", owner: ME, to: ME }), { verdict: "pass" });
  assert.deepEqual(await checkMove(nobody, hideOf()), { verdict: "refuse", code: "GATE_UNCHECKED" }, "a gate that throws is silence");
  let reads = 0;
  const held = async () => (reads += 1, 90n);
  assert.deepEqual(await checkMove(gateOf(answer({ [ME]: "clear" })), hideOf(), held), { verdict: "pass" });
  assert.equal(reads, 0, "no cap — the balance is not read");
  assert.deepEqual(await checkMove(gateOf(answer({ [ME]: "clear" }, { cap: { lamports: 100n } })), hideOf(11n), held), { verdict: "refuse", code: "GATE_OVER_CAP", room: 10n });
  assert.equal(reads, 1);
  assert.deepEqual(await checkMove(gateOf(answer({ [ME]: "clear" }, { cap: { lamports: 100n } })), hideOf(1n), async () => Promise.reject(new Error("x"))), { verdict: "refuse", code: "GATE_UNCHECKED" });
  const seen = [];
  await checkMove(gateOf(answer({ [ME]: "clear", [FRIEND]: "clear" }), seen), { kind: "send", owner: ME, to: FRIEND });
  assert.deepEqual(seen, [[ME, FRIEND]]);
});

test("the server gate posts the addresses in the body, reads the answer strictly, and counting never fails a step", async () => {
  const calls = [];
  const fake = (reply) => async (url, init) => (calls.push({ url, init }), typeof reply === "function" ? reply() : reply);
  const ok = serverGate("https://ryntra.test", fake(new Response(JSON.stringify({ paused: false, cap: null, marks: { [ME]: "flagged" } }), { status: 200 })));
  assert.deepEqual(await ok.ask([ME]), { paused: false, cap: null, marks: { [ME]: "flagged" } });
  assert.equal(calls[0].url, `https://ryntra.test${GATE_PATH}`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { addresses: [ME] });
  assert.equal(await serverGate("https://r", fake(new Response("", { status: 503 }))).ask([ME]), null);
  assert.equal(await serverGate("https://r", fake(new Response("not json", { status: 200 }))).ask([ME]), null);
  assert.equal(await serverGate("https://r", async () => Promise.reject(new Error("offline"))).ask([ME]), null);
  const counted = [];
  serverGate("https://r", async (url, init) => (counted.push({ url, body: JSON.parse(init.body) }), new Response(null, { status: 204 }))).landed("in", 20_000_000n);
  serverGate("https://r", async () => Promise.reject(new Error("offline"))).landed("out", 1n);
  serverGate("https://r", () => {
    throw new Error("sync throw");
  }).landed("out", 1n);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(counted, [{ url: `https://r${TALLY_PATH}`, body: { move: "in", lamports: "20000000" } }], "only the move and the amount");
});

test("in a script the same rules run in place from its own settings", async () => {
  assert.deepEqual(await checkMove(localGate({}), hideOf()), { verdict: "pass" }, "nothing set: the test network's empty list, no pause, no cap");
  assert.deepEqual(await checkMove(localGate({ [GATE_ENV.pause]: "1" }), hideOf()), { verdict: "refuse", code: "GATE_PAUSED" });
  assert.deepEqual(await checkMove(localGate({ [GATE_ENV.source]: "list", [GATE_ENV.list]: ME }), hideOf()), { verdict: "refuse", code: "GATE_FLAGGED" });
  assert.deepEqual(await checkMove(localGate({ [GATE_ENV.capUsd]: "1000" }), hideOf(), async () => 0n), { verdict: "refuse", code: "GATE_UNCHECKED" }, "no price in a script: a cap set there holds «Hide»");
});

/* ---------------- the steps ---------------- */

function fakeCtx(gate) {
  const built = [];
  const counted = [];
  const tx = (kind, args) => (built.push({ kind, args }), { messageBytes: new Uint8Array([built.length]) });
  const sdk = {
    SOL_MINT: RING_SOL,
    buildDepositTransaction: async (args) => tx("deposit", args),
    buildWithdrawalTransaction: async (args) => tx("withdraw", args),
    buildTransferTransaction: async (args) => tx("transfer", args),
    buildRegistrationTransaction: async (args) => tx("register", args),
    getTransactionEncoder: () => ({ encode: (t) => t.messageBytes }),
    getTransactionDecoder: () => ({ decode: (wire) => ({ messageBytes: wire }) }),
    getSignatureFromTransaction: () => "sig",
    syncWallet: async () => undefined,
    getPrivateTokenBalances: () => [{ mint: RING_SOL, amount: 70n }],
  };
  const client = {
    solanaRpc: { sendTransaction: () => ({ send: async () => "sig" }) },
    confirmTransaction: async () => 9n,
    getUserRecords: async () => ({ records: [{}] }),
  };
  const counting = gate && { ask: gate.ask, landed: (move, lamports) => counted.push([move, lamports]) };
  return { ctx: { sdk, client, gate: counting }, built, counted };
}
const wallet = { address: ME, signWire: async (wire) => wire };
const book = { wallet: {}, keys: { address: () => "shielded" }, owner: ME };
const refusedWith = (code) => (error) => error instanceof PrivateError && error.code === code;

test("«Return» goes through with deposits paused, the owner flagged and the gate down — and is counted out", async () => {
  const { ctx, built, counted } = fakeCtx({ ask: () => Promise.reject(new Error("must not be asked")) });
  const landed = await giveBack(ctx, wallet, book, 5_000_000n);
  assert.equal(landed.signature, "sig");
  assert.equal(built[0].kind, "withdraw");
  assert.equal(built[0].args.recipient, ME, "back to the wallet's own address");
  assert.deepEqual(counted, [["out", 5_000_000n]]);
  const paused = fakeCtx(gateOf(answer({ [ME]: "flagged" }, { paused: true })));
  await giveBack(paused.ctx, wallet, book, 1n);
  assert.equal(paused.built[0].kind, "withdraw");
});

test("«Hide» refused builds and signs nothing; passed, it is counted in", async () => {
  for (const [reply, codeWanted] of [
    [answer({ [ME]: "clear" }, { paused: true }), "GATE_PAUSED"],
    [answer({ [ME]: "flagged" }), "GATE_FLAGGED"],
    [null, "GATE_UNCHECKED"],
  ]) {
    const { ctx, built, counted } = fakeCtx(gateOf(reply));
    await assert.rejects(hide(ctx, { ...wallet, signWire: () => assert.fail("nothing is signed") }, book, 10n), refusedWith(codeWanted));
    assert.deepEqual(built, [], codeWanted);
    assert.deepEqual(counted, []);
  }
  const over = fakeCtx(gateOf(answer({ [ME]: "clear" }, { cap: { lamports: 100n } })));
  await assert.rejects(hide(over.ctx, wallet, book, 31n), (e) => e instanceof PrivateError && e.code === "GATE_OVER_CAP" && e.message === solText(30n));
  const ok = fakeCtx(gateOf(answer({ [ME]: "clear" })));
  await hide(ok.ctx, wallet, book, 20_000_000n);
  assert.equal(ok.built[0].kind, "deposit");
  assert.deepEqual(ok.counted, [["in", 20_000_000n]]);
});

test("a private send and a link pass the gate before anything is built", async () => {
  const toMarked = fakeCtx(gateOf(answer({ [ME]: "clear", [MARKED]: "flagged" })));
  await assert.rejects(send(toMarked.ctx, wallet, book, MARKED, 1_000_000n), refusedWith("GATE_FLAGGED_TO"));
  assert.deepEqual(toMarked.built, []);
  const fromMarked = fakeCtx(gateOf(answer({ [ME]: "flagged", [FRIEND]: "clear" })));
  await assert.rejects(send(fromMarked.ctx, wallet, book, FRIEND, 1_000_000n), refusedWith("GATE_BACK_ONLY"));
  let remembered = false;
  await assert.rejects(makeLink(fromMarked.ctx, wallet, book, 2_000_000n, new Uint8Array(32), async () => void (remembered = true)), refusedWith("GATE_BACK_ONLY"));
  assert.equal(remembered, false, "the link is not even made");
  assert.deepEqual(fromMarked.built, []);
  const fine = fakeCtx(gateOf(answer({ [ME]: "clear", [FRIEND]: "clear" })));
  await send(fine.ctx, wallet, book, FRIEND, 1_000_000n);
  assert.equal(fine.built[0].kind, "transfer");
  assert.deepEqual(fine.counted, [], "a private send stays in the ring: not counted");
});

test("without a gate of its own, a script's steps run the rules in place — the test-network pass keeps working", async () => {
  const { ctx, built } = fakeCtx(null);
  delete ctx.gate;
  for (const name of Object.values(GATE_ENV)) assert.equal(process.env[name], undefined, `${name} is not set for this test`);
  await hide(ctx, wallet, book, 1_000n);
  assert.equal(built[0].kind, "deposit");
});

/* ---------------- «in — out» ---------------- */

test("«in — out» keeps counts and sums per day — no address, no signature, no one person's amount", async () => {
  assert.deepEqual(readReport({ move: "in", lamports: "20000000" }), { move: "in", lamports: 20_000_000n });
  for (const bad of [null, {}, { move: "in" }, { move: "sideways", lamports: "1" }, { move: "out", lamports: "0" }, { move: "out", lamports: "-1" }, { move: "out", lamports: 5 }, { move: "out", lamports: "1.5" }, { move: "in", lamports: (TALLY_MAX_LAMPORTS + 1n).toString() }]) {
    assert.equal(readReport(bad), null, JSON.stringify(bad));
  }
  assert.equal(dayOf(Date.UTC(2026, 10, 19, 23, 59)), "2026-11-19");
  const store = memoryTally(2);
  await store.add("2026-11-18", "in", 5n);
  await store.add("2026-11-19", "in", 20n);
  await store.add("2026-11-19", "in", 30n);
  await store.add("2026-11-19", "out", 7n);
  const days = await store.read();
  assert.deepEqual(days, [
    { day: "2026-11-19", in: { count: 2, lamports: 50n }, out: { count: 1, lamports: 7n } },
    { day: "2026-11-18", in: { count: 1, lamports: 5n }, out: { count: 0, lamports: 0n } },
  ]);
  assert.deepEqual(totalOf(days), { in: { count: 3, lamports: 55n }, out: { count: 1, lamports: 7n } });
  await store.add("2026-11-20", "out", 1n);
  assert.deepEqual((await store.read()).map((d) => d.day), ["2026-11-20", "2026-11-19"], "the oldest day goes when the store is full");
  const json = tallyJson(days);
  assert.deepEqual(json.total.in, { count: 3, lamports: "55" });
  assert.deepEqual(Object.keys(json.days[0]).sort(), ["day", "in", "out"]);
});

/* ---------------- the routes ---------------- */

test("the gate's routes are shut unless the switch opens a network, take addresses in the body only, and keep nothing", () => {
  for (const path of ["app/api/v1/privacy/gate/route.ts", "app/api/v1/privacy/gate/tally/route.ts"]) {
    const route = code(path);
    const handlers = route.split(/export async function (?=GET|POST)/).slice(1);
    assert.equal(handlers.length, 2, path);
    for (const handler of handlers) assert.match(handler, /^\w+\(request: Request\): Promise<Response> \{\s*if \(!openNetwork\(\)\) return new NextResponse\(null, \{ status: 404 \}\);/, `${path}: shut without the flag (and, for mainnet, its key)`);
    const post = handlers.find((h) => h.startsWith("POST"));
    assert.match(post, /if \(!sameSite\(request\.headers\)\) return new NextResponse\(null, \{ status: 403 \}\)/, `${path}: from this site only`);
    assert.ok(post.indexOf('request.headers.get("content-length")') < post.indexOf("await request.text()"), `${path}: the size is checked before the body is read`);
    assert.doesNotMatch(route, /console\.|searchParams|NEXT_PUBLIC_(?!RYNTRA_PRIVATE)|mainnet/i, `${path}: no log, no address in the URL, nothing public`);
  }
  const gate = code("app/api/v1/privacy/gate/route.ts");
  assert.match(gate, /answerJson\(answer\)/, "the answer is the marks and the state, nothing about which list");
  assert.match(gate, /gateSettings\(process\.env\)/, "settings are read on the server at the moment of the question");
});

test("the steps ask the gate before anything is built, and «Return» only ever goes home", () => {
  const flows = code("lib/privacy/flows.ts");
  const body = (name) => flows.slice(flows.indexOf(`export async function ${name}(`), flows.indexOf("\n}\n", flows.indexOf(`export async function ${name}(`)));
  for (const [name, build] of [["hide", "buildDepositTransaction"], ["giveBack", "buildWithdrawalTransaction"], ["send", "buildTransferTransaction"], ["makeLink", "linkWallet"]]) {
    const fn = body(name);
    assert.ok(fn.includes("await passGate(") && fn.indexOf("await passGate(") < fn.indexOf(build), `${name}: the gate comes first`);
  }
  assert.match(body("giveBack"), /passGate\(ctx, \{ kind: 'return', owner: wallet\.address, to: wallet\.address \}\)/);
  assert.match(body("giveBack"), /recipient: wallet\.address/);
});
