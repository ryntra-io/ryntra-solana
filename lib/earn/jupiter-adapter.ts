/**
 * The Jupiter Lend adapter: the keyed calls, and the bytes a wallet is asked to sign.
 *
 * Everything that leaves this process for `api.jup.ag` leaves from here — one bounded fetch, one key held in
 * a closure, one reader (`jupiter.ts`) for every answer. The key is the founder's to issue with Lend access;
 * without it this adapter is `NO_KEY` and the surface says the provider is unavailable rather than drawing an
 * empty list of markets.
 *
 * It reads no environment and opens no connection of its own: the key, the fetch and the chain read are
 * handed to it ({@link JupiterLendDeps}), which is what lets `earn.test.mjs` prove every branch of it on
 * fixtures. The wiring that hands it the real ones is `service.server.ts`.
 *
 * ## The four calls
 *
 * - `GET /earn/tokens` — every Earn market: the jlToken, its asset, the rate, what can be withdrawn now.
 * - `GET /earn/positions?users=…` — this wallet's shares and what they are worth, per market.
 * - `GET /earn/earnings?user=…&positions=…` — what this wallet put in, net, which is the other half of
 *   «earned»; a failure here costs the earned figure and nothing else.
 * - `POST /earn/deposit` · `POST /earn/withdraw` — the unsigned transaction, base64. Nothing is signed here
 *   and nothing is sent: these bytes go to the browser, the wallet signs them, and `service.server.ts`
 *   relays them after asking the market again.
 *
 * ## What a failure may say
 *
 * The reason text a surface shows is built from a status and a host, never from the response body and never
 * from the URL: a provider URL can carry a key in its query, and an error string is exactly the thing that
 * ends up in a log. `401` and `403` are reported as the key's problem, which is what they are.
 */

import {
  JUPITER_LEND_BASE_URL,
  marketsFrom,
  netDepositsFrom,
  positionFrom,
  positionReadsFrom,
  transactionFrom,
  unavailableFromStatus,
  type JupiterPositionRead,
} from "./jupiter.ts";
import { withdrawPlan, type EarnMarket } from "./model.ts";
import { WSOL, withDepositSetup } from "./deposit-setup.ts";
import type { EarnAdapter, EarnBuildRequest, EarnBuilt, EarnFailure, EarnMarketsRead, EarnPositionsRead } from "./contract.ts";
import type { HeldReader } from "./chain.ts";

/** One call's budget. A lending page that waits ten seconds for a rate is a page nobody reads. */
const CALL_MS = 6_000;
/** The most a market list may weigh: a few hundred markets of a few hundred bytes, and not a megabyte more. */
const MAX_BYTES = 2 * 1024 * 1024;

type Fetched = Readonly<{ ok: true; value: unknown }> | EarnFailure;

async function call(
  url: string,
  key: string,
  init?: Readonly<{ method: "POST"; body: unknown }>,
  fetchImpl: typeof fetch = fetch,
): Promise<Fetched> {
  try {
    const response = await fetchImpl(url, {
      method: init?.method ?? "GET",
      headers: {
        accept: "application/json",
        "x-api-key": key,
        ...(init ? { "content-type": "application/json" } : {}),
      },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(CALL_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      const { code, reason } = unavailableFromStatus(response.status);
      return { ok: false, code, reason, status: response.status === 401 || response.status === 403 ? 503 : 502 };
    }
    const text = await response.text();
    if (text.length > MAX_BYTES) {
      return { ok: false, code: "UNREADABLE", reason: "Jupiter Lend's answer was larger than this page will read.", status: 502 };
    }
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (failure) {
    /* The host, never the URL and never the body: the URL carries the key. */
    const timedOut = failure instanceof Error && /timeout|abort/i.test(failure.name + failure.message);
    return {
      ok: false,
      code: "PROVIDER_DOWN",
      reason: timedOut ? "Jupiter Lend did not answer in time." : "Jupiter Lend could not be reached.",
      status: 503,
    };
  }
}

export type JupiterLendDeps = Readonly<{
  /** The Lend key, or null when the deployment has none — which is this adapter's `NO_KEY`. */
  key: string | null;
  /** What the wallet holds on chain, by mint; the product's own RPC path in production. */
  readHeld: HeldReader;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
}>;

/**
 * The adapter.
 *
 * `blocked` is answered before anything is asked, from the environment alone, so a page can draw «provider
 * unavailable» without a round trip and a route can refuse without one.
 */
export function jupiterLendAdapter(deps: JupiterLendDeps): EarnAdapter {
  const key = deps.key;
  const base = deps.baseUrl ?? JUPITER_LEND_BASE_URL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const held = deps.readHeld;
  const now = deps.now ?? Date.now;
  const blocked = key === null ? { code: "NO_KEY" as const, reason: "Jupiter Lend needs an API key with Lend access." } : null;

  /* A named function rather than a method, so `build` can read the markets again without depending on how
     the adapter was called. */
  const readMarkets = async (): Promise<EarnMarketsRead> => {
    if (!key) return { ok: false, ...blocked!, status: 503 };
    const answer = await call(`${base}/earn/tokens`, key, undefined, fetchImpl);
    if (!answer.ok) return answer;
    const markets = marketsFrom(answer.value, new Date(now()).toISOString());
    if (markets.length === 0) {
      return {
        ok: false,
        code: "UNREADABLE",
        reason: "Jupiter Lend answered without a market this product could read.",
        status: 502,
      };
    }
    return { ok: true, markets };
  };

  return {
    provider: "jupiter",
    blocked,
    markets: readMarkets,

    async positions(owner, markets): Promise<EarnPositionsRead> {
      if (!key) return { ok: false, ...blocked!, status: 503 };
      if (markets.length === 0) return { ok: true, positions: [] };
      const positionsAnswer = await call(`${base}/earn/positions?users=${encodeURIComponent(owner)}`, key, undefined, fetchImpl);
      if (!positionsAnswer.ok) return positionsAnswer;
      const reads = positionReadsFrom(positionsAnswer.value);
      const byShare = new Map<string, JupiterPositionRead>(reads.map((read) => [read.shareMint, read]));

      /* What went in, net. A failure here is not a failure of the position: the shares and their worth are
         still true, and the earned figure says it was not read. */
      const shareMints = markets.map((market) => market.share.mint);
      const earningsAnswer = await call(
        `${base}/earn/earnings?user=${encodeURIComponent(owner)}&positions=${encodeURIComponent(shareMints.join(","))}`,
        key,
        undefined,
        fetchImpl,
      );
      const net = earningsAnswer.ok ? netDepositsFrom(earningsAnswer.value) : new Map<string, bigint>();

      const chain = await held(owner, shareMints);
      const positions = markets.map((market) => {
        const shares = chain.held.get(market.share.mint) ?? null;
        return positionFrom({
          market,
          /* The chain is the authority on the count, and «not read» is one of its answers: it travels as null
             rather than as a zero, so an endpoint that refused cannot empty somebody's position on screen. */
          sharesOnChainRaw: shares,
          read: shares === null ? null : (byShare.get(market.share.mint) ?? null),
          netDepositRaw: net.get(market.share.mint) ?? null,
          readAt: chain.readAt,
          readFrom: shares === null ? "unread" : chain.host,
        });
      });
      return { ok: true, positions };
    },

    async build(request: EarnBuildRequest): Promise<EarnBuilt | EarnFailure> {
      if (!key) return { ok: false, ...blocked!, status: 503 };
      /* The market is read again here rather than taken from the caller: the bytes and the figures a Review
         shows have to come from the same moment, or the Review quotes a rate the transaction never had. */
      const fresh = await readMarkets();
      if (!fresh.ok) return fresh;
      const market = fresh.markets.find((entry) => entry.id === request.marketId);
      if (!market) {
        return { ok: false, code: "UNREADABLE", reason: "Jupiter Lend does not list this market.", status: 404 };
      }
      const planned = plan(request, market);
      if (!planned.ok) return planned;

      const path = request.action === "deposit" ? "deposit" : "withdraw";
      const built = await call(
        `${base}/earn/${path}`,
        key,
        { method: "POST", body: { asset: market.asset.mint, signer: request.owner, amount: planned.amountRaw.toString() } },
        fetchImpl,
      );
      if (!built.ok) return built;
      const apiWire = transactionFrom(built.value);
      if (!apiWire) {
        return { ok: false, code: "UNREADABLE", reason: "Jupiter Lend answered without a transaction to sign.", status: 502 };
      }
      /* CITY-204: the API's deposit takes accounts a first deposit does not have yet — the jlToken account, and wrapped SOL
         for SOL. They go into the same bytes, before the deposit (`deposit-setup.ts`). */
      let wireBase64 = apiWire;
      if (request.action === "deposit") {
        const wsol = market.asset.mint === WSOL.toBase58() ? ((await held(request.owner, [WSOL.toBase58()]).catch(() => null))?.held.get(WSOL.toBase58()) ?? null) : null;
        wireBase64 = withDepositSetup(apiWire, { owner: request.owner, assetMint: market.asset.mint, shareMint: market.share.mint, amountRaw: planned.amountRaw, heldWsolRaw: wsol }).wireBase64;
      }
      return { ok: true, wireBase64, market, amountRaw: planned.amountRaw, partial: planned.partial, leftRaw: planned.leftRaw };
    },
  };
}

/** The amount this action will actually carry, against the market as it stands now. */
function plan(
  request: EarnBuildRequest,
  market: EarnMarket,
): Readonly<{ ok: true; amountRaw: bigint; partial: boolean; leftRaw: bigint | null }> | EarnFailure {
  if (request.action === "deposit") {
    const minimum = market.minimumRaw === null ? null : BigInt(market.minimumRaw);
    if (minimum !== null && request.askedRaw < minimum) {
      return { ok: false, code: "BELOW_MINIMUM", reason: "The amount is below this market's minimum.", status: 422 };
    }
    if (request.walletRaw !== null && request.askedRaw > request.walletRaw) {
      return { ok: false, code: "OVER_WALLET", reason: "The wallet holds less than this.", status: 422 };
    }
    return { ok: true, amountRaw: request.askedRaw, partial: false, leftRaw: null };
  }
  const planned = withdrawPlan({
    askedRaw: request.askedRaw,
    positionRaw: request.positionRaw,
    liquidRaw: market.liquidRaw === null ? null : BigInt(market.liquidRaw),
  });
  if (!planned.ok) return { ok: false, code: planned.code, reason: planned.reason, status: 422 };
  return { ok: true, amountRaw: planned.plan.amountRaw, partial: planned.plan.partial, leftRaw: planned.plan.leftRaw };
}
