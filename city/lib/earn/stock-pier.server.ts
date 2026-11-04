import 'server-only';

import { CP_AMM_PROGRAM_ID, CpAmm, deriveTokenBadgeAddress, getBaseFeeHandlerFromPodAlignedData } from '@meteora-ag/cp-amm-sdk';
import { Keypair, PublicKey, type Connection } from '@solana/web3.js';

import { forgetWalletPositions, positionsConnections } from '@/lib/liquidity/catalog/chain.server';
import { reviewLiquidityAction } from '@/lib/liquidity/studio/actions';
import { numeratorToBps } from '@/lib/liquidity/studio/math';
import { liquidityVenues } from '@/lib/liquidity/studio/venues.server';
import { fetchTokenCatalog } from '@/lib/solana/catalog';
import { readSpotCandles } from '@/lib/spot/candles.server';
import { readOnchainMintCached, warmOnchainMints, type OnchainMint } from '@/lib/stocks/asset.server';
import { multiplierFromChain } from '@/lib/stocks/units';
import { readStockUniverse, type StockRow } from '@/lib/stocks/universe.server';
import type { ReviewAnswer, EngineReviewBody } from './stock-pier-door';
import { stepOf } from './stock-pier-hours';
import { QUOTE, STOCK_CANDIDATES, STOCK_QUOTES, baseUsd, verifyStock, volume7d, type MintFacts, type PierSpot, type StockPair, type StockPierList, type StockQuote } from './stock-pier';
import { createStockPierVenue, stockPierAddress, type StockBuildPlan } from './stock-pier-venue';

/**
 * The Stock Pier's reads on the server (CITY-98): the verified pairs the window offers, and the engine's Review wired
 * with the Stock Pier's venue. Reading only, except the Review, which builds bytes for the person's wallet and signs
 * nothing that holds money.
 *
 * A candidate (the city's avenue towers) is offered when the stocks engine's universe has it from its issuer's
 * catalogue with a price, Jupiter marks it verified, the chain's mint is a Scaled UI token the venue takes as it is (or
 * whose badge stands), it is not paused, halted or allow-listed, and its market traded at least the floor over seven
 * days (the engine's daily candles, at the page's priority so a chart never waits on it). Every source that fails
 * leaves its candidates out — never a guessed pair.
 */

const LIST_MS = 10 * 60_000;
/** An empty list (a source that failed) is kept only this long. */
const LIST_MISS_MS = 60_000;
/** The review path waits this long at most for a list that is not built yet. */
const LIST_WAIT_MS = 10_000;
const VOLUME_MS = 60 * 60_000;
const VOLUME_MISS_MS = 2 * 60_000;
const QUOTE_MS = 60_000;
/** A stock price observed longer ago than this is no price to make a pool at. */
const PRICE_FRESH_MS = 15 * 60_000;

let listCache: Readonly<{ value: StockPierList; at: number }> | null = null;
let listFlight: Promise<StockPierList> | null = null;
const volumes = new Map<string, Readonly<{ value: number | null; at: number }>>();
let quoteCache: Readonly<{
  value: Readonly<Record<StockQuote, number | null>>;
  at: number;
}> | null = null;

function firstConnection(): Connection {
  const [connection] = positionsConnections();
  if (!connection) throw new Error('No Solana endpoint is configured.');
  return connection;
}

function factsOf(read: OnchainMint): MintFacts | null {
  if (read.programKind !== 'SPL_TOKEN' && read.programKind !== 'TOKEN_2022') return null;
  return {
    program: read.programKind,
    extensions: read.extensions,
    scaled: read.scaledUi !== null,
    paused: read.pausable?.paused === true,
    startsFrozen: read.defaultAccountFrozen === true,
  };
}

/** Dollars for one SOL and one USDC, from the engine's Jupiter read, kept a minute. */
export async function readQuoteUsd(): Promise<Readonly<Record<StockQuote, number | null>>> {
  if (quoteCache && Date.now() - quoteCache.at < QUOTE_MS) return quoteCache.value;
  const read = await fetchTokenCatalog([QUOTE.sol.mint, QUOTE.usdc.mint], 6_000).catch(() => null);
  const price = (mint: string) => {
    const usd = read && read.ok ? Number(read.byMint[mint]?.usdPrice ?? Number.NaN) : Number.NaN;
    return Number.isFinite(usd) && usd > 0 ? usd : null;
  };
  const value = { sol: price(QUOTE.sol.mint), usdc: price(QUOTE.usdc.mint) };
  if (value.sol !== null) quoteCache = { value, at: Date.now() };
  return value;
}

async function readVolume(mint: string): Promise<number | null> {
  const kept = volumes.get(mint);
  const now = Date.now();
  if (kept && now - kept.at < (kept.value === null ? VOLUME_MISS_MS : VOLUME_MS)) return kept.value;
  const read = await readSpotCandles(mint, '1d', 'page').catch(() => null);
  const value = read && read.ok ? volume7d(read.candles, now) : null;
  volumes.set(mint, { value, at: now });
  return value;
}

/** Whether a token badge stands for each mint on the venue. */
async function readBadges(connection: Connection, mints: readonly string[]): Promise<ReadonlySet<string>> {
  const infos = await connection.getMultipleAccountsInfo(
    mints.map((mint) => deriveTokenBadgeAddress(new PublicKey(mint))),
    'confirmed',
  );
  return new Set(mints.filter((_, index) => infos[index]?.owner.equals(CP_AMM_PROGRAM_ID)));
}

/** The pair's pier on each quote: standing or not, which way round, its base fee and depth. */
async function readSpots(
  connection: Connection,
  stock: string,
  priceUsd: number,
  multiplier: number,
  decimals: number,
  quoteUsd: Readonly<Record<StockQuote, number | null>>,
): Promise<Record<StockQuote, PierSpot>> {
  const addresses = STOCK_QUOTES.map((quote) => stockPierAddress(stock, QUOTE[quote].mint));
  const infos = await connection.getMultipleAccountsInfo(
    addresses.map((address) => new PublicKey(address)),
    'confirmed',
  );
  const cpAmm = new CpAmm(connection);
  const out = {} as Record<StockQuote, PierSpot>;
  STOCK_QUOTES.forEach((quote, index) => {
    const address = addresses[index]!;
    const info = infos[index];
    if (!info || !info.owner.equals(CP_AMM_PROGRAM_ID)) {
      out[quote] = {
        address,
        built: false,
        stockIsA: true,
        feeBps: null,
        depthUsd: null,
      };
      return;
    }
    let spot: PierSpot = {
      address,
      built: true,
      stockIsA: true,
      feeBps: null,
      depthUsd: null,
    };
    try {
      const state = cpAmm._program.coder.accounts.decode('pool', info.data);
      const stockIsA = state.tokenAMint.toBase58() === stock;
      const handler = getBaseFeeHandlerFromPodAlignedData(state.poolFees.baseFee.baseFeeInfo.data);
      const feeBps = numeratorToBps(BigInt(handler.getMinFeeNumerator().toString()));
      let depthUsd: number | null = null;
      const q = quoteUsd[quote];
      if (state.layoutVersion >= 1 && q !== null) {
        const stockUnits = Number((stockIsA ? state.tokenAAmount : state.tokenBAmount).toString());
        const quoteUnits = Number((stockIsA ? state.tokenBAmount : state.tokenAAmount).toString());
        depthUsd = (stockUnits / 10 ** decimals) * priceUsd * multiplier + (quoteUnits / 10 ** QUOTE[quote].decimals) * q;
      }
      spot = {
        address,
        built: true,
        stockIsA,
        feeBps,
        depthUsd: depthUsd !== null && Number.isFinite(depthUsd) ? depthUsd : null,
      };
    } catch {
      /* A pool the coder cannot read stays a standing pier with no figures. */
    }
    out[quote] = spot;
  });
  return out;
}

function rowsByMint(rows: readonly StockRow[]): Map<string, StockRow> {
  return new Map(rows.map((row) => [row.representation.mint, row]));
}

async function buildList(): Promise<StockPierList> {
  const now = Date.now();
  const candidates = [...STOCK_CANDIDATES];
  const connection = firstConnection();
  const [universe, catalog, quoteUsd, badges] = await Promise.all([
    readStockUniverse(),
    fetchTokenCatalog(candidates, 8_000).catch(() => null),
    readQuoteUsd(),
    readBadges(connection, candidates).catch(() => new Set<string>()),
    warmOnchainMints(candidates).catch(() => undefined),
  ]);
  const rows = universe.ok ? rowsByMint(universe.universe.rows) : new Map<string, StockRow>();
  const mints = await Promise.all(candidates.map((mint) => readOnchainMintCached(mint).catch(() => ({ error: 'read' }) as const)));

  // Everything but the volume first: a candidate that fails a cheaper check never costs a candle read.
  const early = candidates.flatMap((mint, index) => {
    const row = rows.get(mint);
    const read = mints[index]!;
    const facts = 'error' in read ? null : factsOf(read);
    const verdict = verifyStock({
      facts,
      badge: badges.has(mint),
      verified: catalog?.ok === true && catalog.byMint[mint]?.isVerified === true,
      issuerConfirmed: row?.representation.issuerConfirmation === 'issuer-catalogue',
      halted: row?.representation.tradingHalted ?? null,
      priceUsd: row?.market.priceUsd ?? null,
      volume7dUsd: Number.POSITIVE_INFINITY,
    });
    return verdict.ok && row && !('error' in read) ? [{ mint, row, read }] : [];
  });

  const pairs: StockPair[] = [];
  for (let start = 0; start < early.length; start += 3) {
    const batch = early.slice(start, start + 3);
    const read = await Promise.all(
      batch.map(async ({ mint, row, read: onchain }) => {
        const volume = await readVolume(mint);
        if (
          volume === null ||
          !verifyStock({
            facts: factsOf(onchain),
            badge: true,
            verified: true,
            issuerConfirmed: true,
            halted: false,
            priceUsd: row.market.priceUsd,
            volume7dUsd: volume,
          }).ok
        )
          return null;
        const scaled = onchain.scaledUi;
        const multiplier = scaled ? multiplierFromChain(scaled, now).current : 1;
        const priceUsd = row.market.priceUsd!;
        const piers = await readSpots(connection, mint, priceUsd, multiplier, onchain.decimals, quoteUsd).catch(() => null);
        if (!piers) return null;
        const pair: StockPair = {
          mint,
          symbol: row.representation.symbol,
          name: row.representation.name,
          decimals: onchain.decimals,
          program: onchain.programKind === 'TOKEN_2022' ? 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' : 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          priceUsd,
          multiplier,
          volume7dUsd: volume,
          session: {
            open: row.session.exchangeOpen,
            nextChangeAt: row.session.nextChangeAt,
          },
          step: stepOf(scaled),
          issuerMoves: onchain.permanentDelegate !== null,
          piers,
        };
        return pair;
      }),
    );
    for (const pair of read) if (pair) pairs.push(pair);
  }
  pairs.sort((a, b) => b.volume7dUsd - a.volume7dUsd);
  return { pairs, quoteUsd, at: new Date(now).toISOString() };
}

/** The verified pairs, kept ten minutes (an empty answer one minute), one build at a time. */
export async function readStockPierList(): Promise<StockPierList> {
  if (listCache && Date.now() - listCache.at < (listCache.value.pairs.length ? LIST_MS : LIST_MISS_MS)) return listCache.value;
  listFlight ??= buildList()
    .then((value) => {
      if (value.pairs.length || !listCache?.value.pairs.length) listCache = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      listFlight = null;
    });
  return listFlight;
}

/**
 * One verified pair as the door builds on it: still on the list, with the price, the multiplier, the step and the
 * pier's state read again now — the list is ten minutes old at most, a pool's price is set from this.
 */
export async function freshStockPair(mint: string): Promise<StockPair | null> {
  const list = await Promise.race([readStockPierList().catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), LIST_WAIT_MS))]);
  const listed = list?.pairs.find((pair) => pair.mint === mint);
  if (!listed) return null;
  const [universe, onchain, quoteUsd] = await Promise.all([readStockUniverse(), readOnchainMintCached(mint).catch(() => ({ error: 'read' }) as const), readQuoteUsd()]);
  if (!universe.ok || 'error' in onchain) return null;
  const row = universe.universe.rows.find((r) => r.representation.mint === mint);
  const priceUsd = row?.market.priceUsd ?? null;
  const observed = row?.market.observedAt ? Date.parse(row.market.observedAt) : Number.NaN;
  // A price with no time, or older than a quarter of an hour, is no price to make a pool at.
  if (!row || priceUsd === null || !(priceUsd > 0) || !Number.isFinite(observed) || Date.now() - observed > PRICE_FRESH_MS) return null;
  if (row.representation.tradingHalted === true || onchain.pausable?.paused === true) return null;
  // Just after a step of the multiplier, a price seen before it stands on the old units: wait for one seen after.
  const step = stepOf(onchain.scaledUi);
  const stepAt = step ? Date.parse(step.at) : Number.NaN;
  if (Number.isFinite(stepAt) && stepAt <= Date.now() && observed < stepAt) return null;
  const multiplier = onchain.scaledUi ? multiplierFromChain(onchain.scaledUi, Date.now()).current : 1;
  const piers = await readSpots(firstConnection(), mint, priceUsd, multiplier, onchain.decimals, quoteUsd).catch(() => null);
  if (!piers) return null;
  return {
    ...listed,
    priceUsd,
    multiplier,
    step: stepOf(onchain.scaledUi),
    session: {
      open: row.session.exchangeOpen,
      nextChangeAt: row.session.nextChangeAt,
    },
    piers,
  };
}

/*
 * The fresh keys a build made, by public key, until the Review that made them takes them (at once, in the same
 * request). They hold nothing; one left behind by a failed build is dropped after a minute.
 */
const FRESH_MS = 60_000;
const fresh = new Map<string, Readonly<{ key: Keypair; at: number }>>();
function freshKeypair(): Keypair {
  const now = Date.now();
  for (const [publicKey, held] of fresh) if (now - held.at > FRESH_MS) fresh.delete(publicKey);
  const key = Keypair.generate();
  fresh.set(key.publicKey.toBase58(), { key, at: now });
  return key;
}
function takeFreshKey(publicKey: string): Keypair | null {
  const held = fresh.get(publicKey);
  fresh.delete(publicKey);
  return held?.key ?? null;
}

/**
 * The engine's Review, unchanged, with the Stock Pier's venue standing in front of its DAMM v2 adapter for this one
 * plan. The canary's dollar ceiling (when the engine's gate is in canary) is priced at the very prices the pool is
 * made at, for the very mints that go in.
 */
export async function reviewWithStockPier(body: EngineReviewBody, plan: StockBuildPlan, pair: StockPair, quoteUsd: number): Promise<ReviewAnswer> {
  const stockUsd = baseUsd(pair);
  const quote = STOCK_QUOTES.find((q) => QUOTE[q].mint === plan.quote) ?? 'sol';
  const stockIsX = pair.piers[quote].stockIsA;
  return reviewLiquidityAction(body, {
    env: process.env,
    connections: positionsConnections(),
    venuesFor(connection) {
      const engine = liquidityVenues(connection, freshKeypair);
      return {
        ...engine,
        'meteora-damm2': createStockPierVenue({
          connection,
          base: engine['meteora-damm2'],
          plan,
          newKeypair: freshKeypair,
        }),
      };
    },
    async pricesOf() {
      // The engine prices X and Y by the deposit's own mints: the stock is X unless the standing pier is the other way round.
      return stockIsX ? { x: stockUsd, y: quoteUsd, xMint: plan.stock, yMint: plan.quote } : { x: quoteUsd, y: stockUsd, xMint: plan.quote, yMint: plan.stock };
    },
    forget: forgetWalletPositions,
    takeFreshKey,
  });
}
