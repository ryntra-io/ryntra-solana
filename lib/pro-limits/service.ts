/**
 * «Buy cheaper», «sell higher» on Meteora DLMM Pro, as the routes and the agent's pass use it.
 *
 * Everything a person can reach of the venue's limit orders goes through here, and nothing here is open unless the
 * lane's gate says so (`./gate.ts`):
 *
 * - **market** — the coin's pool a ladder would rest in: the deepest DLMM Pro pool of the coin against a quote coin
 *   of the network; its price, the maker's bonus as one number, how far a slider may reach, the caps;
 * - **quote** — a ladder told before anything is built (the venue's own quote);
 * - **review** — the unsigned transactions of one action with a sealed ticket (`./ticket.ts`): place a ladder, take
 *   what filled, cancel the order, or let the agent collect / take that back. Placing with the agent named opens the
 *   person's own accounts of the two coins too — a collector opens nothing;
 * - **submit** — the relay: only the bytes the Review showed, signed by its wallet; the order's fresh key signs after;
 * - **orders** — a wallet's orders with how much of each filled, read from the chain;
 * - **collect pass** — the agent's: every order a person let it collect, the filled prices of each, built to open
 *   nothing, judged byte by byte (`collector.ts`) and only then signed by the agent's key. What it collects the
 *   program pays into the holder's accounts; the key pays its network fee and nothing else.
 *
 * No key of Ryntra's signs a person's transaction; the wallet is the payer and signer of everything it is shown.
 *
 * The logic. The wiring — endpoints, the environment, the agent's key — is `./service.server.ts`.
 */

import { randomInt } from "node:crypto";

import { Keypair, PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";

import { collectorRefusal } from "../core/venues/meteora-dlmm-pro/collector.ts";
import { closedTokenAccounts } from "../core/venues/meteora-dlmm-pro/limit-orders.server.ts";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ladderReachOf, makerShareOf } from "../core/venues/meteora-dlmm-pro/ladder.ts";
import type { LadderQuote, OrderView } from "../core/venues/meteora-dlmm-pro/limit-orders.server.ts";
import type { DlmmProPool } from "../core/venues/meteora-dlmm-pro/pools.server.ts";
import { DlmmProRefusal } from "../core/venues/meteora-dlmm-pro/sdk.server.ts";
import type { DlmmProVenue } from "../core/venues/meteora-dlmm-pro/venue.server.ts";
import { BLOCKHASH_SUBMIT_MARGIN_MS } from "../solana/blockhash-life.ts";
import { base58 } from "../solana/limits/model.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { TICKET_TTL_MS, ticketKeyConfigured } from "../liquidity/studio/ticket.ts";

import { proLimitsStopped, type ProLimitsGate, type ProLimitsNetwork, type ProQuote } from "./gate.ts";
import { checkProSigned, issueProTicket, proDigest, readProTicket, type ProAction } from "./ticket.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type ProFailureCode =
  | "CAPABILITY_UNAVAILABLE"
  | "UNAVAILABLE"
  | "VALIDATION_ERROR"
  | "PRO_LIMIT_NO_MARKET"
  | "PRO_LIMIT_REFUSED"
  | "PRO_LIMIT_BALANCE_LOW"
  | "PRO_LIMIT_CAP"
  | "PRO_LIMIT_NOTHING_TO_DO"
  | "PRO_LIMIT_REVIEW_EXPIRED"
  | "PRO_LIMIT_SIGNED_OTHER_BYTES"
  | "PRO_LIMIT_SUBMIT_FAILED";
export type ProFailure = Readonly<{ ok: false; code: ProFailureCode; message: string }>;
export type ProResult<T> = Readonly<{ ok: true; value: T }> | ProFailure;

/** Signs a message's bytes with the agent's key: a raw ed25519 signature. The key itself never comes here. */
export type CollectorSigner = Readonly<{ address: string; sign(message: Uint8Array): Promise<Uint8Array> }>;

export type ProDeps = Readonly<{
  env: Env;
  gate(): ProLimitsGate;
  /** The venue on a network's endpoint; null — no endpoint is configured, or the one configured serves another network. */
  on(network: ProLimitsNetwork): Promise<Readonly<{ venue: DlmmProVenue; connection: Connection }> | null> | Readonly<{ venue: DlmmProVenue; connection: Connection }> | null;
  /** The wallet a person may let collect their orders on a network; null — nobody is offered. */
  collector(network: ProLimitsNetwork): string | null;
  /** The wallet orders placed here name as their referral; null — nobody. The venue is made with the same one. */
  referral(network: ProLimitsNetwork): string | null;
  now?: () => number;
  relayMs?: number;
  pollMs?: number;
  /** A pass collects at most this many orders, and starts on none after this many milliseconds. */
  passLimit?: number;
  passMs?: number;
  /** Where in the list of delegated orders a pass starts: a fresh place each pass, so no order is left behind for good. */
  passStart?: (count: number) => number;
}>;

const failure = (code: ProFailureCode, message: string): ProFailure => ({ ok: false, code, message });
const CLOSED = failure("CAPABILITY_UNAVAILABLE", "Ladders are not served here.");
const NO_ENDPOINT = failure("UNAVAILABLE", "Solana could not be read now. Nothing was built.");

/** A venue's refusal as the lane's answer; anything that is not one is the network's. */
function refused(error: unknown): ProFailure {
  if (!(error instanceof DlmmProRefusal)) return NO_ENDPOINT;
  switch (error.code) {
    case "BALANCE_LOW":
      return failure("PRO_LIMIT_BALANCE_LOW", error.message);
    case "NOTHING_TO_DO":
      return failure("PRO_LIMIT_NOTHING_TO_DO", error.message);
    case "NO_POOL":
      return failure("PRO_LIMIT_NO_MARKET", error.message);
    case "FAILED":
      return failure("UNAVAILABLE", error.message);
    case "BAD_INPUT":
    case "AMOUNT_ZERO":
      return failure("VALIDATION_ERROR", error.message);
    default:
      return failure("PRO_LIMIT_REFUSED", error.message);
  }
}

type Open = Readonly<{ gate: Extract<ProLimitsGate, { open: true }>; venue: DlmmProVenue; connection: Connection }>;
async function open(deps: ProDeps): Promise<Readonly<{ ok: true; value: Open }> | ProFailure> {
  const gate = deps.gate();
  if (!gate.open) return CLOSED;
  const on = await deps.on(gate.network);
  return on ? { ok: true, value: { gate, ...on } } : NO_ENDPOINT;
}

/**
 * The second transaction of an approval, where one is needed: the person's own accounts of the pool's two coins,
 * opened again after the builds before it — a build the owner signs closes its wrapped-SOL account at its end — when
 * the agent collects any of the person's ladders (`agentNow`, or another order the agent already collects). A
 * collector opens nothing, so without them it could collect none of the person's orders in that coin.
 */
async function reopen(at: Open, deps: ProDeps, input: Readonly<{ owner: string; pool: string; builds: readonly Readonly<{ wireBase64: string }>[]; agentNow: boolean; leaving?: string | null; mustOpen?: boolean }>) {
  const collector = deps.collector(at.gate.network);
  if (collector === null) return null;
  const closed = new Set(input.builds.flatMap((build) => closedTokenAccounts(build.wireBase64)));
  let needed = input.agentNow;
  /* The person's own action never waits on these reads: one that fails reads as «not needed», and the order says «paused» if it was. */
  if (!needed && closed.size > 0) needed = await agentLosesAccount(at, collector, input.owner, closed, input.leaving ?? null).catch(() => false);
  if (!needed) return null;
  /*
   * The accounts are the second transaction. Placing with the agent asks for them, so a wallet that cannot open them
   * is told before it signs (`mustOpen`). Taking and cancelling never wait on them: a wallet that cannot pay their rent
   * before the action returns it, or a node that does not answer, sends the action alone — the order then reads
   * «agent paused» with its «Resume agent». Any other refusal is the person's to see.
   */
  return at.venue.orders.prepare({ pool: input.pool, owner: input.owner, after: input.builds.map((build) => build.wireBase64) }).catch((error: unknown) => {
    if (!input.mustOpen && error instanceof DlmmProRefusal && (error.code === "BALANCE_LOW" || error.code === "FAILED")) return null;
    throw error;
  });
}

/** Whether any order the agent collects of the person's lives in a pool whose coin's account the builds close. */
async function agentLosesAccount(at: Open, collector: string, ownerAddress: string, closed: ReadonlySet<string>, leaving: string | null): Promise<boolean> {
  /* Only an order the agent collects in a pool whose coin's account is closed loses its way to pay. */
  const owner = new PublicKey(ownerAddress);
  const touched = async (pool: string) => {
    const model = await at.venue.pools.read(pool);
    return model !== null && [model.tokenX, model.tokenY].some((coin) => closed.has(getAssociatedTokenAddressSync(new PublicKey(coin.mint), owner, true, new PublicKey(coin.program === "token-2022" ? TOKEN_2022 : TOKEN)).toBase58()));
  };
  const pools = new Map<string, boolean>();
  for (const order of (await at.venue.holdings.ofWallet(ownerAddress)).orders.filter((entry) => entry.nftMint !== leaving).slice(0, REOPEN_LOOKS)) {
    if (!pools.has(order.pool)) pools.set(order.pool, await touched(order.pool));
    if (pools.get(order.pool) && (await at.venue.orders.collectorOf({ nftMint: order.nftMint, owner: ownerAddress })) === collector) return true;
  }
  return false;
}

/** The most of a person's orders a Review reads to know whether the agent collects one of them. */
const REOPEN_LOOKS = 40;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/* ------------------------------------------------------------------ market */

export type ProMarket = Readonly<{
  network: ProLimitsNetwork;
  pool: string;
  coin: Readonly<{ mint: string; decimals: number }>;
  quote: Readonly<{ mint: string; symbol: string; decimals: number }>;
  /** The coin's price in the quote coin, whole tokens — a number to show. */
  price: number;
  /** What a maker keeps of what fills, basis points, at the pool's fee now: the person's part, and Ryntra's fifth of the maker's half. */
  bonus: Readonly<{ feeBps: number; ownerBps: number; referralBps: number }>;
  /** How far a ladder may reach, basis points of the coin's price: a slider's ends. */
  reach: Readonly<{ buyBps: number; sellBps: number }>;
  /** Whether the pool takes new orders now. */
  placing: boolean;
  /** The wallet a person may let collect their orders; null — nobody is offered. */
  collector: string | null;
  /** The most one ladder may rest, in the quote coin; null — no cap. And the least one price holds where the collector is named. */
  cap: Readonly<{ maxRaw: string | null; minRungRaw: string }>;
}>;

type Found = Readonly<{ market: ProMarket; model: DlmmProPool; quote: ProQuote; coinIsX: boolean }>;
const MARKET_MS = 20_000;
const known = new Map<string, Readonly<{ at: number; found: Found | null }>>();

async function find(mint: string, at: Open, deps: ProDeps): Promise<Found | null> {
  const key = `${at.gate.network}:${mint}`;
  const now = (deps.now ?? Date.now)();
  const cached = known.get(key);
  if (cached && now - cached.at < MARKET_MS) return cached.found;
  const quotes = new Map(at.gate.quotes.map((quote) => [quote.mint, quote]));
  if (quotes.has(mint)) return null;
  const pools = await at.venue.pools.list({ mint });
  const candidates = pools.flatMap((model) => {
    const coinIsX = model.tokenX.mint === mint;
    const quote = quotes.get(coinIsX ? model.tokenY.mint : model.tokenX.mint);
    return quote ? [{ model, quote, coinIsX }] : [];
  });
  /* The deepest pool of the coin: the liquidity in range at the price. */
  candidates.sort((a, b) => (BigInt(b.model.liquidity) > BigInt(a.model.liquidity) ? 1 : BigInt(b.model.liquidity) < BigInt(a.model.liquidity) ? -1 : 0));
  const best = candidates[0];
  let found: Found | null = null;
  if (best) {
    const { model, quote, coinIsX } = best;
    const coin = coinIsX ? model.tokenX : model.tokenY;
    const other = coinIsX ? model.tokenY : model.tokenX;
    const side = coinIsX ? "x" : "y";
    const position = { tickSpacing: model.tickSpacing, tickId: model.tickId };
    const share = makerShareOf(model.fee.totalBps, deps.referral(at.gate.network) !== null);
    found = {
      model,
      quote,
      coinIsX,
      market: {
        network: at.gate.network,
        pool: model.address,
        coin: { mint: coin.mint, decimals: coin.decimals },
        quote: { mint: other.mint, symbol: quote.symbol, decimals: other.decimals },
        price: coinIsX ? model.price : model.price > 0 ? 1 / model.price : 0,
        bonus: { feeBps: model.fee.totalBps, ownerBps: share.ownerBps, referralBps: share.referralBps },
        reach: { buyBps: ladderReachOf("buy", side, position), sellBps: ladderReachOf("sell", side, position) },
        placing: model.open.addLiquidity.open && !model.paused.deposits,
        collector: deps.collector(at.gate.network),
        cap: { maxRaw: quote.maxRaw === null ? null : quote.maxRaw.toString(), minRungRaw: quote.minRungRaw.toString() },
      },
    };
  }
  known.set(key, { at: now, found });
  return found;
}

/** The pool a coin's ladder would rest in; null — the coin has no DLMM Pro pool against a quote coin of the network. */
export async function proMarket(mint: string, deps: ProDeps): Promise<ProResult<ProMarket | null>> {
  const at = await open(deps);
  if (!at.ok) return at;
  try {
    return { ok: true, value: (await find(mint, at.value, deps))?.market ?? null };
  } catch (error) {
    return refused(error);
  }
}

/** Forgets what is known of the markets — for a test, and after a relay that changed a pool. */
export function forgetProMarkets(): void {
  known.clear();
}

/* ------------------------------------------------------------------ quote */

export type ProIntent = Readonly<{ action: "buy" | "sell"; farBps: number; nearBps?: number; rungs?: number; spread?: "even" | "further"; amountRaw: string }>;

export type ProQuoteView = Readonly<{
  market: ProMarket;
  action: "buy" | "sell";
  restsIn: string;
  paysIn: string;
  /** Nearest the price first: how far, the coin's price there, what rests and what it pays filled. */
  rungs: readonly Readonly<{ awayBps: number; price: number; amountRaw: string; paysRaw: string }>[];
  amountRaw: string;
  paysRaw: string;
  averagePrice: number;
  nearBps: number;
  farBps: number;
  corridorBps: number | null;
  bonus: Readonly<{ feeBps: number; ownerBps: number; referralBps: number; referral: string | null; feeIn: string }>;
}>;

const viewOf = (market: ProMarket, told: LadderQuote): ProQuoteView => ({
  market,
  action: told.action,
  restsIn: told.restsIn,
  paysIn: told.paysIn,
  rungs: told.rungs.map(({ awayBps, price, amountRaw, paysRaw }) => ({ awayBps, price, amountRaw, paysRaw })),
  amountRaw: told.amountRaw,
  paysRaw: told.paysRaw,
  averagePrice: told.averagePrice,
  nearBps: told.nearBps,
  farBps: told.farBps,
  corridorBps: told.corridorBps,
  bonus: { feeBps: told.bonus.feeBps, ownerBps: told.bonus.ownerBps, referralBps: told.bonus.referralBps, referral: told.bonus.referral, feeIn: told.bonus.feeIn },
});

/** What a ladder rests, counted in the quote coin: what a buy spends, what a sell is paid once filled. */
const inQuote = (told: Pick<LadderQuote, "restsIn" | "amountRaw" | "paysRaw">, quoteMint: string) => BigInt(told.restsIn === quoteMint ? told.amountRaw : told.paysRaw);
/** The smallest price of a ladder, in the quote coin. */
const smallestRung = (told: Pick<LadderQuote, "restsIn" | "rungs">, quoteMint: string) => told.rungs.reduce<bigint | null>((least, rung) => {
  const value = BigInt(told.restsIn === quoteMint ? rung.amountRaw : rung.paysRaw);
  return least === null || value < least ? value : least;
}, null) ?? 0n;

/** A ladder for a coin, told before anything is built. */
export async function proQuote(input: Readonly<{ mint: string; intent: ProIntent }>, deps: ProDeps): Promise<ProResult<ProQuoteView>> {
  const at = await open(deps);
  if (!at.ok) return at;
  try {
    const found = await find(input.mint, at.value, deps);
    if (!found) return failure("PRO_LIMIT_NO_MARKET", "This coin has no pool a ladder can rest in.");
    const told = await at.value.venue.orders.quote({ pool: found.market.pool, coin: input.mint, ...input.intent });
    return { ok: true, value: viewOf(found.market, told) };
  } catch (error) {
    return refused(error);
  }
}

/* ------------------------------------------------------------------ review */

export type ProReviewInput =
  | Readonly<{ action: "place"; owner: string; mint: string; intent: ProIntent; agent: boolean }>
  | Readonly<{ action: "collect" | "close"; owner: string; pool: string; nftMint: string }>
  | Readonly<{ action: "delegate"; owner: string; pool: string; nftMint: string; agent: boolean }>;

export type ProReview = Readonly<{
  action: ProAction;
  network: ProLimitsNetwork;
  /** Unsigned, in the order they are signed and sent; the wallet signs them in one approval. */
  transactions: readonly string[];
  ticket: string;
  expiresAt: number;
  nftMint: string;
  /** What the network takes for all of it, lamports. */
  networkFeeLamports: string;
  /** Rent the order holds while it rests and returns when it is closed; negative — rent that comes back now. */
  rentLamports: string;
  /** Rent of the person's own token accounts the Review opens: it stays in those accounts, theirs. */
  accountsLamports: string;
  /** Placing: the ladder as it was built, and whether the agent may collect it. */
  quote: ProQuoteView | null;
  agent: boolean;
  /** Taking and cancelling: what reaches the wallet, per coin, after the referral's part and transfer fees; and that part. */
  receives: Readonly<{ xRaw: string; yRaw: string; x: string; y: string }> | null;
  referral: Readonly<{ mint: string; raw: string }> | null;
}>;

type Built = Readonly<{ wireBase64: string; feeLamports: number; rentLamports: number; rentReturnedLamports: number }>;

function sealed(at: Open, deps: ProDeps, head: Readonly<{ action: ProAction; owner: string; pool: string; nftMint: string }>, builds: readonly Built[], fresh: Keypair | null, rest: Pick<ProReview, "quote" | "agent" | "receives" | "referral" | "rentLamports" | "accountsLamports">): ProResult<ProReview> {
  const now = (deps.now ?? Date.now)();
  const transactions = builds.map((build) => build.wireBase64);
  const digests = transactions.map(proDigest);
  if (digests.some((digest) => digest === null)) return failure("UNAVAILABLE", "A built transaction could not be read. Nothing was built.");
  const ticket = issueProTicket({ network: at.gate.network, ...head, messages: digests as string[], cosigners: fresh ? [{ index: 0, key: fresh }] : [] }, deps.env, now);
  if (!ticket) return failure("UNAVAILABLE", "The server cannot seal a Review now.");
  return {
    ok: true,
    value: {
      action: head.action,
      network: at.gate.network,
      transactions,
      ticket,
      expiresAt: now + TICKET_TTL_MS - BLOCKHASH_SUBMIT_MARGIN_MS,
      nftMint: head.nftMint,
      networkFeeLamports: builds.reduce((sum, build) => sum + build.feeLamports, 0).toString(),
      ...rest,
    },
  };
}

/** One action's unsigned transactions and the ticket the relay holds them to. */
export async function proReview(input: ProReviewInput, deps: ProDeps): Promise<ProResult<ProReview>> {
  const at = await open(deps);
  if (!at.ok) return at;
  if (!ticketKeyConfigured(deps.env)) return failure("UNAVAILABLE", "The server cannot seal a Review now.");
  const { venue, gate } = at.value;
  const collector = deps.collector(gate.network);
  try {
    if (input.action === "place") {
      // The stop holds new money only: what rests can always be taken back and collected.
      if (proLimitsStopped(deps.env)) return failure("PRO_LIMIT_REFUSED", "New ladders are paused right now. Taking back works.");
      const found = await find(input.mint, at.value, deps);
      if (!found) return failure("PRO_LIMIT_NO_MARKET", "This coin has no pool a ladder can rest in.");
      if (!found.market.placing) return failure("PRO_LIMIT_REFUSED", "The pool takes no new orders now.");
      const fresh = Keypair.generate();
      const asked = { pool: found.market.pool, coin: input.mint, ...input.intent, wallet: input.owner, nftMint: fresh.publicKey.toBase58() };
      let agent = input.agent && collector !== null && collector !== input.owner;
      let build = await venue.orders.placeIntent({ ...asked, delegate: agent ? collector : null }).catch((error: unknown) => {
        /* The collector's two instructions did not fit beside this ladder: it is placed without, and the person may name the agent after. */
        if (agent && error instanceof DlmmProRefusal && error.code === "TX_TOO_LARGE") return null;
        throw error;
      });
      if (build === null) {
        agent = false;
        build = await venue.orders.placeIntent({ ...asked, delegate: null });
      }
      const quoteMint = found.market.quote.mint;
      if (found.quote.maxRaw !== null && inQuote(build.quote, quoteMint) > found.quote.maxRaw) return failure("PRO_LIMIT_CAP", "The ladder is above the most one ladder may rest now.");
      if (agent && smallestRung(build.quote, quoteMint) < found.quote.minRungRaw) return failure("PRO_LIMIT_CAP", "Each price of a ladder the agent collects holds more than this.");
      /* A collector opens nothing: the person's own accounts of the two coins, where missing, in the same approval — after the placing, which closes a wrapped-SOL account it used. */
      const accounts = await reopen(at.value, deps, { owner: input.owner, pool: found.market.pool, builds: [build], agentNow: agent, mustOpen: agent });
      return sealed(at.value, deps, { action: "place", owner: input.owner, pool: found.market.pool, nftMint: build.nftMint }, accounts ? [build, accounts] : [build], fresh, {
        quote: viewOf(found.market, build.quote),
        agent,
        receives: null,
        referral: null,
        rentLamports: (build.rentLamports - build.rentReturnedLamports).toString(),
        accountsLamports: (accounts ? accounts.rentLamports - accounts.rentReturnedLamports : 0).toString(),
      });
    }

    const head = { action: input.action, owner: input.owner, pool: input.pool, nftMint: input.nftMint };
    if (input.action === "delegate") {
      const to = input.agent ? collector : null;
      if (input.agent && (to === null || to === input.owner)) return failure("PRO_LIMIT_REFUSED", "No agent collects orders here.");
      /* The agent collects only orders placed here — that name Ryntra's referral — and prices worth its fee: let it in on no other. */
      if (to !== null && !(await offered(at.value, deps, input.pool, input.nftMint))) return failure("PRO_LIMIT_REFUSED", "The agent does not collect this order.");
      const build = await venue.orders.delegate({ nftMint: input.nftMint, owner: input.owner, delegate: to });
      const accounts = to ? await venue.orders.prepare({ pool: input.pool, owner: input.owner, after: [build.wireBase64] }) : null;
      return sealed(at.value, deps, head, accounts ? [build, accounts] : [build], null, {
        quote: null,
        agent: to !== null,
        receives: null,
        referral: null,
        rentLamports: "0",
        accountsLamports: (accounts ? accounts.rentLamports - accounts.rentReturnedLamports : 0).toString(),
      });
    }

    const view = await venue.orders.read({ pool: input.pool, nftMint: input.nftMint });
    const model = await venue.pools.read(input.pool);
    if (!model) return failure("PRO_LIMIT_NO_MARKET", "No pool lives at this address.");
    const live = view.ticks.filter((tick) => tick.state !== "collected");
    const filled = live.filter((tick) => tick.state === "filled");
    /* Taking what filled: where nothing would be left resting, the order is closed in the same transaction and its rent comes back. */
    const closes = input.action === "close" || filled.length === live.length;
    if (!closes && filled.length === 0) return failure("PRO_LIMIT_NOTHING_TO_DO", "Nothing of the order has filled yet.");
    const build = closes ? await venue.orders.close({ pool: input.pool, nftMint: input.nftMint, owner: input.owner }) : await venue.orders.collect({ pool: input.pool, nftMint: input.nftMint, owner: input.owner, tickIds: filled.map((tick) => tick.tickId) });
    /* Taking what filled closes the wrapped-SOL account the agent pays the person's other ladders into: opened again in the same approval. */
    const accounts = await reopen(at.value, deps, { owner: input.owner, pool: input.pool, builds: [build], agentNow: !closes && collector !== null && (await venue.orders.collectorOf({ nftMint: input.nftMint, owner: input.owner }).catch(() => null)) === collector, leaving: closes ? input.nftMint : null });
    return sealed(at.value, deps, { ...head, action: closes ? "close" : "collect" }, accounts ? [build, accounts] : [build], null, {
      quote: null,
      agent: false,
      receives: { xRaw: build.expected.xRaw, yRaw: build.expected.yRaw, x: model.tokenX.mint, y: model.tokenY.mint },
      referral: build.referral ? { mint: build.referral.mint, raw: build.referral.raw } : null,
      rentLamports: (build.rentLamports - build.rentReturnedLamports).toString(),
      accountsLamports: (accounts ? accounts.rentLamports - accounts.rentReturnedLamports : 0).toString(),
    });
  } catch (error) {
    return refused(error);
  }
}

/* ------------------------------------------------------------------ relay */

export type ProRelayState = "LANDED" | "FAILED" | "UNKNOWN" | "NOT_SENT";
export type ProRelay = Readonly<{ action: ProAction; nftMint: string; results: readonly Readonly<{ signature: string; state: ProRelayState }>[]; settled: boolean }>;

const RELAY_MS = 40_000;
const CALL_MS = 8_000;
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), Math.max(1, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
/** An error for the server's log: no address of an endpoint, which may carry its key. */
const redacted = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/[^\s"')]+/g, "<endpoint>").slice(0, 200);

async function landed(connection: Connection, signature: string, deadline: number, pollMs: number): Promise<"LANDED" | "FAILED" | "UNKNOWN"> {
  while (Date.now() < deadline) {
    const status = await within(connection.getSignatureStatuses([signature]), Math.min(CALL_MS, Math.max(1, deadline - Date.now()))).then((answer) => answer.value[0]).catch(() => undefined);
    if (status?.err) return "FAILED";
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return "LANDED";
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return "UNKNOWN";
}

/** Sends one signed transaction and waits for the chain's word on it. A refusal before sending is `FAILED`: nothing moved. */
async function send(connection: Connection, wireBase64: string, signature: string, deadline: number, pollMs: number): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; refusedBefore: string | null }>> {
  try {
    await within(connection.sendRawTransaction(Buffer.from(wireBase64, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }), Math.min(CALL_MS, Math.max(1, deadline - Date.now())));
  } catch (error) {
    const message = redacted(error);
    if (/simulation failed|preflight|blockhash not found/i.test(message) && !/already been processed|AlreadyProcessed/i.test(message)) return { state: "FAILED", refusedBefore: message };
  }
  return { state: await landed(connection, signature, deadline, pollMs), refusedBefore: null };
}

/** The relay: the ticket's bytes, signed by its wallet, sent in order. */
export async function proSubmit(input: Readonly<{ ticket: unknown; signed: readonly unknown[] }>, deps: ProDeps): Promise<ProResult<ProRelay>> {
  const at = await open(deps);
  if (!at.ok) return at;
  const read = readProTicket(input.ticket, deps.env, (deps.now ?? Date.now)());
  if (!read.ok) return read.code === "TICKET_EXPIRED" ? failure("PRO_LIMIT_REVIEW_EXPIRED", "The Review is older than its transactions; review again.") : failure("VALIDATION_ERROR", "The Review's ticket is not one this server sealed.");
  const { ticket } = read;
  if (ticket.network !== at.value.gate.network) return failure("VALIDATION_ERROR", "The Review was made for another network.");
  const checked = checkProSigned(ticket, input.signed, deps.env);
  if (!checked.ok) return checked.code === "TICKET_INVALID" ? failure("VALIDATION_ERROR", "The Review's ticket is not one this server sealed.") : failure("PRO_LIMIT_SIGNED_OTHER_BYTES", checked.code === "NOT_SIGNED" ? "A signature is missing or does not match." : "The signed bytes are not the ones Review showed.");
  const { connection } = at.value;
  const deadline = Date.now() + (deps.relayMs ?? RELAY_MS);
  const results: { signature: string; state: ProRelayState }[] = checked.signatures.map((signature) => ({ signature, state: "NOT_SENT" }));
  for (const [index, wire] of checked.wires.entries()) {
    if (Date.now() >= deadline) break;
    const sent = await send(connection, wire, results[index]!.signature, deadline, deps.pollMs ?? 1_500);
    results[index]!.state = sent.state;
    if (sent.refusedBefore !== null && index === 0) {
      console.warn(`pro-limits relay: ${ticket.action} refused before sending — ${sent.refusedBefore}`);
      return /blockhash not found/i.test(sent.refusedBefore) ? failure("PRO_LIMIT_REVIEW_EXPIRED", "The Review is older than its transactions; review again.") : failure("PRO_LIMIT_SUBMIT_FAILED", "The network refused the transaction before it was sent. Nothing moved.");
    }
    if (sent.state !== "LANDED") break;
  }
  forgetProMarkets();
  console.info(`pro-limits relay: ${ticket.network} ${ticket.action} ${results.map((result) => `${result.signature.slice(0, 8)}=${result.state}`).join(" ")}`);
  return { ok: true, value: { action: ticket.action, nftMint: ticket.nftMint, results, settled: results.every((result) => result.state === "LANDED") } };
}

/* ------------------------------------------------------------------ orders */

export type ProOrderState = "resting" | "filling" | "filled" | "taken";
export type ProOrder = Readonly<{
  nftMint: string;
  pool: string;
  coin: Readonly<{ mint: string; decimals: number }>;
  quote: Readonly<{ mint: string; decimals: number }>;
  /** What the person is doing with the coin; null once every price was taken — the order only holds its rent. */
  action: "buy" | "sell" | null;
  /** Resting — nothing filled; filling — some; filled — every price left; taken — everything collected, only the rent is left to take back. */
  state: ProOrderState;
  prices: number;
  filledPrices: number;
  restsIn: string | null;
  paysIn: string | null;
  /** Of what is left in the order: what rests, how much of it filled, and what the filled part pays. */
  restsRaw: string;
  filledRaw: string;
  proceedsRaw: string;
  /** The lowest and the highest price left in the order, and the price of what filled, of the coin in the quote coin — numbers to show. */
  lowPrice: number | null;
  highPrice: number | null;
  filledPrice: number | null;
  /** The maker's bonus waiting, in its coin: the person's part and the referral's. */
  bonus: Readonly<{ mint: string | null; ownerRaw: string; referralRaw: string }>;
  /** Whether the agent is let in on it; `agentReady` — and the person's accounts of both coins stand, so it can collect; `agentOffered` — the agent would collect it at all (placed here, prices worth its fee). */
  agent: boolean;
  agentReady: boolean;
  agentOffered: boolean;
  /** Prices of what is left that filled in part: with any, the price of what filled is a blend. */
  partialPrices: number;
}>;

const ORDERS_SHOWN = 12;

/** Whether the agent would collect an order: it names Ryntra's referral, and each price left is worth at least the least one price holds. */
async function offered(at: Open, deps: ProDeps, pool: string, nftMint: string, known?: OrderView): Promise<boolean> {
  const referral = deps.referral(at.gate.network);
  const view = known ?? (await at.venue.orders.read({ pool, nftMint }));
  if (referral === null || view.referral !== referral) return false;
  const quote = view.restsIn && view.paysIn ? (at.gate.quotes.find((entry) => entry.mint === view.restsIn || entry.mint === view.paysIn) ?? null) : null;
  if (quote === null) return false;
  const live = view.ticks.filter((tick) => tick.state !== "collected");
  /* A price is worth what it rests, or what it pays once filled — whichever is in the quote coin; a tick's price is 1.0001^tick, token Y atoms per token X atom. A threshold, so a number is enough. */
  const worth = (tick: OrderView["ticks"][number]) => {
    if (view.restsIn === quote.mint) return Number(tick.amountRaw);
    const ratio = Math.pow(1.0001, tick.tickId);
    return view.side === "ask" ? Number(tick.amountRaw) * ratio : Number(tick.amountRaw) / ratio;
  };
  return live.length > 0 && live.every((tick) => worth(tick) >= Number(quote.minRungRaw));
}

function orderOf(view: OrderView, model: DlmmProPool, quoteMint: string, agentState: Readonly<{ agent: boolean; agentReady: boolean; agentOffered: boolean }>): ProOrder {
  const coinIsX = model.tokenY.mint === quoteMint;
  const coin = coinIsX ? model.tokenX : model.tokenY;
  const quote = coinIsX ? model.tokenY : model.tokenX;
  const live = view.ticks.filter((tick) => tick.state !== "collected");
  const filledTicks = live.filter((tick) => tick.state === "filled").length;
  const anyFilled = live.some((tick) => tick.state !== "resting");
  /* A tick's price, token Y per token X in whole tokens, as the coin's price in the quote coin. */
  const priceAt = (tickId: number) => {
    const pool = Math.pow(1.0001, tickId) * 10 ** (model.tokenX.decimals - model.tokenY.decimals);
    return coinIsX ? pool : 1 / pool;
  };
  const prices = live.map((tick) => priceAt(tick.tickId));
  /* An ask sells token X: with the coin as X the person sells it, with the coin as Y they buy it. */
  const action = view.side === null ? null : (view.side === "ask") === coinIsX ? "sell" : "buy";
  const filled = BigInt(view.filledRaw);
  const proceeds = BigInt(view.proceedsRaw);
  const restsDecimals = view.side === "ask" ? model.tokenX.decimals : model.tokenY.decimals;
  const paysDecimals = view.side === "ask" ? model.tokenY.decimals : model.tokenX.decimals;
  /* The price of what filled: the quote coin per coin — what was paid over what was sold for a sell, the other way for a buy. */
  const coinRests = action === "sell";
  const filledPrice = filled === 0n || proceeds === 0n ? null : coinRests ? Number(proceeds) / 10 ** paysDecimals / (Number(filled) / 10 ** restsDecimals) : Number(filled) / 10 ** restsDecimals / (Number(proceeds) / 10 ** paysDecimals);
  return {
    nftMint: view.nftMint,
    pool: view.pool,
    coin: { mint: coin.mint, decimals: coin.decimals },
    quote: { mint: quote.mint, decimals: quote.decimals },
    action,
    state: live.length === 0 ? "taken" : filledTicks === live.length ? "filled" : anyFilled ? "filling" : "resting",
    prices: live.length,
    filledPrices: filledTicks,
    restsIn: view.restsIn,
    paysIn: view.paysIn,
    restsRaw: view.amountRaw,
    filledRaw: view.filledRaw,
    proceedsRaw: view.proceedsRaw,
    lowPrice: prices.length ? Math.min(...prices) : null,
    highPrice: prices.length ? Math.max(...prices) : null,
    filledPrice,
    bonus: { mint: view.bonus.mint, ownerRaw: view.bonus.ownerRaw, referralRaw: view.bonus.referralRaw },
    ...agentState,
    partialPrices: live.filter((tick) => tick.state === "partial").length,
  };
}

/** A wallet's ladders — of one coin, or all of them — with how much of each filled. */
export async function proOrders(input: Readonly<{ owner: string; mint?: string | null }>, deps: ProDeps): Promise<ProResult<readonly ProOrder[]>> {
  const at = await open(deps);
  if (!at.ok) return at;
  const { venue, gate } = at.value;
  try {
    const held = (await venue.holdings.ofWallet(input.owner)).orders;
    const quotes = new Set(gate.quotes.map((quote) => quote.mint));
    const collector = deps.collector(gate.network);
    const models = new Map<string, DlmmProPool | null>();
    const orders: ProOrder[] = [];
    for (const order of held) {
      if (orders.length >= ORDERS_SHOWN) break;
      if (!models.has(order.pool)) models.set(order.pool, await venue.pools.read(order.pool));
      const model = models.get(order.pool);
      if (!model) continue;
      const quoteMint = quotes.has(model.tokenY.mint) ? model.tokenY.mint : quotes.has(model.tokenX.mint) ? model.tokenX.mint : null;
      if (quoteMint === null) continue;
      const coinMint = quoteMint === model.tokenY.mint ? model.tokenX.mint : model.tokenY.mint;
      if (input.mint && coinMint !== input.mint) continue;
      const [view, lets] = await Promise.all([venue.orders.read({ pool: order.pool, nftMint: order.nftMint }), collector ? venue.orders.collectorOf({ nftMint: order.nftMint, owner: input.owner }) : null]);
      /* «The agent collects» only where it can: let in, and the person's accounts of both coins standing to be paid into. */
      const agent = collector !== null && lets === collector;
      const agentReady = agent && (await venue.orders.accountsReady({ pool: order.pool, owner: input.owner }));
      const agentOffered = collector !== null && (await offered(at.value, deps, order.pool, order.nftMint, view));
      orders.push(orderOf(view, model, quoteMint, { agent, agentReady, agentOffered }));
    }
    return { ok: true, value: orders };
  } catch (error) {
    return refused(error);
  }
}

/* ------------------------------------------------------------------ the agent's pass */

/** `sent` — signed and sent, the chain's word not in yet: it may have landed; the next pass reads the order again. */
export type PassLine = Readonly<{ order: string; did: "collected" | "sent" | "nothing" | "skipped" | "failed"; why: string | null; signature: string | null }>;

const PASS_LIMIT = 10;
/** A pass starts on no order after this long, and waits for the chain no more than `PASS_TAIL_MS` past it: the route's own limit is a minute. */
const PASS_MS = 30_000;
const PASS_TAIL_MS = 15_000;

/**
 * One pass of the collector: every order a person let it collect, that names Ryntra's referral, with a price filled
 * whole — collected for its holder. Each build opens nothing, is judged byte by byte against facts read from the chain
 * apart from it, and only then signed. An order the pass cannot collect — the holder's account is missing, the judge
 * says no, the network refuses — is told and left: the holder can always take it themselves.
 */
export async function proCollectPass(deps: ProDeps, signer: CollectorSigner | null): Promise<ProResult<readonly PassLine[]>> {
  const at = await open(deps);
  if (!at.ok) return at;
  const { venue, connection, gate } = at.value;
  const collector = deps.collector(gate.network);
  if (!signer || collector === null || signer.address !== collector) return failure("UNAVAILABLE", "The collector's key is not the one this network names.");
  let listed: readonly Readonly<{ nftMint: string; pool: string }>[];
  try {
    listed = await venue.holdings.delegatedOrders({ referral: deps.referral(gate.network) });
  } catch (error) {
    return refused(error);
  }
  /* Every delegated order, from a fresh place each pass: no order outside a fixed window is left behind for good, and nobody can hold the pass on orders of their own. */
  const start = listed.length ? Math.abs(Math.trunc((deps.passStart ?? ((count) => randomInt(count)))(listed.length))) % listed.length : 0;
  const queue = [...listed.slice(start), ...listed.slice(0, start)];
  const deadline = Date.now() + (deps.passMs ?? PASS_MS);
  const quotes = new Map(gate.quotes.map((quote) => [quote.mint, quote]));
  const lines: PassLine[] = [];
  let collected = 0;
  for (const order of queue) {
    if (collected >= (deps.passLimit ?? PASS_LIMIT) || Date.now() >= deadline) break;
    const line = (did: PassLine["did"], why: string | null = null, signature: string | null = null) => lines.push({ order: order.nftMint, did, why, signature });
    try {
      const view = await venue.orders.read({ pool: order.pool, nftMint: order.nftMint });
      const filledTicks = view.ticks.filter((tick) => tick.state === "filled");
      const quote = view.restsIn && view.paysIn ? (quotes.get(view.restsIn) ?? quotes.get(view.paysIn) ?? null) : null;
      /* What filled, counted in the quote coin: a fill too small to be worth the collector's fee is left for the person. */
      const worth = quote ? filledTicks.reduce((sum, tick) => sum + BigInt(view.restsIn === quote.mint ? tick.amountRaw : tick.proceedsRaw), 0n) : 0n;
      if (filledTicks.length === 0 || quote === null || worth < quote.minRungRaw) {
        line("nothing");
        continue;
      }
      const owner = await venue.holdings.holderFor(order.nftMint, collector);
      if (owner === null) {
        line("nothing");
        continue;
      }
      const filled = filledTicks.map((tick) => tick.tickId);
      const facts = await venue.orders.collectorFacts({ pool: order.pool, nftMint: order.nftMint, owner, collector });
      const build = await venue.orders.collect({ pool: order.pool, nftMint: order.nftMint, owner, signer: collector, tickIds: filled, opensNothing: true });
      const refusal = collectorRefusal(build.wireBase64, facts);
      if (refusal !== null) {
        line("skipped", refusal);
        continue;
      }
      /* Too late to wait for the chain inside the route: signed now, it could land after the pass said it failed. Left for the next pass. */
      if (Date.now() >= deadline + PASS_TAIL_MS - CALL_MS) {
        line("skipped", "Out of time for this pass.");
        break;
      }
      const transaction = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64"));
      const message = transaction.message.serialize();
      const signature = await signer.sign(message);
      if (!ed25519Valid(message, signature, new PublicKey(collector))) {
        line("failed", "The key's signature is not the collector's.");
        continue;
      }
      transaction.addSignature(new PublicKey(collector), signature);
      const id = base58(signature);
      /* A send waits for the chain no later than the pass's own end and a little more: the route's limit is a minute. */
      const sent = await send(connection, Buffer.from(transaction.serialize()).toString("base64"), id, Math.min(Date.now() + (deps.relayMs ?? RELAY_MS), deadline + PASS_TAIL_MS), deps.pollMs ?? 1_500);
      if (sent.state === "LANDED") {
        collected += 1;
        line("collected", null, id);
      } else if (sent.state === "UNKNOWN") line("sent", "The chain has not confirmed it yet.", id);
      else line("failed", sent.refusedBefore ?? "The chain refused the collect.", sent.refusedBefore === null ? id : null);
    } catch (error) {
      line("skipped", error instanceof DlmmProRefusal ? error.message : redacted(error));
    }
  }
  console.info(`pro-limits pass: ${gate.network} ${lines.map((entry) => `${entry.order.slice(0, 6)}=${entry.did}`).join(" ") || "nothing delegated"}`);
  return { ok: true, value: lines };
}
