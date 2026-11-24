// The stock pool's keeper wired to the care: the gate, the person's one approval, the pass that moves the
// range by the exchange's hours inside her bounds, the fees, the stop, and the care's cron that runs it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { CARE_BOOK, careMinute } from "./service.server.ts";
import { keeperKey, keeperViewOf, rangeOfSlots, referenceInPool, tickOfPrice } from "./stock-keeper-book.ts";
import { DEFAULT_KEEPER_CHOICE, KEEPER_COSTS, KEEPER_PACES, KEEPER_WIDTHS, approvalOf, keeperChoiceOf, keeperLimitsOf, putBackOf } from "./stock-keeper-terms.ts";
import { actAsKeeper, keeperGate, keeperStatus, keeperStep, relayKeeperStop, reviewKeeper, stockKeeperMinute, stopKeeper, submitKeeper } from "./stock-keeper.server.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Thursday 19.11.2026, 16:00 UTC — the New York session is open, it closes at 21:00 UTC. */
const NOW = Date.UTC(2026, 10, 19, 16, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

const key = () => Keypair.generate().publicKey.toBase58();
const AGENT = key();
const OWNER = key();
const POOL = key();
const NFT = key();
const STOCK = key();
const SOL = "So11111111111111111111111111111111111111112";

const ENV = Object.freeze({ RYNTRA_EARN_PRO: "devnet", RYNTRA_EARN_PRO_STOCKS: "open", RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: AGENT, RYNTRA_STOCK_KEEPER: "devnet" });

/** A message the person or the agent would sign: real bytes, so that its hash is the one the book keeps. */
const wire = () => {
  const message = new TransactionMessage({ payerKey: new Keypair().publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: [] }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
};

/** The stock X, SOL Y: 2.5 SOL a token. */
const PRICE = 2.5;
const decimals = { x: 9, y: 9 };
const rangeSlot = (halfPct, centre = PRICE, unlocked = "1000") => ({
  index: 0,
  tickLowerId: tickOfPrice(centre / (1 + halfPct / 100), decimals.x, decimals.y),
  tickUpperId: tickOfPrice(centre * (1 + halfPct / 100), decimals.x, decimals.y),
  inRange: true,
  liquidity: unlocked,
  unlocked,
  lockedForEver: "0",
  vesting: "0",
  xRaw: "0",
  yRaw: "0",
  feeXRaw: "0",
  feeYRaw: "0",
  rewardsAccruedRaw: [],
});

const poolRead = () => ({
  address: POOL,
  tokenX: { mint: STOCK, decimals: 9, reserve: key() },
  tokenY: { mint: SOL, decimals: 9, reserve: key() },
  price: PRICE,
  fee: { totalBps: 80 },
  tickSpacing: 10,
  tickId: tickOfPrice(PRICE, 9, 9),
  rewards: [],
  open: { addLiquidity: { open: true } },
  paused: { deposits: false },
});

/** A venue that answers as the chain would, and writes down what it was asked to build. */
function venueOf(over = {}) {
  const asked = { approve: [], move: [], collect: 0, endCare: 0 };
  const state = { delegate: AGENT, may: ["removeLiquidity", "claimFee", "claimReward"], slots: [rangeSlot(1)], fees: { xRaw: "0", yRaw: "0" }, moveCost: 1_000_000, ...over };
  const venue = {
    pools: { read: async (address) => (address === POOL ? poolRead() : null) },
    earn: {
      care: async ({ agent }) => ({ delegate: state.delegate, may: state.may, cares: state.delegate === agent }),
      income: async () => ({ position: { pool: POOL, nftMint: NFT, slots: state.slots, xRaw: "4000000000", yRaw: "10000000000", feeXRaw: state.fees.xRaw, feeYRaw: state.fees.yRaw }, inRange: true, fees: state.fees, rewards: [] }),
      endCare: async () => ((asked.endCare += 1), { wireBase64: wire() }),
    },
    range: {
      approve: async (request) => (asked.approve.push(request), { wireBase64: wire(), rentLamports: 0, rentReturnedLamports: 0, unwrapsLamports: null, rights: [], approval: request.approval }),
      move: async (request) => {
        asked.move.push(request);
        const laid = !request.pull;
        return {
          steps: laid ? [{ wireBase64: wire(), roles: ["OUT"] }, { wireBase64: wire(), roles: ["IN"] }] : [{ wireBase64: wire(), roles: ["OUT"] }],
          target: laid ? { tickLowerId: 0, tickUpperId: 10 } : null,
          halfWidthBps: laid ? request.halfWidthBps : null,
          emptied: [0],
          deleted: [],
          takesOut: { expected: { xRaw: "4000000000", yRaw: "10000000000" }, minimum: { xRaw: "3900000000", yRaw: "9900000000" } },
          fees: { xRaw: "0", yRaw: "0" },
          putsBack: laid ? { xRaw: "4000000000", yRaw: "10000000000" } : { xRaw: "0", yRaw: "0" },
          heldBack: null,
          costLamports: state.moveCost,
          rentLamports: 0,
        };
      },
      sqrtPriceOfTick: (tick) => String(tick + 1_000_000),
    },
    positions: { collect: async () => ((asked.collect += 1), { wireBase64: wire(), expected: state.fees }) },
    rewards: { collect: async () => null },
  };
  return { venue, asked, state };
}

/** The chain: devnet's, accounts that are not there, every send landing. */
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
function chainOf(genesis = DEVNET_GENESIS) {
  const sent = [];
  return {
    sent,
    getGenesisHash: async () => genesis,
    getMultipleAccountsInfo: async (keys) => keys.map(() => null),
    getAccountInfo: async () => null,
    sendRawTransaction: async (bytes) => (sent.push(bytes), `sig${sent.length}`),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    confirmTransaction: async () => ({ value: { err: null } }),
  };
}

const shelf = async (mints) => new Map(mints.filter((mint) => mint === STOCK).map((mint) => [mint, { mint, symbol: "ANT", issuer: "Backpack Securities" }]));
const factsOf = (session, extra = {}) => async () => ({ session, step: null, reference: null, expectedGapBps: null, ...extra });
const openSession = (closesIn = 5 * HOUR) => ({ open: true, nextChangeAt: iso(NOW + closesIn) });
const closedSession = () => ({ open: false, nextChangeAt: iso(NOW + 17 * HOUR) });

/** The agent's key, as a test's: it never signs here — the act is the test's own. */
const KEY = { mode: "env", keyRef: null, sign: async () => new Uint8Array(64) };

function depsOf(extra = {}) {
  const { venue, asked, state } = venueOf(extra.venue);
  const store = createMemoryGuardStore();
  const connection = chainOf();
  return { venue, asked, state, store, connection, deps: { env: ENV, venue, store, connection, stocks: shelf, now: () => NOW, key: KEY, facts: factsOf(openSession()) } };
}

/** A working keeper's row, as `submitKeeper` leaves it. */
function rowOf(choice = DEFAULT_KEEPER_CHOICE, extra = {}) {
  const limits = keeperLimitsOf(choice, choice.putBack ? { xRaw: "5000000000", yRaw: "12000000000" } : undefined);
  return {
    v: 1,
    kind: "stock-keeper",
    key: keeperKey("devnet", OWNER, NFT),
    network: "devnet",
    owner: OWNER,
    pool: POOL,
    nftMint: NFT,
    agent: AGENT,
    choice,
    limits,
    plan: choice.plan,
    approval: approvalOf(limits),
    status: "working",
    stoppedBy: null,
    confirmed: true,
    pending: null,
    openSeenAt: NOW - 2 * HOUR,
    history: [],
    waiting: null,
    hours: null,
    shape: null,
    wait: null,
    lastClaimAt: null,
    events: [],
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - HOUR,
    ...extra,
  };
}
const DAY_MS = 24 * HOUR;

/** An act that lands every step, and writes down which lock it was handed. */
function actOf(outcome = (n) => ({ status: "landed", signature: `agent${n}` })) {
  const calls = [];
  const act = async (build, entry, context, lock) => (calls.push({ build, lock }), outcome(calls.length));
  return { act, calls };
}

/* ------------------------------------------------------------------ the choices */

test("choices: only what the screen offers is a choice; the bounds a choice makes pass the bounds' own check", async () => {
  const { rangeLimitsRefusal, keeperModeOf } = await import("./range-limits.ts");
  assert.deepEqual(keeperChoiceOf({ ...DEFAULT_KEEPER_CHOICE }), DEFAULT_KEEPER_CHOICE);
  for (const bad of [null, 1, { ...DEFAULT_KEEPER_CHOICE, width: "huge" }, { ...DEFAULT_KEEPER_CHOICE, pace: "toString" }, { ...DEFAULT_KEEPER_CHOICE, cost: "__proto__" }, { ...DEFAULT_KEEPER_CHOICE, plan: "sell" }, { ...DEFAULT_KEEPER_CHOICE, putBack: "yes" }]) {
    assert.equal(keeperChoiceOf(bad), null, JSON.stringify(bad));
  }
  for (const width of Object.keys(KEEPER_WIDTHS)) {
    for (const pace of Object.keys(KEEPER_PACES)) {
      for (const cost of Object.keys(KEEPER_COSTS)) {
        const pull = keeperLimitsOf({ width, pace, cost, plan: "leave", putBack: false });
        const shift = keeperLimitsOf({ width, pace, cost, plan: "leave", putBack: true }, { xRaw: "100", yRaw: "200" });
        assert.equal(rangeLimitsRefusal(pull), null);
        assert.equal(rangeLimitsRefusal(shift), null);
        assert.equal(keeperModeOf(pull), "pull");
        assert.equal(keeperModeOf(shift), "shift");
        assert.equal(approvalOf(pull), null, "a keeper that only takes out asks no spending approval");
        assert.deepEqual(approvalOf(shift), { xRaw: "400", yRaw: "800" }, "the approval is one day's put-back");
      }
    }
  }
  /* A move may lay back the whole position in either coin, with room for the price. */
  assert.deepEqual(putBackOf({ xRaw: "4000000000", yRaw: "10000000000" }, { price: 2.5, decimalsX: 9, decimalsY: 9 }), { xRaw: "8800000000", yRaw: "22000000000" });
  assert.deepEqual(putBackOf({ xRaw: "1", yRaw: "1" }, { price: 0, decimalsX: 9, decimalsY: 9 }), { xRaw: "0", yRaw: "0" });
});

test("readings: the range of the slots that hold liquidity, and the exchange's price in the pool's own units", () => {
  const range = rangeOfSlots([rangeSlot(1), { ...rangeSlot(5), unlocked: "0" }], decimals);
  assert.ok(range && Math.abs(range.centerPrice - PRICE) / PRICE < 0.002 && Math.abs(range.halfWidthBps - 100) <= 2, JSON.stringify(range));
  assert.equal(rangeOfSlots([{ ...rangeSlot(1), unlocked: "0" }], decimals), null);
  /* A token standing for 2 shares at $150 against SOL at $200: 1.5 SOL a token; with SOL on X, the inverse. */
  assert.equal(referenceInPool({ perShareUsd: 150, multiplier: 2, solUsd: 200, stockIsX: true }), 1.5);
  assert.equal(referenceInPool({ perShareUsd: 150, multiplier: 2, solUsd: 200, stockIsX: false }), 200 / 300);
  for (const missing of [{ perShareUsd: null }, { multiplier: 0 }, { solUsd: -1 }]) assert.equal(referenceInPool({ perShareUsd: 150, multiplier: 2, solUsd: 200, stockIsX: true, ...missing }), null);
});

/* ------------------------------------------------------------------ the gate */

test("gate: open only where earning, the care and the keeper's switch stand on one network; closed, nothing is built", async () => {
  assert.deepEqual(keeperGate(ENV), { open: true, network: "devnet", agent: AGENT, modes: ["pull", "shift"] });
  assert.equal(keeperGate({ ...ENV, RYNTRA_STOCK_KEEPER: "" }).open, false);
  assert.equal(keeperGate({ ...ENV, RYNTRA_STOCK_KEEPER: "mainnet" }).open, false, "the switch on another network");
  assert.equal(keeperGate({ ...ENV, RYNTRA_AGENT_CARE: "" }).open, false);
  assert.equal(keeperGate({ ...ENV, RYNTRA_EARN_PRO: "" }).open, false);
  const { deps, asked } = depsOf();
  const closed = await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, { ...deps, env: { ...ENV, RYNTRA_STOCK_KEEPER: "" } });
  assert.equal(closed.code, "KEEPER_CLOSED");
  assert.equal((await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, { ...deps, key: null })).code, "KEEPER_CLOSED", "no key here: no keeper given");
  assert.deepEqual(asked.approve, []);
  assert.deepEqual(await stockKeeperMinute({ ...ENV, RYNTRA_STOCK_KEEPER: "off" }, deps), { ran: false, reason: "closed" });
});

/* ------------------------------------------------------------------ review · submit */

test("review: a stock pool only; the choice becomes the bounds; the approval is built for them and the row waits for it", async () => {
  const { deps, asked, store } = depsOf();
  assert.equal((await reviewKeeper({ owner: OWNER, pool: key(), nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, deps)).code, "KEEPER_POOL");
  assert.equal((await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, { ...deps, stocks: async () => new Map() })).code, "KEEPER_POOL", "a coin the shelf does not name is no stock");
  assert.equal((await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: { ...DEFAULT_KEEPER_CHOICE, width: "x" } }, deps)).code, "BAD_REQUEST");
  assert.equal((await reviewKeeper({ owner: "nobody", pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, deps)).code, "BAD_REQUEST");

  const pull = await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, deps);
  assert.equal(pull.ok, true);
  assert.equal(pull.mode, "pull");
  assert.deepEqual(asked.approve.at(-1).approval, { xRaw: "0", yRaw: "0" }, "a keeper that only takes out: no spending approval");
  assert.equal(pull.terms.approval, null);
  assert.deepEqual(pull.coins, { x: { symbol: "ANT", decimals: 9 }, y: { symbol: "SOL", decimals: 9 } });
  const row = await store.collection(CARE_BOOK).get(pull.key);
  assert.equal(row.status, "signing");
  assert.equal(row.pending.messages.length, 1);

  const shift = await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: { ...DEFAULT_KEEPER_CHOICE, putBack: true } }, deps);
  assert.equal(shift.mode, "shift");
  assert.deepEqual(asked.approve.at(-1).approval, { xRaw: "35200000000", yRaw: "88000000000" }, "one day's put-back: four moves of the whole position");
  assert.equal(shift.terms.approvalOutsideThePool, true, "the person is told the one risk the program does not hold");

  /* Status shows no keeper still waiting for its first signature. */
  const status = await keeperStatus(OWNER, deps);
  assert.deepEqual(status.keepers, []);
  assert.deepEqual(status.modes, ["pull", "shift"]);
});

test("mainnet: the switch opens a keeper that takes out, never one that lays the person's money back", async () => {
  const { stockKeeperGate, STOCK_KEEPER_SHIFT_ON_MAINNET } = await import("./stock-keeper-gate.ts");
  assert.equal(STOCK_KEEPER_SHIFT_ON_MAINNET, false);
  assert.deepEqual(stockKeeperGate({ RYNTRA_STOCK_KEEPER: "mainnet" }), { open: true, network: "mainnet", modes: ["pull"] });
});

test("submit: only the built transaction is relayed; the bounds become the keeper's once it lands, and the chain is asked", async () => {
  const { deps, store, connection } = depsOf();
  const review = await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, deps);
  assert.equal((await submitKeeper({ owner: OWNER, key: review.key, signed: [wire()] }, deps)).code, "KEEPER_SIGNED", "another message");
  assert.equal((await submitKeeper({ owner: key(), key: review.key, signed: review.transactions }, deps)).code, "KEEPER_UNKNOWN", "another wallet");
  assert.equal(connection.sent.length, 0);
  const done = await submitKeeper({ owner: OWNER, key: review.key, signed: review.transactions }, deps);
  assert.deepEqual(done, { ok: true, signatures: ["sig1"], seen: true });
  const row = await store.collection(CARE_BOOK).get(review.key);
  assert.equal(row.status, "working");
  assert.equal(row.pending, null);
  assert.equal(row.confirmed, true);
  const status = await keeperStatus(OWNER, deps);
  assert.equal(status.keepers.length, 1);
  assert.equal(status.keepers[0].mode, "pull");
});

/* ------------------------------------------------------------------ the pass */

test("step: the owner took the approval back — the keeper stops; a position no longer hers — it stops as gone", async () => {
  const { deps, venue } = depsOf({ venue: { delegate: null } });
  const after = await keeperStep(rowOf(), { ...deps, network: "devnet", key: KEY, act: actOf().act });
  assert.equal(after.status, "stopped");
  assert.equal(after.stoppedBy, "owner");
  venue.earn.care = async () => {
    const { DlmmProRefusal } = await import("../earn-pro/venue.server.ts");
    throw new DlmmProRefusal("BAD_INPUT", "The wallet does not hold the NFT of the position.");
  };
  assert.equal((await keeperStep(rowOf(), { ...deps, network: "devnet", key: KEY })).stoppedBy, "gone");
});

test("step, takes out only: before the close the narrow liquidity goes to the wallet — built as a take-out, held to the keeper's lock", async () => {
  const { deps, asked } = depsOf();
  const { act, calls } = actOf();
  const after = await keeperStep(rowOf(), { ...deps, network: "devnet", key: KEY, act, facts: factsOf(openSession(30 * MIN)) });
  assert.equal(asked.move.length, 1);
  assert.equal(asked.move[0].pull, true);
  assert.equal(asked.move[0].slippageBps, 100);
  assert.deepEqual(asked.move[0].bounds.maxPutBackPerShift, { xRaw: "0", yRaw: "0" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lock.action, "keeper.move");
  assert.match(calls[0].lock.refusalOf(new Uint8Array([1, 2, 3])), /not a transaction message/, "the venue's own lock reads the bytes");
  assert.equal(after.events.at(-1).kind, "pull");
  assert.deepEqual(after.waiting, { xRaw: "4000000000", yRaw: "10000000000" }, "what went out waits in the wallet for her tap");
  assert.equal(after.hours, "closing");
  assert.equal(after.history.length, 0, "a take-out is no move on the bounds' clock");
});

test("step, takes out only: the exchange opened with the money in the wallet — the keeper waits for the person, it cannot lay it back", async () => {
  const { deps, asked, state } = depsOf();
  state.slots = [];
  const { act, calls } = actOf();
  const after = await keeperStep(rowOf(DEFAULT_KEEPER_CHOICE, { waiting: { xRaw: "1", yRaw: "1" } }), { ...deps, network: "devnet", key: KEY, act });
  assert.equal(after.wait, "needs-owner");
  assert.equal(asked.move.length, 0);
  assert.equal(calls.length, 0);
});

test("step, takes out only: the person put the money back herself — nothing waits in the wallet any more", async () => {
  const { deps } = depsOf();
  const { act } = actOf();
  const after = await keeperStep(rowOf(DEFAULT_KEEPER_CHOICE, { waiting: { xRaw: "1", yRaw: "1" } }), { ...deps, network: "devnet", key: KEY, act, facts: factsOf(openSession()) });
  assert.equal(after.waiting, null);
  assert.equal(keeperViewOf(after, NOW).waiting, false);
});

test("step, puts back: the open lays the narrow range — unless the built move costs more than the person allowed", async () => {
  const choice = { ...DEFAULT_KEEPER_CHOICE, putBack: true };
  const { deps, asked, state } = depsOf({ venue: { slots: [rangeSlot(5)], may: ["removeLiquidity", "claimFee", "claimReward", "addLiquidity", "updateRange"] } });
  state.moveCost = KEEPER_COSTS.usual + 1;
  const { act, calls } = actOf();
  const held = await keeperStep(rowOf(choice), { ...deps, network: "devnet", key: KEY, act });
  assert.equal(asked.move.at(-1).halfWidthBps, KEEPER_WIDTHS.usual.narrowestBps);
  assert.equal(held.wait, "cost-per-shift");
  assert.equal(calls.length, 0, "nothing signed over the bound");

  state.moveCost = 1_000_000;
  const moved = await keeperStep(rowOf(choice), { ...deps, network: "devnet", key: KEY, act });
  assert.equal(calls.length, 2, "out, then in");
  assert.equal(moved.events.at(-1).kind, "narrow");
  assert.equal(moved.shape, "narrow");
  assert.equal(moved.history.length, 1);
  assert.equal(moved.waiting, null);
  assert.equal(asked.move.at(-1).centerSqrtPriceX64, undefined, "no reference: around the pool's own price");

  /* The close comes too soon after that move: the clock holds the widening. */
  state.slots = [rangeSlot(1)];
  const soon = await keeperStep({ ...moved, shape: "narrow" }, { ...deps, network: "devnet", key: KEY, act, facts: factsOf(closedSession()) });
  assert.equal(soon.wait, "too-soon");
});

test("step, puts back: «in» fails after «out» paid — the move still counts, and the money waits in the wallet", async () => {
  const choice = { ...DEFAULT_KEEPER_CHOICE, putBack: true };
  const { deps } = depsOf({ venue: { slots: [rangeSlot(5)], may: ["removeLiquidity", "claimFee", "claimReward", "addLiquidity", "updateRange"] } });
  const { act } = actOf((n) => (n === 1 ? { status: "landed", signature: "out" } : { status: "failed", signature: "in" }));
  const after = await keeperStep(rowOf(choice), { ...deps, network: "devnet", key: KEY, act });
  assert.equal(after.history.length, 1);
  assert.deepEqual(after.waiting, { xRaw: "4000000000", yRaw: "10000000000" });
  assert.equal(after.events.at(-1).kind, "refused");
});

test("step: no session known — nothing moves; in shape — the fees go to the wallet once worth it, through the care's lock", async () => {
  const { deps, asked, state } = depsOf();
  const { act, calls } = actOf();
  const unknown = await keeperStep(rowOf(), { ...deps, network: "devnet", key: KEY, act, facts: factsOf(null) });
  assert.equal(unknown.wait, "session-unknown");
  assert.equal(asked.move.length, 0);
  state.fees = { xRaw: "400000000", yRaw: "1000000000" };
  const claimed = await keeperStep(rowOf(), { ...deps, network: "devnet", key: KEY, act });
  assert.equal(claimed.wait, "in-shape");
  assert.equal(asked.collect, 1);
  assert.equal(calls.at(-1).lock.action, "keeper.collect");
  assert.equal(claimed.events.at(-1).kind, "claim");
  assert.equal(claimed.lastClaimAt, NOW);
});

test("pass: closed or keyless it sits still; open, each working keeper one step, a failing one never stops the others", async () => {
  const { deps, store } = depsOf();
  assert.deepEqual(await stockKeeperMinute(ENV, { ...deps, key: null }), { ran: false, reason: "no agent key here" });
  const book = store.collection(CARE_BOOK);
  const a = rowOf();
  const b = { ...rowOf(), key: keeperKey("devnet", key(), NFT), owner: key() };
  await book.set(a.key, a);
  await book.set(b.key, b);
  await book.set("k:devnet:stopped", { ...rowOf(), key: "k:devnet:stopped", status: "stopped" });
  let n = 0;
  const step = async (row) => {
    n += 1;
    if (n === 1) throw new Error("fetch failed");
    return { ...row, updatedAt: 7 };
  };
  const ran = await stockKeeperMinute(ENV, { ...deps, step });
  assert.deepEqual(ran, { ran: true, keepers: 2, acted: 1, skipped: 0 });
  assert.equal((await stockKeeperMinute(ENV, { ...deps, step })).skipped, 2, "the same tick is not taken twice");
});

test("stop: built only — the keeper works until the chain shows the approval gone; only the built messages are relayed", async () => {
  const { deps, store, asked, state, connection } = depsOf();
  const row = rowOf();
  await store.collection(CARE_BOOK).set(row.key, row);
  const built = await stopKeeper({ owner: OWNER, key: row.key }, deps);
  assert.equal(built.ok, true);
  assert.equal(asked.endCare, 1);
  assert.equal((await store.collection(CARE_BOOK).get(row.key)).status, "working", "asking for the stop changes nothing the agent reads");
  assert.equal((await store.collection(CARE_BOOK).get(row.key)).stopMessages, undefined, "the stop's messages live beside the row, never in it");
  assert.equal((await stockKeeperMinute(ENV, { ...deps, step: async (r) => ({ ...r, updatedAt: 9 }) })).acted, 1, "the agent's pass still takes it");

  assert.equal((await relayKeeperStop({ owner: OWNER, key: row.key, signed: [wire()] }, deps)).code, "KEEPER_SIGNED");
  assert.equal((await relayKeeperStop({ owner: key(), key: row.key, signed: built.transactions }, deps)).code, "KEEPER_UNKNOWN", "another wallet's relay");
  assert.equal(connection.sent.length, 0);

  /* Sent, but the chain still shows the agent approved (not landed yet): still working. */
  const early = await relayKeeperStop({ owner: OWNER, key: row.key, signed: built.transactions }, deps);
  assert.deepEqual(early, { ok: true, signatures: ["sig1"], stopped: false });
  assert.equal((await store.collection(CARE_BOOK).get(row.key)).status, "working");

  /* The chain shows the approval taken back: stopped, by its owner. */
  state.delegate = null;
  const landed = await relayKeeperStop({ owner: OWNER, key: row.key, signed: built.transactions }, deps);
  assert.equal(landed.stopped, true);
  const after = await store.collection(CARE_BOOK).get(row.key);
  assert.equal(after.status, "stopped");
  assert.equal(keeperViewOf(after, NOW).stoppedBy, "owner");
});

test("stop: nothing of the agent on chain — the row stops as it stands; the chain not read — nothing is stopped", async () => {
  const { deps, store, venue, asked } = depsOf({ venue: { delegate: null } });
  const row = rowOf();
  await store.collection(CARE_BOOK).set(row.key, row);
  const failing = venue.earn.care;
  venue.earn.care = async () => {
    throw new Error("fetch failed");
  };
  assert.equal((await stopKeeper({ owner: OWNER, key: row.key }, deps)).code, "KEEPER_UNREAD", "an RPC that did not answer is never «nothing to take back»");
  assert.equal((await store.collection(CARE_BOOK).get(row.key)).status, "working");
  venue.earn.care = failing;
  const none = await stopKeeper({ owner: OWNER, key: row.key }, deps);
  assert.deepEqual(none, { ok: true, transactions: [] });
  assert.equal(asked.endCare, 0);
  assert.equal((await store.collection(CARE_BOOK).get(row.key)).status, "stopped");
});

test("network: the endpoint's genesis must be the gate's — a devnet switch on a mainnet endpoint builds, sends and moves nothing", async () => {
  const { deps, store, asked } = depsOf();
  const mainnet = chainOf(MAINNET_GENESIS);
  const wrong = { ...deps, connection: mainnet };
  assert.equal((await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, wrong)).code, "NOT_NETWORK");
  assert.deepEqual(asked.approve, []);
  const review = await reviewKeeper({ owner: OWNER, pool: POOL, nftMint: NFT, choice: DEFAULT_KEEPER_CHOICE }, deps);
  assert.equal((await submitKeeper({ owner: OWNER, key: review.key, signed: review.transactions }, wrong)).code, "NOT_NETWORK");
  assert.equal(mainnet.sent.length, 0);
  const row = rowOf();
  await store.collection(CARE_BOOK).set(row.key, row);
  assert.equal((await stopKeeper({ owner: OWNER, key: row.key }, wrong)).code, "NOT_NETWORK");
  assert.equal((await relayKeeperStop({ owner: OWNER, key: row.key, signed: [wire()] }, wrong)).code, "NOT_NETWORK");
  let stepped = 0;
  assert.deepEqual(await stockKeeperMinute(ENV, { ...wrong, step: async (r) => ((stepped += 1), r) }), { ran: false, reason: "not the gate's network" });
  assert.equal(stepped, 0);
  /* A row of the other network is never this gate's, whatever the key says. */
  const other = { ...rowOf(), key: keeperKey("mainnet", OWNER, NFT), network: "mainnet" };
  await store.collection(CARE_BOOK).set(other.key, other);
  assert.equal((await stopKeeper({ owner: OWNER, key: other.key }, deps)).code, "KEEPER_UNKNOWN");
});

test("the agent signs nothing its lock refuses, and journals every signature before it", async () => {
  const store = createMemoryGuardStore();
  const outcome = await actAsKeeper({ wireBase64: wire() }, { network: "devnet", agent: AGENT, nftMint: NFT }, { connection: chainOf(), store, key: KEY, now: () => NOW }, { action: "keeper.move", refusalOf: () => "a call of the program that is not a keeper's" });
  assert.deepEqual(outcome, { status: "refused", reason: "a call of the program that is not a keeper's" });
  const rows = await store.collection("agentSignatures").valuesWithPrefix("care:devnet:");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "REFUSED");
  assert.equal(rows[0].policy, `keeper:${NFT}`);
});

test("the care's cron runs the keeper only where its switch names a network", async () => {
  const devnet = { getGenesisHash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" };
  const store = createMemoryGuardStore();
  const care = { RYNTRA_AGENT_CARE: "devnet", RYNTRA_AGENT_CARE_AGENT: AGENT };
  const without = await careMinute(care, { store, connection: devnet, keyed: true, now: () => NOW });
  assert.equal("keeper" in without, false);
  const withKeeper = await careMinute({ ...ENV }, { store, connection: devnet, keyed: true, now: () => NOW });
  assert.deepEqual(withKeeper.keeper, { ran: false, reason: "no agent key here" }, "the keeper's pass ran, and said why it sat still");
});
