/**
 * Market Weather — honest live Solana market data for apps and games.
 *
 * The contract and its rules (`contract.ts`, `weather.ts`, `badges.ts`, `lifecycle.ts`) are pure. The adapters
 * (`adapters/*`) read public endpoints with GET and nothing else. The city (`embed/*`) draws a weather in a page or a
 * WebView. Nothing in this package holds a key, signs, swaps or moves money.
 */

export * from "./contract.ts";
export * from "./badges.ts";
export * from "./lifecycle.ts";
export * from "./weather.ts";
export * from "./read.ts";
export { readJson, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS } from "./adapters/http.ts";
export type { FetchLike, JsonRead, ReadDeps } from "./adapters/http.ts";
export * from "./adapters/jupiter.ts";
export * from "./adapters/meteora.ts";
export { layoutCity, towerAt, acceptWeather, SKIES, MAX_TOWERS, STALE_MS } from "./embed/layout.ts";
export type { Scene, SceneTower, Sky, Tone } from "./embed/layout.ts";
