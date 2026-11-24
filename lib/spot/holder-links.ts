/**
 * The links between a coin's largest holders: which of them got the coin from one wallet, got SOL from one
 * wallet, or moved the coin between themselves — and the groups those links make, with each group's share of the supply.
 *
 * Pure and client-safe. `holder-links.server.ts` reads each holder's own moves of the coin (Helius's scan, through
 * `creator-chain.ts`) behind the deployment's closed switch and calls this.
 *
 * Only what the chain shows is a link, and only a link of these kinds:
 *
 * - **coin** — the coin came to two or more holders by plain transfer (nothing moved back) from one outside wallet;
 * - **sol** — one outside wallet sent SOL to two or more holders inside their own transactions of the coin; or the
 *   creator, or another of the largest holders, paid the fee of a holder's transaction of the coin;
 * - **between** — the coin, or SOL in a transaction of the coin, went from one of the largest holders to another.
 *
 * A wallet that is no person's key (a pool, a curve, a vault — off the curve) is never a link: every buyer meets the
 * pool. A fee paid by anyone else is not one either — a wallet app's relayer pays for thousands of strangers. Nothing
 * here says who a wallet is or that a group is one person: a group is wallets the chain ties, and the page says that.
 */

import type { CoinMove } from "./creator-chain.ts";

export type LinkKind = "coin" | "sol" | "between";

export type LinkHolder = Readonly<{ owner: string; sharePct: number | null }>;

export type HolderNode = Readonly<{
  owner: string;
  sharePct: number | null;
  /** The group it stands in (1 — the largest group); null — no link to another of the largest holders. */
  group: number | null;
  /** It is the coin's creator. */
  creator: boolean;
}>;

/** An outside wallet that ties two or more of the largest holders: it sent them the coin or SOL. */
export type LinkSource = Readonly<{ wallet: string; kinds: readonly ("coin" | "sol")[]; holders: readonly string[]; creator: boolean }>;

/** A line of the map: between two holders, or from an outside source to a holder. */
export type HolderEdge = Readonly<{ from: string; to: string; kind: LinkKind }>;

export type HolderGroup = Readonly<{
  /** 1 — the group holding the most. */
  id: number;
  wallets: readonly string[];
  /** The members' shares added up, %; null — no supply counted. */
  sharePct: number | null;
  /** What ties them, as the chain shows it. */
  ties: readonly LinkKind[];
  /** The outside wallets they share, the one tying the most first. */
  sources: readonly string[];
  /** The creator is a member, or one of the wallets that tie them. */
  creator: boolean;
}>;

export type HolderLinks = Readonly<{
  nodes: readonly HolderNode[];
  sources: readonly LinkSource[];
  edges: readonly HolderEdge[];
  groups: readonly HolderGroup[];
}>;

/** One union of wallets, smallest index as the root. */
function unionFind(size: number): Readonly<{ find(i: number): number; join(a: number, b: number): void }> {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    let at = i;
    while (parent[at] !== root) {
      const next = parent[at]!;
      parent[at] = root;
      at = next;
    }
    return root;
  };
  return {
    find,
    join(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    },
  };
}

const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

/**
 * The links of the largest holders from their moves of the coin. `isWallet` — whether an address is a person's key (on
 * the curve); `skip` — owners never counted as a link (the coin's pools and programs); `creator` — the wallet Jupiter
 * names as the coin's creator.
 */
export function holderLinksOf(input: Readonly<{
  holders: readonly LinkHolder[];
  moves: ReadonlyMap<string, readonly CoinMove[]>;
  isWallet: (address: string) => boolean;
  skip?: ReadonlySet<string>;
  creator?: string | null;
}>): HolderLinks {
  const holders = input.holders;
  const index = new Map(holders.map((holder, i) => [holder.owner, i]));
  const creator = input.creator ?? null;
  const counts = (wallet: string | null): wallet is string => wallet !== null && !input.skip?.has(wallet) && input.isWallet(wallet);

  const between = new Map<string, HolderEdge>();
  const sources = new Map<string, { coin: Set<string>; sol: Set<string> }>();
  const sourceOf = (wallet: string) => {
    let held = sources.get(wallet);
    if (!held) sources.set(wallet, (held = { coin: new Set(), sol: new Set() }));
    return held;
  };
  const link = (a: string, b: string, kind: LinkKind) => {
    if (a === b) return;
    const key = pairKey(a, b);
    const was = between.get(key);
    /* A coin's transfer between them says more than SOL in passing: it is the line drawn. */
    if (!was || (was.kind === "sol" && kind === "between")) between.set(key, { from: a, to: b, kind });
  };

  for (const holder of holders) {
    const own = holder.owner;
    for (const move of input.moves.get(own) ?? []) {
      if (move.kind === "transfer" && counts(move.party) && move.party !== own) {
        if (index.has(move.party)) link(move.dir === "in" ? move.party : own, move.dir === "in" ? own : move.party, "between");
        else if (move.dir === "in") sourceOf(move.party).coin.add(own);
      }
      for (const from of move.solFrom) {
        if (!counts(from) || from === own) continue;
        if (index.has(from)) link(from, own, "sol");
        else sourceOf(from).sol.add(own);
      }
      /* Who paid the fee counts only where it is the creator or another of the largest holders: a relayer pays for strangers. */
      const payer = move.paidBy;
      if (payer && payer !== own && counts(payer)) {
        if (index.has(payer)) link(payer, own, "sol");
        else if (payer === creator) sourceOf(payer).sol.add(own);
      }
    }
  }

  const tying: LinkSource[] = [];
  for (const [wallet, held] of sources) {
    const all = new Set([...held.coin, ...held.sol]);
    if (all.size < 2 && wallet !== creator) continue;
    if (all.size < 1) continue;
    const kinds = [...(held.coin.size ? (["coin"] as const) : []), ...(held.sol.size ? (["sol"] as const) : [])];
    tying.push({ wallet, kinds, holders: holders.filter((holder) => all.has(holder.owner)).map((holder) => holder.owner), creator: wallet === creator });
  }
  tying.sort((a, b) => b.holders.length - a.holders.length || (a.wallet < b.wallet ? -1 : 1));

  const groups = unionFind(holders.length);
  for (const edge of between.values()) groups.join(index.get(edge.from)!, index.get(edge.to)!);
  for (const source of tying) {
    const members = source.holders.map((owner) => index.get(owner)!);
    for (let i = 1; i < members.length; i += 1) groups.join(members[0]!, members[i]!);
  }

  const byRoot = new Map<number, number[]>();
  holders.forEach((_, i) => {
    const root = groups.find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), i]);
  });
  const shareOf = (members: readonly number[]) => {
    let sum = 0;
    let known = false;
    for (const i of members) {
      const share = holders[i]!.sharePct;
      if (share !== null && Number.isFinite(share)) {
        sum += share;
        known = true;
      }
    }
    return known ? sum : null;
  };
  const drafts = [...byRoot.values()]
    .filter((members) => members.length >= 2)
    .map((members) => {
      const wallets = members.map((i) => holders[i]!.owner);
      const inside = new Set(wallets);
      const ties = new Set<LinkKind>();
      for (const edge of between.values()) if (inside.has(edge.from)) ties.add(edge.kind === "sol" ? "sol" : "between");
      const shared = tying.filter((source) => source.holders.filter((owner) => inside.has(owner)).length >= 2 || (source.creator && source.holders.some((owner) => inside.has(owner))));
      for (const source of shared) for (const kind of source.kinds) ties.add(kind);
      return {
        wallets,
        sharePct: shareOf(members),
        ties: (["coin", "sol", "between"] as const).filter((kind) => ties.has(kind)),
        sources: shared.map((source) => source.wallet),
        creator: (creator !== null && inside.has(creator)) || shared.some((source) => source.creator),
      };
    })
    .sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0) || b.wallets.length - a.wallets.length);
  const groupList: HolderGroup[] = drafts.map((draft, i) => ({ id: i + 1, ...draft }));
  const groupOf = new Map<string, number>();
  for (const group of groupList) for (const wallet of group.wallets) groupOf.set(wallet, group.id);

  const edges: HolderEdge[] = [...between.values()];
  for (const source of tying) {
    if (!source.holders.some((owner) => groupOf.has(owner)) && !source.creator) continue;
    for (const owner of source.holders) edges.push({ from: source.wallet, to: owner, kind: source.kinds.includes("coin") ? "coin" : "sol" });
  }
  return {
    nodes: holders.map((holder) => ({ owner: holder.owner, sharePct: holder.sharePct, group: groupOf.get(holder.owner) ?? null, creator: holder.owner === creator })),
    sources: tying.filter((source) => source.holders.some((owner) => groupOf.has(owner)) || source.creator),
    edges,
    groups: groupList,
  };
}

/* --------------------------------------------------------------- answer */

/** What the links tab reads. */
export type HolderLinksAnswer = Readonly<HolderLinks & {
  /** How many of the largest holders were checked, and of how many asked. */
  checked: number;
  of: number;
  /** The moves each holder's check reads reach back to the coin's birth for every holder checked. */
  whole: boolean;
  observedAt: string;
  stale: boolean;
}>;
