/**
 * CITY-174 — one trade of the agent, end to end: assemble it under the mandate, read the accounts its rules look into,
 * have the agent's signer judge and sign it, send it through our own RPC and read back what the chain said.
 *
 * The agent never sends a trade its own signer refused, and never retries one on its own: a trade that landed and failed
 * is the chain's answer (its refusal named from the logs), and a trade whose fate is unknown is read again, not re-sent.
 */

import { PublicKey, SendTransactionError, type AddressLookupTableAccount, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { agentTradeInstructions } from "./agent.ts";
import { MAX_TRANSACTION_BYTES, unsignedTransaction, wireSize, type Mandate } from "./human.ts";
import type { FeeSides } from "./fee.ts";
import type { AccountFacts } from "./judge.ts";
import { heldIn, tradeTerms } from "./result.ts";
import { AgentSignerRefused, type AgentSigner } from "./signer.server.ts";
import { readPolicyExecute, refusalOf, SSA_PROGRAM_ID, type ProgramInteractionPolicy } from "./ssa.ts";
import { mandatePolicy } from "./terms.ts";
import type { Coin } from "./token-2022.ts";

/** The policy a mandate's terms wrote — what the agent's signer judges by. */
export const policyOf = (mandate: Mandate): ProgramInteractionPolicy => mandatePolicy(mandate.terms, { vault: mandate.vault, budgetAccount: mandate.budgetAccount });

/** What the agent reads before it judges: the program owner and data of every account a data rule looks into. */
export async function readFacts(connection: Pick<Connection, "getMultipleAccountsInfo">, accounts: readonly PublicKey[]): Promise<AccountFacts> {
  const unique = [...new Map(accounts.map((key) => [key.toBase58(), key])).values()];
  const facts = new Map<string, { owner: PublicKey; data: Uint8Array }>();
  if (!unique.length) return facts;
  const infos = await connection.getMultipleAccountsInfo(unique, "confirmed");
  infos.forEach((info, index) => {
    if (info) facts.set(unique[index]!.toBase58(), { owner: info.owner, data: Uint8Array.from(info.data) });
  });
  return facts;
}

/** Every account of the trade's inner instructions whose data a rule could read. */
export function tradeAccounts(instructions: readonly TransactionInstruction[]): readonly PublicKey[] {
  const execution = instructions.find((instruction) => instruction.programId.equals(SSA_PROGRAM_ID));
  if (!execution) return [];
  const view = readPolicyExecute({ programId: execution.programId, keys: execution.keys.map((key) => key.pubkey), data: execution.data });
  return view.instructions.flatMap((inner) => inner.accounts);
}

export type TradeOutcome =
  | Readonly<{ status: "refused-by-agent"; reason: string }>
  | Readonly<{ status: "refused-in-simulation"; reason: string }>
  | Readonly<{ status: "landed"; signature: string; ok: true; size: number; computeUnits: number | null; fee: number | null }>
  | Readonly<{ status: "landed"; signature: string; ok: false; size: number; refusal: Readonly<{ code: string; reason: string }> | null; computeUnits: number | null; fee: number | null }>
  /* Signed and handed to the network, its fate not read: it may have landed. `validUntilHeight` — where its blockhash ends. */
  | Readonly<{ status: "unknown"; signature: string; size: number; validUntilHeight: number }>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long one trade waits for the chain, in reads 1.5 s apart: the rest is the next pass's (`./tick.server.ts` `settled`). */
export const TRADE_READ_TRIES = 8;

type Landed = Readonly<{ ok: boolean; logs: readonly string[]; computeUnits: number | null; fee: number | null }>;

/**
 * What the chain says of a transaction: it landed; the RPC answered that it has none; or the RPC did not answer. The last
 * two are never the same thing: a read that failed says nothing about the money.
 */
export type Fate = (Landed & Readonly<{ state: "landed" }>) | Readonly<{ state: "absent" }> | Readonly<{ state: "unread" }>;

export async function fateOf(connection: Pick<Connection, "getTransaction">, signature: string): Promise<Fate> {
  try {
    const read = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!read) return { state: "absent" };
    if (!read.meta) return { state: "unread" };
    return { state: "landed", ok: read.meta.err === null, logs: read.meta.logMessages ?? [], computeUnits: read.meta.computeUnitsConsumed ?? null, fee: read.meta.fee };
  } catch {
    return { state: "unread" };
  }
}

/** Read a sent transaction back until the chain answers, or give up and call it unknown. */
export async function readBack(connection: Pick<Connection, "getTransaction">, signature: string, tries = 20): Promise<Landed | null> {
  for (let i = 0; i < tries; i += 1) {
    const fate = await fateOf(connection, signature);
    if (fate.state === "landed") return fate;
    if (i + 1 < tries) await sleep(1_500);
  }
  return null;
}

/** The node answered and refused: its simulation or its own check, with nothing passed on. Anything else — a cut connection, a timeout, a 429 — says nothing of whether it took the transaction. */
const refusedByNode = (error: unknown) => error instanceof SendTransactionError || Array.isArray((error as { logs?: unknown } | null)?.logs);

/**
 * One trade. `skipPreflight` sends without the RPC's simulation — the devnet pass uses it so that a refused trade lands
 * with its signature, as proof; a trade in service is simulated first.
 */
export async function agentTrade(
  input: Readonly<{
    connection: Connection;
    mandate: Mandate;
    signer: AgentSigner;
    venueInstruction: TransactionInstruction;
    /** What the venue's quote promised the person, base units of the coin bought. */
    promisedOut: bigint;
    /** The catalogue's facts of the pair's sides: the signer reads Ryntra's rate from them itself (`./fee.ts`). */
    feeSides: FeeSides;
    /** The fee as its own instruction, where the venue does not carry it (devnet). */
    fee?: TransactionInstruction | undefined;
    setup?: readonly TransactionInstruction[];
    lookupTables?: readonly AddressLookupTableAccount[];
    /** The coin bought, as the venue read it, and the chain's epoch when it withholds a transfer fee (CITY-184). */
    coin?: Coin | undefined;
    epoch?: bigint | undefined;
    skipPreflight?: boolean;
    /** Called once it is signed, before it is handed to the network: what must survive the process dying from here on. If it throws, nothing is sent. */
    beforeSend?: (sent: Readonly<{ signature: string; validUntilHeight: number }>) => Promise<void>;
  }>,
): Promise<TradeOutcome> {
  const { connection, mandate, venueInstruction } = input;
  /* A mandate that ended or was revoked: the chain would refuse, and the agent does not pay the fee to hear it. */
  if (BigInt(Math.floor(Date.now() / 1000)) >= mandate.terms.expiresAt) return { status: "refused-by-agent", reason: "the mandate has ended" };
  if (!(await connection.getAccountInfo(mandate.policy, "confirmed"))) return { status: "refused-by-agent", reason: "the mandate was revoked" };
  const accounts = venueInstruction.keys.map((key) => key.pubkey);
  /* One read: the rule on what reaches the person starts from the same balance the signer sees. */
  const facts = await readFacts(connection, accounts);
  const terms = tradeTerms({ programId: venueInstruction.programId, accounts, data: venueInstruction.data });
  const holding = terms ? heldIn(facts.get(terms.receiver.toBase58())?.data) : 0n;
  const withheld = input.coin?.transferFee && input.epoch !== undefined ? { coin: input.coin, epoch: input.epoch } : undefined;
  const instructions = agentTradeInstructions({ mandate, venueInstruction, holding, fee: input.fee, setup: input.setup ?? [], transferFee: withheld });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  /* A route too large for a packet: web3.js refuses to serialize it, and the agent says so instead of failing unnamed. */
  let tx: ReturnType<typeof unsignedTransaction>;
  let size: number;
  try {
    tx = unsignedTransaction(mandate.terms.agent, instructions, blockhash, input.lookupTables ?? []);
    size = wireSize(tx);
  } catch {
    return { status: "refused-by-agent", reason: `the trade is over the ${MAX_TRANSACTION_BYTES}-byte limit` };
  }
  if (size > MAX_TRANSACTION_BYTES) return { status: "refused-by-agent", reason: `the trade is ${size} bytes, over the ${MAX_TRANSACTION_BYTES}-byte limit` };
  let signature: Uint8Array;
  try {
    signature = await input.signer.signMessage(tx.message.serialize(), { lookupTables: input.lookupTables ?? [], facts, promisedOut: input.promisedOut, feeSides: input.feeSides, ...(input.epoch === undefined ? {} : { epoch: input.epoch }) });
  } catch (error) {
    if (error instanceof AgentSignerRefused) return { status: "refused-by-agent", reason: error.reason };
    throw error;
  }
  tx.addSignature(mandate.terms.agent, signature);
  const id = getBase58Decoder().decode(signature);
  await input.beforeSend?.({ signature: id, validUntilHeight: lastValidBlockHeight });
  try {
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: input.skipPreflight ?? false, maxRetries: 5 });
  } catch (error) {
    if (!refusedByNode(error)) return { status: "unknown", signature: id, size, validUntilHeight: lastValidBlockHeight };
    /* The RPC's simulation refused it: nothing landed, no fee was paid. */
    const logs = (error as { logs?: unknown }).logs;
    const refusal = Array.isArray(logs) ? refusalOf(logs.map(String)) : null;
    return { status: "refused-in-simulation", reason: refusal?.reason ?? (error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "refused") };
  }
  const read = await readBack(connection, id, TRADE_READ_TRIES);
  if (!read) return { status: "unknown", signature: id, size, validUntilHeight: lastValidBlockHeight };
  if (read.ok) return { status: "landed", signature: id, ok: true, size, computeUnits: read.computeUnits, fee: read.fee };
  return { status: "landed", signature: id, ok: false, size, refusal: refusalOf(read.logs), computeUnits: read.computeUnits, fee: read.fee };
}
