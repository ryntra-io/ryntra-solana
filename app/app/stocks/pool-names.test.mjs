/**
 * Pool names on a company's page (UX-505, UX-954): a pool whose name or other
 * token carries a hate word is left out of the card and its counts; every
 * other pool, the primary among them, stays as the venue named it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isOffensivePool, sayablePoolName, withoutOffensivePools } from "./[ticker]/pool-names.ts";

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
/* A slur spelled the way the audit found it on production, built here so the word itself is not written in the file. */
const SLUR = ["N", "I", "G", "G", "E", "R"].join("");

const pool = (name, counter, tvlUsd, address = name) => ({
  provider: "meteora",
  kind: "dlmm",
  address,
  name,
  stockSide: "x",
  stock: { mint: NVDAX, symbol: "NVDAx", name: "NVIDIA xStock", decimals: 8 },
  counter: { mint: `${counter}-mint`, symbol: counter, name: counter, decimals: 6 },
  counterKind: counter === "USDC" ? "stablecoin" : "other",
  tvlUsd,
  volume24hUsd: null,
  fees24hUsd: null,
  baseFeePct: 0.1,
  dynamicFeePct: null,
  stockAmount: null,
  counterAmount: null,
  createdAt: null,
  blacklisted: false,
});

const read = (pools) => ({
  provider: "meteora",
  mint: NVDAX,
  state: "ok",
  pools,
  primary: pools[0] ?? null,
  meaningfulCount: pools.length,
  dustCount: 0,
  totals: { tvlUsd: null, volume24hUsd: null, fees24hUsd: null },
  sources: { dlmm: { ok: true, stale: false, fetchedAt: null }, "damm-v2": { ok: true, stale: false, fetchedAt: null } },
  fetchedAt: null,
});

test("a pool named with a slur is left out of the list and its counts; the rest stay as the venue named them", () => {
  const usdc = pool("NVDAx-USDC", "USDC", 3_400_000);
  const slur = pool(`${SLUR}-NVDAx`, SLUR, 6_000);
  const meme = pool("GPUCAT-NVDAx", "GPUCAT", 2_000);
  const dust = pool("bruh-NVDAx", "bruh", 0.5);
  const shown = withoutOffensivePools(read([usdc, slur, meme, dust]));
  assert.deepEqual(shown.pools.map((entry) => entry.name), ["NVDAx-USDC", "GPUCAT-NVDAx", "bruh-NVDAx"]);
  assert.equal(shown.primary, usdc);
  assert.equal(shown.meaningfulCount, 2);
  assert.equal(shown.dustCount, 1);
  assert.equal(JSON.stringify(shown).toLowerCase().includes(SLUR.toLowerCase()), false, "the word is nowhere in what the page renders");
});

test("disguises are read through, on the pair's other token too; a clean read is returned untouched", () => {
  assert.equal(isOffensivePool(pool("N1GG3R-NVDAx", "X", 10)), true);
  assert.equal(isOffensivePool(pool("ABC-NVDAx", "N1GG3R", 10)), true);
  assert.equal(isOffensivePool(pool("STONK-NVDAx", "STONK", 10)), false);
  const clean = read([pool("NVDAx-USDC", "USDC", 1_000_000)]);
  assert.equal(withoutOffensivePools(clean), clean);
});

test("an offensive primary pool is not named as the primary; the clean money pool left leads instead", () => {
  const shown = withoutOffensivePools(read([pool(`${SLUR}-NVDAx`, SLUR, 9_000_000), pool("NVDAx-USDC", "USDC", 5_000)]));
  assert.equal(shown.primary?.name, "NVDAx-USDC");
  assert.deepEqual(shown.pools.map((entry) => entry.name), ["NVDAx-USDC"]);
  const none = withoutOffensivePools(read([pool(`${SLUR}-NVDAx`, SLUR, 9_000_000), pool("GPUCAT-NVDAx", "GPUCAT", 5_000)]));
  assert.equal(none.primary, null, "a memecoin pair never leads");
});

test("a single pool name — the chart's source — is said only when it may be", () => {
  assert.equal(sayablePoolName("NVDAx/USDC"), "NVDAx/USDC");
  assert.equal(sayablePoolName(`${SLUR}/NVDAx`), null);
  assert.equal(sayablePoolName(null), null);
});
