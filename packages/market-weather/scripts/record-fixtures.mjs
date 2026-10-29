/**
 * Record live answers of the public endpoints the adapters read, for fixtures. GET only, keyless, nothing written
 * anywhere but `fixtures/live-<date>/`. Review what it wrote before committing it.
 *
 *   node scripts/record-fixtures.mjs [mint …]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_MINTS = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ",
];
const mints = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MINTS;
const day = new Date().toISOString().slice(0, 10);
const dir = fileURLToPath(new URL(`../fixtures/live-${day}/`, import.meta.url));
mkdirSync(dir, { recursive: true });

const filter = (mint) => encodeURIComponent(`token_x=${mint} || token_y=${mint}`);
const targets = [
  ["jupiter-price-v3", `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`],
  ["jupiter-tokens-v2", `https://lite-api.jup.ag/tokens/v2/search?query=${mints.join(",")}`],
  ...mints.flatMap((mint) => [
    [`meteora-dlmm-${mint.slice(0, 6)}`, `https://dlmm.datapi.meteora.ag/pools?page_size=10&sort_by=tvl:desc&filter_by=${filter(mint)}`],
    [`meteora-damm-v2-${mint.slice(0, 6)}`, `https://damm-v2.datapi.meteora.ag/pools?page_size=10&sort_by=tvl:desc&filter_by=${filter(mint)}`],
  ]),
];

for (const [name, url] of targets) {
  const response = await fetch(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  writeFileSync(`${dir}${name}.json`, text.endsWith("\n") ? text : `${text}\n`);
  console.log(response.status, name, text.length);
  await new Promise((resolve) => setTimeout(resolve, 2_100)); // keyless Jupiter allows about one call every two seconds
}
