// The answers of a DLMM Pro pool's open reads (`/stats`, `/trades`, `/fills`) for the shots' stand, made by
// the engine's own functions from the program's recorded transactions (`lib/pro-pools/fixtures/tape-rehearsal.json.gz`,
// the rehearsal: the build deployed on mainnet, run in LiteSVM) — not a mainnet pool, nothing made up.
//   node terminal/pool/shots-367-tape.mjs <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Connection } from "@solana/web3.js";

const tape = await import("../../lib/pro-pools/tape.ts");
const { earnProVenue } = await import("../../lib/earn-pro/venue.server.ts");

const fixture = JSON.parse(gunzipSync(readFileSync(new URL("../../lib/pro-pools/fixtures/tape-rehearsal.json.gz", import.meta.url))).toString());
const bySignature = new Map(fixture.transactions.map((tx) => [tx.signature, tx]));
const connection = new Connection("http://127.0.0.1:9");
connection._rpcRequest = async (method, params) => ({ result: method === "getTransaction" ? (bySignature.get(params[0])?.record ?? null) : null });
const venue = earnProVenue("mainnet", connection, { RYNTRA_EARN_PRO: "mainnet" });

const side = fixture.pools.usdc;
const pool = { address: side.address, x: { mint: side.x.mint, symbol: "RHRSL", decimals: side.x.decimals, usd: null }, y: { mint: side.y.mint, symbol: "USDC", decimals: side.y.decimals, usd: 1 }, coin: "x", collectedIn: "tokenY" };
const keysOf = (record) => [...record.transaction.message.accountKeys, ...(record.meta.loadedAddresses?.writable ?? []), ...(record.meta.loadedAddresses?.readonly ?? [])];
const mine = fixture.transactions.filter((tx) => keysOf(tx.record).includes(pool.address) && !tx.record.meta.err).sort((a, b) => b.record.slot - a.record.slot);
const txs = [];
const sides = new Map();
for (const tx of mine) {
  const events = await venue.events.read(tx.signature);
  if (!events) continue;
  const records = tape.recordsOf({ signature: tx.signature, slot: tx.record.slot, blockTime: tx.record.blockTime }, events, pool);
  for (const placed of records.placed) sides.set(placed.order, placed.side);
  txs.push(records);
}
const oldest = mine.at(-1).record.blockTime;
// The day ends an hour short of a day after the pool was made: its trades of the first hour fall inside it.
const now = (oldest + 23 * 3600) * 1000;
const depth = { from: new Date(oldest * 1000).toISOString(), checked: new Date(now).toISOString(), transactions: txs.length, whole: true, stop: "start" };
const view = { pool, depth, txs, sides };
writeFileSync(process.argv[2], JSON.stringify({ pool: pool.address, stats: tape.statsAnswerOf(view, "mainnet", now), trades: tape.tradesAnswerOf(view, "mainnet", now, 50), fills: tape.fillsAnswerOf(view, "mainnet", now, 50) }, null, 2));
console.log(pool.address, txs.length, "transactions");
