/**
 * What Ryntra's agent never buys, and whom it never trades with: read every time, before its key is asked.
 *
 * - **No coin of Ryntra's launchpad.** A coin Launch's own record names (`launches`, `../launch/record-key.ts` — the one
 *   registry `/launches` reads), in any state, is never bought by the agent: Ryntra's keys do not lift Ryntra's coins.
 * - **No coin of the person's own.** A coin whose mint or freeze authority is the person, her vault or a key of Ryntra's,
 *   or that Launch records as her launch, is never bought for her — her agent does not buy her own coin.
 * - **No other key of Ryntra's in the trade.** Besides the agent itself and Ryntra's fee account, no account of the
 *   trade is a wallet of Ryntra's — the executor, the pool payer, the treasury, the payout wallets, the internal ones —
 *   or another agent's vault, and no token account in it belongs to one: Ryntra's agents never trade with each other.
 *
 * The registry not read is a refusal, never a pass: a signer that cannot ask does not sign (`./signer.server.ts`).
 * Public data only: addresses and Launch's record.
 */

import { PublicKey } from "@solana/web3.js";

import { internalWalletsFromEnv, listInternalWallets } from "../admin/internal-wallets.ts";
import { ATTRIBUTION_REGISTRY, type RegistryRole } from "../attribution/registry.ts";
import type { GuardStore } from "../guard/store.ts";
import { launchKey } from "../launch/record-key.ts";
import type { AccountFacts } from "./judge.ts";
import { tokenAccountOf, type Mandate } from "./human.ts";
import { agentFeeAccount, agentFeeWallet } from "./fee.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "./ssa.ts";
import { stocksOf, type StockShelf } from "./stocks.server.ts";
import { feeMintOf } from "./terms.ts";
import { TOKEN_2022_PROGRAM_ID, isTokenProgram } from "./token-2022.ts";

/** Where a coin comes from, by Launch's own record: launched on Ryntra, and by whom. */
export type CoinOrigin = Readonly<{ launchedHere: boolean; creator: string | null }>;

export type AgentScreen = Readonly<{
  /** Launch's record of the coin; throws when the registry is not read. */
  origin(mint: string): Promise<CoinOrigin>;
  /** Ryntra's own wallets and every agent's vault and budget; throws when not read. */
  ryntra(): Promise<ReadonlySet<string>>;
  /**
   * Whether a mint is, by its address, a stock of the shelf of verified companies now (`./stocks.server.ts`);
   * throws when the shelf is not read. Absent — no coin is a stock. Asked only of a coin the strict rule refused.
   */
  stock?: StockShelf;
}>;

/** The registry's roles whose wallets are keys of Ryntra's that hold or move money — never a counterparty of the agent. */
export const RYNTRA_KEY_ROLES: readonly RegistryRole[] = Object.freeze([
  "AGENT_SIGNER",
  "LAUNCH_EXECUTOR",
  "LAUNCH_REVENUE",
  "LAUNCH_POOL_PAYER",
  "LAUNCH_FEE_CLAIMER",
  "TREASURY",
  "PAYOUT_CASHBACK",
  "PAYOUT_FRIENDS",
  "PAYOUT_INTEGRATORS",
  "PAYOUT_REWARDS",
]);

/** The registry's wallets of those roles on Solana — a key retired is still Ryntra's. */
export function registryKeys(rows = ATTRIBUTION_REGISTRY): readonly string[] {
  return [...new Set(rows.filter((row) => row.network === "solana" && row.address && RYNTRA_KEY_ROLES.includes(row.role)).map((row) => row.address!))];
}

type BookRow = Readonly<{ record?: Readonly<{ vault?: unknown; budget?: unknown }> }>;

/** The screen read from the store: Launch's `launches` and the agent's book on this network, the registry and the internal wallets. */
export function storeScreen(store: GuardStore, cluster: string, env: Readonly<Record<string, string | undefined>> = process.env): AgentScreen {
  return {
    async origin(mint) {
      const record = await store.collection<Readonly<{ state?: string; creator?: string }>>("launches").get(launchKey(cluster, mint));
      return record ? { launchedHere: true, creator: typeof record.creator === "string" ? record.creator : null } : { launchedHere: false, creator: null };
    },
    async ryntra() {
      const internal = await listInternalWallets(store);
      if (internal.status !== "measured") throw new Error("the internal wallets are not read");
      const book = store.collection<BookRow>("agentMandates");
      const [mandates, sales] = await Promise.all([book.valuesWithPrefix(`m:${cluster}:`), book.valuesWithPrefix(`s:${cluster}:`)]);
      const out = new Set<string>([...registryKeys(), ...internalWalletsFromEnv(env), ...internal.rows.map((row) => row.wallet)]);
      for (const row of [...mandates, ...sales]) {
        for (const value of [row.record?.vault, row.record?.budget]) if (typeof value === "string") out.add(value);
      }
      return out;
    },
    stock: stocksOf(cluster),
  };
}

/** A screen that knows no coin, no key and no stock — for a test's own chain only. */
export const OPEN_SCREEN: AgentScreen = Object.freeze({ origin: async () => ({ launchedHere: false, creator: null }), ryntra: async () => new Set<string>() });

const MINT_BYTES = 82;
const ACCOUNT_BYTES = 165;

/** A token program's account read from its bytes: a mint's two authorities, or an account's owner. */
function tokenRead(read: Readonly<{ owner: PublicKey; data: Uint8Array }> | undefined): Readonly<{ kind: "mint"; authorities: readonly PublicKey[] }> | Readonly<{ kind: "account"; owner: PublicKey }> | null {
  if (!read || !isTokenProgram(read.owner)) return null;
  const data = read.data;
  const extended = data.length > ACCOUNT_BYTES ? data[ACCOUNT_BYTES] : null;
  if (data.length === MINT_BYTES || extended === 1) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const authorities: PublicKey[] = [];
    if (view.getUint32(0, true) === 1) authorities.push(new PublicKey(data.subarray(4, 36)));
    if (view.getUint32(46, true) === 1) authorities.push(new PublicKey(data.subarray(50, 82)));
    return { kind: "mint", authorities };
  }
  if (data.length === ACCOUNT_BYTES || extended === 2) return { kind: "account", owner: new PublicKey(data.subarray(32, 64)) };
  return null;
}

/**
 * The mandate's own: the agent, the person, her account, vault and budget, their token accounts of the mandate's coins
 * (a sale's budget is the coin, while the book keeps the vault's wSOL), Ryntra's fee wallet and account. `bought` — the
 * coin this trade buys: her account of it and her vault's are her own too. The book keeps the vault's account of a coin
 * as the budget of every sale of hers, and Jupiter's route lands each buy there first — without this a person who once
 * reviewed a sale had every later buy of that coin refused as «another key of Ryntra's» (the mainnet fork).
 */
function ownOf(mandate: Mandate, bought?: PublicKey): ReadonlySet<string> {
  const feeMint = feeMintOf(mandate.terms);
  /* The coin the agent keeps — its vault's account and hers — is the mandate's own too. */
  const mints = [NATIVE_MINT, mandate.terms.budgetMint, feeMint, ...(mandate.terms.fixedBuy ? [mandate.terms.fixedBuy.outputMint] : []), ...(mandate.terms.heldCoin ? [mandate.terms.heldCoin.mint] : []), ...(bought ? [bought] : [])];
  const accounts = [mandate.vault, mandate.terms.human].flatMap((owner) => mints.flatMap((mint) => [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) => tokenAccountOf(owner, mint, program))));
  const own = [mandate.terms.agent, mandate.terms.human, mandate.settings, mandate.vault, mandate.budgetAccount, ...accounts].map((key) => key.toBase58());
  return new Set([...own, agentFeeWallet().toBase58(), agentFeeAccount(feeMint).toBase58()]);
}

/** Why the agent does not buy this coin for this mandate; null when it may. */
export function coinRefusal(mint: PublicKey, origin: CoinOrigin, mandate: Mandate, ryntra: ReadonlySet<string>, facts: AccountFacts): string | null {
  if (origin.launchedHere) return origin.creator === mandate.terms.human.toBase58() ? "the coin is the person's own launch" : "the coin was launched on Ryntra";
  const read = tokenRead(facts.get(mint.toBase58()));
  if (read?.kind === "mint") {
    for (const authority of read.authorities) {
      if (authority.equals(mandate.terms.human) || authority.equals(mandate.vault)) return "the coin is the person's own";
      if (ryntra.has(authority.toBase58()) || authority.equals(mandate.terms.agent)) return "the coin is Ryntra's own";
    }
  }
  return null;
}

/** Why an account of the trade is another key of Ryntra's, or one of its token accounts; null when none is. `bought` — the coin the trade buys. */
export function ryntraAccountRefusal(accounts: readonly PublicKey[], mandate: Mandate, ryntra: ReadonlySet<string>, facts: AccountFacts, bought?: PublicKey): string | null {
  const own = ownOf(mandate, bought);
  for (const account of accounts) {
    const key = account.toBase58();
    if (own.has(key)) continue;
    if (ryntra.has(key)) return "the trade names another key of Ryntra's";
    const read = tokenRead(facts.get(key));
    if (read?.kind === "account" && !own.has(read.owner.toBase58()) && ryntra.has(read.owner.toBase58())) return "the trade moves a token account of another key of Ryntra's";
  }
  return null;
}
