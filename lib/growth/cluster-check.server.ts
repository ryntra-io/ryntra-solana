import type { ClusterVerdict, WalletClusters } from "../city-economy/honest-count.ts";
import type { GuardStore } from "../guard/store.ts";
import { type ClusterEvidence, clusterVerdict } from "./cluster-check.ts";
import type { FundingRead, TransferRead } from "./protect-chain.server.ts";
import { DAY_MS, type FundingNode, type PartyAncestry, partyAncestry, PROTECT_RULES, signalHash } from "./protect.ts";
import { readDevices, readFundingNodes, readHubs, writeFundingNode } from "./review-store.ts";
import { everLinked } from "./wallet-link-store.ts";

/**
 * The Growth line's answer to the city's `WalletClusters` port: evidence gathered from what the protection run
 * already keeps, topped up from the chain where the store is silent.
 *
 * No second system is started. The funding nodes read here are written back into the collection the protection run
 * uses, hashed the same way, with the same retention; device signals, hubs and wallet links are read and never
 * written. The city receives a verdict and a rules version — never a hash, an address or a device.
 *
 * ## What it costs
 *
 * The funding trail is walked on the chain, because a stored node keeps hashes and a hash cannot be asked about: at
 * most `PROTECT_RULES.funding.hops` reads a wallet, plus one history read for money between the two and the
 * addresses each paid out to. Both are remembered per wallet for the day inside one adapter, so a city run that asks
 * about the same wallet a hundred times reads it once. A read that fails is not evidence of anything: the field
 * stays `null`, the verdict is `unknown`, and the next day's ask reads again.
 */

export type ClusterDeps = Readonly<{
  store: GuardStore;
  /** The key the protection run hashes signals with (`signalKeyFrom`). */
  key: Uint8Array;
  /** The chain readers of `protect-chain.server.ts`, already bound to an RPC. */
  funding: (wallet: string) => Promise<FundingRead>;
  transfers: (wallet: string, since: string) => Promise<TransferRead | null>;
}>;

/** One wallet as the evidence needs it, read once a day. */
type Side = Readonly<{
  /** The wallet and every address it has signed for — an EVM address among them — hashed. */
  party: readonly string[];
  /** Only the Solana wallets of the party, hashed: the funding graph is a Solana graph. */
  onChain: readonly string[];
  /** Hashed addresses the wallet paid out to; null — its history could not be read. */
  withdrawals: readonly string[] | null;
  /** Hashed counterparties in either direction; null — its history could not be read. */
  counterparties: readonly string[] | null;
  /** Hashed device and address signals of the wallet. */
  devices: readonly string[];
  /** The links were read: a party set can be trusted to be whole. */
  linkedRead: boolean;
}>;

const dayOf = (at: string) => at.slice(0, 10);

export function walletClusters(deps: ClusterDeps): WalletClusters {
  const hash = (value: string) => signalHash(deps.key, "address", value);
  const sides = new Map<string, Promise<Side>>();
  const graph = new Map<string, FundingNode>();

  /**
   * Walk a wallet's funders, at most `hops` steps: what this run already holds, then what the protection run stored,
   * and only then the chain. A stored node keeps its funder as a hash, so the walk can go on through the store but
   * not on to the chain from there — and a step that cannot be read leaves the trail incomplete, which is an
   * «unknown», never a «separate».
   */
  const walk = async (wallet: string, now: string): Promise<void> => {
    /* The raw address of the step we are on, while it is known: only a chain read hands back the next one. */
    let address: string | null = wallet;
    let key = hash(wallet);
    for (let step = 0; step < PROTECT_RULES.funding.hops; step += 1) {
      let node = graph.get(key);
      if (!node) {
        const stored = await readFundingNodes(deps.store, [key], now).catch(() => new Map<string, FundingNode>());
        const kept = stored.get(key);
        if (kept) {
          graph.set(key, kept);
          node = kept;
          address = null;
        }
      }
      if (!node) {
        if (address === null) return;
        const fresh: FundingRead = await deps.funding(address).catch((): FundingRead => ({ state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null }));
        if (fresh.state === "UNAVAILABLE") return;
        node = { state: fresh.state, funder: fresh.funder ? hash(fresh.funder) : null, firstAt: fresh.firstAt, lastAt: fresh.lastAt };
        graph.set(key, node);
        await writeFundingNode(deps.store, key, node, now).catch(() => undefined);
        address = fresh.funder;
      }
      if (!node.funder) return;
      key = node.funder;
    }
  };

  const read = async (wallet: string, now: string): Promise<Side> => {
    const links = await everLinked(deps.store, "solana", wallet).catch(() => null);
    const linked = links && !links.unavailable ? links.linked : [];
    const since = new Date(Date.parse(now) - PROTECT_RULES.funding.directDays * DAY_MS).toISOString();
    const history = await deps.transfers(wallet, since).catch(() => null);
    const devices = await readDevices(deps.store, wallet, now).catch(() => null);
    /* The funding graph is Solana's: an EVM address a person linked has no funder in it, and asking for one would
       leave every trail incomplete for ever. It still counts as the same party. */
    await walk(wallet, now);
    return {
      party: [...new Set([wallet, ...linked])].map(hash),
      onChain: [hash(wallet)],
      withdrawals: history ? [...new Set(history.items.filter((item) => item.direction === "out").map((item) => hash(item.counterparty)))] : null,
      counterparties: history ? [...new Set(history.items.map((item) => hash(item.counterparty)))] : null,
      devices: devices?.hashes ?? [],
      linkedRead: links !== null && !links.unavailable,
    };
  };

  /**
   * A history too long to read hides where a wallet started — but the rules already say how long is long enough:
   * `PROTECT_RULES.funding.deepAgeDays`. A wallet read back that far stands on its own, and the trail stops hiding
   * it. Without this a heavy trader — exactly who the city scores — could never be told apart from anyone.
   */
  const aged = (ancestry: PartyAncestry, at: string): PartyAncestry => {
    if (!ancestry.deep) return ancestry;
    const enough = Date.parse(at) - PROTECT_RULES.funding.deepAgeDays * DAY_MS;
    const reaches = (key: string) => {
      const node = graph.get(key);
      if (!node) return false;
      if (node.state !== "DEEP") return node.state === "FOUND";
      return node.firstAt !== null && Date.parse(node.firstAt) <= enough;
    };
    return ancestry.hashes.every(reaches) ? { ...ancestry, deep: false } : ancestry;
  };

  const sideOf = (wallet: string, at: string): Promise<Side> => {
    const key = `${dayOf(at)}:${wallet}`;
    const known = sides.get(key);
    if (known) return known;
    const pending = read(wallet, at);
    sides.set(key, pending);
    return pending;
  };

  return {
    async check(a: string, b: string, at: string): Promise<ClusterVerdict> {
      /* The city settles an identical pair itself; answering it here as well costs nothing and cannot be wrong. */
      if (a === b) return { verdict: "same", reason: "linked_wallet", rules: PROTECT_RULES.version };

      const [left, right] = await Promise.all([sideOf(a, at), sideOf(b, at)]);
      const hubs = await readHubs(deps.store).catch(() => new Set<string>());

      const funding = { left: aged(partyAncestry(left.onChain, graph, hubs), at), right: aged(partyAncestry(right.onChain, graph, hubs), at) };
      const between =
        left.counterparties === null || right.counterparties === null
          ? null
          : left.counterparties.some((value) => right.party.includes(value)) || right.counterparties.some((value) => left.party.includes(value));

      const evidence: ClusterEvidence = {
        funding,
        moneyBetween: between,
        withdrawals: left.withdrawals && right.withdrawals ? { left: left.withdrawals, right: right.withdrawals } : null,
        devices: { left: left.devices, right: right.devices },
        linked: left.linkedRead && right.linkedRead ? { left: left.party, right: right.party } : null,
      };
      return clusterVerdict(evidence);
    },
  };
}
