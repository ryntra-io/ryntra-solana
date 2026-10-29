/**
 * Ryntra's financial panel (SOL-F1) — the reads. Server only; read only: nothing here signs, sends or writes.
 *
 * - **launches** — every Ryntra launch on this network: its market's trades as the swap events show them (the read its
 *   page makes), the creator role's counters (the curve's total trading fee among them), the partner's counters, the
 *   executor's own ledger of its claims, the creators' receipts and the trades sent through Ryntra;
 * - **claims** — the history of each fee claimer (the partner's vault on Classic and Protected, the executor on Micro
 *   and the demo market), every claim decoded from its instruction and the program's event
 *   (`lib/growth/pool-share.ts` — the Growth line's decoder, only read here);
 * - **the terminal** — the operations ledger projected with its chain read (`/stats`'s), and what the referral
 *   accounts hold now;
 * - **rewards** — the reward ledger, read through its own schema and rule (`lib/rewards`), and each payout's
 *   transaction;
 * - **costs** — the network fees Ryntra's executor, pool payer and rewards treasury paid as fee payers, the executor's
 *   receipts, the growth budget's spending.
 *
 * One read is kept for a short while and shared by both scopes; a read that runs out of time says what it did not
 * reach, and the projection marks it unread.
 */

import { readOperationSource } from "../attribution/stats.server.ts";
import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { projectOperations, type OperationRecord } from "../analytics/operations.ts";
import { budgetPreset } from "../core/launch/revenue-rule.ts";

import { readPartnerFees } from "../core/venues/meteora-dbc/partner.server.ts";
import { extractSolanaClaims, type RawTransaction } from "../growth/pool-share.ts";
import { jsonRpc, type JsonRpc } from "../growth/pool-share-read.server.ts";
import { autopilotReceipts } from "../launch/autopilot.server.ts";
import { readBudgetRecord } from "../launch/budget.server.ts";
import { launchArchiveEndpoint, launchExecutorAddress, launchHistoryEndpoint, launchPair, launchPoolPayerAddress, type LaunchNetwork } from "../launch/config.server.ts";
import { resolveEndpoints } from "../solana/rpc.ts";
import { creatorFeesOf, listClaimReceipts } from "../launch/creator.server.ts";
import type { LaunchRecord } from "../launch/flow.server.ts";
import { readLaunchMarketFacts } from "../launch/market.server.ts";
import { partnerLedgerOf, partnerLpFromExit, readPartnerJournal, type PartnerJournalEntry } from "../launch/partner-claims.server.ts";
import { launchMarketDeps, ryntraOwnWallets } from "../launch/runtime.server.ts";
import { budgetMonthOf, readGrowthBudget } from "../rewards/budget.ts";
import { effectiveRewardEntries } from "../rewards/ledger.ts";
import { REWARD_PAR_MINTS, RewardEntrySchema, type RewardEntry } from "../rewards/model.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore, GuardVersionedRecord } from "../guard/store.ts";
import { createReadKeeper, settleBy } from "./finance-read.ts";
import { MANUAL_COSTS } from "./finance-manual.ts";
import { listFeedback } from "./store.ts";
import type { SuccessInputs, SuccessLaunch } from "./success.ts";
import { AgentReceiptSchema } from "../agent/budget.ts";
import { CREDITS_COLLECTION } from "../assistant/credits/ledger.ts";
import { listAllRuleRecords } from "../autoinvest/store.ts";
import { journalMarks, readExecutorMarkets } from "../launch/executor.server.ts";
import { projectFinance, type FinanceClaim, type FinanceCosts, type FinanceInputs, type FinanceLaunch, type FinanceModel, type FinanceOperation, type FinanceRewards, type FinanceScope, type FinanceTerminalChain, type FinanceWalletCost } from "./finance.ts";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qQ1EaxXHzDZb9TEP6s8KAwJ8t";
/**
 * The whole read: inside the route's five minutes, with room to answer. A cold read of every claimer's and wallet's
 * history through a public node takes minutes (measured on the stand 19.10: the first 48 s reached one launch of four);
 * each finalized transaction is then kept, so a later read takes seconds.
 */
const READ_BUDGET_MS = 240_000;
/** How long one read is served again — both scopes and a reload share it; «Read again» asks for a fresh one. */
const KEEP_MS = 10 * 60_000;
/** Launches read at once: a public node answers a burst with 429. */
const LAUNCH_CONCURRENCY = 3;
/** The most launches one read reaches; the rest are named unread. */
const MAX_LAUNCHES = 60;
/** The most transactions read of one wallet's history for its claims and fees; beyond, the figure is a floor. Each is read once a process. */
const MAX_WALLET_TRANSACTIONS = 600;
/* Two at a time: Solana's public node answers a burst of getTransaction with 429 (measured on the stand 19.10). */
const TX_CONCURRENCY = 2;
/** Loops stop starting new reads this long before the read's deadline, so they answer what they reached. */
const LOOP_MARGIN_MS = 4_000;

type RawInputs = Omit<FinanceInputs, "scope" | "now" | "readAt">;

/* One read shared by both scopes and every request for a while (`./finance-read.ts`). */
const KEEPER = createReadKeeper<RawInputs>({ read: (deadline) => readInputs(deadline), keepMs: KEEP_MS, budgetMs: READ_BUDGET_MS, graceMs: 30_000 });

/**
 * The panel for one scope, and the read still running behind it, which the route keeps alive after its answer
 * (`after()`): a read older than `KEEP_MS` is answered at once with its own moment (`readAt`) while a new one runs;
 * «Read again» (`fresh`) waits for a new read.
 */
export async function readFinanceModel(scope: FinanceScope, options: Readonly<{ fresh?: boolean; now?: () => Date }> = {}): Promise<Readonly<{ model: FinanceModel; running: Promise<unknown> | null }>> {
  const now = options.now ?? (() => new Date());
  const { answer, running } = KEEPER.get(options.fresh ?? false);
  const read = await answer;
  return { model: projectFinance({ ...read.value, scope, now: now().toISOString(), readAt: new Date(read.at).toISOString() }), running };
}

/* ------------------------------------------------------------------ helpers */

function within<T>(promise: Promise<T>, deadline: number): Promise<T | null> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.resolve(null);
  return Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), left))]);
}

/**
 * Run `run` over `items`, `limit` at a time, starting none after `deadline` — what time does not reach is left, and the
 * answer says so (false), so a partial read stays a floor rather than becoming no read at all.
 */
async function poolUntil<T>(items: readonly T[], limit: number, deadline: number, run: (item: T) => Promise<void>): Promise<boolean> {
  let next = 0;
  let whole = true;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        if (Date.now() > deadline) {
          whole = false;
          return;
        }
        const index = next++;
        await run(items[index]!);
      }
    }),
  );
  return whole && next >= items.length;
}

async function pool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]!);
      }
    }),
  );
  return results;
}

/* A finalized transaction never changes: read once a process, and asked once while it is being read. Bounded, oldest out first. */
const TRANSACTIONS = new Map<string, RawTransaction>();
const IN_FLIGHT = new Map<string, Promise<RawTransaction | null>>();
/* Above what one read touches (≈ 600 a wallet at most, four wallets), so a later read is warm. */
const TRANSACTIONS_KEPT = 4_000;

/**
 * A finalized transaction, asked of each node in turn: one that refuses (429) or does not keep it that far gives way to
 * the next. Null only when every node answered and none had it; thrown when none answered.
 */
function transaction(reader: Reader, signature: string): Promise<RawTransaction | null> {
  const kept = TRANSACTIONS.get(signature);
  if (kept) return Promise.resolve(kept);
  const flying = IN_FLIGHT.get(signature);
  if (flying) return flying;
  const read = (async () => {
    let tx: RawTransaction | null = null;
    let answered = false;
    for (const rpc of reader.transactions) {
      /* Past the read's moment no further node is asked: what was gathered is answered. */
      if (Date.now() > reader.until) break;
      try {
        tx = (await rpc("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 1 }])) as RawTransaction | null;
        answered = true;
        if (tx) break;
      } catch {
        /* the next node */
      }
    }
    if (!answered) throw new Error("No node gave the transaction.");
    if (tx) {
      if (TRANSACTIONS.size >= TRANSACTIONS_KEPT) TRANSACTIONS.delete(TRANSACTIONS.keys().next().value!);
      TRANSACTIONS.set(signature, tx);
    }
    return tx;
  })().finally(() => IN_FLIGHT.delete(signature));
  IN_FLIGHT.set(signature, read);
  return read;
}

type History = Readonly<{ rows: readonly Readonly<{ signature: string; failed: boolean }>[]; complete: boolean }>;

/**
 * A wallet's finalized signatures, newest first — failed ones too, marked: they claimed nothing but paid their fee —, at
 * most `MAX_WALLET_TRANSACTIONS` and none past `deadline`; complete when the list reached its start.
 */
async function history(rpc: JsonRpc, address: string, deadline: number): Promise<History> {
  const rows: Array<{ signature: string; failed: boolean }> = [];
  let before: string | undefined;
  while (rows.length < MAX_WALLET_TRANSACTIONS) {
    if (Date.now() > deadline) return { rows, complete: false };
    const page = (await rpc("getSignaturesForAddress", [address, { limit: 200, commitment: "finalized", ...(before ? { before } : {}) }])) as Array<{ signature: string; err: unknown }> | null;
    if (!Array.isArray(page)) throw new Error("No signature list.");
    for (const row of page) rows.push({ signature: row.signature, failed: row.err !== null && row.err !== undefined });
    if (page.length < 200) return { rows, complete: true };
    before = page.at(-1)!.signature;
  }
  return { rows, complete: false };
}

/** One read's context: its node, the moment its loops stop starting work, and each wallet's history read once for every use. */
type Reader = Readonly<{ rpc: JsonRpc; transactions: readonly JsonRpc[]; until: number; histories: Map<string, Promise<History>> }>;

function historyOf(reader: Reader, address: string): Promise<History> {
  const known = reader.histories.get(address) ?? history(reader.rpc, address, reader.until);
  reader.histories.set(address, known);
  return known;
}

const keyOf = (entry: string | Readonly<{ pubkey: string }>) => (typeof entry === "string" ? entry : entry.pubkey);

/* ------------------------------------------------------------------ the reads */

async function readInputs(deadline: number): Promise<RawInputs> {
  const deps = launchMarketDeps();
  const store = getGuardRuntime().store;
  const network = deps?.network ?? null;
  const rpc = network ? jsonRpc(launchHistoryEndpoint(network), { attempts: 2, timeoutMs: 10_000 }) : null;
  /* Loops stop starting work a few seconds before the deadline, so what they reached is answered as a floor. */
  const reader: Reader | null =
    rpc && network
      ? {
          rpc,
          /* Transactions from every node Launch knows, the one that keeps older ones first. */
          transactions: [...new Set([launchArchiveEndpoint(network), ...resolveEndpoints(network.cluster).map((endpoint) => endpoint.url), launchHistoryEndpoint(network)])].map((url) => jsonRpc(url, { attempts: 3, timeoutMs: 8_000 })),
          until: deadline - LOOP_MARGIN_MS,
          histories: new Map(),
        }
      : null;

  const [operationsRead, own, rewards] = await Promise.all([
    within(readOperations(), deadline),
    network ? within(ryntraOwnWallets(network, store), deadline) : Promise.resolve(null),
    within(readRewardEntries(store), deadline),
  ]);
  const internalWallets = own?.wallets ?? new Set<string>();
  /* Payouts are mainnet transactions: on another network they are not read at all, rather than read as missing. */
  const mainnet = network?.cluster === "mainnet";

  const [launchRead, payouts, costs, prices, assistant, credits, success] = await Promise.all([
    deps && network && reader ? readLaunches(deps, network, reader, store, internalWallets, operationsRead?.records ?? [], deadline) : Promise.resolve(null),
    rewards && reader && mainnet ? readPayouts(reader, rewards.entries, deadline) : Promise.resolve(null),
    network && reader ? readCosts(network, reader, store, deadline) : Promise.resolve(null),
    within(readPrices(operationsRead?.chain?.balances ?? []), deadline),
    within(readAssistantCalls(store), deadline),
    within(readCreditPayments(store), deadline),
    network ? within(readSuccess(network, store, internalWallets, deadline - LOOP_MARGIN_MS), deadline) : Promise.resolve(null),
  ]);

  return {
    launches: launchRead?.launches ?? null,
    launchesUnread: launchRead?.unread ?? 0,
    operations: operationsRead?.operations ?? null,
    terminalChain: operationsRead?.chain ?? null,
    rewards: rewards ? ({ entries: rewards.entries, payouts, unparsed: rewards.unparsed, unparsedHint: rewards.unparsedHint } satisfies FinanceRewards) : null,
    costs,
    prices: prices ?? { [USDC_MINT]: 1 },
    internalWallets,
    internalComplete: own?.complete ?? false,
    manualCosts: MANUAL_COSTS,
    credits,
    modelSpend: assistant?.spend ?? null,
    success: success ? { ...success, assistant: assistant?.calls ?? null } : null,
  };
}

/* ---- MET-1: the assistant, its credits, and the success metrics' records ---- */

type AssistantRead = Readonly<{ calls: NonNullable<SuccessInputs["assistant"]>; spend: Readonly<{ micros: string; unpriced: number }> }>;

/** Every call of the assistant by its receipt: who asked, when, how it ended, how long it took, what the model's price made it cost. */
async function readAssistantCalls(store: GuardStore): Promise<AssistantRead> {
  const receipts = store.versioned<GuardVersionedRecord>("agentReceipts");
  const rows = [...(await receipts.valuesWithPrefix("solana:mainnet:")), ...(await receipts.valuesWithPrefix("guest:")), ...(await receipts.valuesWithPrefix("system:"))];
  let micros = 0n;
  let unpriced = 0;
  const calls: { owner: string; at: string; outcome: string; latencyMs: number | null }[] = [];
  for (const row of rows) {
    const parsed = AgentReceiptSchema.safeParse(row);
    if (!parsed.success) {
      unpriced += 1;
      continue;
    }
    const receipt = parsed.data;
    const cost = "costMicroUsd" in receipt ? receipt.costMicroUsd : null;
    /* A call that spent no token (a refusal, a timeout) is free, not unpriced. */
    if (cost === null || cost === undefined) {
      if (receipt.tokens.total > 0) unpriced += 1;
    } else micros += BigInt(cost);
    const latency = "latencyMs" in receipt && typeof receipt.latencyMs === "number" ? receipt.latencyMs : null;
    calls.push({ owner: receipt.owner, at: receipt.at, outcome: receipt.outcome, latencyMs: latency });
  }
  return { calls, spend: { micros: micros.toString(), unpriced } };
}

/** The USDC payments the assistant's credit orders counted — each a transaction the payment read found on chain. */
async function readCreditPayments(store: GuardStore): Promise<NonNullable<FinanceInputs["credits"]>> {
  const rows = (await store.versioned<GuardVersionedRecord>(CREDITS_COLLECTION).valuesWithPrefix("order:")) as readonly unknown[];
  const payments: { signature: string; wallet: string; payer: string | null; amountRaw: string }[] = [];
  for (const row of rows) {
    const order = row as { schema?: unknown; wallet?: unknown; payments?: unknown };
    if (order?.schema !== "ryntra.assistant-credit-order" || typeof order.wallet !== "string" || !Array.isArray(order.payments)) continue;
    for (const payment of order.payments as { signature?: unknown; amountRaw?: unknown; payer?: unknown }[]) {
      if (typeof payment?.signature === "string" && typeof payment.amountRaw === "string" && /^[0-9]+$/.test(payment.amountRaw))
        payments.push({ signature: payment.signature, wallet: order.wallet, payer: typeof payment.payer === "string" ? payment.payer : null, amountRaw: payment.amountRaw });
    }
  }
  return payments;
}

/** Support threads marked security, as many as the admin's list gives (200); null when the list was not read. */
async function readSecurityThreads(): Promise<SuccessInputs["security"]> {
  const rows = await listFeedback(200);
  if (!rows) return null;
  const security = rows.filter((row) => row.priority === "SECURITY");
  return { total: security.length, open: security.filter((row) => row.status !== "CLOSED").length, complete: rows.length < 200 };
}

/** Each launch's executor receipts, flight log and state; Autoinvest's rules; the holder-fee collector's claims; support's security threads. */
async function readSuccess(network: LaunchNetwork, store: GuardStore, own: ReadonlySet<string>, until: number): Promise<Omit<SuccessInputs, "assistant">> {
  const cluster = network.cluster;
  const [records, markets, rules, claims, security] = await Promise.all([
    store
      .collection<LaunchRecord>("launches")
      .valuesWithPrefix(`solana:${cluster}:`)
      .then((rows) => rows.filter((row) => row.state === "LAUNCHED" && row.cluster === cluster))
      .catch(() => null),
    readExecutorMarkets(store, cluster).catch(() => null),
    listAllRuleRecords(store).catch(() => null),
    store
      .collection<{ cluster: string; owner: string; state: string; at: string | null }>("launchHolderClaims")
      .valuesWithPrefix(`${cluster}:`)
      .then((rows) => rows.filter((row) => row.cluster === cluster))
      .catch(() => null),
    readSecurityThreads().catch(() => null),
  ]);
  const launches: SuccessLaunch[] | null = records
    ? await pool(records, LAUNCH_CONCURRENCY, async (record) => ({
        token: record.token,
        creator: record.creator,
        launchedAt: record.launchedAt,
        own: own.has(record.creator),
        /* Past the read's moment a launch's records are left unread — the metrics then floors —, never the whole read lost. */
        receipts: Date.now() > until ? null : await autopilotReceipts(store, cluster, record.token)
          .then((rows) => rows.map((receipt) => ({ kind: receipt.kind, actor: receipt.actor, at: receipt.at, signature: receipt.signature })))
          .catch(() => null),
        marks: Date.now() > until ? null : await journalMarks(store, cluster, record.token)
          .then((rows) => rows.map((mark) => ({ kind: mark.kind, at: mark.at })))
          .catch(() => null),
        executorState: markets?.get(record.token)?.state ?? null,
      }))
    : null;
  return {
    launches,
    autoinvest: rules ? rules.map((rule) => ({ owner: rule.owner, status: rule.status })) : null,
    holderClaims: claims ? claims.map((claim) => ({ owner: claim.owner, state: claim.state, at: claim.at })) : null,
    security,
  };
}

/* ---- the terminal ---- */

function financeOperation(record: OperationRecord): FinanceOperation {
  return {
    id: record.id,
    signature: record.signature,
    product: record.product,
    status: record.status,
    internal: record.internal,
    at: record.confirmedAt ?? record.startedAt,
    feeCollected: record.fee?.collected ?? false,
    ryntraUsd: record.fee?.ryntraUsd ?? null,
    feeAsset: record.fee?.asset ?? null,
    feeGrossRaw: record.fee?.grossRaw ?? null,
    verification: record.verification,
    grossUsd: record.fee?.valueUsd ?? null,
    wallet: record.wallet,
    startedAt: record.startedAt,
    confirmedAt: record.confirmedAt,
  };
}

type OperationsRead = Readonly<{ operations: readonly FinanceOperation[]; records: readonly OperationRecord[]; chain: FinanceTerminalChain | null }>;

async function readOperations(): Promise<OperationsRead | null> {
  const read = await readOperationSource();
  if (!read.source) return null;
  const records = projectOperations(read.source);
  let chain: FinanceTerminalChain | null = null;
  if (read.chain.ok) {
    const credits = new Map<string, readonly Readonly<{ mint: string; amountRaw: string }>[]>();
    for (const row of read.chain.operations) credits.set(row.signature, row.feeCredits.map((credit) => ({ mint: credit.mint, amountRaw: credit.amountRaw })));
    /* What the referral accounts hold is claimable from the referral program; the program keeps its share at the claim. */
    const share = BigInt(read.chain.ryntraShareBps ?? 10_000);
    const chainRead = read.chain;
    const balances = chainRead.accounts
      .filter((account) => account.owner === chainRead.referralAccount)
      .map((account) => ({ mint: account.mint, decimals: account.decimals, amountRaw: ((BigInt(account.amountRaw) * share) / 10_000n).toString() }));
    chain = { complete: read.chain.coverage.complete && !read.chain.coverage.truncated, readAt: read.chain.readAt, credits, balances };
  }
  return { operations: records.map(financeOperation), records, chain };
}

/* ---- launches ---- */

type Deps = NonNullable<ReturnType<typeof launchMarketDeps>>;

async function readLaunches(
  deps: Deps,
  network: LaunchNetwork,
  reader: Reader,
  store: GuardStore,
  own: ReadonlySet<string>,
  operations: readonly OperationRecord[],
  deadline: number,
): Promise<Readonly<{ launches: readonly FinanceLaunch[]; unread: number }> | null> {
  const records = await within(
    store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${network.cluster}:`).then((rows) => rows.filter((row) => row.state === "LAUNCHED" && row.cluster === network.cluster)),
    deadline,
  );
  if (!records) return null;
  const sorted = [...records].sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt));
  const reached = sorted.slice(0, MAX_LAUNCHES);

  /* The vault's revenue journal (SOL-L1d): the claims proposed and run through Ryntra; not read — no record to hold. */
  const journal = await within(readPartnerJournal(store, network.cluster), deadline);

  /* Each fee claimer's claims, once for every launch. */
  const claimers = new Map<string, Promise<ClaimerRead>>();
  const claimsOf = (claimer: string) => {
    const known = claimers.get(claimer) ?? readClaimer(reader, claimer, deadline);
    claimers.set(claimer, known);
    return known;
  };

  /* The trades sent through Ryntra, from the operations ledger: Ryntra's part as recorded, and the token traded. */
  const launchOps = operations
    .filter((op) => op.product === "LAUNCH" && op.status === "CONFIRMED" && op.signature)
    .map((op) => ({ signature: op.signature!, ryntraRaw: op.fee?.ryntraRaw ?? null, token: [op.out?.mint, op.in?.mint].find((mint) => mint && mint !== USDC_MINT && mint !== SOL_MINT) ?? null }));

  let unread = sorted.length - reached.length;
  const launches: FinanceLaunch[] = [];
  const results = await pool(reached, LAUNCH_CONCURRENCY, (record) => within(readLaunch(deps, network, record, own, claimsOf, journal), deadline));
  results.forEach((launch, index) => {
    if (!launch) {
      unread += 1;
      return;
    }
    const tokenSignatures = new Set((launch.trades ?? []).map((trade) => trade.signature));
    const ledgerTrades = launchOps
      .filter((op) => tokenSignatures.has(op.signature) || op.token === reached[index]!.token)
      .map((op) => ({ signature: op.signature, ryntraRaw: op.ryntraRaw }));
    launches.push({ ...launch, ledgerTrades });
  });
  return { launches, unread };
}

type ClaimerRead = Readonly<{ claims: readonly ReturnType<typeof extractSolanaClaims>[number][]; complete: boolean }>;

/** One claimer's claims; at the deadline, those read so far — a floor, marked incomplete. */
function readClaimer(reader: Reader, claimer: string, deadline: number): Promise<ClaimerRead> {
  const claims: ReturnType<typeof extractSolanaClaims>[number][] = [];
  const work = (async (): Promise<ClaimerRead> => {
    const list = await historyOf(reader, claimer);
    let complete = list.complete;
    const claimerSet = new Set([claimer]);
    const signatures = list.rows.filter((row) => !row.failed).map((row) => row.signature);
    const whole = await poolUntil(signatures, TX_CONCURRENCY, reader.until, async (signature) => {
      const tx = await transaction(reader, signature).catch(() => null);
      if (!tx) {
        complete = false;
        return;
      }
      claims.push(...extractSolanaClaims(tx, claimerSet));
    });
    return { claims: [...claims], complete: complete && whole };
  })();
  return settleBy(work, deadline, () => ({ claims: [...claims], complete: false }));
}

async function readLaunch(
  deps: Deps,
  network: LaunchNetwork,
  record: LaunchRecord,
  own: ReadonlySet<string>,
  claimsOf: (claimer: string) => Promise<ClaimerRead>,
  journal: readonly PartnerJournalEntry[] | null,
): Promise<Omit<FinanceLaunch, "ledgerTrades">> {
  const pair = launchPair(network, record.preset, record.pairMint);
  const [facts, fees, partner, budget, receipts] = await Promise.all([
    readLaunchMarketFacts(deps, record.token).catch(() => null),
    creatorFeesOf(deps, record).catch(() => null),
    readPartnerFees(deps.connection, { token: record.token, pool: record.pool }, { indexed: deps.second ?? null })
      .then((read) => (read.lpUnread ? partnerLpFromExit(deps, record, read) : read))
      .catch(() => null),
    budgetPreset(record.preset) ? readBudgetRecord(deps.store, network.cluster, record.token).catch(() => null) : Promise.resolve(undefined),
    listClaimReceipts(deps.store, network.cluster, record.creator).catch(() => []),
  ]);

  const makers = new Set<string>([record.creator, ...own]);
  if (facts) for (const [wallet, labels] of facts.labels) if (labels.includes("creator") || labels.includes("bundle")) makers.add(wallet);

  /* The partner's claims on this curve and on the pool it moved into, by the config's own claimer. */
  let claims: FinanceClaim[] | null = null;
  let claimsComplete = false;
  if (partner) {
    const read = await claimsOf(partner.feeClaimer);
    if (read) {
      claimsComplete = read.complete;
      claims = read.claims
        .filter((claim) => claim.claimer === partner.feeClaimer)
        .filter((claim) => (claim.source === "lp" ? partner.dammPool !== null && claim.pool === partner.dammPool && claim.owner === partner.feeClaimer : claim.pool === record.pool))
        /* The partner's own migration fee: flag 0; the creator's is theirs. */
        .filter((claim) => claim.source !== "migration" || claim.flag === 0)
        .map((claim) => ({ signature: claim.signature, at: claim.at, source: claim.source, pairRaw: claim.pairRaw === null ? null : claim.pairRaw.toString(), tokenRaw: claim.tokenRaw === null ? null : claim.tokenRaw.toString() }));
    }
  }

  return {
    token: record.token,
    symbol: record.symbol,
    preset: record.preset,
    creator: record.creator,
    own: own.has(record.creator),
    launchedAt: record.launchedAt,
    pair: { decimals: pair.decimals, dollar: pair.dollar },
    trades: facts
      ? facts.historyTrades.map((trade) => ({
          signature: trade.signature,
          at: trade.at,
          trader: trade.trader,
          venue: trade.venue,
          ...(trade.ryntraRaw === undefined ? {} : { ryntraRaw: trade.ryntraRaw }),
          ...(trade.creatorRaw === undefined ? {} : { creatorRaw: trade.creatorRaw }),
          ...(trade.ownRaw === undefined ? {} : { ownRaw: trade.ownRaw }),
          maker: makers.has(trade.trader),
        }))
      : null,
    tradesComplete: facts?.historyComplete ?? false,
    counters: fees?.read ?? null,
    partner: partner
      ? {
          curveUnclaimedRaw: partner.curveRaw.toString(),
          migrated: partner.migrated,
          migration: { raw: partner.migration.raw.toString(), withdrawn: partner.migration.withdrawn },
          surplus: { raw: partner.surplus.raw.toString(), withdrawn: partner.surplus.withdrawn },
          lp: partner.lp ? { pairRaw: partner.lp.pairRaw.toString(), tokenRaw: partner.lp.tokenRaw.toString() } : null,
          lpUnread: partner.lpUnread,
          feeClaimer: partner.feeClaimer,
        }
      : null,
    claims,
    claimsComplete,
    ledgerClaims:
      budget !== undefined
        ? (budget?.claims ?? []).map((claim) => ({ signature: claim.signature, source: claim.source, pairRaw: claim.pairRaw }))
        : /* The vault's claims: the journal of its proposals made and run through Ryntra (SOL-L1d). */
          partner && journal
          ? [...partnerLedgerOf(journal, record.token, partner.feeClaimer)]
          : null,
    creatorReceipts: receipts.filter((receipt) => receipt.token === record.token).map((receipt) => ({ signature: receipt.signature, receivedRaw: receipt.receivedRaw })),
  };
}

/* ---- rewards ---- */

/** The reward ledger's rows by its own schema and its own rule for a later valuation; the rows its schema does not read, counted. */
async function readRewardEntries(store: GuardStore): Promise<Readonly<{ entries: readonly RewardEntry[]; unparsed: number; unparsedHint: string | null }>> {
  const rows = await store.collection<unknown>("rewardEntries").valuesWithPrefix("");
  const entries: RewardEntry[] = [];
  let unparsed = 0;
  let unparsedHint: string | null = null;
  for (const row of rows) {
    const parsed = RewardEntrySchema.safeParse(row);
    if (parsed.success) entries.push(parsed.data);
    else {
      unparsed += 1;
      /* The first refused row: its recipient and the field the schema refused, so the operator can find it. */
      if (unparsedHint === null) {
        const issue = parsed.error.issues[0];
        const recipient = typeof (row as { recipient?: unknown })?.recipient === "string" ? (row as { recipient: string }).recipient.slice(0, 8) : "?";
        unparsedHint = `${recipient}… ${issue ? `${issue.path.join(".") || "(row)"}: ${issue.code}` : ""}`.trim();
      }
    }
  }
  /* Conflicting valuations make the ledger's own rule refuse: then the rewards are unread, not a failed panel. */
  return { entries: effectiveRewardEntries(entries), unparsed, unparsedHint };
}

/** Each payout against its transaction; at the deadline, those checked so far — the rest stay unread. */
function readPayouts(reader: Reader, entries: readonly RewardEntry[], deadline: number): Promise<ReadonlyMap<string, Readonly<{ landed: boolean | null; receivedRaw: string | null }>>> {
  const claims = entries.filter((entry) => entry.type === "CLAIM" && entry.signature);
  const result = new Map<string, Readonly<{ landed: boolean | null; receivedRaw: string | null }>>();
  const work = poolUntil(claims, TX_CONCURRENCY, reader.until, async (entry) => {
    const signature = entry.signature!;
    let tx: RawTransaction | null;
    try {
      tx = await transaction(reader, signature);
    } catch {
      /* The node did not answer: unread. */
      return;
    }
    if (!tx) {
      /* No transaction from this node: the cluster's own status, searched through its whole history, says whether it ever landed. */
      const status = await reader.rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]).catch(() => undefined);
      const value = (status as { value?: readonly unknown[] } | undefined)?.value;
      if (!value) return;
      result.set(signature, { landed: value[0] === null || value[0] === undefined ? false : null, receivedRaw: null });
      return;
    }
    if (tx.meta?.err !== null && tx.meta?.err !== undefined) {
      result.set(signature, { landed: false, receivedRaw: null });
      return;
    }
    type Balance = Readonly<{ mint: string; owner?: string; uiTokenAmount?: Readonly<{ amount: string }> }>;
    const meta = tx.meta as Readonly<{ preTokenBalances?: readonly Balance[] | null; postTokenBalances?: readonly Balance[] | null }> | null;
    /* What the recipient holds of the payout's dollar stablecoins: the payout is what that grew by. */
    const held = (rows: readonly Balance[] | null | undefined) =>
      (rows ?? []).filter((row) => row.owner === entry.recipient && REWARD_PAR_MINTS[row.mint] !== undefined).reduce((total, row) => total + BigInt(row.uiTokenAmount?.amount ?? "0"), 0n);
    const received = held(meta?.postTokenBalances) - held(meta?.preTokenBalances);
    result.set(signature, { landed: true, receivedRaw: received.toString() });
  });
  return settleBy(work.then(() => new Map(result)), deadline, () => new Map(result));
}

/* ---- costs ---- */

/** Each wallet, the receipts and the growth journal on their own deadline: one that runs out leaves the others read. */
async function readCosts(network: LaunchNetwork, reader: Reader, store: GuardStore, deadline: number): Promise<FinanceCosts> {
  const rewardsTreasury = ATTRIBUTION_REGISTRY.find((row) => row.id === "solana-payout-rewards")?.address ?? null;
  const wallets: Array<{ role: FinanceWalletCost["role"]; address: string }> = [];
  const executor = launchExecutorAddress(network);
  const payer = launchPoolPayerAddress(network);
  if (executor) wallets.push({ role: "executor", address: executor });
  if (payer) wallets.push({ role: "payer", address: payer });
  if (rewardsTreasury && network.cluster === "mainnet") wallets.push({ role: "rewards", address: rewardsTreasury });

  const costs = await Promise.all(
    wallets.map(async (wallet): Promise<FinanceWalletCost> => {
      return walletCost(wallet);
    }),
  );
  const [executorLedgerLamports, growthSpentMicros] = await Promise.all([within(executorReceipts(network, store), deadline), within(growthSpent(store), deadline)]);
  return { wallets: costs, executorLedgerLamports, growthSpentMicros };

  /** One wallet's network fees; at the deadline, those read so far — a floor, marked incomplete; nothing listed — unread. */
  function walletCost(wallet: Readonly<{ role: FinanceWalletCost["role"]; address: string }>): Promise<FinanceWalletCost> {
    const sum = { listed: false, lamports: 0n, transactions: 0 };
    const partial = (): FinanceWalletCost => ({ role: wallet.role, address: wallet.address, lamports: sum.listed ? sum.lamports.toString() : null, transactions: sum.transactions, complete: false });
    const work = (async (): Promise<FinanceWalletCost> => {
      const list = await historyOf(reader, wallet.address);
      sum.listed = true;
      let complete = list.complete;
      const whole = await poolUntil(list.rows, TX_CONCURRENCY, reader.until, async (row) => {
        const tx = await transaction(reader, row.signature).catch(() => null);
        if (!tx) {
          complete = false;
          return;
        }
        const payerKey = tx.transaction.message.accountKeys?.[0];
        if (!payerKey || keyOf(payerKey) !== wallet.address) return;
        const fee = (tx.meta as { fee?: number } | null)?.fee;
        if (typeof fee !== "number") return;
        sum.lamports += BigInt(fee);
        sum.transactions += 1;
      });
      return { ...partial(), complete: complete && whole };
    })();
    return settleBy(work, deadline, partial);
  }
}

/** The executor's receipts, every market's: what it said it spent. */
async function executorReceipts(network: LaunchNetwork, store: GuardStore): Promise<string> {
  const launches = await store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${network.cluster}:`);
  let total = 0n;
  for (const record of launches) {
    for (const receipt of await autopilotReceipts(store, network.cluster, record.token)) if (receipt.lamports) total += BigInt(receipt.lamports);
  }
  return total.toString();
}

/** The growth budget's journal, month by month since Launch opened. */
async function growthSpent(store: GuardStore): Promise<string> {
  let total = 0n;
  for (const month of monthsSince("2026-09", budgetMonthOf(new Date().toISOString()))) total += (await readGrowthBudget(store, month)).spentUsdMicros;
  return total.toString();
}

export function monthsSince(first: string, last: string): readonly string[] {
  const months: string[] = [];
  let [year, month] = first.split("-").map(Number) as [number, number];
  const [endYear, endMonth] = last.split("-").map(Number) as [number, number];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/* ---- prices ---- */

async function readPrices(balances: readonly Readonly<{ mint: string }>[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = { [USDC_MINT]: 1 };
  for (const [mint] of Object.entries(REWARD_PAR_MINTS)) prices[mint] = 1;
  const wanted = [SOL_MINT, ...balances.map((balance) => balance.mint)].filter((mint) => prices[mint] === undefined);
  const catalog = await fetchTokenCatalog(wanted, 5_000);
  if (catalog.ok) {
    for (const [mint, entry] of Object.entries(catalog.byMint)) {
      const price = entry.usdPrice === null ? NaN : Number(entry.usdPrice);
      if (Number.isFinite(price) && price > 0) prices[mint] = price;
    }
  }
  return prices;
}
