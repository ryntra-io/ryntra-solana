import { createHash } from "node:crypto";

import { effectiveRewardEntries } from "./ledger.ts";
import { accrualRef, isParMint, rewardEntryKey, rewardEntryRefOf, RewardEntrySchema, usdMicrosOf, type RewardEntry } from "./model.ts";
import type { RewardClaim } from "./claim.ts";

/**
 * «Усього нараховано = сума квитанцій» (Ріст 3): every dollar Rewards says it owes comes from the receipt of an
 * operation, and every receipt that should have paid did — checked on the rows themselves, for the test and for the
 * script (`scripts/rewards/reconcile.mjs`) that runs it on the stand or on the production ledger, read only.
 *
 * ## What is compared
 *
 * 1. **Rows ↔ operations.** Every accrual row (cashback, friend's share, their window rows) belongs to an operation
 *    record (`rewardAccruals`, the receipt of what was shared) that lists it — or is a row such a record allows to be
 *    written later (the part past «First $10 back», a valuation); every row a record lists is in the ledger.
 * 2. **Never more than the receipt.** On each operation the shares add up to no more than the fee the person paid,
 *    and — where the receipt says what reached Ryntra (`ryntraRaw`) and the rules share what was received — no more
 *    than that.
 * 3. **Receipts ↔ operations.** Every swap whose receipt shows a collected fee, settled after Rewards began, has its
 *    operation record — unless its accrual is still queued, nothing reached Ryntra, or the wallet is internal
 *    (internal wallets earn no money, `internal.ts`).
 * 4. **Claims.** Every claim row carries its payout signature; a payout the claim record calls `PAID` has its row of
 *    exactly its amount; a row of the record's current claim belongs to a `PAID` claim.
 * 5. **The budget pays no reward row** (`budget.ts`): a row `fundedBy: "budget"` is a difference.
 * 6. **No money without a fee.** A row with no fee is only a mark of «First $10 back»: a pass of nothing, a window
 *    taken back, or given back — never more than was taken back from that wallet.
 * 7. **Dollars as well as units.** Each row's dollars against its own valuation (par only on a dollar stablecoin,
 *    a named price, stated dollars only from Relay and only up to its stated fee), and against the lowest price the
 *    operation's own rows allow — so no single inflated row can lift the ceiling it is checked by.
 * 8. **Both directions.** Every operation record has the receipt of a finished operation (a swap's by its signature,
 *    a cross-chain swap's by its source transaction), and no share is in the ledger twice. What it cannot see: a
 *    price that is wrong for every row of an operation alike (a swap's receipt states no dollars) — that is the
 *    feed's, not the ledger's; and the $10 cap of «First $10 back» — a split trade's half row carries the ordinary
 *    half past the cap too, so the cap is kept by the window's own record (`first-ten.ts`, its tests), not here.
 *
 * The totals then follow: accrued = the sum over operations, owed = accrued − claimed. Everything the report names
 * is a hash prefix, an amount or a count — never an address or a signature.
 */

export type ReconcileReceipt = Readonly<{
  /** The operation's own reference — the swap signature, as the accrual's `operationRef`. */
  operationRef: string;
  wallet: string;
  settledAt: string;
  collected: boolean;
  grossRaw: string | null;
  ryntraRaw: string | null;
  /** The provider's own dollar figure for the fee, where it states one. */
  usd?: number | null;
  /** A cross-chain receipt (Relay): read only for its stated dollars — its fee is the provider's, not a swap's. */
  statedOnly?: boolean;
}>;

export type ReconcileAccrual = Readonly<{ trader: string; entries: readonly RewardEntry[]; rules?: string }>;

export type ReconcileInput = Readonly<{
  entries: readonly RewardEntry[];
  accruals: readonly ReconcileAccrual[];
  claims: readonly RewardClaim[];
  /** Swap receipts with a fee; others are not read. */
  receipts?: readonly ReconcileReceipt[];
  /** REWARDS jobs still queued, by operation reference. */
  queued?: ReadonlySet<string>;
  /** Operations whose own row is still being written (`IN_FLIGHT`), by operation reference: no receipt yet, not a difference. */
  unfinished?: ReadonlySet<string>;
  /** Rewards began here; receipts before it accrue nothing. Null: not begun. */
  activationAt: string | null;
  internal: ReadonlySet<string>;
}>;

export type ReconcileDifference = Readonly<{ kind: string; ref: string; detail: string }>;

export type ReconcileReport = Readonly<{
  equal: boolean;
  operations: number;
  rows: number;
  totals: Readonly<{
    /** Every valued accrual row, after late valuations: what Rewards says it ever owed. */
    accruedUsdMicros: string;
    /** The same, summed operation by operation from their records. Equal to the line above when nothing is orphaned. */
    byOperationsUsdMicros: string;
    claimedUsdMicros: string;
    owedUsdMicros: string;
    unvaluedRows: number;
    /** Owed to internal wallets — rows written before they were excluded from money; never paid out. */
    internalOwedUsdMicros: string;
  }>;
  receipts: Readonly<{ checked: number; matched: number; queued: number; internal: number; nothingReceived: number; beforeActivation: number;
    /** Operations valued in dollars a provider stated, with no stated receipt passed to hold them against. */
    statedUnchecked: number;
    /** Operations whose own row is still being written: their receipt comes when the schedule completes it. */
    unfinished: number }>;
  differences: readonly ReconcileDifference[];
}>;

const ACCRUAL_TYPES = new Set(["CASHBACK", "REFERRAL_L1", "REFERRAL_L2"]);
/** The rows of a trade inside «First $10 back», whose rest is paid in dollars rather than by its raw share. */
const WINDOW_PARTS = new Set(["FIRST_TEN", "FIRST_TEN_REST", "FIRST_TEN_AFTER"]);
/** The key of a row written after its record (the part past the cap) — a valuation may name it. */
const LATER_KEYS = /:after$/;

/** May this row past the cap have been written after `record`? Only beside a window trade's rest, to its inviter. */
function laterAllowed(record: ReconcileAccrual, entry: RewardEntry): boolean {
  if (!record.entries.some((row) => row.window === "FIRST_TEN_REST")) return false;
  if (entry.type === "REFERRAL_L1") return record.entries.some((row) => row.type === "REFERRAL_L1" && row.window === "FIRST_TEN" && row.recipient === entry.recipient);
  return entry.type === "REFERRAL_L2" || entry.type === "CASHBACK";
}

/** Rows a record allows after its first write: the ordinary part past «First $10 back». */
const LATER_WINDOWS = new Set(["FIRST_TEN_AFTER"]);

export function hashRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function rowKey(entry: RewardEntry): string | null {
  if (!entry.source) return null;
  return rewardEntryKey({ recipient: entry.recipient, type: entry.type, ref: rewardEntryRefOf(entry, accrualRef(entry.source.mechanism as never, entry.source.operationRef)) });
}

function sumUsd(entries: readonly RewardEntry[]): bigint {
  return entries.reduce((sum, entry) => sum + (entry.usdMicros === null ? 0n : BigInt(entry.usdMicros)), 0n);
}

export function reconcileRewards(input: ReconcileInput): ReconcileReport {
  const differences: ReconcileDifference[] = [];
  const entries = input.entries.map((entry) => RewardEntrySchema.parse(entry));
  const effective = effectiveRewardEntries(entries);
  const accrualRows = effective.filter((entry) => entry.type !== "CLAIM");

  /* 1. Rows ↔ operations. */
  const records = new Map<string, ReconcileAccrual>();
  const byOperationRef = new Set<string>();
  for (const record of input.accruals) {
    const source = record.entries.find((entry) => entry.source)?.source;
    /* A fee whose every share rounds to nothing is written as a record with no rows: nothing to pay, nothing to check. */
    if (record.entries.length === 0) continue;
    if (!source) {
      differences.push({ kind: "RECORD_WITHOUT_SOURCE", ref: hashRef(record.trader), detail: "an operation record names no fee" });
      continue;
    }
    const ref = accrualRef(source.mechanism as never, source.operationRef);
    if (byOperationRef.has(source.operationRef)) differences.push({ kind: "OPERATION_TWICE", ref: hashRef(ref), detail: "one operation has more than one record" });
    byOperationRef.add(source.operationRef);
    records.set(ref, record);
  }
  const byKey = new Map<string, RewardEntry>();
  for (const entry of entries) {
    if (entry.valuationOf || !ACCRUAL_TYPES.has(entry.type)) continue;
    const key = rowKey(entry);
    if (key) byKey.set(key, entry);
  }
  /* Two rows of one share under different storage keys: the ledger would pay it twice. */
  const seen = new Map<string, number>();
  for (const entry of effective) {
    if (!ACCRUAL_TYPES.has(entry.type)) continue;
    const key = rowKey(entry);
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) if (count > 1) differences.push({ kind: "ROW_DUPLICATED", ref: hashRef(key), detail: `one share is in the ledger ${count} times` });
  const listed = new Set<string>();
  for (const [ref, record] of records) {
    for (const row of record.entries) {
      const key = rowKey(row);
      if (!key) continue;
      listed.add(key);
      const kept = byKey.get(key);
      if (!kept) differences.push({ kind: "RECORD_ROW_MISSING", ref: hashRef(ref), detail: `${row.type} listed by its operation is not in the ledger` });
      else if (kept.shareRaw !== row.shareRaw) differences.push({ kind: "ROW_CHANGED", ref: hashRef(ref), detail: `${row.type} differs from its operation's record` });
    }
  }
  for (const entry of entries) {
    if (entry.valuationOf && entry.source && !listed.has(entry.valuationOf.key) && !LATER_KEYS.test(entry.valuationOf.key)) {
      differences.push({ kind: "VALUATION_OF_NOTHING", ref: hashRef(entry.valuationOf.key), detail: "a valuation names a row no operation lists" });
    }
  }
  const perOperation = new Map<string, RewardEntry[]>();
  for (const entry of accrualRows) {
    if (entry.fundedBy === "budget") differences.push({ kind: "BUDGET_PAID_A_ROW", ref: hashRef(entry.recipient), detail: "the growth budget pays no reward row" });
    /* A row without a fee — a general adjustment, a window taken back or given back — stands on its own. */
    if (!entry.source) continue;
    const ref = accrualRef(entry.source.mechanism as never, entry.source.operationRef);
    const record = records.get(ref);
    const key = ACCRUAL_TYPES.has(entry.type) ? rowKey(entry) : null;
    if (!record) {
      differences.push({ kind: "ROW_WITHOUT_OPERATION", ref: hashRef(ref), detail: `${entry.type} has no operation record` });
      continue;
    }
    /* A fee-bearing adjustment is only a valuation of a row its operation lists (merged into it above); any other
       carries money no receipt explains. */
    if (entry.type === "ADJUSTMENT") {
      differences.push({ kind: "ROW_WITHOUT_RECEIPT", ref: hashRef(ref), detail: "an adjustment with a fee is not a valuation of the operation's own row" });
      continue;
    }
    /* The part past «First $10 back» is the only row written after the record — and only on an operation whose record
       holds a window trade, only to its inviter (the zero row's) or its second level. */
    const later = entry.window !== undefined && LATER_WINDOWS.has(entry.window) && laterAllowed(record, entry);
    if (key && !listed.has(key) && !later) {
      differences.push({ kind: "ROW_NOT_LISTED", ref: hashRef(ref), detail: `${entry.type} is not one its operation wrote` });
    }
    perOperation.set(ref, [...(perOperation.get(ref) ?? []), entry]);
  }

  /* 2. Never more than the receipt — in raw units and in dollars, with no row's own figure taken on trust. */
  let statedUnchecked = 0;
  const receiptByRef = new Map((input.receipts ?? []).map((receipt) => [receipt.operationRef, receipt] as const));
  for (const [ref, rows] of perOperation) {
    const shares = rows.filter((entry) => ACCRUAL_TYPES.has(entry.type));
    const gross = BigInt(shares[0]?.source?.grossRaw ?? "0");
    const receipt = receiptByRef.get(shares[0]?.source?.operationRef ?? "");
    const more = (kind: "MORE_THAN_PAID" | "MORE_THAN_RECEIVED" | "ROW_OVERVALUED", detail: string) => differences.push({ kind, ref: hashRef(ref), detail });
    if (!receipt?.statedOnly && receipt?.grossRaw != null && receipt.grossRaw !== shares[0]?.source?.grossRaw) differences.push({ kind: "GROSS_DIFFERS", ref: hashRef(ref), detail: "the operation's fee differs from its receipt" });
    const received = !receipt?.statedOnly && receipt?.ryntraRaw != null && shares.some((entry) => entry.rules?.base === "RECEIVED") ? BigInt(receipt.ryntraRaw) : null;
    /* A window trade by what its record wrote — a row added later cannot turn an ordinary trade into one. */
    const windowed = (records.get(ref)?.entries ?? []).some((entry) => entry.window && WINDOW_PARTS.has(entry.window));

    /* Each row's dollars against its own valuation: at par the raw amount, priced the price it names. A rest row of
       «First $10 back» pays what it was due, never more than its raw part is worth. */
    for (const entry of shares) {
      if (entry.usdMicros === null || entry.shareRaw === null || !entry.source) continue;
      /* The basis must fit the fee: par only on a dollar stablecoin, stated dollars only from the provider that states
         them (Relay) — a row cannot pick the valuation that suits it. */
      if (entry.valuation.basis === "STABLECOIN_PAR" && !isParMint(entry.source.asset, entry.source.decimals)) more("ROW_OVERVALUED", `${entry.type} is valued at par on a fee that is not a dollar stablecoin`);
      if (entry.valuation.basis === "PROVIDER_STATED_USD" && entry.source.mechanism !== "RELAY_APP_FEE") more("ROW_OVERVALUED", `${entry.type} is valued in dollars its provider does not state`);
      const usd = BigInt(entry.usdMicros);
      /* A late-valued part past «First $10 back» is valued from its unfloored dollar part: one raw unit of slack. */
      const raw = BigInt(entry.shareRaw) + (entry.window === "FIRST_TEN_AFTER" ? 1n : 0n);
      const worth = entry.valuation.basis === "STABLECOIN_PAR" ? usdMicrosOf({ raw, decimals: entry.source.decimals, price: "1" })
        : entry.valuation.basis === "PRICED_AT_SETTLEMENT" && entry.valuation.price ? usdMicrosOf({ raw, decimals: entry.source.decimals, price: entry.valuation.price })
        : null;
      if (worth !== null && usd > worth) more("ROW_OVERVALUED", `${entry.type} is worth more dollars than its share at its own valuation`);
    }

    /* The operation's price, as low as its own rows allow: each row is floored, so `(usd + 1) / share` of every row is
       above the true price, and the lowest of them is the tightest bound no single inflated row can raise. */
    const valued = shares.filter((entry) => entry.usdMicros !== null && entry.window !== "FIRST_TEN_REST" && entry.window !== "FIRST_TEN_AFTER" && BigInt(entry.shareRaw ?? "0") > 0n);
    const allValued = shares.every((entry) => entry.usdMicros !== null);
    const bound = valued.reduce<Readonly<{ usd: bigint; share: bigint }> | null>((low, entry) => {
      const next = { usd: BigInt(entry.usdMicros!) + 1n, share: BigInt(entry.shareRaw!) };
      return !low || next.usd * low.share < low.usd * next.share ? next : low;
    }, null);
    const worthOf = (raw: bigint) => (bound ? (raw * bound.usd + bound.share - 1n) / bound.share : null);
    /* A share is floored in raw units, a stated-dollar row is not: one raw unit's worth of slack per row. */
    const unit = bound ? (bound.usd + bound.share - 1n) / bound.share : 0n;
    /* The part past the cap is checked against the bound, not part of it: its dollars come unfloored (two units). */
    for (const entry of shares.filter((row) => row.usdMicros !== null && row.window !== "FIRST_TEN_REST" && BigInt(row.shareRaw ?? "0") > 0n)) {
      if (!bound) break;
      const ceiling = worthOf(BigInt(entry.shareRaw!))! + unit * (entry.window === "FIRST_TEN_AFTER" ? 2n : 1n);
      if (BigInt(entry.usdMicros!) > ceiling) more("ROW_OVERVALUED", `${entry.type} is valued above the operation's own price`);
    }
    /* Stated dollars with no stated receipt to hold them against are counted, never passed silently. */
    if (shares.some((entry) => entry.valuation.basis === "PROVIDER_STATED_USD") && typeof receipt?.usd !== "number") statedUnchecked += 1;
    const paidUsd = sumUsd(shares);
    /* A provider that stated the fee in dollars: never more than that, rounding aside — a micro and one raw unit's
       worth per row (inside «First $10 back» a stated half is valued unfloored, its rest from its raw part: on a coarse
       fee token the two can pass the stated fee by part of one unit; that is the rounding of `accrue.ts`, written
       down in the task's records, not a row paid twice). */
    if (allValued && typeof receipt?.usd === "number" && receipt.usd > 0 && paidUsd > BigInt(Math.ceil(receipt.usd * 1_000_000)) + BigInt(shares.length) * (1n + unit)) {
      more("MORE_THAN_PAID", "the shares add up to more dollars than the provider stated for the fee");
    }

    if (!windowed) {
      /* An ordinary operation: its raw shares, against the fee and against what reached Ryntra under its rules'
         ceiling (85 % under 2.1.0, all of it under 2.0.0). */
      const paid = shares.reduce((sum, entry) => sum + BigInt(entry.shareRaw ?? "0"), 0n);
      const ceilingBps = shares.some((entry) => entry.rules?.version === "2.1.0" || entry.rules?.version === "2.2.0") ? 8500n : 10_000n;
      if (paid > gross) more("MORE_THAN_PAID", "the shares add up to more than the fee the person paid");
      if (received !== null && paid * 10_000n > received * ceilingBps) more("MORE_THAN_RECEIVED", "the shares add up to more than the rules allow of what reached Ryntra");
      continue;
    }
    /* «First $10 back»: the rest row keeps the raw part the window held and pays only the dollars it was due — so the
       operation is checked in dollars, against the receipt valued at the operation's own price. Not yet valued —
       checked once it is. */
    if (!allValued || !bound) continue;
    if (paidUsd > worthOf(gross)!) more("MORE_THAN_PAID", "the shares add up to more than the fee the person paid");
    if (received !== null && paidUsd > worthOf(received)!) more("MORE_THAN_RECEIVED", "the shares add up to more than reached Ryntra");
  }

  /* 2b. Rows without a fee: only the marks of «First $10 back» — a pass (nothing), a window taken back (money out),
     a window given back (never more than was taken back from that wallet). Anything else has no receipt behind it. */
  const marks = new Map<string, { voided: bigint; reinstated: bigint }>();
  for (const entry of accrualRows) {
    if (entry.source) continue;
    const usd = entry.usdMicros === null ? 0n : BigInt(entry.usdMicros);
    const mark = marks.get(entry.recipient) ?? { voided: 0n, reinstated: 0n };
    marks.set(entry.recipient, mark);
    if (entry.type === "ADJUSTMENT" && entry.window === "FIRST_TEN_PASSED" && usd === 0n) continue;
    if (entry.type === "ADJUSTMENT" && entry.window === "FIRST_TEN_VOID" && usd <= 0n) { mark.voided -= usd; continue; }
    if (entry.type === "ADJUSTMENT" && entry.window === "FIRST_TEN_REINSTATED" && usd >= 0n) { mark.reinstated += usd; continue; }
    differences.push({ kind: "ROW_WITHOUT_RECEIPT", ref: hashRef(entry.recipient), detail: `${entry.type}${entry.window ? ` ${entry.window}` : ""} has no fee and is not a mark of «First $10 back»` });
  }
  for (const [wallet, mark] of marks) {
    if (mark.reinstated > mark.voided) differences.push({ kind: "MORE_GIVEN_BACK_THAN_TAKEN", ref: hashRef(wallet), detail: "a window was given back more than was taken back" });
  }

  /* 3. Receipts ↔ operations. */
  const operationRefs = new Set([...records.values()].flatMap((record) => record.entries.flatMap((entry) => (entry.source ? [entry.source.operationRef] : []))));
  const counts = { checked: 0, matched: 0, queued: 0, internal: 0, nothingReceived: 0, beforeActivation: 0 };
  for (const receipt of input.receipts ?? []) {
    if (receipt.statedOnly || !receipt.collected || receipt.grossRaw === null || receipt.grossRaw === "0") continue;
    counts.checked += 1;
    if (operationRefs.has(receipt.operationRef)) counts.matched += 1;
    else if (input.activationAt === null || Date.parse(receipt.settledAt) < Date.parse(input.activationAt)) counts.beforeActivation += 1;
    else if (input.internal.has(receipt.wallet)) counts.internal += 1;
    /* Nothing reached Ryntra, or so little that every share rounds to nothing (half of one unit is none). */
    else if ((receipt.ryntraRaw !== null && BigInt(receipt.ryntraRaw) < 2n) || BigInt(receipt.grossRaw) < 2n) counts.nothingReceived += 1;
    else if (input.queued?.has(receipt.operationRef)) counts.queued += 1;
    else differences.push({ kind: "RECEIPT_WITHOUT_OPERATION", ref: hashRef(receipt.operationRef), detail: "a collected fee after Rewards began has no operation record" });
  }

  /* 3b. Operations ↔ receipts: a swap's record has its swap's receipt (a finished one), a cross-chain one its Relay
     receipt — a record of a failed or unknown operation is money with nothing behind it. Read only when receipts are
     given at all. */
  let unfinishedCount = 0;
  if (input.receipts) {
    const swaps = new Map(input.receipts.filter((receipt) => !receipt.statedOnly).map((receipt) => [receipt.operationRef, receipt] as const));
    const crosses = new Map(input.receipts.filter((receipt) => receipt.statedOnly).map((receipt) => [receipt.operationRef, receipt] as const));
    for (const [ref, record] of records) {
      const source = record.entries.find((entry) => entry.source)!.source!;
      const found = swaps.get(source.operationRef) ?? (source.mechanism === "RELAY_APP_FEE" ? crosses.get(source.operationRef) : undefined);
      /* The receipt is the trader's own: the wallet whose operation it was is the one the record paid cashback to. */
      if (found && found.wallet !== record.trader) differences.push({ kind: "RECEIPT_WALLET_DIFFERS", ref: hashRef(ref), detail: "the operation's receipt belongs to another wallet than its record's trader" });
      if (!found && input.unfinished?.has(source.operationRef)) unfinishedCount += 1;
      else if (!found) differences.push({ kind: "OPERATION_WITHOUT_RECEIPT", ref: hashRef(ref), detail: "an operation record has no finished operation's receipt" });
    }
  }

  /* 4. Claims. */
  const claimRows = entries.filter((entry) => entry.type === "CLAIM");
  for (const row of claimRows) {
    if (!row.signature || !row.claimId) differences.push({ kind: "CLAIM_WITHOUT_SIGNATURE", ref: hashRef(row.recipient), detail: "a payout row carries no payout signature" });
    if (row.usdMicros === null || BigInt(row.usdMicros) >= 0n) differences.push({ kind: "CLAIM_NOT_NEGATIVE", ref: hashRef(row.recipient), detail: "a payout row does not take money out" });
  }
  const rowsOfClaim = new Map<string, RewardEntry[]>();
  for (const row of claimRows) rowsOfClaim.set(`${row.recipient}:${row.claimId}`, [...(rowsOfClaim.get(`${row.recipient}:${row.claimId}`) ?? []), row]);
  for (const claim of input.claims) {
    const rows = rowsOfClaim.get(`${claim.wallet}:${claim.claimId}`) ?? [];
    if (claim.state === "PAID") {
      if (rows.length !== 1 || BigInt(rows[0]!.usdMicros ?? "0") !== -BigInt(claim.usdMicros)) {
        differences.push({ kind: "PAID_WITHOUT_ROW", ref: hashRef(claim.claimId), detail: "a paid claim does not have exactly one payout row of its amount" });
      }
    } else if (rows.length > 0) {
      differences.push({ kind: "ROW_OF_UNPAID_CLAIM", ref: hashRef(claim.claimId), detail: `a payout row belongs to a claim that is ${claim.state}` });
    }
  }

  const accrued = sumUsd(accrualRows);
  const byOperations = [...perOperation.values()].reduce((sum, rows) => sum + sumUsd(rows), 0n) + sumUsd(accrualRows.filter((entry) => !entry.source));
  if (accrued !== byOperations) differences.push({ kind: "TOTALS_DIFFER", ref: "-", detail: "the sum of rows differs from the sum over operations" });
  const claimed = -sumUsd(claimRows);
  const internalOwed = sumUsd(effective.filter((entry) => input.internal.has(entry.recipient)));
  return {
    equal: differences.length === 0,
    operations: records.size,
    rows: entries.length,
    totals: {
      accruedUsdMicros: accrued.toString(),
      byOperationsUsdMicros: byOperations.toString(),
      claimedUsdMicros: claimed.toString(),
      owedUsdMicros: (accrued - claimed).toString(),
      unvaluedRows: accrualRows.filter((entry) => entry.usdMicros === null).length,
      internalOwedUsdMicros: internalOwed.toString(),
    },
    receipts: { ...counts, statedUnchecked, unfinished: unfinishedCount },
    differences,
  };
}
