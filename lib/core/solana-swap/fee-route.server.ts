/**
 * Which Jupiter lane a swap takes, and with which Ryntra fee — fee policy v2
 * on the server (`../fee-policy.ts` is the table).
 *
 *     sides read → flow → lane (/build or /order) → both asked where both may win
 *       → the better price net of Jupiter's share → one answer
 *
 * The person's own order and the card's read-only quote take the same
 * decision, so the price on the card is the price of the lane the Review will
 * be built on. A side the catalogue could not read, a flow the table does not
 * name — each takes the lane production ran before this policy («as now»),
 * never a guess. A flow whose `/build` fee cannot be carried here — neither
 * side is a mint the fee wallet takes, or its account is not on chain — asks
 * `/order` with the flow's own rate where Jupiter allows it, and no fee where
 * that rate is under Jupiter's minimum: never more than the flow's rate.
 *
 * The phone takes the same decision as the web: it was kept on «as now»
 * until its client read the contract that names `/build` (1.24.0, line B's
 * M30), and since 2026-10-05 (line B's request 41) who carries the request no
 * longer picks the lane.
 */

import { associatedTokenAccount } from "../../attribution/ata.ts";
import { feeWalletOf } from "../../attribution/registry.ts";
import { askOnceMoreAfterRate } from "../../solana/jupiter-ask-again.ts";
import { JUPITER_ORDER_RETRY_WAIT_MAX_MS } from "../../solana/jupiter-budget.ts";
import { assembleJupiterBuildOrder, fetchJupiterBuild, type JupiterBuildFee, type JupiterBuildResult } from "../../solana/jupiter-build.ts";
import {
  JUPITER_REFERRAL_FEE_MIN_BPS,
  fetchJupiterExecutableOrder,
  fetchJupiterOrder,
  type JupiterExecutableOrder,
  type JupiterExecutableOrderFailure,
  type JupiterOrderQuote,
  type JupiterOrderResult,
  type JupiterReferral,
  type JupiterSwapEndpoint,
  type JupiterSwapEndpointSelection,
} from "../../solana/quotes.ts";
import { verifiedJupiterReferral } from "../../solana/referral-account.server.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "../../solana/rpc.ts";
import { readSpotMarket } from "../../spot/markets.server.ts";
import { findStockRow } from "../../stocks/universe.server.ts";
import { serviceFeeAbsent, type ServiceFeeConfig } from "../../swap/service-fee.ts";
import {
  DOLLAR_MINTS,
  FEE_POLICY_V2,
  MAJOR_MINTS,
  USDC_MINT,
  USDT_MINT,
  WRAPPED_SOL_MINT,
  buildFeeSide,
  classifyPair,
  discountedFeeBps,
  preferOrder,
  productOfFlow,
  type FeeFlow,
  type SideFacts,
} from "../fee-policy.ts";

/**
 * The operator's switch for the policy, beside the swap lane's own stop:
 * `as-now` puts every swap back on the lane production ran before fee policy
 * v2 — `/order` with the referral fee — without a release. Anything else,
 * absent included, is v2. It changes which lane carries a swap, never what a
 * Review shows about it.
 */
export const FEE_POLICY_ENV = "RYNTRA_FEE_POLICY";
export function feePolicyInForce(env: Record<string, string | undefined> = process.env): "v2" | "as-now" {
  return env[FEE_POLICY_ENV]?.trim() === "as-now" ? "as-now" : "v2";
}

const FEE_MINT_FACTS: Readonly<Record<string, Readonly<{ decimals: number; symbol: string }>>> = {
  [WRAPPED_SOL_MINT]: { decimals: 9, symbol: "SOL" },
  [USDC_MINT]: { decimals: 6, symbol: "USDC" },
  [USDT_MINT]: { decimals: 6, symbol: "USDT" },
};

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/* ---------------------------------------------------------------- sides */

/**
 * What the catalogue says of a side that is neither a dollar nor a major; null
 * when it could not say. A stock the catalogue could not be asked about —
 * its shared budget spent, a timeout — is still known by the stock universe,
 * which names its issuer: a company's rate never falls back for a busy
 * catalogue.
 */
export async function readSideFacts(
  mint: string,
  read: typeof readSpotMarket = readSpotMarket,
  stock: (mint: string) => Promise<string | null> = stockIssuerOf,
): Promise<SideFacts | null> {
  if (DOLLAR_MINTS.has(mint) || MAJOR_MINTS.has(mint)) return { mint, verified: true, tags: [], firstPoolAt: null };
  try {
    const answer = await read(mint);
    if (answer.ok && answer.market) return { mint, verified: answer.market.verified, tags: answer.market.tags, firstPoolAt: answer.market.firstPoolAt };
  } catch {
    /* The stock universe below is the second witness. */
  }
  const issuer = await stock(mint).catch(() => null);
  return issuer ? { mint, verified: true, tags: [issuer], firstPoolAt: null } : null;
}

/** The issuer the stock universe names for a mint — `xstocks`, `ondo`, `prestocks`, `backpack` — or null. */
async function stockIssuerOf(mint: string): Promise<string | null> {
  const found = await findStockRow(mint);
  return found.ok && found.row && found.row.representation.mint === mint ? found.row.representation.issuer.id : null;
}

export async function flowOfSwap(
  inputMint: string,
  outputMint: string,
  deps: Readonly<{ read?: typeof readSpotMarket; stock?: (mint: string) => Promise<string | null>; nowMs?: number }> = {},
): Promise<FeeFlow> {
  const [input, output] = await Promise.all([readSideFacts(inputMint, deps.read, deps.stock), readSideFacts(outputMint, deps.read, deps.stock)]);
  return classifyPair({ inputMint, outputMint, input, output, nowMs: deps.nowMs ?? Date.now() });
}

/* ------------------------------------------------------------ fee accounts */

type FeeAccount = Readonly<{ mint: string; account: string; exists: boolean }>;
let accountsCache: Readonly<{ owner: string; readAt: number; accounts: readonly FeeAccount[] }> | null = null;
const FEE_ACCOUNTS_TTL_MS = 5 * 60_000;

export function resetFeeAccountCache(): void {
  accountsCache = null;
}

/**
 * The fee wallet's canonical accounts and whether each exists as a token
 * account of the fee wallet. A fee is never asked into an account the chain
 * does not show: Jupiter would build a swap that fails on its first
 * instruction. Kept five minutes; a read that fails is not kept.
 */
export async function feeWalletAccounts(owner: string, handle: SolanaRpcHandle): Promise<readonly FeeAccount[] | null> {
  if (accountsCache && accountsCache.owner === owner && Date.now() - accountsCache.readAt < FEE_ACCOUNTS_TTL_MS) return accountsCache.accounts;
  const mints = Object.keys(FEE_MINT_FACTS);
  const addresses = await Promise.all(mints.map((mint) => associatedTokenAccount(owner, mint)));
  try {
    const read = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getMultipleAccounts(addresses as never, { encoding: "jsonParsed", commitment: "confirmed" }).send({ abortSignal }),
    );
    const accounts = mints.map((mint, index): FeeAccount => {
      const entry = read.value[index] as { owner?: string; data?: { parsed?: { info?: { mint?: string; owner?: string } } } } | null;
      const info = entry?.data?.parsed?.info;
      return { mint, account: addresses[index], exists: entry !== null && entry.owner === TOKEN_PROGRAM && info?.mint === mint && info?.owner === owner };
    });
    accountsCache = { owner, readAt: Date.now(), accounts };
    return accounts;
  } catch {
    return null;
  }
}

/**
 * The fee a `/build` swap of this flow carries, or why it carries none here. `bps` is the flow's rate unless the
 * person's discount lowered it (`../referee-discount.ts`); the wallet and the product stay the flow's.
 */
export async function buildFeeFor(
  flow: FeeFlow,
  inputMint: string,
  outputMint: string,
  handle: SolanaRpcHandle,
  bps: number = FEE_POLICY_V2[flow].bps,
): Promise<Readonly<{ ok: true; fee: JupiterBuildFee | null }> | Readonly<{ ok: false; reason: string }>> {
  if (bps <= 0) return { ok: true, fee: null };
  const side = buildFeeSide(inputMint, outputMint);
  if (!side) return { ok: false, reason: "Neither side is a mint the fee wallet takes." };
  const owner = feeWalletOf(productOfFlow(flow));
  if (!owner) return { ok: false, reason: "The registry names no fee wallet for this product." };
  const accounts = await feeWalletAccounts(owner, handle);
  const account = accounts?.find((entry) => entry.mint === side.mint);
  if (!account?.exists) return { ok: false, reason: accounts === null ? "The fee wallet's accounts could not be read." : "The fee wallet has no account for this mint." };
  const facts = FEE_MINT_FACTS[side.mint];
  return { ok: true, fee: { bps, side: side.side, mint: side.mint, owner, account: account.account, decimals: facts?.decimals ?? null, symbol: facts?.symbol ?? null } };
}

/* ------------------------------------------------------------ the choice */

/** A taker order `/order` built that this lane can sign: the person pays every fee it names, and none of it is gasless. */
export function orderSignableByTaker(order: Pick<JupiterExecutableOrder, "gasless" | "signatureFeePayer" | "priorityFeePayer" | "taker">): boolean {
  if (order.gasless) return false;
  return [order.signatureFeePayer, order.priorityFeePayer].every((payer) => payer === null || payer === order.taker);
}

/**
 * The referral `/order` asks for on this flow: the flow's rate — or the
 * person's discounted one — on the verified account. A rate under Jupiter's
 * minimum goes to the order client as asked, which keeps it off the wire and
 * records why — so the order says «under the provider's minimum», never «not
 * configured», and the person pays no Ryntra fee there rather than more than
 * their rate. A flow with no fee asks for none.
 */
async function referralFor(flow: FeeFlow | null, config: ServiceFeeConfig, bps: number | null = flow === null ? null : FEE_POLICY_V2[flow].bps): Promise<JupiterReferral | null> {
  const verified = (await verifiedJupiterReferral(config)).referral;
  if (!verified || flow === null || bps === null) return verified;
  return bps > 0 ? { account: verified.account, feeBps: bps } : null;
}

/** The `/order` dollar figure for the same input carried onto the `/build` quote: the provider's valuation of exactly this amount, nothing derived. */
function withInputValue<T extends JupiterOrderQuote | JupiterExecutableOrder>(build: T, order: Pick<JupiterOrderQuote, "inputMint" | "inAmountRaw" | "inUsdValue"> | null): T {
  if (!order || order.inputMint !== build.inputMint || order.inAmountRaw !== build.inAmountRaw || order.inUsdValue === null) return build;
  return { ...build, inUsdValue: order.inUsdValue };
}

/** What the choice asks the world, replaceable in tests; the defaults are the lane's own calls. */
export type LaneChoiceDeps = Readonly<{
  policy?: "v2" | "as-now";
  flow?: (inputMint: string, outputMint: string) => Promise<FeeFlow>;
  fee?: typeof buildFeeFor;
  referral?: (flow: FeeFlow | null, config: ServiceFeeConfig, bps?: number | null) => Promise<JupiterReferral | null>;
  fetchBuild?: typeof fetchJupiterBuild;
  fetchOrder?: typeof fetchJupiterExecutableOrder;
  fetchQuote?: typeof fetchJupiterOrder;
  assemble?: typeof assembleJupiterBuildOrder;
}>;

const asNowReferral = async (config: ServiceFeeConfig): Promise<JupiterReferral | null> => (await verifiedJupiterReferral(config)).referral;

/**
 * A flow the table charges nothing on says so on its order: `/order` asked no
 * referral there by design, and its own answer would read «not configured».
 */
function withFlowFee<T extends JupiterOrderQuote | JupiterExecutableOrder>(order: T, flow: FeeFlow): T {
  if (FEE_POLICY_V2[flow].bps !== 0 || order.ryntraFee.state !== "UNCONFIGURED") return order;
  return { ...order, ryntraFee: serviceFeeAbsent("Dollar to dollar: Ryntra charges no fee on this swap.") };
}

export type LaneChoice<T> = Readonly<{ ok: true; order: T; flow: FeeFlow; lane: "BUILD" | "ORDER" }> | Readonly<{ ok: false; failure: JupiterExecutableOrderFailure; flow: FeeFlow }>;

/**
 * The person's own order, on the web and the phone alike: the flow's lane, both lanes where both
 * may win, the better net price, and — when `/build` wins — its bytes
 * assembled for the wallet. A refusal is the lane's own answer.
 *
 * `feeDiscountBps` is the discount a partner's friend gets on Ryntra's fee
 * (`../referee-discount.ts`), read for the taker by the caller. Each lane is
 * asked at the discounted rate where that lane can carry it, so the price
 * compared, the bytes built and the fee the Review states are that rate's.
 * The discount never takes a lane under its smallest fee: `/order` refuses a
 * referral under Jupiter's minimum, so a 50 bps flow asks it the full 50 —
 * and then `/order` cannot win over a `/build` that carries the discount; it
 * stays the swap only where `/build` cannot be. Absent or 0, the table's rate.
 */
export async function chooseExecutableOrder(args: Readonly<{
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  taker: string;
  slippageBps?: number;
  endpoint: JupiterSwapEndpoint;
  handle: SolanaRpcHandle;
  config: ServiceFeeConfig;
  feeDiscountBps?: number;
}>, deps: LaneChoiceDeps = {}): Promise<LaneChoice<JupiterExecutableOrder>> {
  const { inputMint, outputMint, amountRaw, taker, slippageBps, endpoint, handle, config } = args;
  const discount = args.feeDiscountBps ?? 0;
  const fetchOrder = deps.fetchOrder ?? fetchJupiterExecutableOrder;
  const askOrder = (referral: JupiterReferral | null) =>
    askOnceMoreAfterRate(
      () => fetchOrder({ inputMint, outputMint, amountRaw, taker, referral, ...(slippageBps !== undefined ? { slippageBps } : {}) }, endpoint),
      { maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS },
    );
  /* One product, one fee: the phone reads contract 1.24.0 (line B, M30), so who carries the request no longer picks the lane. */
  if ((deps.policy ?? feePolicyInForce()) === "as-now") {
    const asNow = deps.referral ? await deps.referral(null, config) : await asNowReferral(config);
    const result = await askOrder(asNow && discount > 0 ? { ...asNow, feeBps: discountedFeeBps(asNow.feeBps, discount, JUPITER_REFERRAL_FEE_MIN_BPS) } : asNow);
    return result.ok ? { ok: true, order: result.order, flow: "AS_NOW", lane: "ORDER" } : { ok: false, failure: result, flow: "AS_NOW" };
  }
  const flow = await (deps.flow ?? flowOfSwap)(inputMint, outputMint);
  const rule = FEE_POLICY_V2[flow];
  const buildBps = discountedFeeBps(rule.bps, discount);
  const orderBps = discountedFeeBps(rule.bps, discount, JUPITER_REFERRAL_FEE_MIN_BPS);
  /* `/order` charges this flow but cannot carry the discount `/build` carries: it never wins on price then. */
  const orderLacksDiscount = buildBps < rule.bps && orderBps === rule.bps && orderBps >= JUPITER_REFERRAL_FEE_MIN_BPS;
  /* Neither waits on the other (SOL-S1): the fee wallet's accounts and the referral are read at once. */
  const [fee, referral] = await Promise.all([
    rule.lane === "BUILD" ? (deps.fee ?? buildFeeFor)(flow, inputMint, outputMint, handle, buildBps) : Promise.resolve(null),
    (deps.referral ?? referralFor)(flow, config, orderBps),
  ]);
  if (!fee || !fee.ok) {
    const result = await askOrder(referral);
    return result.ok ? { ok: true, order: result.order, flow, lane: "ORDER" } : { ok: false, failure: result, flow };
  }
  const [build, order] = await Promise.all([
    askOnceMoreAfterRate(() => (deps.fetchBuild ?? fetchJupiterBuild)({ inputMint, outputMint, amountRaw, taker, fee: fee.fee, ...(slippageBps !== undefined ? { slippageBps } : {}) }, endpoint), {
      maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS,
    }) as Promise<JupiterBuildResult>,
    rule.orderMayWin ? askOrder(referral) : Promise.resolve(null),
  ]);
  const orderUsable = order?.ok && orderSignableByTaker(order.order) ? order.order : null;
  if (build.ok) {
    const orderWins =
      orderUsable !== null &&
      !orderLacksDiscount &&
      preferOrder(
        { outputRaw: build.answer.quote.outAmountRaw, feeBps: build.answer.quote.ryntraFee.basisPoints },
        { outputRaw: orderUsable.outAmountRaw, feeBps: orderUsable.ryntraFee.basisPoints, referral: orderUsable.ryntraFee.mechanism === "JUPITER_REFERRAL" && orderUsable.ryntraFee.state === "QUOTED" },
      );
    if (orderWins) return { ok: true, order: withFlowFee(orderUsable, flow), flow, lane: "ORDER" };
    const assembled = await (deps.assemble ?? assembleJupiterBuildOrder)(build.answer, handle);
    if (assembled.ok) return { ok: true, order: withInputValue(assembled.order, order?.ok ? order.order : null), flow, lane: "BUILD" };
    /* The router priced it and its bytes would not assemble for this wallet: `/order`, when it answered, is the swap. */
    if (order?.ok) return { ok: true, order: withFlowFee(order.order, flow), flow, lane: "ORDER" };
    return { ok: false, failure: assembled, flow };
  }
  /* `/order`'s own answer stands as it always did when the router could not price — the guard judges it. */
  if (order?.ok) return { ok: true, order: withFlowFee(order.order, flow), flow, lane: "ORDER" };
  return { ok: false, failure: order && !order.ok ? order : build, flow };
}

/**
 * The read-only quote, on the web's card and the phone alike: the same decision, with `/build`
 * asked under its stand-in taker and `/order` without one. Nothing here can
 * be signed.
 */
export async function chooseQuote(args: Readonly<{
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  selection: JupiterSwapEndpointSelection;
  handle: SolanaRpcHandle;
  config: ServiceFeeConfig;
}>, deps: LaneChoiceDeps = {}): Promise<Readonly<{ ok: true; order: JupiterOrderQuote; flow: FeeFlow; lane: "BUILD" | "ORDER" }> | Readonly<{ ok: false; failure: Exclude<JupiterOrderResult, { ok: true }> | JupiterExecutableOrderFailure; flow: FeeFlow }>> {
  const { inputMint, outputMint, amountRaw, selection, handle, config } = args;
  const fetchQuote = deps.fetchQuote ?? fetchJupiterOrder;
  if ((deps.policy ?? feePolicyInForce()) === "as-now") {
    const referral = deps.referral ? await deps.referral(null, config) : await asNowReferral(config);
    const result = await askOnceMoreAfterRate(() => fetchQuote({ inputMint, outputMint, amountRaw, referral }, selection));
    return result.ok ? { ok: true, order: result.order, flow: "AS_NOW", lane: "ORDER" } : { ok: false, failure: result, flow: "AS_NOW" };
  }
  const flow = await (deps.flow ?? flowOfSwap)(inputMint, outputMint);
  const rule = FEE_POLICY_V2[flow];
  /* Read at once, as the order's choice reads them (SOL-S1). */
  const [referral, fee] = await Promise.all([
    (deps.referral ?? referralFor)(flow, config),
    rule.lane === "BUILD" && selection.ok && selection.access === "production" ? (deps.fee ?? buildFeeFor)(flow, inputMint, outputMint, handle) : Promise.resolve(null),
  ]);
  const askOrder = () => askOnceMoreAfterRate(() => fetchQuote({ inputMint, outputMint, amountRaw, referral }, selection));
  if (!fee || !fee.ok) {
    const result = await askOrder();
    return result.ok ? { ok: true, order: result.order, flow, lane: "ORDER" } : { ok: false, failure: result, flow };
  }
  const [build, order] = await Promise.all([
    askOnceMoreAfterRate(() => (deps.fetchBuild ?? fetchJupiterBuild)({ inputMint, outputMint, amountRaw, taker: null, fee: fee.fee }, selection)) as Promise<JupiterBuildResult>,
    rule.orderMayWin ? askOrder() : Promise.resolve(null),
  ]);
  if (!build.ok) {
    if (order?.ok) return { ok: true, order: withFlowFee(order.order, flow), flow, lane: "ORDER" };
    return { ok: false, failure: order && !order.ok ? order : build, flow };
  }
  if (
    order?.ok &&
    preferOrder(
      { outputRaw: build.answer.quote.outAmountRaw, feeBps: build.answer.quote.ryntraFee.basisPoints },
      { outputRaw: order.order.outAmountRaw, feeBps: order.order.ryntraFee.basisPoints, referral: order.order.ryntraFee.mechanism === "JUPITER_REFERRAL" && order.order.ryntraFee.state === "QUOTED" },
    )
  ) {
    return { ok: true, order: withFlowFee(order.order, flow), flow, lane: "ORDER" };
  }
  return { ok: true, order: withInputValue(build.answer.quote, order?.ok ? order.order : null), flow, lane: "BUILD" };
}
