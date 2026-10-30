import type { LaunchMarketResponse, LaunchTradeQuoteResponse } from '../../../lib/api/v1/contract.ts';
import type { TradeRiskVerdict } from '../../../lib/solana/trade-risk.ts';
import type { Answer, LaunchEngine } from './engine.ts';
import { stubAddress } from './stub.ts';
import type { LaunchTradeEngine, Side } from './trade.ts';

/**
 * A stand-in for the engine's trade routes, beside the stub Launch engine (`stub.ts`): development and tests only,
 * every answer in the shape of the v1 contract, a made-up wallet of 500 test USDC, nothing sent anywhere. The prices
 * come from the stub's own market reads; the fee falls on the stub's schedule; the split is Protected's on the stand.
 * Opened with `?launch=stub` in a development build; never part of a production bundle.
 */

const PAIR_DECIMALS = 6;
const START_PAIR_RAW = 500_000_000n;
/** The stand's swing surcharge: a little on top of the schedule, as the dynamic fee adds when the price moves. */
const SURCHARGE_BPS = 20;
const POOL_FEE_BPS = 50;

export type StubTradeOptions = Readonly<{ market: LaunchEngine['market']; delayMs?: number; now?: () => number; refuse?: Partial<Record<keyof LaunchTradeEngine, Answer<never>>> }>;

type Build = { token: string; wallet: string; side: Side; quote: LaunchTradeQuoteResponse; wire: string; used: boolean };

const iso = (ms: number) => new Date(ms).toISOString();

/** The thirteen facts of the risk verdict, in its order (`lib/solana/trade-risk.ts`). */
const RISK_FACTS = ['MINT_AND_PROGRAM', 'TOKEN_EXTENSIONS', 'MINT_AUTHORITY', 'FREEZE_AUTHORITY', 'TOKEN_RESTRICTIONS', 'SLIPPAGE', 'LIQUIDITY_PATH', 'QUOTE_FRESHNESS', 'VENUE_STATUS', 'HOLDER_CONCENTRATION', 'CREATOR_BEHAVIOUR', 'RWA_ELIGIBILITY', 'TRADE_BUDGET'] as const;

/**
 * The verdict the engine gives where nothing was read, as the stand-in reads nothing: every fact `INCOMPLETE`. Written
 * out rather than judged by the engine's own module, which would carry its server reads into the page's bundle;
 * `trade.test.mjs` holds it to the contract.
 */
function standVerdict(mint: string, at: string): TradeRiskVerdict {
  const missing = 'Not read: the development stand-in reads no chain.';
  return {
    schema: 'ryntra.solana.trade-risk-verdict',
    schemaVersion: '1.0.0',
    trade: { kind: 'LAUNCH', network: 'devnet', mint },
    verdict: 'INCOMPLETE',
    findings: RISK_FACTS.map((fact) => ({ fact, outcome: 'INCOMPLETE' as const, detail: missing, source: null, missing })),
    limits: { slippageReviewBps: 300, slippageBlockBps: 2000, quoteFreshSeconds: 30, factsFreshSeconds: 600, topPlainHolderReviewShare: 0.2, topFivePlainHoldersReviewShare: 0.5, creatorHoldsReviewShare: 0.1, transferFeeReviewBps: 100 },
    evaluatedAt: at,
  };
}
const big = (n: number) => BigInt(Math.max(0, Math.floor(n)));

export function stubTradeEngine(options: StubTradeOptions): LaunchTradeEngine & Readonly<{ calls: string[] }> {
  const now = options.now ?? Date.now;
  const refuse = { ...(options.refuse ?? {}) };
  const calls: string[] = [];
  const holdings = new Map<string, { tokenRaw: bigint; pairRaw: bigint }>();
  const builds = new Map<string, Build>();
  const sent = new Map<string, Build>();

  const held = (wallet: string, token: string) => {
    const key = `${wallet}:${token}`;
    let entry = holdings.get(key);
    if (!entry) {
      entry = { tokenRaw: 0n, pairRaw: START_PAIR_RAW };
      holdings.set(key, entry);
    }
    return entry;
  };

  async function answer<T>(route: keyof LaunchTradeEngine, make: () => Promise<Answer<T>> | Answer<T>): Promise<Answer<T>> {
    calls.push(route);
    await new Promise<void>((resolve) => setTimeout(resolve, (options.delayMs ?? 0) * (route === 'submit' ? 4 : 1)));
    const refused = refuse[route];
    if (refused) {
      delete refuse[route];
      return refused;
    }
    return make();
  }

  function quoteOf(market: LaunchMarketResponse, side: Side, amountRaw: string, slippageBps: number): LaunchTradeQuoteResponse {
    const curve = market.venue === 'curve';
    const feeBps = curve ? (market.curveFee?.nowBps ?? 100) + SURCHARGE_BPS : POOL_FEE_BPS + SURCHARGE_BPS;
    const unit = 10 ** market.tokenDecimals;
    const price = market.price.pair;
    const depth = Math.max(1, market.liquidity.pair) * 10 ** PAIR_DECIMALS;
    const amount = Number(amountRaw);
    let inRaw: bigint;
    let outRaw: bigint;
    let feeRaw: bigint;
    let moveBps: number;
    if (side === 'buy') {
      const fee = (amount * feeBps) / 10_000;
      const net = amount - fee;
      const impact = net / depth;
      moveBps = Math.round(impact * 2 * 10_000);
      inRaw = BigInt(amountRaw);
      feeRaw = big(fee);
      outRaw = big(((net / 10 ** PAIR_DECIMALS) / (price * (1 + impact))) * unit);
    } else {
      const gross = (amount / unit) * price * 10 ** PAIR_DECIMALS;
      const impact = gross / depth;
      moveBps = -Math.round(impact * 2 * 10_000);
      const fee = (gross * (1 - impact) * feeBps) / 10_000;
      inRaw = BigInt(amountRaw);
      feeRaw = big(fee);
      outRaw = big(gross * (1 - impact) - fee);
    }
    const share = (bps: number) => (feeRaw * BigInt(bps)) / 10_000n;
    const fee: LaunchTradeQuoteResponse['fee'] = curve
      ? { totalRaw: feeRaw.toString(), creatorRaw: share(3200).toString(), ryntraRaw: share(5200).toString(), meteoraRaw: (feeRaw - share(3200) - share(5200)).toString(), liquidityRaw: null, liquidity: null }
      : (() => {
          const meteora = share(1800);
          const referral = share(200);
          const liquidity = feeRaw - meteora - referral;
          const creator = liquidity / 4n;
          const ryntra = liquidity / 4n;
          return {
            totalRaw: feeRaw.toString(),
            creatorRaw: null,
            ryntraRaw: referral.toString(),
            meteoraRaw: meteora.toString(),
            liquidityRaw: liquidity.toString(),
            liquidity: { creatorRaw: creator.toString(), ryntraRaw: ryntra.toString(), othersRaw: '0', compoundingRaw: (liquidity - creator - ryntra).toString() },
          };
        })();
    const capAfter = market.marketCap.pair * (1 + moveBps / 10_000);
    const observedAt = iso(now());
    return {
      venue: market.venue,
      side,
      amountInRaw: inRaw.toString(),
      amountOutRaw: outRaw.toString(),
      minimumOutRaw: ((outRaw * BigInt(10_000 - slippageBps)) / 10_000n).toString(),
      amountLeftRaw: '0',
      slippageBps,
      feeBps,
      fee,
      priceMoveBps: moveBps,
      marketCapAfter: { pair: capAfter, usd: capAfter },
      referral: true,
      observedAt,
      tradeRisk: standVerdict(market.token, observedAt),
    };
  }

  const read = async (token: string) => {
    const market = await options.market(token);
    return market.ok ? market.data : null;
  };

  return {
    calls,
    market: (token) => answer('market', () => options.market(token)),
    wallet: (token, address) =>
      answer('wallet', () => {
        const entry = held(address, token);
        return { ok: true, data: { wallet: address, token, tokenRaw: entry.tokenRaw.toString(), pairRaw: entry.pairRaw.toString(), observedAt: iso(now()) } };
      }),
    quote: (token, body) =>
      answer('quote', async () => {
        const market = await read(token);
        if (!market) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
        if (BigInt(body.amountRaw) <= 0n) return { ok: false, code: 'VALIDATION_ERROR', message: 'amountRaw: more than zero' };
        return { ok: true, data: quoteOf(market, body.side, body.amountRaw, body.slippageBps) };
      }),
    build: (token, body) =>
      answer('build', async () => {
        const market = await read(token);
        if (!market) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
        const entry = held(body.wallet, token);
        if (BigInt(body.amountRaw) > (body.side === 'buy' ? entry.pairRaw : entry.tokenRaw)) return { ok: false, code: 'LAUNCH_BALANCE_LOW', message: 'The wallet does not hold that much.' };
        const quote = quoteOf(market, body.side, body.amountRaw, body.slippageBps);
        const buildId = `${builds.size + 1}`.padStart(32, '0');
        const wire = btoa(`stub-trade:${buildId}:${body.side}:${body.amountRaw}`);
        builds.set(buildId, { token, wallet: body.wallet, side: body.side, quote, wire, used: false });
        return { ok: true, data: { buildId, network: 'solana:devnet', unsignedWireBase64: wire, quote, expiresAt: iso(now() + 90_000), signableMs: 25_000 } };
      }),
    submit: (token, body) =>
      answer('submit', () => {
        const build = builds.get(body.buildId);
        if (!build || build.token !== token) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'This trade was not built here.' };
        if (build.wallet !== body.wallet) return { ok: false, code: 'WALLET_MISMATCH', message: 'Another wallet.' };
        if (build.used) return { ok: false, code: 'LAUNCH_BUILD_USED', message: 'This trade was already sent.' };
        if (body.signedWireBase64 !== build.wire) return { ok: false, code: 'LAUNCH_SIGNED_OTHER_BYTES', message: 'The signed bytes are not the built ones.' };
        build.used = true;
        const entry = held(build.wallet, token);
        const tokens = BigInt(build.side === 'buy' ? build.quote.amountOutRaw : build.quote.amountInRaw);
        const pair = BigInt(build.side === 'buy' ? build.quote.amountInRaw : build.quote.amountOutRaw);
        if (build.side === 'buy') {
          entry.tokenRaw += tokens;
          entry.pairRaw -= pair;
        } else {
          entry.tokenRaw -= tokens;
          entry.pairRaw += pair;
        }
        const signature = stubAddress(`trade:${body.buildId}`) + stubAddress(`trade2:${body.buildId}`).slice(0, 44);
        sent.set(signature, build);
        return { ok: true, data: { signature, state: 'CONFIRMED', filled: { tokensRaw: tokens.toString(), pairRaw: pair.toString() }, receiptHash: null, shareLink: null } };
      }),
    receipt: (_token, body) =>
      answer('receipt', () => (sent.has(body.signature) ? { ok: true, data: { signature: body.signature, state: 'DONE', receipt: null } } : { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No trade by that signature.' })),
  };
}
