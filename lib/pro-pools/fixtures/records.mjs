/*
 * Made-up transactions of a DLMM Pro pool as the server keeps them read (`TapeTxRecords`), every shape the counting has
 * to tell apart: buys and sells, a signer or none, the fee in either coin and in five parts, a price or none, trades
 * that filled orders, orders placed and collected — with their placing kept or not, filled whole, a part, not at all,
 * with a referral's fifth in either coin — and transactions with no time. Seeded: the same seed, the same pool.
 *
 * For the tests that count a day two ways (the server from the records, the database from its rows) and for the
 * measure of the database's functions on a pool as large as the busiest one (`scripts/pro-pools/bench-store.mjs`).
 */

import { word } from "./synthetic.mjs";

/** A small, seeded generator: numbers in [0, 1). */
export function seeded(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
}

const pick = (random, items) => items[Math.floor(random() * items.length)];
/** A base-unit amount: mostly ordinary, sometimes zero, sometimes past what a float holds exactly. */
const amount = (random) => {
  const roll = random();
  if (roll < 0.15) return "0";
  if (roll < 0.25) return (BigInt(Math.floor(random() * 1e9)) * 10n ** 12n + BigInt(Math.floor(random() * 1e9))).toString();
  return String(1 + Math.floor(random() * 1e10));
};

/**
 * `count` transactions of the pool `pool` (an address), newest first, landing back from `nowS` over `hours` (a few
 * with no time). `orders` — how many order accounts are in play; `share` — how likely a transaction holds each kind.
 */
export function recordsOf(pool, { seed = 1, count = 200, nowS = Math.floor(Date.now() / 1000), hours = 30, orders = 40, share = { trade: 0.8, placed: 0.15, collect: 0.12 }, firstSlot = 500_000 } = {}) {
  const random = seeded(seed);
  const wallets = Array.from({ length: 9 }, (_, at) => word(`wallet:${seed}:${at}`, 44));
  const orderIds = Array.from({ length: orders }, (_, at) => word(`order:${pool}:${seed}:${at}`, 44));
  const txs = [];
  let slot = firstSlot;
  let placedSoFar = 0;
  for (let at = 0; at < count; at += 1) {
    slot += 1 + Math.floor(random() * 3);
    const blockTime = random() < 0.03 ? null : nowS - Math.floor(((count - at) / count) * hours * 3600) + Math.floor(random() * 30);
    const time = blockTime === null ? null : new Date(blockTime * 1000).toISOString();
    const signature = word(`tx:${pool}:${seed}:${slot}`, 88);
    const moment = { signature, slot, blockTime };
    const trades = [];
    const placed = [];
    const collects = [];
    const trading = random() < share.trade ? 1 + Math.floor(random() * 3) : 0;
    for (let one = 0; one < trading; one += 1) {
      const parts = [amount(random), random() < 0.3 ? amount(random) : "0", random() < 0.3 ? amount(random) : "0", random() < 0.2 ? amount(random) : "0", random() < 0.1 ? amount(random) : "0"];
      const total = parts.reduce((sum, part) => sum + BigInt(part), 0n);
      const coinRaw = amount(random);
      const quoteRaw = amount(random);
      trades.push({
        signature,
        slot,
        at: time,
        side: random() < 0.5 ? "buy" : "sell",
        wallet: random() < 0.1 ? null : pick(random, wallets),
        coinRaw,
        quoteRaw,
        coinAmount: Number(coinRaw) / 1e6,
        quoteAmount: Number(quoteRaw) / 1e9,
        price: random() < 0.1 ? null : random() * 3,
        poolPrice: random() < 0.15 ? null : 0.001 + random() * 7,
        fee: { token: random() < 0.5 ? "x" : "y", totalRaw: total.toString(), lpRaw: parts[0], ordersRaw: parts[1], protocolRaw: parts[2], referralRaw: parts[3], partnerRaw: parts[4] },
        filled: BigInt(parts[1]) > 0n ? pick(random, ["asks", "bids"]) : null,
      });
    }
    /* Each order is placed once: an order account is one order. */
    if (random() < share.placed && placedSoFar < orderIds.length) {
      const side = random() < 0.5 ? "ask" : "bid";
      placed.push({ signature, slot, at: time, order: orderIds[placedSoFar++], owner: pick(random, wallets), side, amountRaw: amount(random), token: side === "ask" ? "x" : "y", prices: 1 + Math.floor(random() * 4), referral: random() < 0.3 });
    }
    if (random() < share.collect) {
      const shape = Math.floor(random() * 6);
      const principal = () => String(1 + Math.floor(random() * 1e9));
      const [px, py] = shape === 0 ? ["0", principal()] : shape === 1 ? [principal(), "0"] : shape === 2 ? [principal(), principal()] : shape === 3 ? ["0", "0"] : [principal(), random() < 0.5 ? "0" : principal()];
      const bonusX = random() < 0.4 ? String(Math.floor(random() * 1e6)) : "0";
      const bonusY = random() < 0.4 ? String(Math.floor(random() * 1e6)) : "0";
      const referralRaw = random() < 0.3 ? String(1 + Math.floor(random() * 1e5)) : "0";
      collects.push({
        signature,
        slot,
        at: time,
        /* Now and then an order whose placing is never among the rows. */
        order: random() < 0.2 ? word(`order:lost:${pool}:${seed}:${slot}`, 44) : pick(random, orderIds),
        owner: pick(random, wallets),
        paidXRaw: (BigInt(px) + BigInt(bonusX)).toString(),
        paidYRaw: (BigInt(py) + BigInt(bonusY)).toString(),
        bonusXRaw: bonusX,
        bonusYRaw: bonusY,
        referralRaw,
        referralToken: BigInt(referralRaw) > 0n ? pick(random, ["x", "y"]) : null,
        prices: 1 + Math.floor(random() * 4),
        closed: random() < 0.5,
      });
    }
    txs.push({ moment, trades, placed, collects, created: at === 0 && random() < 0.5 });
  }
  return txs.reverse();
}

/** The records as the indexer writes them: read rows, and now and then one not read yet or refused by the node. */
export function storedOf(pool, records, { seed = 1, unread = 0.02, lost = 0.01 } = {}) {
  const random = seeded(seed + 7);
  return records.map((records) => {
    const roll = random();
    const { signature, slot, blockTime } = records.moment;
    if (roll < unread) return { pool, signature, slot, blockTime, state: "unread", misses: 0, records: null };
    if (roll < unread + lost) return { pool, signature, slot, blockTime, state: "lost", misses: 1 + Math.floor(random() * 4), records: null };
    return { pool, signature, slot, blockTime, state: "read", misses: 0, records };
  });
}
