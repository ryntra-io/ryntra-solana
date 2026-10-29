/**
 * The collateral actions of «Ф'ючерси» (B6): a Review that checks the wallet may act, builds the deposit or the
 * withdrawal with Phoenix's own SDK, checks every instruction against the action, simulates it on the chain as it
 * stands and seals the bytes in a ticket; and a relay that sends the wallet's signed bytes — those and no others — once,
 * and reads the chain's answer. The pools' flow (`lib/liquidity/studio/actions.ts`), for one transaction.
 *
 * The amounts the Review shows come from the simulation, not from a formula: a deposit's USDC leaving the wallet, a
 * withdrawal's USDC arriving in it — after whatever Phoenix keeps as its withdrawal fee, which is then its own line.
 * The person's wallet signs; the server holds no key at all here. No fee of Ryntra's is added.
 */

import { ComputeBudgetProgram, PublicKey, Transaction, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";

import { networkFeeOf, redacted, signatureStates } from "../liquidity/studio/actions.ts";
import { BLOCKHASH_LIFE_BLOCKS, BLOCKHASH_SUBMIT_MARGIN_MS, readBlockhashLife, signableWindowMs, web3ChainReader, type ChainReader } from "../solana/blockhash-life.ts";
import {
  admitCollateral,
  checkSigned,
  collateralCallsOnly,
  collateralDigest,
  issueTicket,
  ownAta,
  parseCollateralRequest,
  PHOENIX_USD_MINT,
  readTicket,
  ticketKeyConfigured,
  TICKET_TTL_MS,
  traderAccountOf,
  USDC_MINT,
  usdcMovedOf,
  type BalanceRecord,
  web3Instruction,
  type CollateralAction,
  type CollateralRelay,
  type CollateralRequest,
  type Env,
  type KitInstruction,
  type PhoenixMargin,
} from "./collateral.ts";
import { buildV1Wire, setLoadedAccountsDataSizeLimit, viewOfWire, type TxView, type V1Limits } from "../solana/v1-tx.ts";

export type ActionFailure = Readonly<{ ok: false; status: number; code: string; reason: string }>;
const failure = (status: number, code: string, reason: string): ActionFailure => ({ ok: false, status, code, reason });

/** The wallet's trader account as Phoenix's API reads it: none yet, or its margin; null when Phoenix did not answer. */
export type TraderRead = Readonly<{ found: false }> | Readonly<{ found: true; margin: PhoenixMargin }>;

export type CollateralReview = Readonly<{
  action: CollateralAction;
  /** Micro-dollars as digits: what the action moves. */
  amount: string;
  /** What lands where it goes, from the simulation: the deposit's collateral, the withdrawal's USDC in the wallet. */
  receive: string;
  /** Kept by Phoenix on the way (a withdrawal's fee), micro-dollars; "0" when nothing is kept. */
  phoenixFee: string;
  /** The wallet's USDC before the action, micro-dollars. */
  walletUsdc: string;
  /** A withdrawal's after: what the account may still withdraw once this one is out, micro-dollars (Phoenix's figure less the amount); null for a deposit or when Phoenix did not say. */
  freeAfter: string | null;
  /** Rent of the token accounts the transaction opens for the wallet (it stays the wallet's), lamports. */
  rentLamports: string;
  networkFeeLamports: string;
  traderAccount: string;
  transaction: Readonly<{ wireBase64: string }>;
  ticket: string;
  /** ms on the server's clock; after it the bytes are refused and the person reviews again. */
  expiresAt: number;
  /** How long from arriving the person may still sign these bytes (`lib/solana/blockhash-life.ts`). */
  signableMs: number;
}>;

export type { CollateralRelay, RelayState } from "./collateral.ts";

export type CollateralDeps = Readonly<{
  env: Env;
  /** The endpoints in the order they are tried; the relay sends through the first. */
  connections: readonly Connection[];
  readTrader: (owner: string) => Promise<TraderRead | null>;
  /** Phoenix's SDK: the deposit's or the withdrawal's instructions, in order. */
  build: (request: CollateralRequest) => Promise<readonly KitInstruction[]>;
  now?: () => number;
  relayMs?: number;
  /** How long one call to an endpoint may take; 8 s unless a test says otherwise. */
  callMs?: number;
  pollMs?: number;
  chainReader?: (connection: Connection) => ChainReader;
}>;

/** A token account's balance in its raw units from its bytes (SPL layout: the amount at byte 64); 0 for none. */
export function tokenAmountOf(data: Buffer | null | undefined): bigint {
  if (!data || data.length < 72) return 0n;
  return data.readBigUInt64LE(64);
}

/* What the build pays for priority: a modest price, units from the simulation with room. Well under the relay's ceiling. */
export const PRIORITY_MICRO_LAMPORTS = 50_000;
const UNIT_ROOM = 1.2;
const MAX_UNITS = 1_400_000;
/*
 * The accounts' data a transaction may load, set explicitly as Phantom asks of a dApp («explicitly set compute unit and
 * loaded account data limits», docs.phantom.com, domain and transaction warnings): Phoenix's arenas and maps make a
 * deposit load about 2 MB, and a wallet that cannot predict the outcome warns that the site may be malicious. From the
 * simulation's own figure with a quarter's room, in 32 KiB pages; 8 MiB when the endpoint does not say.
 */
const LOADED_PAGE = 32 * 1024;
const LOADED_FALLBACK = 8 * 1024 * 1024;
const LOADED_MAX = 64 * 1024 * 1024;

export function loadedDataLimit(measured: unknown): number {
  if (typeof measured !== "number" || !Number.isFinite(measured) || measured <= 0) return LOADED_FALLBACK;
  return Math.min(LOADED_MAX, Math.ceil((measured * 1.25) / LOADED_PAGE) * LOADED_PAGE);
}

export { setLoadedAccountsDataSizeLimit };

/** One token account's rent: 165 bytes, rent-exempt. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

const CALL_MS = 8_000;
const RELAY_MS = 40_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), Math.max(1, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

class Refusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Endpoints in order: a refusal is the answer; an endpoint that fails gives way to the next. */
async function onFirstAnswering<T>(connections: readonly Connection[], run: (connection: Connection) => Promise<T>): Promise<Readonly<{ value: T; connection: Connection }>> {
  let last: unknown = new Error("No Solana endpoint is configured.");
  for (const connection of connections) {
    try {
      return { value: await run(connection), connection };
    } catch (error) {
      if (error instanceof Refusal) throw error;
      last = error;
    }
  }
  throw last;
}

type Built = Readonly<{
  /** The unsigned bytes the wallet signs, and what they do. */
  wire: string;
  view: TxView;
  networkFeeLamports: bigint;
  lastValidBlockHeight: number;
  walletUsdc: bigint;
  receive: bigint;
  rent: bigint;
}>;

type Simulated = Readonly<{ err: unknown; logs: readonly string[] | null; accounts: readonly (Readonly<{ data: readonly string[] }> | null)[] | null; unitsConsumed: number | null; loadedAccountsDataSize: number | null }>;

type RpcRequest = (method: string, args: unknown[]) => Promise<{ result?: { value?: Record<string, unknown> } & Record<string, unknown>; error?: { message?: string } }>;

/**
 * A simulation of base64 wire bytes through the endpoint's own JSON-RPC: web3.js 1.98 cannot carry a v1 transaction, the
 * endpoint can (Agave 4.2). The answer in the shape the checks read.
 */
async function simulateWire(connection: Connection, wireBase64: string, addresses: readonly string[] | null): Promise<Simulated> {
  const request = (connection as unknown as { _rpcRequest: RpcRequest })._rpcRequest;
  const answer = await request.call(connection, "simulateTransaction", [
    wireBase64,
    { encoding: "base64", sigVerify: false, commitment: "confirmed", ...(addresses ? { accounts: { addresses, encoding: "base64" } } : {}) },
  ]);
  if (answer.error || !answer.result?.value) throw new Error(`simulateTransaction: ${answer.error?.message ?? "no answer"}`);
  const value = answer.result.value;
  return {
    err: value.err ?? null,
    logs: (value.logs as string[] | null | undefined) ?? null,
    accounts: (value.accounts as Simulated["accounts"] | undefined) ?? null,
    unitsConsumed: typeof value.unitsConsumed === "number" ? value.unitsConsumed : null,
    loadedAccountsDataSize: typeof value.loadedAccountsDataSize === "number" ? value.loadedAccountsDataSize : null,
  };
}

/** The legacy simulation, through web3.js as before, in the same shape. */
async function simulateLegacy(connection: Connection, transaction: Transaction, addresses: readonly string[] | null): Promise<Simulated> {
  const answer = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, commitment: "confirmed", ...(addresses ? { accounts: { addresses: [...addresses], encoding: "base64" as const } } : {}) });
  const value = answer.value as typeof answer.value & { loadedAccountsDataSize?: unknown };
  return {
    err: value.err ?? null,
    logs: value.logs ?? null,
    accounts: (value.accounts as Simulated["accounts"] | undefined) ?? null,
    unitsConsumed: value.unitsConsumed ?? null,
    loadedAccountsDataSize: typeof value.loadedAccountsDataSize === "number" ? value.loadedAccountsDataSize : null,
  };
}

/** One endpoint's build: the wallet's balances, the transaction with its limits, and the simulation's amounts. */
async function buildOn(connection: Connection, request: CollateralRequest, instructions: readonly TransactionInstruction[], kit: readonly KitInstruction[]): Promise<Built> {
  const owner = new PublicKey(request.owner);
  const usdc = new PublicKey(ownAta(request.owner, USDC_MINT));
  const phoenixUsd = new PublicKey(ownAta(request.owner, PHOENIX_USD_MINT));
  const [accounts, latest] = await Promise.all([
    within(connection.getMultipleAccountsInfo([usdc, phoenixUsd], "confirmed"), CALL_MS),
    within(connection.getLatestBlockhash("confirmed"), CALL_MS),
  ]);
  const walletUsdc = tokenAmountOf(accounts[0]?.data);
  if (request.action === "deposit" && walletUsdc < request.amountMicro) throw new Refusal(422, "INSUFFICIENT_USDC", "The wallet holds less USDC than the deposit.");
  /* The accounts the transaction opens: Phoenix's dollar account always may; a withdrawal's USDC account too. */
  const opens = [accounts[1] ? 0 : 1, request.action === "withdraw" && !accounts[0] ? 1 : 0].reduce((sum, n) => sum + n, 0);
  const rent = BigInt(opens) * TOKEN_ACCOUNT_RENT_LAMPORTS;

  const watched = [usdc.toBase58(), phoenixUsd.toBase58()];
  const v1 = request.format === "v1";
  const v1Wire = (limits: V1Limits) => buildV1Wire({ owner: request.owner, instructions: kit, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, limits });
  /* A v1 draft carries the runtime's ceilings: an unset v1 limit is zero, not a default. */
  const simulated = await within(
    v1
      ? simulateWire(connection, v1Wire({ computeUnitLimit: MAX_UNITS, loadedAccountsDataSizeLimit: LOADED_MAX, priorityFeeLamports: 0n }), watched)
      : simulateLegacy(connection, new Transaction({ feePayer: owner, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(...instructions), watched),
    CALL_MS,
  );
  /* A wallet with no SOL cannot pay the network: the chain names its account not found, or the fee unpaid. */
  if (simulated.err === "AccountNotFound" || simulated.err === "InsufficientFundsForFee") throw new Refusal(422, "NEEDS_SOL", "The wallet has no SOL for the network fee.");
  if (simulated.err) {
    console.warn(`phoenix collateral: ${request.action} simulation refused — ${JSON.stringify(simulated.err).slice(0, 160)}; ${(simulated.logs ?? []).slice(-3).join(" | ").slice(0, 400)}`);
    throw new Refusal(422, "SIMULATION_FAILED", "The network would refuse this transaction now.");
  }
  const after = simulated.accounts?.[0];
  const passing = simulated.accounts?.[1];
  /* Both accounts exist after the build opens them: a simulation that does not show them is not one to show a person. */
  if (!after || !passing) throw new Refusal(503, "UNAVAILABLE", "Solana's simulation did not show the wallet's accounts.");
  const usdcAfter = tokenAmountOf(Buffer.from(after.data[0], "base64"));
  /* Phoenix's dollars only pass through the wallet's own account: what it held before, it holds after. */
  const phoenixUsdBefore = tokenAmountOf(accounts[1]?.data);
  if (tokenAmountOf(Buffer.from(passing.data[0], "base64")) !== phoenixUsdBefore) throw new Refusal(500, "BUILD_REFUSED", "The simulation left Phoenix's dollars in another state than it found them.");
  let receive: bigint;
  if (request.action === "deposit") {
    /* Ember converts 1:1: the USDC that left is what the account gets. Anything else is not the reviewed deposit. */
    if (walletUsdc - usdcAfter !== request.amountMicro) throw new Refusal(500, "BUILD_REFUSED", "The simulation moved another amount than the deposit.");
    receive = request.amountMicro;
  } else {
    receive = usdcAfter - walletUsdc;
    if (receive <= 0n || receive > request.amountMicro) throw new Refusal(500, "BUILD_REFUSED", "The simulation returned another amount than the withdrawal.");
  }

  const units = Math.min(MAX_UNITS, Math.ceil((simulated.unitsConsumed ?? 200_000) * UNIT_ROOM) + 10_000);
  const loaded = loadedDataLimit(simulated.loadedAccountsDataSize);
  /* The same priority both ways: a price per unit on legacy bytes, its total over the limit on v1's. */
  const priorityLamports = (BigInt(units) * BigInt(PRIORITY_MICRO_LAMPORTS) + 999_999n) / 1_000_000n;
  let wire: string;
  let finalRun: Simulated;
  if (v1) {
    wire = v1Wire({ computeUnitLimit: units, loadedAccountsDataSizeLimit: loaded, priorityFeeLamports: priorityLamports });
    finalRun = await within(simulateWire(connection, wire, null), CALL_MS);
  } else {
    const transaction = new Transaction({ feePayer: owner, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
      setLoadedAccountsDataSizeLimit(loaded),
      ...instructions,
    );
    wire = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    finalRun = await within(simulateLegacy(connection, transaction, null), CALL_MS);
  }
  /* The bytes the wallet will see, with every limit set, run once more: a limit too tight is refused here, not on the chain. */
  if (finalRun.err) {
    console.warn(`phoenix collateral: ${request.action} final simulation refused — ${JSON.stringify(finalRun.err).slice(0, 160)}`);
    throw new Refusal(422, "SIMULATION_FAILED", "The network would refuse this transaction now.");
  }
  const networkFeeLamports = v1 ? 5_000n + priorityLamports : networkFeeOf(wire);
  return { wire, view: viewOfWire(wire), networkFeeLamports, lastValidBlockHeight: latest.lastValidBlockHeight, walletUsdc, receive, rent };
}

/* ----------------------------------------------------------------- review */

/** What a withdrawal leaves free to withdraw, by Phoenix's figure at the Review; null for a deposit or an unknown figure. */
function freeAfterOf(request: CollateralRequest, margin: PhoenixMargin): string | null {
  if (request.action !== "withdraw" || margin.withdrawableMicro === null) return null;
  const left = margin.withdrawableMicro - request.amountMicro;
  return (left > 0n ? left : 0n).toString();
}

export async function reviewCollateral(body: unknown, deps: CollateralDeps): Promise<Readonly<{ ok: true; value: CollateralReview }> | ActionFailure> {
  const env = deps.env;
  const now = deps.now ?? Date.now;
  const request = parseCollateralRequest(body);
  if (!request) return failure(400, "BAD_REQUEST", "The action is not one this route builds.");
  const admitted = admitCollateral(request.owner, env);
  if (!admitted.ok) return failure(403, "ACTIONS_CLOSED", "Collateral actions are not open for this wallet yet.");
  if (!ticketKeyConfigured(env)) return failure(503, "ACTIONS_UNAVAILABLE", "The server cannot seal a Review now.");
  /* The canary's ceiling holds for both ways: a withdrawal is money moving as much as a deposit. */
  if (admitted.maxMicro !== null && request.amountMicro > admitted.maxMicro) return failure(403, "CANARY_LIMIT", "The check takes a smaller amount.");

  const trader = await deps.readTrader(request.owner).catch(() => null);
  if (trader === null) return failure(503, "PHOENIX_UNAVAILABLE", "Phoenix did not answer. Nothing was built.");
  /* Phoenix opens a trader account by an invite, a referral or a builder's onboarding (B7a §6): without one there is nowhere to deposit. */
  if (!trader.found) return failure(409, "ACCOUNT_NEEDED", "This wallet has no Phoenix account yet.");
  if (request.action === "deposit" && !trader.margin.canDeposit) return failure(409, "DEPOSIT_CLOSED", "Phoenix does not take a deposit on this account now.");
  if (request.action === "withdraw") {
    if (!trader.margin.canWithdraw) return failure(409, "WITHDRAW_CLOSED", "Phoenix does not allow a withdrawal on this account now.");
    if (trader.margin.withdrawableMicro !== null && request.amountMicro > trader.margin.withdrawableMicro) return failure(422, "OVER_WITHDRAWABLE", "More than the account may withdraw now.");
  }

  let instructions: TransactionInstruction[];
  let kit: readonly KitInstruction[];
  try {
    kit = await deps.build(request);
    instructions = kit.map(web3Instruction);
  } catch (error) {
    console.warn(`phoenix collateral: ${request.action} build — ${redacted(error)}`);
    return failure(503, "PHOENIX_UNAVAILABLE", "Phoenix did not answer. Nothing was built.");
  }

  let built: Built;
  let connection: Connection;
  try {
    const answer = await onFirstAnswering(deps.connections, (candidate) => buildOn(candidate, request, instructions, kit));
    built = answer.value;
    connection = answer.connection;
  } catch (error) {
    if (error instanceof Refusal) return failure(error.status, error.code, error.message);
    console.warn(`phoenix collateral: ${request.action} — ${redacted(error)}`);
    return failure(503, "UNAVAILABLE", "Solana did not answer. Nothing was built.");
  }

  const calls = collateralCallsOnly(built.view, request);
  if (!calls.ok) return failure(500, "BUILD_REFUSED", calls.reason);
  const wireBase64 = built.wire;
  const digest = collateralDigest(built.view);

  /* The bytes live as long as their blockhash, read from the chain; the ticket dies with them. */
  const life = await readBlockhashLife((deps.chainReader ?? ((c: Connection) => web3ChainReader(c, CALL_MS)))(connection), built.lastValidBlockHeight);
  if (life.state === "EXPIRED") return failure(503, "UNAVAILABLE", "Solana answered with a blockhash that has already expired. Nothing was built.");
  const ttlMs = Math.min(life.state === "LIVE" ? life.msLeft : BLOCKHASH_LIFE_BLOCKS * life.msPerSlot, TICKET_TTL_MS);
  const signableMs = Math.min(signableWindowMs(life), Math.max(0, ttlMs - BLOCKHASH_SUBMIT_MARGIN_MS));
  const issuedAt = now();
  const ticket = issueTicket({ owner: request.owner, action: request.action, amount: request.amountMicro.toString(), messages: [digest] }, env, issuedAt, ttlMs);
  if (!ticket) return failure(503, "ACTIONS_UNAVAILABLE", "The server cannot seal a Review now.");
  return {
    ok: true,
    value: {
      action: request.action,
      amount: request.amountMicro.toString(),
      receive: built.receive.toString(),
      phoenixFee: (request.amountMicro - built.receive).toString(),
      walletUsdc: built.walletUsdc.toString(),
      freeAfter: freeAfterOf(request, trader.margin),
      rentLamports: built.rent.toString(),
      networkFeeLamports: built.networkFeeLamports.toString(),
      traderAccount: traderAccountOf(request.owner),
      transaction: { wireBase64 },
      ticket,
      expiresAt: issuedAt + signableMs,
      signableMs,
    },
  };
}

/* ------------------------------------------------------------------ relay */

async function landed(connection: Connection, signature: string, deadline: number, pollMs: number): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>> {
  while (Date.now() < deadline) {
    const [status] = await signatureStates(connection, [signature], Math.min(CALL_MS, deadline - Date.now())).catch(() => [undefined]);
    if (status && status.state !== "UNKNOWN") return status;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { state: "UNKNOWN", reason: null };
}

/**
 * The fee payer's USDC as a landed transaction changed it, from the chain's record of the transaction (its token
 * balances before and after), micro-dollars with a sign; null when the chain did not show it. The fee payer is the
 * wallet that signed — the relay and the build both hold to that.
 */
export async function readUsdcMoved(connection: Connection, signature: string, ms = CALL_MS): Promise<string | null> {
  try {
    /* v1 bytes need the endpoint asked for v1 (an integer 1): web3.js 1.98 asks for 0 at most, and v1 would read as nothing. */
    const raw = (connection as unknown as { _rpcRequest?: RpcRequest })._rpcRequest;
    if (typeof raw === "function") {
      const answer = await within(raw.call(connection, "getTransaction", [signature, { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 1 }]), ms);
      const record = answer.result as unknown as { meta?: BalanceRecord | null; transaction?: { message?: { accountKeys?: readonly string[] } } } | null | undefined;
      const payer = record?.transaction?.message?.accountKeys?.[0];
      if (!record?.meta || typeof payer !== "string") return null;
      const moved = usdcMovedOf(record.meta, payer);
      return moved === null ? null : moved.toString();
    }
    const record = await within(connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }), ms);
    const payer = record?.transaction.message.staticAccountKeys[0]?.toBase58();
    if (!record?.meta || !payer) return null;
    const moved = usdcMovedOf(record.meta, payer);
    return moved === null ? null : moved.toString();
  } catch {
    return null;
  }
}

/**
 * The wallet's signed bytes, held to the ticket, sent once. A refusal before the send means nothing moved; once the
 * bytes have left, a timeout is answered by reading the signature, never by a second send.
 */
export async function submitCollateral(body: unknown, deps: CollateralDeps): Promise<Readonly<{ ok: true; value: CollateralRelay }> | ActionFailure> {
  const env = deps.env;
  const now = deps.now ?? Date.now;
  if (!body || typeof body !== "object") return failure(400, "BAD_REQUEST", "A relay takes a ticket and the signed transaction.");
  const { ticket: sealed, signed } = body as Record<string, unknown>;
  if (!Array.isArray(signed)) return failure(400, "BAD_REQUEST", "A relay takes a ticket and the signed transaction.");
  const read = readTicket(sealed, env, now());
  if (!read.ok) return read.code === "TICKET_EXPIRED" ? failure(410, "TICKET_EXPIRED", "The Review is older than its transaction; review again.") : failure(400, "TICKET_INVALID", "The Review's ticket is not one this server sealed.");
  const { ticket } = read;
  /* The gate as it stands now, not as it stood at the Review: closed, or a canary's ceiling below the sealed amount, sends nothing. */
  const admitted = admitCollateral(ticket.owner, env);
  if (!admitted.ok) return failure(403, "ACTIONS_CLOSED", "Collateral actions are not open for this wallet now.");
  if (admitted.maxMicro !== null && BigInt(ticket.amount) > admitted.maxMicro) return failure(403, "CANARY_LIMIT", "The check takes a smaller amount.");
  const checked = checkSigned(ticket, signed);
  if (!checked.ok) return failure(422, checked.code, checked.code === "NOT_SIGNED" ? "A signature is missing or does not match." : "The signed bytes are not the ones Review showed.");

  const connection = deps.connections[0];
  if (!connection) return failure(503, "UNAVAILABLE", "No Solana endpoint is configured.");
  const deadline = Date.now() + (deps.relayMs ?? RELAY_MS);
  try {
    await within(connection.sendRawTransaction(Buffer.from(checked.wire, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }), Math.min(deps.callMs ?? CALL_MS, deadline - Date.now()));
  } catch (error) {
    const message = redacted(error);
    /* A preflight refusal means the network never took the bytes — unless it saw them already, which is read from the chain. */
    if (/simulation failed|preflight|blockhash not found/i.test(message) && !/already been processed|AlreadyProcessed/i.test(message)) {
      console.warn(`phoenix collateral relay: ${ticket.action} refused before sending — ${message}`);
      return failure(422, /blockhash not found/i.test(message) ? "TICKET_EXPIRED" : "RELAY_REFUSED", "The network refused the transaction before it was sent. Nothing moved.");
    }
  }
  const answer = await landed(connection, checked.signature, deadline, deps.pollMs ?? 1_500);
  console.info(`phoenix collateral relay: ${ticket.action} ${checked.signature.slice(0, 8)}=${answer.state}`);
  const usdcMoved = answer.state === "LANDED" ? await readUsdcMoved(connection, checked.signature, Math.min(CALL_MS, Math.max(1_000, deadline - Date.now()))) : undefined;
  return { ok: true, value: { results: [{ signature: checked.signature, ...answer, ...(usdcMoved === undefined ? {} : { usdcMoved }) }], settled: answer.state === "LANDED" } };
}
