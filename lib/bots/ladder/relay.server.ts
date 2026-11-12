/**
 * The ladder's relay: the person's signed transactions, checked and forwarded
 * to the network the request names — nothing more.
 *
 * It does not sign, and it holds nothing that could: no keypair, no secret, no
 * signer module. Each transaction must already carry every signature it needs —
 * the person's wallet, and on a placement the order account's own, which the
 * browser added after the wallet — and each must be real over the exact message
 * (`signedByAll`). The limits lane's reading decides what a ladder transaction
 * may hold (`inspectDlmmTransaction`: the wallet pays; only the order and the
 * wallet's own housekeeping; the order names the wallet as owner, payer and
 * sender; a cancellation returns the money to the wallet). On top of that a
 * placement must sit in a pool open to ladders on that network, as one order of
 * at most 50 non-empty bins whose account signed and is not the wallet, and on
 * mainnet the bundle stays under the deployment's cap.
 *
 * Then every transaction is simulated as signed — the signatures verified by
 * the chain — and judged by what the person gets against what was promised
 * (`promise.ts`): the order stands with exactly its bins, exactly the amount
 * leaves, SOL leaves only as fees and rent. A wallet may add its own
 * assertions or a compute budget; it may not make the transaction do more.
 *
 * Every transaction of a bundle is checked before the first is sent: a bundle
 * with one bad transaction sends nothing. Once sent, each lands or not on its
 * own. The relay answers as soon as the last one is handed to the node
 * (CITY-231): `sent` with its signature, or `failed` where the node refused it.
 * It never waits for the confirmation — a wait could outlast the function, and
 * a ladder already on the chain would come back to the window as an error.
 * Whether each landed is the window's own later reading (`readLadderOrders`:
 * the order accounts and the signatures), and a partly placed ladder shows as
 * «not finished — finish or cancel».
 */

import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { PublicKey, SendTransactionError, Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";

import { inspectDlmmTransaction, signedByAll } from "../../solana/limits/dlmm-tx.ts";
import { base58, DLMM_LIMIT_MAX_BINS } from "../../solana/limits/model.ts";
import { ladderConnection, onNetwork } from "./connection.server.ts";
import { binArrayRent, bitmapExtensionRent, orderAccountRent, SIGNATURE_LAMPORTS } from "./costs.ts";
import type { LadderNetwork } from "./network.ts";
import { judgeCancel, judgePlacement, tokenAmountOf, type SimAccount } from "./promise.ts";
import { readLadderTransaction } from "./tx.ts";

export type RelayKind = "place" | "cancel";

export type RelayItem = Readonly<{ wireBase64: string; limitOrder: string }>;

export type RelayCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; index: number; code: string; reason: string }>;

/** What the relay needs to know of a placement's pool: open to ladders, and its facts for the cap. */
export type RelayPool = Readonly<{ open: boolean; baseMint: string; quoteMint: string; baseDecimals: number; quoteDecimals: number; activePrice: number }>;

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const INIT_BIN_ARRAY = "235613b94ed44bd3";
const INIT_BITMAP_EXTENSION = "2f9de2b40cf02147";
const DLMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const TOKEN_ACCOUNT_BYTES = 165;

/**
 * Check one bundle against the rules above, without sending anything. `pools` — devnet's listed pools; null on
 * mainnet, where the relay reads the pool on chain instead.
 */
export function checkLadderBundle(
  args: Readonly<{ owner: string; kind: RelayKind; items: readonly RelayItem[]; pools: readonly string[] | null }>,
): RelayCheck {
  if (args.items.length === 0 || args.items.length > 8) return { ok: false, index: -1, code: "VALIDATION_ERROR", reason: "One to eight transactions." };
  if (new Set(args.items.map((item) => item.limitOrder)).size !== args.items.length) return { ok: false, index: -1, code: "VALIDATION_ERROR", reason: "Each transaction is its own order." };
  for (const [index, item] of args.items.entries()) {
    const read = inspectDlmmTransaction(item.wireBase64, { owner: args.owner, kind: args.kind, limitOrder: item.limitOrder, pool: null });
    if (!read.ok) return { ok: false, index, code: "SIGNED_MISMATCH", reason: read.reason };
    if (!signedByAll(item.wireBase64)) return { ok: false, index, code: "NOT_SIGNED", reason: "A signature is missing or does not match." };
    if (args.kind === "cancel") continue;
    if (!read.pool || (args.pools !== null && !args.pools.includes(read.pool))) return { ok: false, index, code: "POOL_NOT_LISTED", reason: "The order sits in a pool not open to ladders." };
    const tx = readLadderTransaction(item.wireBase64);
    const order = tx?.orders.length === 1 ? tx.orders[0]! : null;
    if (!tx || !order) return { ok: false, index, code: "SIGNED_MISMATCH", reason: "Not exactly one order." };
    if (order.owner !== args.owner || order.limitOrder !== item.limitOrder || tx.feePayer !== args.owner) return { ok: false, index, code: "SIGNED_MISMATCH", reason: "The order is not this wallet's." };
    if (!tx.signers.includes(item.limitOrder) || item.limitOrder === args.owner) return { ok: false, index, code: "SIGNED_MISMATCH", reason: "The order account is not a signer of its own." };
    if (order.data.relativeBin !== null || order.data.bins.length === 0 || order.data.bins.length > DLMM_LIMIT_MAX_BINS || order.data.bins.some((bin) => bin.amount <= 0n)) {
      return { ok: false, index, code: "SIGNED_MISMATCH", reason: "The order's bins are not a ladder's." };
    }
  }
  return { ok: true };
}

/** A transaction's priority as its own compute-budget instructions set it, lamports (the default limit when none). */
function priorityOf(transaction: Transaction): number {
  let units = 200_000n * BigInt(transaction.instructions.filter((ix) => ix.programId.toBase58() !== COMPUTE_BUDGET).length);
  let price = 0n;
  for (const ix of transaction.instructions) {
    if (ix.programId.toBase58() !== COMPUTE_BUDGET) continue;
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length >= 5) units = BigInt(data.readUInt32LE(1));
    if (data[0] === 3 && data.length >= 9) price = data.readBigUInt64LE(1);
  }
  return Number((units * price + 999_999n) / 1_000_000n);
}

type SimConnection = Pick<Connection, "simulateTransaction" | "getMultipleAccountsInfo" | "getMinimumBalanceForRentExemption">;

const asSim = (value: { lamports: number; data: unknown } | null | undefined): SimAccount =>
  value && Array.isArray(value.data) ? { lamports: value.lamports, data: value.data as string[] } : null;
const fromInfo = (info: { lamports: number; data: Uint8Array } | null | undefined): SimAccount =>
  info ? { lamports: info.lamports, data: [Buffer.from(info.data).toString("base64"), "base64"] } : null;

/**
 * One signed transaction, simulated as signed and judged: a placement's order stands with exactly the bins its own
 * instruction names and the amount leaves exactly; a cancellation's order is gone. SOL out stays within the fees, the
 * rents and any SOL placed. Null — kept; otherwise why not.
 */
export async function judgeSigned(connection: SimConnection, owner: string, kind: RelayKind, item: RelayItem): Promise<string | null> {
  const transaction = Transaction.from(Buffer.from(item.wireBase64, "base64"));
  const signatures = transaction.signatures.length;
  const fees = signatures * SIGNATURE_LAMPORTS + priorityOf(transaction);
  const rentPerByte = Math.ceil((await connection.getMinimumBalanceForRentExemption(0)) / 128);
  const wallet = new PublicKey(owner);
  if (kind === "cancel") {
    const [before] = await connection.getMultipleAccountsInfo([wallet], "confirmed");
    const simulated = await connection.simulateTransaction(VersionedTransaction.deserialize(fromBase64(item.wireBase64)), {
      sigVerify: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [owner, item.limitOrder] },
    });
    if (simulated.value.err) return `SIMULATION_FAILED: ${JSON.stringify(simulated.value.err).slice(0, 200)}`;
    const after = simulated.value.accounts ?? [];
    const verdict = judgeCancel({ maxSolOutLamports: fees + 2 * (TOKEN_ACCOUNT_BYTES + 128) * rentPerByte }, { lamports: before?.lamports ?? 0 }, { wallet: asSim(after[0]), order: asSim(after[1]) });
    return verdict.ok ? null : `${verdict.code}: ${verdict.reason}`;
  }
  const read = readLadderTransaction(item.wireBase64);
  const order = read?.orders[0];
  if (!read || !order) return "SIGNED_MISMATCH: not one order";
  const place = transaction.instructions.find((ix) => ix.programId.toBase58() === DLMM && Buffer.from(ix.data.subarray(0, 8)).toString("hex") === "6cb021ba92e501c5");
  const mint = place?.keys[3]?.pubkey;
  const inputAccount = place?.keys[7]?.pubkey;
  if (!mint || !inputAccount) return "SIGNED_MISMATCH: the order names no input";
  const inputIsSol = mint.equals(NATIVE_MINT);
  if (!inputIsSol && !inputAccount.equals(getAssociatedTokenAddressSync(mint, wallet, true, place.keys[9]?.pubkey ?? undefined))) {
    /* The program itself takes the input from this account; it must be the wallet's own. */
    return "SIGNED_MISMATCH: the input is not the wallet's own account";
  }
  let arrays = 0;
  let extension = false;
  for (const ix of transaction.instructions) {
    if (ix.programId.toBase58() !== DLMM) continue;
    const discriminator = Buffer.from(ix.data.subarray(0, 8)).toString("hex");
    if (discriminator === INIT_BIN_ARRAY) arrays += 1;
    if (discriminator === INIT_BITMAP_EXTENSION) extension = true;
  }
  const total = order.data.bins.reduce((sum, bin) => sum + bin.amount, 0n);
  const maxSolOutLamports =
    fees + orderAccountRent(order.data.bins.length, rentPerByte) + arrays * binArrayRent(rentPerByte) + (extension ? bitmapExtensionRent(rentPerByte) : 0) + (inputIsSol ? Number(total) : 0);
  const before = await connection.getMultipleAccountsInfo([wallet, inputAccount], "confirmed");
  const simulated = await connection.simulateTransaction(VersionedTransaction.deserialize(fromBase64(item.wireBase64)), {
    sigVerify: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [owner, inputAccount.toBase58(), item.limitOrder] },
  });
  if (simulated.value.err) return `SIMULATION_FAILED: ${JSON.stringify(simulated.value.err).slice(0, 200)}`;
  const after = simulated.value.accounts ?? [];
  const verdict = judgePlacement(
    { owner, pool: order.pool, limitOrder: item.limitOrder, isAskSide: order.data.isAskSide, bins: order.data.bins, inputIsSol, maxSolOutLamports },
    { lamports: before[0]?.lamports ?? 0, input: inputIsSol ? null : tokenAmountOf(fromInfo(before[1])) },
    { wallet: asSim(after[0]), input: asSim(after[1]), order: asSim(after[2]) },
  );
  return verdict.ok ? null : `${verdict.code}: ${verdict.reason}`;
}

/** The bundle's dollars at today's price, from its orders' own bins and their pools; null — a pool not open. */
export async function bundleUsd(items: readonly RelayItem[], pool: (address: string) => Promise<RelayPool | null>): Promise<number | null> {
  let usd = 0;
  for (const item of items) {
    const order = readLadderTransaction(item.wireBase64)?.orders[0];
    if (!order) return null;
    const facts = await pool(order.pool);
    if (!facts || !facts.open) return null;
    const raw = Number(order.data.bins.reduce((sum, bin) => sum + bin.amount, 0n));
    const tx = Transaction.from(Buffer.from(item.wireBase64, "base64"));
    const place = tx.instructions.find((ix) => ix.programId.toBase58() === DLMM && Buffer.from(ix.data.subarray(0, 8)).toString("hex") === "6cb021ba92e501c5");
    const mint = place?.keys[3]?.pubkey.toBase58();
    if (mint === facts.quoteMint) usd += raw / 10 ** facts.quoteDecimals;
    else if (mint === facts.baseMint) usd += (raw / 10 ** facts.baseDecimals) * facts.activePrice;
    else return null;
  }
  return usd;
}

export type RelayLeg = Readonly<{
  limitOrder: string;
  /** The transaction's own signature, read from its bytes: known before it is sent, whatever the node answers. */
  signature: string | null;
  /** `confirmed` — on chain; `sent` — handed to the node, not yet seen landed; `failed` — the node refused it. */
  state: "confirmed" | "sent" | "failed";
  reason: string | null;
}>;

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

/** A signed transaction's id: its first signature (the fee payer's — the wallet's), base58; null — not signed. */
export function signatureOf(wireBase64: string): string | null {
  try {
    const first = VersionedTransaction.deserialize(fromBase64(wireBase64)).signatures[0];
    return first && first.some((byte) => byte !== 0) ? base58(first) : null;
  } catch {
    return null;
  }
}

/**
 * The node answered and refused: nothing of that transaction can land. Anything else — a timeout, a dropped
 * connection — leaves it unknown, and it stays `sent` until the window's reading says.
 */
export function nodeRefused(failure: unknown): boolean {
  const message = failure instanceof Error ? failure.message : String(failure);
  /* «Already processed» is the network saying it holds this transaction: it landed — the reading confirms it by signature. */
  if (/already been processed/i.test(message)) return false;
  if (failure instanceof SendTransactionError) return true;
  return /simulation failed|blockhash not found|signature verification|insufficient|custom program error/i.test(message);
}

type RelayConnection = Pick<Connection, "getGenesisHash" | "sendRawTransaction"> & Partial<SimConnection>;

/**
 * Check, then forward each signed transaction to the network in order, and answer at once: one line per transaction
 * with its signature; a refused bundle forwards none.
 */
export async function relayLadder(
  args: Readonly<{ owner: string; kind: RelayKind; items: readonly RelayItem[]; pools: readonly string[] | null; network?: LadderNetwork; maxUsd?: number | null }>,
  deps: Readonly<{
    connection?: RelayConnection;
    /** A placement's pool as the network has it now; required on mainnet, where pools are not listed. */
    pool?: (address: string) => Promise<RelayPool | null>;
  }> = {},
): Promise<Readonly<{ ok: true; legs: readonly RelayLeg[] }> | Readonly<{ ok: false; code: string; reason: string; index: number }>> {
  const network = args.network ?? "devnet";
  const checked = checkLadderBundle({ owner: args.owner, kind: args.kind, items: args.items, pools: network === "devnet" ? (args.pools ?? []) : null });
  if (!checked.ok) return checked;
  if (args.kind === "place" && network === "mainnet") {
    if (!deps.pool) return { ok: false, code: "POOL_NOT_LISTED", reason: "No reader of pools.", index: -1 };
    const usd = await bundleUsd(args.items, deps.pool);
    if (usd === null) return { ok: false, code: "POOL_NOT_LISTED", reason: "The order sits in a pool not open to ladders.", index: -1 };
    const maxUsd = args.maxUsd ?? null;
    if (maxUsd !== null && !(usd <= maxUsd + 1e-9)) return { ok: false, code: "OVER_LIMIT", reason: `A ladder places up to $${maxUsd} for now.`, index: -1 };
  }
  const connection = deps.connection ?? (ladderConnection(network) as unknown as RelayConnection);
  /* The chain says which network it is: a wrong endpoint never receives the person's transactions. */
  if (!(await onNetwork(connection, network))) return { ok: false, code: network === "devnet" ? "NOT_DEVNET" : "NOT_MAINNET", reason: `The endpoint does not serve ${network}.`, index: -1 };
  /* As signed, simulated and judged — every one before the first is sent. */
  if (connection.simulateTransaction && connection.getMultipleAccountsInfo && connection.getMinimumBalanceForRentExemption) {
    for (const [index, item] of args.items.entries()) {
      const why = await judgeSigned(connection as SimConnection, args.owner, args.kind, item).catch((failure: unknown) => `UNREACHABLE: ${failure instanceof Error ? failure.message : String(failure)}`);
      if (why) return { ok: false, code: why.startsWith("UNREACHABLE") ? "UNREACHABLE" : "PROMISE_BROKEN", reason: why.slice(0, 300), index };
    }
  } else if (network === "mainnet") {
    return { ok: false, code: "UNREACHABLE", reason: "The network cannot simulate.", index: -1 };
  }
  const legs: RelayLeg[] = [];
  for (const item of args.items) {
    const own = signatureOf(item.wireBase64);
    try {
      const signature = await connection.sendRawTransaction(fromBase64(item.wireBase64), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
      legs.push({ limitOrder: item.limitOrder, signature: signature || own, state: "sent", reason: null });
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message.slice(0, 300) : "Refused.";
      legs.push({ limitOrder: item.limitOrder, signature: own, state: nodeRefused(failure) ? "failed" : "sent", reason });
    }
  }
  return { ok: true, legs };
}
