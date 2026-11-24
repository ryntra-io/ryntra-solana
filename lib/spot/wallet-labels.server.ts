/**
 * The reads behind the wallets' marks (`./wallet-labels.ts`): the deployment's bar for a big trade, Ryntra's
 * agents from the attribution registry, and how old a few traders' wallets are.
 *
 * The age is the one new read: a wallet's newest signatures from Ryntra's own node, at most `AGE_PER_READ` wallets a
 * trades read (the largest buyers first), within a per-minute and a per-day budget per instance (`AGE_PER_MINUTE`;
 * `RYNTRA_SPOT_WALLET_AGES_DAILY_READS`, 5 000 a UTC day unless set), each answer kept — a wallet that is
 * not fresh stays so for a day, a fresh one is read again after half an hour. A wallet whose age was not read carries
 * no `fresh` mark, and the answer says how many were read (`LabelBasis.fresh`). The age is read only where the
 * deployment opens it (`RYNTRA_SPOT_WALLET_AGES=on`): closed, no wallet is aged and nothing is asked of the node.
 *
 * Reads only: public addresses and signatures, no key.
 */

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { dayBudget, dayCeilingOf } from "./day-budget.ts";
import { bigTradeUsdOf, BIG_TRADE_ENV, FRESH_HOURS_ENV, FRESH_TX_ENV, freshRuleOf, walletAgeOf, WALLET_LABEL_DEFAULTS, type WalletAge, type WalletLabelSettings } from "./wallet-labels.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The settings of the marks for this deployment: the default rules, with the big-trade bar and the fresh wallet's two bars from the environment. */
export function walletLabelSettings(env: Env = process.env): WalletLabelSettings {
  return { ...WALLET_LABEL_DEFAULTS, bigTradeUsd: bigTradeUsdOf(env[BIG_TRADE_ENV]), ...freshRuleOf(env[FRESH_HOURS_ENV], env[FRESH_TX_ENV]) };
}

/** Ryntra's agents' keys on Solana: the registry's `AGENT_SIGNER` rows with an address, open or closed — a past trade is still the agent's. */
export function ryntraAgents(rows = ATTRIBUTION_REGISTRY): ReadonlySet<string> {
  const out = new Set<string>();
  for (const row of rows) if (row.role === "AGENT_SIGNER" && row.network === "solana" && typeof row.address === "string" && row.address.length > 0) out.add(row.address);
  return out;
}

/* ------------------------------------------------------------------ ages */

/** The switch of the age reads: closed unless exactly `on`. */
export const WALLET_AGE_ENV = "RYNTRA_SPOT_WALLET_AGES";

export function walletAgesOpen(env: Env = process.env): boolean {
  return env[WALLET_AGE_ENV] === "on";
}

/** Wallets whose age one trades read may ask for. */
export const AGE_PER_READ = 8;
/** Age reads one instance makes a minute, all coins together. */
export const AGE_PER_MINUTE = 60;
/** Age reads one instance makes in a calendar day (UTC), all coins together: a list of signatures of the node each. */
export const WALLET_AGE_DAILY_ENV = "RYNTRA_SPOT_WALLET_AGES_DAILY_READS";
export const AGE_PER_DAY = 5_000;
const AGE_WAIT_MS = 2_500;
const FRESH_TTL_MS = 30 * 60_000;
const SETTLED_TTL_MS = 24 * 3_600_000;
const AGE_CEILING = 5_000;

const ages = new Map<string, { age: WalletAge; readAt: number }>();
const asked = new Map<string, Promise<void>>();
let minute = { startedAt: 0, spent: 0 };
const day = dayBudget();

/** The ages known now, for the book: a read past its time is forgotten. */
export function knownAges(wallets: Iterable<string>, now = Date.now()): Map<string, WalletAge> {
  const out = new Map<string, WalletAge>();
  for (const wallet of wallets) {
    const hit = ages.get(wallet);
    if (!hit) continue;
    if (now - hit.readAt > (hit.age.fresh ? FRESH_TTL_MS : SETTLED_TTL_MS)) {
      ages.delete(wallet);
      continue;
    }
    out.set(wallet, hit.age);
  }
  return out;
}

function rememberAge(wallet: string, age: WalletAge, now: number): void {
  ages.delete(wallet);
  ages.set(wallet, { age, readAt: now });
  while (ages.size > AGE_CEILING) {
    const oldest = ages.keys().next().value;
    if (oldest === undefined) break;
    ages.delete(oldest);
  }
}

type SignatureLister = (wallet: string, limit: number, signal: AbortSignal) => Promise<readonly { blockTime?: number | bigint | null }[]>;

const nodeLister: SignatureLister = async (wallet, limit, signal) => {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: AGE_WAIT_MS });
  const list = await handle.rpc.getSignaturesForAddress(wallet as never, { limit, commitment: "confirmed" }).send({ abortSignal: signal });
  return list as readonly { blockTime?: number | bigint | null }[];
};

/**
 * Reads the age of up to `AGE_PER_READ` wallets, within the minute's budget, waiting at most `AGE_WAIT_MS`: what
 * answers in time is kept; what does not is simply not known this time.
 */
export async function readWalletAges(wallets: readonly string[], settings: WalletLabelSettings, deps: Readonly<{ list?: SignatureLister; now?: () => number; env?: Env }> = {}): Promise<void> {
  if (!walletAgesOpen(deps.env)) return;
  const now = deps.now ?? Date.now;
  const list = deps.list ?? nodeLister;
  const at = now();
  if (at - minute.startedAt >= 60_000) minute = { startedAt: at, spent: 0 };
  const daily = dayCeilingOf((deps.env ?? process.env)[WALLET_AGE_DAILY_ENV], AGE_PER_DAY);
  const known = knownAges(wallets, at);
  const todo = wallets.filter((wallet) => !known.has(wallet)).slice(0, AGE_PER_READ);
  const reads: Promise<void>[] = [];
  for (const wallet of todo) {
    const pending = asked.get(wallet);
    if (pending) {
      reads.push(pending);
      continue;
    }
    if (minute.spent >= AGE_PER_MINUTE) break;
    /* The day's ceiling: past it no wallet is aged until the next UTC day — its mark is simply not known. */
    if (!day.allows(1, daily, at)) break;
    minute.spent += 1;
    day.spend(1, at);
    const limit = settings.freshMaxTransactions;
    const read = list(wallet, limit, AbortSignal.timeout(AGE_WAIT_MS))
      .then((signatures) => {
        const age = walletAgeOf(signatures.map((entry) => ({ blockTime: entry.blockTime === null || entry.blockTime === undefined ? null : Number(entry.blockTime) })), limit, now(), settings);
        if (age) rememberAge(wallet, age, now());
      })
      .catch(() => {
        /* A wallet the node did not list in time is not known this time. */
      })
      .finally(() => asked.delete(wallet));
    asked.set(wallet, read);
    reads.push(read);
  }
  if (reads.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(reads), new Promise<void>((resolve) => (timer = setTimeout(resolve, AGE_WAIT_MS)))]);
  clearTimeout(timer);
}

/** Test seam: forget the ages and the minute's budget. */
export function resetWalletAges(): void {
  ages.clear();
  asked.clear();
  minute = { startedAt: 0, spent: 0 };
  day.reset();
}
