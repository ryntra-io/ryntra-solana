import { readBusinessInputs } from "../admin/business.server.ts";
import { projectBusiness } from "../admin/business.ts";
import { resolveInternalWallets } from "../admin/internal-wallets.ts";
import { teamLaunchWallets } from "../core/launch/team-launch.ts";
import type { GuardStore } from "../guard/store.ts";
import type { LaunchRecord } from "../launch/flow.server.ts";
import { LAUNCH_SIGNER_ENV } from "../launch/signer/select.server.ts";
import { readBook } from "../mandate/book.server.ts";
import { pairFeeBps } from "../mandate/fee-rates.ts";
import { readSales } from "../mandate/sale.server.ts";
import { mandateGate } from "../mandate/service.server.ts";
import { payoutsOn } from "../partner-payouts/payouts.server.ts";
import { readStatement } from "../partner-payouts/store.server.ts";
import { readPartnerBindings } from "./network-store.ts";
import { mondayStart, projectDemand, WEEK_MS, type AgentIn, type Arrival, type DemandInputs, type DemandWeek, type LaunchIn, type SaleIn } from "./demand-week.ts";

/**
 * The store reads behind the owner's week of demand (CITY-197), and nothing else: the action ledger and the fees as
 * «Аналітика» reads them (`readBusinessInputs`, `projectBusiness`), the launches, the agents' book and sales, the
 * partners' links and launches, the week's partner statement, and SOL's price. Each read that fails leaves its figures
 * unread; nothing here throws into a route or the cron. Reads only.
 */

type Env = Readonly<Record<string, string | undefined>>;

const SOL = "So11111111111111111111111111111111111111112";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

async function settle<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

/** Ryntra's own wallets: the owner's list and the deployment's, the launch signers, the team's canary, the agent. */
export async function ourWallets(store: GuardStore, env: Env): Promise<ReadonlySet<string> | null> {
  const internal = await resolveInternalWallets(store, env);
  if (internal.store !== "measured") return null;
  const ours = new Set(internal.wallets);
  for (const role of Object.values(LAUNCH_SIGNER_ENV)) {
    const address = env[role.address]?.trim();
    if (address && BASE58.test(address)) ours.add(address);
  }
  for (const wallet of teamLaunchWallets(env)) ours.add(wallet);
  const gate = mandateGate(env);
  if (gate.open) ours.add(gate.agent.toBase58());
  return ours;
}

export type DemandDeps = Readonly<{
  /** Ryntra's fee rate on an agent's buy of the coin, basis points; null — not read. */
  feeBps?: (mint: string) => Promise<number | null>;
  /** SOL in dollars now; null — not read. */
  solUsd?: () => Promise<number | null>;
}>;

/** The table's rate for the agent's buy of a coin with SOL, as the agent's own route reads it. */
async function agentBuyBps(mint: string): Promise<number | null> {
  const { readSideFacts } = await import("../core/solana-swap/fee-route.server.ts");
  const [input, output] = await Promise.all([readSideFacts(SOL), readSideFacts(mint)]);
  return pairFeeBps(SOL, mint, { input, output, nowMs: Date.now() });
}

async function solPrice(): Promise<number | null> {
  const { fetchTokenCatalog } = await import("../solana/catalog.ts");
  const catalog = await fetchTokenCatalog([SOL], 5_000);
  const price = catalog.ok ? Number(catalog.byMint[SOL]?.usdPrice ?? Number.NaN) : Number.NaN;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function readDemandInputs(store: GuardStore, week: string, env: Env, deps: DemandDeps = {}): Promise<DemandInputs> {
  const start = mondayStart(week);
  const end = start + WEEK_MS;
  const [ours, business, launches, book, sales, accounts, bindings, statement] = await Promise.all([
    settle(() => ourWallets(store, env)),
    settle(() => readBusinessInputs(store, { now: new Date(end).toISOString(), range: "7d", scope: "external", env: env as NodeJS.ProcessEnv })),
    settle(() => store.collection<LaunchRecord>("launches").valuesWithPrefix("solana:mainnet:")),
    settle(() => readBook(store, "mainnet")),
    settle(() => readSales(store, undefined, "mainnet")),
    settle(() => store.versioned<Readonly<{ version: number; wallet: string; referrer?: string | null; referredAt?: string | null }>>("rewardAccounts").valuesWithPrefix("")),
    settle(() => readPartnerBindings(store)),
    settle(async () => ({ row: await readStatement(store, "mainnet", week) })),
  ]);

  const launchRows: LaunchIn[] | null = launches ? launches.filter((row) => row.cluster === "mainnet").map((row) => ({ creator: row.creator, launchedAt: row.launchedAt ?? null, state: row.state })) : null;

  /* What a person did herself: every finished action on mainnet, and her launches. */
  let activity: Arrival[] | null = null;
  if (business && business.sources.actions === "measured" && launchRows) {
    activity = [];
    for (const action of business.actions) if (action.network === "mainnet" && action.outcome === "DONE") activity.push({ wallet: action.wallet, at: Date.parse(action.startedAt) });
    for (const row of launchRows) if (row.state === "LAUNCHED") activity.push({ wallet: row.creator, at: Date.parse(row.launchedAt ?? "") });
  }

  /* The week's own fees: the ledger's rows up to the week's end, projected as «Аналітика» projects them. */
  let swapsUsd: number | null = null;
  if (business && business.sources.actions === "measured" && ours) {
    /* Ryntra's own wallets — the signers and the agent too — are no customers. */
    const inWeek = { ...business, internalWallets: ours, actions: business.actions.filter((action) => Date.parse(action.startedAt) < end) };
    const retained = projectBusiness(inWeek).revenue.retainedUsd;
    swapsUsd = retained.status === "measured" && typeof retained.value === "number" ? retained.value : null;
  }

  const agents: AgentIn[] | null = book ? book.map((entry) => ({ owner: entry.record.owner, receiveMint: entry.receiveMint, trades: entry.trades })) : null;
  const saleRows: SaleIn[] | null = sales ? sales.map((sale) => ({ owner: sale.record.owner, status: sale.status, at: sale.updatedAt, gotRaw: sale.trade?.receivedRaw ?? null, feeRaw: sale.feeRaw })) : null;

  /* The fee rate of each coin the agents bought in the week; a coin whose rate did not read leaves the fees unread. */
  let agentFeeBps: Map<string, number> | null = null;
  if (book) {
    agentFeeBps = new Map();
    const mints = new Set(book.filter((entry) => entry.trades.some((trade) => trade.status === "ok" && trade.at >= start && trade.at < end)).map((entry) => entry.receiveMint));
    const read = deps.feeBps ?? agentBuyBps;
    await Promise.all(
      [...mints].map(async (mint) => {
        const bps = await read(mint).catch(() => null);
        if (bps !== null) agentFeeBps!.set(mint, bps);
      }),
    );
  }

  /* What the week owes partners: its statement's share; no statement while payouts are shut — nothing owed. */
  let partnersUsd: number | null = null;
  if (statement?.row) partnersUsd = statement.row.state === "VOID" ? 0 : Number(BigInt(statement.row.totals.accruedMicros)) / 1_000_000;
  else if (statement && !payoutsOn(env as NodeJS.ProcessEnv)) partnersUsd = 0;

  const referred: Arrival[] | null = accounts ? accounts.filter((row) => row.referrer && row.referredAt).map((row) => ({ wallet: row.wallet, at: Date.parse(row.referredAt!) })) : null;
  const poolPartners: Arrival[] | null = bindings ? bindings.map((row) => ({ wallet: row.creator, at: Date.parse(row.recordedAt) })) : null;

  const solUsd = await (deps.solUsd ?? solPrice)().catch(() => null);

  return {
    week,
    ours,
    launches: launchRows,
    agents,
    sales: saleRows,
    agentFeeBps,
    activity,
    referred,
    poolPartners,
    swapsUsd,
    partnersUsd,
    solUsd,
  };
}

export async function readDemandWeek(store: GuardStore, week: string, env: Env, deps: DemandDeps = {}): Promise<DemandWeek> {
  return projectDemand(await readDemandInputs(store, week, env, deps));
}
