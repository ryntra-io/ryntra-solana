// Test helpers for the Harbor: the engine's own recorded Meteora catalogue (16.10), a Review shaped like the engine's,
// a positions answer, and an engine that answers from a script.
import { readFileSync } from "node:fs";

import { mapCatalogPage } from "../../../../lib/liquidity/catalog/model.ts";

const read = (name) => JSON.parse(readFileSync(new URL(`../../../../lib/liquidity/catalog/fixtures/${name}`, import.meta.url), "utf8"));

export const CATALOG = [...mapCatalogPage(read("dlmm-catalog-2026-10-16.json"), "dlmm").pools, ...mapCatalogPage(read("damm-v2-catalog-2026-10-16.json"), "damm-v2").pools];

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
export const POSITION = "8xPos1tionAddr3ssxxxxxxxxxxxxxxxxxxxxxxxxx1";

/** A signed transaction's wire: the signature count, one signature of `byte`s, and a message. */
export function wire(byte = 7) {
  const bytes = new Uint8Array(1 + 64 + 8);
  bytes[0] = 1;
  bytes.fill(byte, 1, 65);
  return Buffer.from(bytes).toString("base64");
}

/** An add Review as the engine answers it. */
export function addReview(changes = {}) {
  return {
    preview: {
      action: "add",
      venue: "meteora-dlmm",
      pool: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
      fees: [],
      rent: [
        { what: "position", direction: "pay", lamports: "57000000", refundable: true },
        { what: "bin_arrays", direction: "pay", lamports: "71000000", refundable: false },
      ],
      transactions: 1,
      notices: ["partial_deposit", "transfer_fee"],
      price: "103.15",
      at: 1,
      expiresAt: 2,
      request: {},
      opensPosition: true,
      range: { kind: "bins", lowerBin: -34, upperBin: 34, lowerPrice: "101.7", upperPrice: "104.6" },
      rangeState: "in_range",
      deposit: { x: { asset: WSOL, units: "242000000", decimals: 9 }, y: { asset: USDC, units: "25004650", decimals: 6 } },
    },
    transactions: [{ wireBase64: wire(1), presigned: [] }],
    position: POSITION,
    ticket: "ticket-1",
    expiresAt: 0,
    signableMs: 20_000,
    networkFeeLamports: "10000",
    depositUsd: null,
    ...changes,
  };
}

/** A position as the engine's positions route shows it. */
export function positionView(changes = {}) {
  return {
    kind: "dlmm",
    address: POSITION,
    pool: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
    name: "SOL-USDC",
    x: { mint: WSOL, symbol: "SOL", amount: 0.24, unclaimed: 0.0021, priceUsd: 103.2 },
    y: { mint: USDC, symbol: "USDC", amount: 25, unclaimed: 0.31, priceUsd: 1 },
    rangeState: "in_range",
    lower: 101.7,
    upper: 104.6,
    price: 103.1,
    valueUsd: 49.77,
    unclaimedUsd: 0.53,
    lockedBps: 0,
    feesElsewhere: false,
    hasRewards: false,
    slot: 1,
    at: 1,
    pricesAt: null,
    ...changes,
  };
}

/** An engine whose routes answer from a script: `{ review: [answer…], submit: […], status: […] }`; each answer `{ ok, value }` or `{ ok: false, failure }`. */
export function scriptedEngine(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([route, answers]) => [route, [...answers]]));
  const answer = (route, args) => {
    calls.push({ route, args });
    const queue = queues[route] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) throw new Error(`Nothing scripted for ${route}.`);
    return Promise.resolve(structuredClone(next));
  };
  const engine = Object.fromEntries(["pools", "actions", "positions", "review", "submit", "status"].map((route) => [route, (...args) => answer(route, args)]));
  return { engine, calls, routes: (route) => calls.filter((call) => call.route === route) };
}

export const ok = (value) => ({ ok: true, value, status: 200 });
export const no = (code) => ({ ok: false, failure: { code, message: code } });

/** A clock that moves only when told, and a sleep that moves it. */
export function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, sleep: async (ms) => void (now += ms), advance: (ms) => void (now += ms) };
}
