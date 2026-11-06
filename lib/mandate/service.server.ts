/**
 * CITY-174 — the agent's budget behind the city's window, on devnet; on mainnet.
 *
 * The window asks for three things and each is a transaction the person's wallet signs and this server only relays:
 * turn the agent on with a budget (`review`), stop it and take the rest back (`stop`), and what stands now (`status`).
 * This server holds no key and signs nothing; the agent's own key and its trading are the engine's (`./run.server.ts`).
 *
 * The switch goes by the release protocol, as the ladder's does (decision 92): devnet → a release with a point to roll
 * back to → the operator tries it himself. Mainnet is this change of code (CITY-186), merged after the
 * audit of Squads' policy layer; before it, no value of the switch opened mainnet.
 * - `RYNTRA_AGENT_MANDATE` — `devnet` or `mainnet` opens the routes; anything else closes them (they answer 404).
 * - `RYNTRA_AGENT_MANDATE_POOL` — the devnet DLMM pool the agent buys in (Jupiter is not deployed on devnet).
 * - `RYNTRA_AGENT_MANDATE_AGENT` — the agent's public address: the policy's one signer. On mainnet the address is the
 *   registry's (`solana-agent-signer`, its key in Google Cloud KMS) and nothing else; this, when set, must name it.
 * The chain is asked first, every time: an endpoint that is not the gate's network builds, relays and trades nothing.
 */

import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { resolveEndpoint } from "../solana/rpc.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { onDevnet } from "../bots/ladder/connection.server.ts";
import { planEnable, planStopAndWithdraw, tokenAccountOf, unsignedTransaction, type Mandate } from "./human.ts";
import { NATIVE_MINT, readPolicyHead, readProgramConfig, readSettings, ssaAddress, SSA_PROGRAM_ID } from "./ssa.ts";
import { budgetPreset, presetOpenOn, type BudgetPresetId } from "./presets.ts";
import { NO_TIDY, withTidy, type Tidy } from "./tidy.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { storeScreen, type CoinOrigin } from "./ryntra-coins.server.ts";

export const MANDATE_ENV = "RYNTRA_AGENT_MANDATE";
export const MANDATE_POOL_ENV = "RYNTRA_AGENT_MANDATE_POOL";
export const MANDATE_AGENT_ENV = "RYNTRA_AGENT_MANDATE_AGENT";

type Env = Readonly<Record<string, string | undefined>>;

const addressOf = (value: string | undefined): PublicKey | null => {
  const text = value?.trim();
  if (!text) return null;
  try {
    const key = new PublicKey(text);
    return key.toBase58() === text ? key : null;
  } catch {
    return null;
  }
};

export type MandateNetwork = "devnet" | "mainnet";

export type MandateGate =
  | Readonly<{ open: true; network: "devnet"; pool: PublicKey; agent: PublicKey }>
  | Readonly<{ open: true; network: "mainnet"; pool: null; agent: PublicKey }>
  | Readonly<{ open: false }>;

/** The agent's one address on mainnet: the registry's open `AGENT_SIGNER` row, whose key lives in Google Cloud KMS. */
export function registryAgent(rows = ATTRIBUTION_REGISTRY): PublicKey | null {
  const open = rows.filter((row) => row.role === "AGENT_SIGNER" && row.network === "solana" && row.end === null);
  return open.length === 1 ? addressOf(open[0]!.address ?? undefined) : null;
}

/** The server's switch: devnet with its pool and its agent, mainnet with the registry's agent, or closed. */
export function mandateGate(env: Env): MandateGate {
  const network = env[MANDATE_ENV]?.trim();
  if (network === "mainnet") {
    const agent = registryAgent();
    const named = env[MANDATE_AGENT_ENV]?.trim();
    return agent && (!named || named === agent.toBase58()) ? { open: true, network: "mainnet", pool: null, agent } : { open: false };
  }
  if (network !== "devnet") return { open: false };
  const pool = addressOf(env[MANDATE_POOL_ENV]);
  const agent = addressOf(env[MANDATE_AGENT_ENV]);
  return pool && agent ? { open: true, network: "devnet", pool, agent } : { open: false };
}

/** Mainnet's genesis hash: the chain itself says which network an endpoint serves. */
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const onMainnetKnown = new WeakMap<object, true>();

/** Whether a connection really serves the network: asked of the chain, a yes kept per connection. */
export async function onNetwork(connection: Pick<Connection, "getGenesisHash">, network: MandateNetwork): Promise<boolean> {
  if (network === "devnet") return onDevnet(connection);
  if (onMainnetKnown.has(connection)) return true;
  const ok = await connection.getGenesisHash().then((hash) => hash === MAINNET_GENESIS, () => false);
  if (ok) onMainnetKnown.set(connection, true);
  return ok;
}

const notNetwork = (network: MandateNetwork) => ({ ok: false as const, code: network === "devnet" ? "NOT_DEVNET" : "NOT_MAINNET", reason: `The endpoint is not ${network}.` });

const cached = new Map<MandateNetwork, { url: string; connection: Connection }>();
export function mandateConnection(network: MandateNetwork = "devnet"): Connection {
  const url = resolveEndpoint(network);
  const kept = cached.get(network);
  if (kept && kept.url === url) return kept.connection;
  const connection = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  cached.set(network, { url, connection });
  return connection;
}

const toBase64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

/** The mandate as the window keeps it: public addresses and the terms' numbers. */
export type MandateRecord = Readonly<{
  owner: string;
  settings: string;
  vault: string;
  policy: string;
  budget: string;
  perTrade: string;
  perDay: string;
  expiresAt: string;
}>;

export const recordOf = (mandate: Mandate): MandateRecord => ({
  owner: mandate.terms.human.toBase58(),
  settings: mandate.settings.toBase58(),
  vault: mandate.vault.toBase58(),
  policy: mandate.policy.toBase58(),
  budget: mandate.budgetAccount.toBase58(),
  perTrade: mandate.terms.perTrade.toString(),
  perDay: mandate.terms.perDay.toString(),
  expiresAt: mandate.terms.expiresAt.toString(),
});

export type ReviewResult = Readonly<{ ok: true; record: MandateRecord; transactions: readonly string[]; fundLamports: string }> | Readonly<{ ok: false; code: string; reason: string }>;

/** The token the pool sells for SOL — what the agent buys for her; the DLMM SDK reads the pool (loaded on use). */
export async function poolOtherToken(connection: Connection, pool: PublicKey): Promise<PublicKey> {
  const DLMM = (await import("@meteora-ag/dlmm")).default;
  const read = await DLMM.create(connection, pool, { cluster: "devnet" });
  return read.tokenX.publicKey.equals(NATIVE_MINT) ? read.tokenY.publicKey : read.tokenX.publicKey;
}

/**
 * Turn the agent on: the person's unsigned transactions (one approval), for a budget preset, on her smart account —
 * the one she already has, or a new one. On devnet the agent buys the pool's coin; on mainnet the coin she names, by
 * Jupiter's route.
 */
export async function reviewEnable(
  input: Readonly<{ owner: string; preset: BudgetPresetId; smartAccount?: string | null; coin?: string | null }>,
  gate: Extract<MandateGate, { open: true }>,
  connection: Connection = mandateConnection(gate.network),
  dependencies: Readonly<{ receiveMint?: (connection: Connection, pool: PublicKey) => Promise<PublicKey>; origin?: (mint: string) => Promise<CoinOrigin> }> = {},
): Promise<ReviewResult> {
  if (!(await onNetwork(connection, gate.network))) return notNetwork(gate.network);
  const owner = addressOf(input.owner);
  if (!owner) return { ok: false, code: "VALIDATION_ERROR", reason: "Not a wallet address." };
  if (owner.equals(gate.agent)) return { ok: false, code: "VALIDATION_ERROR", reason: "The agent is not the person." };
  const named = gate.network === "mainnet" ? addressOf(input.coin ?? undefined) : null;
  if (gate.network === "mainnet" && (!named || named.equals(NATIVE_MINT))) return { ok: false, code: "VALIDATION_ERROR", reason: "Name the coin the agent buys." };
  /* CITY-196: before she signs anything — a coin of Ryntra's launchpad, or her own, is never the agent's to buy. */
  if (named) {
    const origin = await (dependencies.origin ?? storeScreen(getGuardRuntime().store, gate.network).origin)(named.toBase58()).catch(() => null);
    if (!origin) return { ok: false, code: "UNAVAILABLE", reason: "Ryntra's launch registry is not readable." };
    if (origin.launchedHere) return { ok: false, code: "REFUSED", reason: origin.creator === owner.toBase58() ? "The agent does not buy your own coin." : "The agent does not buy coins launched on Ryntra." };
  }
  if (!presetOpenOn(gate.network, input.preset)) return { ok: false, code: "VALIDATION_ERROR", reason: `The budget is not one ${gate.network} offers.` };
  const preset = budgetPreset(input.preset);
  const now = BigInt((await connection.getBlockTime(await connection.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000));
  let account: Parameters<typeof planEnable>[0]["account"];
  const known = addressOf(input.smartAccount ?? undefined);
  const settingsInfo = known ? await connection.getAccountInfo(known) : null;
  if (known && settingsInfo && settingsInfo.owner.equals(SSA_PROGRAM_ID)) {
    account = { kind: "present", settings: known, state: readSettings(settingsInfo.data) };
  } else {
    const config = await connection.getAccountInfo(ssaAddress.programConfig());
    if (!config) return { ok: false, code: "UNAVAILABLE", reason: "The smart account program is not readable." };
    account = { kind: "absent", config: readProgramConfig(config.data) };
  }
  /* What the agent buys for her — the pool's other token on devnet, the coin she names on mainnet; she opens its account now. */
  let receive: PublicKey;
  if (named) {
    receive = named;
  } else {
    if (gate.network === "mainnet") return { ok: false, code: "VALIDATION_ERROR", reason: "Name the coin the agent buys." };
    try {
      receive = await (dependencies.receiveMint ?? poolOtherToken)(connection, gate.pool);
    } catch {
      return { ok: false, code: "UNAVAILABLE", reason: "The devnet pool is not readable." };
    }
  }
  let plan;
  try {
    plan = planEnable({
      cluster: gate.network,
      terms: {
        human: owner,
        agent: gate.agent,
        budgetMint: NATIVE_MINT,
        perTrade: preset.perTrade,
        perDay: preset.perDay,
        slippageBps: 100,
        expiresAt: now + BigInt(preset.days) * 86_400n,
        venue: gate.network === "mainnet" ? { kind: "jupiter" } : { kind: "dlmm", pool: gate.pool },
      },
      account,
      fund: preset.budget,
      nowSeconds: now,
      receiveMints: [receive],
      agentFeeLamports: preset.agentFee,
    });
  } catch (error) {
    return { ok: false, code: "REFUSED", reason: error instanceof Error ? error.message : "The mandate is not written." };
  }
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return {
    ok: true,
    record: recordOf(plan.mandate),
    transactions: plan.transactions.map((instructions) => toBase64(unsignedTransaction(owner, instructions, blockhash))),
    fundLamports: preset.budget.toString(),
  };
}

/**
 * What the stop's transaction also tidies (CITY-195, `./tidy.ts`): read by the caller from the agent's book and the chain —
 * her sold sales' mandates, the vault's empty account of the coin, her wSOL.
 */
export type StopTidy = (mandate: Readonly<{ owner: PublicKey; settings: PublicKey; vault: PublicKey; policy: PublicKey }>) => Promise<Tidy>;

/** Stop and take the rest back: one unsigned transaction, the person's alone — with as much tidying as fits in it. */
export async function reviewStop(
  input: Readonly<{ owner: string; settings: string; policy: string }>,
  network: MandateNetwork = "devnet",
  connection: Connection = mandateConnection(network),
  deps: Readonly<{ tidy?: StopTidy }> = {},
): Promise<ReviewResult> {
  if (!(await onNetwork(connection, network))) return notNetwork(network);
  const owner = addressOf(input.owner);
  const settings = addressOf(input.settings);
  const policy = addressOf(input.policy);
  if (!owner || !settings || !policy) return { ok: false, code: "VALIDATION_ERROR", reason: "Not addresses." };
  const settingsInfo = await connection.getAccountInfo(settings);
  if (!settingsInfo || !settingsInfo.owner.equals(SSA_PROGRAM_ID) || !readSettings(settingsInfo.data).signers.some((signer) => signer.key.equals(owner))) {
    return { ok: false, code: "REFUSED", reason: "Not the person's smart account." };
  }
  const vault = ssaAddress.vault(settings, 0);
  const budgetAccount = tokenAccountOf(vault, NATIVE_MINT);
  const balance = await connection.getTokenAccountBalance(budgetAccount).then((r) => BigInt(r.value.amount), () => null);
  const policyLive = Boolean(await connection.getAccountInfo(policy));
  /* Only the parts that still stand: a removed policy is not removed twice, an empty vault is not closed. */
  const mandate: Mandate = {
    cluster: network,
    terms: { human: owner, agent: owner, budgetMint: NATIVE_MINT, perTrade: 0n, perDay: 0n, slippageBps: 100, expiresAt: 0n, venue: { kind: "jupiter" } },
    settings,
    vault,
    policy,
    policySeed: 0n,
    budgetAccount,
  };
  const all = planStopAndWithdraw(mandate, balance ?? 0n);
  const base = [...(policyLive ? all.slice(0, 1) : []), ...(balance !== null ? all.slice(1) : [])];
  if (!base.length) return { ok: false, code: "NOTHING", reason: "Nothing left to stop." };
  const tidy = deps.tidy ? await deps.tidy({ owner, settings, vault, policy }).catch(() => NO_TIDY) : NO_TIDY;
  const [instructions] = withTidy({ human: owner, settings, vault }, [base], tidy).transactions;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return {
    ok: true,
    record: { owner: owner.toBase58(), settings: settings.toBase58(), vault: vault.toBase58(), policy: policy.toBase58(), budget: budgetAccount.toBase58(), perTrade: "0", perDay: "0", expiresAt: "0" },
    transactions: [toBase64(unsignedTransaction(owner, instructions!, blockhash))],
    fundLamports: (balance ?? 0n).toString(),
  };
}

export type MandateStatus = Readonly<{ active: boolean; budgetLamports: string | null }>;

/** What the status route answers: the mandate's state, or — `not-addresses` (400), `not-found` (404, not this agent's mandate). */
export type MandateStatusRead = Readonly<{ ok: true; status: MandateStatus }> | Readonly<{ ok: false; code: "not-addresses" | "not-found" }>;

/**
 * What stands now — only of a real mandate of this agent (CITY-196): a policy on chain must be a Squads Smart Account
 * policy whose one signer is the agent, at the address its settings and seed derive, and the vault must be that account's.
 * A policy no longer on chain (a stop removed it) is known only from the agent's book, with the same vault. Anything else
 * — any other address, the System Program — is not found.
 */
export async function mandateStatus(
  input: Readonly<{ policy: string; vault: string }>,
  gate: Readonly<{ network: MandateNetwork; agent: PublicKey }>,
  connection: Pick<Connection, "getAccountInfo" | "getTokenAccountBalance"> = mandateConnection(gate.network),
  deps: Readonly<{ store?: GuardStore }> = {},
): Promise<MandateStatusRead> {
  const policy = addressOf(input.policy);
  const vault = addressOf(input.vault);
  if (!policy || !vault) return { ok: false, code: "not-addresses" };
  const [policyInfo, balance] = await Promise.all([
    connection.getAccountInfo(policy),
    connection.getTokenAccountBalance(tokenAccountOf(vault, NATIVE_MINT)).then((r) => r.value.amount, () => null),
  ]);
  if (policyInfo) {
    if (!policyInfo.owner.equals(SSA_PROGRAM_ID)) return { ok: false, code: "not-found" };
    let head;
    try {
      head = readPolicyHead(policyInfo.data);
    } catch {
      return { ok: false, code: "not-found" };
    }
    if (!ssaAddress.policy(head.settings, head.seed).equals(policy)) return { ok: false, code: "not-found" };
    if (head.signers.length !== 1 || !head.signers[0]!.key.equals(gate.agent)) return { ok: false, code: "not-found" };
    if (!ssaAddress.vault(head.settings, 0).equals(vault)) return { ok: false, code: "not-found" };
    return { ok: true, status: { active: true, budgetLamports: balance } };
  }
  const store = deps.store ?? getGuardRuntime().store;
  const book = store.collection<Readonly<{ record?: Readonly<{ vault?: string }> }>>("agentMandates");
  const rows = await Promise.all([book.get(`m:${gate.network}:${policy.toBase58()}`), book.get(`s:${gate.network}:${policy.toBase58()}`)]).catch(() => [undefined, undefined]);
  if (!rows.some((row) => row?.record?.vault === vault.toBase58())) return { ok: false, code: "not-found" };
  return { ok: true, status: { active: false, budgetLamports: balance } };
}

export type RelayResult = Readonly<{ ok: true; signatures: readonly string[] }> | Readonly<{ ok: false; code: string; reason: string; signatures: readonly string[] }>;

/**
 * Send the person's signed transactions in order, each confirmed before the next. Each is read first: the person pays
 * and is the only signer, her signature is real, and it calls nothing but the smart account, token and system programs —
 * Token-2022's among them, where a coin she sells is one of it (CITY-187).
 */
export async function relayMandate(input: Readonly<{ owner: string; items: readonly string[] }>, network: MandateNetwork = "devnet", connection: Connection = mandateConnection(network)): Promise<RelayResult> {
  if (!(await onNetwork(connection, network))) return { ...notNetwork(network), signatures: [] };
  const owner = addressOf(input.owner);
  if (!owner) return { ok: false, code: "VALIDATION_ERROR", reason: "Not a wallet address.", signatures: [] };
  const allowed = new Set([SSA_PROGRAM_ID.toBase58(), "11111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"]);
  const txs: VersionedTransaction[] = [];
  for (const wire of input.items) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return { ok: false, code: "MALFORMED", reason: "A transaction is unreadable.", signatures: [] };
    }
    const keys = tx.message.staticAccountKeys;
    if (!keys[0]?.equals(owner) || tx.message.header.numRequiredSignatures !== 1) {
      return { ok: false, code: "REFUSED", reason: "The person must pay and be the only signer.", signatures: [] };
    }
    if (!tx.signatures[0] || !ed25519Valid(tx.message.serialize(), tx.signatures[0], owner)) return { ok: false, code: "REFUSED", reason: "Not signed by the person.", signatures: [] };
    const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]?.toBase58() ?? "");
    if (programs.some((program) => !allowed.has(program))) return { ok: false, code: "REFUSED", reason: "A program outside the mandate.", signatures: [] };
    txs.push(tx);
  }
  const signatures: string[] = [];
  for (const tx of txs) {
    try {
      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      signatures.push(signature);
      const confirmed = await connection.confirmTransaction(signature, "confirmed");
      if (confirmed.value.err) return { ok: false, code: "FAILED", reason: `A transaction failed on ${network}.`, signatures };
    } catch (error) {
      return { ok: false, code: "FAILED", reason: error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "Not sent.", signatures };
    }
  }
  return { ok: true, signatures };
}
