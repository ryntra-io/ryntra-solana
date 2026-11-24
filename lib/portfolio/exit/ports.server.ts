/**
 * The exit's real builders: each one the engine's own builder for that action, asked as its own screen asks
 * it, behind that engine's own gate. Nothing here changes a route, a fee, a signature or a check of theirs; it only asks.
 *
 * | Port | The engine's builder | Its gate |
 * |---|---|---|
 * | `pool` | the pools engine's withdraw-and-close and claim (`lib/liquidity/studio`) | `RYNTRA_LIQUIDITY_ACTIONS` |
 * | `pro` | DLMM Pro's remove and collect, through earning's door (`lib/earn-pro`) | `RYNTRA_EARN_PRO` on mainnet |
 * | `lend` | Jupiter Lend's withdraw (`lib/earn`) | `RYNTRA_EARN_ACTIONS` |
 * | `stake` | the stake program's withdraw and deactivate (`./stake.ts`) | — |
 * | `swap` | the swap engine's order: its venue, fee policy and lane, referral, the taker's discount, its pre-sign check | the SWAP lane |
 * | `sweep` | Meteora's Zap Out over Jupiter's `/build` route (the SDK the Zap already uses), Ryntra's fee by the same fee policy's `/build` lane | the SWAP lane |
 * | `exitRoutable` | the Swap card's read-only quote: whether Jupiter carries a coin now, for the overview | the SWAP lane, the Jupiter window |
 *
 * The only file of the exit that reads `process.env` and the network.
 */

import "server-only";

import { Zap, getJupiterQuote, getJupiterSwapInstruction } from "@meteora-ag/zap-sdk-v2";
import { createSyncNativeInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type Connection } from "@solana/web3.js";
import BN from "bn.js";

import { FEE_POLICY_V2 } from "../../core/fee-policy.ts";
import { discountedFeeBps, readRefereeDiscountBps } from "../../core/referee-discount.ts";
import { buildFeeFor, chooseQuote, feePolicyInForce, flowOfSwap } from "../../core/solana-swap/fee-route.server.ts";
import { askVenueOrder } from "../../core/solana-swap/venue-order.ts";
import { createJupiterSwapVenue, type JupiterSwapVenue } from "../../core/venues/jupiter.ts";
import { admitEarn, withinCanary } from "../../earn/gate.ts";
import { JUPITER_LEND_EARN_PROGRAM, JUPITER_LEND_LIQUIDITY_PROGRAM } from "../../earn/jupiter.ts";
import { usdOf } from "../../earn/model.ts";
import { earnAdapters } from "../../earn/service.server.ts";
import { LEAVE_BAND_BPS } from "../../earn-pro/actions.server.ts";
import { earnProGate } from "../../earn-pro/gate.ts";
import { readPier } from "../../earn-pro/piers.server.ts";
import { DLMM_PRO_PROGRAM, DlmmProRefusal, earnProConnection, earnProVenue, type DlmmProTx } from "../../earn-pro/venue.server.ts";
import { getGuardRuntime } from "../../guard/runtime.ts";
import { forgetWalletPositions, positionsConnections } from "../../liquidity/catalog/chain.server.ts";
import { LiquidityRefusal, type LiquidityVenueId, type RentCost } from "../../liquidity/studio/contract.ts";
import { admitLiquidityAction } from "../../liquidity/studio/gate.ts";
import { liquidityVenues } from "../../liquidity/studio/venues.server.ts";
import { againstReference, ZAP_PROGRAM } from "../../liquidity/studio/zap-check.ts";
import { BLOCKHASH_SUBMIT_MARGIN_MS, readBlockhashLife, signableWindowMs, web3ChainReader } from "../../solana/blockhash-life.ts";
import { jupiterBackgroundAllowed } from "../../solana/jupiter-budget.ts";
import { resolveSolanaLaneState } from "../../solana/lane-state.ts";
import { resolveJupiterSwapEndpoint } from "../../solana/quotes.ts";
import { verifiedJupiterReferral } from "../../solana/referral-account.server.ts";
import { createSolanaRpcHandle } from "../../solana/rpc.ts";
import { inspectJupiterSwapTransaction } from "../../solana/swap-transaction-check.ts";
import { resolveServiceFeeConfig } from "../../swap/service-fee.server.ts";
import { cleanConnection, within } from "../../wallet-clean/read.server.ts";
import { NATIVE_SOL_MINT, STAKE_PROGRAM, USDC_MINT } from "../model.ts";
import { forgetPortfolio } from "../service.ts";
import { zapOutCounts } from "./checks.ts";
import type { ExitChain, ExitPorts, ExitRoutable, UnitBuilt } from "./ports.ts";
import { stakeWire } from "./stake.ts";
import type { Bring } from "./sweeps.ts";
import { lookupsOf } from "./ticket.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** How far the price may move while a pool is left, basis points: the engine's own bound for a removal. */
export const EXIT_POOL_SLIPPAGE_BPS = 100;
/** A swap of what arrived: its bound against its own quote. */
export const EXIT_SWEEP_SLIPPAGE_BPS = 100;
/** Jupiter's routes are asked to stay within this many accounts, so a sweep fits one transaction. */
export const EXIT_SWEEP_MAX_ACCOUNTS = 40;
/** What a sweep is given to run in, and its priority price, micro-lamports a unit: at most 6 000 lamports. */
const SWEEP_UNITS = 600_000;
const SWEEP_UNIT_PRICE = 10_000;
const PACKET_BYTES = 1_232;
/** The most one call of the Zap SDK — a quote, a build — is waited for. */
const SDK_MS = 10_000;
/** A withdrawal from a lending market is counted to the last unit by the market: this much may round away, basis points. */
const LEND_ROUNDING_BPS = 10;

const no = (reason: Extract<UnitBuilt, { ok: false }>["reason"]): UnitBuilt => ({ ok: false, reason });
const floorOf = (raw: bigint, bps: number): bigint => (raw * BigInt(10_000 - bps)) / 10_000n;
const digits = (value: string): bigint => (/^\d+$/.test(value) ? BigInt(value) : 0n);

/* ── pools: DLMM and DAMM v2 ──────────────────────────────────────────── */

const STUDIO_VENUE: Readonly<Record<"meteora-dlmm" | "meteora-damm-v2", LiquidityVenueId>> = { "meteora-dlmm": "meteora-dlmm", "meteora-damm-v2": "meteora-damm2" };

type StudioAmount = Readonly<{ asset: string; units: string; decimals: number }>;
const bring = (amount: StudioAmount, floorBps: number): Bring => ({ mint: amount.asset, decimals: amount.decimals, expectedRaw: digits(amount.units), minRaw: floorOf(digits(amount.units), floorBps) });
const rentBack = (rent: readonly RentCost[]): bigint => rent.reduce((sum, row) => (row.direction === "return" ? sum + digits(row.lamports) : sum), 0n);

function poolPort(env: Env): ExitPorts["pool"] {
  return async (request) => {
    if (!admitLiquidityAction(request.owner, env).ok) return no("CLOSED_HERE");
    const id = STUDIO_VENUE[request.venue];
    for (const connection of positionsConnections()) {
      try {
        const venue = liquidityVenues(connection)[id];
        const rule = { kind: "studio", program: venue.program } as const;
        if (request.mode === "collect") {
          const built = await venue.buildClaim(await venue.previewClaim({ position: request.position, owner: request.owner }));
          if (built.preview.action !== "claim" || built.transactions.some((tx) => tx.presigned.length > 0)) return no("REFUSED");
          const { claimed } = built.preview;
          /* Claims of one position do not stand on each other. */
          return { ok: true, txs: built.transactions.map((tx) => ({ wire: tx.wireBase64, requestId: null, rule })), chained: false, brings: [bring(claimed.x, 0), bring(claimed.y, 0)], rentLamports: 0n, feeBps: null };
        }
        const preview = await venue.previewRemove({ position: request.position, owner: request.owner, shareBps: 10_000, close: request.close, slippageBps: EXIT_POOL_SLIPPAGE_BPS });
        const built = await venue.buildRemove(preview);
        if (built.preview.action !== "remove" || built.transactions.some((tx) => tx.presigned.length > 0)) return no("REFUSED");
        const shown = built.preview;
        /*
         * DLMM holds no least on a removal — each bin pays its share as it stands — so the least named here is a reckoning,
         * not a promise of the program. Nothing leans on it alone: a sweep is sized on chain, and a fixed swap of SOL is
         * sent only while the SOL is in the wallet (`service.ts`).
         */
        const least = shown.minimum;
        const brings: Bring[] = [
          least ? { ...bring(shown.expected.x, 0), minRaw: digits(least.x.units) } : bring(shown.expected.x, EXIT_POOL_SLIPPAGE_BPS),
          least ? { ...bring(shown.expected.y, 0), minRaw: digits(least.y.units) } : bring(shown.expected.y, EXIT_POOL_SLIPPAGE_BPS),
          bring(shown.feesClaimed.x, 0),
          bring(shown.feesClaimed.y, 0),
          ...shown.rewardsClaimed.map((reward) => bring(reward, 0)),
        ];
        return { ok: true, txs: built.transactions.map((tx) => ({ wire: tx.wireBase64, requestId: null, rule })), chained: true, brings, rentLamports: rentBack(shown.rent), feeBps: null };
      } catch (error) {
        if (error instanceof LiquidityRefusal) return no(error.code === "NOTHING_TO_WITHDRAW" || error.code === "NOTHING_TO_CLAIM" ? "NOTHING_TO_DO" : "REFUSED");
        /* An endpoint that fell gives way to the next. */
      }
    }
    return no("UNAVAILABLE");
  };
}

/* ── DLMM Pro ─────────────────────────────────────────────────────────── */

function proPort(env: Env): ExitPorts["pro"] {
  return async (request) => {
    const gate = earnProGate(env);
    /* The portfolio reads DLMM Pro on mainnet only; so does its exit. */
    if (!gate.open || gate.network !== "mainnet") return no("CLOSED_HERE");
    const connection = earnProConnection(gate.network);
    const venue = earnProVenue(gate.network, connection, env);
    const nothing = async <T>(work: () => Promise<T>): Promise<T | null> => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof DlmmProRefusal && error.code === "NOTHING_TO_DO") return null;
        throw error;
      }
    };
    try {
      const read = await readPier(gate.network, request.pool, { env, connection, venue });
      if (!read) return no("REFUSED");
      const { pier } = read;
      const at = { pool: request.pool, nftMint: request.nftMint, owner: request.owner };
      const coins = (xRaw: string, yRaw: string, minX: string, minY: string): Bring[] => [
        { mint: pier.x.mint, decimals: pier.x.decimals, expectedRaw: digits(xRaw), minRaw: digits(minX) },
        { mint: pier.y.mint, decimals: pier.y.decimals, expectedRaw: digits(yRaw), minRaw: digits(minY) },
      ];
      /* The removal, then what the position earned — the order earning's own «leave» sends them in. */
      const removal = request.mode === "exit" ? await nothing(() => venue.positions.remove({ ...at, bps: 10_000, slippageBps: LEAVE_BAND_BPS })) : null;
      const fees = await nothing(() => venue.positions.collect(at));
      const builds: DlmmProTx[] = [...(removal ? [removal] : []), ...(fees ? [fees] : [])];
      const brings: Bring[] = [...(removal ? coins(removal.expected.xRaw, removal.expected.yRaw, removal.minimum.xRaw, removal.minimum.yRaw) : []), ...(fees ? coins(fees.expected.xRaw, fees.expected.yRaw, fees.expected.xRaw, fees.expected.yRaw) : [])];
      for (const reward of pier.rewards) {
        const built = await nothing(() => venue.rewards.collect({ ...at, index: reward.index }));
        if (!built) continue;
        builds.push(built);
        const facts = await mintFacts(connection, built.rewardMint);
        if (!facts) return no("UNAVAILABLE");
        brings.push({ mint: built.rewardMint, decimals: facts.decimals, expectedRaw: digits(built.accruedRaw), minRaw: digits(built.accruedRaw) });
      }
      if (builds.length === 0) return no("NOTHING_TO_DO");
      if (builds.some((build) => build.cosigners.length > 0)) return no("REFUSED");
      return { ok: true, txs: builds.map((build) => ({ wire: build.wireBase64, requestId: null, rule: { kind: "venue", programs: [DLMM_PRO_PROGRAM] } as const })), chained: true, brings, rentLamports: 0n, feeBps: null };
    } catch (error) {
      return no(error instanceof DlmmProRefusal ? "REFUSED" : "UNAVAILABLE");
    }
  };
}

/* ── Jupiter Lend ─────────────────────────────────────────────────────── */

function lendPort(env: Env): ExitPorts["lend"] {
  return async (request) => {
    const admission = admitEarn(request.owner, env);
    if (!admission.ok) return no("CLOSED_HERE");
    const adapter = earnAdapters(env as NodeJS.ProcessEnv).find((entry) => entry.provider === "jupiter");
    if (!adapter || adapter.blocked) return no("CLOSED_HERE");
    const markets = await adapter.markets();
    if (!markets.ok) return no("UNAVAILABLE");
    const market = markets.markets.find((entry) => entry.id === request.market);
    if (!market) return no("REFUSED");
    const positions = await adapter.positions(request.owner, [market]);
    const position = positions.ok ? positions.positions.find((entry) => entry.marketId === market.id) : undefined;
    if (!position?.underlyingRaw) return no(positions.ok ? "NOTHING_TO_DO" : "UNAVAILABLE");
    const all = BigInt(position.underlyingRaw);
    if (all <= 0n) return no("NOTHING_TO_DO");
    const built = await adapter.build({ action: "withdraw", owner: request.owner, marketId: market.id, askedRaw: all, walletRaw: null, positionRaw: all });
    if (!built.ok) return no("REFUSED");
    /* The canary's ceiling holds here as on Earn's own screen: on what actually moves. */
    if (!withinCanary(admission, usdOf(built.amountRaw, built.market.asset.decimals, built.market.priceUsd))) return no("CLOSED_HERE");
    const brings: Bring[] = [{ mint: built.market.asset.mint, decimals: built.market.asset.decimals, expectedRaw: built.amountRaw, minRaw: floorOf(built.amountRaw, LEND_ROUNDING_BPS) }];
    return { ok: true, txs: [{ wire: built.wireBase64, requestId: null, rule: { kind: "lend", programs: [JUPITER_LEND_EARN_PROGRAM, JUPITER_LEND_LIQUIDITY_PROGRAM], assetMint: built.market.asset.mint, shareMint: built.market.share.mint } }], chained: true, brings, rentLamports: 0n, feeBps: null };
  };
}

/* ── native stake ─────────────────────────────────────────────────────── */

function stakePort(connection: Connection): ExitPorts["stake"] {
  return async (request) => {
    const [info, latest] = await Promise.all([within(connection.getAccountInfo(new PublicKey(request.account), "confirmed")), within(connection.getLatestBlockhash("confirmed"))]);
    /* Read again now: the portfolio's figure is for showing, the withdraw takes what the account holds. */
    if (!info || info.owner.toBase58() !== STAKE_PROGRAM || info.lamports <= 0) return no("NOTHING_TO_DO");
    const lamports = BigInt(info.lamports);
    const wire = stakeWire({ op: request.op, owner: request.owner, account: request.account, lamports, blockhash: latest.blockhash });
    const brings: Bring[] = request.op === "withdraw" ? [{ mint: NATIVE_SOL_MINT, decimals: 9, expectedRaw: lamports, minRaw: lamports }] : [];
    return { ok: true, txs: [{ wire, requestId: null, rule: { kind: "stake", account: request.account, op: request.op } }], chained: true, brings, rentLamports: 0n, feeBps: null };
  };
}

/* ── the swap engine's order ──────────────────────────────────────────── */

/** The swap engine's venue, set up as the swap's own prepare half sets it up; null — swapping cannot be asked now. */
async function engineVenue(owner: string): Promise<JupiterSwapVenue | null> {
  const endpoint = resolveJupiterSwapEndpoint({ access: "production" });
  if (!endpoint.ok) return null;
  const config = resolveServiceFeeConfig();
  /* The taker's discount as the Swap screen reads it; a discount not read is no swap here, never a fuller fee. */
  const read = await Promise.all([verifiedJupiterReferral(config), readRefereeDiscountBps(getGuardRuntime().store, owner)]).catch(() => null);
  if (!read) return null;
  const [verified, feeDiscountBps] = read;
  return createJupiterSwapVenue({ endpoint, referral: verified.referral, config, lanes: { handle: createSolanaRpcHandle({ network: "mainnet" }), feeDiscountBps } });
}

function swapPort(): ExitPorts["swap"] {
  const venues = new Map<string, Promise<JupiterSwapVenue | null>>();
  return async (request) => {
    if (resolveSolanaLaneState("SWAP") !== "OPEN") return no("PAUSED");
    const venue = await (venues.get(request.owner) ?? venues.set(request.owner, engineVenue(request.owner)).get(request.owner)!);
    if (!venue) return no("PAUSED");
    const account = { kind: "WALLET", network: "solana", address: request.owner } as const;
    const answer = await askVenueOrder(venue, { network: "solana", inputAsset: request.mint, outputAsset: request.outMint, amountRaw: request.amountRaw, account });
    if (!answer.ok) return no(answer.code === "NO_ROUTE" || answer.code === "BUILD_FAILED" ? "NO_ROUTE" : "REFUSED");
    const order = answer.quote.native;
    /* The provider's bytes pass the swap's own pre-sign check for this wallet. */
    const unsigned = await venue.build(answer.quote, account);
    const check = await inspectJupiterSwapTransaction({ wireBase64: unsigned.wireBase64, expectedTaker: request.owner });
    if (!check.ok) return no("REFUSED");
    const out = digits(order.outAmountRaw);
    if (out === 0n) return no("TOO_SMALL");
    if (order.requestId.length > 128) return no("REFUSED");
    const decimals = request.outMint === USDC_MINT ? 6 : 9;
    return {
      ok: true,
      txs: [{ wire: unsigned.wireBase64, requestId: order.requestId.startsWith("build:") ? null : order.requestId, rule: { kind: "swap" } }],
      chained: true,
      brings: [{ mint: request.outMint, decimals, expectedRaw: out, minRaw: out }],
      rentLamports: 0n,
      feeBps: order.ryntraFee.basisPoints,
    };
  };
}

/* ── a sweep of what arrived ──────────────────────────────────────────── */

/**
 * Ryntra's fee on a sweep's Jupiter route: fee policy v2's own flow and rate on its `/build` lane, less the taker's
 * discount, into the fee wallet's account of the side the policy names — the same the swap engine's `/build` lane takes.
 * A flow whose lane is not `/build`, the policy held «as now», a discount not read, or a fee account the chain does not
 * show — no fee, never a guess and never more than the swap's own.
 */
async function sweepFeeFor(owner: string, inMint: string, outMint: string): Promise<Readonly<{ bps: number; account: string }> | null> {
  if (feePolicyInForce() !== "v2") return null;
  const flow = await flowOfSwap(inMint, outMint).catch(() => null);
  if (!flow || FEE_POLICY_V2[flow].lane !== "BUILD" || FEE_POLICY_V2[flow].bps <= 0) return null;
  const discount = await readRefereeDiscountBps(getGuardRuntime().store, owner).catch(() => null);
  if (discount === null) return null;
  const read = await buildFeeFor(flow, inMint, outMint, createSolanaRpcHandle({ network: "mainnet" }), discountedFeeBps(FEE_POLICY_V2[flow].bps, discount)).catch(() => null);
  if (!read?.ok || !read.fee) return null;
  return { bps: read.fee.bps, account: read.fee.account };
}

/** A mint's token program and scale, from its own account. */
async function mintFacts(connection: Connection, mint: string): Promise<Readonly<{ program: string; decimals: number }> | null> {
  const info = await within(connection.getAccountInfo(new PublicKey(mint), "confirmed")).catch(() => null);
  if (!info || info.data.length < 45) return null;
  const program = info.owner.toBase58();
  if (program !== TOKEN_PROGRAM_ID.toBase58() && program !== TOKEN_2022_PROGRAM_ID.toBase58()) return null;
  return { program, decimals: info.data[44]! };
}

function sweepPort(connection: Connection): ExitPorts["sweep"] {
  return async ({ owner, spec, inUsd, outUsd }) => {
    if (resolveSolanaLaneState("SWAP") !== "OPEN") return no("PAUSED");
    const endpoint = resolveJupiterSwapEndpoint({ access: "production" });
    const apiKey = endpoint.ok ? endpoint.authorizationHeaders()["x-api-key"] : null;
    if (!apiKey) return no("PAUSED");
    const config = { jupiterApiUrl: "https://api.jup.ag", jupiterApiKey: apiKey };
    const [input, output] = await Promise.all([mintFacts(connection, spec.inMint), mintFacts(connection, spec.outMint)]);
    if (!input || !output) return no("UNAVAILABLE");
    /* No price on a side, no swap: the floor has nothing to be held to. */
    if (inUsd === null || outUsd === null) return no("NO_PRICE");
    const user = new PublicKey(owner);
    /*
     * The balance the sweep counts from, read here: the wallet's own account of the coin, nothing where it has none yet.
     * The SDK reads it too and takes «nothing» for any failure — so a read that fails here is no sweep, and a figure the
     * SDK wrote that is not this one is no sweep either.
     */
    const counted = getAssociatedTokenAddressSync(new PublicKey(spec.inMint), user, true, new PublicKey(input.program));
    const before = await within(connection.getAccountInfo(counted, "confirmed")).then((info) => ({ ok: true as const, info }), () => ({ ok: false as const }));
    if (!before.ok) return no("UNAVAILABLE");
    const pre = before.info && before.info.data.length >= 72 ? Buffer.from(before.info.data.subarray(64, 72)).readBigUInt64LE(0) : 0n;
    const fee = await sweepFeeFor(owner, spec.inMint, spec.outMint);
    const queryParams: Record<string, string | number | boolean> = { slippageBps: EXIT_SWEEP_SLIPPAGE_BPS, maxAccounts: EXIT_SWEEP_MAX_ACCOUNTS };
    if (fee) Object.assign(queryParams, { platformFeeBps: fee.bps, feeAccount: fee.account });
    /* The SDK's own calls carry no time limit: a route that does not answer in time is no route. */
    const quote = await within(getJupiterQuote({ inputMint: new PublicKey(spec.inMint), outputMint: new PublicKey(spec.outMint), amount: new BN(spec.quoteRaw.toString()), user, queryParams }, config), SDK_MS).catch(() => null);
    if (!quote || !/^\d+$/.test(quote.outAmount) || !/^\d+$/.test(quote.otherAmountThreshold)) return no("NO_ROUTE");
    const outAmount = BigInt(quote.outAmount);
    const fromSlippage = floorOf(outAmount, quote.slippageBps);
    const stated = BigInt(quote.otherAmountThreshold);
    const floor = stated < fromSlippage ? stated : fromSlippage;
    if (floor <= 0n) return no("TOO_SMALL");
    /* The floor against a price of its own: within the fee, the slippage and one per cent of what the coins are worth. */
    const priced = againstReference({ inAmount: spec.quoteRaw, inDecimals: input.decimals, inUsd, floor, outDecimals: output.decimals, outUsd, feeBps: fee?.bps ?? 0, slippageBps: EXIT_SWEEP_SLIPPAGE_BPS });
    if (!priced.ok) return no(priced.code === "ZAP_UNPRICED" ? "NO_PRICE" : "REFUSED");
    /* The route's own instructions, as the build answered them: the SDK refuses a build made for any wallet but this one. */
    const route = await within(getJupiterSwapInstruction(user, quote, config), SDK_MS).catch(() => null);
    if (!route) return no("NO_ROUTE");

    const zap = new Zap(connection, config);
    const built = await within(
      zap.zapOutThroughJupiter({
        user,
        inputMint: new PublicKey(spec.inMint),
        outputMint: new PublicKey(spec.outMint),
        inputTokenProgram: new PublicKey(input.program),
        outputTokenProgram: new PublicKey(output.program),
        jupiterSwapResponse: route,
        maxSwapAmount: new BN(spec.capRaw.toString()),
        percentageToZapOut: spec.percent,
      }),
      SDK_MS,
    ).catch(() => null);
    if (!built) return no("NO_ROUTE");
    const instructions = [...built.instructions];
    if (zapOutCounts(instructions)?.pre !== pre) return no("UNAVAILABLE");
    if (spec.wrapLamports !== null) {
      /* A fixed swap of SOL: exactly these lamports wrapped into the wallet's own account, right before the swap counts it. */
      const at = instructions.findIndex((instruction) => instruction.programId.toBase58() === ZAP_PROGRAM);
      if (at < 0) return no("REFUSED");
      const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, user, true);
      instructions.splice(at, 0, SystemProgram.transfer({ fromPubkey: user, toPubkey: wsol, lamports: spec.wrapLamports }), createSyncNativeInstruction(wsol));
    }
    const latest = await within(connection.getLatestBlockhash("confirmed"));
    const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: SWEEP_UNITS }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SWEEP_UNIT_PRICE })];
    let wire: string;
    try {
      const message = new TransactionMessage({ payerKey: user, recentBlockhash: latest.blockhash, instructions: [...budget, ...instructions] }).compileToV0Message([...built.addressLookupTableAccounts]);
      const bytes = new VersionedTransaction(message).serialize();
      if (bytes.length > PACKET_BYTES) return no("NO_ROUTE");
      wire = Buffer.from(bytes).toString("base64");
    } catch {
      return no("NO_ROUTE");
    }
    if ((lookupsOf(wire)?.length ?? 99) > 8) return no("NO_ROUTE");
    /* What it is expected to bring: the quote, scaled from the least it swaps to what it is expected to swap. */
    const expectedOut = spec.quoteRaw > 0n ? (outAmount * spec.expectedRaw) / spec.quoteRaw : outAmount;
    return {
      ok: true,
      txs: [
        {
          wire,
          requestId: null,
          rule: {
            kind: "zap",
            context: {
              owner,
              pool: "",
              mintX: spec.inMint,
              mintY: spec.outMint,
              programX: input.program,
              programY: output.program,
              action: "zap_rest",
              position: null,
              fee,
              swap: { maxIn: spec.capRaw, floor },
            },
            pre,
            percent: spec.percent,
          },
        },
      ],
      chained: true,
      brings: [{ mint: spec.outMint, decimals: output.decimals, expectedRaw: expectedOut, minRaw: floor }],
      rentLamports: 0n,
      feeBps: fee?.bps ?? null,
    };
  };
}

/* ── whether Jupiter carries a coin ────────────────────────── */

/** A coin's answer is kept this long: whether Jupiter carries a coin moves slowly, and the overview is read on every visit. */
const ROUTE_KEEP_MS = 120_000;
const ROUTE_KEPT_MOST = 2_000;
/** One coin's ask waits this long, then says nothing: the overview is a read. */
const ROUTE_ASK_MS = 6_000;
const routeAnswers = new Map<string, Readonly<{ at: number; routed: boolean }>>();

/**
 * The Swap card's own read-only quote for a coin into the target (`chooseQuote`: the same lanes, the same routers, no
 * wallet, nothing built) — the same answer «Обмін» gives for that coin now. Asked only while swapping is open and the
 * site's Jupiter window has room for more than people's own requests (`jupiterBackgroundAllowed`); a clear answer is
 * kept two minutes. Nothing here changes a route, a fee or a check: it only asks.
 */
export function exitRoutable(): ExitRoutable {
  return async ({ mint, amountRaw, outMint }) => {
    const key = `${mint}:${outMint}:${amountRaw}`;
    const kept = routeAnswers.get(key);
    if (kept && Date.now() - kept.at < ROUTE_KEEP_MS) return kept.routed;
    if (resolveSolanaLaneState("SWAP") !== "OPEN" || !jupiterBackgroundAllowed()) return null;
    const selection = resolveJupiterSwapEndpoint({ access: "production" });
    if (!selection.ok) return null;
    const choice = await within(chooseQuote({ inputMint: mint, outputMint: outMint, amountRaw, selection, handle: createSolanaRpcHandle({ network: "mainnet" }), config: resolveServiceFeeConfig() }), ROUTE_ASK_MS).catch(() => null);
    const routed = !choice ? null : choice.ok ? true : choice.failure.code === "NO_ROUTE" ? false : null;
    if (routed !== null) {
      if (routeAnswers.size >= ROUTE_KEPT_MOST) routeAnswers.clear();
      routeAnswers.set(key, { at: Date.now(), routed });
    }
    return routed;
  };
}

/* ── the wiring ───────────────────────────────────────────────────────── */

export function exitPorts(env: Env = process.env, connection: Connection = cleanConnection()): ExitPorts {
  return { pool: poolPort(env), pro: proPort(env), lend: lendPort(env), stake: stakePort(connection), swap: swapPort(), sweep: sweepPort(connection) };
}

const CALL_MS = 8_000;
/** The second wave of a relay — the swaps of what arrived — is sent after the first has landed: its time is kept out of the window a person signs in. */
export const SECOND_WAVE_MS = 5_000;

/**
 * The chain for one Review or one relay. The blockhash read here is older than any the builders read after it, so the
 * window counted from it never promises more than the oldest bytes have.
 */
export function exitChain(connection: Connection = cleanConnection()): ExitChain {
  const first = within(connection.getLatestBlockhash("confirmed"), CALL_MS).catch(() => null);
  return {
    async simulate(wire) {
      const answer = await within(connection.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(wire, "base64")), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }), CALL_MS);
      return answer.value.err === null;
    },
    async tables(keys) {
      const tables = new Map<string, AddressLookupTableAccount>();
      await Promise.all(
        [...new Set(keys)].map(async (key) => {
          const answer = await within(connection.getAddressLookupTable(new PublicKey(key)), CALL_MS).catch(() => null);
          if (answer?.value) tables.set(key, answer.value);
        }),
      );
      return tables;
    },
    async send(wire, ms) {
      await within(connection.sendRawTransaction(Buffer.from(wire, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }), ms);
    },
    async status(signature, ms) {
      const status = (await within(connection.getSignatureStatuses([signature]), ms)).value[0];
      if (!status) return undefined;
      return { err: status.err ?? null, confirmed: status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" };
    },
    async lamports(owner) {
      return BigInt(await within(connection.getBalance(new PublicKey(owner), "confirmed"), CALL_MS));
    },
    async signableMs() {
      const latest = await first;
      if (!latest) return 0;
      const life = await readBlockhashLife(web3ChainReader(connection, CALL_MS), latest.lastValidBlockHeight);
      return Math.max(0, signableWindowMs(life) - SECOND_WAVE_MS - (life.state === "LIVE" ? 0 : BLOCKHASH_SUBMIT_MARGIN_MS));
    },
  };
}

/** A managed order's signed bytes to Jupiter's `/execute`, once — as the wallet clean's relay sends them. */
export async function exitExecute(signed: string, requestId: string): Promise<Readonly<{ sent: boolean; reason: string | null }>> {
  const endpoint = resolveJupiterSwapEndpoint({ access: "production" });
  if (!endpoint.ok) return { sent: false, reason: endpoint.reason };
  const venue = createJupiterSwapVenue({ endpoint, referral: null, config: resolveServiceFeeConfig() });
  const answer = await venue.execute(signed, requestId);
  /* Jupiter's «Failed» with no signature landed nothing; with one, the chain is asked. */
  if (answer.ok) return { sent: answer.report.status === "Success" || answer.report.signature !== null, reason: answer.report.status === "Failed" ? answer.report.providerError : null };
  /* The POST may have left: the chain is asked by signature, never Jupiter again. */
  return { sent: answer.possiblySubmitted, reason: answer.reason.slice(0, 200) };
}

/** After a relay: the wallet's kept portfolio and positions no longer hold. */
export function exitForget(owner: string): void {
  forgetPortfolio(owner);
  forgetWalletPositions(owner);
}
