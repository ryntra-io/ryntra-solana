/**
 * The public statistics, assembled — server only.
 *
 * The ledger is read live on every request: the count a person sees is the
 * store at the moment they asked, so a confirmed operation is on the page
 * within seconds of its row. The chain read is shared and ten minutes old at
 * most; it only verifies. The verified stock universe classifies stock
 * operations and names their tickers; Jupiter's catalogue names the rest.
 * A source that did not answer says so on the page; no block draws a zero
 * for a source that failed.
 *
 * The deployment may name a public dashboard (`RYNTRA_PUBLIC_DASHBOARD_URL`);
 * when it does not, the page says nothing about one.
 *
 * Cashback and friends' rewards are read from the reward ledger the growth
 * module writes — read only, through its own schema and its own rule for a
 * later valuation — and matched to an operation by the reference the reward
 * names. A ledger that does not answer leaves every operation without rewards
 * rather than with zeros, and the page says so.
 */

import { internalWalletsFromEnv, resolveInternalWallets } from "../admin/internal-wallets.ts";
import { KNOWN_MINTS, projectOperations, type CctpBurnRef, type CrossSwapOrderRef, type MintNames, type OperationRecord, type OperationRewards, type OperationSource } from "../analytics/operations.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { RewardEntrySchema, type RewardEntry } from "../rewards/model.ts";
import { SolanaWalletActionSchema, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import { readStockUniverse } from "../stocks/universe.server.ts";
import { SWAP_NETWORKS, type SwapNetwork } from "../swap/catalog.ts";
import { readAttribution } from "./chain.server.ts";
import { feeWalletAccounts } from "./ata.ts";
import { readLaunchStarts } from "./launch-starts.server.ts";
import { ATTRIBUTION_REGISTRY, publicRegistryDocument, registryFacts } from "./registry.ts";
import { rewardsByOperation } from "./rewards.ts";
import { buildLedgerStats, buildOnchainStats, buildStatsModel, chainAttributionOf, type StatsModel } from "./stats-model.ts";

export const PUBLIC_DASHBOARD_ENV = "RYNTRA_PUBLIC_DASHBOARD_URL";

type StockNames = Readonly<{ mints: ReadonlySet<string>; names: MintNames }>;

async function readStockNames(): Promise<StockNames | null> {
  try {
    const read = await readStockUniverse();
    if (!read.ok) return null;
    const names: Record<string, { symbol: string; decimals: number | null }> = {};
    for (const row of read.universe.rows) names[row.representation.mint] = { symbol: row.representation.symbol, decimals: row.representation.decimals };
    return { mints: new Set(Object.keys(names)), names };
  } catch {
    return null;
  }
}

function isSwapNetwork(value: unknown): value is SwapNetwork {
  return typeof value === "string" && (SWAP_NETWORKS as readonly string[]).includes(value);
}

type Ledger = Readonly<{
  actions: readonly SolanaWalletAction[];
  orders: ReadonlyMap<string, CrossSwapOrderRef>;
  burns: ReadonlyMap<string, CctpBurnRef>;
  internalWallets: ReadonlySet<string>;
  /** Rewards by operation reference; null when the reward ledger did not answer. */
  rewards: ReadonlyMap<string, OperationRewards> | null;
}>;

async function readRewards(store: GuardStore): Promise<ReadonlyMap<string, OperationRewards> | null> {
  try {
    const rows = await store.collection<unknown>("rewardEntries").valuesWithPrefix("");
    const entries: RewardEntry[] = [];
    for (const row of rows) {
      const parsed = RewardEntrySchema.safeParse(row);
      if (parsed.success) entries.push(parsed.data);
    }
    return rewardsByOperation(entries);
  } catch {
    return null;
  }
}

const CCTP_DIRECTIONS = new Set(["SOLANA_TO_BASE", "BASE_TO_SOLANA", "SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"]);

async function readLedger(env: NodeJS.ProcessEnv): Promise<Readonly<{ ledger: Ledger | null; internalWallets: ReadonlySet<string> }>> {
  try {
    const store = getGuardRuntime().store;
    const [rawActions, rawOrders, rawBurns, internal, rewards] = await Promise.all([
      store.collection<unknown>("solanaWalletActions").valuesWithPrefix("solana:mainnet:"),
      store.collection<unknown>("solanaCrossSwapOrders").valuesWithPrefix(""),
      store.collection<unknown>("solanaCctpBurns").valuesWithPrefix(""),
      resolveInternalWallets(store, env),
      readRewards(store),
    ]);
    const actions: SolanaWalletAction[] = [];
    for (const row of rawActions) {
      const parsed = SolanaWalletActionSchema.safeParse(row);
      if (parsed.success) actions.push(parsed.data);
    }
    const orders = new Map<string, CrossSwapOrderRef>();
    for (const row of rawOrders) {
      const order = row as { intentDigest?: unknown; provider?: unknown; sourceChain?: unknown; destinationChain?: unknown; sourceTxHash?: unknown; destinationTxHash?: unknown };
      if (typeof order.intentDigest !== "string" || (order.provider !== "MAYAN" && order.provider !== "RELAY")) continue;
      if (!isSwapNetwork(order.sourceChain) || !isSwapNetwork(order.destinationChain)) continue;
      orders.set(order.intentDigest, {
        provider: order.provider,
        sourceChain: order.sourceChain,
        destinationChain: order.destinationChain,
        sourceTxHash: typeof order.sourceTxHash === "string" ? order.sourceTxHash : null,
        destinationTxHash: typeof order.destinationTxHash === "string" ? order.destinationTxHash : null,
      });
    }
    const burns = new Map<string, CctpBurnRef>();
    for (const row of rawBurns) {
      const claim = row as { intentDigest?: unknown; direction?: unknown; burnSignature?: unknown; mintTransactionHash?: unknown };
      if (typeof claim.intentDigest !== "string") continue;
      const direction = typeof claim.direction === "string" && CCTP_DIRECTIONS.has(claim.direction) ? (claim.direction as CctpBurnRef["direction"]) : "SOLANA_TO_BASE";
      burns.set(claim.intentDigest, {
        direction,
        burnTx: typeof claim.burnSignature === "string" ? claim.burnSignature : null,
        mintTx: typeof claim.mintTransactionHash === "string" ? claim.mintTransactionHash : null,
      });
    }
    return { ledger: { actions, orders, burns, internalWallets: internal.wallets, rewards }, internalWallets: internal.wallets };
  } catch {
    /* The store did not answer; the deployment's own list still names Ryntra's internal wallets. */
    return { ledger: null, internalWallets: new Set(internalWalletsFromEnv(env)) };
  }
}

/** Names for the mints the rows carry without a symbol: the stock universe first, then Jupiter's catalogue, briefly. */
async function resolveNames(actions: readonly SolanaWalletAction[], stocks: StockNames | null): Promise<MintNames> {
  const names: Record<string, { symbol: string; decimals: number | null }> = { ...KNOWN_MINTS, ...(stocks?.names ?? {}) };
  const unknown = new Set<string>();
  for (const action of actions) {
    for (const movement of [action.out, action.in]) {
      if (movement?.mint && !movement.symbol && !names[movement.mint]) unknown.add(movement.mint);
    }
    if (action.fee?.asset && !action.fee.symbol && !names[action.fee.asset]) unknown.add(action.fee.asset);
  }
  if (unknown.size === 0) return names;
  try {
    const catalog = await fetchTokenCatalog([...unknown], 2_500);
    if (catalog.ok) {
      for (const [mint, entry] of Object.entries(catalog.byMint)) {
        if (entry.symbol) names[mint] = { symbol: entry.symbol, decimals: entry.decimals ?? null };
      }
    }
  } catch {
    /* A catalogue that does not answer leaves the mint, which is honest and still readable. */
  }
  return names;
}

function dashboardUrl(env: NodeJS.ProcessEnv): string | null {
  const value = env[PUBLIC_DASHBOARD_ENV]?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Everything the projection needs, read once; shared by the public model and the admin's operations view. */
export async function readOperationSource(deps: Readonly<{ env?: NodeJS.ProcessEnv }> = {}): Promise<Readonly<{ source: OperationSource | null; chain: Awaited<ReturnType<typeof readAttribution>>; internalWallets: ReadonlySet<string>; stockMints: ReadonlySet<string> | null }>> {
  const env = deps.env ?? process.env;
  const [chain, stocks, ledger] = await Promise.all([readAttribution(), readStockNames(), readLedger(env)]);
  if (!ledger.ledger) return { source: null, chain, internalWallets: ledger.internalWallets, stockMints: stocks?.mints ?? null };
  const names = await resolveNames(ledger.ledger.actions, stocks);
  return {
    source: {
      actions: ledger.ledger.actions,
      orders: ledger.ledger.orders,
      burns: ledger.ledger.burns,
      stockMints: stocks?.mints ?? null,
      internalWallets: ledger.ledger.internalWallets,
      names,
      chain: chainAttributionOf(chain),
      ...(ledger.ledger.rewards ? { rewards: ledger.ledger.rewards } : {}),
    },
    chain,
    internalWallets: ledger.internalWallets,
    stockMints: stocks?.mints ?? null,
  };
}

/** The admin's view: every projected operation, whole. */
export async function readAllOperations(deps: Readonly<{ env?: NodeJS.ProcessEnv }> = {}): Promise<Readonly<{ operations: readonly OperationRecord[]; chainReadAt: string | null; chainComplete: boolean | null }>> {
  const read = await readOperationSource(deps);
  return {
    operations: read.source ? projectOperations(read.source) : [],
    chainReadAt: read.chain.ok ? read.chain.readAt : null,
    chainComplete: read.chain.ok ? read.chain.coverage.complete : null,
  };
}

/**
 * The registry with where each row started — only from a read that saw the
 * whole history: a partial read may have missed the first credit, and an
 * earlier start written as the first would be a wrong fact.
 */
export async function registryDocumentOf(chain: Awaited<ReturnType<typeof readAttribution>>) {
  /* A read kept from before the reader named first credits has none to give: unknown, not "none yet". */
  const whole = chain.ok && chain.coverage.complete && !chain.coverage.truncated && Array.isArray(chain.firstCredits);
  const feeAccounts = new Map<string, readonly string[]>();
  for (const row of ATTRIBUTION_REGISTRY) {
    if (row.kind === "FEE_WALLET" && row.address !== null) feeAccounts.set(row.id, (await feeWalletAccounts(row.address)).map((entry) => entry.account));
  }
  return publicRegistryDocument(undefined, whole ? registryFacts(chain.firstCredits) : null, feeAccounts, await readLaunchStarts());
}

export async function readPublicStats(deps: Readonly<{ env?: NodeJS.ProcessEnv; now?: () => Date }> = {}): Promise<StatsModel> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  const read = await readOperationSource({ env });
  return buildStatsModel({
    generatedAt: now.toISOString(),
    ledger: buildLedgerStats(read.source, now),
    onchain: buildOnchainStats(read.chain, { stockMints: read.stockMints, internalWallets: read.internalWallets }),
    dashboardUrl: dashboardUrl(env),
    registry: await registryDocumentOf(read.chain),
  });
}
