/**
 * The growth panel (Ріст 7) — the owner's answer to *where do people come from, and where do they drop off?*
 *
 * Pure: no clock, no store, no `process.env`. A projection over records the product already keeps — the wallet
 * action ledger, wallet presence, the referral graph and the rewards ledger, read exactly as «Аналітика» reads them
 * (`lib/admin/business.server.ts`) — and the panel's own three: visits by source, the post codes it issued and the
 * one source each wallet came from (`touch-store.ts`).
 *
 * ## The rules every number here follows
 *
 * 1. **External wallets only.** The owner's and the test wallets (the admin list and `RYNTRA_INTERNAL_WALLETS`)
 *    are left out of every figure; there is no «all activity» switch here.
 * 2. **A wallet is new once.** Its first appearance is the earliest of: the cabinet reading it, its proof, its
 *    first operation, the moment it met a touch. The window's wallets are the ones that first appeared in it.
 * 3. **A source is earned before the wallet.** A wallet is a post's, a contest's, a UTM link's or a friend's only
 *    when its browser carried that touch before the wallet first appeared; a wallet Ryntra knew earlier counts as
 *    a known wallet that the source brought back, never as a new one. A wallet with no touch whose inviter is on
 *    the referral graph is a friend's; every other wallet is «без мітки».
 * 4. **A purchase is a finished operation** — a `DONE` row of the `SWAP` or `CROSS_SWAP` lane, as «Аналітика» and
 *    `/stats` count it (an autoinvest purchase is one of them).
 * 5. **A return is judged only when it can be.** «Повернення 7» is another purchase on a later day within seven
 *    days of the first, out of the buyers whose first purchase is at least seven days old; 30 the same.
 * 6. **Zero means a measured zero.** A source that failed to read answers `unavailable`, never a number.
 */

import { projectBusiness, type BusinessInputs, type SourceState } from "../admin/business.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import type { PostCode, TouchWallet } from "./touch-store.ts";
import { UTM_OVERFLOW_KEY } from "./touch-store.ts";
import { sourceFromKey, sourceKey, type TouchChannel } from "./touch.ts";
import { utmFromKey } from "./touch-param.ts";

export const PANEL_RANGES = ["7d", "30d", "all"] as const;
export type PanelRange = (typeof PANEL_RANGES)[number];

export function isPanelRange(value: unknown): value is PanelRange {
  return typeof value === "string" && (PANEL_RANGES as readonly string[]).includes(value);
}

const DAY_MS = 86_400_000;
/** A touch set this long after the wallet's first appearance is still before it: the two writes race on one page. */
const TOUCH_GRACE_MS = 60_000;
/** A wallet meets its touch when it first appears in the cabinet: the two writes are a moment apart, a day at most. */
const BIND_WINDOW_MS = DAY_MS;

export const STAGE_GATES = [
  { stage: 0, name: "Перші 100", from: 0 },
  { stage: 1, name: "Звичка", from: 100 },
  { stage: 2, name: "Партнери", from: 300 },
  { stage: 3, name: "Великі призи", from: 5_000 },
] as const;

export type PanelBudget = Readonly<{
  month: string;
  limitUsd: number;
  spentUsd: number;
  leftUsd: number;
  /** The month's total equals the sum of its lines. */
  reconciled: boolean;
}>;

export type PanelVisit = Readonly<{ day: string; source: string; visits: number }>;

export type PanelInputs = Readonly<{
  now: string;
  range: PanelRange;
  business: BusinessInputs;
  visits: readonly PanelVisit[];
  touches: readonly TouchWallet[];
  posts: readonly PostCode[];
  budget: PanelBudget | null;
  sources: Readonly<{ visits: SourceState; touches: SourceState; posts: SourceState; budget: SourceState }>;
  /** Whether the owner's list of internal wallets read; when not, only the deployment's own list is excluded. */
  internalWallets: SourceState;
  /** Whether the deployment can sign a touch (its secret is set); without it no wallet meets a source. */
  touchSigning: boolean;
}>;

export type PanelChannel = TouchChannel | "direct" | "total";

export type PanelSourceRow = Readonly<{
  /** `post:7KD2F9X`, `utm:x|social|weekly`, `friend`, `direct`. */
  key: string;
  channel: PanelChannel;
  label: string;
  /** The network and the code of a post; the UTM parts; null otherwise. */
  detail: string | null;
  /** Tagged arrivals in the window; null where visits are not counted (no tag). */
  visits: number | null;
  /* Null — not a zero — when a record the wallets are read from did not answer (the ledger, presence, touches, friends). */
  wallets: number | null;
  purchased: number | null;
  returned7: number | null;
  mature7: number | null;
  returned30: number | null;
  mature30: number | null;
  /** Wallets Ryntra knew before that this source brought back in the window. */
  known: number | null;
}>;

export type PanelFunnelStep = Readonly<{ id: "visits" | "wallets" | "purchased" | "returned7" | "returned30"; value: number | null; of: number | null }>;

export type PanelInviter = Readonly<{ wallet: string; joined: number; purchased: number }>;

export type PanelPost = Readonly<PostCode & { visits: number | null; wallets: number | null; purchased: number | null }>;

export type PanelModel = Readonly<{
  generatedAt: string;
  range: PanelRange;
  windowStart: string | null;
  internalWallets: number;
  sources: PanelInputs["sources"] & Readonly<{ actions: SourceState; presence: SourceState; rewards: SourceState; internal: SourceState }>;
  touchSigning: boolean;
  coverage: Readonly<{ visitsSince: string | null; touchesSince: string | null; presenceSince: string | null }>;
  /** Tagged traffic, one path: visits → new wallets → first purchase → return 7 / 30. */
  funnel: readonly PanelFunnelStep[];
  rows: readonly PanelSourceRow[];
  totals: Readonly<{ tagged: PanelSourceRow; direct: PanelSourceRow; all: PanelSourceRow }>;
  friends: Readonly<{
    arrivals: number | null;
    joined: number | null;
    purchased: number | null;
    active: number | null;
    /** Friends' share of the window's new wallets. */
    shareOfNew: number | null;
    inviters: readonly PanelInviter[];
  }>;
  budget: PanelBudget | null;
  /** The month's budget spent per wallet that made its first purchase this month. */
  budgetPerActivatedUsd: number | null;
  money: Readonly<{
    rewardsUsd: number | null;
    cashbackUsd: number | null;
    friendsUsd: number | null;
    netFeeUsd: number | null;
    retainedUsd: number | null;
    /** rewards / net fee; null when there is no net fee to divide by. */
    costRatio: number | null;
  }>;
  aim: Readonly<{
    value: number | null;
    stage: (typeof STAGE_GATES)[number];
    next: (typeof STAGE_GATES)[number] | null;
    toNext: number | null;
  }>;
  posts: readonly PanelPost[];
}>;

/* ---------------------------------------------------------------- helpers */

function isPurchase(action: SolanaWalletAction): boolean {
  return (action.lane === "SWAP" || action.lane === "CROSS_SWAP") && action.outcome === "DONE";
}

export function maskWallet(wallet: string): string {
  return wallet.length <= 10 ? wallet : `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

function windowStartOf(range: PanelRange, now: string): string | null {
  const end = Date.parse(now);
  if (range === "7d") return new Date(end - 7 * DAY_MS).toISOString();
  if (range === "30d") return new Date(end - 30 * DAY_MS).toISOString();
  return null;
}

const NETWORK_LABEL: Record<PostCode["network"], string> = {
  x: "X",
  telegram: "Telegram",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  other: "Інше",
};

export function networkLabel(network: PostCode["network"]): string {
  return NETWORK_LABEL[network];
}

function labelOf(key: string, posts: ReadonlyMap<string, PostCode>): Readonly<{ channel: PanelChannel; label: string; detail: string | null }> {
  if (key === "direct") return { channel: "direct", label: "Без мітки", detail: null };
  if (key === "friend") return { channel: "friend", label: "Друзі", detail: null };
  if (key === UTM_OVERFLOW_KEY) return { channel: "utm", label: "Інші UTM", detail: "понад 200 нових джерел за день" };
  const source = sourceFromKey(key);
  if (!source) return { channel: "direct", label: key, detail: null };
  if (source.channel === "utm") {
    const tag = utmFromKey(source.source)!;
    return { channel: "utm", label: tag.source, detail: [tag.medium, tag.campaign].filter(Boolean).join(" · ") || null };
  }
  const post = posts.get(source.source);
  return {
    channel: source.channel,
    label: post?.title ?? source.source,
    detail: post ? `${NETWORK_LABEL[post.network]} · ${post.code}` : source.source,
  };
}

/** Purchase times of each wallet, ascending. */
function purchasesByWallet(actions: readonly SolanaWalletAction[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const action of actions) {
    if (action.network !== "mainnet" || !isPurchase(action)) continue;
    const id = `${action.wallet}:${action.actionId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const at = Date.parse(action.startedAt);
    if (!Number.isFinite(at)) continue;
    const list = out.get(action.wallet) ?? [];
    list.push(at);
    out.set(action.wallet, list);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Another purchase on a later UTC day within `days` of the first; null while the first is younger than `days`. */
export function returnedWithin(times: readonly number[], days: number, nowMs: number): boolean | null {
  const first = times[0];
  if (first === undefined || nowMs - first < days * DAY_MS) return null;
  const firstDay = utcDay(first);
  return times.some((at) => at > first && at <= first + days * DAY_MS && utcDay(at) !== firstDay);
}

type Tally = { visits: number | null; wallets: number; purchased: number; returned7: number; mature7: number; returned30: number; mature30: number; known: number };

const emptyTally = (visits: number | null): Tally => ({ visits, wallets: 0, purchased: 0, returned7: 0, mature7: 0, returned30: 0, mature30: 0, known: 0 });

/* ------------------------------------------------------------- the window */

export type WalletOrigin = Readonly<{ key: string; firstSeenMs: number; known: boolean }>;

/**
 * Each external wallet's first appearance and the source that brought it, by rules 2 and 3 above. `known` marks a
 * wallet whose touch came after Ryntra already knew it.
 */
export function walletOrigins(input: PanelInputs): Map<string, WalletOrigin & { touchBoundMs: number | null; touchKey: string | null }> {
  const internal = input.business.internalWallets;
  const first = new Map<string, number>();
  const note = (wallet: string, at: string | null | undefined) => {
    if (!at || internal.has(wallet)) return;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return;
    const current = first.get(wallet);
    if (current === undefined || ms < current) first.set(wallet, ms);
  };
  for (const row of input.business.presence) {
    note(row.wallet, row.firstSeenAt);
    note(row.wallet, row.firstVerifiedAt);
  }
  for (const action of input.business.actions) if (action.network === "mainnet") note(action.wallet, action.startedAt);
  const touchOf = new Map(input.touches.map((touch) => [touch.wallet, touch] as const));
  const invited = new Set(input.business.edges.filter((edge) => edge.level === 1 && !internal.has(edge.referrer)).map((edge) => edge.wallet));
  const out = new Map<string, WalletOrigin & { touchBoundMs: number | null; touchKey: string | null }>();
  for (const [wallet, firstSeenMs] of first) {
    const touch = touchOf.get(wallet);
    const touchKey = touch ? sourceKey({ channel: touch.channel, source: touch.source }) : null;
    /* The touch came before the wallet, and met it when it first appeared — not a day before (a wallet named in
       advance) and not weeks later in another browser (history is not rewritten). */
    const acquired = touch !== undefined && Date.parse(touch.touchAt) <= firstSeenMs + TOUCH_GRACE_MS
      && Math.abs(Date.parse(touch.boundAt) - firstSeenMs) <= BIND_WINDOW_MS;
    const key = acquired ? touchKey! : invited.has(wallet) ? "friend" : "direct";
    /* Known: Ryntra had already seen the wallet when the touch met it. A touch that named it before it appeared is neither. */
    const known = touch !== undefined && !acquired && Date.parse(touch.touchAt) > firstSeenMs + TOUCH_GRACE_MS && Date.parse(touch.boundAt) >= firstSeenMs;
    out.set(wallet, { key, firstSeenMs, known, touchBoundMs: touch ? Date.parse(touch.boundAt) : null, touchKey });
  }
  return out;
}

export type SourceWindow = Readonly<{ start: string | null; end: string }>;

/** Whether every record a wallet's first appearance and source are read from answered. */
export function panelWalletsMeasured(input: PanelInputs): boolean {
  const { sources } = input.business;
  return sources.actions === "measured" && sources.presence === "measured" && sources.rewards === "measured" && input.sources.touches === "measured";
}

/** The source table of one window: visits in it, the wallets that first appeared in it and what they did since. */
export function sourceTable(input: PanelInputs, window: SourceWindow): Readonly<{ rows: PanelSourceRow[]; tagged: PanelSourceRow; direct: PanelSourceRow; all: PanelSourceRow; origins: ReturnType<typeof walletOrigins> }> {
  const nowMs = Date.parse(input.now);
  const startMs = window.start === null ? Number.NEGATIVE_INFINITY : Date.parse(window.start);
  const endMs = Date.parse(window.end);
  const inWindow = (ms: number) => ms >= startMs && ms < endMs + (window.end === input.now ? 1 : 0);
  /* Whole UTC days of visits: a window that starts mid-day starts its visits on the next day, so seven days of
     wallets meet seven days of visits, not eight. */
  const startDay = window.start === null ? null : window.start.endsWith("T00:00:00.000Z") ? window.start.slice(0, 10) : utcDay(Date.parse(window.start) + DAY_MS);
  const endDay = window.end.slice(0, 10);
  const posts = new Map(input.posts.map((post) => [post.code, post] as const));
  const purchases = purchasesByWallet(input.business.actions);
  const origins = walletOrigins(input);

  /* Visits that did not read are not a zero: every visits cell is then empty. */
  const visitsMeasured = input.sources.visits === "measured";
  const tallies = new Map<string, Tally>();
  const tally = (key: string) => {
    let row = tallies.get(key);
    if (!row) {
      row = emptyTally(key === "direct" || !visitsMeasured ? null : 0);
      tallies.set(key, row);
    }
    return row;
  };
  /* A day's visits belong to the window when the day does; a week's last day is the day before its end. */
  const lastDay = window.end === input.now ? endDay : utcDay(endMs - 1);
  for (const visit of visitsMeasured ? input.visits : []) {
    if ((startDay !== null && visit.day < startDay) || visit.day > lastDay) continue;
    const row = tally(visit.source);
    row.visits = (row.visits ?? 0) + visit.visits;
  }
  /* Every post the panel issued has a row, even before its first visit. */
  for (const post of input.posts) {
    if (Date.parse(post.createdAt) <= endMs) tally(sourceKey({ channel: post.kind === "contest" ? "contest" : "post", source: post.code }));
  }
  for (const [wallet, origin] of origins) {
    if (origin.known && origin.touchKey && origin.touchBoundMs !== null && inWindow(origin.touchBoundMs)) tally(origin.touchKey).known += 1;
    if (!inWindow(origin.firstSeenMs)) continue;
    const row = tally(origin.key);
    row.wallets += 1;
    const times = purchases.get(wallet) ?? [];
    if (times.length === 0) continue;
    row.purchased += 1;
    const r7 = returnedWithin(times, 7, nowMs);
    if (r7 !== null) {
      row.mature7 += 1;
      if (r7) row.returned7 += 1;
    }
    const r30 = returnedWithin(times, 30, nowMs);
    if (r30 !== null) {
      row.mature30 += 1;
      if (r30) row.returned30 += 1;
    }
  }
  const walletsMeasured = panelWalletsMeasured(input);
  const toRow = (key: string, value: Tally): PanelSourceRow => {
    const label = labelOf(key, posts);
    if (walletsMeasured) return { key, ...label, ...value };
    return { key, ...label, visits: value.visits, wallets: null, purchased: null, returned7: null, mature7: null, returned30: null, mature30: null, known: null };
  };
  const tagged_ = [...tallies.entries()].filter(([key]) => key !== "direct");
  const rows = tagged_
    .map(([key, value]) => toRow(key, value))
    .sort((a, b) => (b.wallets ?? 0) - (a.wallets ?? 0) || (b.visits ?? 0) - (a.visits ?? 0) || a.label.localeCompare(b.label));
  const sum = (list: readonly Tally[], visits: boolean): Tally => {
    const total = emptyTally(visits ? 0 : null);
    for (const row of list) {
      if (visits && row.visits !== null) total.visits = (total.visits ?? 0) + row.visits;
      total.wallets += row.wallets;
      total.purchased += row.purchased;
      total.returned7 += row.returned7;
      total.mature7 += row.mature7;
      total.returned30 += row.returned30;
      total.mature30 += row.mature30;
      total.known += row.known;
    }
    return total;
  };
  const directTally = tallies.get("direct") ?? emptyTally(null);
  const tagged = { ...toRow("tagged", sum(tagged_.map(([, value]) => value), visitsMeasured)), channel: "total" as const, label: "З мітками", detail: null };
  const direct = toRow("direct", directTally);
  const all = { ...toRow("all", sum([...tagged_.map(([, value]) => value), directTally], false)), channel: "total" as const, label: "Усі нові гаманці", detail: null };
  return { rows, tagged, direct, all, origins };
}

/* -------------------------------------------------------------- the model */

export function projectPanel(input: PanelInputs): PanelModel {
  const { now, range } = input;
  const nowMs = Date.parse(now);
  const start = windowStartOf(range, now);
  const internal = input.business.internalWallets;
  const table = sourceTable(input, { start, end: now });
  const { rows, tagged, direct, all } = table;
  const purchases = purchasesByWallet(input.business.actions);
  const inWindow = (ms: number) => (start === null || ms >= Date.parse(start)) && ms <= nowMs;

  const funnel: PanelFunnelStep[] = [
    { id: "visits", value: tagged.visits, of: null },
    { id: "wallets", value: tagged.wallets, of: tagged.visits },
    { id: "purchased", value: tagged.purchased, of: tagged.wallets },
    { id: "returned7", value: tagged.returned7, of: tagged.mature7 },
    { id: "returned30", value: tagged.returned30, of: tagged.mature30 },
  ];

  /* Friends: invited (arrivals by a friend's link) → joined (the referral graph, level 1) → first purchase → active. */
  const friendVisits = input.sources.visits === "measured" ? (rows.find((row) => row.key === "friend")?.visits ?? 0) : null;
  const joinedEdges = input.business.edges.filter((edge) => edge.level === 1 && !internal.has(edge.referrer) && !internal.has(edge.wallet) && inWindow(Date.parse(edge.at)));
  const joinedWallets = new Map<string, string>();
  for (const edge of joinedEdges) if (!joinedWallets.has(edge.wallet)) joinedWallets.set(edge.wallet, edge.referrer);
  let friendsPurchased = 0;
  let friendsActive = 0;
  const inviters = new Map<string, { joined: number; purchased: number }>();
  for (const [wallet, referrer] of joinedWallets) {
    const times = purchases.get(wallet) ?? [];
    const row = inviters.get(referrer) ?? { joined: 0, purchased: 0 };
    row.joined += 1;
    if (times.length > 0) {
      friendsPurchased += 1;
      row.purchased += 1;
      /* Active: a purchase in the last thirty days, by a friend whose first purchase is at least a week old. */
      if (nowMs - times[0]! >= 7 * DAY_MS && times.some((at) => at >= nowMs - 30 * DAY_MS)) friendsActive += 1;
    }
    inviters.set(referrer, row);
  }
  const friendRow = rows.find((row) => row.key === "friend");
  /* The referral graph lives beside the rewards ledger: when it did not read, no friend figure is a zero. */
  const friendsMeasured = input.business.sources.rewards === "measured";
  const actionsMeasured = input.business.sources.actions === "measured";

  /* Money: the same projection «Аналітика» draws, external wallets, the same window. */
  const business = projectBusiness({ ...input.business, range, scope: "external" });
  const cell = (value: { value?: number; status: string }) => (value.status === "measured" && typeof value.value === "number" ? value.value : null);
  const rewardsUsd = cell(business.rewards.accruedUsd);
  const netFeeUsd = cell(business.revenue.netBeforeRewardsUsd);
  const cashback = cell(business.revenue.cashbackUsd);
  const l1 = cell(business.revenue.referralL1Usd);
  const l2 = cell(business.revenue.referralL2Usd);

  /* Active investors of the month: external wallets with a finished purchase in the last thirty days. */
  let aim: number | null = null;
  if (input.business.sources.actions === "measured") {
    aim = 0;
    for (const [wallet, times] of purchases) if (!internal.has(wallet) && times.some((at) => at >= nowMs - 30 * DAY_MS && at <= nowMs)) aim += 1;
  }
  const stage = [...STAGE_GATES].reverse().find((gate) => (aim ?? 0) >= gate.from) ?? STAGE_GATES[0];
  const next = STAGE_GATES.find((gate) => gate.from > (aim ?? 0)) ?? null;

  /* The budget per activated wallet: this month's spend over the wallets whose first purchase is this month. */
  let budgetPerActivatedUsd: number | null = null;
  if (input.budget && input.business.sources.actions === "measured") {
    const month = input.budget.month;
    let activated = 0;
    for (const [wallet, times] of purchases) if (!internal.has(wallet) && utcDay(times[0]!).slice(0, 7) === month) activated += 1;
    budgetPerActivatedUsd = activated > 0 ? input.budget.spentUsd / activated : null;
  }

  const posts: PanelPost[] = input.posts.map((post) => {
    const key = sourceKey({ channel: post.kind === "contest" ? "contest" : "post", source: post.code });
    const row = rows.find((candidate) => candidate.key === key);
    const walletsMeasured = panelWalletsMeasured(input);
    return {
      ...post,
      visits: input.sources.visits === "measured" ? (row?.visits ?? 0) : null,
      wallets: walletsMeasured ? (row?.wallets ?? 0) : null,
      purchased: walletsMeasured ? (row?.purchased ?? 0) : null,
    };
  });

  const earliest = (values: readonly string[]) => (values.length === 0 ? null : values.reduce((min, value) => (value < min ? value : min)));
  return {
    generatedAt: now,
    range,
    windowStart: start,
    internalWallets: internal.size,
    sources: { ...input.sources, actions: input.business.sources.actions, presence: input.business.sources.presence, rewards: input.business.sources.rewards, internal: input.internalWallets },
    touchSigning: input.touchSigning,
    coverage: {
      visitsSince: earliest(input.visits.map((visit) => visit.day)),
      touchesSince: earliest(input.touches.map((touch) => touch.boundAt)),
      presenceSince: business.coverage.presenceSince,
    },
    funnel,
    rows,
    totals: { tagged, direct, all },
    friends: {
      arrivals: friendVisits,
      joined: friendsMeasured ? joinedWallets.size : null,
      purchased: friendsMeasured && actionsMeasured ? friendsPurchased : null,
      active: friendsMeasured && actionsMeasured ? friendsActive : null,
      shareOfNew: all.wallets !== null && all.wallets > 0 ? (friendRow?.wallets ?? 0) / all.wallets : null,
      inviters: (friendsMeasured && actionsMeasured ? [...inviters.entries()] : [])
        .map(([wallet, row]) => ({ wallet: maskWallet(wallet), ...row }))
        .sort((a, b) => b.joined - a.joined || b.purchased - a.purchased || a.wallet.localeCompare(b.wallet))
        .slice(0, 10),
    },
    budget: input.budget,
    budgetPerActivatedUsd,
    money: {
      rewardsUsd,
      cashbackUsd: cashback,
      friendsUsd: l1 === null || l2 === null ? null : l1 + l2,
      netFeeUsd,
      retainedUsd: cell(business.revenue.retainedUsd),
      costRatio: rewardsUsd !== null && netFeeUsd !== null && netFeeUsd > 0 ? rewardsUsd / netFeeUsd : null,
    },
    aim: { value: aim, stage, next, toNext: aim === null || next === null ? null : next.from - aim },
    posts,
  };
}
