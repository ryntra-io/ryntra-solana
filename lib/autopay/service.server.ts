/**
 * Autopay as a service, behind `/api/v1/autopay` and the executor's cron. The person says once: pay this
 * address this much, this often, until then — signs once, and walks away; the executor pays each window inside the one
 * policy the person signed (`./policy.ts`), and the person stops it whenever they like with one signature.
 *
 * - `reviewAutopay` — the person's unsigned transactions (one approval) and the draft of the record they make;
 * - `submitAutopay` — the signed transactions, each read (the person pays and alone signs, only the smart account, system,
 *   token and token-account programs), the policy's own instruction rebuilt from the draft and found among them, relayed
 *   in order; then the chain's policy is read and must carry the draft's terms before the book keeps it;
 * - `reviewStop` / `submitStop` — the policy removed and the rest taken back in one transaction; the book says «stopped»
 *   once the chain no longer has the policy;
 * - `listAutopays` — the wallet's autopays and their windows;
 * - `autopayMinute` — the executor's pass (cron `/api/cron/autopay`): each autopay whose moment has come — its window open
 *   and unpaid, a payment on its way, its end — gets its one step, within the pass's time budget.
 *
 * The switch goes by the release protocol (decision 92): devnet → a release with a point to roll back to → the person
 * who owns Ryntra tries it. `RYNTRA_AUTOPAY` — `devnet` or `mainnet` opens it, anything else closes it; the executor's
 * address — `RYNTRA_AUTOPAY_AGENT` on devnet, on mainnet only the registry's agent; its key is the agent's budget's
 * (`../mandate/agent-service.server.ts` `agentKeyFor`: on mainnet only the registry's KMS key).
 *
 * Money: Ryntra charges no fee of its own for an autopay. The person pays the executor's network fee up front —
 * `NETWORK_PER_PAYMENT` for each payment of the schedule (`./schedule.ts`: the base fee and room for a priority price),
 * sent to the executor's address at «Start». What the network does not take stays with the executor and is not given
 * back at «Stop»; the screen says so before the signature (`terminal/money/autopay/words.ts` `howText`).
 */

import { randomUUID } from "node:crypto";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { PublicKey, SystemProgram, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";

import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSurvivesColdStart, type GuardStore } from "../guard/store.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { agentKeyFor } from "../mandate/agent-service.server.ts";
import { unsignedTransaction, type SmartAccount } from "../mandate/human.ts";
import { fateOf } from "../mandate/run.server.ts";
import { chainSeconds, mandateConnection, onNetwork, registryAgent, relayMandate } from "../mandate/service.server.ts";
import { ALL_PERMISSIONS, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyHead, readProgramConfig, readSettings, settingsSyncInstruction, ssaAddress } from "../mandate/ssa.ts";
import { resolveSkrForward, type SkrForward } from "../solana/skr.server.ts";
import { targetOf } from "../contacts/model.ts";
import { planAutopayEnable, planAutopayStop, type Autopay, type VaultBalance } from "./enable.ts";
import { AUTOPAY_VAULT_FIRST, AUTOPAY_VAULT_LAST, USDC_DECIMALS, USDC_MINT, autopayPolicy, autopayRefusal, policyCarriesTerms, policyVaultIndex, usdcAccountOf, type AutopayNetwork } from "./policy.ts";
import { autopayOf, lapsed, recordFrom, recordOf, takenWindows, type AutopayRecord, type PaymentRow } from "./record.ts";
import { CALL_DEADLINE_MS, payWindow, within } from "./run.server.ts";
import { amountOf, dueAt, endsAt, missedBefore, networkOf, standingAt, totalOf, type AutopayCoin, type AutopayEvery } from "./schedule.ts";
import { autopaySigner, type AutopayJournal, type AutopaySignatureRow } from "./signer.server.ts";
import { AutopayUnavailable, autopayStore, type AutopayStore } from "./store.server.ts";

export const AUTOPAY_ENV = "RYNTRA_AUTOPAY";
export const AUTOPAY_AGENT_ENV = "RYNTRA_AUTOPAY_AGENT";

type Env = Readonly<Record<string, string | undefined>>;

export type AutopayGate = Readonly<{ open: true; network: AutopayNetwork; agent: PublicKey }> | Readonly<{ open: false }>;
export type OpenAutopay = Extract<AutopayGate, { open: true }>;

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

/** Open only where the switch names a network and the executor's address is known — on mainnet, the registry's only. */
export function autopayGate(env: Env = process.env): AutopayGate {
  const network = env[AUTOPAY_ENV]?.trim().toLowerCase();
  if (network !== "devnet" && network !== "mainnet") return { open: false };
  const named = addressOf(env[AUTOPAY_AGENT_ENV]);
  if (network === "mainnet") {
    const registry = registryAgent();
    if (!registry || (named && !named.equals(registry))) return { open: false };
    return { open: true, network, agent: registry };
  }
  return named ? { open: true, network, agent: named } : { open: false };
}

/** The executor's key is the agent's budget's, chosen by network and address alone. */
export function autopayKey(env: Env, gate: OpenAutopay): KeySigner | null {
  const keyGate = (gate.network === "devnet" ? { open: true, network: "devnet", pool: PublicKey.default, agent: gate.agent } : { open: true, network: "mainnet", pool: null, agent: gate.agent }) as Parameters<typeof agentKeyFor>[1];
  return agentKeyFor(env, keyGate);
}

export type Failure = Readonly<{ ok: false; code: "VALIDATION_ERROR" | "UNAVAILABLE" | "NOT_FOUND" | "REFUSED" | "FAILED" | "WRONG_NETWORK"; reason: string }>;
const fail = (code: Failure["code"], reason: string): Failure => ({ ok: false, code, reason });

export type ServiceDeps = Readonly<{
  connection?: Connection;
  store?: AutopayStore;
  resolveName?: (name: string) => Promise<SkrForward>;
  now?: () => number;
  id?: () => string;
}>;

const toBase64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

async function nowSeconds(connection: Connection, deps: ServiceDeps): Promise<bigint> {
  if (deps.now) return BigInt(Math.floor(deps.now() / 1000));
  return BigInt((await chainSeconds(connection)) ?? Math.floor(Date.now() / 1000));
}

/** The person's smart account: the one they named, else the one their autopays already live in, else a new one. */
async function smartAccountOf(connection: Connection, owner: PublicKey, named: PublicKey | null, kept: readonly AutopayRecord[]): Promise<SmartAccount | null> {
  const candidates = [named, ...kept.map((record) => addressOf(record.settings))].filter((key): key is PublicKey => key !== null);
  for (const settings of candidates) {
    const info = await connection.getAccountInfo(settings, "confirmed");
    if (!info || !info.owner.equals(SSA_PROGRAM_ID)) continue;
    const state = readSettings(info.data);
    if (state.signers.some((signer) => signer.key.equals(owner)) && state.threshold === 1 && state.timeLock === 0) return { kind: "present", settings, state };
  }
  const config = await connection.getAccountInfo(ssaAddress.programConfig(), "confirmed");
  return config ? { kind: "absent", config: readProgramConfig(config.data) } : null;
}

/**
 * The vaults the smart account's live policies act on — the agent's budget, a pool care (which counts its vaults from 1
 * up, `../care/enable.ts`), another autopay: read from each policy's own bytes on chain, so a vault another policy reaches
 * is never an autopay's, whatever book that policy is kept in. Throws when the chain does not answer.
 */
export async function policyVaults(connection: Pick<Connection, "getMultipleAccountsInfo">, settings: PublicKey, policySeed: bigint | null): Promise<ReadonlySet<number>> {
  const out = new Set<number>();
  const last = Number(policySeed ?? 0n);
  for (let from = 1; from <= last; from += 100) {
    const seeds = Array.from({ length: Math.min(100, last - from + 1) }, (_, i) => BigInt(from + i));
    const infos = await connection.getMultipleAccountsInfo(seeds.map((seed) => ssaAddress.policy(settings, seed)), "confirmed");
    for (const info of infos) {
      if (!info || !info.owner.equals(SSA_PROGRAM_ID)) continue;
      const index = policyVaultIndex(info.data);
      if (index !== null) out.add(index);
    }
  }
  return out;
}

/**
 * The first autopay vault of this smart account that no autopay of the book uses, no live policy of the account acts on,
 * and that holds nothing on chain.
 */
async function freeVault(connection: Connection, account: SmartAccount, kept: readonly AutopayRecord[]): Promise<number | null> {
  if (account.kind !== "present") return AUTOPAY_VAULT_FIRST;
  const settings = account.settings;
  const used = new Set(kept.filter((record) => record.settings === settings.toBase58()).map((record) => record.vaultIndex));
  for (const index of await policyVaults(connection, settings, account.state.policySeed)) used.add(index);
  for (let index = AUTOPAY_VAULT_FIRST; index <= AUTOPAY_VAULT_LAST; index += 1) {
    if (used.has(index)) continue;
    const vault = ssaAddress.vault(settings, index);
    if (await connection.getAccountInfo(vault, "confirmed")) continue;
    return index;
  }
  return null;
}

export type ReviewInput = Readonly<{
  owner: string;
  /** An address or a `.skr` name. */
  to: string;
  /** The contact's name the person chose, shown back to them; null — none. */
  label: string | null;
  coin: AutopayCoin;
  /** One payment as the person typed it, a decimal of the coin. */
  amount: string;
  every: AutopayEvery;
  count: number;
  /** The first payment, Unix seconds; absent — now. */
  startAt?: number | null;
  smartAccount?: string | null;
}>;

export type ReviewResult =
  | Readonly<{
      ok: true;
      draft: AutopayRecord;
      transactions: readonly string[];
      /** What the signature moves into the vault: every payment of the schedule. */
      fund: string;
      /** SOL for the executor's network fees. */
      network: string;
      /** The address a `.skr` name points to now — what the policy pins. */
      recipient: string;
    }>
  | Failure;

/** Turn an autopay on: the person's unsigned transactions, for their own numbers, on their smart account. */
export async function reviewAutopay(input: ReviewInput, gate: OpenAutopay, deps: ServiceDeps = {}): Promise<ReviewResult> {
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) return fail("WRONG_NETWORK", `The endpoint is not ${gate.network}.`);
  const owner = addressOf(input.owner);
  if (!owner) return fail("VALIDATION_ERROR", "Not a wallet address.");
  const target = targetOf(input.to);
  if (!target) return fail("VALIDATION_ERROR", "Pay a Solana address or a .skr name.");
  let recipient: PublicKey | null;
  let label = input.label;
  if (target.kind === "name") {
    const read = await (deps.resolveName ?? resolveSkrForward)(target.value).catch(() => ({ state: "UNAVAILABLE", name: target.value }) as const);
    if (read.state === "UNAVAILABLE") return fail("UNAVAILABLE", "The .skr name could not be read. Try again.");
    if (read.state === "NOT_FOUND") return fail("VALIDATION_ERROR", "No wallet holds this .skr name.");
    recipient = addressOf(read.address);
    label = label ?? target.value;
  } else {
    recipient = addressOf(target.value);
  }
  if (!recipient) return fail("VALIDATION_ERROR", "Pay a Solana address or a .skr name.");
  const amount = amountOf(input.amount, input.coin);
  if (amount === null) return fail("VALIDATION_ERROR", "The amount is not one the coin has.");
  const now = await nowSeconds(connection, deps);
  const startAt = input.startAt && BigInt(input.startAt) > now ? BigInt(input.startAt) : now;
  const terms = { network: gate.network, human: owner, agent: gate.agent, recipient, schedule: { coin: input.coin, amount, every: input.every, count: input.count, startAt } } as const;
  const refusal = autopayRefusal(terms, now);
  if (refusal) return fail("VALIDATION_ERROR", `Not an autopay: ${refusal}.`);
  const store = deps.store ?? autopayStore();
  let kept: readonly AutopayRecord[];
  try {
    kept = await store.list(gate.network, owner.toBase58());
  } catch (error) {
    if (error instanceof AutopayUnavailable) return fail("UNAVAILABLE", "The autopays could not be read. Try again.");
    throw error;
  }
  const account = await smartAccountOf(connection, owner, addressOf(input.smartAccount ?? undefined), kept);
  if (!account) return fail("UNAVAILABLE", "The smart account program is not readable.");
  let vaultIndex: number | null;
  try {
    vaultIndex = await freeVault(connection, account, kept);
  } catch {
    return fail("UNAVAILABLE", "The smart account could not be read. Try again.");
  }
  if (vaultIndex === null) return fail("REFUSED", "Every autopay vault of this account is in use. Stop one to start another.");
  let plan;
  try {
    plan = planAutopayEnable({ terms, account, vaultIndex, nowSeconds: now });
  } catch (error) {
    return fail("REFUSED", error instanceof Error ? error.message : "The autopay is not written.");
  }
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const draft = recordFrom({ id: (deps.id ?? randomUUID)(), autopay: plan.autopay, label: label ? label.slice(0, 64) : null, at: new Date(Number(now) * 1000).toISOString() });
  return {
    ok: true,
    draft,
    transactions: plan.transactions.map((instructions) => toBase64(unsignedTransaction(owner, instructions, blockhash))),
    fund: plan.fund.toString(),
    network: plan.network.toString(),
    recipient: recipient.toBase58(),
  };
}

/** The policy's own instruction as the draft makes it: the program, the accounts in order and the bytes the person's transactions must carry. */
function policyCreateInstruction(autopay: Autopay) {
  return settingsSyncInstruction({
    settings: autopay.settings,
    rentPayer: autopay.terms.human,
    signers: [autopay.terms.human],
    policyAccounts: [autopay.policy],
    actions: [
      {
        kind: "policyCreate",
        create: {
          seed: autopay.policySeed,
          policy: autopayPolicy(autopay.terms, { vault: autopay.vault, vaultIndex: autopay.vaultIndex }),
          signers: [{ key: autopay.terms.agent, permissions: ALL_PERMISSIONS }],
          threshold: 1,
          start: null,
          expiresAt: endsAt(autopay.terms.schedule),
        },
      },
    ],
  });
}

/**
 * Whether one of the signed transactions carries exactly this instruction: the program, the bytes, and the accounts in
 * their order — every account named in the transaction itself (no lookup table), the person among its signers.
 */
function carriesInstruction(items: readonly string[], person: PublicKey, expected: TransactionInstruction): boolean {
  return items.some((wire) => {
    try {
      const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
      const message = tx.message;
      const keys = message.staticAccountKeys;
      const signers = message.header.numRequiredSignatures;
      if (!keys.slice(0, signers).some((key) => key.equals(person))) return false;
      return message.compiledInstructions.some(
        (ix) =>
          keys[ix.programIdIndex]?.equals(expected.programId) &&
          Buffer.from(ix.data).equals(expected.data) &&
          ix.accountKeyIndexes.length === expected.keys.length &&
          ix.accountKeyIndexes.every((at, i) => at < keys.length && keys[at]!.equals(expected.keys[i]!.pubkey)),
      );
    } catch {
      return false;
    }
  });
}

/**
 * Whether one of the signed transactions carries exactly this policy's creation: this autopay's settings, the person
 * paying its rent and signing the settings, this policy's address.
 */
export function carriesPolicyCreate(items: readonly string[], autopay: Autopay): boolean {
  return carriesInstruction(items, autopay.terms.human, policyCreateInstruction(autopay));
}

/**
 * Whether the signed transactions also move in what the autopay lives on, exactly as the review planned it: every payment
 * of the schedule into the autopay's vault (SOL — to the vault; USDC — from the person's USDC account to the vault's), and
 * the executor's network fee for every payment. Without them a record would be «working» on an empty vault, or its
 * payments would draw on the executor's own SOL.
 */
export function carriesFunding(items: readonly string[], autopay: Autopay): boolean {
  const { terms } = autopay;
  const fund = totalOf(terms.schedule);
  const funding =
    terms.schedule.coin === "SOL"
      ? SystemProgram.transfer({ fromPubkey: terms.human, toPubkey: autopay.vault, lamports: fund })
      : createTransferCheckedInstruction(usdcAccountOf(terms.human, terms.network), USDC_MINT[terms.network], usdcAccountOf(autopay.vault, terms.network), terms.human, fund, USDC_DECIMALS, [], TOKEN_PROGRAM_ID);
  if (!carriesInstruction(items, terms.human, funding)) return false;
  const network = networkOf(terms.schedule);
  return network === 0n || carriesInstruction(items, terms.human, SystemProgram.transfer({ fromPubkey: terms.human, toPubkey: terms.agent, lamports: network }));
}

/**
 * Why the chain's policy is not this record's autopay; null when it is. The policy must be this smart account's, name
 * this executor alone and hold the record's numbers — and the smart account must be the person's: they sign its
 * settings, alone and at once. Someone else's policy is never written into a wallet's book.
 */
export async function chainRefusal(autopay: Autopay, connection: Pick<Connection, "getAccountInfo">): Promise<string | null> {
  const settingsInfo = await connection.getAccountInfo(autopay.settings, "confirmed");
  if (!settingsInfo || !settingsInfo.owner.equals(SSA_PROGRAM_ID)) return "no such smart account on chain";
  let settings;
  try {
    settings = readSettings(settingsInfo.data);
  } catch {
    return "not a smart account";
  }
  if (!settings.signers.some((signer) => signer.key.equals(autopay.terms.human)) || settings.threshold !== 1 || settings.timeLock !== 0) return "the smart account is not the person's alone";
  const info = await connection.getAccountInfo(autopay.policy, "confirmed");
  if (!info || !info.owner.equals(SSA_PROGRAM_ID)) return "no such autopay on chain";
  let head;
  try {
    head = readPolicyHead(info.data);
  } catch {
    return "not an autopay";
  }
  if (!head.settings.equals(autopay.settings) || head.seed !== autopay.policySeed) return "the autopay is not this account's";
  if (head.signers.length !== 1 || !head.signers[0]!.key.equals(autopay.terms.agent)) return "the autopay names another executor";
  if (!policyCarriesTerms(info.data, autopay.terms)) return "the numbers are not the policy's";
  return null;
}

export type SubmitResult = Readonly<{ ok: true; record: AutopayRecord; signatures: readonly string[] }> | (Failure & Readonly<{ signatures?: readonly string[] }>);

/** The person's signed transactions for the draft: read, relayed in order, the chain checked, the book written. */
export async function submitAutopay(input: Readonly<{ owner: string; draft: unknown; transactions: readonly string[] }>, gate: OpenAutopay, deps: ServiceDeps = {}): Promise<SubmitResult> {
  const record = recordOf(input.draft);
  const autopay = record ? autopayOf(record) : null;
  if (!record || !autopay) return fail("VALIDATION_ERROR", "The draft is not an autopay.");
  if (record.owner !== input.owner) return fail("VALIDATION_ERROR", "The draft names another wallet.");
  if (record.network !== gate.network || !autopay.terms.agent.equals(gate.agent)) return fail("VALIDATION_ERROR", "The draft was made for another executor.");
  if (record.status !== "working" || record.payments.length) return fail("VALIDATION_ERROR", "The draft is not a new autopay.");
  /* The terms again, as the review read them: never the person, never the executor, the schedule's own bounds. */
  const refusal = autopayRefusal(autopay.terms, autopay.terms.schedule.startAt);
  if (refusal) return fail("VALIDATION_ERROR", `Not an autopay: ${refusal}.`);
  if (!input.transactions.length || input.transactions.length > 2) return fail("VALIDATION_ERROR", "One or two signed transactions.");
  if (!carriesPolicyCreate(input.transactions, autopay)) return fail("REFUSED", "The signed transactions do not carry this autopay's policy.");
  if (!carriesFunding(input.transactions, autopay)) return fail("REFUSED", "The signed transactions do not move in the payments and the network fee.");
  const connection = deps.connection ?? mandateConnection(gate.network);
  const relay = await relayMandate({ owner: input.owner, items: input.transactions }, gate.network, connection);
  if (!relay.ok) return { ...fail(relay.code === "VALIDATION_ERROR" ? "VALIDATION_ERROR" : relay.code === "REFUSED" ? "REFUSED" : "FAILED", relay.reason), signatures: relay.signatures };
  const wrong = await chainRefusal(autopay, connection);
  if (wrong) return { ...fail("REFUSED", `The chain does not carry this autopay: ${wrong}.`), signatures: relay.signatures };
  try {
    await (deps.store ?? autopayStore()).put(record);
  } catch (error) {
    if (error instanceof AutopayUnavailable) return { ...fail("UNAVAILABLE", "The autopay landed but the book did not answer. Open it again in a moment."), signatures: relay.signatures };
    throw error;
  }
  return { ok: true, record, signatures: relay.signatures };
}

export type AutopaysRead = Readonly<{ ok: true; autopays: readonly AutopayRecord[] }> | Failure;

export async function listAutopays(owner: string, gate: OpenAutopay, deps: ServiceDeps = {}): Promise<AutopaysRead> {
  try {
    return { ok: true, autopays: await (deps.store ?? autopayStore()).list(gate.network, owner) };
  } catch (error) {
    if (error instanceof AutopayUnavailable) return fail("UNAVAILABLE", "The autopays could not be read. Try again.");
    throw error;
  }
}

/** What the vault holds now, read from the chain. */
async function vaultBalance(connection: Connection, autopay: Autopay): Promise<VaultBalance> {
  const [vaultInfo, usdcInfo] = await Promise.all([
    connection.getAccountInfo(autopay.vault, "confirmed"),
    autopay.terms.schedule.coin === "USDC" ? connection.getAccountInfo(usdcAccountOf(autopay.vault, autopay.terms.network), "confirmed") : Promise.resolve(null),
  ]);
  let usdc = 0n;
  if (usdcInfo && usdcInfo.data.length >= 72) {
    for (let i = 7; i >= 0; i -= 1) usdc = (usdc << 8n) | BigInt(usdcInfo.data[64 + i]!);
  }
  return { lamports: BigInt(vaultInfo?.lamports ?? 0), usdc, usdcAccountOpen: Boolean(usdcInfo) };
}

export type StopReview = Readonly<{ ok: true; transaction: string; returns: Readonly<{ lamports: string; usdc: string }> }> | Failure;

/** Stop and take the rest back: one unsigned transaction, the person's alone. */
export async function reviewStop(input: Readonly<{ owner: string; id: string }>, gate: OpenAutopay, deps: ServiceDeps = {}): Promise<StopReview> {
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) return fail("WRONG_NETWORK", `The endpoint is not ${gate.network}.`);
  let record: AutopayRecord | null;
  try {
    record = await (deps.store ?? autopayStore()).one(gate.network, input.owner, input.id);
  } catch (error) {
    if (error instanceof AutopayUnavailable) return fail("UNAVAILABLE", "The autopay could not be read. Try again.");
    throw error;
  }
  const autopay = record ? autopayOf(record) : null;
  if (!record || !autopay) return fail("NOT_FOUND", "There is no such autopay of this wallet.");
  const [balance, policyInfo] = await Promise.all([vaultBalance(connection, autopay), connection.getAccountInfo(autopay.policy, "confirmed")]);
  const instructions = planAutopayStop(autopay, balance, { policyLive: Boolean(policyInfo) });
  if (!instructions.length) return fail("REFUSED", "Nothing is left to stop or take back.");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return { ok: true, transaction: toBase64(unsignedTransaction(autopay.terms.human, instructions, blockhash)), returns: { lamports: balance.lamports.toString(), usdc: balance.usdc.toString() } };
}

export type StopResult = Readonly<{ ok: true; signatures: readonly string[] }> | (Failure & Readonly<{ signatures?: readonly string[] }>);

/** The person's signed stop, relayed; the book says «stopped» once the chain no longer carries the policy. */
export async function submitStop(input: Readonly<{ owner: string; id: string; transaction: string }>, gate: OpenAutopay, deps: ServiceDeps = {}): Promise<StopResult> {
  const store = deps.store ?? autopayStore();
  let record: AutopayRecord | null;
  try {
    record = await store.one(gate.network, input.owner, input.id);
  } catch (error) {
    if (error instanceof AutopayUnavailable) return fail("UNAVAILABLE", "The autopay could not be read. Try again.");
    throw error;
  }
  const autopay = record ? autopayOf(record) : null;
  if (!record || !autopay) return fail("NOT_FOUND", "There is no such autopay of this wallet.");
  const connection = deps.connection ?? mandateConnection(gate.network);
  const relay = await relayMandate({ owner: input.owner, items: [input.transaction] }, gate.network, connection);
  if (!relay.ok) return { ...fail(relay.code === "REFUSED" ? "REFUSED" : "FAILED", relay.reason), signatures: relay.signatures };
  if (await connection.getAccountInfo(autopay.policy, "confirmed")) return { ...fail("REFUSED", "The policy still stands: the transaction did not stop the autopay."), signatures: relay.signatures };
  await store.status(gate.network, record.id, "stopped", input.owner).catch(() => false);
  return { ok: true, signatures: relay.signatures };
}

/* ------------------------------------------------------------------ the executor */

/**
 * The executor's journal: the agent's own `agentSignatures` in the Guard store (the executor's key is the agent's), one row
 * per signature or refusal, written once — or the signature is not given back.
 */
export function autopayJournal(store: () => GuardStore, log: (line: string) => void = (line) => console.info(line)): AutopayJournal {
  return async (row: AutopaySignatureRow) => {
    const key = `solana:${row.cluster}:autopay:${row.policy}:${row.window}:${row.at}:${row.outcome}`;
    const written = await store().collection<AutopaySignatureRow>("agentSignatures").insertIfAbsent(key, row);
    if (!written) throw new Error("the executor's journal already has this row");
    try {
      log(JSON.stringify({ event: "autopay.signature", ...row }));
    } catch {
      /* The store holds the row. */
    }
  };
}

/**
 * What the pass did with one autopay: paid / failed (read back this pass), sent (on its way, read next pass), retry (a
 * passing failure before anything left — the window goes back after a pause), refused (the executor's signer said no —
 * final for the window), waited, ended, claimed-before (another pass holds the window), unreadable, stopped (only its
 * payments on their way were read), later (the pass's budget ran out before its turn — it comes back when its hold ends).
 */
export type PassLine = Readonly<{
  id: string;
  did: "paid" | "failed" | "sent" | "retry" | "refused" | "waited" | "ended" | "claimed-before" | "unreadable" | "stopped" | "later";
}>;

export type MinuteAnswer = Readonly<{ ran: false; why: "closed" | "no-key" | "store" | "book" | "wrong-network" }> | Readonly<{ ran: true; lines: readonly PassLine[] }>;

/** The pass's numbers. Every one of them is about time: no money bound lives here — the chain holds those. */
export const PASS = Object.freeze({
  /** The pass's budget, inside the route's 60 s: a turn is begun only while a whole turn's time is left. */
  budgetMs: 45_000,
  /** The most one autopay's turn may take: each of its calls has a deadline of `CALL_DEADLINE_MS`. */
  turnMs: 15_000,
  /** How many autopays a pass takes from the queue, and how long they are held from an overlapping pass. */
  batch: 25,
  holdSeconds: 90,
  /** How long a claim lasts: a pass killed after its claim gives the window back when the claim lapses. */
  claimSeconds: 120,
  /** Past its blockhash's last valid height by this many blocks, a signature the chain never saw can never land. */
  expiryBlocks: 64,
  /** The pause before the pass reads the chain for the payments it sent. */
  readAfterMs: 2_000,
  /**
   * How long after a window opens the executor first pays it. The program renews the spending limit only once strictly
   * more than a period has passed since the last renewal (`spending_limit_v2.rs` `reset_if_needed`: `passed > period`), so
   * a payment in the very second the window opens is refused and the window is lost. The chain's own clock (its block
   * time) moves forward, so a few seconds past the opening are enough; with only the wall clock to go by (the chain's
   * clock did not answer) the pass waits longer, since the two may stand apart.
   */
  openMarginSeconds: 5,
  openMarginWallSeconds: 120,
});

export type PassNumbers = { -readonly [K in keyof typeof PASS]: number };

/** The pause before a window is tried again: 30 s, doubling with each attempt, at most 15 minutes. */
export const retrySeconds = (attempt: number): number => Math.min(30 * 2 ** Math.max(0, attempt - 1), 900);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type MinuteDeps = Readonly<{
  guard?: GuardStore;
  store?: AutopayStore;
  connection?: Connection;
  /** The chain's time, ms — for a test; the pass reads the chain's clock once otherwise. */
  now?: () => number;
  key?: KeySigner | null;
  /** The wall clock, ms: the budget and the book's times. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pass?: Partial<PassNumbers>;
  /** Where the journal's line goes besides the store (the server's log). */
  log?: (line: string) => void;
}>;

/**
 * One pass of the executor over the queue (`store.due`: only the autopays whose moment has come, the earliest first).
 * For each, within the pass's budget: the payments on their way are read on chain and settled — or given back once their
 * blockhash is past, or missed once their window closed; then the open window is claimed and paid once, or the autopay
 * ends. A pass killed at any step loses nothing: an unsigned claim lapses and its window is claimed again, a signed one
 * is read again by its signature.
 */
export async function autopayMinute(env: Env, deps: MinuteDeps = {}): Promise<MinuteAnswer> {
  const gate = autopayGate(env);
  if (!gate.open) return { ran: false, why: "closed" };
  const key = deps.key === undefined ? autopayKey(env, gate) : deps.key;
  if (!key) return { ran: false, why: "no-key" };
  const guard = deps.guard ?? getGuardRuntime().store;
  if (!storeSurvivesColdStart(guard)) return { ran: false, why: "store" };
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) return { ran: false, why: "wrong-network" };
  const clock = deps.clock ?? Date.now;
  const pause = deps.sleep ?? sleep;
  const pass: PassNumbers = { ...PASS, ...deps.pass };
  const started = clock();
  const store = deps.store ?? autopayStore();
  const call = <T>(promise: Promise<T>, what: string) => within(CALL_DEADLINE_MS, promise, what);
  const network = gate.network;

  let book: readonly AutopayRecord[];
  try {
    book = await call(store.due(network, pass.batch, pass.holdSeconds), "the book");
  } catch {
    return { ran: false, why: "book" };
  }
  const chainStart = deps.now ? null : await call(chainSeconds(connection), "the chain's clock").catch(() => null);
  const nowSeconds = (): bigint =>
    deps.now ? BigInt(Math.floor(deps.now() / 1000)) : BigInt((chainStart ?? Math.floor(started / 1000)) + Math.floor((clock() - started) / 1000));
  let height: number | null | undefined;
  const blockHeight = async (): Promise<number | null> => {
    if (height === undefined) height = await call(connection.getBlockHeight("confirmed"), "the block height").catch(() => null);
    return height;
  };
  const fate = (signature: string) => call(fateOf(connection, signature), "the chain").catch(() => ({ state: "unread" }) as const);
  const journal = autopayJournal(() => guard, deps.log);
  const lines: PassLine[] = [];
  const sent: { index: number; id: string; window: number; signature: string }[] = [];

  /** One autopay's turn. */
  const turn = async (record: AutopayRecord, index: number): Promise<PassLine["did"]> => {
    const autopay = autopayOf(record);
    if (!autopay || !autopay.terms.agent.equals(gate.agent)) return "unreadable";
    const { schedule } = autopay.terms;
    const now = nowSeconds();
    const payments = new Map(record.payments.map((row) => [row.window, row] as const));
    const put = (row: PaymentRow, fields: Partial<PaymentRow>) => payments.set(row.window, { ...row, ...fields });

    /* The payments on their way: read on chain by their signature — never sent again. */
    for (const row of record.payments) {
      if (row.state !== "sending") continue;
      if (row.signature) {
        const read = await fate(row.signature);
        if (read.state === "landed") {
          const state = read.ok ? "paid" : "failed";
          if (await call(store.settle(network, record.id, row.window, state, { signature: row.signature }), "the book").catch(() => false)) put(row, { state, checkAt: null });
          continue;
        }
        if (read.state !== "absent" || typeof row.validHeight !== "number") continue;
        const tip = await blockHeight();
        if (tip === null || tip <= row.validHeight + pass.expiryBlocks) continue;
        /* Its blockhash is past and the chain never saw it: it can never land, and the window is given back. */
        const back = await call(store.release(network, record.id, row.window, { signature: row.signature }, retrySeconds(row.attempts ?? 1)), "the book").catch(() => null);
        if (back === "missed") put(row, { state: "missed", signature: null, checkAt: null });
        if (back === "sending") put(row, { signature: null, validHeight: null, checkAt: new Date(clock() + retrySeconds(row.attempts ?? 1) * 1000).toISOString() });
        continue;
      }
      /* An unsigned claim that lapsed in a window now closed: nothing was sent for it — the window is missed. */
      if (lapsed(row, clock()) && dueAt(schedule, row.window + 1) <= now) {
        if (await call(store.settle(network, record.id, row.window, "missed", null), "the book").catch(() => false)) put(row, { state: "missed", checkAt: null });
      }
    }
    if (record.status !== "working") return "stopped";

    const rows = [...payments.values()];
    const taken = takenWindows(rows, clock());
    const recorded = new Set(rows.map((row) => row.window));
    const standing = standingAt(schedule, now, taken);
    if (standing.kind === "ended") {
      if (rows.some((row) => row.state === "sending" && row.signature)) return "waited";
      /* The windows the executor never reached are said, as missed, before the end: their money stays for the person. */
      for (const window of missedBefore(schedule.count, recorded)) await call(store.settle(network, record.id, window, "missed", null), "the book").catch(() => false);
      await call(store.status(network, record.id, "ended", null), "the book").catch(() => false);
      return "ended";
    }
    if (standing.kind === "wait") return "waited";
    /* The program renews the window's allowance only once the opening second is past: the executor never pays in it. */
    const margin = deps.now || chainStart !== null ? pass.openMarginSeconds : pass.openMarginWallSeconds;
    if (now < dueAt(schedule, standing.window) + BigInt(margin)) return "waited";
    for (const window of missedBefore(standing.window, recorded)) await call(store.settle(network, record.id, window, "missed", null), "the book").catch(() => false);
    const attempt = await call(store.claim(network, record.id, standing.window, pass.claimSeconds), "the book").catch(() => null);
    if (attempt === null) return "claimed-before";
    const signer = autopaySigner(key, { autopay, journal });
    const outcome = await payWindow({
      connection,
      autopay,
      signer,
      request: { window: standing.window, nowSeconds: now, status: "working", done: taken },
      record: (signature, validHeight) => call(store.sign(network, record.id, standing.window, attempt, signature, validHeight), "the book"),
    });
    switch (outcome.status) {
      case "retry":
        await call(store.release(network, record.id, standing.window, { attempt }, retrySeconds(attempt)), "the book").catch(() => null);
        return "retry";
      case "fenced":
        return "claimed-before";
      case "refused-by-executor":
        await call(store.settle(network, record.id, standing.window, "failed", { attempt }), "the book").catch(() => false);
        return "refused";
      case "refused-in-simulation":
        await call(store.settle(network, record.id, standing.window, "failed", { signature: outcome.signature }), "the book").catch(() => false);
        return "failed";
      case "sent":
        sent.push({ index, id: record.id, window: standing.window, signature: outcome.signature });
        return "sent";
    }
  };

  for (const record of book) {
    /* The budget is kept between autopays: a turn begins only while a whole turn's time is left. */
    if (clock() - started > pass.budgetMs - pass.turnMs) {
      lines.push({ id: record.id, did: "later" });
      continue;
    }
    const did = await turn(record, lines.length).catch(() => "retry" as const);
    lines.push({ id: record.id, did });
  }

  /* This pass's payments read back once, while the budget lasts; the rest are read by the next pass. */
  if (sent.length && clock() - started + pass.readAfterMs < pass.budgetMs) {
    await pause(pass.readAfterMs);
    for (const payment of sent) {
      if (clock() - started > pass.budgetMs) break;
      const read = await fate(payment.signature);
      if (read.state !== "landed") continue;
      const state = read.ok ? "paid" : "failed";
      if (await call(store.settle(network, payment.id, payment.window, state, { signature: payment.signature }), "the book").catch(() => false)) lines[payment.index] = { id: payment.id, did: state };
    }
  }
  return { ran: true, lines };
}
