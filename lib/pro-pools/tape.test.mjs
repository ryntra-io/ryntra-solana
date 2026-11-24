import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { Connection } from "@solana/web3.js";

/*
 * A DLMM Pro pool's tape from the program's own events.
 *
 * The transactions are the program's own: its build deployed on mainnet, run in LiteSVM by the rehearsal of
 * 15.11.2026 (`./fixtures/tape-rehearsal.json.gz` keeps the transactions of two of its pools as the node would give
 * them). They are not transactions landed on mainnet — this session's network does not reach a Solana node — but every
 * byte and every event in them is the deployed program's. Each is decoded here by the venue itself, through earning's
 * one door, exactly as the server reads a landed one.
 */

const { createTapeReader, TAPE_LIMITS, TapeUnavailable } = await import("./tape.server.ts");
const tape = await import("./tape.ts");
const { earnProVenue } = await import("../earn-pro/venue.server.ts");

const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/tape-rehearsal.json.gz", import.meta.url))).toString());
const named = Object.fromEntries(fixture.transactions.map((tx) => [tx.name, tx]));
const bySignature = new Map(fixture.transactions.map((tx) => [tx.signature, tx]));

/* A node that answers `getTransaction` from the recording and nothing else. */
const connection = new Connection("http://127.0.0.1:9");
connection._rpcRequest = async (method, params) => {
  assert.equal(method, "getTransaction", `the tape asks the node only for transactions, not ${method}`);
  return { result: bySignature.get(params[0])?.record ?? null };
};
const venue = earnProVenue("mainnet", connection, { RYNTRA_EARN_PRO: "mainnet" });

const coin = (side, symbol, usd) => ({ mint: side.mint, symbol, decimals: side.decimals, usd });
/* RHRSL / USDC — the pool takes its fee in token Y only; RHRSL is token X. */
const USDC_POOL = { address: fixture.pools.usdc.address, x: coin(fixture.pools.usdc.x, "RHRSL", null), y: coin(fixture.pools.usdc.y, "USDC", 1), coin: "x", collectedIn: "tokenY" };
/* A coin with a transfer fee against SOL — the pool takes its fee in the coin a swap pays out. */
const SOL_POOL = { address: fixture.pools.sol.address, x: coin(fixture.pools.sol.x, "COIN", null), y: coin(fixture.pools.sol.y, "SOL", 200), coin: "x", collectedIn: "output" };

const momentOf = (tx) => ({ signature: tx.signature, slot: tx.record.slot, blockTime: tx.record.blockTime });
async function recordsNamed(name, pool) {
  const tx = named[name];
  const events = await venue.events.read(tx.signature);
  assert.ok(events, `${name} decodes`);
  return tape.recordsOf(momentOf(tx), events, pool);
}

const keysOf = (record) => [...record.transaction.message.accountKeys, ...(record.meta.loadedAddresses?.writable ?? []), ...(record.meta.loadedAddresses?.readonly ?? [])];

/** The node's list of a pool's signatures as of a moment, newest first — and the program's events through the venue. */
function recordedSource(asOf, faults = {}) {
  const calls = { list: 0, events: 0, read: [] };
  const source = {
    async list(address, { limit, before, until }) {
      calls.list += 1;
      if (faults.list?.()) throw new Error("the node is down");
      let rows = fixture.transactions.filter((tx) => keysOf(tx.record).includes(address) && tx.record.blockTime <= asOf()).sort((a, b) => b.record.slot - a.record.slot);
      if (before) rows = rows.slice(rows.findIndex((tx) => tx.signature === before) + 1);
      if (until) {
        const at = rows.findIndex((tx) => tx.signature === until);
        if (at >= 0) rows = rows.slice(0, at);
      }
      return rows.slice(0, limit).map((tx) => ({ signature: tx.signature, slot: tx.record.slot, blockTime: tx.record.blockTime, err: tx.record.meta.err }));
    },
    async events(signature) {
      calls.events += 1;
      calls.read.push(bySignature.get(signature)?.name);
      if (faults.events?.(signature)) throw new Error("the node did not answer");
      if (faults.lost?.(signature)) return null;
      return venue.events.read(signature);
    },
  };
  return { source, calls };
}

test("a swap reads as a trade of the coin: what moved on each side, the price, the fee in its five parts and the orders it filled", async () => {
  const buy = await recordsNamed("swapNoReferral", USDC_POOL);
  assert.equal(buy.trades.length, 1);
  const trade = buy.trades[0];
  assert.equal(trade.side, "buy");
  assert.equal(trade.wallet, fixture.transactions.find((tx) => tx.name === "swapNoReferral").record.transaction.message.accountKeys[0], "the swap's signer");
  assert.equal(trade.coinRaw, "9965347467480");
  assert.equal(trade.quoteRaw, "100000000");
  assert.equal(trade.quoteAmount, 100);
  assert.deepEqual(trade.fee, { token: "y", totalRaw: "50000000", lpRaw: "40000000", ordersRaw: "0", protocolRaw: "10000000", referralRaw: "0", partnerRaw: "0" }, "the launch's fee starts at half, all in USDC");
  assert.equal(trade.filled, null);
  /* The pool's price after: the event's square root, squared — USDC per RHRSL. */
  const root = Number(41460308873378692n) / 2 ** 64;
  assert.ok(Math.abs(trade.poolPrice / (root * root) - 1) < 1e-12);
  assert.ok(Math.abs(trade.price - 100 / 9_965_347.46748) < 1e-15, "what the trader got per coin, the fee included");
  assert.equal(trade.at, new Date(named.swapNoReferral.record.blockTime * 1000).toISOString());

  const referral = (await recordsNamed("swapReferral", USDC_POOL)).trades[0];
  assert.equal(referral.fee.referralRaw, "4000141", "the swap's referral — a fifth of the protocol's part — is its own part");

  const sell = (await recordsNamed("swapFillsBids", USDC_POOL)).trades[0];
  assert.equal(sell.side, "sell");
  assert.equal(sell.coinRaw, "199317882085060");
  assert.equal(sell.quoteRaw, "2905516090");
  assert.equal(sell.filled, "bids", "a swap selling token X fills the bids, and its fee share shows it");
  assert.equal(sell.fee.ordersRaw, "4311178");
  assert.equal(BigInt(sell.fee.totalRaw), 26992332n + 9364742n + 4311178n + 1694509n);

  /* The swap named for the asks stopped below them: its event says no order filled, whatever the step was called. */
  assert.equal((await recordsNamed("swapFillsAsks", USDC_POOL)).trades[0].filled, null);

  /* Against SOL with the fee in the output coin: bought with SOL, the fee in the coin, the coin's transfer fee apart. */
  const sol = (await recordsNamed("swapSolIn", SOL_POOL)).trades[0];
  assert.equal(sol.side, "buy");
  assert.equal(sol.quoteRaw, "500000000");
  assert.equal(sol.quoteAmount, 0.5);
  assert.equal(sol.coinRaw, "49003247093", "what the trader received, after the coin's transfer fee");
  assert.equal(sol.fee.token, "x");
  assert.equal(sol.fee.totalRaw, String(399985693n + 99996423n));
});

test("an order placed reads with its side, its coin, what it put in and on how many prices", async () => {
  const asks = (await recordsNamed("placeAsks", USDC_POOL)).placed;
  assert.equal(asks.length, 1);
  assert.equal(asks[0].side, "ask");
  assert.equal(asks[0].token, "x");
  assert.equal(asks[0].prices, 10);
  assert.equal(asks[0].amountRaw, String(10n * 1474812872121n));
  assert.equal(asks[0].referral, false);
  const bids = (await recordsNamed("placeBids", USDC_POOL)).placed[0];
  assert.deepEqual([bids.side, bids.token, bids.amountRaw, bids.prices, bids.referral], ["bid", "y", "600000000", 5, true]);
  assert.equal((await recordsNamed("createPool", USDC_POOL)).created, true);
  assert.equal((await recordsNamed("positionDEPOSIT", USDC_POOL)).created, false);
});

test("a collect reads what filled: whole, a part, the bonus and the referral — and the bonus a swap earned is what its makers took", async () => {
  const sides = new Map([
    [(await recordsNamed("placeAsks", USDC_POOL)).placed[0].order, "ask"],
    [(await recordsNamed("placeBids", USDC_POOL)).placed[0].order, "bid"],
  ]);
  const fill = async (name, pool, known = true) => {
    const records = await recordsNamed(name, pool);
    assert.equal(records.collects.length, 1, `${name} is one collect`);
    return tape.fillOf(records.collects[0], pool, known ? sides.get(records.collects[0].order) : undefined);
  };

  const asks = await fill("collectAsks", USDC_POOL);
  assert.deepEqual([asks.side, asks.coinSide, asks.state], ["ask", "sell", "filled"]);
  assert.equal(asks.proceedsRaw, "132174896", "the rehearsal's own figure: the asks' proceeds in USDC");
  assert.equal(asks.bonusYRaw, "1176529", "and their maker's bonus");
  assert.deepEqual([asks.unfilledRaw, asks.unfilledToken, asks.proceedsToken], ["0", "x", "y"]);
  assert.equal(asks.closed, false);

  const rest = await fill("closeAsks", USDC_POOL);
  assert.deepEqual([rest.side, rest.state, rest.closed], ["ask", "partial", true]);
  assert.equal(rest.unfilledRaw, "6424659760096");
  assert.equal(rest.proceedsRaw, String(17675262n - 141378n));

  const bids = await fill("collectBidsByAgent", USDC_POOL);
  assert.deepEqual([bids.side, bids.coinSide, bids.state], ["bid", "buy", "filled"]);
  assert.equal(bids.proceedsRaw, "36147690010899");
  assert.deepEqual([bids.bonusYRaw, bids.referralRaw, bids.referralToken], ["3448943", "862235", "y"], "the rehearsal's own figures: the owner's four fifths and the referral's fifth");
  const swap = (await recordsNamed("swapFillsBids", USDC_POOL)).trades[0];
  assert.equal(BigInt(swap.fee.ordersRaw), BigInt(bids.bonusYRaw) + BigInt(bids.referralRaw), "what the swap gave the bids is what their maker and referral took");

  /* Without the placing read, the payout alone tells these three. */
  assert.deepEqual([(await fill("collectAsks", USDC_POOL, false)).side, (await fill("collectBidsByAgent", USDC_POOL, false)).side], ["ask", "bid"]);
  const unknown = await fill("closeAsks", USDC_POOL, false);
  assert.deepEqual([unknown.side, unknown.state, unknown.proceedsRaw], [null, "partial", null], "both coins back and the fee in Y alone: a part filled, the side not told");

  /* Against SOL, the order's placing not recorded: an ask told by the payout, filled whole, the bonus in the coin. */
  const sol = await fill("collectAsksE", SOL_POOL, false);
  assert.deepEqual([sol.side, sol.state, sol.proceedsToken, sol.proceedsRaw], ["ask", "filled", "y", "908501070"]);
  assert.deepEqual([sol.bonusXRaw, sol.referralRaw, sol.referralToken], ["360000001", "90000000", "x"]);
});

test("the side of a payout is told only where nothing else could be meant", () => {
  const collect = (paidX, paidY, bonusX = 0n, bonusY = 0n, referral = 0n, referralToken = null) => ({ signature: "s", slot: 1, at: null, order: "o", owner: "w", paidXRaw: String(paidX), paidYRaw: String(paidY), bonusXRaw: String(bonusX), bonusYRaw: String(bonusY), referralRaw: String(referral), referralToken, prices: 1, closed: false });
  const pool = (collectedIn) => ({ coin: "x", collectedIn });
  /* A fee and one coin back: the coin a fill pays. */
  assert.equal(tape.sideOfPayout(collect(0n, 50n, 0n, 5n), "tokenY"), "ask");
  assert.equal(tape.sideOfPayout(collect(70n, 5n, 0n, 5n), "tokenY"), "bid");
  /* Both back, the fee in the output coin: its coin names the side; in token Y only, nothing does. */
  assert.equal(tape.sideOfPayout(collect(40n, 50n, 3n, 0n), "output"), "ask");
  assert.equal(tape.sideOfPayout(collect(40n, 50n, 0n, 3n), "output"), "bid");
  assert.equal(tape.sideOfPayout(collect(40n, 50n, 0n, 0n, 2n, "x"), "output"), "ask");
  assert.equal(tape.sideOfPayout(collect(40n, 50n, 0n, 3n), "tokenY"), null);
  /* No fee: a plain cancel and a fill whose share rounded to nothing look alike. */
  assert.equal(tape.sideOfPayout(collect(40n, 0n), "output"), null);
  const plain = tape.fillOf(collect(40n, 0n), pool("output"));
  assert.deepEqual([plain.side, plain.state], [null, null], "never guessed");
  assert.equal(tape.fillOf(collect(0n, 0n), pool("output")).state, "unfilled");
  /* Its placing read, the same payout is plain: a bid whose share rounded down, filled whole. */
  const bid = tape.fillOf(collect(40n, 0n), pool("output"), "bid");
  assert.deepEqual([bid.side, bid.state, bid.proceedsRaw, bid.coinSide], ["bid", "filled", "40", "buy"]);
  assert.deepEqual([tape.fillOf(collect(40n, 0n), pool("output"), "ask").state], ["unfilled"]);
  /* When the coin people trade is token Y, an ask buys it. */
  assert.equal(tape.fillOf(collect(0n, 50n, 0n, 5n), { coin: "y", collectedIn: "tokenY" }).coinSide, "buy");
});

test("events of another pool and fields that are not the program's are passed over, never read as zero", () => {
  const moment = { signature: "s", slot: 1, blockTime: 1_800_000_000 };
  const swap = { pool: USDC_POOL.address, swapForY: true, feesOnTokenX: false, amountIn: "10", amountOut: "20", mmFee: "1", limitOrderFee: "0", protocolFee: "0", hostFee: "0", partnerFee: "0", postSqrtPrice: "18446744073709551616" };
  const records = tape.recordsOf(
    moment,
    [
      { name: "evtSwap", data: { ...swap, pool: SOL_POOL.address }, user: "a" },
      { name: "evtSwap", data: { ...swap, amountIn: "-5" }, user: "b" },
      { name: "evtSwap", data: { ...swap, mmFee: undefined }, user: "c" },
      { name: "evtSwap", data: swap, user: "d" },
      { name: "evtCancelLimitOrder", data: { pool: USDC_POOL.address, limitOrder: "o", owner: "w", ownerAmountX: "1", ownerAmountY: "0", ownerFeeX: "2", ownerFeeY: "0", referralFee: "0" }, user: null },
    ],
    USDC_POOL,
  );
  assert.deepEqual(records.trades.map((trade) => trade.wallet), ["d"]);
  assert.equal(records.trades[0].poolPrice, 1, "a square root of one is a price of one");
  assert.equal(records.collects.length, 0, "a bonus larger than the payout is not the program's");
});

test("the day of a pool: trades, volume, fees, orders and bonus, counted from the pool's creation", async () => {
  let asOf = named.removeCompounded.record.blockTime + 60;
  const { source, calls } = recordedSource(() => asOf);
  const reader = createTapeReader(source);
  const now = asOf * 1000;
  const view = await reader.read(USDC_POOL, now);
  assert.equal(calls.list, 1);
  assert.equal(calls.events, 17, "each transaction of the pool read once");
  assert.equal(view.depth.whole, true);
  assert.equal(view.depth.stop, "start", "the pool's creation was read: there is nothing older");
  assert.equal(view.depth.transactions, 17);
  assert.equal(view.depth.from, new Date(named.createPool.record.blockTime * 1000).toISOString());

  const stats = tape.statsOf(view, now);
  assert.equal(stats.whole, true);
  assert.deepEqual(stats.trades, { count: 5, buys: 4, sells: 1, wallets: 2 });
  assert.equal(stats.volume.quoteRaw, String(100000000n + 200000000n + 500000000n + 60000000n + 2905516090n));
  assert.equal(stats.volume.coinRaw, String(9965347467480n + 19530909974945n + 49419271554401n + 3378521219822n + 199317882085060n));
  assert.ok(Math.abs(stats.volume.usd - 3765.51609) < 1e-9, "in dollars through USDC's price");
  assert.deepEqual(stats.fees.total, { xRaw: "0", yRaw: "427802732", usd: 427.802732 });
  assert.equal(BigInt(stats.fees.lp.yRaw) + BigInt(stats.fees.orders.yRaw) + BigInt(stats.fees.protocol.yRaw) + BigInt(stats.fees.referral.yRaw) + BigInt(stats.fees.partner.yRaw), 427802732n, "the five parts add up to the whole");
  assert.equal(stats.fees.referral.yRaw, "15112107");
  assert.deepEqual(
    { ...stats.orders, bonusEarned: stats.orders.bonusEarned.yRaw, bonusPaid: stats.orders.bonusPaid.yRaw, referralPaid: stats.orders.referralPaid.yRaw },
    { placed: 2, fillingTrades: 1, filled: 2, partial: 1, unfilled: 0, unknown: 0, bonusEarned: "4311178", bonusPaid: String(1176529n + 141378n + 3448943n), referralPaid: "862235" },
  );
  assert.ok(stats.price.first < stats.price.last, "the price climbed with the buys and stood higher after the sell");

  const trades = tape.tradesAnswerOf(view, "mainnet", now, 50);
  assert.deepEqual(trades.trades.map((trade) => trade.signature), ["swapFillsBids", "swapFillsAsks", "swapClimb", "swapReferral", "swapNoReferral"].map((name) => named[name].signature), "newest first");
  assert.equal(tape.tradesAnswerOf(view, "mainnet", now, 2).trades.length, 2);
  assert.deepEqual(trades.pair.coin.symbol, "RHRSL");
  assert.deepEqual(trades.pair.quote.side, "y");
  const fills = tape.fillsAnswerOf(view, "mainnet", now, 50);
  assert.deepEqual(fills.fills.map((fill) => [fill.signature, fill.state]), [[named.collectBidsByAgent.signature, "filled"], [named.closeAsks.signature, "partial"], [named.collectAsks.signature, "filled"]]);

  const answer = tape.statsAnswerOf(view, "mainnet", now);
  assert.equal(tape.isProStatsAnswer(JSON.parse(JSON.stringify(answer))), true, "the answer is plain JSON a screen can check");
  assert.equal(tape.isProTradesAnswer(JSON.parse(JSON.stringify(trades))), true);
  assert.equal(tape.isProFillsAnswer(JSON.parse(JSON.stringify(fills))), true);
  assert.equal(tape.isProStatsAnswer({ ...answer, stats: null }), false);

  /* Fresh: asked again within its time, the node is not asked at all. */
  await reader.read(USDC_POOL, now + 5_000);
  assert.deepEqual([calls.list, calls.events], [1, 17]);

  /* A day later: the head is listed from the newest known, only the new transactions are read, and the day holds no trades — the tape still shows the last ones. */
  asOf = named.collectPastFrozen.record.blockTime + 60;
  const later = await reader.read(USDC_POOL, asOf * 1000);
  assert.deepEqual([calls.list, calls.events], [2, 19]);
  assert.deepEqual([later.depth.whole, later.depth.stop], [true, "window"]);
  const day = tape.statsOf(later, asOf * 1000);
  assert.deepEqual([day.trades.count, day.volume.quoteRaw, day.volume.usd, day.fees.total.usd], [0, "0", 0, 0], "a day known to be quiet is zeros, and only then");
  assert.equal(day.from, new Date((asOf - 24 * 3600) * 1000).toISOString());
  assert.equal(tape.tradesAnswerOf(later, "mainnet", asOf * 1000, 50).trades.length, 5);
});

test("a pool read in parts says how deep each part reaches, and the next reads go on from there", async () => {
  const asOf = named.removeCompounded.record.blockTime + 60;
  const { source, calls } = recordedSource(() => asOf);
  const reader = createTapeReader(source, { ...TAPE_LIMITS, readsPerRefresh: 5, page: 4 });
  let now = asOf * 1000;
  const first = await reader.read(USDC_POOL, now);
  assert.deepEqual([first.depth.transactions, first.depth.whole, first.depth.stop], [4, false, "budget"], "one page of four listed and read");
  assert.equal(first.depth.from, new Date(named.collectBidsByAgent.record.blockTime * 1000).toISOString());
  const part = tape.statsOf(first, now);
  assert.equal(part.whole, false);
  assert.equal(part.from, first.depth.from, "counted from as deep as it was read, and saying so");
  assert.equal(part.trades.count, 0);
  assert.deepEqual(calls.read, ["removeCompounded", "compound", "claimFee", "collectBidsByAgent"], "newest first");

  const depths = [];
  for (let round = 0; round < 8; round += 1) {
    now += TAPE_LIMITS.fresh;
    const view = await reader.read(USDC_POOL, now);
    depths.push(view.depth.transactions);
    if (view.depth.whole) break;
  }
  assert.deepEqual(depths, [8, 12, 16, 17], "a page a read: the list goes on only once what is listed is read");
  assert.equal(calls.events, 17, "never a transaction twice");
});

test("the node silent is a refusal, never a day of zeros; a list it gave a moment ago is served as it stands", async () => {
  const asOf = named.removeCompounded.record.blockTime + 60;
  let down = true;
  const listDown = recordedSource(() => asOf, { list: () => down });
  const reader = createTapeReader(listDown.source);
  await assert.rejects(reader.read(USDC_POOL, asOf * 1000), TapeUnavailable);
  assert.equal(reader.size(), 0, "a pool never read is not kept");
  down = false;
  const view = await reader.read(USDC_POOL, asOf * 1000 + 1);
  assert.equal(view.depth.transactions, 17);
  down = true;
  const stale = await reader.read(USDC_POOL, asOf * 1000 + TAPE_LIMITS.fresh + 1);
  assert.equal(stale.depth.checked, new Date(asOf * 1000 + 1).toISOString(), "when it was last listed");
  await assert.rejects(reader.read(USDC_POOL, asOf * 1000 + 2 * TAPE_LIMITS.fresh + TAPE_LIMITS.stale), TapeUnavailable, "past its staleness it is a refusal again");

  const readsDown = recordedSource(() => asOf, { events: () => true });
  await assert.rejects(createTapeReader(readsDown.source).read(USDC_POOL, asOf * 1000), TapeUnavailable, "listed but nothing read");

  /* A transaction the node does not give: the tape stops before it and says the node is why. */
  const lost = recordedSource(() => asOf, { lost: (signature) => signature === named.swapClimb.signature });
  const gap = await createTapeReader(lost.source).read(USDC_POOL, asOf * 1000);
  assert.deepEqual([gap.depth.whole, gap.depth.stop, gap.depth.transactions], [false, "node", 10]);
  assert.equal(gap.depth.from, new Date(named.placeAsks.record.blockTime * 1000).toISOString());
  assert.equal(tape.statsOf(gap, asOf * 1000).trades.count, 2, "only what lies above the gap is counted");

  /* A pool whose list ends before its creation — the recording holds two of its transactions: read, and not called whole. */
  const solAsOf = named.collectAsksE.record.blockTime + 60;
  const sol = await createTapeReader(recordedSource(() => solAsOf).source).read(SOL_POOL, solAsOf * 1000);
  assert.deepEqual([sol.depth.transactions, sol.depth.whole, sol.depth.stop], [2, false, "node"]);
  const solStats = tape.statsOf(sol, solAsOf * 1000);
  assert.deepEqual([solStats.trades.count, solStats.orders.filled, solStats.orders.bonusPaid.xRaw], [1, 1, "360000001"]);
  assert.equal(solStats.volume.usd, 100, "half a SOL at two hundred");
  assert.equal(solStats.fees.total.usd, null, "a fee in a coin with no price has no dollar figure");
});

test("a day read of a quiet pool lists it and reads no transaction; the pool's own tape still reads its last trades", async () => {
  const asOf = Math.max(...fixture.transactions.map((tx) => tx.record.blockTime)) + 2 * 86_400;
  const { source, calls } = recordedSource(() => asOf);
  const reader = createTapeReader(source);
  const now = asOf * 1000;
  const day = await reader.read(USDC_POOL, now, "day");
  assert.deepEqual([calls.list, calls.events], [1, 0], "one list, no transaction");
  assert.deepEqual([day.depth.whole, day.depth.stop, day.depth.transactions], [true, "window", 0], "a day known to be quiet");
  const stats = tape.statsOf(day, now);
  assert.deepEqual([stats.whole, stats.trades.count, stats.volume.usd, stats.fees.lp.usd], [true, 0, 0, 0], "true zeros");
  await reader.read(USDC_POOL, now + 1, "day");
  assert.equal(calls.list, 1, "a day read is fresh for the day");
  const tapeView = await reader.read(USDC_POOL, now + 2);
  assert.equal(calls.list, 2, "a day read is not a tape read");
  const read = calls.events;
  assert.ok(read >= 17, "the tape reads the pool's last transactions");
  assert.deepEqual([tapeView.depth.whole, tapeView.depth.transactions], [true, read]);
  await reader.read(USDC_POOL, now + 3, "day");
  assert.equal(calls.list, 2, "a tape read is a day read too");
  const after = await reader.read(USDC_POOL, now + 4 + TAPE_LIMITS.fresh, "day");
  assert.equal(calls.events, read, "a day read never reads past the day");
  assert.equal(after.depth.transactions, read, "and lets go of nothing the tape read");
});

test("a day read takes only its share of the minute's budget, so the first busy pools do not leave the rest with nothing", async () => {
  const asOf = named.removeCompounded.record.blockTime + 60;
  const limits = { ...TAPE_LIMITS, readsPerMinute: 12, dayReads: 5 };
  const day = recordedSource(() => asOf);
  const reader = createTapeReader(day.source, limits);
  const now = asOf * 1000;
  const first = await reader.read(USDC_POOL, now, "day");
  assert.equal(day.calls.events, 5, "five of the day's seventeen");
  assert.deepEqual([first.depth.transactions, first.depth.whole, first.depth.stop], [5, false, "budget"], "a floor, said as one — not a refusal");
  const second = await reader.read(USDC_POOL, now + TAPE_LIMITS.fresh, "day");
  assert.deepEqual([day.calls.events, second.depth.transactions], [10, 10], "the next refresh goes on from there");
  /* The pool's own page still reads as deep as the budget lets it. */
  const page = recordedSource(() => asOf);
  await createTapeReader(page.source, limits).read(USDC_POOL, now);
  assert.equal(page.calls.events, 12);
});

test("a day read deeper takes more of the day from what is left of the budget, without listing the pool again", async () => {
  const asOf = named.removeCompounded.record.blockTime + 60;
  const { source, calls } = recordedSource(() => asOf);
  const reader = createTapeReader(source, { ...TAPE_LIMITS, readsPerMinute: 14, dayReads: 5, reserve: 3 });
  const now = asOf * 1000;
  await reader.read(USDC_POOL, now, "day");
  assert.deepEqual([calls.list, calls.events], [1, 5]);
  const deeper = await reader.deepen(USDC_POOL, now + 1);
  assert.deepEqual([calls.list, calls.events], [1, 11], "no new list; six more — what the minute had left, less the reserve for the next first shares");
  assert.deepEqual([deeper.depth.transactions, deeper.depth.whole], [11, false]);
  const later = await reader.deepen(USDC_POOL, now + 61_000);
  assert.deepEqual([later.depth.transactions, later.depth.whole], [17, true], "the next minute finishes the day");
});

test("a transaction the node refused three times is asked once more after a while, so a refused burst leaves no gap for good", async () => {
  const asOf = named.removeCompounded.record.blockTime + 60;
  let refusing = true;
  const { source, calls } = recordedSource(() => asOf, { events: (signature) => refusing && signature === named.removeCompounded.signature });
  const reader = createTapeReader(source);
  const now = asOf * 1000;
  for (let turn = 0; turn < TAPE_LIMITS.tries; turn += 1) await assert.rejects(reader.read(USDC_POOL, now + turn * TAPE_LIMITS.fresh, "day"), TapeUnavailable, "the newest one missing: nothing below it is counted");
  const before = calls.events;
  refusing = false;
  await assert.rejects(reader.read(USDC_POOL, now + TAPE_LIMITS.tries * TAPE_LIMITS.fresh, "day"), TapeUnavailable, "within the while it is left as the node's gap");
  assert.equal(calls.events, before, "and not asked");
  const later = await reader.read(USDC_POOL, now + TAPE_LIMITS.tries * TAPE_LIMITS.fresh + TAPE_LIMITS.stale, "day");
  assert.deepEqual([later.depth.whole, later.depth.transactions], [true, 17], "asked again, and the day is whole");
});

test("the process's budget holds however many pools are asked, and the pools kept are bounded", async () => {
  let asOf = named.removeCompounded.record.blockTime + 60;
  const { source, calls } = recordedSource(() => asOf);
  const reader = createTapeReader(source, { ...TAPE_LIMITS, readsPerMinute: 6, pools: 1 });
  const now = asOf * 1000;
  const first = await reader.read(USDC_POOL, now);
  assert.equal(calls.events, 6);
  assert.equal(first.depth.stop, "budget");
  const again = await reader.read(USDC_POOL, now + TAPE_LIMITS.fresh);
  assert.equal(calls.events, 6, "within the minute nothing more is read");
  assert.equal(again.depth.transactions, 6);
  const later = await reader.read(USDC_POOL, now + 60_000);
  assert.equal(later.depth.transactions, 12);
  /* Another pool while the minute's budget is spent: nothing of it can be read, and that is a refusal, not an empty day. */
  const solAsOf = named.collectAsksE.record.blockTime + 60;
  asOf = solAsOf;
  await assert.rejects(reader.read(SOL_POOL, now + 60_000), TapeUnavailable);
  assert.equal(reader.size(), 1, "the least recently asked pool is let go");
  const sol = await reader.read(SOL_POOL, now + 120_000);
  assert.equal(sol.depth.transactions, 2);
});

test("depth: a day closed by a transaction older than it, read or not; a gap is the budget's or the node's", () => {
  const day = 1_000_000;
  const read = (blockTime, created = false) => ({ blockTime, state: "read", created });
  const depth = (list, end = false) => tape.depthOf(list, end, day, null);
  assert.deepEqual(depth([read(day + 50), read(day + 10), { blockTime: day - 5, state: "unread", created: false }]), { from: new Date((day + 10) * 1000).toISOString(), checked: null, transactions: 2, whole: true, stop: "window" });
  const past = depth([read(day + 50), read(day - 5), read(day - 9)]);
  assert.deepEqual([past.transactions, past.whole, past.stop], [3, true, "window"], "the tape reaches past the day; the day is whole");
  assert.deepEqual(depth([read(day + 50), { blockTime: day + 10, state: "unread", created: false }]).stop, "budget");
  assert.deepEqual(depth([read(day + 50), { blockTime: day + 10, state: "lost", created: false }]).stop, "node");
  assert.deepEqual([depth([read(day + 50)], true).stop, depth([read(day + 50)], false).stop], ["node", "budget"]);
  assert.deepEqual([depth([read(day + 50), read(day + 9, true)]).stop, depth([read(day + 50), read(day + 9, true)]).whole], ["start", true]);
  assert.deepEqual(depth([]), { from: null, checked: null, transactions: 0, whole: false, stop: "budget" });
  const none = tape.spanOf(depth([]), day * 1000);
  assert.deepEqual(none, { since: null, whole: false });
});

test("small parts: a list's limit, a price from a square root, base units in whole coins, dollars of two coins", () => {
  assert.deepEqual(["", null, "1", "100", "0", "101", "5.5", "-1", "1e2", "abc"].map(tape.pageLimitOf), [50, 50, 1, 100, null, null, null, null, null, null]);
  assert.equal(tape.priceOfSqrt("0", 6, 6), null);
  assert.equal(tape.priceOfSqrt("not", 6, 6), null);
  assert.equal(tape.priceOfSqrt(String(2n ** 64n), 9, 6), 1000, "token X with more decimals: a raw price of one is a thousand whole");
  assert.equal(tape.wholeOf("123456789", 6), 123.456789);
  assert.equal(tape.wholeOf(10n ** 30n, 9), 1e21);
  assert.equal(tape.usdOf({ x: { decimals: 6, usd: null }, y: { decimals: 6, usd: 1 } }, 0n, 2_000_000n), 2);
  assert.equal(tape.usdOf({ x: { decimals: 6, usd: null }, y: { decimals: 6, usd: 1 } }, 1n, 2_000_000n), null);
  assert.deepEqual(
    tape.tapePoolOf({ address: "p", x: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, usd: 200 }, y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, usd: 1 }, fee: { collectedIn: "tokenY" } }),
    { address: "p", x: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, usd: 200 }, y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, usd: 1 }, coin: "x", collectedIn: "tokenY" },
    "SOL against a dollar is SOL's market",
  );
});
