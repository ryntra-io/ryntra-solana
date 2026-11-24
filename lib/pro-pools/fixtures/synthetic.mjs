/*
 * A node made up for the indexer's tests: pools with landed transactions whose events are written the way the venue's
 * decoder gives the program's own (`evtSwap`, `evtOpenLimitOrder`, …), so `recordsOf` reads them as it reads real ones.
 * The real program's transactions are in `./tape-rehearsal.json.gz`; these are for the cases a recording cannot hold —
 * hundreds of transactions, a node that fails on cue, days passing.
 */

const SOL = "So11111111111111111111111111111111111111112";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A base58 word of a length, made from a seed — an address or a signature that passes the store's own checks. */
export function word(seed, length) {
  let state = 0;
  for (const char of String(seed)) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  let out = "";
  for (let at = 0; at < length; at += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    out += B58[state % B58.length];
  }
  return out;
}

export const addressOf = (name) => word(`pool:${name}`, 44);

/** A pool's row as the pools' list gives it: a coin against SOL at $100, the fee in token Y. */
export const rowOf = (name) => ({
  address: addressOf(name),
  x: { mint: word(`mint:${name}`, 44), symbol: name, name: null, decimals: 6, icon: null, verified: null, usd: 1 },
  y: { mint: SOL, symbol: "SOL", name: "Solana", decimals: 9, icon: null, verified: true, usd: 100 },
  fee: { collectedIn: "tokenY" },
});

/** A buy of the coin for one SOL — a hundred dollars of volume, a thousand lamports to liquidity. */
export const swapOf = (pool, wallet = "trader") => ({
  name: "evtSwap",
  user: wallet,
  data: { pool, swapForY: false, feesOnTokenX: false, amountIn: "1000000000", amountOut: "5000000", mmFee: "1000", limitOrderFee: "0", protocolFee: "0", hostFee: "0", partnerFee: "0", postSqrtPrice: (2n ** 64n).toString() },
});

/**
 * A node over made-up pools. `land(name, at, events?)` lands a transaction of the pool at a unix second (a swap unless
 * told otherwise); `source` is what the indexer reads; `calls` counts and remembers what it asked; `faults` fail on cue.
 * With `asOf` (unix seconds) the node lists only what has landed by then — a day written ahead and lived through.
 */
export function chain(asOf = () => Infinity) {
  const pools = new Map();
  let slot = 1_000;
  const calls = { list: 0, events: 0, read: [] };
  const faults = { list: () => false, events: () => false, lost: () => false };
  const names = new Map();

  function land(name, blockTime, events) {
    const address = addressOf(name);
    slot += 1;
    const signature = word(`tx:${name}:${slot}`, 88);
    const tx = { signature, slot, blockTime, err: null, events: events ?? [swapOf(address)], label: `${name}${(pools.get(address)?.length ?? 0) + 1}` };
    pools.set(address, [tx, ...(pools.get(address) ?? [])]);
    names.set(signature, tx.label);
    return tx;
  }

  const source = {
    async list(address, { limit, before, until }) {
      calls.list += 1;
      if (faults.list(address)) throw new Error("the node is down");
      const by = asOf();
      let rows = (pools.get(address) ?? []).filter((tx) => tx.blockTime <= by);
      if (before) rows = rows.slice(rows.findIndex((tx) => tx.signature === before) + 1);
      if (until) {
        const at = rows.findIndex((tx) => tx.signature === until);
        if (at >= 0) rows = rows.slice(0, at);
      }
      return rows.slice(0, limit).map((tx) => ({ signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime, err: tx.err }));
    },
    async events(signature) {
      calls.events += 1;
      calls.read.push(names.get(signature));
      if (faults.events(signature, names.get(signature))) throw new Error("the node did not answer");
      if (faults.lost(signature, names.get(signature))) return null;
      for (const txs of pools.values()) {
        const tx = txs.find((one) => one.signature === signature);
        if (tx) return tx.events;
      }
      return null;
    },
  };

  return { land, source, calls, faults, labelOf: (signature) => names.get(signature) };
}
