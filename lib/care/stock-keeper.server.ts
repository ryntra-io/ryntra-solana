/**
 * The keeper of a stock pool's position, at work: narrow around the price while the exchange is open,
 * wider while it is closed, out of the way of a dividend, the fees to the wallet — inside the bounds the person signed
 * once (`./range-limits.ts`, chosen on the screen as `./stock-keeper-terms.ts`).
 *
 * It is the care's own agent, not a new one: the care's switch and key (`./service.server.ts`, `careGate` — on mainnet
 * the registry's KMS key), the care's book (`agentCare`, rows `k:`), the care's cron (`careMinute` runs this pass after
 * its own), the care's journal of signatures (`agentSignatures`). What it adds is the stock's rule
 * (`./stock-hours.ts`) and a move of the range (the venue's `range.move`, through the one door of DLMM Pro,
 * `lib/earn-pro/venue.server.ts`).
 *
 * **Where it works** (`keeperGate`): DLMM Pro earning served (`RYNTRA_EARN_PRO`), the care open (`RYNTRA_AGENT_CARE`) and
 * the keeper's own switch (`RYNTRA_STOCK_KEEPER`, `./stock-keeper-gate.ts`) — all three on one network, and the agent's
 * key here.
 * Closed, nothing here builds, signs
 * or reads, and what a keeper laid stays the person's in her pool.
 *
 * **What a person signs** (`reviewKeeper` → her wallet → `submitKeeper`): one transaction, built by the venue
 * (`range.approve`): the agent approved on the position's NFT with a care's three rights (collect the fees, collect the
 * rewards, take the liquidity out — each paid by the program only into her own accounts), and, for a keeper that puts
 * back, the two rights to lay a range and an SPL approval of one day's put-back on her own two accounts.
 *
 * **What the agent signs** (`keeperStep`): only what the venue built for this position, held to the keeper's lock on the
 * message's own bytes before the key signs (`keeperRefusalOf` for a move, `careRefusalOf` for a collect), and to the
 * person's bounds on the built move (`shiftRefusal`: width, time since the last, moves today, cost, put-back per move
 * and per day). Every signature is journalled first; no row, no signature.
 *
 * **Stop** (`stopKeeper`): the person's wallet signs the approval and the rights taken back, and the SPL approvals
 * revoked. Building it changes nothing: the keeper works as it did until the chain shows the agent's approval gone
 * (`relayKeeperStop`); only then is the row stopped.
 *
 * **Whose** — every action is the proven wallet's own: the door (`./door.server.ts`) hands these functions only the
 * address the wallet proved. **Which chain** — each step that reads or sends asks the endpoint's genesis first
 * (`onNetwork`): a devnet switch on a mainnet endpoint, or the other way round, builds and sends nothing.
 */

import { createHash } from "node:crypto";

import { createRevokeInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { inTokenY, lamportsInTokenY, proCareAction } from "../earn-pro/care.ts";
import type { AgentOutcome } from "../earn-pro/care.server.ts";
import { earnProGate, type EarnProNetwork } from "../earn-pro/gate.ts";
import { readPier, type ProPier } from "../earn-pro/piers.server.ts";
import type { StockSeats } from "../earn-pro/stocks.ts";
import { CARE_RIGHTS, DlmmProRefusal, KEEPER_RIGHTS, careRefusalOf, earnProConnection, earnProVenue, keeperRefusalOf, type DlmmProPool, type DlmmProTx, type DlmmProVenue, type KeeperMoveBuild } from "../earn-pro/venue.server.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { agentKeyFor } from "../mandate/agent-service.server.ts";
import { unsignedTransaction } from "../mandate/human.ts";
import { onNetwork } from "../mandate/service.server.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { keeperModeOf, keeperTermsOf, rangeLimitsRefusal, shiftRefusal, type CoinWords, type KeeperMode, type KeeperTerms, type RangeLimits } from "./range-limits.ts";
import type { DoorActions } from "./door.server.ts";
import { CARE_BOOK, careGate, claimTick, relaySigned, stopMessagesOf, writeStopTicket } from "./service.server.ts";
import { readStockFacts, standPoolsOf, type StockFactsRead } from "./stock-facts.server.ts";
import { openSeenAtOf, stockKeeperAction } from "./stock-hours.ts";
import { addRaw, hoursWord, isKeeperRow, keeperKey, keeperPrefix, keeperViewOf, rangeOfSlots, tickOfPrice, withKeeperEvent, withShift, type KeeperEntry, type KeeperEvent } from "./stock-keeper-book.ts";
import { stockKeeperGate } from "./stock-keeper-gate.ts";
import { approvalOf, keeperChoiceOf, keeperLimitsOf, putBackOf, type KeeperStatus } from "./stock-keeper-terms.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The band of the price a keeper's removal and deposit are built for, bps either way — inside the lock's ceiling. */
export const KEEPER_BAND_BPS = 100;
/** A row whose approval the chain never shows is let go after this long. */
export const KEEPER_PENDING_MS = 30 * 60_000;
/** How long one pass acts before it leaves the rest of the book to the next, ms. */
export const KEEPER_PASS_BUDGET_MS = 20_000;
/** What one of the agent's transactions costs it: a signature. */
const AGENT_TX_LAMPORTS = 5_000;

/* ------------------------------------------------------------------ the gate */

export type KeeperGate = Readonly<{ open: true; network: EarnProNetwork; agent: string; modes: readonly KeeperMode[] }> | Readonly<{ open: false }>;

/** Open where earning on DLMM Pro, the care and the keeper's switch all stand open on one network. */
export function keeperGate(env: Env = process.env): KeeperGate {
  const earn = earnProGate(env);
  const care = careGate(env);
  const keeper = stockKeeperGate(env);
  if (!earn.open || !care.open || !keeper.open || care.network !== earn.network || keeper.network !== earn.network) return { open: false };
  return { open: true, network: earn.network, agent: care.agent.toBase58(), modes: keeper.modes };
}

/** The agent's key for the gate, as the budget agent's switch says (on mainnet only KMS); null where it is not here. */
export function keeperKeyOf(env: Env, gate: Extract<KeeperGate, { open: true }>): KeySigner | null {
  const agent = new PublicKey(gate.agent);
  const keyGate = (gate.network === "devnet" ? { open: true, network: "devnet", pool: PublicKey.default, agent } : { open: true, network: "mainnet", pool: null, agent }) as Parameters<typeof agentKeyFor>[1];
  return agentKeyFor(env, keyGate);
}

/* ------------------------------------------------------------------ context */

export type KeeperDeps = Readonly<{
  env?: Env;
  store?: GuardStore;
  connection?: Connection;
  venue?: DlmmProVenue;
  now?: () => number;
  /** What the keeper reads of the exchange; a test or a rehearsal hands its own. */
  facts?: StockFactsRead;
  /** The stocks shelf; the route's own by default (`lib/earn-pro/stocks.server.ts`). */
  stocks?: StockSeats;
  key?: KeySigner | null;
}>;

type Context = Readonly<{ env: Env; network: EarnProNetwork; connection: Connection; venue: DlmmProVenue; store: GuardStore; now: () => number; facts: StockFactsRead; stocks: StockSeats | undefined }>;

function contextOf(gate: Extract<KeeperGate, { open: true }>, deps: KeeperDeps): Context {
  const env = deps.env ?? process.env;
  const connection = deps.connection ?? earnProConnection(gate.network);
  return { env, network: gate.network, connection, venue: deps.venue ?? earnProVenue(gate.network, connection, env), store: deps.store ?? getGuardRuntime().store, now: deps.now ?? Date.now, facts: deps.facts ?? readStockFacts, stocks: deps.stocks };
}

const bookOf = (store: GuardStore) => store.collection<KeeperEntry>(CARE_BOOK);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const base58 = getBase58Decoder();

const addressOf = (text: unknown): string | null => {
  if (typeof text !== "string") return null;
  try {
    return new PublicKey(text).toBase58() === text ? text : null;
  } catch {
    return null;
  }
};

export type KeeperFailure = Readonly<{ ok: false; code: string; reason: string }>;
const fail = (code: string, reason: string): KeeperFailure => ({ ok: false, code, reason });

/** The endpoint's genesis is the gate's network: the switches never mix devnet and mainnet. */
const notNetwork = async (context: Context): Promise<KeeperFailure | null> =>
  (await onNetwork(context.connection, context.network)) ? null : fail("NOT_NETWORK", `The endpoint is not ${context.network}.`);

/** The stocks shelf: the deployment's own, read lazily so that a test never loads the server's shelf. */
async function shelfOf(context: Context): Promise<StockSeats> {
  if (context.stocks) return context.stocks;
  return (await import("../earn-pro/stocks.server.ts")).readStockSeats;
}

/**
 * The pool as a keeper's: a pier of SOL against a checked stock of the shelf, or a devnet stand pool the
 * deployment names. Null for any other pool.
 */
async function keeperPierOf(context: Context, address: string): Promise<Readonly<{ pier: ProPier; pool: DlmmProPool; stockMint: string | null }> | null> {
  const stand = standPoolsOf(context.network, context.env).includes(address);
  const read = await readPier(context.network, address, { env: context.env, connection: context.connection, venue: context.venue, stocks: stand ? undefined : await shelfOf(context) }).catch(() => null);
  if (!read) return null;
  if (read.pier.stock) return { pier: read.pier, pool: read.pool, stockMint: read.pier.solIsX ? read.pier.y.mint : read.pier.x.mint };
  return stand ? { pier: read.pier, pool: read.pool, stockMint: null } : null;
}

/** Whether the rights the chain shows are exactly the ones a keeper of this mode was given. */
function rightsFit(may: readonly string[], mode: KeeperMode): boolean {
  const wanted: readonly string[] = mode === "shift" ? KEEPER_RIGHTS : CARE_RIGHTS;
  return may.length === wanted.length && wanted.every((right) => may.includes(right));
}

/* ------------------------------------------------------------------ review · submit */

export type KeeperReview = Readonly<{
  ok: true;
  key: string;
  network: EarnProNetwork;
  transactions: readonly string[];
  mode: KeeperMode;
  terms: KeeperTerms;
  coins: Readonly<{ x: CoinWords; y: CoinWords }>;
}>;

/**
 * The person's one signature for a keeper: the choice turned into bounds, the venue's approval built for them. The row
 * is written with the bounds pending; a keeper already at work keeps its bounds until the new approval lands.
 */
export async function reviewKeeper(input: Readonly<{ owner: unknown; pool: unknown; nftMint: unknown; choice: unknown }>, deps: KeeperDeps = {}): Promise<KeeperReview | KeeperFailure> {
  const env = deps.env ?? process.env;
  const gate = keeperGate(env);
  if (!gate.open) return fail("KEEPER_CLOSED", "The keeper does not work here.");
  /* A keeper is never given where nobody would sign its moves. */
  if (!(deps.key !== undefined ? deps.key : keeperKeyOf(env, gate))) return fail("KEEPER_CLOSED", "The keeper does not work here.");
  const owner = addressOf(input.owner);
  const pool = addressOf(input.pool);
  const nftMint = addressOf(input.nftMint);
  if (!owner || !pool || !nftMint) return fail("BAD_REQUEST", "The wallet, the pool or the position is not an address.");
  const choice = keeperChoiceOf(input.choice);
  if (!choice) return fail("BAD_REQUEST", "The bounds are ones the screen offers.");
  if (choice.putBack && !gate.modes.includes("shift")) return fail("KEEPER_MODE", "Here the agent only takes out to the wallet.");
  const context = contextOf(gate, { ...deps, env });
  const offNetwork = await notNetwork(context);
  if (offNetwork) return offNetwork;
  const read = await keeperPierOf(context, pool);
  if (!read) return fail("KEEPER_POOL", "The keeper looks after stock pools.");
  const { pier } = read;
  let income;
  try {
    /* The wallet holds the position's NFT: the venue refuses otherwise. */
    await context.venue.earn.care({ pool, nftMint, owner, agent: gate.agent });
    income = await context.venue.earn.income({ pool, nftMint }, read.pool);
  } catch (error) {
    return fail("KEEPER_POSITION", error instanceof DlmmProRefusal ? error.message : "The position was not read.");
  }
  if (income.position.pool !== pool) return fail("KEEPER_POSITION", "The position belongs to another pool.");
  const putBack = putBackOf({ xRaw: income.position.xRaw, yRaw: income.position.yRaw }, { price: pier.price, decimalsX: pier.x.decimals, decimalsY: pier.y.decimals });
  const limits = keeperLimitsOf(choice, putBack);
  const refusal = rangeLimitsRefusal(limits);
  if (refusal) return fail("BAD_REQUEST", refusal);
  const mode = keeperModeOf(limits);
  if (choice.putBack && mode !== "shift") return fail("KEEPER_EMPTY", "The position holds nothing to lay back.");
  const approval = approvalOf(limits);
  let build: DlmmProTx;
  try {
    build = await context.venue.range.approve({ pool, nftMint, owner, agent: gate.agent, approval: approval ?? { xRaw: "0", yRaw: "0" } });
  } catch (error) {
    return fail("KEEPER_REFUSED", error instanceof DlmmProRefusal ? error.message : "The approval was not built.");
  }
  const message = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64")).message.serialize();
  const at = context.now();
  const key = keeperKey(gate.network, owner, nftMint);
  const before = await bookOf(context.store).get(key);
  const pending = { choice, limits, approval, messages: [sha256(message)], at };
  const entry: KeeperEntry =
    isKeeperRow(before) && before.status === "working"
      ? { ...before, pending, updatedAt: at }
      : {
          v: 1,
          kind: "stock-keeper",
          key,
          network: gate.network,
          owner,
          pool,
          nftMint,
          agent: gate.agent,
          choice,
          limits,
          plan: choice.plan,
          approval,
          status: "signing",
          stoppedBy: null,
          confirmed: false,
          pending,
          openSeenAt: null,
          history: isKeeperRow(before) ? before.history : [],
          waiting: null,
          hours: null,
          shape: null,
          wait: null,
          lastClaimAt: isKeeperRow(before) ? before.lastClaimAt : null,
          events: isKeeperRow(before) ? before.events : [],
          createdAt: isKeeperRow(before) ? before.createdAt : at,
          updatedAt: at,
        };
  await bookOf(context.store).set(key, entry);
  return {
    ok: true,
    key,
    network: gate.network,
    transactions: [build.wireBase64],
    mode,
    terms: keeperTermsOf(limits, approval),
    coins: { x: { symbol: pier.x.symbol, decimals: pier.x.decimals }, y: { symbol: pier.y.symbol, decimals: pier.y.decimals } },
  };
}

/** The person's signed approval: each transaction the built one, relayed in order; the bounds then are the keeper's. */
export async function submitKeeper(input: Readonly<{ owner: unknown; key: unknown; signed: unknown }>, deps: KeeperDeps = {}): Promise<Readonly<{ ok: true; signatures: readonly string[]; seen: boolean }> | KeeperFailure> {
  const env = deps.env ?? process.env;
  const gate = keeperGate(env);
  if (!gate.open) return fail("KEEPER_CLOSED", "The keeper does not work here.");
  const context = contextOf(gate, { ...deps, env });
  const offNetwork = await notNetwork(context);
  if (offNetwork) return offNetwork;
  const entry = typeof input.key === "string" ? await bookOf(context.store).get(input.key) : undefined;
  const signed = Array.isArray(input.signed) ? input.signed.filter((wire): wire is string => typeof wire === "string") : [];
  if (!isKeeperRow(entry) || entry.owner !== input.owner || !entry.pending || entry.network !== gate.network) return fail("KEEPER_UNKNOWN", "Nothing to sign here.");
  const pending = entry.pending;
  if (signed.length !== pending.messages.length) return fail("KEEPER_SIGNED", "Not the transactions that were built.");
  const transactions: VersionedTransaction[] = [];
  for (const wire of signed) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return fail("KEEPER_SIGNED", "A transaction could not be read.");
    }
    if (sha256(tx.message.serialize()) !== pending.messages[transactions.length]) return fail("KEEPER_SIGNED", "Not the transactions that were built.");
    transactions.push(tx);
  }
  const signatures: string[] = [];
  for (const [index, tx] of transactions.entries()) {
    const id = await context.connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 }).catch((error: unknown) => (error instanceof Error ? error : new Error("refused")));
    if (id instanceof Error) return fail("KEEPER_RELAY", `The chain refused transaction ${index + 1}: ${id.message.split("\n")[0]}`);
    const { blockhash, lastValidBlockHeight } = await context.connection.getLatestBlockhash("confirmed");
    await context.connection.confirmTransaction({ signature: id, blockhash, lastValidBlockHeight }, "confirmed").catch(() => null);
    signatures.push(id);
  }
  const mode = keeperModeOf(pending.limits);
  const care = await context.venue.earn.care({ pool: entry.pool, nftMint: entry.nftMint, owner: entry.owner, agent: entry.agent }).catch(() => null);
  const seen = !!care && care.delegate === entry.agent && rightsFit(care.may, mode);
  const at = context.now();
  await bookOf(context.store).set(entry.key, {
    ...entry,
    choice: pending.choice,
    limits: pending.limits,
    plan: pending.choice.plan,
    approval: pending.approval,
    pending: null,
    status: "working",
    stoppedBy: null,
    confirmed: seen,
    updatedAt: at,
  });
  return { ok: true, signatures, seen };
}

/* ------------------------------------------------------------------ status · stop */

export async function keeperStatus(owner: unknown, deps: KeeperDeps = {}): Promise<(Readonly<{ ok: true }> & KeeperStatus) | KeeperFailure> {
  const env = deps.env ?? process.env;
  const gate = keeperGate(env);
  if (!gate.open) return fail("KEEPER_CLOSED", "The keeper does not work here.");
  const wallet = addressOf(owner);
  if (!wallet) return fail("BAD_REQUEST", "The wallet is not an address.");
  const store = deps.store ?? getGuardRuntime().store;
  const now = (deps.now ?? Date.now)();
  const rows = (await bookOf(store).valuesWithPrefix(keeperPrefix(gate.network, wallet))).filter(isKeeperRow).filter((row) => row.status !== "signing");
  return { ok: true, network: gate.network, modes: gate.modes, standPools: standPoolsOf(gate.network, env), keepers: rows.map((row) => keeperViewOf(row, now)) };
}

/** What the chain says of the agent on a position: still approved, gone from it, or not read. */
async function agentOnChain(context: Context, entry: KeeperEntry): Promise<Readonly<{ read: true; delegate: string | null; gone: boolean }> | Readonly<{ read: false }>> {
  try {
    const care = await context.venue.earn.care({ pool: entry.pool, nftMint: entry.nftMint, owner: entry.owner, agent: entry.agent });
    return { read: true, delegate: care.delegate ?? null, gone: false };
  } catch (error) {
    /* The wallet no longer holds the position (`keeperStep`'s «gone»): nothing of it is approved to anyone here. */
    if (error instanceof DlmmProRefusal && error.code === "BAD_INPUT") return { read: true, delegate: null, gone: true };
    return { read: false };
  }
}

/** The row stopped by its owner, as it is now — the agent's pass may have written it since it was read. */
async function markStopped(context: Context, entry: KeeperEntry): Promise<void> {
  const latest = await bookOf(context.store).get(entry.key);
  const row = isKeeperRow(latest) ? latest : entry;
  if (row.status === "stopped") return;
  await bookOf(context.store).set(entry.key, { ...row, status: "stopped", stoppedBy: "owner", pending: null, updatedAt: context.now() });
}

/**
 * Take it back, as the owner: her wallet signs the approval and every right taken back, and the SPL approvals on her own
 * two accounts revoked where the agent holds one. Only built here — the keeper works as it did until the chain shows
 * the agent's approval gone (`relayKeeperStop`). Where the chain shows nothing of the agent to take back, the row is
 * stopped as it stands.
 */
export async function stopKeeper(input: Readonly<{ owner: unknown; key: unknown }>, deps: KeeperDeps = {}): Promise<Readonly<{ ok: true; transactions: readonly string[] }> | KeeperFailure> {
  const env = deps.env ?? process.env;
  const gate = keeperGate(env);
  if (!gate.open) return fail("KEEPER_CLOSED", "The keeper does not work here.");
  const context = contextOf(gate, { ...deps, env });
  const offNetwork = await notNetwork(context);
  if (offNetwork) return offNetwork;
  const entry = typeof input.key === "string" ? await bookOf(context.store).get(input.key) : undefined;
  if (!isKeeperRow(entry) || entry.owner !== input.owner || entry.network !== gate.network) return fail("KEEPER_UNKNOWN", "No such keeper.");
  const onChain = await agentOnChain(context, entry);
  /* Not read is never «nothing to take back»: the approval may stand. */
  if (!onChain.read) return fail("KEEPER_UNREAD", "The position was not read. Try again.");
  const owner = new PublicKey(entry.owner);
  const agent = new PublicKey(entry.agent);
  const wires: string[] = [];
  if (onChain.delegate) wires.push((await context.venue.earn.endCare({ nftMint: entry.nftMint, owner: entry.owner })).wireBase64);
  /* The SPL approvals the agent holds on her accounts of the pool's two coins, revoked. */
  const pool = await context.venue.pools.read(entry.pool).catch(() => null);
  const revokes: TransactionInstruction[] = [];
  for (const mint of pool ? [pool.tokenX.mint, pool.tokenY.mint] : []) {
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const account = getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, program);
      const info = await context.connection.getAccountInfo(account, "confirmed").catch(() => null);
      if (!info || !info.owner.equals(program) || info.data.length < 165) continue;
      const data = Buffer.from(info.data);
      if (data.readUInt32LE(72) === 1 && new PublicKey(data.subarray(76, 108)).equals(agent)) revokes.push(createRevokeInstruction(account, owner, [], program));
    }
  }
  if (revokes.length) {
    const { blockhash } = await context.connection.getLatestBlockhash("confirmed");
    wires.push(Buffer.from(unsignedTransaction(owner, revokes, blockhash, []).serialize()).toString("base64"));
  }
  if (!wires.length) {
    await markStopped(context, entry);
    return { ok: true, transactions: [] };
  }
  await writeStopTicket(context.store, entry.key, wires.map((wire) => sha256(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message.serialize())), context.now());
  return { ok: true, transactions: wires };
}

/**
 * The person's signed «take it back» transactions, relayed only when each is one that was built. The row is stopped
 * once the chain no longer shows the agent approved on the position; until then the keeper works as it did.
 */
export async function relayKeeperStop(input: Readonly<{ owner: unknown; key: unknown; signed: unknown }>, deps: KeeperDeps = {}): Promise<Readonly<{ ok: true; signatures: readonly string[]; stopped: boolean }> | KeeperFailure> {
  const env = deps.env ?? process.env;
  const gate = keeperGate(env);
  if (!gate.open) return fail("KEEPER_CLOSED", "The keeper does not work here.");
  const context = contextOf(gate, { ...deps, env });
  const offNetwork = await notNetwork(context);
  if (offNetwork) return offNetwork;
  const entry = typeof input.key === "string" ? await bookOf(context.store).get(input.key) : undefined;
  if (!isKeeperRow(entry) || entry.owner !== input.owner || entry.network !== gate.network) return fail("KEEPER_UNKNOWN", "Nothing to send here.");
  const messages = await stopMessagesOf(context.store, entry);
  if (!messages.length) return fail("KEEPER_UNKNOWN", "Nothing to send here.");
  const signed = Array.isArray(input.signed) ? input.signed.filter((wire): wire is string => typeof wire === "string") : [];
  const relayed = await relaySigned(context.connection, messages, signed);
  if (!relayed.ok) return fail(`KEEPER_${relayed.code}`, relayed.reason);
  const onChain = await agentOnChain(context, entry);
  const stopped = onChain.read && onChain.delegate !== entry.agent;
  if (stopped) await markStopped(context, entry);
  return { ok: true, signatures: relayed.signatures, stopped };
}

/* ------------------------------------------------------------------ the agent signs */

/** One build, held to its lock on its own bytes, journalled, signed by the agent's key and sent once. */
export async function actAsKeeper(
  build: Pick<DlmmProTx, "wireBase64">,
  entry: Pick<KeeperEntry, "network" | "agent" | "nftMint">,
  context: Readonly<{ connection: Connection; store: GuardStore; key: KeySigner; now: () => number }>,
  lock: Readonly<{ action: "keeper.move" | "keeper.collect"; refusalOf: (message: Uint8Array) => string | null }>,
): Promise<AgentOutcome> {
  const tx = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64"));
  const message = tx.message.serialize();
  const agent = new PublicKey(entry.agent);
  const journal = context.store.collection<object>("agentSignatures");
  const digest = sha256(message);
  const row = (fields: Readonly<{ signature: string | null; outcome: "SIGNED" | "REFUSED"; reason: string | null }>) => ({
    v: 1,
    cluster: entry.network,
    role: "agent",
    mode: context.key.mode,
    signer: entry.agent,
    keyRef: context.key.keyRef,
    policy: `keeper:${entry.nftMint}`,
    action: lock.action,
    messageSha256: digest,
    ...fields,
    at: new Date(context.now()).toISOString(),
  });
  const refusal = lock.refusalOf(message);
  if (refusal) {
    await journal.set(`care:${entry.network}:${digest}:REFUSED`, row({ signature: null, outcome: "REFUSED", reason: refusal })).catch(() => undefined);
    return { status: "refused", reason: refusal };
  }
  const signature = await context.key.sign(message);
  if (signature.length !== 64 || !ed25519Valid(message, signature, agent)) return { status: "refused", reason: "the key's signature does not verify against the agent's address" };
  const id = base58.decode(signature);
  await journal.set(`care:${entry.network}:${digest}:SIGNED`, row({ signature: id, outcome: "SIGNED", reason: null }));
  tx.addSignature(agent, signature);
  try {
    await context.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  } catch (error) {
    const text = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "refused";
    if (/simulation failed|preflight|blockhash not found/i.test(text) && !/already been processed/i.test(text)) return { status: "refused", reason: text };
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await context.connection.getSignatureStatuses([id]).then((answer) => answer.value[0], () => null);
    if (status?.err) return { status: "failed", signature: id };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { status: "landed", signature: id };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { status: "unknown", signature: id };
}

/* ------------------------------------------------------------------ the pass */

export type KeeperStepContext = Context & Readonly<{ key: KeySigner; act?: typeof actAsKeeper }>;

/** A venue refusal that only says there is nothing to do now. */
const nothing = (error: unknown) => error instanceof DlmmProRefusal && error.code === "NOTHING_TO_DO";
/** A venue refusal that says the person's approval or wallet does not cover a move. */
const notCovered = (error: unknown) => error instanceof DlmmProRefusal && (error.code === "BALANCE_LOW" || /approval does not cover/.test(error.message));
const short = (text: string) => text.split("\n")[0]!.slice(0, 160);

/** One keeper, one step. Returns the row after it — the same object where nothing changed. */
export async function keeperStep(entry: KeeperEntry, context: KeeperStepContext): Promise<KeeperEntry> {
  const { venue } = context;
  const at = context.now();
  const subject = { pool: entry.pool, nftMint: entry.nftMint, owner: entry.owner };
  const asAgent = { ...subject, agent: entry.agent };
  const mode = keeperModeOf(entry.limits);

  /* The chain first: the owner may have taken the approval back, moved the position on, or closed it. */
  let care;
  try {
    care = await venue.earn.care(asAgent);
  } catch (error) {
    if (error instanceof DlmmProRefusal && error.code === "BAD_INPUT") return { ...entry, status: "stopped", stoppedBy: "gone", updatedAt: at };
    throw error;
  }
  if (care.delegate !== entry.agent || !rightsFit(care.may, mode)) {
    if (!entry.confirmed) return at - entry.updatedAt < KEEPER_PENDING_MS ? entry : { ...entry, status: "stopped", stoppedBy: null, updatedAt: at };
    return { ...entry, status: "stopped", stoppedBy: "owner", updatedAt: at };
  }

  const read = await keeperPierOf(context, entry.pool);
  /* No longer a keeper's pool here — the shelf did not read, a switch closed: nothing new is done; what it laid stays hers. */
  if (!read) return entry.confirmed ? entry : { ...entry, confirmed: true, updatedAt: at };
  const { pier, pool, stockMint } = read;
  const income = await venue.earn.income(subject, pool);
  const range = rangeOfSlots(income.position.slots, { x: pier.x.decimals, y: pier.y.decimals });
  const facts = await context.facts({ network: context.network, pool: entry.pool, stockMint, stockIsX: !pier.solIsX, env: context.env, now: at });
  const openSeenAt = openSeenAtOf(entry.openSeenAt, facts.session, at);
  /* A keeper that only takes out: once the pool holds a range again, the person put it back — nothing of it waits now. */
  const waiting = mode === "pull" && range !== null ? null : entry.waiting;
  const action = stockKeeperAction(
    { session: facts.session, openSeenAt, step: facts.step, poolPrice: pier.price, reference: facts.reference, range, waitingInWallet: waiting !== null, expectedGapBps: facts.expectedGapBps },
    entry.limits,
    entry.plan,
    entry.history,
    at,
  );
  let next: KeeperEntry = { ...entry, confirmed: true, openSeenAt, waiting, hours: hoursWord(facts.session, at), wait: action.kind === "wait" ? action.reason : null };
  const changed = () => (next.openSeenAt !== entry.openSeenAt || next.hours !== entry.hours || next.wait !== entry.wait || next.waiting !== entry.waiting || !entry.confirmed ? { ...next, updatedAt: at } : entry);

  const act = context.act ?? actAsKeeper;
  const bounds = { narrowestBps: entry.limits.narrowestBps, widestBps: entry.limits.widestBps, maxPutBackPerShift: entry.limits.maxPutBackPerShift };
  const keeperLock = { action: "keeper.move" as const, refusalOf: (message: Uint8Array) => keeperRefusalOf(message, { ...asAgent, mints: [pier.x.mint, pier.y.mint], tickSpacing: pier.tickSpacing, bounds }) };
  /* The steps of a move in order; each step's money is the owner's whatever the next one does. */
  const sendSteps = async (build: KeeperMoveBuild) => {
    const signatures: string[] = [];
    for (const step of build.steps) {
      const outcome = await act(step, entry, context, keeperLock);
      if (outcome.status !== "landed") return { landed: signatures, last: outcome };
      signatures.push(outcome.signature);
    }
    return { landed: signatures, last: null };
  };

  if (action.kind === "pull") {
    let build: KeeperMoveBuild;
    try {
      build = await venue.range.move({ ...asAgent, bounds, slippageBps: KEEPER_BAND_BPS, pull: true });
    } catch (error) {
      if (nothing(error)) return changed();
      throw error;
    }
    const sent = await sendSteps(build);
    if (sent.landed.length === build.steps.length) {
      return withKeeperEvent(next, { at, kind: "pull", signature: sent.landed.at(-1) ?? null }, { waiting: addRaw(waiting, build.takesOut.expected), shape: null });
    }
    const paid = sent.landed.length > 0 ? addRaw(waiting, build.takesOut.expected) : waiting;
    return withKeeperEvent(next, refusedOf(at, sent.last), { waiting: paid });
  }

  if (action.kind === "shift") {
    const centre = action.centerPrice === pier.price ? null : tickOfPrice(action.centerPrice, pier.x.decimals, pier.y.decimals);
    let build: KeeperMoveBuild;
    try {
      build = await venue.range.move({
        ...asAgent,
        bounds,
        halfWidthBps: action.halfWidthBps,
        ...(centre !== null ? { centerSqrtPriceX64: venue.range.sqrtPriceOfTick(centre) } : {}),
        slippageBps: KEEPER_BAND_BPS,
        ...(entry.waiting ? { topUp: entry.waiting } : {}),
      });
    } catch (error) {
      if (nothing(error)) return changed();
      if (notCovered(error)) {
        next = { ...next, wait: "approval" };
        return changed();
      }
      throw error;
    }
    /* The person's bounds on the move as built: what it costs and lays back, and the clock. */
    const refusal = shiftRefusal(entry.limits, { halfWidthBps: action.halfWidthBps, costLamports: build.costLamports, putBackXRaw: build.putsBack.xRaw, putBackYRaw: build.putsBack.yRaw }, entry.history, at);
    if (refusal) {
      next = { ...next, wait: refusal };
      return changed();
    }
    const sent = await sendSteps(build);
    if (sent.landed.length === 0) return withKeeperEvent(next, refusedOf(at, sent.last));
    /* A move counts on the bounds' clock once anything of it landed: its cost is spent. */
    const history = withShift(entry.history, { at, costLamports: build.costLamports, putBackXRaw: build.putsBack.xRaw, putBackYRaw: build.putsBack.yRaw });
    const whole = sent.landed.length === build.steps.length;
    const laid = whole && build.target !== null;
    const waiting = laid ? null : addRaw(entry.waiting, build.takesOut.expected);
    if (!whole) return withKeeperEvent(next, refusedOf(at, sent.last), { history, waiting });
    return withKeeperEvent(next, { at, kind: laid ? action.shape : "pull", signature: sent.landed.at(-1) ?? null }, { history, waiting, shape: laid ? action.shape : next.shape });
  }

  /* Nothing for the hours to do: the fees to the wallet once they are worth more than what collecting costs. */
  const hasLiquidity = income.position.slots.some((slot) => slot.unlocked !== "0");
  const scale = { price: pier.price, decimalsX: pier.x.decimals, decimalsY: pier.y.decimals };
  const rewarding = income.rewards.filter((reward) => reward.running || BigInt(reward.accruedRaw) > 0n);
  const claim = proCareAction(
    { price: pier.price, hasLiquidity, feesInY: inTokenY(BigInt(income.fees.xRaw), BigInt(income.fees.yRaw), scale), txCostInY: lamportsInTokenY((1 + rewarding.length) * AGENT_TX_LAMPORTS, pier) },
    { stopBelow: null, lastClaimAt: entry.lastClaimAt },
    at,
  );
  if (claim.kind !== "claim") return changed();
  const mints = [pier.x.mint, pier.y.mint, ...pool.rewards.map((reward) => reward.mint)];
  const careLock = { action: "keeper.collect" as const, refusalOf: (message: Uint8Array) => careRefusalOf(message, { ...asAgent, mints }) };
  const asSigner = { ...subject, signer: entry.agent };
  let signature: string | null = null;
  const fees = await venue.positions.collect(asSigner).catch((error: unknown) => (nothing(error) ? null : Promise.reject(error)));
  if (fees) {
    const sent = await act(fees, entry, context, careLock);
    if (sent.status !== "landed") return withKeeperEvent(next, refusedOf(at, sent));
    signature = sent.signature;
  }
  for (const reward of pool.rewards) {
    const built = await venue.rewards.collect({ ...asSigner, index: reward.index }).catch((error: unknown) => (nothing(error) ? null : Promise.reject(error)));
    if (!built) continue;
    const sent = await act(built, entry, context, careLock);
    if (sent.status !== "landed") return withKeeperEvent(next, refusedOf(at, sent));
    signature ??= sent.signature;
  }
  if (signature === null) return changed();
  return withKeeperEvent(next, { at, kind: "claim", signature }, { lastClaimAt: at });
}

function refusedOf(at: number, outcome: AgentOutcome | null): KeeperEvent {
  if (!outcome) return { at, kind: "refused", signature: null };
  if (outcome.status === "refused") return { at, kind: "refused", signature: null, reason: short(outcome.reason) };
  return { at, kind: "refused", signature: outcome.signature, reason: outcome.status };
}

/** The keeper's pass over its book (on the care's cron): each working row, one step; a row's failure never stops the others. */
export async function stockKeeperMinute(env: Env = process.env, deps: KeeperDeps & Readonly<{ step?: typeof keeperStep; act?: typeof actAsKeeper }> = {}) {
  const gate = keeperGate(env);
  if (!gate.open) return { ran: false, reason: "closed" } as const;
  const key = deps.key === undefined ? keeperKeyOf(env, gate) : deps.key;
  if (!key) return { ran: false, reason: "no agent key here" } as const;
  const context = contextOf(gate, { ...deps, env });
  if (await notNetwork(context)) return { ran: false, reason: "not the gate's network" } as const;
  const rows = (await bookOf(context.store).valuesWithPrefix(keeperPrefix(gate.network)))
    .filter(isKeeperRow)
    .filter((row) => row.status === "working")
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const step = deps.step ?? keeperStep;
  const until = context.now() + KEEPER_PASS_BUDGET_MS;
  let acted = 0;
  let skipped = 0;
  for (const row of rows) {
    if (context.now() >= until || !(await claimTick(context.store, row.key, context.now()).catch(() => false))) {
      skipped += 1;
      continue;
    }
    try {
      const after = await step(row, { ...context, key, ...(deps.act ? { act: deps.act } : {}) });
      if (after !== row) {
        await bookOf(context.store).set(row.key, after);
        acted += 1;
      }
    } catch {
      /* The next pass reads this keeper again. */
    }
  }
  return { ran: true, keepers: rows.length, acted, skipped } as const;
}

/* ------------------------------------------------------------------ the door's actions */

/**
 * What each action of the keeper's door asks (`/api/city/earn/keeper`, `./door.server.ts`), for the wallet the door
 * proved: `owner` is that address, never the one the body names.
 */
export function keeperActions(deps: KeeperDeps = {}): DoorActions {
  return {
    review: (owner, body) => reviewKeeper({ owner, pool: body.pool, nftMint: body.nftMint, choice: body.choice }, deps),
    submit: (owner, body) => submitKeeper({ owner, key: body.key, signed: body.signed }, deps),
    stop: (owner, body) => stopKeeper({ owner, key: body.key }, deps),
    relay: (owner, body) => relayKeeperStop({ owner, key: body.key, signed: body.signed }, deps),
    status: (owner) => keeperStatus(owner, deps),
  };
}

export type { RangeLimits };
