/**
 * CITY-128 — the weekly statements, kept and moved: prepared once a week has closed, bound to the Squads proposal that
 * pays them, settled against what the chain shows. Server-only; the counting is `week.ts`.
 *
 * - **Prepared once.** A week's statement is created by compare-and-set on its key (`<cluster>:<week>`): a second run,
 *   a second instance, a retried cron finds it written and adds nothing. Weeks are prepared oldest first, each on the
 *   one before, so what is carried is always the last word of the week before.
 * - **One proposal.** The statement records the proposal number its build was given; a new build is refused once the
 *   chain shows a proposal at that number carrying exactly the statement's payouts — the week has its proposal, and
 *   nothing pays it twice. A build the operator never signed leaves no proposal on chain, and the week may be built again.
 * - **Settled by the chain.** Its proposal executed: PAID. Rejected or cancelled: VOID — and what it would have paid is
 *   owed again, rolled into the next statement prepared, in the same atomic write that marks it rolled.
 *
 * Nothing here signs, sends or holds a key: the proposal's bytes are the treasury's (`lib/solana/treasury`, SOL-4) and
 * the operator's wallet signs them.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { TreasuryProposal } from "../solana/treasury/contract.ts";
import { closedWeeks, feeEventsOf, openWeek, pairsOf, payoutsOf, prepareStatement, tradedBy, weekOf, type Account, type FeeEvent, type OperationIn, type PairEffect, type PayoutGuard, type Statement } from "./week.ts";

export const WEEKS = "partnerPayoutWeeks" as const;

export type PayoutCluster = "mainnet" | "devnet";

export const statementKey = (cluster: PayoutCluster, week: string) => `${cluster}:${week}`;

export async function listStatements(store: GuardStore, cluster: PayoutCluster): Promise<Statement[]> {
  const rows = await store.versioned<Statement>(WEEKS).valuesWithPrefix(`${cluster}:`);
  return [...rows].sort((a, b) => a.week.localeCompare(b.week));
}

export async function readStatement(store: GuardStore, cluster: PayoutCluster, week: string): Promise<Statement | null> {
  return (await store.versioned<Statement>(WEEKS).get(statementKey(cluster, week))) ?? null;
}

/** Every operation the statements credited. */
export function creditedOf(statements: readonly Statement[]): Set<string> {
  return new Set(statements.flatMap((statement) => statement.lines.flatMap((line) => line.refs)));
}

/* ------------------------------------------------------------------ prepare */

export type PrepareDeps = Readonly<{
  store: GuardStore;
  cluster: PayoutCluster;
  now: () => Date;
  /** The operations ledger's projection (`readAllOperations`). */
  readOperations: () => Promise<readonly OperationIn[]>;
  /** The Rewards record of a wallet: who brought it, since when. */
  readAccount: (wallet: string) => Promise<Account | null>;
  /** The sanctions source's word for a wallet; anything but `sanctioned` pays (a source that did not answer is not a listing). */
  screen: (wallet: string) => Promise<string>;
  /**
   * The referral guard's word on each pair a pass would count (CITY-125), checking first the pairs that need it; a pair
   * it does not name waits. A guard that does not answer pays nobody this pass: every share waits for the next.
   */
  pairs: (pairs: readonly Readonly<{ partner: string; person: string }>[], now: string) => Promise<ReadonlyMap<string, PairEffect>>;
}>;

export type PrepareResult = Readonly<{ prepared: readonly string[]; existing: readonly string[]; events: number; open: OpenWeek }>;

/**
 * The week still running, counted so far for each partner — what «Мій район» adds to the closed weeks so a partner
 * sees today's share before Monday. A snapshot each pass rewrites; nothing is paid from it.
 */
export type OpenWeek = Readonly<{ version: number; cluster: string; week: string; at: string; partners: Readonly<Record<string, string>>; launch: Readonly<Record<string, string>> }>;

export const openWeekKey = (cluster: PayoutCluster) => `open:${cluster}`;

export async function readOpenWeek(store: GuardStore, cluster: PayoutCluster): Promise<OpenWeek | null> {
  return (await store.versioned<OpenWeek>(WEEKS).get(openWeekKey(cluster))) ?? null;
}

async function writeOpenWeek(store: GuardStore, open: Omit<OpenWeek, "version">): Promise<OpenWeek> {
  return withBoundedCasRetry(async () => {
    const found = await readOpenWeek(store, open.cluster as PayoutCluster);
    const next: OpenWeek = { ...open, version: (found?.version ?? 0) + 1 };
    return (await store.versioned<OpenWeek>(WEEKS).compareAndSet(openWeekKey(open.cluster as PayoutCluster), found?.version ?? null, next)) ? next : false;
  });
}

/** The Rewards records of every wallet the events name, each read once; an unreadable record is nobody's. */
export async function accountsOf(events: readonly FeeEvent[], read: PrepareDeps["readAccount"]): Promise<Map<string, Account | null>> {
  const wallets = [...new Set(events.map((event) => event.wallet))];
  const accounts = new Map<string, Account | null>();
  await Promise.all(wallets.map(async (wallet) => accounts.set(wallet, await read(wallet).catch(() => null))));
  return accounts;
}

/** Prepare every closed week that has no statement yet, oldest first. Safe to run as often as anyone likes. */
export async function prepareWeeks(deps: PrepareDeps): Promise<PrepareResult> {
  const now = deps.now();
  const weeks = closedWeeks(now.getTime());
  const events = feeEventsOf(await deps.readOperations());
  const accounts = await accountsOf(events, deps.readAccount);
  /* The guard, read once for the pass: every pair an uncredited operation names, and the partners who have traded. */
  const pending = pairsOf(events, accounts, creditedOf(await listStatements(deps.store, deps.cluster)), now.getTime());
  const guard: PayoutGuard = {
    pairs: await deps.pairs(pending, now.toISOString()).catch(() => new Map<string, PairEffect>()),
    traded: tradedBy(events, now.getTime()),
  };
  const prepared: string[] = [];
  const existing: string[] = [];
  const screened = new Map<string, boolean>();
  const sanctionedAmong = async (partners: readonly string[]) => {
    for (const partner of partners) {
      if (!screened.has(partner)) screened.set(partner, (await deps.screen(partner).catch(() => "unavailable")) === "sanctioned");
    }
    return new Set(partners.filter((partner) => screened.get(partner)));
  };

  for (const week of weeks) {
    const written = await withBoundedCasRetry(async () => {
      const statements = await listStatements(deps.store, deps.cluster);
      const found = statements.find((statement) => statement.week === week);
      if (found) return "existing" as const;
      const before = statements.filter((statement) => statement.week < week);
      const previous = before.at(-1) ?? null;
      const voided = before.filter((statement) => statement.state === "VOID" && !statement.rolledInto);
      const base = { cluster: deps.cluster, week, events, accounts, credited: creditedOf(before), previous, voided, guard, now: now.toISOString() };
      /* Counted once to learn who would be paid, screened, then counted again with the screening's answer. */
      const draft = prepareStatement({ ...base, sanctioned: new Set() });
      const sanctioned = await sanctionedAmong(payoutsOf(draft).map((line) => line.to));
      const statement = prepareStatement({ ...base, sanctioned });
      const ok = await deps.store.compareAndSetMany([
        { collection: WEEKS, key: statementKey(deps.cluster, week), expectedVersion: null, next: statement },
        ...voided.map((row) => ({ collection: WEEKS, key: statementKey(deps.cluster, row.week), expectedVersion: row.version, next: { ...row, version: row.version + 1, rolledInto: week } })),
      ]);
      return ok ? "prepared" as const : false;
    });
    (written === "prepared" ? prepared : existing).push(week);
  }
  const credited = creditedOf(await listStatements(deps.store, deps.cluster));
  const partners: Record<string, string> = {};
  const launch: Record<string, string> = {};
  for (const [partner, row] of openWeek(events, accounts, credited, now.getTime(), guard)) {
    if (row.accrued <= 0n) continue;
    partners[partner] = row.accrued.toString();
    if (row.launch > 0n) launch[partner] = row.launch.toString();
  }
  const open = await writeOpenWeek(deps.store, { cluster: deps.cluster, week: weekOf(now.getTime()), at: now.toISOString(), partners, launch });
  return { prepared, existing, events: events.length, open };
}

/* ------------------------------------------------------------------ the proposal */

/** The proposal at a statement's number carries exactly its payouts: a batch of USDC lines, as many, summing to its pay. */
export function proposalMatches(statement: Statement, proposal: TreasuryProposal | null): boolean {
  if (!proposal || proposal.type !== "payouts" || !proposal.payouts || !proposal.readable) return false;
  const lines = payoutsOf(statement);
  const pay = lines.reduce((sum, line) => sum + line.amountRaw, 0n);
  const sums = proposal.payouts.sums;
  const usdc = sums.find((sum) => sum.asset === "USDC");
  return proposal.payouts.count === lines.length && sums.length === 1 && usdc !== undefined && BigInt(usdc.raw) === pay;
}

/** Record the number a build gave the week's proposal: refused once the week has a proposal on chain. */
export async function bindProposal(store: GuardStore, cluster: PayoutCluster, week: string, proposal: Readonly<{ multisig: string; index: string; buildId: string | null }>, now: Date): Promise<Statement> {
  return withBoundedCasRetry(async () => {
    const statement = await readStatement(store, cluster, week);
    if (!statement) throw new Error(`no statement for ${week}`);
    if (statement.state !== "PREPARED") throw new Error(`the week ${week} is ${statement.state}`);
    const next: Statement = { ...statement, version: statement.version + 1, proposal: { ...proposal, builtAt: now.toISOString(), seenAt: null, executedAt: null } };
    const ok = await store.versioned<Statement>(WEEKS).compareAndSet(statementKey(cluster, week), statement.version, next);
    return ok ? next : false;
  });
}

export type ProposalReader = (multisig: string, index: string) => Promise<TreasuryProposal | null>;

/**
 * What the chain says of a week's proposal, written on its statement:
 * - a proposal there carrying the week's payouts (checked while its lines are on chain), active or approved —
 *   PROPOSED; executed — PAID;
 * - rejected or cancelled — VOID, owed again on the next statement;
 * - nothing there, or a proposal that is not the week's (another took the number): the binding is dropped, the week
 *   stays PREPARED and may be built again.
 */
export async function settleWeek(store: GuardStore, cluster: PayoutCluster, week: string, read: ProposalReader, now: Date): Promise<Statement | null> {
  return withBoundedCasRetry(async () => {
    const statement = await readStatement(store, cluster, week);
    if (!statement?.proposal || statement.state === "PAID" || statement.state === "VOID") return statement;
    const proposal = await read(statement.proposal.multisig, statement.proposal.index);
    const at = now.toISOString();
    let next: Statement | null = null;
    if (!proposal) {
      /* A build signed a moment ago may not have landed: drop the binding only once it is long past its life. */
      const builtMs = Date.parse(statement.proposal.builtAt);
      if (statement.state === "PREPARED" && now.getTime() - builtMs > 10 * 60 * 1000) next = { ...statement, version: statement.version + 1, proposal: null };
    } else if (statement.state === "PREPARED" && !proposalMatches(statement, proposal)) {
      next = { ...statement, version: statement.version + 1, proposal: null };
    } else if (proposal.state === "executed") {
      next = { ...statement, version: statement.version + 1, state: "PAID", proposal: { ...statement.proposal, seenAt: statement.proposal.seenAt ?? at, executedAt: at } };
    } else if (proposal.state === "rejected" || proposal.state === "cancelled" || proposal.state === "stale") {
      next = { ...statement, version: statement.version + 1, state: "VOID", proposal: { ...statement.proposal, seenAt: statement.proposal.seenAt ?? at } };
    } else if (statement.state === "PREPARED") {
      next = { ...statement, version: statement.version + 1, state: "PROPOSED", proposal: { ...statement.proposal, seenAt: at } };
    }
    if (!next) return statement;
    const ok = await store.versioned<Statement>(WEEKS).compareAndSet(statementKey(cluster, week), statement.version, next);
    return ok ? next : false;
  });
}

/** Settle every week whose proposal is bound and not final. */
export async function settleWeeks(store: GuardStore, cluster: PayoutCluster, read: ProposalReader, now: Date): Promise<readonly Statement[]> {
  const open = (await listStatements(store, cluster)).filter((statement) => statement.proposal && (statement.state === "PREPARED" || statement.state === "PROPOSED"));
  const out: Statement[] = [];
  for (const statement of open) {
    const settled = await settleWeek(store, cluster, statement.week, read, now).catch(() => null);
    if (settled) out.push(settled);
  }
  return out;
}
