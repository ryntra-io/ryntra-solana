/**
 * CITY-187 — the person sells what her agent bought, from the tower's window. Three steps, each its own route. On devnet
 * through the gate's DLMM pool; with CITY-195 on mainnet through Jupiter's `/build` (`./jupiter.server.ts`
 * `jupiterSaleVenue`) by the very rules of the agent's buys: SOL only to her own account, «the money did not reach you, so
 * the trade does not happen», Ryntra's fee at the table's rate for the pair (CITY-183) — in the SOL she receives — and her
 * floor held on chain. Her next signature tidies up after a sale (`./tidy.ts`): sold sales' mandates removed, their rent
 * back to her.
 *
 *
 * 1. **Review** (`reviewSale`) — the share she picked of what the agent holds for her (`./sale.ts`), Ryntra's fee at the
 *    table's rate for the pair, the pool's quote and her floor; her one unsigned transaction: the coin into her own
 *    vault under a sale's mandate of CITY-184 (`./terms.ts` `budgetCoin`) — exactly that much, once, for at least her
 *    floor in SOL, to her wallet, within a day. The sale waits in the agent's book until she signs.
 * 2. **Go** (`goSale`) — once the chain has her mandate, the agent sells straight away: the pool's swap for the vault,
 *    Ryntra's fee the transfer just before it, judged and signed by the agent's own signer (`./signer.server.ts`), sent and
 *    read back (`./run.server.ts`). The cron's pass finishes what a request could not (`runSalePass`).
 * 3. **Back** (`reviewSaleBack`) — a sale that did not go: her one signature takes the coin back and closes the mandate.
 *
 * The book keeps each sale beside the mandate whose coin it sells, under its own key (`s:<cluster>:<policy>`), so the
 * buys' pass never reads one and a sale never overwrites a buy. Public data only; this file holds no key and reads no
 * environment.
 */

import { Connection, PublicKey, VersionedTransaction, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";
import type DLMMClass from "@meteora-ag/dlmm";

import type { GuardStore } from "../guard/store.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { resolveJupiterSwapEndpoint } from "../solana/quotes.ts";
import { AGENT_BOOK, claimKey, readEntry, type OpenGate } from "./book.server.ts";
import { dlmmBuy, dlmmWorth } from "./dlmm.server.ts";
import { agentFeeAccount, agentFeeRaw, feeAccountRefusal, feeTransferInstruction, pairFeeBps, policyCarriesFee, uncataloguedFacts, type FeeSides } from "./fee.ts";
import { planEnable, planStop, planWithdraw, tokenAccountOf, unsignedTransaction, type Mandate } from "./human.ts";
import { jupiterSaleVenue, type JupiterSaleVenue } from "./jupiter.server.ts";
import { heldIn, tradeTerms } from "./result.ts";
import { agentTrade, policyOf, type TradeOutcome } from "./run.server.ts";
import { SALE_REVIEW_MS, SALE_SECONDS, SALE_SLIPPAGE_BPS, agentHolding, countsAsSold, jupiterSaleFloor, saleAmount, saleFloor, type SaleShare, type SaleStatus } from "./sale.ts";
import { mandateSigner, type AgentJournal } from "./signer.server.ts";
import { storeScreen, type AgentScreen } from "./ryntra-coins.server.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyHead, readSettings, ssaAddress } from "./ssa.ts";
import { onNetwork, recordOf, type MandateNetwork, type MandateRecord, type StopTidy } from "./service.server.ts";
import type { AgentTrade } from "./strategy.ts";
import { LAYOUT, feeMintOf, jupiterQuoteFloor } from "./terms.ts";
import { NO_TIDY, withTidy, type EmptyAccount, type Tidy } from "./tidy.ts";
import { EXTENSION, TOKEN_2022_PROGRAM_ID, afterTransferFee, isTokenProgram, mintExtensions, readCoin } from "./token-2022.ts";
import { receivedIn, settled, tradeOf } from "./tick.server.ts";

/** The agent sells on the gate's network: devnet through its pool (CITY-187), mainnet through Jupiter (CITY-195). */
export type SaleGate = OpenGate;

/** A sale as the agent's book keeps it: public addresses and numbers. */
export type SaleRow = Readonly<{
  v: 1;
  kind: "sale";
  cluster: MandateNetwork;
  /** The buying mandate whose coin this sells. */
  parent: string;
  /** The sale's own mandate: its policy, the vault's account of the coin; `perTrade` and `perDay` — the amount. */
  record: MandateRecord;
  coin: string;
  decimals: number;
  /** The coin's token program when it is not Token's (a coin of Token-2022 sold through Jupiter); absent — Token's. */
  program?: string;
  /** The coin withholds a fee on transfers (CITY-184): the vault holds less than left her wallet. */
  transferFee?: boolean;
  share: SaleShare;
  /** The coin that left her wallet for the sale. */
  amountRaw: string;
  /** What the agent sells of it: less than `amountRaw` by the coin's transfer fee; absent — the same. */
  sellRaw?: string;
  /** The least SOL that reaches her, lamports — held on chain. */
  floorRaw: string;
  /** The venue's quote at the review, after Ryntra's fee, lamports. */
  quoteRaw: string;
  feeBps: number;
  /** Ryntra's fee: base units of the coin on devnet's pool; lamports of the SOL she receives through Jupiter. */
  feeRaw: string;
  status: SaleStatus;
  trade: AgentTrade | null;
  createdAt: number;
  updatedAt: number;
}>;

type Claim = Readonly<{ claimedAt: number }>;

export const saleKey = (cluster: string, policy: string) => `s:${cluster}:${policy}`;

const salesOf = (store: GuardStore) => store.collection<SaleRow | Claim>(AGENT_BOOK);
const isSale = (row: SaleRow | Claim | undefined | null): row is SaleRow => Boolean(row && "kind" in row && row.kind === "sale" && row.v === 1);

export async function readSale(store: GuardStore, policy: string, cluster = "devnet"): Promise<SaleRow | null> {
  const row = await salesOf(store).get(saleKey(cluster, policy));
  return isSale(row) ? row : null;
}

export async function writeSale(store: GuardStore, row: SaleRow): Promise<void> {
  await salesOf(store).set(saleKey(row.cluster, row.record.policy), row);
}

/** Every sale on this network; of one buying mandate when `parent` is named. */
export async function readSales(store: GuardStore, parent?: string, cluster = "devnet"): Promise<readonly SaleRow[]> {
  const rows = await salesOf(store).valuesWithPrefix(`s:${cluster}:`);
  return rows.filter(isSale).filter((row) => parent === undefined || row.parent === parent);
}

/** The coin her sales through this mandate took out of what the agent holds, and the SOL they brought her. */
export function salesTotals(sales: readonly SaleRow[]): Readonly<{ soldRaw: bigint; gotRaw: bigint }> {
  let soldRaw = 0n;
  let gotRaw = 0n;
  for (const sale of sales) {
    if (countsAsSold(sale.status)) soldRaw += BigInt(sale.amountRaw);
    if (sale.status === "sold" && sale.trade?.receivedRaw) gotRaw += BigInt(sale.trade.receivedRaw);
  }
  return { soldRaw, gotRaw };
}

/** What the agent bought for the mandate: the coin that reached her from its trades. */
export const boughtOf = (trades: readonly AgentTrade[]): bigint => trades.reduce((sum, trade) => sum + (trade.status === "ok" ? BigInt(trade.receivedRaw ?? "0") : 0n), 0n);

/** What the agent sells under the sale's mandate. */
export const sellOf = (row: SaleRow): bigint => BigInt(row.sellRaw ?? row.amountRaw);
const programOf = (row: SaleRow): PublicKey => (row.program ? new PublicKey(row.program) : TOKEN_PROGRAM_ID);

/** The sale's mandate, as the agent's signer and the chain read it: devnet's pool, or Jupiter on mainnet. */
export function saleMandate(row: SaleRow, gate: SaleGate): Mandate {
  const r = row.record;
  const amount = sellOf(row);
  return {
    cluster: row.cluster,
    terms: {
      human: new PublicKey(r.owner),
      agent: gate.agent,
      budgetMint: new PublicKey(row.coin),
      perTrade: amount,
      perDay: amount,
      slippageBps: SALE_SLIPPAGE_BPS,
      expiresAt: BigInt(r.expiresAt),
      venue: gate.network === "mainnet" ? { kind: "jupiter" } : { kind: "dlmm", pool: gate.pool },
      fixedBuy: { amountIn: amount, outputMint: NATIVE_MINT, minOut: BigInt(row.floorRaw) },
      budgetCoin: { program: programOf(row), decimals: row.decimals, transferFee: Boolean(row.transferFee) },
    },
    settings: new PublicKey(r.settings),
    vault: new PublicKey(r.vault),
    policy: new PublicKey(r.policy),
    policySeed: 0n,
    budgetAccount: new PublicKey(r.budget),
  };
}

/* ------------------------------------------------------------------ the pool */

/** Devnet's venue of a sale: the gate's pool. */
export type DlmmSaleVenue = Readonly<{
  kind?: "dlmm";
  /** SOL for exactly `amount` of the coin at the pool's price now, lamports; throws when not read. */
  quote(coin: PublicKey, amount: bigint): Promise<bigint>;
  /** The pool's swap of `amount` of the vault's coin, at least `minOut` of SOL to `receiver` — built, not sent. */
  sell(mandate: Mandate, amount: bigint, receiver: PublicKey, minOut: bigint): Promise<Readonly<{ instruction: TransactionInstruction; quoteOut: bigint }>>;
  /** What landed on `receiver` in that transaction; null when not read. */
  received(signature: string, receiver: PublicKey): Promise<bigint | null>;
}>;

/** Where a sale goes: devnet's pool, or Jupiter on mainnet. */
export type SaleVenue = DlmmSaleVenue | JupiterSaleVenue;

const onJupiter = (venue: SaleVenue): venue is JupiterSaleVenue => venue.kind === "jupiter";

/** The devnet venue of a sale: the gate's DLMM pool, the coin in, SOL straight to her wallet. */
export function dlmmSaleVenue(connection: Connection, gate: Extract<SaleGate, { network: "devnet" }>, dependencies: Readonly<{ DLMM?: typeof DLMMClass }> = {}): DlmmSaleVenue {
  return {
    kind: "dlmm",
    quote: (_coin, amount) => dlmmWorth(connection, { pool: gate.pool, budgetMint: NATIVE_MINT, amount }, dependencies),
    async sell(mandate, amount, receiver, minOut) {
      const built = await dlmmBuy(
        connection,
        { pool: gate.pool, budgetMint: mandate.terms.budgetMint, vault: mandate.vault, budgetAccount: mandate.budgetAccount, receiver, amount, slippageBps: mandate.terms.slippageBps, minOut },
        dependencies,
      );
      /* The pool's own minimum: her floor, or the quote less the slippage when the price rose — what the signer asks. */
      const least = saleFloor(built.quoteOut, mandate.terms.slippageBps);
      if (least > minOut) Buffer.from(built.instruction.data.buffer, built.instruction.data.byteOffset, built.instruction.data.byteLength).writeBigUInt64LE(least, LAYOUT.dlmmSwap2.minOut);
      return { instruction: built.instruction, quoteOut: built.quoteOut };
    },
    received: (signature, receiver) => receivedIn(connection, signature, receiver),
  };
}

/** The gate's venue of a sale: devnet's pool, or Jupiter's `/build` on mainnet. */
export const saleVenueOf = (connection: Connection, gate: SaleGate): SaleVenue => (gate.network === "mainnet" ? jupiterSaleVenue(connection, resolveJupiterSwapEndpoint()) : dlmmSaleVenue(connection, gate));

/* ------------------------------------------------------------------ 1. review */

export type SaleFigures = Readonly<{
  coin: string;
  decimals: number;
  /** What the agent holds for her of the coin now. */
  heldRaw: string;
  amountRaw: string;
  /** The pool's quote for the coin after Ryntra's fee, lamports. */
  quoteRaw: string;
  floorRaw: string;
  feeBps: number;
  feeRaw: string;
  /** Ryntra's fee as SOL at the pool's price, lamports — what the window says it costs. */
  feeSolRaw: string;
}>;

export type SaleReview =
  | Readonly<{ ok: true; record: MandateRecord; transactions: readonly string[]; figures: SaleFigures }>
  | Readonly<{ ok: false; code: string; reason: string }>;

type SaleDeps = Readonly<{ store: GuardStore; connection: Connection; venue?: SaleVenue; now?: () => number }>;

const refused = (code: string, reason: string) => ({ ok: false as const, code, reason });
const toBase64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");
const notOn = (network: MandateNetwork) => refused(network === "devnet" ? "NOT_DEVNET" : "NOT_MAINNET", `The endpoint is not ${network}.`);

/** The sale's numbers at the price now: what the agent sells, Ryntra's fee, the quote after it and her floor. */
type Priced = Readonly<{ sell: bigint; feeBps: number; fee: bigint; quote: bigint; floor: bigint; feeSol: bigint }>;

/**
 * Devnet's pool: Ryntra's fee is the table's share of the coin, sent before the swap; the pool's quote of the rest, less the
 * slippage, is her floor.
 */
async function priceOnPool(venue: DlmmSaleVenue, coin: PublicKey, amount: bigint, sides: FeeSides): Promise<Priced | Readonly<{ ok: false; code: string; reason: string }>> {
  const feeBps = pairFeeBps(coin.toBase58(), NATIVE_MINT.toBase58(), sides);
  if (feeBps === null) return refused("REFUSED", "Ryntra's table names no router fee for this pair.");
  const fee = agentFeeRaw(amount, feeBps);
  if (fee <= 0n) return refused("TOO_SMALL", "Too little to sell.");
  let quote: bigint;
  let gross: bigint;
  try {
    [quote, gross] = await Promise.all([venue.quote(coin, amount - fee), venue.quote(coin, amount)]);
  } catch {
    return refused("UNAVAILABLE", "The devnet pool is not readable.");
  }
  return { sell: amount, feeBps, fee, quote, floor: saleFloor(quote), feeSol: gross > quote ? gross - quote : 0n };
}

/**
 * Jupiter: the coin is sold whole and Ryntra's fee is the table's share of the SOL out, inside the route — as Jupiter's
 * program takes it, so the window says to the lamport what the route will. Her floor leaves the price room to move
 * (`jupiterSaleFloor`): the route's own quote is held on chain to at least her floor plus the slippage.
 */
async function priceOnJupiter(venue: JupiterSaleVenue, coin: PublicKey, sell: bigint, sides: FeeSides): Promise<Priced | Readonly<{ ok: false; code: string; reason: string }>> {
  const feeBps = pairFeeBps(coin.toBase58(), NATIVE_MINT.toBase58(), sides);
  if (feeBps === null) return refused("REFUSED", "Ryntra's table names no router fee for this pair.");
  let gross: bigint;
  try {
    gross = await venue.quote(coin, sell);
  } catch {
    return refused("UNAVAILABLE", "Jupiter did not quote this coin.");
  }
  const fee = agentFeeRaw(gross, feeBps);
  if (fee <= 0n) return refused("TOO_SMALL", "Too little to sell.");
  const quote = gross - fee;
  return { sell, feeBps, fee, quote, floor: jupiterSaleFloor(quote), feeSol: fee };
}

/**
 * Sell a share of what the agent bought for her: the figures and her one unsigned transaction. The sale waits in the
 * book under its policy until she signs; a review she lets go is overwritten by the next one at the same address. The same
 * transaction removes the mandates of her sales already sold — their rent back to her, no signature more (`./tidy.ts`).
 */
export async function reviewSale(input: Readonly<{ owner: string; policy: string; share: SaleShare }>, gate: SaleGate, deps: SaleDeps): Promise<SaleReview> {
  const { connection, store } = deps;
  const network = gate.network;
  if (!(await onNetwork(connection, network))) return notOn(network);
  const entry = await readEntry(store, input.policy, network);
  if (!entry || entry.record.owner !== input.owner) return refused("NOT_IN_BOOK", "The agent does not work for this mandate.");
  const owner = new PublicKey(input.owner);
  const coin = new PublicKey(entry.receiveMint);
  const coinInfo = await connection.getAccountInfo(coin, "confirmed");
  /* A coin of Token-2022 that withholds a fee on transfers: the vault gets what is left of it, at the epoch's rate. */
  const epoch = coinInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? BigInt((await connection.getEpochInfo("confirmed")).epoch) : undefined;
  const reading = readCoin(coin, coinInfo, epoch);
  if (!reading.ok) return refused("REFUSED", `The agent does not sell this coin: ${reading.reason}.`);
  const decimals = reading.coin.decimals;
  const program = reading.coin.program;
  const venue = deps.venue ?? saleVenueOf(connection, gate);
  if (onJupiter(venue) !== (network === "mainnet")) return refused("UNAVAILABLE", "The sale's venue is not this network's.");
  if (!onJupiter(venue) && !program.equals(TOKEN_PROGRAM_ID)) return refused("REFUSED", "On devnet's pool the agent sells coins of Token only.");

  const wallet = await connection.getTokenAccountBalance(tokenAccountOf(owner, coin, program), "confirmed").then(
    (balance) => BigInt(balance.value.amount),
    () => 0n,
  );
  const sales = await readSales(store, input.policy, network);
  const { soldRaw } = salesTotals(sales);
  const held = agentHolding(boughtOf(entry.trades), soldRaw, wallet);
  const amount = saleAmount(held, input.share);
  if (amount <= 0n) return refused("NOTHING", "The agent holds none of this coin for you.");
  const sell = reading.coin.transferFee && epoch !== undefined ? afterTransferFee(amount, reading.coin, epoch) : amount;
  if (sell <= 0n) return refused("TOO_SMALL", "Too little to sell.");

  const nowMs = (deps.now ?? Date.now)();
  /* The fee's account first: one that is not there would fail the sale on chain, at the agent's cost. */
  const feeMint = onJupiter(venue) ? NATIVE_MINT : coin;
  const feeAccount = feeAccountRefusal(await connection.getAccountInfo(agentFeeAccount(feeMint), "confirmed"), feeMint);
  if (feeAccount) return refused("UNAVAILABLE", `${feeAccount}.`);
  let priced: Priced | Readonly<{ ok: false; code: string; reason: string }>;
  if (onJupiter(venue)) {
    const sides = await venue.sides(coin).catch(() => null);
    if (!sides) return refused("UNAVAILABLE", "The coin's facts are not readable.");
    priced = await priceOnJupiter(venue, coin, sell, sides);
  } else {
    priced = await priceOnPool(venue, coin, amount, { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs });
  }
  if ("ok" in priced) return priced;
  if (priced.floor <= 0n) return refused("TOO_SMALL", "Too little to sell.");

  const settings = new PublicKey(entry.record.settings);
  const settingsInfo = await connection.getAccountInfo(settings, "confirmed");
  if (!settingsInfo || !settingsInfo.owner.equals(SSA_PROGRAM_ID)) return refused("UNAVAILABLE", "Your smart account is not readable.");
  const nowSeconds = BigInt(Math.floor(nowMs / 1000));
  let plan;
  try {
    plan = planEnable({
      cluster: network,
      terms: {
        human: owner,
        agent: gate.agent,
        budgetMint: coin,
        perTrade: priced.sell,
        perDay: priced.sell,
        slippageBps: SALE_SLIPPAGE_BPS,
        expiresAt: nowSeconds + SALE_SECONDS,
        venue: gate.network === "mainnet" ? { kind: "jupiter" } : { kind: "dlmm", pool: gate.pool },
        fixedBuy: { amountIn: priced.sell, outputMint: NATIVE_MINT, minOut: priced.floor },
        budgetCoin: { program, decimals, transferFee: Boolean(reading.coin.transferFee) },
      },
      account: { kind: "present", settings, state: readSettings(settingsInfo.data) },
      fund: amount,
      nowSeconds,
    });
  } catch (error) {
    return refused("REFUSED", error instanceof Error ? error.message : "The sale is not written.");
  }

  const record = recordOf(plan.mandate);
  const known = await readSale(store, record.policy, network);
  if (known && known.status !== "review") return refused("BUSY", "A sale is under way — try again in a minute.");
  /* Her sales already sold: their mandates go with this signature (her wSOL stays — this sale pays into it). */
  const tidy = await readTidy({ store, connection, network, parent: input.policy, owner, settings, coin: null, unwrap: false, now: nowMs }).catch(() => NO_TIDY);
  const transactions = withTidy({ human: owner, settings, vault: plan.mandate.vault }, plan.transactions, tidy).transactions;
  await writeSale(store, {
    v: 1,
    kind: "sale",
    cluster: network,
    parent: input.policy,
    record,
    coin: coin.toBase58(),
    decimals,
    ...(program.equals(TOKEN_PROGRAM_ID) ? {} : { program: program.toBase58() }),
    ...(reading.coin.transferFee ? { transferFee: true } : {}),
    share: input.share,
    amountRaw: amount.toString(),
    ...(priced.sell === amount ? {} : { sellRaw: priced.sell.toString() }),
    floorRaw: priced.floor.toString(),
    quoteRaw: priced.quote.toString(),
    feeBps: priced.feeBps,
    feeRaw: priced.fee.toString(),
    status: "review",
    trade: null,
    createdAt: nowMs,
    updatedAt: nowMs,
  });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return {
    ok: true,
    record,
    transactions: transactions.map((instructions) => toBase64(unsignedTransaction(owner, instructions, blockhash))),
    figures: {
      coin: coin.toBase58(),
      decimals,
      heldRaw: held.toString(),
      amountRaw: amount.toString(),
      quoteRaw: priced.quote.toString(),
      floorRaw: priced.floor.toString(),
      feeBps: priced.feeBps,
      feeRaw: priced.fee.toString(),
      feeSolRaw: priced.feeSol.toString(),
    },
  };
}

/* ------------------------------------------------------------------ 2. go */

/** The numbers her sale's mandate holds on chain: the size, and the least quote — her floor on the pool; on Jupiter, the route's quote at her floor plus the slippage. */
export function saleNumbers(row: SaleRow): Readonly<{ size: bigint; least: bigint }> {
  const floor = BigInt(row.floorRaw);
  return { size: sellOf(row), least: row.cluster === "mainnet" ? jupiterQuoteFloor(floor, SALE_SLIPPAGE_BPS) : floor };
}

/** Why the sale is not a mandate the agent sells under, read from the chain; null when it is. */
export async function saleChainRefusal(row: SaleRow, gate: SaleGate, connection: Pick<Connection, "getAccountInfo">): Promise<string | null> {
  const r = row.record;
  const settings = new PublicKey(r.settings);
  const policy = new PublicKey(r.policy);
  const owner = new PublicKey(r.owner);
  const coin = new PublicKey(row.coin);
  const [policyInfo, settingsInfo] = await Promise.all([connection.getAccountInfo(policy, "confirmed"), connection.getAccountInfo(settings, "confirmed")]);
  if (!policyInfo || !policyInfo.owner.equals(SSA_PROGRAM_ID)) return "the sale is not signed yet";
  if (!settingsInfo || !settingsInfo.owner.equals(SSA_PROGRAM_ID)) return "no such smart account";
  let head;
  try {
    head = readPolicyHead(policyInfo.data);
    if (!readSettings(settingsInfo.data).signers.some((signer) => signer.key.equals(owner))) return "not the person's smart account";
  } catch {
    return "not a mandate";
  }
  if (!head.settings.equals(settings) || !ssaAddress.policy(settings, head.seed).equals(policy)) return "the mandate is not this account's";
  if (head.signers.length !== 1 || !head.signers[0]!.key.equals(gate.agent)) return "the mandate names another agent";
  const vault = ssaAddress.vault(settings, 0);
  if (vault.toBase58() !== r.vault || tokenAccountOf(vault, coin, programOf(row)).toBase58() !== r.budget) return "not the account's vault";
  /* Its rules name Ryntra's account of the fee's mint and her own account of SOL: the sale the review wrote. */
  if (!policyCarriesFee(policyInfo.data, feeMintOf(saleMandate(row, gate).terms))) return "the mandate carries no Ryntra fee";
  const data = Buffer.from(policyInfo.data);
  if (data.indexOf(Buffer.from(tokenAccountOf(owner, NATIVE_MINT).toBytes())) < 0) return "the mandate does not pay you";
  /* And the very numbers the book keeps: the size and her floor. A review written over by another can never be sold under her mandate. */
  const { size, least } = saleNumbers(row);
  if (data.indexOf(u64le(size)) < 0 || data.indexOf(u64le(least)) < 0) return "the mandate is not the sale the book keeps";
  return null;
}

const u64le = (value: bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
};

export type SaleWorkDeps = Readonly<{
  gate: SaleGate;
  store: GuardStore;
  connection: Connection;
  /** The agent's key; absent — the sale waits for the cron's pass, which has it. */
  key: KeySigner | null;
  journal: AgentJournal;
  venue: SaleVenue;
  /** CITY-196: what the agent never buys and whom it never trades with; the store's own registry when not handed in. */
  screen?: AgentScreen;
  now?: () => number;
  trade?: typeof agentTrade;
}>;

/** A sale whose figure is still to read: its fate, or what it brought. */
const saleOpen = (row: SaleRow) => row.trade !== null && (row.trade.unsettledRaw !== undefined || (row.trade.status === "ok" && row.trade.receivedRaw === null));
const statusOf = (trade: AgentTrade): SaleStatus => (trade.status === "ok" ? "sold" : trade.unsettledRaw !== undefined ? "signed" : "failed");

/** The sale as it stands: read the chain for a sale under review, sell a signed one, settle one sent. */
export async function workSale(given: SaleRow, deps: SaleWorkDeps): Promise<SaleRow> {
  let row = given;
  const now = deps.now ?? Date.now;
  if (row.status === "review") {
    if ((await saleChainRefusal(row, deps.gate, deps.connection)) !== null) return row;
    row = { ...row, status: "signed", updatedAt: now() };
    await writeSale(deps.store, row);
  }
  if (saleOpen(row)) {
    const receiver = tokenAccountOf(new PublicKey(row.record.owner), NATIVE_MINT);
    const [trade] = await settled([row.trade!], deps.connection, (signature) => deps.venue.received(signature, receiver));
    if (trade && trade !== row.trade) {
      row = { ...row, trade, status: statusOf(trade), updatedAt: now() };
      await writeSale(deps.store, row);
    }
    return row;
  }
  if (row.status !== "signed" || row.trade !== null || !deps.key) return row;
  return sellNow(row, deps, deps.key);
}

/** What the venue built for the agent's sale: what `agentTrade` takes, and the quote it is held to. */
type SaleBuilt = Readonly<{
  instruction: TransactionInstruction;
  quoteOut: bigint;
  /** The least quote the chain lets through under her mandate. */
  least: bigint;
  feeSides: FeeSides;
  fee?: TransactionInstruction;
  setup?: readonly TransactionInstruction[];
  lookupTables?: readonly AddressLookupTableAccount[];
  epoch?: bigint;
}>;

/** Build the sale on its venue: the pool's swap with Ryntra's fee before it, or Jupiter's route with the fee inside. */
async function buildSale(row: SaleRow, mandate: Mandate, venue: SaleVenue, at: number): Promise<SaleBuilt> {
  const coin = mandate.terms.budgetMint;
  const receiver = tokenAccountOf(mandate.terms.human, NATIVE_MINT);
  const floor = BigInt(row.floorRaw);
  if (onJupiter(venue)) {
    const feeSides = await venue.sides(coin);
    /* The table's rate now: never more than she was shown; the signer asks the very rate of the table itself. */
    const feeBps = pairFeeBps(coin.toBase58(), NATIVE_MINT.toBase58(), feeSides);
    if (feeBps === null) throw new Error("Ryntra's table names no router fee for this pair");
    if (feeBps > row.feeBps) throw new Error("Ryntra's fee for this coin is above what you were shown");
    const built = await venue.sell(mandate, receiver, feeBps, feeSides);
    return { instruction: built.instruction, quoteOut: built.quoteOut, least: saleNumbers(row).least, feeSides, setup: built.setup, lookupTables: built.lookupTables, ...(built.epoch === undefined ? {} : { epoch: built.epoch }) };
  }
  const amount = BigInt(row.amountRaw);
  const fee = BigInt(row.feeRaw);
  const built = await venue.sell(mandate, amount - fee, receiver, floor);
  return {
    instruction: built.instruction,
    quoteOut: built.quoteOut,
    least: floor,
    feeSides: { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: at },
    fee: feeTransferInstruction({ budgetMint: coin, budgetAccount: mandate.budgetAccount, vault: mandate.vault, fee, decimals: row.decimals }),
  };
}

/** The agent sells: one try, claimed so that two instances never both send it. */
async function sellNow(row: SaleRow, deps: SaleWorkDeps, key: KeySigner): Promise<SaleRow> {
  const now = deps.now ?? Date.now;
  const at = now();
  if (!(await salesOf(deps.store).insertIfAbsent(claimKey(row.cluster, row.record.policy, Math.floor(at / 120_000)), { claimedAt: at }))) return row;
  const mandate = saleMandate(row, deps.gate);
  const receiver = tokenAccountOf(mandate.terms.human, NATIVE_MINT);
  const amount = BigInt(row.amountRaw);
  const trade = deps.trade ?? agentTrade;
  let outcome: TradeOutcome;
  let minOut: bigint | null = null;
  const written: { open?: TradeOutcome } = {};
  try {
    const built = await buildSale(row, mandate, deps.venue, at);
    const terms = tradeTerms({ programId: built.instruction.programId, accounts: built.instruction.keys.map((meta) => meta.pubkey), data: built.instruction.data });
    minOut = terms?.minOut ?? null;
    /* The price fell under her floor since she signed: the chain would refuse, and the agent does not pay to hear it. */
    if (built.quoteOut < built.least) throw new Error("the price fell under your floor");
    outcome = await trade({
      connection: deps.connection,
      mandate,
      signer: mandateSigner(key, { mandate, policy: policyOf(mandate), journal: deps.journal, screen: deps.screen ?? storeScreen(deps.store, deps.gate.network) }),
      venueInstruction: built.instruction,
      promisedOut: built.quoteOut,
      feeSides: built.feeSides,
      fee: built.fee,
      ...(built.setup ? { setup: built.setup } : {}),
      ...(built.lookupTables ? { lookupTables: built.lookupTables } : {}),
      ...(built.epoch === undefined ? {} : { epoch: built.epoch }),
      beforeSend: async ({ signature, validUntilHeight }) => {
        const open: TradeOutcome = { status: "unknown", signature, size: 0, validUntilHeight };
        await writeSale(deps.store, { ...row, trade: tradeOf(open, amount, null, at, minOut), updatedAt: at });
        written.open = open;
      },
    });
  } catch (error) {
    outcome = written.open ?? { status: "refused-in-simulation", reason: error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "not built" };
  }
  const received = outcome.status === "landed" && outcome.ok ? await deps.venue.received(outcome.signature, receiver).catch(() => null) : null;
  const done = tradeOf(outcome, amount, received, at, minOut);
  const next: SaleRow = { ...row, trade: done, status: statusOf(done), updatedAt: now() };
  await writeSale(deps.store, next);
  return next;
}

export type SaleReceipt = Readonly<{ policy: string; status: SaleStatus; signature: string | null; soldRaw: string; receivedRaw: string | null; reason: string | null }>;

export const receiptOf = (row: SaleRow): SaleReceipt => ({
  policy: row.record.policy,
  status: row.status,
  signature: row.trade?.signature ?? null,
  soldRaw: row.amountRaw,
  receivedRaw: row.trade?.receivedRaw ?? null,
  reason: row.status === "failed" ? (row.trade?.reason ?? null) : null,
});

/** The person signed her sale: the agent sells it now, when the deployment has its key; the receipt either way. */
export async function goSale(input: Readonly<{ owner: string; policy: string }>, deps: SaleWorkDeps): Promise<Readonly<{ ok: true; receipt: SaleReceipt }> | Readonly<{ ok: false; code: string; reason: string }>> {
  if (!(await onNetwork(deps.connection, deps.gate.network))) return notOn(deps.gate.network);
  const row = await readSale(deps.store, input.policy, deps.gate.network);
  if (!row || row.record.owner !== input.owner) return refused("NOT_FOUND", "No such sale.");
  const next = await workSale(row, deps);
  if (next.status === "review") return refused("NOT_SIGNED", "The sale is not signed yet.");
  return { ok: true, receipt: receiptOf(next) };
}

/**
 * The cron's share: sales signed but not sold (a request that ended early), sold but not read, and reviews of the last
 * minutes whose signature may have landed. A sale costs only itself when it cannot be read.
 */
export async function runSalePass(deps: SaleWorkDeps): Promise<readonly Readonly<{ policy: string; did: SaleStatus | "unread" }>[]> {
  const now = (deps.now ?? Date.now)();
  const lines: Readonly<{ policy: string; did: SaleStatus | "unread" }>[] = [];
  for (const row of await readSales(deps.store, undefined, deps.gate.network)) {
    const due = (row.status === "review" && now - row.createdAt < SALE_REVIEW_MS) || (row.status === "signed" && row.trade === null) || saleOpen(row);
    if (!due) continue;
    const next = await workSale(row, deps).catch(() => null);
    lines.push({ policy: row.record.policy, did: next ? next.status : "unread" });
  }
  return lines;
}

/* ------------------------------------------------------------------ tidying up (CITY-195) */

/** Whether a mint is a coin of Token-2022 that withholds a fee on transfers — by its extension, whatever the rate; null — unreadable. */
function withholds(mint: Readonly<{ owner: PublicKey; data: Uint8Array }>): boolean | null {
  if (!mint.owner.equals(TOKEN_2022_PROGRAM_ID)) return false;
  try {
    return mintExtensions(mint.data).some((extension) => extension.type === EXTENSION.TransferFeeConfig);
  } catch {
    return null;
  }
}

/**
 * How long a review may still be signed: its transactions carry one blockhash, which the chain lets go within about a
 * minute and a half. A review younger than this might still land; an older one never will.
 */
export const TIDY_REVIEW_MS = 2 * 60_000;

/**
 * What her next signature tidies, read from the chain (`./tidy.ts`):
 * - the mandates of her sales through this buying mandate that are over — sold, not sold, or a review that can no longer
 *   be signed — and still stand;
 * - when `coin` is named, the vault's account of it: whatever coin was left in it home to her, then closed;
 * - when `unwrap`, her wSOL.
 * The account and her wSOL stay while a sale of hers may still take the coin or pay into it: signed and not sold, or a
 * review she may still sign.
 */
export async function readTidy(
  input: Readonly<{
    store: GuardStore;
    connection: Pick<Connection, "getMultipleAccountsInfo">;
    network: MandateNetwork;
    /** The buying mandate whose sales are tidied. */
    parent: string;
    owner: PublicKey;
    settings: PublicKey;
    /** The coin whose vault account is emptied to her and closed; null — that account stays. */
    coin: PublicKey | null;
    unwrap: boolean;
    /** A sale this very transaction handles itself. */
    except?: string;
    now?: number;
  }>,
): Promise<Tidy> {
  const now = input.now ?? Date.now();
  const sales = (await readSales(input.store, input.parent, input.network)).filter((sale) => sale.record.policy !== input.except && sale.record.settings === input.settings.toBase58());
  const underWay = (sale: SaleRow) => sale.status === "signed" || (sale.status === "review" && now - sale.createdAt < TIDY_REVIEW_MS);
  const busy = sales.some(underWay);
  const over = sales.filter((sale) => !underWay(sale)).map((sale) => new PublicKey(sale.record.policy));
  const vault = ssaAddress.vault(input.settings, 0);
  const herWsol = tokenAccountOf(input.owner, NATIVE_MINT);
  const coinMint = input.coin && !busy ? input.coin : null;
  const infos = await input.connection.getMultipleAccountsInfo([...over, herWsol, ...(coinMint ? [coinMint] : [])], "confirmed");
  const policies = over.filter((_, at) => infos[at]?.owner.equals(SSA_PROGRAM_ID));
  const wsolInfo = infos[over.length];
  const unwrap = input.unwrap && !busy && wsolInfo && wsolInfo.owner.equals(TOKEN_PROGRAM_ID) ? herWsol : null;
  const empty: EmptyAccount[] = [];
  const mintInfo = coinMint ? infos[over.length + 1] : null;
  if (coinMint && mintInfo && isTokenProgram(mintInfo.owner)) {
    const program = mintInfo.owner;
    const account = tokenAccountOf(vault, coinMint, program);
    const [read] = await input.connection.getMultipleAccountsInfo([account], "confirmed");
    /* A mint that cannot be read whole: the account stays — a close that fails would cost her the whole transaction. */
    const sweep = withholds(mintInfo);
    if (read && read.owner.equals(program) && sweep !== null && mintInfo.data.length > 44) {
      const amount = heldIn(read.data);
      const left = amount > 0n ? { left: { mint: coinMint, amount, decimals: mintInfo.data[44]!, to: tokenAccountOf(input.owner, coinMint, program) } } : {};
      empty.push({ account, program, ...(sweep ? { withheld: coinMint } : {}), ...left });
    }
  }
  return { policies, empty, unwrap };
}

/**
 * What her stop also tidies: the mandates of her sales that are over, the vault's account of the coin the agent bought —
 * what was left in it home to her, then closed — and her wSOL; read from the agent's book for that mandate, nothing when
 * the book does not know it.
 */
export const stopTidy =
  (deps: Readonly<{ store: GuardStore; connection: Pick<Connection, "getMultipleAccountsInfo">; network: MandateNetwork; now?: () => number }>): StopTidy =>
  async ({ owner, settings, policy }) => {
    const entry = await readEntry(deps.store, policy.toBase58(), deps.network);
    if (!entry || entry.record.owner !== owner.toBase58() || entry.record.settings !== settings.toBase58()) return NO_TIDY;
    return readTidy({ store: deps.store, connection: deps.connection, network: deps.network, parent: policy.toBase58(), owner, settings, coin: new PublicKey(entry.receiveMint), unwrap: true, now: (deps.now ?? Date.now)() });
  };

/* ------------------------------------------------------------------ 3. back */

/**
 * A sale that did not go, taken back: the mandate removed and the coin back to her wallet, one unsigned transaction —
 * which also removes her sold sales' mandates and unwraps her wSOL (`./tidy.ts`). On Jupiter the vault's account of the
 * coin stays open while her agent still buys it: its route lands each buy there first.
 */
export async function reviewSaleBack(input: Readonly<{ owner: string; policy: string }>, gate: SaleGate, deps: Readonly<{ store: GuardStore; connection: Connection; now?: () => number }>): Promise<SaleReview> {
  const { connection } = deps;
  if (!(await onNetwork(connection, gate.network))) return notOn(gate.network);
  const row = await readSale(deps.store, input.policy, gate.network);
  if (!row || row.record.owner !== input.owner) return refused("NOT_FOUND", "No such sale.");
  const settings = new PublicKey(row.record.settings);
  const settingsInfo = await connection.getAccountInfo(settings, "confirmed");
  if (!settingsInfo || !readSettings(settingsInfo.data).signers.some((signer) => signer.key.toBase58() === input.owner)) return refused("REFUSED", "Not your smart account.");
  const mandate = saleMandate(row, gate);
  const balance = await connection.getTokenAccountBalance(mandate.budgetAccount, "confirmed").then(
    (read) => BigInt(read.value.amount),
    () => null,
  );
  const [policyInfo, parentInfo] = await Promise.all([connection.getAccountInfo(mandate.policy, "confirmed"), connection.getAccountInfo(new PublicKey(row.parent), "confirmed")]);
  const keepOpen = gate.network === "mainnet" && Boolean(parentInfo);
  /* Only what still stands: a removed mandate is not removed twice, a closed account is not closed again. */
  const instructions = [...(policyInfo ? planStop(mandate) : []), ...(balance !== null ? planWithdraw(mandate, balance, { keepOpen }) : [])];
  if (!instructions.length) return refused("NOTHING", "Nothing left to take back.");
  const owner = new PublicKey(input.owner);
  const tidy = await readTidy({ store: deps.store, connection, network: gate.network, parent: row.parent, owner, settings, coin: null, unwrap: true, except: row.record.policy, now: (deps.now ?? Date.now)() }).catch(() => NO_TIDY);
  const [tx] = withTidy({ human: owner, settings, vault: mandate.vault }, [instructions], tidy).transactions;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return {
    ok: true,
    record: row.record,
    transactions: [toBase64(unsignedTransaction(owner, tx!, blockhash))],
    figures: {
      coin: row.coin,
      decimals: row.decimals,
      heldRaw: "0",
      amountRaw: (balance ?? 0n).toString(),
      quoteRaw: "0",
      floorRaw: "0",
      feeBps: row.feeBps,
      feeRaw: "0",
      feeSolRaw: "0",
    },
  };
}

/* ------------------------------------------------------------------ what the window shows */

/** The agent's coin with her sales counted: what it holds for her, and her last sale. */
export type SalesView = Readonly<{ heldRaw: string; soldRaw: string; gotRaw: string; lastSale: SaleReceipt | null }>;

export function salesView(boughtRaw: bigint, sales: readonly SaleRow[], walletRaw: bigint | null = null): SalesView {
  const { soldRaw, gotRaw } = salesTotals(sales);
  const last = [...sales].filter((sale) => sale.status !== "review").sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  return { heldRaw: agentHolding(boughtRaw, soldRaw, walletRaw).toString(), soldRaw: soldRaw.toString(), gotRaw: gotRaw.toString(), lastSale: last ? receiptOf(last) : null };
}

/** What her wallet holds of the coin, under the coin's own program; null when it is not read. */
export async function walletHolding(connection: Pick<Connection, "getAccountInfo" | "getTokenAccountBalance">, owner: PublicKey, coin: PublicKey): Promise<bigint | null> {
  try {
    const mint = await connection.getAccountInfo(coin, "confirmed");
    if (!mint) return null;
    const read = await connection.getTokenAccountBalance(tokenAccountOf(owner, coin, mint.owner), "confirmed").catch(() => null);
    /* No account of the coin: she holds none of it. */
    return read ? BigInt(read.value.amount) : 0n;
  } catch {
    return null;
  }
}
