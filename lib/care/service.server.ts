/**
 * The agent looks after a person's Meteora pier, behind the city's window: the person says «look after it»
 * once, signs once, and walks away; the agent claims, reinvests, keeps the range around the price and leaves at the
 * person's stop, inside the two policies the person signed (`./terms.ts`).
 *
 * The window asks for four things, and each the person's wallet signs and this server only relays:
 * - `review` — the care's transactions: the smart account (when there is none), the SOL into the care vault, the two
 *   policies — one approval;
 * - `submit` — the signed transactions, each checked to be the built one, relayed in order; the care goes into the book;
 * - `status` — the cares of a wallet, what each holds and what the agent did today;
 * - `stop` — everything back: the position out through the person's own settings signature, the policies removed,
 *   the vault emptied to the wallet. Building it changes nothing: the care keeps working until the chain shows the
 *   person's signed stop (`relayStop`).
 * The agent (`careMinute`, the cron) reads each care of the book and does the one thing `./decide.ts` says.
 *
 * Every action is the proven wallet's own: the door (`./door.server.ts`) hands these functions only the address the
 * wallet proved, never one a request names.
 *
 * The switch goes by the release protocol (decision 92): devnet → a release with a point to roll back to → the person
 * who owns Ryntra tries it. `RYNTRA_AGENT_CARE` — `devnet` or `mainnet` opens it, anything else closes it (404); the
 * agent's key is the agent's budget's (`../mandate/agent-service.server.ts`: on mainnet only the registry's KMS key).
 * Ryntra takes no fee here: the fee table names none for looking after a position.
 */

import { LIQUIDITY_SHAPES, type LiquidityShape } from "../liquidity/studio/contract.ts";
import { createHash } from "node:crypto";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";

import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { agentKeyFor } from "../mandate/agent-service.server.ts";
import { unsignedTransaction, type SmartAccount } from "../mandate/human.ts";
import { mandateConnection, onNetwork, registryAgent } from "../mandate/service.server.ts";
import { NATIVE_MINT, readProgramConfig, readSettings, ssaAddress } from "../mandate/ssa.ts";
import { decide, inRange, careDay, type CareEvent, type PositionSnapshot } from "./decide.ts";
import { ownTokenAccount, planCareEnable, planCareStop, planCareWithdraw, type Care } from "./enable.ts";
import { careAct } from "./run.server.ts";
import type { DoorActions } from "./door.server.ts";
import { careSigner } from "./signer.server.ts";
import { careOwnerExecuteInstruction } from "./ssa-care.ts";
import { stockKeeperGate } from "./stock-keeper-gate.ts";
import { CARE_MAX_DAYS, type CarePool, type FeeMode } from "./terms.ts";
import { careWorth, NO_WORTH, type CareRecord } from "./worth.ts";
import { dlmmClaimToWallet, dlmmExit, dlmmOpen, dlmmPool, dlmmPositions, dlmmRebalance, type CareBuild } from "./venue.server.ts";

export const CARE_ENV = "RYNTRA_AGENT_CARE";
export const CARE_AGENT_ENV = "RYNTRA_AGENT_CARE_AGENT";
/** The book of cares in the Guard store: one row per care, keyed `c:<cluster>:<owner>:<vault index>`. */
export const CARE_BOOK = "agentCare" as const;
/** The width of the range the agent keeps around the price, in bins. */
export const CARE_WIDTH = 24;

type Env = Readonly<Record<string, string | undefined>>;
type Network = "devnet" | "mainnet";

export type CareGate = Readonly<{ open: true; network: Network; pool: null; agent: PublicKey }> | Readonly<{ open: false }>;

const addressOf = (text: string | undefined | null): PublicKey | null => {
  const value = text?.trim();
  if (!value) return null;
  try {
    const key = new PublicKey(value);
    return key.toBase58() === value ? key : null;
  } catch {
    return null;
  }
};

/** Open only where the switch names a network and the agent's address is known — on mainnet, the registry's only. */
export function careGate(env: Env = process.env): CareGate {
  const network = env[CARE_ENV]?.trim().toLowerCase();
  if (network !== "devnet" && network !== "mainnet") return { open: false };
  const named = addressOf(env[CARE_AGENT_ENV]);
  if (network === "mainnet") {
    const registry = registryAgent();
    if (!registry || (named && !named.equals(registry))) return { open: false };
    return { open: true, network, pool: null, agent: registry };
  }
  return named ? { open: true, network, pool: null, agent: named } : { open: false };
}

/** The agent's key is the budget's, chosen by network and address alone. */
const keyGate = (gate: Extract<CareGate, { open: true }>): Parameters<typeof agentKeyFor>[1] =>
  (gate.network === "devnet" ? { open: true, network: "devnet", pool: PublicKey.default, agent: gate.agent } : { open: true, network: "mainnet", pool: null, agent: gate.agent }) as Parameters<typeof agentKeyFor>[1];

/* ------------------------------------------------------------------ the book */

export type CareJson = Readonly<{
  cluster: Network;
  owner: string;
  settings: string;
  vaultIndex: number;
  vault: string;
  exitPolicy: string;
  tendPolicy: string;
  exitSeed: string;
  tendSeed: string;
  pool: Readonly<{ kind: CarePool["kind"]; address: string; mintX: string; mintY: string; programX: string; programY: string }>;
  fees: FeeMode;
  rebalance: boolean;
  stopBelow: number | null;
  expiresAt: string;
  agent: string;
}>;

export type CareEntry = Readonly<{
  v: 1;
  key: string;
  care: CareJson;
  status: "signing" | "working" | "stopped";
  /** The hashes of the messages the person was asked to sign, in order — only those are relayed. */
  messages: readonly string[];
  /** A row written before the stop ticket (`stopTicketKey`): the hashes of its «stop and take it back» messages. */
  stopMessages?: readonly string[];
  /** The range's width in bins the agent keeps around the price. */
  width: number;
  /** How the money spreads over those bins. */
  shape?: LiquidityShape;
  position: string | null;
  outOfRangeSince: number | null;
  lastRebalanceAt: number | null;
  lastClaimAt: number | null;
  events: readonly CareEvent[];
  createdAt: number;
  updatedAt: number;
}>;

const EVENTS_KEPT = 60;
const bookOf = (store: GuardStore) => store.collection<CareEntry>(CARE_BOOK);
const keyOf = (cluster: string, owner: string, vaultIndex: number) => `c:${cluster}:${owner}:${vaultIndex}`;

/**
 * The person's «stop» transactions as last built: the hashes of their messages — only those are relayed. Kept beside the
 * row (`s:<row key>`), never in it: the agent's pass rewrites its row and would drop them, and building a stop writes
 * nothing the agent reads. The care's and the keeper's alike (`./stock-keeper.server.ts`).
 */
export type StopTicket = Readonly<{ v: 1; messages: readonly string[]; at: number }>;
export const stopTicketKey = (key: string) => `s:${key}`;

export async function writeStopTicket(store: GuardStore, key: string, messages: readonly string[], at: number): Promise<void> {
  await store.collection<StopTicket>(CARE_BOOK).set(stopTicketKey(key), { v: 1, messages, at });
}

/** The hashes a stop of this row may relay: the ticket's, else those of a row written before the ticket. */
export async function stopMessagesOf(store: GuardStore, row: Readonly<{ key: string; stopMessages?: readonly string[] }>): Promise<readonly string[]> {
  const ticket = await store.collection<StopTicket>(CARE_BOOK).get(stopTicketKey(row.key));
  return ticket?.v === 1 && Array.isArray(ticket.messages) ? ticket.messages : (row.stopMessages ?? []);
}

export type RelayFailure = Readonly<{ ok: false; code: "SIGNED" | "RELAY"; reason: string }>;

/**
 * The person's signed stop, relayed in order — each one a built message, each awaited. A transaction the chain refuses
 * (its simulation, or its landing) stops the rest: what follows it in the stop was built on the state it would have left.
 */
export async function relaySigned(connection: Connection, messages: readonly string[], signed: readonly string[]): Promise<Readonly<{ ok: true; signatures: readonly string[] }> | RelayFailure> {
  const transactions: VersionedTransaction[] = [];
  for (const wire of signed) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return { ok: false, code: "SIGNED", reason: "A transaction could not be read." };
    }
    if (!messages.includes(sha(tx.message.serialize()))) return { ok: false, code: "SIGNED", reason: "Not a transaction that was built." };
    transactions.push(tx);
  }
  const signatures: string[] = [];
  for (const tx of transactions) {
    const id = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 }).catch((error: unknown) => (error instanceof Error ? error : new Error("refused")));
    if (id instanceof Error) return { ok: false, code: "RELAY", reason: id.message.split("\n")[0] ?? "refused" };
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const landed = await connection.confirmTransaction({ signature: id, blockhash, lastValidBlockHeight }, "confirmed").catch(() => null);
    if (landed?.value?.err) return { ok: false, code: "RELAY", reason: "The chain refused the transaction." };
    signatures.push(id);
  }
  return { ok: true, signatures };
}

export function careToJson(care: Care): CareJson {
  const p = care.terms.pool;
  return {
    cluster: care.cluster,
    owner: care.terms.human.toBase58(),
    settings: care.settings.toBase58(),
    vaultIndex: care.vaultIndex,
    vault: care.vault.toBase58(),
    exitPolicy: care.exitPolicy.toBase58(),
    tendPolicy: care.tendPolicy.toBase58(),
    exitSeed: care.exitSeed.toString(),
    tendSeed: care.tendSeed.toString(),
    pool: { kind: p.kind, address: p.address.toBase58(), mintX: p.mintX.toBase58(), mintY: p.mintY.toBase58(), programX: p.programX.toBase58(), programY: p.programY.toBase58() },
    fees: care.terms.fees,
    rebalance: care.terms.rebalance,
    stopBelow: care.terms.stopBelow,
    expiresAt: care.terms.expiresAt.toString(),
    agent: care.terms.agent.toBase58(),
  };
}

export function careFromJson(json: CareJson): Care {
  const pk = (value: string) => new PublicKey(value);
  return {
    cluster: json.cluster,
    terms: {
      human: pk(json.owner),
      agent: pk(json.agent),
      pool: { kind: json.pool.kind, address: pk(json.pool.address), mintX: pk(json.pool.mintX), mintY: pk(json.pool.mintY), programX: pk(json.pool.programX), programY: pk(json.pool.programY) },
      fees: json.fees,
      rebalance: json.rebalance,
      stopBelow: json.stopBelow,
      expiresAt: BigInt(json.expiresAt),
    },
    settings: pk(json.settings),
    vaultIndex: json.vaultIndex,
    vault: pk(json.vault),
    exitPolicy: pk(json.exitPolicy),
    tendPolicy: pk(json.tendPolicy),
    exitSeed: BigInt(json.exitSeed),
    tendSeed: BigInt(json.tendSeed),
  };
}

export async function caresOf(store: GuardStore, cluster: string, owner: string): Promise<readonly CareEntry[]> {
  return (await bookOf(store).valuesWithPrefix(`c:${cluster}:${owner}:`)).filter((row) => row && row.v === 1);
}

/* ------------------------------------------------------------------ review · submit */

export type CareFailure = Readonly<{ ok: false; code: string; reason: string }>;
const fail = (code: string, reason: string): CareFailure => ({ ok: false, code, reason });

export type CareReviewInput = Readonly<{ owner: string; pool: string; lamports: string; fees?: FeeMode; width?: number; shape?: LiquidityShape; stopPct?: number }>;

/** The stops the window offers: none, or leave when the price falls 10 % or 25 % from now. */
export const CARE_STOP_PCTS = [0, 10, 25] as const;

/** The pool the care is for, read from the chain: a DLMM pool of SOL and one coin of Token's program. */
async function carePoolOf(connection: Connection, address: PublicKey, cluster: Network): Promise<CarePool | null> {
  const pool = await dlmmPool(connection, { cluster, terms: { pool: { address } } } as unknown as Care).catch(() => null);
  if (!pool) return null;
  const x = pool.tokenX.publicKey;
  const y = pool.tokenY.publicKey;
  if (!x.equals(NATIVE_MINT) && !y.equals(NATIVE_MINT)) return null;
  const px = pool.tokenX.owner;
  const py = pool.tokenY.owner;
  return { kind: "dlmm", address, mintX: x, mintY: y, programX: px, programY: py };
}

async function smartAccountOf(connection: Connection, store: GuardStore, cluster: Network, owner: PublicKey): Promise<Readonly<{ account: SmartAccount; vaultIndex: number }>> {
  const cares = await caresOf(store, cluster, owner.toBase58());
  const known = cares.find((entry) => entry.status !== "signing")?.care.settings ?? null;
  if (known) {
    const info = await connection.getAccountInfo(new PublicKey(known), "confirmed");
    if (info) return { account: { kind: "present", settings: new PublicKey(known), state: readSettings(info.data) }, vaultIndex: Math.max(0, ...cares.map((entry) => entry.care.vaultIndex)) + 1 };
  }
  const config = await connection.getAccountInfo(ssaAddress.programConfig(), "confirmed");
  if (!config) throw new Error("the smart account program is not here");
  return { account: { kind: "absent", config: readProgramConfig(config.data) }, vaultIndex: 1 };
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export type CareReview = Readonly<{ ok: true; key: string; transactions: readonly string[]; goesIn: string; vault: string }>;

export async function reviewCare(input: CareReviewInput, deps: Readonly<{ env?: Env; store?: GuardStore; connection?: Connection; now?: () => number }> = {}): Promise<CareReview | CareFailure> {
  const gate = careGate(deps.env);
  if (!gate.open) return fail("CARE_CLOSED", "The agent does not look after piers here yet.");
  const owner = addressOf(input.owner);
  const poolKey = addressOf(input.pool);
  if (!owner || !poolKey) return fail("BAD_REQUEST", "The wallet or the pool is not an address.");
  if (!/^\d{1,19}$/.test(input.lamports) || BigInt(input.lamports) <= 0n) return fail("BAD_REQUEST", "Put in some SOL.");
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) return fail("NOT_NETWORK", `The endpoint is not ${gate.network}.`);
  const store = deps.store ?? getGuardRuntime().store;
  const pool = await carePoolOf(connection, poolKey, gate.network);
  if (!pool) return fail("CARE_POOL", "The agent looks after SOL piers of Meteora DLMM.");
  const stopPct = input.stopPct ?? 0;
  if (!(CARE_STOP_PCTS as readonly number[]).includes(stopPct)) return fail("BAD_REQUEST", "The stop is one the window offers.");
  const width = Math.round(input.width ?? CARE_WIDTH);
  if (!(width >= 6 && width <= 69)) return fail("BAD_REQUEST", "The range is 6 to 69 bins wide.");
  const shape = input.shape ?? "spot";
  if (!LIQUIDITY_SHAPES.includes(shape)) return fail("BAD_REQUEST", "The shape is one the window offers.");
  let stopBelow: number | null = null;
  if (stopPct > 0) {
    const read = await dlmmPool(connection, { cluster: gate.network, terms: { pool } } as unknown as Care);
    const price = Number((await read.getActiveBin()).pricePerToken);
    if (!(price > 0)) return fail("CARE_POOL", "The pool's price was not read.");
    stopBelow = price * (1 - stopPct / 100);
  }
  const now = deps.now?.() ?? Date.now();
  const nowSeconds = BigInt(Math.floor(now / 1000));
  const { account, vaultIndex } = await smartAccountOf(connection, store, gate.network, owner);
  const lamports = BigInt(input.lamports);
  const solIsX = pool.mintX.equals(NATIVE_MINT);
  let plan;
  try {
    plan = planCareEnable({
      cluster: gate.network,
      terms: { human: owner, agent: gate.agent, pool, fees: input.fees ?? "reinvest", rebalance: true, stopBelow, expiresAt: nowSeconds + BigInt(CARE_MAX_DAYS) * 86_400n },
      account,
      fund: solIsX ? { x: lamports, y: 0n } : { x: 0n, y: lamports },
      decimals: { x: solIsX ? 9 : 6, y: solIsX ? 6 : 9 },
      nowSeconds,
      vaultIndex,
    });
  } catch (error) {
    return fail("CARE_TERMS", error instanceof Error ? error.message : "The care is not written.");
  }
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const txs = plan.transactions.map((instructions) => unsignedTransaction(owner, instructions, blockhash, []));
  const care = careToJson(plan.care);
  const key = keyOf(gate.network, owner.toBase58(), vaultIndex);
  const entry: CareEntry = { v: 1, key, care, status: "signing", messages: txs.map((tx) => sha(tx.message.serialize())), width, shape, position: null, outOfRangeSince: null, lastRebalanceAt: null, lastClaimAt: null, events: [], createdAt: now, updatedAt: now };
  const existing = await bookOf(store).get(key);
  if (existing && existing.status !== "signing") return fail("CARE_TAKEN", "This care is already working.");
  await bookOf(store).set(key, entry);
  return { ok: true, key, transactions: txs.map((tx) => Buffer.from(tx.serialize()).toString("base64")), goesIn: lamports.toString(), vault: care.vault };
}

/** The person's signed transactions: each must be a built one, signed by them; relayed in order, each awaited. */
export async function submitCare(input: Readonly<{ owner: string; key: string; signed: readonly string[] }>, deps: Readonly<{ env?: Env; store?: GuardStore; connection?: Connection; now?: () => number }> = {}) {
  const gate = careGate(deps.env);
  if (!gate.open) return fail("CARE_CLOSED", "The agent does not look after piers here yet.");
  const store = deps.store ?? getGuardRuntime().store;
  const entry = await bookOf(store).get(input.key);
  if (!entry || entry.care.owner !== input.owner || entry.care.cluster !== gate.network || entry.status !== "signing") return fail("CARE_UNKNOWN", "Nothing to sign here.");
  if (input.signed.length !== entry.messages.length) return fail("CARE_SIGNED", "Not the transactions that were built.");
  const connection = deps.connection ?? mandateConnection(gate.network);
  const signatures: string[] = [];
  for (const [index, wire] of input.signed.entries()) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return fail("CARE_SIGNED", "A transaction could not be read.");
    }
    if (sha(tx.message.serialize()) !== entry.messages[index]) return fail("CARE_SIGNED", "Not the transactions that were built.");
    const id = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 }).catch((error: unknown) => (error instanceof Error ? error : new Error("refused")));
    if (id instanceof Error) return fail("CARE_RELAY", `The chain refused transaction ${index + 1}: ${id.message.split("\n")[0]}`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature: id, blockhash, lastValidBlockHeight }, "confirmed").catch(() => null);
    signatures.push(id);
  }
  const now = deps.now?.() ?? Date.now();
  await bookOf(store).set(entry.key, { ...entry, status: "working", updatedAt: now });
  return { ok: true as const, signatures };
}

/* ------------------------------------------------------------------ the agent at work */

const LAMPORTS = 1_000_000_000;

/** One care, one step: open what is not open, then what `decide` says. Returns the entry after it. */
export async function careStep(entry: CareEntry, deps: Readonly<{ env: Env; connection: Connection; store: GuardStore; now: number }>): Promise<CareEntry> {
  const gate = careGate(deps.env);
  if (!gate.open || entry.status !== "working") return entry;
  const care = careFromJson(entry.care);
  const key = agentKeyFor(deps.env, keyGate(gate));
  if (!key) return entry;
  /* The agent's journal is the budget's (`agentSignatures`): no row, no signature. */
  const signatures = deps.store.collection<object>("agentSignatures");
  const signer = careSigner(key, { care, journal: async (row) => signatures.set(`care:${row.cluster}:${row.messageSha256}:${row.outcome}`, row) });
  const pool = await dlmmPool(deps.connection, care);
  let gone = false;
  const act = async (build: CareBuild, kind: CareEvent["kind"], valueInY: number) => {
    const outcome = await careAct({ connection: deps.connection, care, signer, build });
    const ok = outcome.status === "landed" && outcome.ok;
    /* The person stopped the care, or it ran out: the agent stops trying (no fee paid to hear the chain say so). */
    if (outcome.status === "refused-by-agent" && /stopped|ended/.test(outcome.reason)) gone = true;
    const event: CareEvent = { at: deps.now, kind: ok ? kind : "refused", valueInY: ok ? valueInY : 0, signature: outcome.status === "landed" || outcome.status === "unknown" ? outcome.signature : null };
    return { ok, event };
  };
  const p = care.terms.pool;
  const idle = { x: await tokenHeld(deps.connection, care.vault, p.mintX, p.programX), y: await tokenHeld(deps.connection, care.vault, p.mintY, p.programY) };
  const positions = await dlmmPositions(pool, care);
  let next: CareEntry = entry;
  const push = (event: CareEvent, patch: Partial<CareEntry> = {}) => {
    next = { ...next, ...patch, ...(gone ? { status: "stopped" as const } : {}), events: [...next.events, event].slice(-EVENTS_KEPT), updatedAt: deps.now };
  };

  if (!positions.length) {
    if (idle.x + idle.y === 0n) return entry;
    const open = await dlmmOpen(pool, care, entry.width ?? CARE_WIDTH);
    const opened = await act(open, "open", 0);
    push(opened.event, opened.ok ? { position: open.position.toBase58() } : {});
    if (!opened.ok) return next;
    const fresh = await dlmmPool(deps.connection, care);
    const deposit = await act(await dlmmRebalance(fresh, care, open.position, idle, { withdraw: false, shape: entry.shape }), "open", Number(p.mintX.equals(NATIVE_MINT) ? idle.x : idle.y) / LAMPORTS);
    push(deposit.event);
    return next;
  }

  const position = positions[0]!;
  const active = await pool.getActiveBin();
  const price = Number(active.pricePerToken);
  const solIsY = p.mintY.equals(NATIVE_MINT);
  /* The other coin's fees in its own decimals — a staked SOL's 9, a dollar's 6 — never one number for every coin. */
  const otherUnit = 10 ** (chainDecimals(solIsY ? pool.tokenX : pool.tokenY) ?? 6);
  const feesInY = solIsY ? Number(position.feeY) / LAMPORTS + (Number(position.feeX) / otherUnit) * price : Number(position.feeX) / LAMPORTS;
  const snapshot: PositionSnapshot = {
    kind: "dlmm",
    price,
    activeBin: active.binId,
    lowerBin: position.lowerBin,
    upperBin: position.upperBin,
    feesInY,
    txCostInY: 0.00002,
    hasLiquidity: position.hasLiquidity,
    outOfRangeSince: entry.outOfRangeSince,
    lastRebalanceAt: entry.lastRebalanceAt,
    lastClaimAt: entry.lastClaimAt,
  };
  const seenOut = inRange(snapshot) ? null : (entry.outOfRangeSince ?? deps.now);
  next = { ...next, outOfRangeSince: seenOut };
  const action = decide({ ...snapshot, outOfRangeSince: seenOut }, { fees: care.terms.fees, rebalance: care.terms.rebalance, stopBelow: care.terms.stopBelow }, deps.now);
  if (action.kind === "exit") {
    const out = await act(await dlmmExit(pool, care, position), "exit", 0);
    push(out.event, out.ok ? { status: "stopped", position: null } : {});
  } else if (action.kind === "rebalance") {
    const moved = await act(await dlmmRebalance(pool, care, position.address, idle, { withdraw: true, shape: entry.shape }), "rebalance", 0);
    push(moved.event, moved.ok ? { lastRebalanceAt: deps.now, outOfRangeSince: null } : {});
  } else if (action.kind === "claim") {
    const build = action.to === "wallet" ? await dlmmClaimToWallet(pool, care, position.address) : await dlmmRebalance(pool, care, position.address, idle, { withdraw: false, shape: entry.shape });
    const claimed = await act(build, action.to === "wallet" ? "claim" : "reinvest", feesInY);
    push(claimed.event, claimed.ok ? { lastClaimAt: deps.now } : {});
  }
  return next;
}

/** The agent's pass over the book (the cron): each working care, one step; a care's failure never stops the others. */
/** One tick of a care belongs to one instance: two passes at once never act on the same care in the same window. */
export const CARE_TICK_MS = 9 * 60_000;

export async function claimTick(store: GuardStore, key: string, now: number): Promise<boolean> {
  return store.collection<Readonly<{ at: number }>>(CARE_BOOK).insertIfAbsent(`t:${key}:${Math.floor(now / CARE_TICK_MS)}`, { at: now });
}

export async function careMinute(
  env: Env = process.env,
  deps: Readonly<{ store?: GuardStore; connection?: Connection; now?: () => number; step?: typeof careStep; keyed?: boolean }> = {},
) {
  const gate = careGate(env);
  if (!gate.open) return { ran: false, reason: "closed" } as const;
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) return { ran: false, reason: "not the gate's network" } as const;
  if (!(deps.keyed ?? Boolean(agentKeyFor(env, keyGate(gate))))) return { ran: false, reason: "no agent key here" } as const;
  const store = deps.store ?? getGuardRuntime().store;
  const step = deps.step ?? careStep;
  const rows = (await bookOf(store).valuesWithPrefix(`c:${gate.network}:`)).filter((row) => row?.status === "working");
  let acted = 0;
  let skipped = 0;
  for (const row of rows) {
    const now = deps.now?.() ?? Date.now();
    /* Another pass holds this care's tick: it acts, this one does not. */
    if (!(await claimTick(store, row.key, now).catch(() => false))) {
      skipped += 1;
      continue;
    }
    try {
      /* The row as it stands now: the owner's stop may have landed since this pass read the book. */
      const fresh = await bookOf(store).get(row.key);
      if (!fresh || fresh.status !== "working") continue;
      const after = await step(fresh, { env, connection, store, now });
      if (after !== fresh) {
        /* Never written over the owner's stop that landed while the step ran. */
        const latest = await bookOf(store).get(row.key);
        if (latest?.status !== "working") continue;
        await bookOf(store).set(row.key, after);
        acted += 1;
      }
    } catch {
      /* The next pass reads this care again. */
    }
  }
  /* The stock pool's keeper, the same agent on the same cron — only where its own switch names a network, so a
     care without it loads nothing of DLMM Pro. Its failure never fails this pass. */
  const keeper = stockKeeperGate(env).open
    ? await import("./stock-keeper.server.ts").then((module) => module.stockKeeperMinute(env, { store, ...(deps.now ? { now: deps.now } : {}) })).catch(() => ({ ran: false, reason: "failed" }) as const)
    : null;
  return { ran: true, cares: rows.length, acted, skipped, ...(keeper ? { keeper } : {}) } as const;
}

/* ------------------------------------------------------------------ status · stop */

export type CareView = Readonly<{
  key: string;
  pool: string;
  status: CareEntry["status"];
  inRange: boolean | null;
  holdsX: string;
  holdsY: string;
  day: ReturnType<typeof careDay>;
  stopBelow: number | null;
  fees: FeeMode;
  /** The position at the venue's prices, USD — Earn's own source; null — not priced (devnet, no record). */
  valueUsd: number | null;
  /** Its fees not yet taken, USD; null — not priced. */
  unclaimedUsd: number | null;
  /**
   * A stopped care, as the chain stands: true — its policies or the vault's money are still there (the stop's
   * relay failed, or it was never finished), so the window keeps it with one «Withdraw»; false — all of it is back;
   * null — not read, or the care still works.
   */
  left: boolean | null;
}>;

/** The pool's prices as Earn reads them: Meteora's record of the pool, on mainnet only — a devnet coin has no price. */
export async function careRecordOf(network: Network, pool: string): Promise<CareRecord | null> {
  if (network !== "mainnet") return null;
  const { readPoolRecord } = await import("../liquidity/catalog/service.server.ts");
  const read = await readPoolRecord("dlmm", pool, { meteora: { timeoutMs: 3_000 } }).catch(() => null);
  const record = read?.pool;
  return record ? { x: { mint: record.x.mint, decimals: record.x.decimals, priceUsd: record.x.priceUsd }, y: { mint: record.y.mint, decimals: record.y.decimals, priceUsd: record.y.priceUsd } } : null;
}

type PriceRead = (network: Network, pool: string) => Promise<CareRecord | null>;

/** A side's decimals the venue's record left out, from the pool the chain gave (`DLMM.create`'s mints). */
const withChainDecimals = (record: CareRecord | null, pool: Readonly<{ tokenX: { publicKey: PublicKey; mint?: { decimals?: number } }; tokenY: { publicKey: PublicKey; mint?: { decimals?: number } } }>): CareRecord | null => {
  if (!record) return null;
  const fill = (side: CareRecord["x"]) => {
    if (side.decimals !== null) return side;
    const token = pool.tokenX.publicKey.toBase58() === side.mint ? pool.tokenX : pool.tokenY.publicKey.toBase58() === side.mint ? pool.tokenY : null;
    const decimals = token?.mint?.decimals;
    return typeof decimals === "number" ? { ...side, decimals } : side;
  };
  return { x: fill(record.x), y: fill(record.y) };
};

/** The accounts of a care the chain carries while anything of it is left: the two policies, the vault, the vault's two coins. */
const careAccounts = (care: Care): readonly PublicKey[] => [
  care.exitPolicy,
  care.tendPolicy,
  care.vault,
  ownTokenAccount(care.vault, care.terms.pool.mintX, care.terms.pool.programX),
  ownTokenAccount(care.vault, care.terms.pool.mintY, care.terms.pool.programY),
];
const LEFT_READ = 100;

/**
 * What of each stopped care the chain still carries, in one read for all of them: its policies (the agent's key
 * still has rights), the vault's SOL, the vault's coin accounts. Any of them there — true: the person's «stop and take it
 * back» is not finished, and the same stop builds what is left (`buildCareStop`). None — false: everything is back. The
 * chain did not answer — null for each, never a guess. Read only: nothing here is built or sent.
 */
export async function careLeftOnChain(connection: Pick<Connection, "getMultipleAccountsInfo">, cares: readonly Care[]): Promise<readonly (boolean | null)[]> {
  if (!cares.length) return [];
  const keys = cares.flatMap((care) => careAccounts(care));
  const read: unknown[] = [];
  for (let at = 0; at < keys.length; at += LEFT_READ) {
    const part = keys.slice(at, at + LEFT_READ);
    let got: unknown;
    try {
      got = await connection.getMultipleAccountsInfo([...part], "confirmed");
    } catch {
      got = null;
    }
    if (!Array.isArray(got) || got.length !== part.length) return cares.map(() => null);
    read.push(...got);
  }
  const each = careAccounts(cares[0]!).length;
  return cares.map((_, index) => read.slice(index * each, (index + 1) * each).some(Boolean));
}

export async function careStatus(owner: string, deps: Readonly<{ env?: Env; store?: GuardStore; connection?: Connection; now?: () => number; price?: PriceRead }> = {}) {
  const gate = careGate(deps.env);
  if (!gate.open) return fail("CARE_CLOSED", "The agent does not look after piers here yet.");
  const store = deps.store ?? getGuardRuntime().store;
  const connection = deps.connection ?? mandateConnection(gate.network);
  const now = deps.now?.() ?? Date.now();
  const rows = (await caresOf(store, gate.network, owner)).filter((row) => row.status !== "signing");
  const stopped = rows.filter((row) => row.status === "stopped");
  const leftRead = await careLeftOnChain(connection, stopped.map((row) => careFromJson(row.care)));
  const leftOf = new Map(stopped.map((row, index) => [row.key, leftRead[index] ?? null]));
  const views: CareView[] = [];
  for (const row of rows) {
    const care = careFromJson(row.care);
    let inside: boolean | null = null;
    let holdsX = "0";
    let holdsY = "0";
    let worth = NO_WORTH;
    if (row.status === "working") {
      const pool = await dlmmPool(connection, care).catch(() => null);
      const position = pool ? (await dlmmPositions(pool, care).catch(() => []))[0] : undefined;
      if (pool && position) {
        const [active, record] = await Promise.all([pool.getActiveBin(), (deps.price ?? careRecordOf)(gate.network, row.care.pool.address).catch(() => null)]);
        inside = active.binId >= position.lowerBin && active.binId <= position.upperBin;
        holdsX = position.amountX.toString();
        holdsY = position.amountY.toString();
        worth = careWorth(
          { mintX: row.care.pool.mintX, mintY: row.care.pool.mintY, holdsX: position.amountX, holdsY: position.amountY, feeX: position.feeX, feeY: position.feeY },
          withChainDecimals(record, pool as never),
        );
      }
    }
    views.push({ key: row.key, pool: row.care.pool.address, status: row.status, inRange: inside, holdsX, holdsY, day: careDay(row.events, null, now, { now: null, dayAgo: null }), stopBelow: row.care.stopBelow, fees: row.care.fees, valueUsd: worth.valueUsd, unclaimedUsd: worth.unclaimedUsd, left: leftOf.get(row.key) ?? null });
  }
  return { ok: true as const, network: gate.network, cares: views };
}

/** What an account of `owner` holds of a coin, by the coin's own token program (Token-2022's too); 0 — no account. */
async function tokenHeld(connection: Connection, owner: PublicKey, mint: PublicKey, program: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(ownTokenAccount(owner, mint, program), "confirmed");
  return info && info.data.length >= 72 ? Buffer.from(info.data).readBigUInt64LE(64) : 0n;
}

/**
 * A coin's decimals as the chain holds them: the pool's own read of its mint (`DLMM.create`), else the mint account
 * itself (byte 44 of every mint, Token-2022's too); null — not read.
 */
export function chainDecimals(read: Readonly<{ mint?: Readonly<{ decimals?: number }> }> | null | undefined, mintData: Uint8Array | null = null): number | null {
  const named = read?.mint?.decimals;
  if (typeof named === "number" && Number.isInteger(named) && named >= 0 && named <= 18) return named;
  return mintData && mintData.length >= 82 ? mintData[44]! : null;
}

async function coinDecimals(connection: Connection, mint: PublicKey, read: Readonly<{ mint?: Readonly<{ decimals?: number }> }> | undefined): Promise<number | null> {
  return chainDecimals(read) ?? chainDecimals(null, (await connection.getAccountInfo(mint, "confirmed").catch(() => null))?.data ?? null);
}

type StopDeps = Readonly<{ env?: Env; store?: GuardStore; connection?: Connection; now?: () => number; build?: typeof buildCareStop }>;

/**
 * Whether the chain still carries the care's two policies — the only rights the agent's key has here — or null where it
 * did not answer. Gone, the agent can do nothing more: that, and only that, is a stopped care.
 */
async function policiesLive(connection: Connection, care: Care): Promise<boolean | null> {
  const read = await Promise.all([connection.getAccountInfo(care.exitPolicy, "confirmed"), connection.getAccountInfo(care.tendPolicy, "confirmed")]).catch(() => null);
  return read ? read.some(Boolean) : null;
}

/**
 * The person's stop as the chain stands now, unsigned: each position out through the person's own settings signature,
 * the policies removed (where the chain still carries them — a stop asked again after they went would otherwise hold a
 * transaction that can only fail), the vault emptied. In that order: the policies go only once every position is out.
 */
export async function buildCareStop(connection: Connection, care: Care): Promise<Readonly<{ ok: true; transactions: readonly VersionedTransaction[] }> | CareFailure> {
  const owner = care.terms.human;
  const groups: (readonly import("@solana/web3.js").TransactionInstruction[])[] = [];
  const pool = await dlmmPool(connection, care);
  for (const position of await dlmmPositions(pool, care)) {
    const exit = await dlmmExit(pool, care, position);
    groups.push([...exit.setup.map((ix) => withPayer(ix, care.terms.agent, owner)), careOwnerExecuteInstruction({ settings: care.settings, signer: owner, instructions: exit.inner, accountIndex: care.vaultIndex })]);
  }
  const live = await policiesLive(connection, care);
  if (live === null) return fail("CARE_UNREAD", "The care was not read. Try again.");
  if (live) groups.push(planCareStop(care));
  const p = care.terms.pool;
  /* Each coin back by its own token program and its own decimals, as the chain holds them: a transfer with another
     coin's decimals is refused, and the person's money would stay in the vault. */
  const decimals = { x: await coinDecimals(connection, p.mintX, pool.tokenX), y: await coinDecimals(connection, p.mintY, pool.tokenY) };
  if (decimals.x === null || decimals.y === null) return fail("CARE_POOL", "The pool's coins were not read.");
  const lamports = BigInt((await connection.getBalance(care.vault, "confirmed").catch(() => 0)) ?? 0);
  groups.push(planCareWithdraw(care, { x: await tokenHeld(connection, care.vault, p.mintX, p.programX), y: await tokenHeld(connection, care.vault, p.mintY, p.programY), lamports }, { x: decimals.x, y: decimals.y }));
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return { ok: true, transactions: groups.map((instructions) => unsignedTransaction(owner, instructions, blockhash, [])) };
}

/**
 * Everything back, as the settings signer: the position's liquidity, fees and rent out to the person (the exit the
 * agent would make, signed by the person through the care vault — no policy, no agent), the policies removed, the
 * vault emptied. The window asks the wallet to sign the transactions in one approval.
 *
 * The owner's stop takes effect when it is asked: the row is «stopped» at once, so the agent's pass leaves the care
 * whatever happens to the transactions after (an exit built for a position the agent has since moved, a relay that
 * fails). Only the proven owner reaches here — the door (`door.server.ts`) hands the action the address the wallet
 * proved, never one a request names. The hashes the person may relay go to the stop ticket, the last built only.
 */
export async function stopCare(input: Readonly<{ owner: string; key: string }>, deps: StopDeps = {}) {
  const gate = careGate(deps.env);
  if (!gate.open) return fail("CARE_CLOSED", "The agent does not look after piers here yet.");
  const store = deps.store ?? getGuardRuntime().store;
  const entry = await bookOf(store).get(input.key);
  if (!entry || entry.care.owner !== input.owner || entry.care.cluster !== gate.network) return fail("CARE_UNKNOWN", "No such care.");
  const connection = deps.connection ?? mandateConnection(gate.network);
  const built = await (deps.build ?? buildCareStop)(connection, careFromJson(entry.care));
  if (!built.ok) return built;
  const at = deps.now?.() ?? Date.now();
  await writeStopTicket(store, entry.key, built.transactions.map((tx) => sha(tx.message.serialize())), at);
  /* The row as it is now — the agent's pass may have written it since it was read. */
  const latest = (await bookOf(store).get(entry.key)) ?? entry;
  if (latest.status !== "stopped") await bookOf(store).set(entry.key, { ...latest, status: "stopped", updatedAt: at });
  return { ok: true as const, transactions: built.transactions.map((tx) => Buffer.from(tx.serialize()).toString("base64")) };
}

/**
 * The person's signed «stop and take it back» transactions, relayed only when each is one that was built. The row is
 * already «stopped» since the stop was asked (`stopCare`); `stopped` tells the window whether the chain no longer carries
 * the policies.
 */
export async function relayStop(input: Readonly<{ owner: string; key: string; signed: readonly string[] }>, deps: StopDeps = {}) {
  const gate = careGate(deps.env);
  if (!gate.open) return fail("CARE_CLOSED", "The agent does not look after piers here yet.");
  const store = deps.store ?? getGuardRuntime().store;
  const entry = await bookOf(store).get(input.key);
  if (!entry || entry.care.owner !== input.owner || entry.care.cluster !== gate.network) return fail("CARE_UNKNOWN", "Nothing to send here.");
  const messages = await stopMessagesOf(store, entry);
  if (!messages.length) return fail("CARE_UNKNOWN", "Nothing to send here.");
  const connection = deps.connection ?? mandateConnection(gate.network);
  const relayed = await relaySigned(connection, messages, input.signed);
  if (!relayed.ok) return fail(`CARE_${relayed.code}`, relayed.reason);
  const stopped = (await policiesLive(connection, careFromJson(entry.care))) === false;
  if (stopped) {
    /* The row as it is now — the agent's pass may have written it since it was read. */
    const latest = (await bookOf(store).get(entry.key)) ?? entry;
    if (latest.status !== "stopped") await bookOf(store).set(entry.key, { ...latest, status: "stopped", updatedAt: deps.now?.() ?? Date.now() });
  }
  return { ok: true as const, signatures: relayed.signatures, stopped };
}

/** A token account the agent would have opened at its cost: in the person's own stop, the person pays it. */
function withPayer(instruction: import("@solana/web3.js").TransactionInstruction, from: PublicKey, to: PublicKey) {
  instruction.keys = instruction.keys.map((meta) => (meta.pubkey.equals(from) ? { ...meta, pubkey: to } : meta));
  return instruction;
}

/* ------------------------------------------------------------------ the door's actions */

/**
 * What each action of the care's door asks (`/api/city/earn/care`, `./door.server.ts`), for the wallet the door proved:
 * `owner` is that address, never the one the body names.
 */
export function careActions(deps: Readonly<{ env?: Env; store?: GuardStore; connection?: Connection; now?: () => number }> = {}): DoorActions {
  const signedOf = (body: Readonly<Record<string, unknown>>) => (Array.isArray(body.signed) ? body.signed.map(String) : []);
  const keyIn = (body: Readonly<Record<string, unknown>>) => String(body.key ?? "");
  return {
    review: (owner, body) =>
      reviewCare(
        {
          owner,
          pool: String(body.pool ?? ""),
          lamports: String(body.lamports ?? ""),
          fees: body.fees === "wallet" ? "wallet" : "reinvest",
          width: typeof body.width === "number" ? body.width : undefined,
          shape: typeof body.shape === "string" ? (body.shape as LiquidityShape) : undefined,
          stopPct: typeof body.stopPct === "number" ? body.stopPct : 0,
        },
        deps,
      ),
    submit: (owner, body) => submitCare({ owner, key: keyIn(body), signed: signedOf(body) }, deps),
    stop: (owner, body) => stopCare({ owner, key: keyIn(body) }, deps),
    relay: (owner, body) => relayStop({ owner, key: keyIn(body), signed: signedOf(body) }, deps),
    status: (owner) => careStatus(owner, deps),
  };
}
