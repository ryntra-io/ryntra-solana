// «buy cheaper» on a DLMM Pro pool of devnet, through the very routes the Spot's Limit tab calls: the market,
// the quote, the Review, the person's signature, the relay, the orders — then the ladder closed and its rent taken back.
//   STAND_KEY=<devnet key file> COIN=<devnet mint> node terminal/coin/ladder/devnet.mjs [baseUrl] [out.json]
// A stand at localhost whose server opened the ladders on devnet (`RYNTRA_PRO_LIMITS=devnet`). The key signs in this
// process only, only bytes whose Review said `devnet`; it never reaches a page. → each step's signatures in out.json.
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3121";
const out = process.argv[3] ?? "ladder-devnet.json";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("A stand at localhost only.");
const keyFile = process.env.STAND_KEY;
if (!keyFile) throw new Error("STAND_KEY names the devnet test key file, outside the repository.");
if (path.resolve(keyFile).toLowerCase().startsWith(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..").toLowerCase())) throw new Error("The key file must live outside the repository.");
const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8"))));
const owner = key.publicKey.toBase58();
const coin = process.env.COIN;
if (!coin) throw new Error("COIN names the devnet coin whose DLMM Pro pool the ladder rests in.");
const journal = { owner, coin, steps: [] };
const say = (step, detail) => {
  journal.steps.push({ step, ...detail });
  console.log(`${step} | ${JSON.stringify(detail).slice(0, 400)}`);
};

async function call(path, body) {
  for (let i = 0; ; i += 1) {
    const response = await fetch(`${base}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    const json = await response.json().catch(() => null);
    // The public devnet node refuses bursts: the same call once more after a pause.
    if (response.status === 503 && i < 6 && /429/.test(JSON.stringify(json))) {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      continue;
    }
    return { status: response.status, json };
  }
}

function signAll(review) {
  if (review.network !== "devnet") throw new Error("Only devnet's bytes are signed here.");
  return review.transactions.map((wire) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    tx.sign([key]);
    return Buffer.from(tx.serialize()).toString("base64");
  });
}

async function act(name, request) {
  const review = await call("/api/v1/ladders/review", request);
  if (review.status !== 200) {
    say(`${name}: Review`, { status: review.status, error: review.json?.error ?? review.json });
    return null;
  }
  const r = review.json;
  say(`${name}: Review`, { action: r.action, network: r.network, transactions: r.transactions.length, nftMint: r.nftMint, rentLamports: r.rentLamports, networkFeeLamports: r.networkFeeLamports, quote: r.quote ? { rungs: r.quote.rungs.length, amountRaw: r.quote.amountRaw, averagePrice: r.quote.averagePrice, bonus: r.quote.bonus } : null });
  const sent = await call("/api/v1/ladders/submit", { ticket: r.ticket, signed: signAll(r) });
  say(`${name}: relay`, { status: sent.status, ...(sent.json ?? {}) });
  return sent.status === 200 ? { review: r, relay: sent.json } : null;
}

const market = await call(`/api/v1/ladders/market?mint=${coin}`);
say("market", { status: market.status, pool: market.json?.market?.pool ?? null, quote: market.json?.market?.quote?.symbol ?? market.json?.market?.quote ?? null });
const pool = market.json?.market?.pool;
if (!pool) throw new Error("No DLMM Pro market for the coin on the stand.");
const intent = { action: "buy", nearBps: 500, farBps: 2000, rungs: 3, spread: "even", amountRaw: process.env.AMOUNT_RAW ?? "15000000" };
const quote = await call("/api/v1/ladders/quote", { mint: coin, intent });
say("quote", { status: quote.status, rungs: quote.json?.rungs?.map((rung) => [rung.awayBps, rung.price]), bonus: quote.json?.bonus });
const placed = await act("place", { action: "place", owner, mint: coin, intent, agent: false });
await new Promise((resolve) => setTimeout(resolve, 8_000));
const orders = await call(`/api/v1/ladders/orders?owner=${owner}&mint=${coin}`);
say("orders", { status: orders.status, orders: (orders.json?.orders ?? []).map((order) => ({ nftMint: order.nftMint, state: order.state, action: order.action })) });
if (placed) await act("close", { action: "close", owner, pool, nftMint: placed.review.nftMint });
writeFileSync(out, JSON.stringify(journal, null, 2));
