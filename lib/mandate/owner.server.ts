/**
 * CITY-207 — the reads behind «a wallet's agents» (`./owner.ts`): the agent's book, the autopilots' and the cares' books
 * in the Guard store, each network apart, and — for the mandates — one batched read of the chain per network: whether
 * the policy still stands and the budget's SOL in the vault. Read only: builds nothing, signs nothing, moves nothing.
 */

import { PublicKey, type Connection } from "@solana/web3.js";

import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { readPilot } from "../pilot/book.server.ts";
import { CARE_BOOK, careGate, type CareEntry } from "../care/service.server.ts";
import { readBook, type BookEntry } from "./book.server.ts";
import { frozenOn } from "./freeze.server.ts";
import { AGENT_NETWORKS, ownedEntries, ownerMandate, tokenAmountOf, UNREAD, type ChainNow, type NetworkAgents, type OwnerAgents, type OwnerCare } from "./owner.ts";
import { mandateConnection, mandateGate, onNetwork, type MandateNetwork } from "./service.server.ts";

type Env = Readonly<Record<string, string | undefined>>;

const PILOT_ENV = "RYNTRA_MONEY_PILOT";
type ChainReader = Pick<Connection, "getMultipleAccountsInfo" | "getGenesisHash">;

export type OwnerDeps = Readonly<{
  env?: Env;
  store?: GuardStore;
  /** The chain of a network; none — that network's chain is not read, and its figures stay unknown. */
  connection?: (network: MandateNetwork) => ChainReader | null;
  /** How long one network's chain read may take, ms. */
  chainMs?: number;
}>;

const within = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]).catch(() => null);

/** The chain now for each mandate: one `getMultipleAccountsInfo` of every policy and budget account, on the network itself. */
export async function chainNow(entries: readonly BookEntry[], network: MandateNetwork, connection: ChainReader | null, ms = 4_000): Promise<readonly ChainNow[]> {
  if (!entries.length || !connection) return entries.map(() => UNREAD);
  const read = await within(
    (async () => {
      if (!(await onNetwork(connection, network))) return null;
      const keys = entries.flatMap((entry) => [new PublicKey(entry.record.policy), new PublicKey(entry.record.budget)]);
      return connection.getMultipleAccountsInfo(keys, "confirmed");
    })(),
    ms,
  );
  if (!read || read.length !== entries.length * 2) return entries.map(() => UNREAD);
  return entries.map((_, index) => {
    const policy = read[index * 2];
    const budget = read[index * 2 + 1];
    /* The chain answered: an account it does not have is a removed policy, an emptied vault — no, and zero. */
    return { live: Boolean(policy), budgetLamports: budget ? tokenAmountOf(budget.data) : "0" };
  });
}

/** The cares of a wallet on a network, without the ones still waiting for her signature. */
async function caresOf(store: GuardStore, network: MandateNetwork, owner: string): Promise<readonly OwnerCare[]> {
  const rows = await store.collection<CareEntry>(CARE_BOOK).valuesWithPrefix(`c:${network}:${owner}:`);
  return rows
    .filter((row) => row?.v === 1 && row.status !== "signing" && row.care.owner === owner)
    .map((row) => ({ key: row.key, pool: row.care.pool.address, vault: row.care.vault, status: row.status as "working" | "stopped", createdAt: row.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function networkAgents(owner: string, network: MandateNetwork, deps: Required<Pick<OwnerDeps, "env" | "store">> & OwnerDeps): Promise<NetworkAgents> {
  const mandate = mandateGate(deps.env);
  const care = careGate(deps.env);
  /* The autopilot's switch stands over the mandate's (`../pilot/service.server.ts` `pilotGate`, server-only there). */
  const pilotOn = deps.env[PILOT_ENV]?.trim().toLowerCase() === "on";
  const open = {
    mandate: mandate.open && mandate.network === network,
    pilot: pilotOn && mandate.open && mandate.network === network,
    care: care.open && care.network === network,
  };
  try {
    const [book, plan, cares, frozen] = await Promise.all([readBook(deps.store, network), readPilot(deps.store, network, owner), caresOf(deps.store, network, owner), frozenOn(deps.store, network).catch(() => new Set<string>())]);
    const entries = ownedEntries(book, owner);
    const connection = deps.connection ? deps.connection(network) : mandateConnection(network);
    const chain = await chainNow(entries, network, connection, deps.chainMs);
    const pilotPolicy = plan?.policy ?? null;
    return {
      network,
      open,
      read: true,
      mandates: entries.map((entry, index) => ownerMandate(entry, chain[index] ?? UNREAD, pilotPolicy, frozen.has(entry.record.policy))),
      pilot: plan ? { status: plan.status, policy: plan.policy, createdAt: plan.createdAt } : null,
      cares,
    };
  } catch {
    return { network, open, read: false, mandates: [], pilot: null, cares: [] };
  }
}

/** Whether any of the agent's switches stands open here: none — the route does not exist for the deployment. */
export function agentsOpen(env: Env): boolean {
  return mandateGate(env).open || careGate(env).open;
}

/** A wallet's agents, mainnet and devnet apart. */
export async function agentsOfOwner(owner: string, deps: OwnerDeps = {}): Promise<OwnerAgents> {
  const env = deps.env ?? process.env;
  const store = deps.store ?? getGuardRuntime().store;
  const [mainnet, devnet] = await Promise.all(AGENT_NETWORKS.map((network) => networkAgents(owner, network, { ...deps, env, store })));
  return { owner, networks: { mainnet: mainnet!, devnet: devnet! } };
}
