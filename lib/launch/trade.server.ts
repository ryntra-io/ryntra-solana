/**
 * Buying and selling a launched token — the server's half.
 *
 * 1. **Quote**: what a buy or a sale gets now on the curve or in the pool, the
 *    fee and who receives it, how far it moves the price.
 * 2. **Build**: the wallet must hold what the trade spends; the core builds the
 *    swap with a fresh quote and the slippage the person chose, the wallet as
 *    the fee payer and the only signer. The exact bytes are kept a few minutes.
 * 3. **The person signs** in their wallet.
 * 4. **Submit**: the signed bytes must be the built ones — a wallet may add
 *    only its own fee and guard instructions — with a valid signature; then
 *    they are sent once and confirmed. Nothing here signs.
 */

import { randomBytes } from "node:crypto";

import { PublicKey, Transaction } from "@solana/web3.js";

import type {
  ApiErrorCode,
  LaunchTradeBuildRequest,
  LaunchTradeBuildResponse,
  LaunchTradeQuoteRequest,
  LaunchTradeQuoteResponse,
  LaunchTradeSubmitRequest,
  LaunchTradeSubmitResponse,
  LaunchWalletResponse,
} from "../api/v1/contract.ts";
import { priceMoveBps, uiAmount, type LaunchTrade } from "../core/venues/meteora-dbc/market.ts";
import type { MarketState } from "../core/venues/meteora-dbc/market.server.ts";
import { LaunchTradeRefusal, createLaunchTradeVenue, heldRaw, type LaunchTradeQuote } from "../core/venues/meteora-dbc/trade.server.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import type { LaunchDeps, LaunchReadDeps, LaunchRecord } from "./flow.server.ts";
import { launchPair, launchPoolFee } from "./config.server.ts";
import { byDeadline, readLaunchRecord, sendOnce } from "./flow.server.ts";
import { forgetLaunchMarket } from "./market.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";

export type TradeDeps = Pick<LaunchDeps, "network" | "connection" | "store" | "now"> & Pick<LaunchReadDeps, "second" | "adopt">;

/** How long a built trade waits for the signature. */
export const TRADE_BUILD_TTL_MS = 90 * 1000;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 10_000 } as const;
const TRADE_ROUTE_MS = 50_000;

export type TradeFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string }>;
const fail = (code: ApiErrorCode, message: string): TradeFailure => ({ ok: false, code, message });

type TradeBuildRecord = Readonly<{
  id: string;
  cluster: string;
  token: string;
  wallet: string;
  side: "buy" | "sell";
  amountRaw: string;
  /** The bytes as built, unsigned: the signed ones are compared with them. */
  wireBase64: string;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;

const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;

async function launchState(deps: TradeDeps, token: string): Promise<Readonly<{ record: LaunchRecord; state: MarketState }> | TradeFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  const state = await launchMarketReader(deps).state({ token, pool: record.pool });
  return { record, state };
}

function refused(error: unknown): TradeFailure {
  if (error instanceof LaunchTradeRefusal) {
    if (error.code === "BALANCE_LOW") return fail("LAUNCH_BALANCE_LOW", "The wallet does not hold that much.");
    if (error.code === "CURVE_COMPLETE") return fail("LAUNCH_GRADUATING", "The curve is full; trading opens in its pool once it moves there.");
    if (error.code === "AMOUNT_ZERO") return fail("VALIDATION_ERROR", "amountRaw: more than zero");
    if (error.code === "NO_POOL") return fail("LAUNCH_NOT_FOUND", error.message);
  }
  return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The trade could not be prepared.");
}

function quoteView(deps: TradeDeps, record: LaunchRecord, state: MarketState, quote: LaunchTradeQuote): LaunchTradeQuoteResponse {
  const pair = launchPair(deps.network, record.preset);
  const capPair = quote.priceAfter * uiAmount(state.supplyRaw, state.tokenDecimals);
  return {
    venue: quote.venue,
    side: quote.side,
    amountInRaw: quote.amountInRaw,
    amountOutRaw: quote.amountOutRaw,
    minimumOutRaw: quote.minimumOutRaw,
    amountLeftRaw: quote.amountLeftRaw,
    slippageBps: quote.slippageBps,
    feeBps: Math.min(10_000, quote.feeBps),
    fee: quote.fee,
    priceMoveBps: priceMoveBps(quote.priceBefore, quote.priceAfter),
    marketCapAfter: { pair: capPair, usd: pair.dollar ? capPair * pair.usdPrice : null },
    referral: quote.referral,
    observedAt: deps.now().toISOString(),
  };
}

/** What a wallet holds of a launched token and of its pair currency, raw, read from the chain now. */
export async function readLaunchWallet(deps: TradeDeps, token: string, wallet: string): Promise<Readonly<{ ok: true; wallet: LaunchWalletResponse }> | TradeFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  let owner: PublicKey;
  try {
    owner = new PublicKey(wallet);
  } catch {
    return fail("VALIDATION_ERROR", "address: not a wallet");
  }
  /* By the accounts' own addresses: the public node refuses the indexed read of a wallet's token accounts. */
  const held = (mint: string) => heldRaw(deps.connection, owner, new PublicKey(mint));
  try {
    const [tokenRaw, pairRaw] = await Promise.all([held(token), held(record.pairMint)]);
    return { ok: true, wallet: { wallet, token, tokenRaw: tokenRaw.toString(), pairRaw: pairRaw.toString(), observedAt: deps.now().toISOString() } };
  } catch {
    return fail("UNAVAILABLE", "The wallet could not be read now.");
  }
}

export async function quoteLaunchTrade(deps: TradeDeps, token: string, input: LaunchTradeQuoteRequest): Promise<Readonly<{ ok: true; quote: LaunchTradeQuoteResponse }> | TradeFailure> {
  try {
    const read = await launchState(deps, token);
    if ("ok" in read) return read;
    const venue = createLaunchTradeVenue({ connection: deps.connection, referralOwner: deps.network.referralOwner, poolFee: launchPoolFee(deps.network) });
    const quote = await venue.quote({ state: read.state, side: input.side, amountRaw: input.amountRaw, slippageBps: input.slippageBps });
    return { ok: true, quote: quoteView(deps, read.record, read.state, quote) };
  } catch (error) {
    return refused(error);
  }
}

/** Builds older than an hour past their expiry are removed: anyone may ask for a build, nobody can fill the store with them. */
async function sweep(deps: TradeDeps): Promise<void> {
  const builds = deps.store.collection<TradeBuildRecord>("launchTradeBuilds");
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  for (const build of await builds.valuesWithPrefix(`${deps.network.cluster}:`)) {
    if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.cluster, build.id));
  }
  const sends = deps.store.collection<TradeSend>("launchTradeSends");
  for (const send of await sends.valuesWithPrefix(`${deps.network.cluster}:`)) {
    if (Date.parse(send.at) < stale) await sends.delete(buildKey(send.cluster, send.id));
  }
}

/** A build that was sent: kept as long as its build, so a second press finds it used. */
type TradeSend = Readonly<{ cluster: string; id: string; at: string }>;

export async function buildLaunchTrade(deps: TradeDeps, token: string, input: LaunchTradeBuildRequest): Promise<Readonly<{ ok: true; build: LaunchTradeBuildResponse }> | TradeFailure> {
  try {
    const read = await launchState(deps, token);
    if ("ok" in read) return read;
    const venue = createLaunchTradeVenue({ connection: deps.connection, referralOwner: deps.network.referralOwner, poolFee: launchPoolFee(deps.network) });
    const built = await venue.build({ state: read.state, token, side: input.side, amountRaw: input.amountRaw, slippageBps: input.slippageBps, wallet: input.wallet });
    await sweep(deps).catch(() => undefined);
    const now = deps.now();
    const record: TradeBuildRecord = {
      id: randomBytes(16).toString("hex"),
      cluster: deps.network.cluster,
      token,
      wallet: input.wallet,
      side: input.side,
      amountRaw: input.amountRaw,
      wireBase64: built.wireBase64,
      validUntil: built.validUntil,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TRADE_BUILD_TTL_MS).toISOString(),
    };
    await deps.store.collection<TradeBuildRecord>("launchTradeBuilds").insertIfAbsent(buildKey(record.cluster, record.id), record);
    return {
      ok: true,
      build: { buildId: record.id, network: deps.network.chain, unsignedWireBase64: built.wireBase64, quote: quoteView(deps, read.record, read.state, built.quote), expiresAt: record.expiresAt },
    };
  } catch (error) {
    return refused(error);
  }
}

export async function submitLaunchTrade(deps: TradeDeps, token: string, input: LaunchTradeSubmitRequest): Promise<Readonly<{ ok: true; submit: LaunchTradeSubmitResponse }> | TradeFailure> {
  /* The send and the fill's read inside the route's 60 s: a fill not read in time is said as the quote's «≈». */
  const deadline = deps.now().getTime() + TRADE_ROUTE_MS;
  const builds = deps.store.collection<TradeBuildRecord>("launchTradeBuilds");
  const build = await builds.get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.token !== token) return fail("LAUNCH_NOT_FOUND", "This trade was not built here.");
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", "This trade was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The trade waited too long for the signature; prepare it again.");
  /* The wallet's own fee and guard instructions are its right; any other change is not the trade the person reviewed. */
  const verdict = compareWalletTransaction({ expectedWireBase64: build.wireBase64, actualWireBase64: input.signedWireBase64, guardPolicy: "BOUNDED" });
  if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(input.signedWireBase64, "base64"));
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (!tx.verifySignatures(true)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature is missing or does not match the transaction.");
  /* One send per build: a second press of the button finds it used. */
  if (!(await deps.store.collection<TradeSend>("launchTradeSends").insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This trade was already sent.");
  }
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
  forgetLaunchMarket(deps.network.cluster, token);
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    /* The program names its own refusal in its logs: the price moved past the slippage before the trade landed. */
    if (/ExceededSlippage/.test(sent.detail ?? sent.reason ?? "")) return fail("LAUNCH_SLIPPAGE", "The price moved past the slippage before the trade landed; nothing moved.");
    return fail("LAUNCH_SUBMIT_FAILED", sent.reason ?? "The network refused the trade.");
  }
  const confirmed = sent.outcome === "CONFIRMED";
  return { ok: true, submit: { signature: sent.signature, state: confirmed ? "CONFIRMED" : "PENDING", filled: confirmed ? await byDeadline(() => filledBy(deps, build, sent.signature), deadline, deps.now, null) : null } };
}

/**
 * The person's trade among a transaction's trades: the side they built, their wallet as the one whose tokens moved or
 * as the payer. Its figures are the chain's — the tokens, and the pair currency paid or received with Ryntra's own fee
 * of the same transaction counted. Null when the transaction shows no such trade.
 */
export function fillOf(trades: readonly LaunchTrade[] | null, build: Pick<TradeBuildRecord, "side" | "wallet">): Readonly<{ tokensRaw: string; pairRaw: string }> | null {
  const mine = trades?.find((trade) => trade.side === build.side && (trade.trader === build.wallet || trade.payer === build.wallet));
  return mine ? { tokensRaw: mine.tokensRaw, pairRaw: mine.pairRaw } : null;
}

/**
 * What a confirmed trade did, from the program's own swap event in its transaction — never the quote. A node that has
 * no record of the transaction yet is asked a few times; then null, and the page says the quote's «≈».
 */
async function filledBy(deps: TradeDeps, build: TradeBuildRecord, signature: string): Promise<LaunchTradeSubmitResponse["filled"]> {
  try {
    const record = await readLaunchRecord(deps, deps.network.cluster, build.token);
    if (!record) return null;
    const reader = launchMarketReader(deps);
    const state = await reader.state({ token: build.token, pool: record.pool });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const filled = fillOf(await reader.transaction({ token: build.token, state, signature }), build);
      if (filled) return filled;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  } catch {
    /* Unread is unread: the quote's «≈» stands. */
  }
  return null;
}
