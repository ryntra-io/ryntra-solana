/* The door of a paper week's start (`./door.server.ts`), the last MAJOR of the review of 21.11: a start is the
   proven wallet's own, and its limits are the wallet's, not the address it asks from. Each attack played against the door
   with the paper service and a store in memory behind it: no proof, a forged `Origin`, another wallet's proof, a proof that
   lapsed or a signed message pasted into the body, the wallet's limit asked from two addresses, and the address's own
   guard. The proof is the real rule (`lib/account/wallet-session.ts`, as `requireWalletProof` reads a browser's cookies)
   over sessions written here. Nothing reaches a network, a wallet or a key. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Keypair } from "@solana/web3.js";

import { FixedWindowLimiter } from "../../http-control.ts";
import { intentWalletProof, readCookieWalletProof } from "../../account/wallet-session.ts";
import { answerPaperClose, answerPaperStart, paperOriginAllowed, PAPER_START_IP } from "./door.server.ts";
import { closePaper, paperIdOf, paperKeyOf, PAPER_SECRET_MIN, readPaper, whoOf } from "./service.server.ts";
import { createMemoryPaperStore, PAPER_STARTS } from "./store.ts";

const SITE = "https://ryntra.io";
const SECRET = "server-key-of-the-test-0123456789";
const SOL = 1_000_000_000n;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
const COIN = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const wallet = () => Keypair.generate().publicKey.toBase58();
const PERSON = wallet();
const STRANGER = wallet();

/* ---------------------------------------------------------------- the world: sessions, a store, live reads */

/**
 * The sessions the session store holds, and the proof as `requireWalletProof` reads a browser's: the `rw` proof a wallet
 * signed, the account's session `rt` (a wallet sign-in, or a wallet the account only linked — which proves nothing for a
 * change), read by the real rule (`readCookieWalletProof` under `intentWalletProof("mutation")`); the phone's bearer.
 * A cookie's token is `tok:<session id>`: the token's signature is the session layer's; what this door must hold is
 * that a session the store no longer answers proves nothing.
 */
function sessionsOf() {
  const sessions = new Map();
  const bearers = new Map();
  let asked = 0;
  const deps = {
    verify: (token) => (token.startsWith("tok:") ? { subject: { kind: "session", sessionId: token.slice(4) }, admin: false } : null),
    resolve: async (id) => sessions.get(id) ?? { status: "refused", reason: "not_found" },
  };
  const prove = async (request) => {
    asked += 1;
    const bearer = /^Bearer (\S+)$/u.exec(request.headers.get("authorization") ?? "")?.[1];
    if (bearer) {
      const address = bearers.get(bearer);
      return address ? { ok: true, address } : { ok: false, response: Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }) };
    }
    const cookie = request.headers.get("cookie") ?? "";
    const of = (name) => new RegExp(`(?:^|; )${name}=([^;]+)`, "u").exec(cookie)?.[1] ?? null;
    const read = await intentWalletProof("mutation", (options) => readCookieWalletProof({ rw: of("rw"), rt: of("rt"), linked: of("rwl") }, deps, options));
    if (read.status === "unavailable") return { ok: false, response: Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 }) };
    if (read.status !== "ok" || read.proof.chain !== "solana") return { ok: false, response: Response.json({ error: { code: "UNAUTHORIZED", message: "No proven wallet: sign in with the wallet first." } }, { status: 401 }) };
    return { ok: true, address: read.proof.address };
  };
  /** The proof a wallet signed (`prove`): its own session, answered while it lives. */
  const signed = (id, address) => sessions.set(id, { status: "ok", session: { id, kind: "wallet", method: "solana_siws", accountId: null, walletChain: "solana", walletAddress: address, authSessionId: null, issuedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + HOUR).toISOString(), mfaVerifiedAt: null, state: null, account: null } });
  /** The wallet's own sign-in (`rt`, `solana_siws`): proves the address it signed with while the account still links it. */
  const signedIn = (id, address) => sessions.set(id, { status: "ok", session: { id, kind: "customer", method: "solana_siws", accountId: `acc-${id}`, walletChain: "solana", walletAddress: address, authSessionId: null, issuedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + HOUR).toISOString(), mfaVerifiedAt: null, state: null, account: { authUserId: null, telegramLinked: false, operator: false, wallets: [{ chain: "solana", address }] } } });
  return { sessions, bearers, prove, signed, signedIn, asked: () => asked };
}

/** Live reads at a steady price: a quote both ways and the table's rate. Counts how often a coin's reads were opened. */
function readsOf() {
  let opened = 0;
  const price = 2_000_000n;
  const reads = {
    buy: async (lamports) => (lamports * 1_000_000n * 9_980n) / (price * 10_000n),
    worth: async (coins) => (coins * price * 9_980n) / (1_000_000n * 10_000n),
    fees: async () => ({ buyBps: 10, sellBps: 10 }),
  };
  return { reads: () => ((opened += 1), reads), opened: () => opened };
}

function worldOf(options = {}) {
  let now = T0;
  const store = createMemoryPaperStore({ now: () => now });
  const live = readsOf();
  const session = sessionsOf();
  const deps = (extra = {}) => ({ paper: { store, reads: live.reads, now: () => now }, secret: SECRET, prove: session.prove, window: options.window ?? new FixedWindowLimiter({ ...PAPER_START_IP, maxKeys: 100 }), ...extra });
  return { store, live, session, deps, at: (ms) => (now = ms), now: () => now };
}

const startBody = (overrides = {}) => ({ owner: PERSON, coin: COIN, symbol: "JUP", plan: "steady", perDay: (SOL / 10n).toString(), perTrade: (SOL / 50n).toString(), days: 30, ...overrides });

const requestOf = (body, headers = {}, ip = "198.51.100.7") =>
  new Request(`${SITE}/api/bots/mandate/paper`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-for": ip, ...headers },
    body: JSON.stringify(body),
  });

const start = (world, body, headers, ip, extra) => answerPaperStart(requestOf(body, headers, ip), body, world.deps(extra));
const codeOf = (answer) => answer.body?.error?.code ?? null;

/* ---------------------------------------------------------------- refusals */

test("no proof: `curl` with this site's Origin and nothing signed starts nothing — 401, no quote, no attempt counted", async () => {
  const world = worldOf();
  for (const headers of [{}, { "sec-fetch-site": "same-origin" }, { cookie: "rwl=" + PERSON }]) {
    const answer = await start(world, startBody(), headers);
    assert.equal(answer.status, 401, JSON.stringify(headers));
    assert.equal(codeOf(answer), "UNAUTHORIZED");
    assert.equal(answer.body.error.proof, false, "the screen knows to ask for the one signature");
  }
  assert.equal(world.live.opened(), 0, "nothing asked of Jupiter");
  assert.equal(world.store.starts.length, 0, "no attempt counted against anyone");
  assert.equal(world.store.rows.size, 0);
});

test("a browser from another site is refused before its proof or its body are read — 403", async () => {
  const world = worldOf();
  world.session.signed("s-person", PERSON);
  for (const origin of ["https://elsewhere.example", "null", "https://ryntra.io.evil.example"]) {
    const answer = await start(world, startBody(), { origin, cookie: "rw=tok:s-person" });
    assert.equal(answer.status, 403, origin);
    assert.equal(codeOf(answer), "FORBIDDEN_ORIGIN");
  }
  /* No Origin at all: only the browser's own same-origin word passes; a bare request does not. */
  const bare = new Request(`${SITE}/api/bots/mandate/paper`, { method: "POST", headers: { "x-forwarded-for": "198.51.100.9", cookie: "rw=tok:s-person" }, body: "{}" });
  assert.equal(paperOriginAllowed(bare), false);
  assert.equal(world.session.asked(), 0, "the proof was never read");
  assert.equal(world.store.rows.size, 0);
});

test("another wallet's proof: a signed proof, a sign-in or the phone's bearer of one wallet never starts paper for another — 403", async () => {
  const world = worldOf();
  world.session.signed("s-stranger", STRANGER);
  world.session.signedIn("s-stranger-in", STRANGER);
  world.session.bearers.set("phone-stranger", STRANGER);
  for (const headers of [{ cookie: "rw=tok:s-stranger" }, { cookie: "rt=tok:s-stranger-in" }, { origin: "", authorization: "Bearer phone-stranger" }]) {
    const answer = await start(world, startBody({ owner: PERSON }), headers);
    assert.equal(answer.status, 403, JSON.stringify(headers));
    assert.equal(codeOf(answer), "WALLET_MISMATCH");
  }
  /* A wallet the account only linked is no proof for a change at all. */
  world.session.sessions.set("s-email", { status: "ok", session: { id: "s-email", kind: "customer", method: "email_password", accountId: "acc-1", walletChain: null, walletAddress: null, authSessionId: null, issuedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + HOUR).toISOString(), mfaVerifiedAt: null, state: null, account: { authUserId: null, telegramLinked: false, operator: false, wallets: [{ chain: "solana", address: PERSON }] } } });
  assert.equal((await start(world, startBody(), { cookie: `rt=tok:s-email; rwl=${PERSON}` })).status, 401, "a link proves a wallet for reading only");
  assert.equal(world.store.starts.length, 0);
  assert.equal(world.store.rows.size, 0);
  assert.equal(world.live.opened(), 0);
});

test("an old proof replayed: a session that lapsed, was revoked or went idle proves nothing; a signed message in the body proves nothing", async () => {
  const world = worldOf();
  for (const reason of ["expired", "revoked", "idle", "not_found"]) {
    world.session.sessions.set(`s-${reason}`, { status: "refused", reason });
    const answer = await start(world, startBody(), { cookie: `rw=tok:s-${reason}` });
    assert.equal(answer.status, 401, reason);
    assert.equal(codeOf(answer), "UNAUTHORIZED");
  }
  /* What a wallet once signed, captured and posted again — in the body, with a key of the attacker's own choosing. The door
     trusts the session store's proof and nothing a request carries: the signed message is spent at sign-in
     (`/api/auth/solana`: a nonce of this server, consumed once), and a body never names whose week it is. */
  const pasted = startBody({ signedMessage: Buffer.from("ryntra.io wants you to sign in with your Solana account").toString("base64"), signature: "1".repeat(88), key: "k".repeat(43) });
  const answer = await start(world, pasted, {});
  assert.equal(answer.status, 401);
  assert.equal(world.store.rows.size, 0);
  assert.equal(world.store.starts.length, 0);
  /* The session store silent: said as such, never as «no proof» and never as a start. */
  world.session.sessions.set("s-dark", { status: "unavailable" });
  assert.equal((await start(world, startBody(), { cookie: "rw=tok:s-dark" })).status, 503);
});

/* ---------------------------------------------------------------- the wallet's own start */

test("the wallet's own: one signed proof starts paper on the wallet's own key; a second tap answers the same week and spends nothing", async () => {
  const world = worldOf();
  world.session.signed("s-person", PERSON);
  const first = await start(world, startBody({ key: "k".repeat(43) }), { cookie: "rw=tok:s-person" });
  assert.equal(first.status, 201);
  assert.equal(first.body.already, false);
  const key = paperKeyOf(PERSON, SECRET);
  assert.equal(first.body.key, key, "the week's key is the wallet's, never one the body named");
  assert.ok(world.store.rows.has(paperIdOf(key)), "the store keeps the sha256 of the key only");
  assert.equal(world.store.rows.has(paperIdOf("k".repeat(43))), false);
  assert.equal(first.body.paper.status, "working");
  assert.deepEqual(world.store.starts.map((one) => one.who), [whoOf(`wallet:${PERSON}`, SECRET)], "the ledger counts the wallet, as an HMAC");
  assert.ok(!JSON.stringify([...world.store.rows.values()]).includes(PERSON), "no address in the store");
  /* Read with the key the answer carried — from any browser that has it. */
  assert.equal((await readPaper(key, world.deps().paper)).view.status, "working");
  /* The phone's bearer of the same wallet, from another address: the same week, no new attempt, no quote. */
  world.session.bearers.set("phone-person", PERSON);
  const opened = world.live.opened();
  const again = await start(world, startBody({ plan: "dip:800" }), { origin: "", authorization: "Bearer phone-person" }, "203.0.113.50");
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
  assert.equal(again.body.key, key);
  assert.equal(world.store.starts.length, 1, "one week at a time per wallet: the second tap is no attempt");
  assert.equal(world.live.opened(), opened);
  /* Not an address: refused before the proof. */
  assert.equal((await start(world, startBody({ owner: "nobody" }), { cookie: "rw=tok:s-person" })).status, 400);
});

test("the lead's review of #1971: «End» and «Start with money» close only the proven wallet's own week — never one a key in the body names", async () => {
  const world = worldOf();
  world.session.signed("s-person", PERSON);
  world.session.signed("s-stranger", STRANGER);
  const started = await start(world, startBody(), { cookie: "rw=tok:s-person" });
  assert.equal(started.status, 201);
  const key = started.body.key;
  const close = (body, headers, to = "ended") => answerPaperClose(requestOf(body, headers), body, to, world.deps());
  /* The key alone — once leaked from a browser — ends nothing: no proof, 401. */
  const bare = await close({ owner: PERSON, action: "end", key }, {});
  assert.equal(bare.status, 401);
  assert.equal((await readPaper(key, world.deps().paper)).view.status, "working", "the week is still at work");
  /* Another wallet's proof, naming her wallet or carrying her key: 403, or its own (empty) week. */
  assert.equal((await close({ owner: PERSON, action: "end", key }, { cookie: "rw=tok:s-stranger" })).status, 403);
  const own = await close({ owner: STRANGER, action: "end", key }, { cookie: "rw=tok:s-stranger" });
  assert.deepEqual([own.status, own.body.paper], [200, null], "the stranger's own wallet has no week; hers is untouched");
  assert.equal((await readPaper(key, world.deps().paper)).view.status, "working");
  /* Another site: refused before the proof. */
  assert.equal((await close({ owner: PERSON, action: "end" }, { origin: "https://evil.example" })).status, 403);
  /* Her own proof: her week ends. */
  const ended = await close({ owner: PERSON, action: "end" }, { cookie: "rw=tok:s-person" });
  assert.equal(ended.status, 200);
  assert.equal(ended.body.paper.status, "ended");
  /* Without the server's key the door names no week. */
  assert.equal((await answerPaperClose(requestOf({ owner: PERSON, action: "live" }, { cookie: "rw=tok:s-person" }), { owner: PERSON }, "live", { ...world.deps(), secret: null })).status, 503);
});

test("the wallet's limit holds from two addresses: three starts an hour, eight a day — the fourth is 429 with its reason", async () => {
  const world = worldOf();
  world.session.signed("s-person", PERSON);
  world.session.signed("s-stranger", STRANGER);
  const key = paperKeyOf(PERSON, SECRET);
  const ips = ["198.51.100.7", "203.0.113.50"];
  for (let n = 0; n < PAPER_STARTS.perHour; n += 1) {
    const answer = await start(world, startBody(), { cookie: "rw=tok:s-person" }, ips[n % 2]);
    assert.equal(answer.status, 201, `start ${n + 1} from ${ips[n % 2]}`);
    assert.equal((await closePaper(key, "ended", world.deps().paper)).ok, true, "ended, so the next one is a new start");
  }
  const opened = world.live.opened();
  for (const ip of ips) {
    const limited = await start(world, startBody(), { cookie: "rw=tok:s-person" }, ip);
    assert.equal(limited.status, 429, ip);
    assert.equal(codeOf(limited), "PAPER_LIMITED");
    assert.equal(limited.body.error.reason, "wallet", "the honest reason: this wallet's starts, not the network");
  }
  assert.equal(world.live.opened(), opened, "a refused start asks Jupiter nothing");
  /* Another wallet from the very same addresses is not held by this one. */
  assert.equal((await start(world, startBody({ owner: STRANGER }), { cookie: "rw=tok:s-stranger" }, ips[0])).status, 201);
  /* The hour over, the wallet starts again — up to eight a day. */
  world.at(T0 + HOUR + 1);
  for (let n = PAPER_STARTS.perHour; n < PAPER_STARTS.perDay; n += 1) {
    if (n === 6) world.at(T0 + 2 * HOUR + 2);
    const answer = await start(world, startBody(), { cookie: "rw=tok:s-person" }, ips[n % 2]);
    assert.equal(answer.status, 201, `start ${n + 1} of the day`);
    await closePaper(key, "ended", world.deps().paper);
  }
  world.at(T0 + 3 * HOUR + 3);
  const day = await start(world, startBody(), { cookie: "rw=tok:s-person" }, "192.0.2.77");
  assert.equal(day.status, 429, "eight a day, from any address");
  assert.equal(day.body.error.reason, "wallet");
});

test("the address's own guard stands apart: many wallets from one address are held by it, and it holds no other address", async () => {
  const window = new FixedWindowLimiter({ limit: 3, windowMs: HOUR, maxKeys: 100 });
  const world = worldOf({ window });
  const wallets = Array.from({ length: 5 }, () => wallet());
  wallets.forEach((address, at) => world.session.signed(`s-${at}`, address));
  for (let at = 0; at < 3; at += 1) assert.equal((await start(world, startBody({ owner: wallets[at] }), { cookie: `rw=tok:s-${at}` }, "198.51.100.7")).status, 201);
  const asked = world.session.asked();
  const flood = await start(world, startBody({ owner: wallets[3] }), { cookie: "rw=tok:s-3" }, "198.51.100.7");
  assert.equal(flood.status, 429);
  assert.equal(codeOf(flood), "RATE_LIMITED");
  assert.equal(flood.body.error.reason, "ip");
  assert.ok(flood.retryAfterSeconds > 0, "when to try again");
  assert.equal(world.session.asked(), asked, "a flood is refused before the proof is read");
  assert.equal(world.store.starts.length, 3, "and before the ledger counts it against the wallet");
  /* The same wallet from another address starts: the address held, never the wallet. */
  assert.equal((await start(world, startBody({ owner: wallets[3] }), { cookie: "rw=tok:s-3" }, "203.0.113.50")).status, 201);
  /* The deployment's guard is wider than a wallet's limit: people behind one shared address are not held by each other. */
  assert.ok(PAPER_START_IP.limit > PAPER_STARTS.perHour * 5);
  assert.equal(PAPER_START_IP.windowMs, HOUR);
});

test("without the server's key the door names no wallet's week: 503, nothing admitted", async () => {
  for (const secret of [null, "", "short"]) {
    const world = worldOf();
    world.session.signed("s-person", PERSON);
    const answer = await start(world, startBody(), { cookie: "rw=tok:s-person" }, undefined, { secret });
    assert.equal(answer.status, 503, String(secret));
    assert.equal(codeOf(answer), "PAPER_UNAVAILABLE");
    assert.equal(world.store.starts.length, 0);
    assert.equal(world.store.rows.size, 0);
  }
});

test("the wallet's key: the browser key's shape, the same for one wallet, another for another wallet or server key", () => {
  const key = paperKeyOf(PERSON, SECRET);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(paperKeyOf(PERSON, SECRET), key);
  assert.notEqual(paperKeyOf(STRANGER, SECRET), key);
  assert.notEqual(paperKeyOf(PERSON, `${SECRET}-rotated`), key);
  assert.notEqual(key, whoOf(`wallet:${PERSON}`, SECRET), "the key and the ledger's name are apart");
  for (const [address, secret] of [["nobody", SECRET], [PERSON, "x".repeat(PAPER_SECRET_MIN - 1)], [PERSON, ""]]) assert.equal(paperKeyOf(address, secret), null);
});

/* ---------------------------------------------------------------- the route stands on the door */

test("the route: every change from this site, a start only through the door with the server's key — never the address as the caller", () => {
  const route = readFileSync(new URL("../../../app/api/bots/mandate/paper/route.ts", import.meta.url), "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("paperOriginAllowed(request)") > 0 && post.indexOf("paperOriginAllowed(request)") < post.indexOf("request.text()"), "the origin before the body");
  assert.match(post, /return failure\(403, "FORBIDDEN_ORIGIN", rate\)/);
  assert.match(post, /answerPaperStart\(request, body, \{ paper: deps, secret: paperSecret\(\) \}\)/);
  assert.doesNotMatch(route, /startPaper\(|paperWhoOf|who: /u, "the route never names the caller itself");
  const door = readFileSync(new URL("./door.server.ts", import.meta.url), "utf8");
  assert.match(door, /\(await import\("\.\.\/\.\.\/api\/v1\/proof\.ts"\)\)\.requireWalletProof\(request, "mutation"\)/, "the proof every change asks");
  assert.match(door, /who: whoOf\(`wallet:\$\{proof\.address\}`, deps\.secret\)/, "the ledger counts the proven wallet");
  assert.match(door, /paperKeyOf\(proof\.address, deps\.secret\)/, "the week's key is the proven wallet's");
  assert.doesNotMatch(door, /body\.key/u, "a key the body carries is never read");
  const wire = readFileSync(new URL("./wire.server.ts", import.meta.url), "utf8");
  assert.match(wire, /secret\.length >= PAPER_SECRET_MIN \? secret : null/);
});
