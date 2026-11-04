/**
 * Which wallets of a launch are one party — the Growth line's protection rules (`lib/growth/protect.ts`), read only,
 * applied to the launch's buyers. Nothing here reads the chain or a store: the funding graph is handed in, keyed the
 * way the caller keys it (the Growth line's hashes where its key is configured, the addresses otherwise), and every
 * wallet is named through `idOf`.
 *
 * Two wallets are one cluster when one paid for the other's buy, one funded the other, or both were funded by a source
 * no reviewer marked as a hub (`fundingLink`). The groups are closed under the links: a farm of a hundred wallets fed
 * from one source is one cluster. A cluster counts as one independent buyer only when at least one of its wallets has a
 * start that was read — a wallet nobody could trace is not known to be anyone apart, so it adds nothing (a floor).
 *
 * Server-side by its import of the Growth line's rules (they hash with `node:crypto`).
 */

import { DAY_MS, fundingLink, partyAncestry, type FundingGraph, type PartyAncestry } from "../../growth/protect.ts";
import { FLOW_RULES } from "./rules.ts";

/** How a buyer stands: one of the creator's party, a wallet of an independent cluster, or one whose start was not read. */
export type BuyerStanding = "creator" | "independent" | "unknown";

export type ClusterInput = Readonly<{
  /** The wallets to group: the buyers, the creator, the payers of their buys. */
  wallets: readonly string[];
  creator: string;
  /** Who paid for whose buy, where the payer is not the wallet the tokens went to: [payer, trader]. */
  paid: readonly (readonly [string, string])[];
  graph: FundingGraph;
  /** Sources a reviewer marked as shared by many (an exchange, a bridge), in the graph's keys. */
  hubs: ReadonlySet<string>;
  /** A wallet's key in the graph. */
  idOf: (wallet: string) => string;
  /** Unix seconds: how old a history too long to read must reach to stand alone. */
  now: number;
}>;

export type Clusters = Readonly<{
  /** Each wallet's cluster, named by one of its wallets; the creator's cluster is named by the creator. */
  clusterOf: (wallet: string) => string;
  /** Whether a wallet's start was read: its funding trail whole, or a long history that reaches far enough back. */
  traced: (wallet: string) => boolean;
  standing: (wallet: string) => BuyerStanding;
}>;

/** A long history that reaches `deepAgeDays` back is a life of its own: the wallet stands alone, as the Growth line counts it. */
function aged(ancestry: PartyAncestry, graph: FundingGraph, id: string, now: number): PartyAncestry {
  if (!ancestry.deep) return ancestry;
  const node = graph.get(id);
  if (node?.state !== "DEEP" || !node.firstAt) return ancestry;
  return Date.parse(node.firstAt) <= now * 1000 - FLOW_RULES.deepAgeDays * DAY_MS ? { ...ancestry, deep: false } : ancestry;
}

export function launchClusters(input: ClusterInput): Clusters {
  const wallets = [...new Set([input.creator, ...input.wallets, ...input.paid.flat()])];
  const parent = new Map<string, string>(wallets.map((wallet) => [wallet, wallet]));
  const find = (wallet: string): string => {
    let root = parent.get(wallet) ?? wallet;
    while (parent.get(root) !== root && parent.has(root)) root = parent.get(root)!;
    let step = wallet;
    while (step !== root && parent.has(step)) {
      const next = parent.get(step)!;
      parent.set(step, root);
      step = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    /* The creator's cluster is always named by the creator. */
    if (rb === input.creator) parent.set(ra, rb);
    else parent.set(rb, ra);
  };

  for (const [payer, trader] of input.paid) union(payer, trader);

  const ancestry = new Map<string, PartyAncestry>();
  for (const wallet of wallets) {
    const id = input.idOf(wallet);
    ancestry.set(wallet, aged(partyAncestry([id], input.graph, input.hubs), input.graph, id, input.now));
  }
  const traced = (wallet: string) => {
    const read = ancestry.get(wallet);
    return read !== undefined && read.complete && !read.deep && input.graph.has(input.idOf(wallet));
  };
  /* Only trails that were read link anyone; an empty trail links nobody and proves nothing apart. */
  const linkable = wallets.filter((wallet) => {
    const read = ancestry.get(wallet)!;
    return read.chain.length > 0 || traced(wallet);
  });
  for (let i = 0; i < linkable.length; i += 1) {
    for (let j = i + 1; j < linkable.length; j += 1) {
      const a = linkable[i]!;
      const b = linkable[j]!;
      if (find(a) === find(b)) continue;
      if (fundingLink(ancestry.get(a)!, ancestry.get(b)!)) union(a, b);
    }
  }

  /* A cluster stands apart when one of its wallets was traced; the creator's is the creator's whatever was read. */
  const tracedRoots = new Set(wallets.filter(traced).map(find));
  const creatorRoot = () => find(input.creator);
  return {
    clusterOf: (wallet) => (parent.has(wallet) ? find(wallet) : wallet),
    traced,
    standing: (wallet) => {
      const root = parent.has(wallet) ? find(wallet) : wallet;
      if (root === creatorRoot()) return "creator";
      return tracedRoots.has(root) ? "independent" : "unknown";
    },
  };
}

/** The independent buyers among `wallets`: each traced cluster once, the creator's party and the untraced never. */
export function independentCount(wallets: Iterable<string>, clusters: Clusters): number {
  const roots = new Set<string>();
  for (const wallet of wallets) if (clusters.standing(wallet) === "independent") roots.add(clusters.clusterOf(wallet));
  return roots.size;
}
