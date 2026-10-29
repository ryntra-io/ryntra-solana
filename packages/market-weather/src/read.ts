/**
 * From mints to weather: read Jupiter and Meteora, assemble each asset's readings, judge the sky.
 *
 * Which readings feed which signal:
 * - **price** — Jupiter Price V3, and the deepest qualifying Meteora pool of each kind (DLMM, DAMM v2): two providers.
 * - **24-hour move** — Jupiter Price V3's `priceChange24h` and Jupiter Tokens V2's `stats24h.priceChange`: two
 *   separate Jupiter computations. The move counts in the sky only when its price is not in dispute across providers.
 * - **depth** — Jupiter's liquidity for the token; when Jupiter states none, the Meteora pools' summed depth.
 * - **issuer badges** — Jupiter's audit (mint and freeze), Meteora's pool record (freeze), and any chain read the caller
 *   adds.
 *
 * `assembleAsset` is pure; `readMarketWeather` is the only function here that touches the network, through the adapters.
 */

import { DEFAULT_POLICY, type Measured, type Reading, type WeatherPolicy } from "./contract.ts";
import type { AuthorityRead } from "./badges.ts";
import { judgeLifecycle, isDbcLaunchpad, type GraduatedPool } from "./lifecycle.ts";
import { judgeWeather, type AssetInput, type MarketWeather } from "./weather.ts";
import type { JsonRead, ReadDeps } from "./adapters/http.ts";
import { readJupiter, isMint, type JupiterAsset, type JupiterPrice } from "./adapters/jupiter.ts";
import { WSOL, poolPriceReading, poolsDepth, readGraduatedPool, readMeteoraPools, type MeteoraPool } from "./adapters/meteora.ts";

export type AssembleArgs = Readonly<{
  asset: string;
  price: JupiterPrice | null;
  token: JupiterAsset | null;
  pools: readonly MeteoraPool[];
  /** Meteora's read of the pool the token graduated into, when Jupiter names one. */
  graduated: MeteoraPool | null;
  solUsd: number | null;
  /** Extra authority reads, e.g. from an RPC read of the mint account. */
  chainAuthorities?: readonly AuthorityRead[];
  now: number;
  policy?: WeatherPolicy;
}>;

export function assembleAsset(args: AssembleArgs): AssetInput {
  const policy = args.policy ?? DEFAULT_POLICY;
  const priceReads: Reading[] = [];
  if (args.price) priceReads.push(args.price.price);
  for (const kind of ["dlmm", "damm-v2"] as const) {
    const reading = poolPriceReading(args.pools.filter((pool) => pool.kind === kind), { minTvlUsd: policy.minLiquidityUsd, solUsd: args.solUsd });
    if (reading) priceReads.push(reading);
  }
  const moveReads: Reading[] = [];
  if (args.price) moveReads.push(args.price.change24h);
  if (args.token) moveReads.push(args.token.change24h);
  const jupiterDepth = args.token?.liquidity.value;
  const liquidityUsd: Measured = jupiterDepth && jupiterDepth.state === "measured" ? jupiterDepth : poolsDepth(args.pools);
  const authorityReads: AuthorityRead[] = [...(args.token?.authorities ?? []), ...(args.chainAuthorities ?? [])];
  /* Meteora states the freeze authority on every pool record; one statement per kind is enough. */
  for (const kind of ["dlmm", "damm-v2"] as const) {
    const pool = args.pools.find((candidate) => candidate.kind === kind && candidate.freeze.state !== "not_measured");
    if (pool) authorityReads.push(pool.freeze);
  }
  const graduatedPool: GraduatedPool | null = args.graduated
    ? { address: args.graduated.address, confirmed: true, tvlUsd: args.graduated.tvlUsd, volume24hUsd: args.graduated.volume24hUsd, url: args.graduated.url }
    : null;
  const lifecycle = args.token
    ? judgeLifecycle({ asset: args.asset, launchpad: args.token.launchpad, graduatedPool: args.token.graduatedPool, graduatedAt: args.token.graduatedAt, pool: graduatedPool, now: args.now, policy })
    : null;
  return {
    asset: args.asset,
    symbol: args.token?.symbol ?? null,
    verified: args.token?.verified ?? false,
    liquidityUsd,
    priceReads,
    moveReads,
    authorityReads,
    lifecycle,
  };
}

export type WeatherRead = Readonly<{ weather: MarketWeather; failures: readonly Extract<JsonRead, { ok: false }>[] }>;

/**
 * Read the weather over `mints`. Meteora is read for the first `maxPoolMints` of them (each costs two calls), and for
 * every graduated DBC launch among them. Whatever fails is listed; the weather is judged from what was read.
 */
export async function readMarketWeather(
  mints: readonly string[],
  options: ReadDeps & Readonly<{ policy?: WeatherPolicy; maxPoolMints?: number }> = {},
): Promise<WeatherRead> {
  const policy = options.policy ?? DEFAULT_POLICY;
  const now = options.now ?? Date.now;
  const assets = [...new Set(mints.filter(isMint))];
  const jupiter = await readJupiter(assets.includes(WSOL) ? assets : [...assets, WSOL], options);
  const failures: Extract<JsonRead, { ok: false }>[] = [...jupiter.failures];
  const sol = jupiter.prices.get(WSOL)?.price.value;
  const solUsd = sol && sol.state === "measured" ? sol.value : null;
  const inputs: AssetInput[] = [];
  const poolBudget = options.maxPoolMints ?? 12;
  for (const [index, asset] of assets.entries()) {
    const token = jupiter.tokens.get(asset) ?? null;
    let pools: readonly MeteoraPool[] = [];
    if (index < poolBudget) {
      const read = await readMeteoraPools(asset, options);
      pools = read.pools;
      failures.push(...read.failures);
    }
    let graduated: MeteoraPool | null = null;
    if (token?.graduatedPool && isDbcLaunchpad(token.launchpad)) {
      graduated = pools.find((pool) => pool.kind === "damm-v2" && pool.address === token.graduatedPool) ?? null;
      if (!graduated) {
        const read = await readGraduatedPool(token.graduatedPool, asset, options);
        graduated = read.pool;
        if (read.failure) failures.push(read.failure);
      }
    }
    inputs.push(assembleAsset({ asset, price: jupiter.prices.get(asset) ?? null, token, pools, graduated, solUsd, now: now(), policy }));
  }
  return { weather: judgeWeather(inputs, now(), policy), failures };
}

