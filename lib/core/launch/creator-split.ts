/**
 * «Частка творця за його вибором» — how a creator divides their own share of a
 * launch's fees: to themselves, to depth, to a community wallet, to holders.
 *
 * The creator's share is what the creator's own wallet earns on the launch —
 * the curve's creator part, the creator's part of the graduation fee and the
 * fees of the creator's locked LP; with «Спільнота» sharing the creator's fees,
 * the creator's own row of the vault. The other rows of that vault are written
 * on chain by Meteora's Dynamic Fee Sharing for ever; this rule divides only
 * what is the creator's own:
 * - **собі** — stays with the creator;
 * - **глибина** — buy steps in the token's DLMM pool below the price, placed by
 *   the creator's own signature (`CREATOR_DEPTH_RULE`); what they buy stays the
 *   creator's;
 * - **спільнота** — one wallet the creator names, paid by the creator's
 *   transfer;
 * - **холдерам** — the token's holders by what they hold in a snapshot of the
 *   chain, without the creator's wallets, the bundle, the pools and the vaults
 *   of programs and Ryntra's wallets; the root of each snapshot goes on chain in
 *   the payout the creator signs.
 *
 * Only the creator's choice: off unless the creator writes a rule, and the rule
 * itself is a transaction the creator signs (`splitRuleMemo`), shown on the
 * token's page before a purchase from then on. It can be raised — more to
 * depth, community or holders — never lowered, and its community wallet never
 * changes once named.
 *
 * What the rule owes is the chain's own count, whichever way the creator takes
 * their fees: from the moment a rule is written, every raw unit the creator's
 * share earns is owed by it once the creator has claimed it (`splitDue`) — the
 * creator's claims drain what was earned before the rule first. What was done is
 * what the creator's signed steps and payouts put where the rule says. The page
 * shows both; the creator who does not sign keeps the money, and Ryntra pays
 * nothing in their place. Ryntra takes 0 and pays holders none of its own fees.
 *
 * Pure and client-safe: no network, no clock unless given, bigint arithmetic
 * rounded down. The chain is read and the transactions built by
 * `../../launch/creator-split.server.ts`.
 */

import { getBase58Encoder } from "@solana/kit";

import { FEE_SHARE_TOTAL_BPS } from "./fee-shares.ts";

export const SPLIT_BUCKETS = ["self", "depth", "community", "holders"] as const;
export type SplitBucket = (typeof SPLIT_BUCKETS)[number];
/** The buckets the creator gives away — everything but «собі». */
export const SPLIT_GIVEN = ["depth", "community", "holders"] as const;
export type SplitGiven = (typeof SPLIT_GIVEN)[number];

/** Each bucket's part of the creator's own share, whole basis points adding up to all of it. */
export type SplitShares = Readonly<Record<SplitBucket, number>>;

/** A rule as the creator writes it: the shares, and the community's wallet when the community takes a part. */
export type SplitRule = Readonly<{ shares: SplitShares; community: string | null }>;

/**
 * One rule in force from a moment on: what the creator's share had earned when it was written — from there on its
 * earnings follow this rule —, when, and the creator's signed transaction that wrote it.
 */
export type SplitSegment = Readonly<{ rule: SplitRule; fromEarnedRaw: string; at: number; signature: string }>;

/** The least part a bucket takes when it takes any: one per cent of the creator's share, as a sharing row. */
export const SPLIT_MIN_BPS = 100;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Whether text is a Solana address — base58 of exactly 32 bytes, as a key the programs take; a look-alike is not. */
export function isKey(text: string): boolean {
  if (!BASE58.test(text)) return false;
  try {
    return getBase58Encoder().encode(text).length === 32;
  } catch {
    return false;
  }
}

export type SplitProblem =
  | "NOT_WHOLE"
  | "NOT_ALL"
  | "NOTHING_SHARED"
  | "SHARE_TOO_SMALL"
  | "COMMUNITY_WALLET_MISSING"
  | "COMMUNITY_WALLET_UNUSED"
  | "NOT_AN_ADDRESS"
  | "COMMUNITY_IS_CREATOR"
  | "COMMUNITY_EXCLUDED";

/**
 * What breaks a rule, each once; empty when it holds. `excluded`: wallets the community's part may not go to — Ryntra's
 * own, the launch's vault and the curve's: a community is not Ryntra and not a program's account.
 */
export function splitProblems(rule: SplitRule, creator: string, excluded: ReadonlySet<string> = new Set()): readonly SplitProblem[] {
  const problems = new Set<SplitProblem>();
  let total = 0;
  for (const bucket of SPLIT_BUCKETS) {
    const bps = rule.shares[bucket];
    if (!Number.isInteger(bps) || bps < 0 || bps > FEE_SHARE_TOTAL_BPS) problems.add("NOT_WHOLE");
    else total += bps;
  }
  if (!problems.has("NOT_WHOLE")) {
    if (total !== FEE_SHARE_TOTAL_BPS) problems.add("NOT_ALL");
    else if (rule.shares.self === FEE_SHARE_TOTAL_BPS) problems.add("NOTHING_SHARED");
    for (const bucket of SPLIT_GIVEN) if (rule.shares[bucket] > 0 && rule.shares[bucket] < SPLIT_MIN_BPS) problems.add("SHARE_TOO_SMALL");
  }
  const takes = Number.isInteger(rule.shares.community) && rule.shares.community > 0;
  if (takes && !rule.community) problems.add("COMMUNITY_WALLET_MISSING");
  if (!takes && rule.community) problems.add("COMMUNITY_WALLET_UNUSED");
  if (rule.community) {
    if (!isKey(rule.community)) problems.add("NOT_AN_ADDRESS");
    else if (rule.community === creator) problems.add("COMMUNITY_IS_CREATOR");
    else if (excluded.has(rule.community)) problems.add("COMMUNITY_EXCLUDED");
  }
  return [...problems];
}

export type SplitRaiseProblem = "LOWERED" | "WALLET_CHANGED" | "SAME";

/**
 * What makes a new rule not a raise of the one in force: a given part lower than before (a buyer saw the old one), a
 * community wallet other than the one named, or no change at all. Empty when the new rule only gives more.
 */
export function splitRaiseProblems(current: SplitRule, next: SplitRule): readonly SplitRaiseProblem[] {
  const problems: SplitRaiseProblem[] = [];
  if (SPLIT_GIVEN.some((bucket) => next.shares[bucket] < current.shares[bucket])) problems.push("LOWERED");
  if (current.community && next.community !== current.community) problems.push("WALLET_CHANGED");
  if (!problems.length && SPLIT_BUCKETS.every((bucket) => next.shares[bucket] === current.shares[bucket]) && next.community === current.community) problems.push("SAME");
  return problems;
}

/* ------------------------------------------------------------ what the rule owes */

export type SplitAmounts = Readonly<Record<SplitBucket, bigint>>;

const zero = (): Record<SplitBucket, bigint> => ({ self: 0n, depth: 0n, community: 0n, holders: 0n });
const clamp = (value: bigint, low: bigint, high: bigint | null) => (value < low ? low : high !== null && value > high ? high : value);

/**
 * What the rules owe each bucket once the creator's share has claimed `claimedRaw` in all: each segment's part of what
 * was claimed — the creator's claims drain what was earned before the first rule, then each segment's earnings in
 * turn — divided by its rule, the given buckets rounded down and «собі» the rest. `subjectRaw`: everything claimed that
 * the rules divide. Segments in the order they were written.
 */
export function splitDue(segments: readonly SplitSegment[], claimedRaw: bigint): Readonly<{ due: SplitAmounts; subjectRaw: bigint }> {
  const due = zero();
  let subject = 0n;
  segments.forEach((segment, index) => {
    const from = BigInt(segment.fromEarnedRaw);
    const next = segments[index + 1];
    const width = next ? BigInt(next.fromEarnedRaw) - from : null;
    const part = clamp(claimedRaw - from, 0n, width !== null && width < 0n ? 0n : width);
    if (part <= 0n) return;
    subject += part;
    let given = 0n;
    for (const bucket of SPLIT_GIVEN) {
      const amount = (part * BigInt(segment.rule.shares[bucket])) / BigInt(FEE_SHARE_TOTAL_BPS);
      due[bucket] += amount;
      given += amount;
    }
    due.self += part - given;
  });
  return { due, subjectRaw: subject };
}

/** What is owed and not yet done, bucket by bucket; never below zero. */
export function splitOutstanding(due: SplitAmounts, done: Readonly<Record<SplitGiven, bigint>>): Readonly<Record<SplitGiven, bigint>> {
  const left = (bucket: SplitGiven) => (due[bucket] > done[bucket] ? due[bucket] - done[bucket] : 0n);
  return { depth: left("depth"), community: left("community"), holders: left("holders") };
}

/* ------------------------------------------------------------ the least amounts */

/** The least each act moves, in dollars: below them the network's rent and fees cost more than the act is worth. */
export const SPLIT_MINIMUM_USD = Object.freeze({ depth: 10, community: 1, holdersRound: 5, perHolder: 0.01 });
/** The devnet stand's: a rehearsal moves cents. */
export const DEVNET_SPLIT_MINIMUM_USD = Object.freeze({ depth: 0.1, community: 0.01, holdersRound: 0.05, perHolder: 0.000001 });

export type SplitMinimums = Readonly<{ depthRaw: bigint; communityRaw: bigint; holdersRoundRaw: bigint; perHolderRaw: bigint }>;

/** The least amounts in the pair currency's raw units, from its dollar price; a pair without a price counts one whole unit as a dollar. */
export function splitMinimums(pair: Readonly<{ decimals: number; usdPrice: number }>, cluster: "devnet" | "mainnet"): SplitMinimums {
  const usd = cluster === "devnet" ? DEVNET_SPLIT_MINIMUM_USD : SPLIT_MINIMUM_USD;
  const price = Number.isFinite(pair.usdPrice) && pair.usdPrice > 0 ? pair.usdPrice : 1;
  const raw = (dollars: number) => {
    const units = BigInt(Math.ceil((dollars / price) * 10 ** pair.decimals));
    return units > 0n ? units : 1n;
  };
  return { depthRaw: raw(usd.depth), communityRaw: raw(usd.community), holdersRoundRaw: raw(usd.holdersRound), perHolderRaw: raw(usd.perHolder) };
}

/* ------------------------------------------------------------ the holders' snapshot */

/** At most this many holders one round pays — the largest by what they hold; a round is one window of signatures. */
export const SPLIT_HOLDERS_PER_ROUND = 60;

export type SnapshotAccount = Readonly<{ owner: string; amountRaw: string }>;

export const SNAPSHOT_EXCLUSIONS = ["creator", "linked", "bundle", "program", "ryntra", "unbought"] as const;
export type SnapshotExclusion = (typeof SNAPSHOT_EXCLUSIONS)[number];

export type HolderSnapshot = Readonly<{
  /** The holders a round may pay, by owner, the largest first (an owner's accounts added up). */
  eligible: readonly Readonly<{ wallet: string; amountRaw: string }>[];
  /** How many owners each rule left out, and what they held. */
  excluded: Readonly<Record<SnapshotExclusion, Readonly<{ wallets: number; amountRaw: string }>>>;
}>;

/**
 * The token's holders a round may pay, from every account of the mint: added up by owner, then without — the creator
 * and the wallets linked to them (the vault's other rows, the community's wallet); the bundle (bought in the creation's
 * block, or paid for by the creator); every owner that is no wallet but a program's address — the curve's and the
 * pool's vaults, the creator's lock, any pool —, found by `onCurve`; and Ryntra's own wallets. Of the rest, only what a
 * wallet bought on the market and still holds counts (`bought`: each wallet's tokens bought less sold, from the token's
 * whole history): tokens that came by a transfer — the creator's to a fresh wallet of theirs, or anyone's — earn nothing,
 * and their part is `unbought`.
 */
export function holderSnapshot(
  accounts: readonly SnapshotAccount[],
  args: Readonly<{
    creator: string;
    linked: ReadonlySet<string>;
    bundle: ReadonlySet<string>;
    ryntra: ReadonlySet<string>;
    /** Whether an address is a key someone holds — off the curve it is a program's derived address. */
    onCurve: (address: string) => boolean;
    /** Each wallet's tokens bought on the market less those it sold, raw; a wallet absent bought none. */
    bought: ReadonlyMap<string, bigint>;
  }>,
): HolderSnapshot {
  const byOwner = new Map<string, bigint>();
  for (const account of accounts) {
    const amount = BigInt(account.amountRaw);
    if (amount <= 0n) continue;
    byOwner.set(account.owner, (byOwner.get(account.owner) ?? 0n) + amount);
  }
  const excluded = Object.fromEntries(SNAPSHOT_EXCLUSIONS.map((reason) => [reason, { wallets: 0, amount: 0n }])) as Record<SnapshotExclusion, { wallets: number; amount: bigint }>;
  const eligible: { wallet: string; amount: bigint }[] = [];
  for (const [owner, amount] of byOwner) {
    const reason: SnapshotExclusion | null =
      owner === args.creator ? "creator" : args.linked.has(owner) ? "linked" : args.ryntra.has(owner) ? "ryntra" : args.bundle.has(owner) ? "bundle" : !args.onCurve(owner) ? "program" : null;
    if (reason) {
      excluded[reason].wallets += 1;
      excluded[reason].amount += amount;
      continue;
    }
    const net = args.bought.get(owner) ?? 0n;
    const counted = net <= 0n ? 0n : net < amount ? net : amount;
    if (counted < amount) {
      excluded.unbought.wallets += 1;
      excluded.unbought.amount += amount - counted;
    }
    if (counted > 0n) eligible.push({ wallet: owner, amount: counted });
  }
  eligible.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  return {
    eligible: eligible.map((row) => ({ wallet: row.wallet, amountRaw: row.amount.toString() })),
    excluded: Object.fromEntries(SNAPSHOT_EXCLUSIONS.map((reason) => [reason, { wallets: excluded[reason].wallets, amountRaw: excluded[reason].amount.toString() }])) as HolderSnapshot["excluded"],
  };
}

export type HolderPayoutRow = Readonly<{ wallet: string; holdingRaw: string; amountRaw: string }>;

/**
 * A round's payout: the pot divided by what each of the largest `maxWallets` eligible holders holds, rounded down; a
 * part below `perHolderRaw` is not paid and stays owed for a next round. What is not paid stays owed: the total is at
 * most the pot.
 */
export function holdersPayout(
  potRaw: bigint,
  snapshot: Pick<HolderSnapshot, "eligible">,
  options: Readonly<{ maxWallets?: number; perHolderRaw: bigint }>,
): Readonly<{ rows: readonly HolderPayoutRow[]; totalRaw: bigint; counted: number }> {
  const top = snapshot.eligible.slice(0, options.maxWallets ?? SPLIT_HOLDERS_PER_ROUND);
  const held = top.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n);
  if (potRaw <= 0n || held <= 0n) return { rows: [], totalRaw: 0n, counted: top.length };
  const rows: HolderPayoutRow[] = [];
  let total = 0n;
  for (const row of top) {
    const amount = (potRaw * BigInt(row.amountRaw)) / held;
    if (amount < options.perHolderRaw || amount <= 0n) continue;
    rows.push({ wallet: row.wallet, holdingRaw: row.amountRaw, amountRaw: amount.toString() });
    total += amount;
  }
  return { rows, totalRaw: total, counted: top.length };
}

/* ------------------------------------------------------------ the root the creator signs */

const encoder = getBase58Encoder();
const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const unhex = (text: string) => Uint8Array.from(text.match(/../g)!.map((pair) => parseInt(pair, 16)));

async function sha256(...parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
}

const LEAF = Uint8Array.of(0);
const NODE = Uint8Array.of(1);

/** A row's leaf: sha256(0x00 ‖ the wallet's 32 bytes ‖ the amount, u64 little-endian). */
export async function splitLeaf(row: Pick<HolderPayoutRow, "wallet" | "amountRaw">): Promise<string> {
  const amount = new Uint8Array(8);
  new DataView(amount.buffer).setBigUint64(0, BigInt(row.amountRaw), true);
  return hex(await sha256(LEAF, new Uint8Array(encoder.encode(row.wallet)), amount));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function parent(a: string, b: string): Promise<string> {
  const [low, high] = compare(a, b) <= 0 ? [a, b] : [b, a];
  return hex(await sha256(NODE, unhex(low), unhex(high)));
}

/** The levels of the tree, the sorted leaves first; an odd node goes up as it is. */
async function levels(rows: readonly Pick<HolderPayoutRow, "wallet" | "amountRaw">[]): Promise<string[][]> {
  const leaves = (await Promise.all(rows.map(splitLeaf))).sort(compare);
  const out = [leaves];
  while (out.at(-1)!.length > 1) {
    const level = out.at(-1)!;
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) next.push(index + 1 < level.length ? await parent(level[index]!, level[index + 1]!) : level[index]!);
    out.push(next);
  }
  return out;
}

/**
 * The root of a round's rows — the leaves sorted, each pair hashed sha256(0x01 ‖ lower ‖ higher). Anyone recomputes it
 * from the rows the round lists, and the creator's payout carries it on chain. 64 zeros for no rows.
 */
export async function splitRoot(rows: readonly Pick<HolderPayoutRow, "wallet" | "amountRaw">[]): Promise<string> {
  if (!rows.length) return "0".repeat(64);
  return (await levels(rows)).at(-1)![0]!;
}

/** The proof of one wallet's row: the sibling at each level up, where it has one; null when the wallet is not a row. */
export async function splitProof(rows: readonly Pick<HolderPayoutRow, "wallet" | "amountRaw">[], wallet: string): Promise<readonly string[] | null> {
  const row = rows.find((candidate) => candidate.wallet === wallet);
  if (!row) return null;
  const tree = await levels(rows);
  let at = tree[0]!.indexOf(await splitLeaf(row));
  const proof: string[] = [];
  for (const level of tree.slice(0, -1)) {
    const sibling = at % 2 === 0 ? at + 1 : at - 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    at = Math.floor(at / 2);
  }
  return proof;
}

/** Whether a row and its proof lead to the root. */
export async function verifySplitProof(row: Pick<HolderPayoutRow, "wallet" | "amountRaw">, proof: readonly string[], root: string): Promise<boolean> {
  let node = await splitLeaf(row);
  for (const sibling of proof) node = await parent(node, sibling);
  return node === root;
}

/* ------------------------------------------------------------ what the creator signs */

/** The memo program a rule and a round's root go on chain with. */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** A rule as the creator's transaction writes it: `ryntra:split:1:rule:<token>:s<bps>:d<bps>:c<bps>:h<bps>[:w<wallet>]`. */
export function splitRuleMemo(token: string, rule: SplitRule): string {
  const { self, depth, community, holders } = rule.shares;
  return `ryntra:split:1:rule:${token}:s${self}:d${depth}:c${community}:h${holders}${rule.community ? `:w${rule.community}` : ""}`;
}

/** A rule read back from its memo; null when the text is not one. */
export function parseSplitRuleMemo(text: string): Readonly<{ token: string; rule: SplitRule }> | null {
  const match = /^ryntra:split:1:rule:([1-9A-HJ-NP-Za-km-z]{32,44}):s(\d{1,5}):d(\d{1,5}):c(\d{1,5}):h(\d{1,5})(?::w([1-9A-HJ-NP-Za-km-z]{32,44}))?$/.exec(text);
  if (!match) return null;
  return { token: match[1]!, rule: { shares: { self: Number(match[2]), depth: Number(match[3]), community: Number(match[4]), holders: Number(match[5]) }, community: match[6] ?? null } };
}

/** A round's root as the payout carries it: `ryntra:split:1:round:<token>:<n>:<root>:<rows>:<total raw>`. */
export function splitRoundMemo(token: string, round: number, root: string, rows: number, totalRaw: bigint | string): string {
  return `ryntra:split:1:round:${token}:${round}:${root}:${rows}:${totalRaw.toString()}`;
}

/* ------------------------------------------------------------ the depth steps */

/**
 * The creator's buy steps in the token's DLMM pool: from about −3 % to about −25 % under the price they are set from,
 * the same amount on each (the «Spot» shape), at most 69 steps wide (a position's 70 bins). The price they are set from
 * is the lower of the graduated pool's price and the DLMM pool's own: steps never stand above either.
 */
export const CREATOR_DEPTH_RULE = Object.freeze({ topGapPct: 3, deepestPct: 25, maxBins: 69, /** The finest pool the steps take: from 0.5 % a bin, 69 bins reach −25 %. */ minBinStep: 50 });

/** The steps' bins under a reference bin for a pool's bin step. */
export function creatorDepthLadder(referenceBin: number, binStep: number): Readonly<{ lowerBinId: number; upperBinId: number }> {
  const step = Math.log(1 + binStep / 10_000);
  const gap = Math.max(1, Math.ceil(Math.log(1 / (1 - CREATOR_DEPTH_RULE.topGapPct / 100)) / step - 1e-9));
  const deep = Math.max(gap, Math.floor(Math.log(1 / (1 - CREATOR_DEPTH_RULE.deepestPct / 100)) / step + 1e-9));
  const upperBinId = referenceBin - gap;
  return { lowerBinId: Math.max(upperBinId - CREATOR_DEPTH_RULE.maxBins + 1, referenceBin - deep), upperBinId };
}

/** How far under the reference a ladder's top and bottom step stand, per cent (positive numbers). */
export function depthRangePct(ladder: Readonly<{ lowerBinId: number; upperBinId: number }>, referenceBin: number, binStep: number): Readonly<{ fromPct: number; toPct: number }> {
  const at = (bin: number) => (1 - (1 + binStep / 10_000) ** (bin - referenceBin)) * 100;
  return { fromPct: Math.round(at(ladder.upperBinId) * 10) / 10, toPct: Math.round(at(ladder.lowerBinId) * 10) / 10 };
}

/* ------------------------------------------------------------ the lines before a purchase */

export type SplitLocale = "uk" | "en";

const pct = (bps: number, locale: SplitLocale) => {
  const text = String(bps / 100);
  return locale === "uk" ? `${text.replace(".", ",")} %` : `${text}%`;
};
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
/** A day in the reader's words, by UTC: «24.10.2026» · «Oct 24, 2026». */
const day = (seconds: number, locale: SplitLocale) =>
  new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: locale === "uk" ? "2-digit" : "numeric", month: locale === "uk" ? "2-digit" : "short", year: "numeric", timeZone: "UTC" }).format(new Date(seconds * 1000));

/** The division in one line, each part that takes anything: «собі 50 % · глибина 20 % · …». */
export function splitShareLine(rule: SplitRule, locale: SplitLocale): string {
  const names = locale === "uk" ? { self: "собі", depth: "глибина", community: "спільнота", holders: "холдерам" } : { self: "to self", depth: "depth", community: "community", holders: "holders" };
  return SPLIT_BUCKETS.filter((bucket) => rule.shares[bucket] > 0).map((bucket) => `${names[bucket]} ${pct(rule.shares[bucket], locale)}`).join(" · ");
}

/**
 * The lines the token page shows before a purchase: the division in one line, then what each given part does and who
 * does it — in plain words, with no promise the chain does not keep and no promise of income. `since`: when the first
 * rule came into force; `raisedAt`: when the rule in force raised it, if it did.
 */
export function splitRuleLines(rule: SplitRule, facts: Readonly<{ since: number; raisedAt?: number | null; pairSymbol: string }>, locale: SplitLocale): readonly string[] {
  const { shares } = rule;
  const head = splitShareLine(rule, locale);
  const raised = facts.raisedAt && facts.raisedAt !== facts.since ? facts.raisedAt : null;
  const lines: string[] = [];
  if (locale === "uk") {
    lines.push(`Частка творця в комісіях: ${head}.`);
    if (shares.depth > 0) lines.push(`Глибина: творець своїм підписом ставить сходинки купівлі в пулі DLMM токена — приблизно від −${CREATOR_DEPTH_RULE.topGapPct} % до −${CREATOR_DEPTH_RULE.deepestPct} % під ціною, у ${facts.pairSymbol}; це його позиція: що вона купить, лишається йому, і зняти її може лише він. Ryntra рахує поставлене.`);
    if (shares.community > 0 && rule.community) lines.push(`Спільнота: переказ творця на гаманець ${short(rule.community)}.`);
    if (shares.holders > 0) {
      lines.push(
        `Холдерам: частка ділиться пропорційно до утримання серед ${SPLIT_HOLDERS_PER_ROUND} найбільших холдерів знімка з ланцюга. Рахується не більше, ніж гаманець купив у кривій і пулі DAMM v2 токена мінус продане там; отримане переказом — ні. Не рахуються творець і його пов'язані гаманці, бандл творця (купівлі в блоці створення чи оплачені творцем), пули й сховища програм і гаманці Ryntra; гаманець, який творець поповнив поза угодою, з ланцюга не відрізнити. Корінь кожного знімка творець підписує в транзакції виплати.`,
      );
    }
    lines.push(
      `Правило діє з ${day(facts.since, locale)}${raised ? `, підняте ${day(raised, locale)} — більші частки рахуються відтоді` : ""}; воно записане підписом творця в ланцюгу, і його можна лише збільшити на користь глибини, спільноти й холдерів. Виконує творець своїм підписом; якщо не підпише — гроші лишаються творцеві. Ryntra показує тут, що належить і що виконано, і не платить замість творця. Ryntra бере 0. Це не обіцянка доходу.`,
    );
    return lines;
  }
  lines.push(`The creator's share of the fees: ${head}.`);
  if (shares.depth > 0) lines.push(`Depth: the creator signs buy steps in the token's DLMM pool — from about −${CREATOR_DEPTH_RULE.topGapPct}% to −${CREATOR_DEPTH_RULE.deepestPct}% under the price, in ${facts.pairSymbol}; it is the creator's position: what it buys stays theirs, and only they can withdraw it. Ryntra counts what was placed.`);
  if (shares.community > 0 && rule.community) lines.push(`Community: the creator's transfer to the wallet ${short(rule.community)}.`);
  if (shares.holders > 0) {
    lines.push(
      `Holders: the part is divided in proportion to holdings among the ${SPLIT_HOLDERS_PER_ROUND} largest holders of a snapshot of the chain. A wallet counts at most what it bought on the token's curve and DAMM v2 pool less what it sold there; tokens received by a transfer do not. The creator and their linked wallets, the creator's bundle (buys in the creation's block or paid for by the creator), pools and program vaults, and Ryntra's wallets do not count; a wallet the creator funded outside a trade cannot be told apart on chain. The creator signs each snapshot's root in the payout's transaction.`,
    );
  }
  lines.push(
    `The rule holds from ${day(facts.since, locale)}${raised ? `, raised on ${day(raised, locale)} — the larger parts count from then` : ""}; it is written on chain by the creator's signature and can only be increased in favour of depth, community and holders. The creator carries it out with their signature; if they do not sign, the money stays with the creator. Ryntra shows here what is owed and what was done, and pays nothing in the creator's place. Ryntra takes 0. This is no promise of income.`,
  );
  return lines;
}

/**
 * False: closed there — rules, steps and payouts alike —, whatever
 * else is configured: money a creator gives away and programs a creator's money goes into open to people on mainnet alone, flipped here then — the server and the cabinet read this one value. The devnet stand is open.
 */
export const CREATOR_SPLIT_OWNER_WORD = false;
