import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import {
  formatUsdMicros,
  rewardEntryKey,
  rewardEntryPrefix,
  RewardEntrySchema,
  type RewardEntry,
  type RewardType,
} from "./model.ts";
import {
  decideReferralBind,
  mintReferralCode,
  referralLevels,
  RewardAccountSchema,
  ReferralCodeRecordSchema,
  type ReferralBindDecision,
  type ReferralCodeRecord,
  type RewardAccount,
} from "./referral.ts";

/**
 * The durable half of Rewards: what is owed, to whom, and who invited them.
 *
 * ## Why an accrual is an insert and never an update
 *
 * `insertIfAbsent` is the only operation this module uses to create a reward,
 * and the key it inserts under carries the provider and the provider's own
 * operation reference. That is the entire duplicate defence, and it holds
 * against every way the same fee can be read twice: a browser reload, a status
 * poll, a webhook retry, two instances handling the same callback, or a person
 * opening their History a year later. The second write finds the key taken and
 * writes nothing. There is no read-then-write anywhere in the accrual path,
 * because a read-then-write is a race and this is money.
 *
 * ## Why the balance is summed rather than stored
 *
 * A stored balance is a second source of truth that drifts from the first one
 * silently. Summing an append-only ledger cannot drift: the figures are integer
 * micro-dollars, the sum is exact, and a claim is a negative row rather than a
 * mutation of the rows it consumed. What a person is owed is therefore always a
 * function of what happened, and never of what some earlier version of this
 * code believed at the time.
 */

const ENTRIES = "rewardEntries" as const;
const ACCOUNTS = "rewardAccounts" as const;
const CODES = "rewardCodes" as const;
const EDGES = "rewardReferralEdges" as const;

/* ------------------------------------------------------------------ entries */

export type RecordRewardsResult = Readonly<{
  /** Entries this call created. Empty when every one of them already existed. */
  created: readonly RewardEntry[];
  /** Entries that were already there. A repeat read reports these, not an error. */
  existing: number;
}>;

/**
 * Write a settlement's rewards, once.
 *
 * Non-fatal by contract, exactly like the wallet action ledger it sits beside:
 * a swap that succeeded must never be reported as failed because a reward row
 * could not be written. The money moved; the entitlement is briefly missing;
 * the next read of the same operation writes it under the same key.
 */
export async function recordRewards(
  store: GuardStore,
  entries: readonly RewardEntry[],
  ref: string,
): Promise<RecordRewardsResult> {
  const collection = store.collection<RewardEntry>(ENTRIES);
  const created: RewardEntry[] = [];
  let existing = 0;
  for (const entry of entries) {
    const parsed = RewardEntrySchema.parse(entry);
    const key = rewardEntryKey({ recipient: parsed.recipient, type: parsed.type, ref });
    const inserted = await collection.insertIfAbsent(key, parsed);
    if (inserted) created.push(parsed);
    else existing += 1;
  }
  return { created, existing };
}

/** Every reward row belonging to one wallet, newest first. */
export async function listRewardEntries(store: GuardStore, wallet: string): Promise<readonly RewardEntry[]> {
  const rows = await store.collection<RewardEntry>(ENTRIES).valuesWithPrefix(rewardEntryPrefix(wallet));
  return [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export type RewardTotals = Readonly<{
  /** Valued accruals minus claims. What Ryntra owes, before the reserve bound. */
  entitledUsdMicros: bigint;
  /** Accruals with no dollar figure yet. Real money, not yet a number. */
  unvaluedCount: number;
  /** Everything ever earned, claims excluded. The lifetime figure. */
  lifetimeUsdMicros: bigint;
  /** Already paid out, as a positive number. */
  claimedUsdMicros: bigint;
  bySource: Readonly<Record<"CASHBACK" | "REFERRAL_L1" | "REFERRAL_L2", bigint>>;
}>;

/**
 * Add up a wallet's ledger.
 *
 * A `null` dollar figure is counted as unvalued rather than as zero. The
 * distinction is the whole of the owner's Pending rule: zero would mean *we
 * looked and there was nothing*, and this means *we have not been able to say
 * yet*.
 */
export function totalRewards(entries: readonly RewardEntry[]): RewardTotals {
  let entitled = 0n;
  let lifetime = 0n;
  let claimed = 0n;
  let unvalued = 0;
  const bySource = { CASHBACK: 0n, REFERRAL_L1: 0n, REFERRAL_L2: 0n };
  for (const entry of effectiveRewardEntries(entries)) {
    if (entry.usdMicros === null) {
      unvalued += 1;
      continue;
    }
    const value = BigInt(entry.usdMicros);
    entitled += value;
    if (entry.type === "CLAIM") {
      claimed -= value;
      continue;
    }
    lifetime += value;
    if (entry.type === "CASHBACK" || entry.type === "REFERRAL_L1" || entry.type === "REFERRAL_L2") {
      bySource[entry.type] += value;
    }
  }
  return {
    entitledUsdMicros: entitled,
    unvaluedCount: unvalued,
    lifetimeUsdMicros: lifetime,
    claimedUsdMicros: claimed,
    bySource,
  };
}

/** The claim row a payout writes. Negative, so the balance is a plain sum. */
export function claimEntry(
  args: Readonly<{ wallet: string; claimId: string; usdMicros: bigint; signature: string | null; now: string }>,
): RewardEntry {
  if (args.usdMicros <= 0n) throw new Error("A claim entry must record a positive amount paid.");
  return {
    type: "CLAIM",
    recipient: args.wallet,
    rateBps: 0,
    shareRaw: null,
    usdMicros: (-args.usdMicros).toString(),
    valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: "USDC", observedAt: args.now },
    source: null,
    createdAt: args.now,
    claimId: args.claimId,
    signature: args.signature,
  };
}

/** Write a claim row under a key that cannot be written twice for one claim. */
export async function recordClaimEntry(store: GuardStore, entry: RewardEntry): Promise<boolean> {
  if (!entry.claimId) throw new Error("A claim entry must name its claim.");
  const key = rewardEntryKey({ recipient: entry.recipient, type: "CLAIM", ref: entry.claimId });
  return store.collection<RewardEntry>(ENTRIES).insertIfAbsent(key, RewardEntrySchema.parse(entry));
}

/* ----------------------------------------------------------------- accounts */

/**
 * This wallet's referral record, created on first sight.
 *
 * Creating it is not an account and not a registration: it is one row holding a
 * random code, so that a person who opens Rewards has a link to copy without
 * being asked to sign anything first. Nothing about it is exposed to anybody
 * else — a code resolves to a wallet only inside the server.
 */
export async function ensureRewardAccount(
  store: GuardStore,
  wallet: string,
  now: string,
): Promise<RewardAccount> {
  const accounts = store.versioned<RewardAccount>(ACCOUNTS);
  const codes = store.collection<ReferralCodeRecord>(CODES);
  return withBoundedCasRetry(async () => {
    const found = await accounts.get(wallet);
    /* Parsed on the way out, not returned raw.
       The store hands back the JSON it was given, so a schema default only
       applies to something that actually goes through the schema. A record
       written before `directReferrals` existed came back without the field,
       `account.directReferrals + 1` was `NaN`, and the write that carried it
       was rejected — which is how a referral count silently stayed at zero. */
    if (found) return RewardAccountSchema.parse(found);
    /* A collision is astronomically unlikely at 128 bits and is still handled:
       the code index is the authority, and losing that insert means minting
       again rather than two people sharing one link. */
    const code = mintReferralCode();
    const claimed = await codes.insertIfAbsent(code, ReferralCodeRecordSchema.parse({ code, wallet, createdAt: now }));
    if (!claimed) return false;
    const record = RewardAccountSchema.parse({
      wallet,
      code,
      referrer: null,
      referredAt: null,
      createdAt: now,
      earning: false,
      version: 0,
    });
    const written = await accounts.compareAndSet(wallet, null, record);
    return written ? record : false;
  });
}

export async function readRewardAccount(store: GuardStore, wallet: string): Promise<RewardAccount | null> {
  const found = await store.versioned<RewardAccount>(ACCOUNTS).get(wallet);
  /* Parsed for the same reason `ensureRewardAccount` parses: fields added after
     a record was written exist only once something applies their defaults. */
  return found ? RewardAccountSchema.parse(found) : null;
}

/** Which wallet a referral link belongs to, or null when it belongs to nobody. */
export async function walletForCode(store: GuardStore, code: string): Promise<string | null> {
  const record = await store.collection<ReferralCodeRecord>(CODES).get(code);
  return record?.wallet ?? null;
}

/**
 * Bind an inviter to a wallet, once, under the rules in `decideReferralBind`.
 *
 * The ancestry passed to the decision is read here rather than by the caller,
 * so a route cannot forget to check for a cycle.
 */
export async function bindReferrer(
  store: GuardStore,
  args: Readonly<{ wallet: string; code: string; now: string }>,
): Promise<ReferralBindDecision> {
  const referrer = await walletForCode(store, args.code);
  return withBoundedCasRetry(async () => {
    const account = await ensureRewardAccount(store, args.wallet, args.now);
    if (referrer === args.wallet) return { ok: false, code: "SELF_REFERRAL", reason: "A wallet cannot invite itself." } as const;
    const chain: string[] = [];
    const ancestors: RewardAccount[] = [];
    let cursor = referrer;
    while (cursor) {
      if (chain.includes(cursor) || cursor === args.wallet) {
        return { ok: false, code: "CYCLE", reason: "This invitation would create a referral cycle." } as const;
      }
      if (chain.length >= 256) throw new Error("The referral ancestry could not be verified within its read budget.");
      chain.push(cursor);
      const above = await readRewardAccount(store, cursor);
      if (!above) break;
      ancestors.push(above);
      cursor = above.referrer;
    }
    const decision = decideReferralBind({ wallet: args.wallet, referrer, account, referrerChain: chain });
    if (!decision.ok) return decision;
    if (account.referrer) return decision;
    const next = RewardAccountSchema.parse({
      ...account,
      referrer,
      referredAt: args.now,
      version: account.version + 1,
    });
    // Fence every ancestor read in the same transaction as the binding. Two
    // opposite binds cannot each approve an old empty graph and both commit.
    const written = await store.compareAndSetMany([
      { collection: ACCOUNTS, key: args.wallet, expectedVersion: account.version, next },
      ...ancestors.map(ancestor => ({ collection: ACCOUNTS, key: ancestor.wallet, expectedVersion: ancestor.version, next: { ...ancestor, version: ancestor.version + 1 } })),
    ]);
    if (!written) return false;
    /* The two people above now have one more person under them. Counted here,
       on the confirmation, because that is when somebody actually chose them.

       Non-fatal and deliberately after the binding: a count is a display
       figure, and losing one must never cost somebody their inviter. It also
       cannot double-count, because a wallet binds exactly once —
       `ALREADY_REFERRED` refuses every later attempt. */
    await reconcileReferralEdges(store, args.wallet, args.now);
    return decision;
  });
}

/**
 * One edge of the referral graph, and the count that follows from it.
 *
 * `insertIfAbsent` is what makes this safe to call anywhere, any number of
 * times: the edge either did not exist — in which case somebody has genuinely
 * just been added below this wallet and the count moves — or it did, and
 * nothing happens. That is the property a bare counter could not have.
 *
 * Returns true when the edge was new, which is the only case that writes.
 */
async function linkReferralEdge(
  store: GuardStore,
  args: Readonly<{ referrer: string; wallet: string; level: 1 | 2; now: string }>,
): Promise<boolean> {
  if (args.referrer === args.wallet) return false;
  const key = `${args.referrer}:L${args.level}:${args.wallet}`;
  const inserted = await store
    .collection<{ referrer: string; wallet: string; level: number; at: string }>(EDGES)
    .insertIfAbsent(key, { referrer: args.referrer, wallet: args.wallet, level: args.level, at: args.now });
  // Recompute from the edges even when the insert already existed: a crashed
  // counter update must remain repairable on the next read.
  await refreshReferralCounts(store, args.referrer, args.now);
  return inserted;
}

/**
 * Write the edges an already-bound wallet should have, and count what was
 * missing.
 *
 * This is the repair path, and it is why the edges exist at all. Every
 * attribution written before the counters existed — the silent ones the old
 * read path made while a page loaded — left the referrer's figure at zero with
 * no way to find them again. Re-asserting the edges on an ordinary read fixes
 * each of them once, the first time either party opens Rewards, and costs two
 * absent-key checks for everybody else.
 *
 * Non-fatal by contract: a display figure must never break a page.
 */
export async function reconcileReferralEdges(store: GuardStore, wallet: string, now: string): Promise<void> {
  try {
    await refreshReferralCounts(store, wallet, now);
    const account = await readRewardAccount(store, wallet);
    if (!account?.referrer) return;
    await linkReferralEdge(store, { referrer: account.referrer, wallet, level: 1, now });
    const above = await readRewardAccount(store, account.referrer);
    if (above?.referrer && above.referrer !== wallet) {
      await linkReferralEdge(store, { referrer: above.referrer, wallet, level: 2, now });
    }
    const children = await store.collection<{ wallet: string }>(EDGES).valuesWithPrefix(`${wallet}:L1:`);
    for (const child of children) {
      if (child.wallet !== account.referrer) await linkReferralEdge(store, { referrer: account.referrer, wallet: child.wallet, level: 2, now });
    }
  } catch {
    /* The graph is intact either way; only the figure beside it waits. */
  }
}

/** One more person below this wallet, at one level or the other. */
async function refreshReferralCounts(
  store: GuardStore,
  wallet: string,
  now: string,
): Promise<void> {
  const accounts = store.versioned<RewardAccount>(ACCOUNTS);
  try {
    await withBoundedCasRetry(async () => {
      const account = await ensureRewardAccount(store, wallet, now);
      const edges = await store.collection<{ wallet: string; level: number }>(EDGES).valuesWithPrefix(`${wallet}:`);
      const directReferrals = new Set(edges.filter(edge => edge.level === 1).map(edge => edge.wallet)).size;
      const level2Referrals = new Set(edges.filter(edge => edge.level === 2).map(edge => edge.wallet)).size;
      if (account.directReferrals === directReferrals && account.level2Referrals === level2Referrals) return true;
      const next = RewardAccountSchema.parse({
        ...account,
        directReferrals,
        level2Referrals,
        version: account.version + 1,
      });
      return (await accounts.compareAndSet(wallet, account.version, next)) ? true : false;
    });
  } catch (failure) {
    /* Contention past the retry budget is the expected case and is survivable:
       the attribution stands and the figure is one short. It is reported rather
       than swallowed, because an empty catch here once hid a schema rejection
       that kept every count at zero. */
    console.warn(`rewards: referral count refresh did not finish: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
}

/**
 * Mark a wallet as having earned, which is what closes its inviter question.
 *
 * Non-fatal and idempotent: a wallet already marked is left alone, and a failed
 * mark costs nothing but a later chance to change an inviter that in practice
 * nobody is trying to change.
 */
export async function markEarning(store: GuardStore, wallet: string, now: string): Promise<void> {
  const accounts = store.versioned<RewardAccount>(ACCOUNTS);
  await withBoundedCasRetry(async () => {
    const account = await ensureRewardAccount(store, wallet, now);
    if (account.earning) return true;
    const next = RewardAccountSchema.parse({ ...account, earning: true, version: account.version + 1 });
    const written = await accounts.compareAndSet(wallet, account.version, next);
    return written ? true : false;
  });
}

/** The two levels owed against this trader's operation. */
export async function resolveReferralLevels(
  store: GuardStore,
  trader: string,
): Promise<Readonly<{ l1: string | null; l2: string | null }>> {
  const account = await readRewardAccount(store, trader);
  if (!account?.referrer) return { l1: null, l2: null };
  const above = await readRewardAccount(store, account.referrer);
  return referralLevels(account, above);
}

/* ------------------------------------------------------------------ counts */

/**
 * How many people have chosen this wallet as their inviter.
 *
 * Read off the account record rather than derived from reward rows. The
 * derived version counted only people who had already traded, so somebody who
 * had invited ten and whose tenth had not swapped yet saw nothing — and beside
 * `L1 earned` it described the same set twice. What a referrer wants here is
 * how many they brought; what they earned is the figure next to it.
 *
 * Other people's addresses, trades and volumes appear nowhere. Two integers is
 * the whole of what this product says about somebody else's activity.
 */
export function referralCounts(
  account: RewardAccount | null,
): Readonly<{ level1: number; level2: number }> {
  return { level1: account?.directReferrals ?? 0, level2: account?.level2Referrals ?? 0 };
}

/** Resolve a later valuation without modifying the original earned row or
 * showing the same entitlement twice. General adjustments remain separate. */
export function effectiveRewardEntries(entries: readonly RewardEntry[]): readonly RewardEntry[] {
  const valued = new Map<string, RewardEntry>();
  for (const entry of entries) {
    if (entry.type !== "ADJUSTMENT" || !entry.valuationOf || entry.usdMicros === null) continue;
    const previous = valued.get(entry.valuationOf.key);
    if (previous && previous.usdMicros !== entry.usdMicros) throw new Error("Conflicting valuations of one reward.");
    valued.set(entry.valuationOf.key, entry);
  }
  return entries.filter(entry => !entry.valuationOf).map(entry => {
    if (entry.usdMicros !== null || !entry.source) return entry;
    const key = rewardEntryKey({ recipient: entry.recipient, type: entry.type, ref: `${entry.source.mechanism}:${entry.source.operationRef}` });
    const adjustment = valued.get(key);
    if (!adjustment || adjustment.recipient !== entry.recipient || adjustment.valuationOf?.type !== entry.type
      || adjustment.shareRaw !== entry.shareRaw || adjustment.source?.grossRaw !== entry.source.grossRaw
      || adjustment.source.asset !== entry.source.asset || adjustment.source.decimals !== entry.source.decimals) return entry;
    return { ...entry, usdMicros: adjustment.usdMicros, valuation: adjustment.valuation };
  });
}

/** Counts are a projection of bindings, including a binding whose edge index
 * write was interrupted. Only two aggregate numbers leave the server. */
export async function readReferralCounts(store: GuardStore, wallet: string): Promise<Readonly<{ level1: number; level2: number }>> {
  const records = (await store.collection<RewardAccount>(ACCOUNTS).valuesWithPrefix("")).map(row => RewardAccountSchema.parse(row));
  const direct = new Set(records.filter(row => row.referrer === wallet && row.wallet !== wallet).map(row => row.wallet));
  const indirect = new Set(records.filter(row => row.referrer && direct.has(row.referrer) && row.wallet !== wallet && !direct.has(row.wallet)).map(row => row.wallet));
  return { level1: direct.size, level2: indirect.size };
}

/** A one-line operator summary. Never shown to a customer. */
export function describeTotals(totals: RewardTotals): string {
  return `entitled $${formatUsdMicros(totals.entitledUsdMicros)}, lifetime $${formatUsdMicros(totals.lifetimeUsdMicros)}, claimed $${formatUsdMicros(totals.claimedUsdMicros)}, ${totals.unvaluedCount} unvalued`;
}

export type { RewardType };
