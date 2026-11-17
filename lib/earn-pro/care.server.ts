/**
 * The agent at work on the DLMM Pro positions people gave it to look after.
 *
 * - **the gate** — the care is served where earning on DLMM Pro is (`./gate.ts`) *and* the care is, on the same
 *   network (`RYNTRA_AGENT_CARE`): the agent and its key are that care's — the budget agent's, on mainnet the
 *   registry's key in KMS. Where the care's switch is closed the piers still work; they only offer no agent;
 * - **the book** — a row once the person's approval has landed and the chain itself shows the agent approved with a
 *   care's rights. Nothing is believed from the request;
 * - **the pass** (`proCareMinute`, on the cron) — each working row, one step: the position read from the chain,
 *   the one thing `./care.ts` chooses, built by the venue with the agent as the signer, held to the care's rules by
 *   its own bytes (the venue's `careRefusalOf`), signed, sent once, read back. A care the owner took back, or a
 *   position that is no longer the owner's, stops the row — it never errors the pass.
 *
 * The agent pays the network, and the rent of an owner's token account that is not there yet. It receives nothing:
 * the program pays every collect and every removal into the owner's own accounts.
 */

import { createHash } from "node:crypto";

import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import type { CareEvent } from "../care/decide.ts";
import { careGate, claimTick, CARE_BOOK } from "../care/service.server.ts";
import type { CareSignatureRow } from "../care/signer.server.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { agentKeyFor } from "../mandate/agent-service.server.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { EXIT_LANDS_WITHIN_MS, PRO_CARE_PENDING_MS, inTokenY, lamportsInTokenY, proCareAction, proCareKey, proCarePrefix, settleExit, watchOf, withEvent, type ProCareEntry } from "./care.ts";
import { coinKindOf } from "./coins.ts";
import { earnProGate, type EarnProNetwork } from "./gate.ts";
import { readPier } from "./piers.server.ts";
import { DlmmProRefusal, careRefusalOf, earnProConnection, earnProVenue, type DlmmProBuild, type DlmmProVenue } from "./venue.server.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type ProCareGate = Readonly<{ open: true; network: EarnProNetwork; agent: string }> | Readonly<{ open: false }>;

/**
 * Open where both switches stand open on one network and the agent's key is here: a care is never offered — never
 * given — where nobody would keep its stop. The agent is the care's own.
 */
export function proCareGate(env: Env = process.env): ProCareGate {
  const earn = earnProGate(env);
  const care = careGate(env);
  if (!earn.open || !care.open || care.network !== earn.network) return { open: false };
  const gate = { open: true, network: earn.network, agent: care.agent.toBase58() } as const;
  return proCareKey$(env, gate) ? gate : { open: false };
}

/**
 * The agent a care on this network would name, read from the switches alone — with or without its key here. A boat
 * still shows its agent, and can take it back, where the key is away; only giving a care needs the key.
 */
export function proCareAgent(env: Env = process.env): string | null {
  const earn = earnProGate(env);
  const care = careGate(env);
  return earn.open && care.open && care.network === earn.network ? care.agent.toBase58() : null;
}

/** The agent's key for the gate, as the budget agent's switch says; null where it is not here. */
export function proCareKey$(env: Env, gate: Extract<ProCareGate, { open: true }>): KeySigner | null {
  const agent = new PublicKey(gate.agent);
  const keyGate = (gate.network === "devnet" ? { open: true, network: "devnet", pool: PublicKey.default, agent } : { open: true, network: "mainnet", pool: null, agent }) as Parameters<typeof agentKeyFor>[1];
  return agentKeyFor(env, keyGate);
}

const bookOf = (store: GuardStore) => store.collection<ProCareEntry>(CARE_BOOK);
const isRow = (row: ProCareEntry | undefined): row is ProCareEntry => row?.v === 1 && row.kind === "dlmm-pro";

export type ProCareDeps = Readonly<{ env?: Env; store?: GuardStore; connection?: Connection; venue?: DlmmProVenue; now?: () => number; key?: KeySigner | null }>;

const contextOf = (gate: Extract<ProCareGate, { open: true }>, deps: ProCareDeps) => {
  const connection = deps.connection ?? earnProConnection(gate.network);
  return { connection, venue: deps.venue ?? earnProVenue(gate.network, connection, deps.env ?? process.env), store: deps.store ?? getGuardRuntime().store, now: deps.now ?? Date.now };
};

/** A held row, and the way back to the book as it was before it. */
export type ProCareHold = Readonly<{ entry: ProCareEntry; undo: () => Promise<void> }>;

/**
 * Before a person's approval is sent: the row, not yet confirmed — so that a relay whose answer is lost never leaves a
 * care on the chain with nobody keeping its stop. The agent's pass confirms it from the chain, or lets it go.
 */
export async function holdProCare(input: Readonly<{ owner: string; pool: string; nftMint: string; stopBelow: number | null }>, deps: ProCareDeps = {}): Promise<ProCareHold | null> {
  const gate = proCareGate(deps.env ?? process.env);
  if (!gate.open) return null;
  const store = deps.store ?? getGuardRuntime().store;
  const at = (deps.now ?? Date.now)();
  const key = proCareKey(gate.network, input.owner, input.nftMint);
  const before = await bookOf(store).get(key);
  const entry: ProCareEntry = {
    v: 1,
    kind: "dlmm-pro",
    key,
    network: gate.network,
    owner: input.owner,
    pool: input.pool,
    nftMint: input.nftMint,
    agent: gate.agent,
    stopBelow: input.stopBelow,
    status: "working",
    stoppedBy: null,
    confirmed: false,
    lastClaimAt: isRow(before) ? before.lastClaimAt : null,
    events: isRow(before) ? before.events : [],
    createdAt: isRow(before) ? before.createdAt : at,
    updatedAt: at,
  };
  await bookOf(store).set(key, entry);
  /* Where nothing was sent after all, the book goes back to what it held — the row before, or none — but only while the
     row is still this hold's: another tab's approval, or a pass, written since, is left as it is. */
  const undo = async () => {
    const now = await bookOf(store).get(key);
    if (!isRow(now) || now.confirmed || now.updatedAt !== entry.updatedAt || now.stopBelow !== entry.stopBelow) return;
    if (isRow(before)) await bookOf(store).set(key, before);
    else await bookOf(store).delete(key);
  };
  return { entry, undo };
}

/** The cares of a wallet on the gate's network, newest first. */
export async function proCaresOf(owner: string, deps: ProCareDeps = {}): Promise<readonly ProCareEntry[]> {
  const gate = proCareGate(deps.env ?? process.env);
  if (!gate.open) return [];
  const store = deps.store ?? getGuardRuntime().store;
  return (await bookOf(store).valuesWithPrefix(proCarePrefix(gate.network, owner))).filter(isRow).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * After a person's approval landed: the row, once the chain shows the agent approved on this very position with a
 * care's rights. Returns null where the chain does not show it — nothing is written on the request's word.
 */
export async function recordProCare(input: Readonly<{ owner: string; pool: string; nftMint: string; stopBelow: number | null }>, deps: ProCareDeps = {}): Promise<ProCareEntry | null> {
  const gate = proCareGate(deps.env ?? process.env);
  if (!gate.open) return null;
  const { venue, store, now } = contextOf(gate, deps);
  const care = await venue.earn.care({ pool: input.pool, nftMint: input.nftMint, owner: input.owner, agent: gate.agent }).catch(() => null);
  if (!care?.cares) return null;
  const at = now();
  const key = proCareKey(gate.network, input.owner, input.nftMint);
  const before = await bookOf(store).get(key);
  const entry: ProCareEntry = {
    v: 1,
    kind: "dlmm-pro",
    key,
    network: gate.network,
    owner: input.owner,
    pool: input.pool,
    nftMint: input.nftMint,
    agent: gate.agent,
    stopBelow: input.stopBelow,
    status: "working",
    stoppedBy: null,
    confirmed: true,
    lastClaimAt: isRow(before) ? before.lastClaimAt : null,
    events: isRow(before) ? before.events : [],
    createdAt: isRow(before) ? before.createdAt : at,
    updatedAt: at,
  };
  await bookOf(store).set(key, entry);
  return entry;
}

/** After the person took the care back: the row stops. The chain is the authority either way — the agent's next read finds no approval. */
export async function endProCare(input: Readonly<{ owner: string; nftMint: string }>, deps: ProCareDeps = {}): Promise<void> {
  const gate = proCareGate(deps.env ?? process.env);
  if (!gate.open) return;
  const store = deps.store ?? getGuardRuntime().store;
  const key = proCareKey(gate.network, input.owner, input.nftMint);
  const row = await bookOf(store).get(key);
  if (isRow(row) && row.status === "working") await bookOf(store).set(key, { ...row, status: "stopped", stoppedBy: "owner", updatedAt: (deps.now ?? Date.now)() });
}

/* ------------------------------------------------------------------ the agent signs */

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const base58 = getBase58Decoder();
/** What one of the agent's transactions costs it: a signature. */
const AGENT_TX_LAMPORTS = 5_000;

export type AgentOutcome = Readonly<{ status: "landed"; signature: string }> | Readonly<{ status: "failed"; signature: string }> | Readonly<{ status: "refused"; reason: string }> | Readonly<{ status: "unknown"; signature: string }>;

/** One build, signed by the agent's key within the care's rules and sent once. No journal row, no signature. */
export async function actAsAgent(build: DlmmProBuild, entry: ProCareEntry, context: Readonly<{ connection: Connection; store: GuardStore; key: KeySigner; now: () => number; mints?: readonly string[] }>): Promise<AgentOutcome> {
  const tx = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64"));
  const message = tx.message.serialize();
  const agent = new PublicKey(entry.agent);
  const journal = context.store.collection<object>("agentSignatures");
  const row = (fields: Pick<CareSignatureRow, "signature" | "outcome" | "reason">): CareSignatureRow => ({
    v: 1,
    cluster: entry.network,
    role: "agent",
    mode: context.key.mode,
    signer: entry.agent,
    keyRef: context.key.keyRef,
    /* The care's own name where the rows name a policy: the position it is given. */
    policy: `dlmm-pro:${entry.nftMint}`,
    action: "care.action",
    messageSha256: sha256(message),
    ...fields,
    at: new Date(context.now()).toISOString(),
  });
  const keyOf = (outcome: string) => `care:${entry.network}:${sha256(message)}:${outcome}`;
  const refusal = careRefusalOf(message, { agent: entry.agent, owner: entry.owner, pool: entry.pool, nftMint: entry.nftMint, ...(context.mints ? { mints: context.mints } : {}) });
  if (refusal) {
    await journal.set(keyOf("REFUSED"), row({ signature: null, outcome: "REFUSED", reason: refusal })).catch(() => undefined);
    return { status: "refused", reason: refusal };
  }
  const signature = await context.key.sign(message);
  if (signature.length !== 64 || !ed25519Valid(message, signature, agent)) return { status: "refused", reason: "the key's signature does not verify against the agent's address" };
  const id = base58.decode(signature);
  await journal.set(keyOf("SIGNED"), row({ signature: id, outcome: "SIGNED", reason: null }));
  tx.addSignature(agent, signature);
  try {
    await context.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
  } catch (error) {
    const text = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "refused";
    /* A preflight refusal means the network never took the bytes; anything else may have landed, so the chain is asked. */
    if (/simulation failed|preflight|blockhash not found/i.test(text) && !/already been processed/i.test(text)) return { status: "refused", reason: text };
  }
  /* Up to a dozen seconds: a pass has a minute for every care it holds; what is not seen yet is read again next pass. */
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await context.connection.getSignatureStatuses([id]).then((answer) => answer.value[0], () => null);
    if (status?.err) return { status: "failed", signature: id };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { status: "landed", signature: id };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { status: "unknown", signature: id };
}

/* ------------------------------------------------------------------ the pass */

type StepContext = Readonly<{ env: Env; network: EarnProNetwork; connection: Connection; venue: DlmmProVenue; store: GuardStore; key: KeySigner; now: () => number; act?: typeof actAsAgent }>;

const refusedEvent = (at: number): CareEvent => ({ at, kind: "refused", valueInY: 0, signature: null });

/** A build the venue has nothing to make of — no fee yet, no reward yet — is skipped; any other refusal is the caller's. */
async function buildOrNothing<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DlmmProRefusal && error.code === "NOTHING_TO_DO") return null;
    throw error;
  }
}

/** The rent the agent would pay to open the owner's accounts of these coins that are not there yet — either token program's. */
async function openingRent(connection: Connection, owner: string, mints: readonly string[]): Promise<number> {
  const coins = [...new Set(mints)];
  const holder = new PublicKey(owner);
  const addresses = coins.flatMap((mint) => [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) => getAssociatedTokenAddressSync(new PublicKey(mint), holder, true, program)));
  const accounts = await connection.getMultipleAccountsInfo(addresses, "confirmed").catch(() => null);
  const missing = accounts === null ? coins.length : coins.filter((_, index) => !accounts[2 * index] && !accounts[2 * index + 1]).length;
  if (missing === 0) return 0;
  /* A Token-2022 account with its extensions (a transfer hook, a pause) is larger than a classic one: the larger rent is counted. */
  return missing * (await connection.getMinimumBalanceForRentExemption(191, "confirmed").catch(() => 2_220_240));
}

/** One care, one step. Returns the row after it — the same object where nothing changed. */
export async function proCareStep(entry: ProCareEntry, context: StepContext): Promise<ProCareEntry> {
  const { venue } = context;
  const at = context.now();
  const subject = { pool: entry.pool, nftMint: entry.nftMint, owner: entry.owner };
  const asAgent = { ...subject, signer: entry.agent };
  /* The chain first: the owner may have taken the care back, moved the position on, or closed it, with no word to us. */
  let care;
  try {
    care = await venue.earn.care({ ...subject, agent: entry.agent });
  } catch (error) {
    if (error instanceof DlmmProRefusal && error.code === "BAD_INPUT") return { ...entry, status: "stopped", stoppedBy: "gone", updatedAt: at };
    throw error;
  }
  if (!care.cares) {
    /* Not confirmed yet: the approval may still be on its way — until the row has waited long enough, then it is let go. */
    if (!entry.confirmed) return at - entry.updatedAt < PRO_CARE_PENDING_MS ? entry : { ...entry, status: "stopped", stoppedBy: null, updatedAt: at };
    return { ...entry, status: "stopped", stoppedBy: "owner", updatedAt: at };
  }
  let confirmedEntry: ProCareEntry = entry.confirmed ? entry : { ...entry, confirmed: true, updatedAt: at };
  /* A removal at the stop not seen last pass: its signature says — landed, the exit; refused or too old, dropped; neither
     yet, the row waits and no second removal is sent while the first may still land. */
  if (confirmedEntry.exitSent) {
    const sent = confirmedEntry.exitSent;
    const status = await context.connection.getSignatureStatuses([sent.signature], { searchTransactionHistory: true }).then((answer) => answer.value[0] ?? null, () => undefined);
    if (status === undefined) return confirmedEntry;
    const landed = status !== null && !status.err && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");
    if (!landed && !status?.err && at - sent.at < EXIT_LANDS_WITHIN_MS) return confirmedEntry;
    confirmedEntry = settleExit(confirmedEntry, landed);
  }
  const read = await readPier(entry.network, entry.pool, { env: context.env, connection: context.connection, venue });
  if (!read) return confirmedEntry;
  const { pier, pool } = read;
  const income = await venue.earn.income(subject, pool);
  const scale = { price: pier.price, decimalsX: pier.x.decimals, decimalsY: pier.y.decimals };
  const hasLiquidity = income.position.slots.some((slot) => slot.unlocked !== "0");
  const watch = watchOf(pier, coinKindOf(entry.network, pier.solIsX ? pier.y.mint : pier.x.mint, context.env));
  /* A collect costs the agent a signature for each transaction it sends — the fees, and each reward the venue collects:
     running, or with something accrued — and the rent of every owner's account the payout must open first. */
  const rewarding = income.rewards.filter((reward) => reward.running || BigInt(reward.accruedRaw) > 0n);
  const accountRent = await openingRent(context.connection, entry.owner, [pier.x.mint, pier.y.mint, ...rewarding.map((reward) => reward.mint)]);
  const action = proCareAction(
    { price: watch.value, hasLiquidity, feesInY: inTokenY(BigInt(income.fees.xRaw), BigInt(income.fees.yRaw), scale), txCostInY: lamportsInTokenY((1 + rewarding.length) * AGENT_TX_LAMPORTS + accountRent, pier) },
    confirmedEntry,
    at,
  );
  entry = confirmedEntry;
  /* Already out at the stop: whatever is left to collect is collected, and only then is the care done. */
  const outAtStop = !hasLiquidity && entry.events.some((event) => event.kind === "exit");
  if (!outAtStop && (action.kind === "wait" || action.kind === "rebalance")) return entry;

  const act = context.act ?? actAsAgent;
  /* The coins the agent may open an owner's account of: the pool's two, and its rewards'. */
  const mints = [pier.x.mint, pier.y.mint, ...pool.rewards.map((reward) => reward.mint)];
  const send = (build: DlmmProBuild) => act(build, entry, { ...context, mints });
  const rewardIndexes = pool.rewards.map((reward) => reward.index);
  /* The fees and each reward the pool has: whatever the venue finds something of. */
  const collectAll = async (): Promise<Readonly<{ ok: boolean; signature: string | null }>> => {
    let signature: string | null = null;
    const fees = await buildOrNothing(() => venue.positions.collect(asAgent));
    if (fees) {
      const sent = await send(fees);
      if (sent.status !== "landed") return { ok: false, signature: null };
      signature = sent.signature;
    }
    for (const index of rewardIndexes) {
      const reward = await buildOrNothing(() => venue.rewards.collect({ ...asAgent, index }));
      if (!reward) continue;
      const sent = await send(reward);
      if (sent.status !== "landed") return { ok: false, signature };
      signature ??= sent.signature;
    }
    return { ok: true, signature };
  };

  if (outAtStop) {
    const rest = await collectAll().catch(() => ({ ok: false, signature: null }));
    return rest.ok ? { ...entry, status: "stopped", stoppedBy: "stop", updatedAt: at } : entry;
  }
  if (action.kind === "exit") {
    const worth = inTokenY(BigInt(income.position.xRaw), BigInt(income.position.yRaw), scale) + inTokenY(BigInt(income.fees.xRaw), BigInt(income.fees.yRaw), scale);
    if (hasLiquidity) {
      /* The stop is an exit at the price there is: the widest band the venue builds, so a falling price does not hold it up. */
      const out = await send(await venue.positions.remove({ ...asAgent, bps: 10_000, slippageBps: 500 }));
      /* Not seen yet: kept as sent; the next pass asks its signature before anything else (`settleExit`). */
      if (out.status === "unknown") return { ...entry, exitSent: { signature: out.signature, at, valueInY: worth }, updatedAt: at };
      if (out.status !== "landed") return withEvent(entry, refusedEvent(at));
      /* The exit is on the book the moment it lands: a pass cut short while it collects still leaves it there. */
      const exited = withEvent(entry, { at, kind: "exit", valueInY: worth, signature: out.signature });
      await bookOf(context.store).set(entry.key, exited).catch(() => undefined);
      /* What the position earned goes too; where that does not land the care stays on, and the next pass — out at the stop — collects it. */
      const rest = await collectAll().catch(() => ({ ok: false, signature: null }));
      return rest.ok ? { ...exited, status: "stopped", stoppedBy: "stop" } : exited;
    }
    const rest = await collectAll();
    return rest.ok ? withEvent(entry, { at, kind: "exit", valueInY: worth, signature: rest.signature }, { status: "stopped", stoppedBy: "stop" }) : withEvent(entry, refusedEvent(at));
  }

  const taken = await collectAll();
  if (!taken.ok) return withEvent(entry, refusedEvent(at));
  return withEvent(entry, { at, kind: "claim", valueInY: inTokenY(BigInt(income.fees.xRaw), BigInt(income.fees.yRaw), scale), signature: taken.signature }, { lastClaimAt: at });
}

/** Where the last pass stopped, kept beside the book under a key outside its rows (`pc:` is not `p:<network>:`). */
type PassCursor = Readonly<{ at: number; after: string }>;
const passCursorKey = (network: EarnProNetwork): string => `pc:${network}`;

/** How long one pass acts before it leaves the rest of the book to the next pass, ms. */
export const PASS_BUDGET_MS = 20_000;

/** The agent's pass over its DLMM Pro cares; a care's failure never stops the others. */
export async function proCareMinute(env: Env = process.env, deps: ProCareDeps & Readonly<{ step?: typeof proCareStep; act?: typeof actAsAgent }> = {}) {
  const gate = proCareGate(env);
  if (!gate.open) return { ran: false, reason: "closed" } as const;
  const key = deps.key === undefined ? proCareKey$(env, gate) : deps.key;
  if (!key) return { ran: false, reason: "no agent key here" } as const;
  const { connection, venue, store, now } = contextOf(gate, { ...deps, env });
  /* Each pass goes on after the row the last one reached: a book longer than one pass is walked round, never only its head. */
  const book = (await bookOf(store).valuesWithPrefix(proCarePrefix(gate.network))).filter((row) => isRow(row) && row.status === "working").sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cursors = store.collection<PassCursor>(CARE_BOOK);
  const cursor = await cursors.get(passCursorKey(gate.network)).catch(() => undefined);
  const start = cursor ? book.findIndex((row) => row.key > cursor.after) : 0;
  const rows = start > 0 ? [...book.slice(start), ...book.slice(0, start)] : book;
  const step = deps.step ?? proCareStep;
  let acted = 0;
  let skipped = 0;
  /* The cron's function has a minute, beside the pass: past this the rest of the book waits for the next one. */
  const until = now() + PASS_BUDGET_MS;
  for (const row of rows) {
    if (now() >= until) {
      skipped += 1;
      continue;
    }
    /* Kept before the step: a pass the function's minute cuts short still goes on after this row next time. */
    await cursors.set(passCursorKey(gate.network), { at: now(), after: row.key }).catch(() => undefined);
    if (!(await claimTick(store, row.key, now()).catch(() => false))) {
      skipped += 1;
      continue;
    }
    try {
      const after = await step(row, { env, network: gate.network, connection, venue, store, key, now, ...(deps.act ? { act: deps.act } : {}) });
      if (after !== row) {
        await bookOf(store).set(row.key, after);
        acted += 1;
      }
    } catch {
      /* The next pass reads this care again. */
    }
  }
  return { ran: true, cares: rows.length, acted, skipped } as const;
}
