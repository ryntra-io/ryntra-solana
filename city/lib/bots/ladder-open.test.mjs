// Run from repo root: node --test city/lib/bots/ladder-open.test.mjs
//
// CITY-233 — the ladder before mainnet opens: what the overseer found reviewing plavutskyi/ryntra#1571 and #1575.
//
// 1. The sheet says its network before the signature: «Real SOL» on mainnet, test SOL on devnet — the chip on the sheet
//    and the first word of the line above «Place». On mainnet both used to be empty.
// 2. «Take back and rebuild» opened the new ladder the moment the cancellation was sent; it now opens on the reading
//    that shows the old ladder closed on the chain (`closedAt` after `readLive`).
// 3. A chain bot of more than eight orders is taken back in parts: its own word («part taken back») and «Cancel the
//    rest», not «finish or cancel» — a chain bot has no «Finish»; an order whose cancellation was sent is not built twice.
// 4. `inFlight` sees only this browser: «Place» first reads «My bots» for this wallet's ladder in the pool placed from
//    another device, and offers «View» in place of a second ladder.
//
// (5 — `rawOfUi` on a form it does not recognise — is in `lib/solana/limits/dlmm-cancel.test.mjs`.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { binOfPrice, chunkRungs, planLeg } from "../../../lib/bots/ladder/plan.ts";
import { ladderCosts } from "../../../lib/bots/ladder/costs.ts";
import { DLMM_DISCRIMINATOR } from "../../../lib/solana/limits/dlmm-tx.ts";
import { base58, DLMM_PROGRAM } from "../../../lib/solana/limits/model.ts";
import { defaultDraft } from "./draft.ts";
import { useLadder } from "./ladder.ts";
import { CANCEL_AT_ONCE, CHAIN_RECHECK_MS, cancelChainBot, ladderElsewhere, placeDraft, readLive, REBUILD_WAIT_MS, takeBack, viewElsewhere } from "./ladder-actions.ts";
import { ladderWords } from "./ladder-words.ts";
import { useBotsWindow } from "./open.ts";
import { useBots } from "./store.ts";
import { WORDS } from "./words.ts";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL = "So11111111111111111111111111111111111111112";
const owner = Keypair.generate();
const OWNER = owner.publicKey.toBase58();
const WHO = { wallet: "Phantom", owner: OWNER };
const POOL = Keypair.generate().publicKey.toBase58();
const OTHER_POOL = Keypair.generate().publicKey.toBase58();
const facts = { pool: POOL, binStep: 10, activeId: 0, baseIsX: true, baseMint: SOL, quoteMint: USDC, baseDecimals: 9, quoteDecimals: 6 };
facts.activeId = binOfPrice(150, false, facts);
const pool = { facts, activePrice: 150, takesLimitOrders: true, existingArrays: [Math.floor(facts.activeId / 70), Math.floor(facts.activeId / 70) - 1], bitmapExtension: true };
const draft = defaultDraft("buyLadder", { mint: SOL, symbol: "SOL" }, 150, null, 100);

const { createProgram } = createRequire(import.meta.url)("@meteora-ag/dlmm");
const anchor = createProgram(new Connection("http://127.0.0.1:1"), { cluster: "devnet" });
const unsigned = (tx) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
const firstSignature = (wire) => base58(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).signatures[0]);
const key = () => Keypair.generate().publicKey.toBase58();
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

async function placeIx(order, rungs) {
  return anchor.methods
    .placeLimitOrder({ isAskSide: false, relativeBin: null, bins: rungs.map((rung) => ({ id: rung.binId, amount: new BN(rung.amountRaw) })), padding: new Array(16).fill(0) }, { slices: [] })
    .accountsPartial({
      lbPair: new PublicKey(POOL),
      binArrayBitmapExtension: anchor.programId,
      reserve: Keypair.generate().publicKey,
      tokenMint: new PublicKey(USDC),
      tokenProgram: TOKEN_PROGRAM_ID,
      limitOrder: new PublicKey(order),
      userToken: getAssociatedTokenAddressSync(new PublicKey(USDC), owner.publicKey),
      sender: owner.publicKey,
      payer: owner.publicKey,
      owner: owner.publicKey,
    })
    .instruction();
}

/** What the review route answers for a buy leg: the plan cut by bin array, one transaction per order key. */
async function review(leg, orderKeys, network) {
  const plan = planLeg(leg, facts);
  const transactions = [];
  for (const [i, rungs] of chunkRungs(plan.rungs).entries()) {
    const tx = new Transaction({ feePayer: owner.publicKey, blockhash: key(), lastValidBlockHeight: 1 }).add(await placeIx(orderKeys[i], rungs));
    transactions.push({ side: "buy", wireBase64: unsigned(tx), limitOrder: orderKeys[i], rungs, depositLamports: null });
  }
  return { network, pool: facts, activePrice: 150, plans: [plan], transactions, costs: ladderCosts([plan], { existingArrays: new Set(pool.existingArrays), bitmapExtension: true }), canDo: [] };
}

/** A cancellation the cancel route answers for one order: the program's close, the wallet the only signer. */
function cancelWire(order) {
  const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const close = new TransactionInstruction({ programId: new PublicKey(DLMM_PROGRAM), keys: [meta(new PublicKey(order), false, true), meta(owner.publicKey, true), meta(owner.publicKey, false, true)], data: Buffer.from(DLMM_DISCRIMINATOR.close, "hex") });
  return unsigned(new Transaction({ feePayer: owner.publicKey, blockhash: key(), lastValidBlockHeight: 1 }).add(close));
}

/** The person's wallet: it signs exactly what it was shown. */
function wallet() {
  const calls = [];
  const sign = async (args) => {
    calls.push(args);
    return {
      ok: true,
      signedWireBase64: args.unsignedWireBase64.map((wire) => {
        const exact = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
        exact.sign([owner]);
        return Buffer.from(exact.serialize()).toString("base64");
      }),
    };
  };
  return { sign, calls };
}

/**
 * The engine's routes, faked: `/orders` reads each account as `chain` holds it (in `pools[order]` or our pool), the relay
 * answers «sent» — or «failed» for the orders in `refuse` (the node said no).
 */
function routes({ chain = {}, pools = {}, refuse = [] } = {}) {
  const log = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    log.push({ url, body });
    if (url.endsWith("/review")) return Response.json(await review(body.legs[0], body.orderKeys, body.network ?? "devnet"));
    if (url.endsWith("/cancel")) return Response.json({ network: body.network, transactions: body.orders.map((order) => ({ limitOrder: order, wireBase64: cancelWire(order) })) });
    if (url.endsWith("/orders")) {
      const orders = body.orders.map((order) => ({ limitOrder: order, pool: chain[order] && chain[order] !== "closed" ? pools[order] ?? POOL : null, state: chain[order] ?? "closed", rungs: 1, filled: 0, partial: 0 }));
      return Response.json({ network: body.network, orders, prices: {}, landed: {} });
    }
    if (url.endsWith("/submit")) {
      return Response.json({ network: body.network, legs: body.items.map((item) => ({ limitOrder: item.limitOrder, signature: firstSignature(item.wireBase64), state: refuse.includes(item.limitOrder) ? "failed" : "sent", reason: null })) });
    }
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  };
  return { fetch, log, calls: (end) => log.filter((entry) => entry.url.endsWith(end)) };
}

const noLater = () => {};
const realLoadChain = useBots.getState().loadChain;

/** A fresh page: no ladders, nothing waiting; «My bots» unread; the window on «Start», no bot open. */
function freshWindow() {
  delete globalThis.window;
  useLadder.setState({ ladders: [], reads: {}, prices: {}, busy: null, note: null, shownCosts: null, rebuild: null, elsewhere: null, seen: new Set(), rest: {}, cancelSent: {}, hydrated: true });
  useBots.setState({ chain: { status: "idle" }, page: { kind: "home" }, loadChain: realLoadChain });
  useBotsWindow.setState({ tab: "launch" });
}

/** A ladder placed and landed on devnet, as this browser keeps it after a reading of the chain. */
async function landedLadder() {
  await placeDraft(draft, pool, WHO, 150, { fetch: routes().fetch, sign: wallet().sign, later: noLater });
  const [placed] = useLadder.getState().ladders;
  const open = Object.fromEntries(placed.legs.map((leg) => [leg.limitOrder, "open"]));
  await readLive(OWNER, routes({ chain: open }).fetch, "devnet");
  return { ladder: useLadder.getState().ladders[0], open };
}

/* ---------------------------------------------------------------- 1. the network before the signature */

test("1 · the sheet's network in one word: «Real SOL» on mainnet, test SOL on devnet, in both languages", () => {
  const expected = { en: { mainnet: "Real SOL", devnet: "Test SOL" }, uk: { mainnet: "Справжні SOL", devnet: "Тестові SOL" } };
  for (const lang of ["en", "uk"]) {
    const main = ladderWords(lang, "mainnet", WORDS[lang]);
    const dev = ladderWords(lang, "devnet", WORDS[lang]);
    assert.equal(main.net, expected[lang].mainnet);
    assert.equal(dev.net, expected[lang].devnet);
    assert.equal(main.chip, null, "a placed ladder's row in «My bots» stays clean on mainnet");
    assert.ok((main.chip ?? main.net).length > 0, "the sheet's chip is never empty on mainnet any more");
    assert.equal(dev.chip ?? dev.net, WORDS[lang].devnet, "devnet's chip is CITY-135's");
  }
});

test("1 · the line before the signature starts with the network; the sheet's chip shows it on mainnet", () => {
  const sheet = read("../../components/bots/Ladder.tsx");
  const line = sheet.slice(sheet.indexOf("export function LiveCostLine"), sheet.indexOf("/** Before the signature: the sum"));
  assert.ok(line.indexOf("{lw.net}") > 0 && line.indexOf("{lw.net}") < line.indexOf("lw.cost("), "the network comes first in the one line above «Place»");
  const chip = sheet.slice(sheet.indexOf("export function LadderNetChip"), sheet.indexOf("/** The order accounts this browser"));
  assert.match(chip, /\{lw\.chip \?\? lw\.net\}/u, "Devnet on devnet, Real SOL on mainnet — not null");
  assert.doesNotMatch(chip, /\? <i[^]*: null/u, "no branch renders nothing");
  /* The line sits right above the one action: the summary, the line, then «Place». */
  const start = sheet.slice(sheet.indexOf("export function LadderStart"));
  assert.ok(start.indexOf("<LiveCostLine") < start.indexOf("data-ladder-place"));
});

/* ---------------------------------------------------------------- 2. rebuild waits for the chain */

test("2 · «Take back and rebuild» opens the new ladder only on the reading that shows the old one closed", async () => {
  freshWindow();
  const { ladder, open } = await landedLadder();
  /* The person is in «My bots», where the proposal stands. */
  useBotsWindow.setState({ tab: "hangar" });
  const other = defaultDraft("exitLadder", { mint: SOL, symbol: "SOL" }, 150, null, 50);
  useBots.setState({ draft: other, page: { kind: "home" } });
  /* The cancellation is sent; the chain still holds every order. */
  await takeBack(ladder, WHO, "rebuild", { fetch: routes({ chain: open }).fetch, sign: wallet().sign, later: noLater });
  assert.equal(useLadder.getState().ladders[0].closedAt, null);
  assert.equal(useLadder.getState().rebuild?.id, ladder.id, "waiting for the chain");
  assert.equal(useBots.getState().page.kind, "home", "not opened on the send (review 9.11)");
  assert.equal(useBots.getState().draft, other, "nothing replaced yet");
  assert.equal(useBotsWindow.getState().tab, "hangar");
  /* One more reading, the chain still has not caught up: still nothing. */
  await readLive(OWNER, routes({ chain: open }).fetch, "devnet");
  assert.equal(useBots.getState().page.kind, "home");
  /* The chain now shows every order closed: the ladder closes and, on that same reading, the rebuild opens. */
  await readLive(OWNER, routes().fetch, "devnet");
  assert.equal(typeof useLadder.getState().ladders[0].closedAt, "number");
  assert.equal(useBots.getState().page.kind, "detail");
  assert.deepEqual(useBots.getState().draft, ladder.draft, "the same settings, for the person to place again");
  assert.equal(useBotsWindow.getState().tab, "launch");
  assert.equal(useLadder.getState().rebuild, null);
  assert.equal(useLadder.getState().note.kind, "cancelled");
});

test("2 · the chain already closed it by the first reading: the rebuild opens then — never before a reading", async () => {
  freshWindow();
  const { ladder } = await landedLadder();
  useBotsWindow.setState({ tab: "hangar" });
  const order = [];
  const api = routes();
  const fetch = async (url, init) => {
    order.push(`${url.split("/").pop()}:${useBots.getState().page.kind}`);
    return api.fetch(url, init);
  };
  await takeBack(ladder, WHO, "rebuild", { fetch, sign: wallet().sign, later: noLater });
  assert.deepEqual(order, ["cancel:home", "submit:home", "orders:home"], "the page stays until the chain is read");
  assert.equal(useBots.getState().page.kind, "detail");
});

test("2 · a rebuild the chain never confirms in time, or after the person moved on, is dropped — the old ladder is only taken back", async () => {
  freshWindow();
  let clock = Date.now();
  const now = () => clock;
  const { ladder, open } = await landedLadder();
  useBotsWindow.setState({ tab: "hangar" });
  await takeBack(ladder, WHO, "rebuild", { fetch: routes({ chain: open }).fetch, sign: wallet().sign, later: noLater, now });
  clock += REBUILD_WAIT_MS + 1;
  await readLive(OWNER, routes().fetch, "devnet", now);
  assert.equal(typeof useLadder.getState().ladders[0].closedAt, "number", "closed all the same");
  assert.equal(useBots.getState().page.kind, "home", "too late to open a ladder by itself");
  assert.equal(useLadder.getState().rebuild, null);

  freshWindow();
  const second = await landedLadder();
  useBotsWindow.setState({ tab: "hangar" });
  await takeBack(second.ladder, WHO, "rebuild", { fetch: routes({ chain: second.open }).fetch, sign: wallet().sign, later: noLater });
  /* Meanwhile the person opened another bot's settings on «Start». */
  const theirs = defaultDraft("exitLadder", { mint: SOL, symbol: "SOL" }, 150, null, 50);
  useBots.setState({ draft: theirs, page: { kind: "detail" } });
  useBotsWindow.setState({ tab: "launch" });
  await readLive(OWNER, routes().fetch, "devnet");
  assert.equal(useBots.getState().draft, theirs, "their settings stay");
});

test("2 · a cancellation the network refused in part: no rebuild, and it says «part taken back», not «finish or cancel»", async () => {
  freshWindow();
  const { ladder, open } = await landedLadder();
  useBotsWindow.setState({ tab: "hangar" });
  const refuse = [ladder.legs[0].limitOrder];
  await takeBack(ladder, WHO, "rebuild", { fetch: routes({ chain: open, refuse }).fetch, sign: wallet().sign, later: noLater });
  assert.equal(useLadder.getState().rebuild, null);
  assert.equal(useLadder.getState().note.kind, "rest");
  await readLive(OWNER, routes().fetch, "devnet");
  assert.equal(useBots.getState().page.kind, "home");
});

test("2 · a plain «Cancel orders» after a rebuild was asked drops it: only what was asked last happens", async () => {
  freshWindow();
  const { ladder, open } = await landedLadder();
  useBotsWindow.setState({ tab: "hangar" });
  await takeBack(ladder, WHO, "rebuild", { fetch: routes({ chain: open }).fetch, sign: wallet().sign, later: noLater });
  assert.equal(useLadder.getState().rebuild?.id, ladder.id);
  await takeBack(useLadder.getState().ladders[0], WHO, "none", { fetch: routes({ chain: open }).fetch, sign: wallet().sign, later: noLater });
  assert.equal(useLadder.getState().rebuild, null);
  await readLive(OWNER, routes().fetch, "devnet");
  assert.equal(typeof useLadder.getState().ladders[0].closedAt, "number");
  assert.equal(useBots.getState().page.kind, "home", "no rebuild opens");
});

/* ---------------------------------------------------------------- 3. part of a chain bot */

const BOT = (orders, extra = {}) => ({ id: `ladder:${orders[0]}`, kind: "ladder", venue: "meteora_dlmm", status: "waiting", refs: { orders, pool: POOL }, ...extra });

test("3 · a chain bot of eleven orders: eight in one prompt, «part taken back», and its action reads «Cancel the rest»", async () => {
  freshWindow();
  const orders = Array.from({ length: 11 }, key);
  const bot = BOT(orders);
  const chain = Object.fromEntries(orders.map((order) => [order, "open"]));
  const loadChain = useBots.getState().loadChain;
  useBots.setState({ loadChain: async () => {} });
  const person = wallet();
  try {
    const first = routes({ chain });
    await cancelChainBot(bot, WHO, { fetch: first.fetch, sign: person.sign, later: noLater });
    assert.deepEqual(first.calls("/cancel")[0].body.orders, orders.slice(0, CANCEL_AT_ONCE));
    assert.equal(person.calls.length, 1);
    assert.deepEqual(useLadder.getState().note, { kind: "rest", at: useLadder.getState().note.at, bot: bot.id }, "said under that bot");
    assert.equal(useLadder.getState().rest[bot.id], true, "«Cancel the rest» until nothing is left");
    /* The person taps «Cancel the rest» at once; the chain has not caught up and still shows all eleven. */
    const second = routes({ chain });
    await cancelChainBot(bot, WHO, { fetch: second.fetch, sign: person.sign, later: noLater });
    assert.deepEqual(second.calls("/cancel")[0].body.orders, orders.slice(CANCEL_AT_ONCE), "the rest — the eight already sent are not built again");
    assert.equal(useLadder.getState().note.kind, "checking");
    assert.equal(useLadder.getState().rest[bot.id], undefined, "nothing left beyond what was sent");
    /* A third tap before the chain shows them gone: nothing built, nothing signed. */
    const third = routes({ chain });
    await cancelChainBot(bot, WHO, { fetch: third.fetch, sign: person.sign, later: noLater });
    assert.equal(third.calls("/cancel").length, 0);
    assert.equal(person.calls.length, 2);
    assert.equal(useLadder.getState().note.kind, "checking");
    /* The chain shows them all closed. */
    await cancelChainBot(bot, WHO, { fetch: routes().fetch, sign: person.sign, later: noLater });
    assert.equal(useLadder.getState().note.kind, "cancelled");
  } finally {
    useBots.setState({ loadChain });
  }
});

test("3 · a leg the network refused: the rest is said the same way and taken back on the next tap", async () => {
  freshWindow();
  const orders = Array.from({ length: 3 }, key);
  const bot = BOT(orders, { kind: "limit" });
  const chain = Object.fromEntries(orders.map((order) => [order, "partial"]));
  const first = routes({ chain, refuse: [orders[1]] });
  await cancelChainBot(bot, WHO, { fetch: first.fetch, sign: wallet().sign, later: noLater });
  assert.equal(useLadder.getState().note.kind, "rest");
  assert.equal(useLadder.getState().rest[bot.id], true);
  const second = routes({ chain });
  await cancelChainBot(bot, WHO, { fetch: second.fetch, sign: wallet().sign, later: noLater });
  assert.deepEqual(second.calls("/cancel")[0].body.orders, [orders[1]], "only the one the network refused");
  assert.equal(useLadder.getState().rest[bot.id], undefined);
});

test("3 · the words: «part taken back» and «Cancel the rest» in both languages — no «finish» on a chain bot", () => {
  const expected = { en: ["Part taken back — cancel the rest", "Cancel the rest"], uk: ["Частину забрано — скасуй решту", "Скасувати решту"] };
  for (const lang of ["en", "uk"]) {
    for (const network of ["mainnet", "devnet"]) {
      const lw = ladderWords(lang, network, WORDS[lang]);
      assert.deepEqual([lw.note.rest, lw.cancelRest], expected[lang], `${lang} ${network}`);
      assert.doesNotMatch(lw.note.rest + lw.cancelRest, /finish|заверш/iu);
    }
  }
  const hangar = read("../../components/bots/Hangar.tsx");
  assert.match(hangar, /rest \? lw\.cancelRest : filled \? w\.proposal\.takeBack : w\.chainCancel/u, "the bot's one action says what it does");
});

/* ---------------------------------------------------------------- 4. a ladder from another device */

/** «My bots» as the Hangar read it: this wallet's bots on the chain, read `ago` ms before now. */
function hangarRead(bots, ago = 0) {
  useBots.setState({ chain: { status: "ready", wallet: OWNER, answer: { wallet: OWNER, at: Date.now() - ago, bots, issues: [], sunset: null, read: { positions: true, orders: true, rules: true } } } });
}

test("4 · «Place» on mainnet with this wallet's ladder from another device in the pool: no second ladder — «View»", async () => {
  freshWindow();
  const [a, b] = [key(), key()];
  hangarRead([BOT([a]), BOT([b], { id: "limit:dlmm:b", kind: "limit" })]);
  const api = routes({ chain: { [a]: "open", [b]: "partial" } });
  const person = wallet();
  await placeDraft(draft, pool, WHO, 150, { fetch: api.fetch, sign: person.sign, later: noLater, network: "mainnet" });
  const asked = api.calls("/orders")[0].body;
  assert.deepEqual([asked.network, asked.owner, asked.orders], ["mainnet", OWNER, [a, b]], "the orders of «My bots», read on the chain");
  assert.equal(api.calls("/review").length, 0, "nothing built");
  assert.equal(person.calls.length, 0, "the wallet is not asked");
  assert.equal(useLadder.getState().ladders.length, 0);
  assert.deepEqual(useLadder.getState().elsewhere, { pool: POOL, orders: [a, b] });
  assert.equal(useLadder.getState().note.kind, "elsewhere");
  assert.equal(useLadder.getState().busy, null);
  /* «View»: «My bots», the settings stay where they are. */
  useBots.setState({ page: { kind: "detail" } });
  viewElsewhere();
  assert.equal(useBotsWindow.getState().tab, "hangar");
  assert.equal(useBots.getState().page.kind, "detail");
  assert.equal(useLadder.getState().elsewhere, null);
  /* Looked at: «Place» beside it is the person's choice now. */
  const again = routes({ chain: { [a]: "open", [b]: "partial" } });
  await placeDraft(draft, pool, WHO, 150, { fetch: again.fetch, sign: person.sign, later: noLater, network: "mainnet" });
  assert.equal(again.calls("/review").length, 1);
});

test("4 · what is not a ladder in flight here does not stop «Place»: another pool, closed or filled orders, this browser's own", async () => {
  const cases = [
    { name: "another pool", chain: (o) => ({ [o]: "open" }), pools: (o) => ({ [o]: OTHER_POOL }) },
    { name: "taken back since the Hangar read", chain: () => ({}), pools: () => ({}) },
    { name: "filled — done, not on its way", chain: (o) => ({ [o]: "filled" }), pools: () => ({}) },
  ];
  for (const c of cases) {
    freshWindow();
    const order = key();
    hangarRead([BOT([order])]);
    const api = routes({ chain: c.chain(order), pools: c.pools(order) });
    await placeDraft(draft, pool, WHO, 150, { fetch: api.fetch, sign: wallet().sign, later: noLater, network: "mainnet" });
    assert.equal(api.calls("/review").length, 1, c.name);
    assert.equal(useLadder.getState().elsewhere, null, c.name);
  }
  /* This browser's own ladder: its orders are known here, `inFlight` and «Ladders» already speak for it. */
  freshWindow();
  await placeDraft(draft, pool, WHO, 150, { fetch: routes().fetch, sign: wallet().sign, later: noLater, network: "mainnet" });
  const mine = useLadder.getState().ladders[0];
  assert.equal(mine.network, "mainnet");
  hangarRead([BOT(mine.legs.map((leg) => leg.limitOrder))]);
  const own = await ladderElsewhere(OWNER, POOL, "mainnet", { fetch: routes({ chain: Object.fromEntries(mine.legs.map((leg) => [leg.limitOrder, "open"])) }).fetch });
  assert.deepEqual(own, []);
});

test("4 · «My bots» read long ago is read again first; a read that fails never stands between the person and «Place»", async () => {
  freshWindow();
  const order = key();
  hangarRead([], CHAIN_RECHECK_MS + 1);
  const loads = [];
  useBots.setState({
    loadChain: async (...args) => {
      loads.push(args);
      hangarRead([BOT([order])]);
    },
  });
  const there = await ladderElsewhere(OWNER, POOL, "mainnet", { fetch: routes({ chain: { [order]: "open" } }).fetch });
  assert.deepEqual(loads, [[OWNER, true]], "the Hangar read again, fresh");
  assert.deepEqual(there, [order], "the ladder placed a moment ago on the phone");

  freshWindow();
  useBots.setState({ loadChain: async () => useBots.setState({ chain: { status: "error", wallet: OWNER } }) });
  const api = routes();
  await placeDraft(draft, pool, WHO, 150, { fetch: api.fetch, sign: wallet().sign, later: noLater, network: "mainnet" });
  assert.equal(api.calls("/review").length, 1, "the Hangar did not answer: placed as before");

  freshWindow();
  hangarRead([BOT([order])]);
  const down = async (url, init) => (url.endsWith("/orders") ? Response.json({ error: { code: "UNREACHABLE" } }, { status: 503 }) : routes().fetch(url, init));
  assert.deepEqual(await ladderElsewhere(OWNER, POOL, "mainnet", { fetch: down }), []);
});

test("4 · on devnet «My bots» (mainnet) is not asked: the window places as before", async () => {
  freshWindow();
  hangarRead([BOT([key()])]);
  const api = routes();
  await placeDraft(draft, pool, WHO, 150, { fetch: api.fetch, sign: wallet().sign, later: noLater });
  assert.deepEqual(api.log.map((entry) => entry.url.split("/").pop()).slice(0, 2), ["review", "submit"]);
});

test("4 · the sheet: «View» is the one action while the ladder from elsewhere stands; the words in both languages", () => {
  for (const [lang, view, note] of [
    ["en", "View", "This wallet already has a ladder here"],
    ["uk", "Переглянути", "У цього гаманця тут уже є драбина"],
  ]) {
    const lw = ladderWords(lang, "mainnet", WORDS[lang]);
    assert.equal(lw.view, view);
    assert.equal(lw.note.elsewhere, note);
  }
  const sheet = read("../../components/bots/Ladder.tsx");
  assert.match(sheet, /\{elsewhere \? \(\s*<button[^>]*onClick=\{viewElsewhere\}[^>]*>\s*\{lw\.view\}/u);
});
