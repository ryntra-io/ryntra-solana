import { createHmac } from "node:crypto";

import { walletKey } from "./partner.ts";

/**
 * Protection of the Ryntra Network and of fixed rewards — the rules alone, no
 * store and no chain: signals S1–S10, the activated creator, funding clusters
 * and the trust score.
 *
 * ## A sign, never a verdict
 *
 * Nothing here takes money away. A signal opens a case in the review queue
 * (`review.ts`); while a case is open the money it covers waits, and only a
 * person's decision moves it on — paid as earned, lowered with a reason, or
 * returned to Ryntra. People never see why: the reasons are the reviewer's.
 *
 * ## Only hashes
 *
 * A signal's evidence — a funding source, a withdrawal address, a device, an
 * IP /24 — is kept as a keyed hash (`signalHash`), never as the value, and for
 * `PROTECT_RULES.retentionDays` only. Two wallets sharing a source is seen as
 * two equal hashes; what the source was is not stored anywhere.
 *
 * ## The activated creator
 *
 * A launch is activated — its partner's money may become available — once it
 * has at least three independent external addresses with real activity within
 * thirty days; its creator counts for the partner's badges once one of their
 * confirmed launches is:
 * - external — not the team (whose trades stay in the volumes, marked), not the
 *   creator or the partner, not a wallet linked to either, and not a wallet that
 *   shares a funding source with either;
 * - independent — external addresses that share a funding source with each
 *   other count once together;
 * - real activity — a trade of at least $1 that is not half of a round trip
 *   (bought and sold back within a day for about nothing).
 * An address whose funding could not be read is not counted: its independence
 * is not known. One whose history is too long to read to its start counts alone
 * only if that history reaches at least thirty days before its trade — a life of
 * its own, not a few days of noise made to look long.
 *
 * ## Hubs are the reviewer's
 *
 * A funding source shared by many people — an exchange's hot wallet, a bridge —
 * is no sign that they are one person. Only the reviewer says a source is such
 * a hub (`markHub`); until then a shared source joins the wallets it funded, and
 * the activation read names it, so the reviewer sees what to look at. Whoever
 * funded a wallet directly — the creator, the partner or a wallet linked to
 * either — makes it theirs, hub or not.
 */

export const PROTECT_RULES = {
  version: "protect-1.0.0",
  activation: {
    windowDays: 30,
    independentAddresses: 3,
    /** The least trade that is activity — the programme's minimum of one dollar, chosen by the session for the rule. */
    minTradeUsdMicros: 1_000_000n,
  },
  /**
   * S6: a buy sold back by the same wallet within this many hours, for a result within this many basis points of the
   * buy — a launch curve takes 1 % each way, so an empty round trip loses 2 % and more.
   */
  roundTrip: { windowHours: 24, toleranceBps: 500 },
  /** S5: the wallet's first operation less than this many days before its trade, and its whole life within this many hours. */
  youngWallet: { firstOpDays: 7, burstHours: 48 },
  /**
   * S1: the funding graph is followed this many steps back; S2: money between the two within this many days of the
   * launch; a wallet whose history is too long to read counts alone only if what was read reaches this many days back.
   */
  funding: { hops: 2, directDays: 30, deepAgeDays: 30 },
  /** S4: this many wallets seen on one device; a crowd that grows past the next step is new evidence. */
  device: { crowd: 3, steps: [3, 10, 30, 100, 300] },
  /** S6: a count of others' round trips that grows past the next step is new evidence. */
  roundTripSteps: [1, 3, 10, 30, 100, 300],
  /** S5: a count of young wallets among the counted that grows past the next step is new evidence. */
  youngSteps: [2, 3, 10, 30, 100, 300],
  /** Hashed signals are kept this long. */
  retentionDays: 90,
  /** S10: the answer a person gets, at the latest, this many hours after a case opens. */
  reviewHours: 72,
  /** S7 and S9 — fixed money (tasks, bonuses, friend bonuses): how long the asset must be held, and how long the money waits. */
  fixed: {
    holdHours: { TASK: 72, BONUS: 168, FRIEND: 168 },
    pendingDays: { TASK: 7, BONUS: 7, FRIEND: 14 },
  },
} as const;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/* ------------------------------------------------------------------------------------------------
 * Hashes
 * --------------------------------------------------------------------------------------------- */

/** What a hash stands for — part of what is hashed, so the same value hashes differently as a device and as an address. */
export const SIGNAL_KINDS = ["address", "ip24", "device"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_HASH = /^h1:[A-Za-z0-9_-]{32}$/;

/** The signal key from the deployment's own secret; null when there is none — then nothing is recorded that would need it. */
export function signalKeyFrom(env: Readonly<Record<string, string | undefined>>): Buffer | null {
  const secret = env.BETA_TOKEN_SECRET;
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret).update("ryntra-growth-signals-v1").digest();
}

/** A keyed hash of a signal's value: equal values give equal hashes; the value cannot be read back. */
export function signalHash(key: Uint8Array, kind: SignalKind, value: string): string {
  const normal = kind === "address" ? walletKey(value.trim()) : value.trim().toLowerCase();
  return `h1:${createHmac("sha256", key).update(`${kind}:${normal}`).digest("base64url").slice(0, 32)}`;
}

/** The /24 of an IPv4 address, the /48 of an IPv6 one; null when the value is not an address. */
export function ipPrefix(raw: string | null | undefined): string | null {
  const first = (raw ?? "").split(",")[0]!.trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(first);
  if (v4) return v4.slice(1, 5).every((part) => Number(part) <= 255) ? `${v4[1]}.${v4[2]}.${v4[3]}.0/24` : null;
  if (/^[0-9a-fA-F:]+$/.test(first) && first.includes(":")) {
    const groups = first.split("::")[0]!.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":").toLowerCase()}::/48` : null;
  }
  return null;
}

export type HeaderSource = Readonly<{ get(name: string): string | null }>;

/** A request's device and IP /24 as keyed hashes — the values themselves are never kept. */
export function deviceSignalsOf(headers: HeaderSource, key: Uint8Array): Array<{ kind: "ip24" | "device"; hash: string }> {
  const ip = ipPrefix(headers.get("x-real-ip") ?? headers.get("x-forwarded-for"));
  const agent = (headers.get("user-agent") ?? "").slice(0, 400);
  const language = (headers.get("accept-language") ?? "").slice(0, 100);
  const out: Array<{ kind: "ip24" | "device"; hash: string }> = [];
  if (ip) out.push({ kind: "ip24", hash: signalHash(key, "ip24", ip) });
  if (ip && agent) out.push({ kind: "device", hash: signalHash(key, "device", `${ip}|${agent}|${language}`) });
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * The funding graph
 * --------------------------------------------------------------------------------------------- */

/**
 * One wallet as the chain shows it, by its hash.
 * - `FOUND` — its first incoming money came from `funder`;
 * - `UNKNOWN` — its start was read and names no funder;
 * - `DEEP` — its history is too long to read to the start; `firstAt` is the oldest moment read;
 * - `UNAVAILABLE` — the read failed.
 */
/** `EMPTY` — no history read at all: for a party, nothing to trace; for a trader, a node that has not caught up. Never kept. */
export const FUNDING_STATES = ["FOUND", "UNKNOWN", "DEEP", "EMPTY", "UNAVAILABLE"] as const;
export type FundingState = (typeof FUNDING_STATES)[number];

export type FundingNode = Readonly<{
  state: FundingState;
  /** The funder's hash; null unless `FOUND`. */
  funder: string | null;
  /** The wallet's first (for `DEEP`, the oldest read) and latest operation; null when not read. */
  firstAt: string | null;
  lastAt: string | null;
}>;

/** Nodes by hash. */
export type FundingGraph = ReadonlyMap<string, FundingNode>;

export type Ancestry = Readonly<{
  /** Every funder up the trail, nearest first, at most `hops` — hubs included: who funded a wallet directly owns it. */
  chain: readonly string[];
  /** The funders that are shared sources: the trail up to the first hub the reviewer marked. */
  ancestors: readonly string[];
  /** Every step needed was read: false — the ancestry may be longer than it looks. */
  complete: boolean;
  /** The wallet's own history is too long to read; `since` is how far back it was read. */
  deep: boolean;
  since: string | null;
  /** Nothing was read of the wallet's history at all. */
  empty?: boolean;
}>;

/** A wallet's funders, `hops` steps back: the whole trail, and its shared sources up to a hub the reviewer marked. */
export function ancestryOf(hash: string, graph: FundingGraph, hubs: ReadonlySet<string>, hops: number = PROTECT_RULES.funding.hops): Ancestry {
  const self = graph.get(hash);
  if (!self || self.state === "UNAVAILABLE") return { chain: [], ancestors: [], complete: false, deep: false, since: null };
  if (self.state === "DEEP") return { chain: [], ancestors: [], complete: true, deep: true, since: self.firstAt };
  if (self.state === "EMPTY") return { chain: [], ancestors: [], complete: true, deep: false, since: null, empty: true };
  const chain: string[] = [];
  const ancestors: string[] = [];
  let hubbed = false;
  let node: FundingNode = self;
  for (let step = 0; step < hops; step += 1) {
    if (node.state !== "FOUND" || !node.funder) break;
    chain.push(node.funder);
    if (hubs.has(node.funder)) hubbed = true;
    if (!hubbed) ancestors.push(node.funder);
    if (step + 1 >= hops) break;
    const next = graph.get(node.funder);
    if (!next || next.state === "UNAVAILABLE") return { chain, ancestors, complete: false, deep: false, since: null };
    node = next;
  }
  return { chain, ancestors, complete: true, deep: false, since: null };
}

/** One party's wallets as the funding graph sees them: their hashes, and the trails of each merged. */
/** `deep` — a wallet of the party has a history too long to read: who funded it is not known. */
export type PartyAncestry = Readonly<{ hashes: readonly string[]; chain: readonly string[]; ancestors: readonly string[]; complete: boolean; deep: boolean }>;

export function partyAncestry(hashes: readonly string[], graph: FundingGraph, hubs: ReadonlySet<string>): PartyAncestry {
  const each = hashes.map((hash) => ancestryOf(hash, graph, hubs));
  return {
    hashes: [...new Set(hashes)],
    chain: [...new Set(each.flatMap((ancestry) => ancestry.chain))],
    ancestors: [...new Set(each.flatMap((ancestry) => ancestry.ancestors))],
    complete: each.every((ancestry) => ancestry.complete),
    /* A wallet with no history read hides its start as much as one with too long a history. */
    deep: each.some((ancestry) => ancestry.deep || ancestry.empty === true),
  };
}

/** Two sides, by hash: one funded the other (whoever it is), or both share a source that is not a hub. */
export function fundingLink(left: PartyAncestry, right: PartyAncestry): "DIRECT" | "SHARED" | null {
  if (left.chain.some((hash) => right.hashes.includes(hash)) || right.chain.some((hash) => left.hashes.includes(hash))) return "DIRECT";
  return left.ancestors.some((hash) => right.ancestors.includes(hash)) ? "SHARED" : null;
}

/* ------------------------------------------------------------------------------------------------
 * Trades and the activated creator
 * --------------------------------------------------------------------------------------------- */

export type PoolTrade = Readonly<{
  wallet: string;
  side: "buy" | "sell";
  /** The pair side of the trade in dollars; null — not a dollar pair, no figure. */
  usdMicros: bigint | null;
  at: string;
  tx: string;
}>;

export type PartyWallets = Readonly<{ wallet: string; linked: readonly string[] }>;

export const TRADER_KINDS = ["TEAM", "INSIDER", "EXTERNAL", "UNKNOWN"] as const;
export type TraderKind = (typeof TRADER_KINDS)[number];

export type TraderView = Readonly<{
  /** The trader's hash — the queue names nobody by address but the creator and the partner. */
  hash: string;
  kind: TraderKind;
  /** EXTERNAL and counted: its independent group (one funding cluster counts once). */
  group: string | null;
  volumeUsdMicros: bigint;
  roundTrips: number;
  qualifying: number;
  young: boolean;
}>;

export type ActivationRead = Readonly<{
  activated: boolean;
  /** The trade that made the third independent address within thirty days; null — not yet. */
  at: string | null;
  /** Independent external addresses in the best thirty days so far. */
  independent: number;
  /** External addresses with real activity, whatever their group. */
  external: number;
  /** Addresses whose independence could not be read, so they did not count. */
  unknown: number;
  volumeUsdMicros: bigint;
  /** The team's trades: in the volume, marked, never a reason for money. */
  teamVolumeUsdMicros: bigint;
  /** The creator's, the partner's and their cluster's trades. */
  insiderVolumeUsdMicros: bigint;
  /** Round trips (S6): never volume, shown apart. */
  roundTripVolumeUsdMicros: bigint;
  /** Activated only thanks to wallets whose history is too long to trace to its funding: a person looks first. */
  reliesOnDeep: boolean;
  /** The transactions of the creator's, the partner's and their cluster's round trips — S6's evidence of their own. */
  insiderRoundTripTxs: readonly string[];
  unvaluedTrades: number;
  /**
   * Sources two or more of the active external addresses share — each joins them into one; the reviewer decides
   * whether one is an exchange or a bridge (`markHub`). By hash, most wallets first.
   */
  sharedSources: readonly Readonly<{ hash: string; wallets: number }>[];
  traders: readonly TraderView[];
}>;

export type ActivationInput = Readonly<{
  launchedAt: string;
  now: string;
  creator: PartyWallets;
  partner: PartyWallets | null;
  /** The team's wallets, `walletKey` spelling. */
  team: ReadonlySet<string>;
  trades: readonly PoolTrade[];
  hash: (wallet: string) => string;
  graph: FundingGraph;
  hubs: ReadonlySet<string>;
  /** Hashes of wallets the parties paid around the launch, however they were first funded — theirs. */
  insiderCounterparties?: ReadonlySet<string>;
}>;

/** The trades that are halves of a round trip: a buy and a sell back by the same wallet within a day, for about nothing. */
export function roundTripTrades(trades: readonly PoolTrade[]): Set<string> {
  const out = new Set<string>();
  const windowMs = PROTECT_RULES.roundTrip.windowHours * HOUR_MS;
  const byWallet = new Map<string, PoolTrade[]>();
  for (const trade of trades) byWallet.set(walletKey(trade.wallet), [...(byWallet.get(walletKey(trade.wallet)) ?? []), trade]);
  for (const list of byWallet.values()) {
    const sorted = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.tx.localeCompare(b.tx));
    for (const sell of sorted) {
      if (sell.side !== "sell" || sell.usdMicros === null || out.has(sell.tx)) continue;
      const sellMs = Date.parse(sell.at);
      const buy = sorted.find((candidate) => {
        if (candidate.side !== "buy" || candidate.usdMicros === null || out.has(candidate.tx)) return false;
        const ms = Date.parse(candidate.at);
        if (ms > sellMs || sellMs - ms > windowMs) return false;
        const diff = sell.usdMicros! - candidate.usdMicros;
        const spread = diff < 0n ? -diff : diff;
        return spread * 10_000n <= candidate.usdMicros * BigInt(PROTECT_RULES.roundTrip.toleranceBps);
      });
      if (!buy) continue;
      out.add(buy.tx);
      out.add(sell.tx);
    }
  }
  return out;
}

/** Is a wallet young at a moment: first seen less than a week before, and its whole life within two days? */
export function isYoung(node: FundingNode | undefined, at: string): boolean {
  if (!node || !node.firstAt || !node.lastAt || node.state === "DEEP") return false;
  const first = Date.parse(node.firstAt);
  const last = Date.parse(node.lastAt);
  return Date.parse(at) - first < PROTECT_RULES.youngWallet.firstOpDays * DAY_MS && last - first <= PROTECT_RULES.youngWallet.burstHours * HOUR_MS;
}

/**
 * Whether a launch's creator is activated, from the pool's trades and the funding graph.
 *
 * Read only what is given: trades nobody read are not activity, a wallet whose
 * funding nobody read is not independent. A lower bound, never a guess.
 */
export function activationOf(input: ActivationInput): ActivationRead {
  const rules = PROTECT_RULES.activation;
  const launched = Date.parse(input.launchedAt);
  const nowMs = Date.parse(input.now);
  const parties = [input.creator, ...(input.partner ? [input.partner] : [])];
  const insiderKeys = new Set(parties.flatMap((party) => [party.wallet, ...party.linked]).map(walletKey));
  /* The funding graph is Solana's: an EVM wallet linked to a party funds no Solana wallet here. */
  const insiders = parties.map((party) =>
    partyAncestry([party.wallet, ...party.linked].filter((wallet) => !/^0x/i.test(wallet)).map(input.hash), input.graph, input.hubs),
  );
  const roundTrips = roundTripTrades(input.trades);

  const byWallet = new Map<string, PoolTrade[]>();
  for (const trade of input.trades) {
    const ms = Date.parse(trade.at);
    if (!Number.isFinite(ms) || ms < launched || ms > nowMs) continue;
    byWallet.set(walletKey(trade.wallet), [...(byWallet.get(walletKey(trade.wallet)) ?? []), trade]);
  }

  let volume = 0n;
  let teamVolume = 0n;
  let insiderVolume = 0n;
  let tripVolume = 0n;
  let unvalued = 0;
  const qualifies = (trade: PoolTrade) => !roundTrips.has(trade.tx) && trade.usdMicros !== null && trade.usdMicros >= rules.minTradeUsdMicros;
  const traders: Array<TraderView & { wallet: string; ancestry: PartyAncestry; deep: boolean }> = [];
  for (const [wallet, trades] of byWallet) {
    const hash = input.hash(wallet);
    const own = ancestryOf(hash, input.graph, input.hubs);
    const ancestry = partyAncestry([hash], input.graph, input.hubs);
    const qualifying = trades.filter(qualifies).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    /* A wallet with a history too long to read is independent only if that history reaches well before its trade. */
    const oldEnough = !own.deep || (own.since !== null && qualifying.length > 0 && Date.parse(own.since) <= Date.parse(qualifying[0]!.at) - PROTECT_RULES.funding.deepAgeDays * DAY_MS);
    let kind: TraderKind;
    if (input.team.has(wallet)) kind = "TEAM";
    else if (insiderKeys.has(wallet)) kind = "INSIDER";
    else if (insiders.some((insider) => fundingLink(ancestry, insider) !== null) || input.insiderCounterparties?.has(hash)) kind = "INSIDER";
    /* A trader with no history read did trade: the node has not caught up, so its independence is not known. */
    else if (!ancestry.complete || own.empty || insiders.some((insider) => !insider.complete) || !oldEnough) kind = "UNKNOWN";
    else kind = "EXTERNAL";
    let sum = 0n;
    let trips = 0;
    for (const trade of trades) {
      if (trade.usdMicros === null) {
        unvalued += 1;
        continue;
      }
      if (roundTrips.has(trade.tx)) {
        trips += 1;
        tripVolume += trade.usdMicros;
        continue;
      }
      sum += trade.usdMicros;
    }
    volume += sum;
    if (kind === "TEAM") teamVolume += sum;
    if (kind === "INSIDER") insiderVolume += sum;
    const young = trades.some((trade) => isYoung(input.graph.get(hash), trade.at));
    traders.push({ wallet, hash, kind, group: null, volumeUsdMicros: sum, roundTrips: trips, qualifying: qualifying.length, young, ancestry, deep: own.deep });
  }

  /* Independent groups: external addresses sharing a funding source, or funding one another, are one. */
  const externals = traders.filter((trader) => trader.kind === "EXTERNAL" && trader.qualifying > 0);
  const parent = new Map<string, string>(externals.map((trader) => [trader.hash, trader.hash]));
  const find = (hash: string): string => {
    let root = hash;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(hash, root);
    return root;
  };
  for (let i = 0; i < externals.length; i += 1) {
    for (let j = i + 1; j < externals.length; j += 1) {
      const a = externals[i]!;
      const b = externals[j]!;
      if (fundingLink(a.ancestry, b.ancestry) === null) continue;
      const ra = find(a.hash);
      const rb = find(b.hash);
      if (ra !== rb) parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra);
    }
  }
  const groupOf = new Map(externals.map((trader) => [trader.hash, find(trader.hash)]));
  const sources = new Map<string, number>();
  for (const trader of externals) for (const hash of trader.ancestry.ancestors) sources.set(hash, (sources.get(hash) ?? 0) + 1);

  /* The first moment three independent groups traded for real within thirty days — with every counted address, and
     with the traceable ones alone: activation that needs the untraceable is a person's to confirm. */
  const sweep = (counted: typeof externals) => {
    const events = counted
      .flatMap((trader) => (byWallet.get(trader.wallet) ?? []).filter(qualifies).map((trade) => ({ ms: Date.parse(trade.at), at: trade.at, group: groupOf.get(trader.hash)! })))
      .sort((a, b) => a.ms - b.ms);
    const windowMs = rules.windowDays * DAY_MS;
    let best = 0;
    let first: string | null = null;
    for (let end = 0; end < events.length; end += 1) {
      const last = events[end]!;
      const groups = new Set(events.filter((event, index) => index <= end && last.ms - event.ms < windowMs).map((event) => event.group));
      best = Math.max(best, groups.size);
      if (first === null && groups.size >= rules.independentAddresses) first = last.at;
    }
    return { best, first };
  };
  const { best, first: at } = sweep(externals);
  const traceable = sweep(externals.filter((trader) => !trader.deep)).first;

  return {
    activated: at !== null,
    at,
    independent: best,
    external: externals.length,
    unknown: traders.filter((trader) => trader.kind === "UNKNOWN" && trader.qualifying > 0).length,
    volumeUsdMicros: volume,
    teamVolumeUsdMicros: teamVolume,
    insiderVolumeUsdMicros: insiderVolume,
    roundTripVolumeUsdMicros: tripVolume,
    reliesOnDeep: at !== null && traceable === null,
    insiderRoundTripTxs: [...roundTrips]
      .filter((tx) => input.trades.some((trade) => trade.tx === tx && traders.some((trader) => trader.kind === "INSIDER" && trader.wallet === walletKey(trade.wallet))))
      .sort(),
    unvaluedTrades: unvalued,
    sharedSources: [...sources]
      .filter(([, wallets]) => wallets >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([hash, wallets]) => ({ hash, wallets })),
    traders: traders.map(({ wallet: _wallet, ancestry: _ancestry, deep: _deep, ...view }) => ({ ...view, group: groupOf.get(view.hash) ?? null })),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Signals S1–S6 and the case rule S10
 * --------------------------------------------------------------------------------------------- */

export const SIGNAL_CODES = [
  /** S1 — the creator and the partner share a funding source within two steps (not an exchange, not a bridge). */
  "S1_SHARED_FUNDING",
  /** S2 — money between the creator and the partner: one funded the other, or a transfer around the launch. */
  "S2_DIRECT_FUNDS",
  /** S3 — both sent money to the same address (an exchange deposit is one person's). */
  "S3_SHARED_WITHDRAWAL",
  /** S4 — the creator and the partner were seen on one device or one IP /24. */
  "S4_SHARED_DEVICE",
  /** S4 — the partner's device carries three wallets or more. */
  "S4_DEVICE_CROWD",
  /** S5 — most of the addresses that activated the creator are a few days old and lived within two days. */
  "S5_YOUNG_WALLETS",
  /** S6 — round trips on the pool by the creator, the partner or their cluster, or by as many as made it active. */
  "S6_ROUND_TRIP",
  /**
   * The automatic check could not see everything it needs: the two parties' funding or transfers were not read whole
   * (a long history, a failed read, an EVM wallet), or the creator counts as activated only thanks to wallets whose
   * funding is too old to trace. Not a sign of anything — a person looks before the money moves.
   */
  "UNVERIFIED",
] as const;
export type SignalCode = (typeof SIGNAL_CODES)[number];

/** S1–S4 ask for a check (a hard signal), S5 and S6 lower trust (a soft one). */
export const SIGNAL_STRENGTH: Readonly<Record<SignalCode, "hard" | "soft">> = {
  S1_SHARED_FUNDING: "hard",
  S2_DIRECT_FUNDS: "hard",
  S3_SHARED_WITHDRAWAL: "hard",
  S4_SHARED_DEVICE: "hard",
  S4_DEVICE_CROWD: "hard",
  S5_YOUNG_WALLETS: "soft",
  S6_ROUND_TRIP: "soft",
  UNVERIFIED: "hard",
};

export type Signal = Readonly<{
  code: SignalCode;
  /** The hashes that show it — kept for the retention period, never the values. */
  evidence: readonly string[];
}>;

/** A transfer a party made or received, by the counterparty's hash; `ref` — the transfer's own hash (who and when). */
export type PartyTransfer = Readonly<{ counterparty: string; direction: "in" | "out"; at: string; ref: string }>;

export type PartyFacts = Readonly<{
  /** The party's own wallet's hash. */
  hash: string;
  /** The party's wallets — its own and those linked to it — and their funding trails. */
  ancestry: PartyAncestry;
  /** Transfers the chain shows; null — not read. */
  transfers: readonly PartyTransfer[] | null;
  /** Device and IP hashes seen with the wallet. */
  devices: readonly string[];
}>;

export type PoolSignalInput = Readonly<{
  launchedAt: string;
  now: string;
  creator: PartyFacts;
  partner: PartyFacts;
  /** The partner's devices: how many wallets each carries, and which. */
  partnerDeviceCrowds: readonly Readonly<{ hash: string; wallets: number; members: readonly string[] }>[];
  activation: ActivationRead;
  hubs: ReadonlySet<string>;
}>;

/** Signals of one partner's pool — every one found, each once. */
export function poolSignals(input: PoolSignalInput): Signal[] {
  const out: Signal[] = [];
  const { creator, partner } = input;
  const link = fundingLink(creator.ancestry, partner.ancestry);
  if (link === "SHARED") out.push({ code: "S1_SHARED_FUNDING", evidence: creator.ancestry.ancestors.filter((hash) => partner.ancestry.ancestors.includes(hash)) });

  const from = Date.parse(input.launchedAt) - PROTECT_RULES.funding.directDays * DAY_MS;
  const until = Date.parse(input.now);
  const between = [
    ...(creator.transfers ?? []).filter((transfer) => partner.ancestry.hashes.includes(transfer.counterparty)),
    ...(partner.transfers ?? []).filter((transfer) => creator.ancestry.hashes.includes(transfer.counterparty)),
  ].filter((transfer) => {
    const ms = Date.parse(transfer.at);
    return ms >= from && ms <= until;
  });
  /* Evidence: each transfer between them, and the party that funded the other — a new transfer is new evidence. */
  const funders = link === "DIRECT" ? [...creator.ancestry.chain.filter((hash) => partner.ancestry.hashes.includes(hash)), ...partner.ancestry.chain.filter((hash) => creator.ancestry.hashes.includes(hash))] : [];
  if (link === "DIRECT" || between.length) out.push({ code: "S2_DIRECT_FUNDS", evidence: [...new Set([...funders, ...between.map((transfer) => transfer.ref)])].sort() });

  if (creator.transfers && partner.transfers) {
    const parties = new Set([...creator.ancestry.hashes, ...partner.ancestry.hashes]);
    const outs = (transfers: readonly PartyTransfer[]) =>
      new Set(transfers.filter((transfer) => transfer.direction === "out" && !parties.has(transfer.counterparty) && !input.hubs.has(transfer.counterparty)).map((transfer) => transfer.counterparty));
    const creatorOuts = outs(creator.transfers);
    const shared = [...outs(partner.transfers)].filter((hash) => creatorOuts.has(hash));
    if (shared.length) out.push({ code: "S3_SHARED_WITHDRAWAL", evidence: shared.sort() });
  }

  const devices = creator.devices.filter((hash) => partner.devices.includes(hash));
  if (devices.length) out.push({ code: "S4_SHARED_DEVICE", evidence: [...new Set(devices)].sort() });
  /* Evidence: the steps the device's crowd has reached — a crowd growing past the next step is new evidence; strangers
     coming and going on a shared network are not, and a crowd that shrinks keeps the steps it reached. Values that are
     not hashes yet are hashed by the caller. */
  const crowds = input.partnerDeviceCrowds.filter((crowd) => crowd.wallets >= PROTECT_RULES.device.crowd);
  if (crowds.length) out.push({ code: "S4_DEVICE_CROWD", evidence: [...new Set(crowds.flatMap((crowd) => PROTECT_RULES.device.steps.filter((step) => crowd.wallets >= step).map((step) => `crowd:${crowd.hash}:${step}`)))].sort() });

  const counted = input.activation.traders.filter((trader) => trader.kind === "EXTERNAL" && trader.qualifying > 0);
  const young = counted.filter((trader) => trader.young);
  /* Evidence: the steps the count of young wallets reached — on a fresh launch most buyers are new, so each new one is
     no new evidence; a count past the next step is. */
  if (counted.length && young.length * 2 > counted.length && young.length >= 2) {
    out.push({ code: "S5_YOUNG_WALLETS", evidence: PROTECT_RULES.youngSteps.filter((step) => young.length >= step).map((step) => `young:${step}`) });
  }

  const insiderTrips = input.activation.traders.some((trader) => trader.kind === "INSIDER" && trader.roundTrips > 0);
  const externalTrips = input.activation.traders.filter((trader) => trader.kind === "EXTERNAL" && trader.roundTrips > 0).length;
  if (insiderTrips || (externalTrips > 0 && externalTrips >= Math.max(1, input.activation.independent))) {
    /* Evidence: each round trip of the parties' own (its transactions), and the steps others' round trips reached — a
       new one of theirs is new; a stranger's sandwich past the last step is not. */
    const steps = PROTECT_RULES.roundTripSteps.filter((step) => externalTrips >= step).map((step) => `trips:${step}`);
    out.push({ code: "S6_ROUND_TRIP", evidence: [...input.activation.insiderRoundTripTxs.map((tx) => `trip:${tx}`), ...steps].sort() });
  }
  return out;
}

/** S10: a case opens on one hard signal or two soft ones. */
export function needsReview(codes: readonly SignalCode[]): boolean {
  const unique = [...new Set(codes)];
  const hard = unique.filter((code) => SIGNAL_STRENGTH[code] === "hard").length;
  const soft = unique.length - hard;
  return hard >= 1 || soft >= 2;
}

/** The trust score the reviewer sees: 100, less 40 for each hard signal and 15 for each soft one. */
export function trustScore(codes: readonly SignalCode[]): number {
  const unique = [...new Set(codes)];
  const hard = unique.filter((code) => SIGNAL_STRENGTH[code] === "hard").length;
  return Math.max(0, 100 - 40 * hard - 15 * (unique.length - hard));
}

/* ------------------------------------------------------------------------------------------------
 * Fixed money: S7 hold, S8 limits, S9 waiting
 * --------------------------------------------------------------------------------------------- */

export const FIXED_KINDS = ["TASK", "BONUS", "FRIEND"] as const;
export type FixedKind = (typeof FIXED_KINDS)[number];

/**
 * S7: was the asset behind a fixed reward held long enough? `MET` — held the whole time; `WAITING` — not yet;
 * `BROKEN` — released before, so the reward is cancelled.
 */
export function holdState(kind: FixedKind, heldFrom: string, releasedAt: string | null, now: string): "MET" | "WAITING" | "BROKEN" {
  const due = Date.parse(heldFrom) + PROTECT_RULES.fixed.holdHours[kind] * HOUR_MS;
  if (releasedAt !== null && Date.parse(releasedAt) < due) return "BROKEN";
  return Date.parse(now) >= due ? "MET" : "WAITING";
}

/** S9: when a fixed reward earned at `at` stops waiting and becomes available. */
export function availableFrom(kind: FixedKind, at: string): string {
  return new Date(Date.parse(at) + PROTECT_RULES.fixed.pendingDays[kind] * DAY_MS).toISOString();
}

export type FixedRequest = Readonly<{ id: string; wallet: string; kind: FixedKind; usdMicros: bigint; at: string }>;

/** S8: the limits the programme sets — none is a limit of nothing, never "unlimited by mistake": a missing figure grants nothing. */
export type FixedLimits = Readonly<{
  /** Per wallet, per calendar month (UTC), per kind: how many and how much. */
  perWalletMonth: Readonly<Partial<Record<FixedKind, Readonly<{ count: number; usdMicros: bigint }>>>>;
  /** What the programme may still spend. */
  budgetUsdMicros: bigint;
}>;

/**
 * S8: trim fixed rewards to the limits, oldest first: a request over a wallet's month or over the budget is cut to
 * what is left, or to nothing. `granted` and `trimmed` add up to what was asked.
 */
export function trimToLimits(
  requests: readonly FixedRequest[],
  limits: FixedLimits,
  already: readonly FixedRequest[] = [],
): Readonly<{ granted: readonly Readonly<{ id: string; usdMicros: bigint }>[]; trimmed: readonly Readonly<{ id: string; usdMicros: bigint; reason: "KIND_UNLIMITED" | "MONTH_COUNT" | "MONTH_AMOUNT" | "BUDGET" }>[] }> {
  const month = (at: string) => at.slice(0, 7);
  const used = new Map<string, { count: number; usd: bigint }>();
  const mark = (request: FixedRequest, usd: bigint) => {
    const key = `${request.wallet}:${request.kind}:${month(request.at)}`;
    const held = used.get(key) ?? { count: 0, usd: 0n };
    used.set(key, { count: held.count + 1, usd: held.usd + usd });
  };
  for (const request of already) mark(request, request.usdMicros);
  let budget = limits.budgetUsdMicros;
  const granted: Array<{ id: string; usdMicros: bigint }> = [];
  const trimmed: Array<{ id: string; usdMicros: bigint; reason: "KIND_UNLIMITED" | "MONTH_COUNT" | "MONTH_AMOUNT" | "BUDGET" }> = [];
  for (const request of [...requests].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))) {
    const limit = limits.perWalletMonth[request.kind];
    if (!limit) {
      trimmed.push({ id: request.id, usdMicros: request.usdMicros, reason: "KIND_UNLIMITED" });
      continue;
    }
    const held = used.get(`${request.wallet}:${request.kind}:${month(request.at)}`) ?? { count: 0, usd: 0n };
    if (held.count >= limit.count) {
      trimmed.push({ id: request.id, usdMicros: request.usdMicros, reason: "MONTH_COUNT" });
      continue;
    }
    let amount = request.usdMicros;
    let reason: "MONTH_AMOUNT" | "BUDGET" | null = null;
    const monthRoom = limit.usdMicros - held.usd;
    if (amount > monthRoom) [amount, reason] = [monthRoom > 0n ? monthRoom : 0n, "MONTH_AMOUNT"];
    if (amount > budget) [amount, reason] = [budget > 0n ? budget : 0n, "BUDGET"];
    if (amount > 0n) {
      granted.push({ id: request.id, usdMicros: amount });
      budget -= amount;
      mark(request, amount);
    }
    if (reason) trimmed.push({ id: request.id, usdMicros: request.usdMicros - amount, reason });
  }
  return { granted, trimmed };
}
