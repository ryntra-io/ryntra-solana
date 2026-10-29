import type { GuardStore } from "../guard/store.ts";
import { REWARD_PAR_MINTS } from "../rewards/model.ts";
import { countedConfigsOf, poolKey } from "./network.ts";
import { readPartnerBindings } from "./network-store.ts";
import { familyOf, type PoolPartner, walletKey } from "./partner.ts";
import { identityOf, type PartnerDeps } from "./partner-store.ts";
import { launchConfigPlans, type RegistryRowLike } from "./pool-share.ts";
import type { FundingRead, TransferRead } from "./protect-chain.server.ts";
import {
  activationOf,
  ancestryOf,
  DAY_MS,
  type FundingNode,
  needsReview,
  partyAncestry,
  type PartyAncestry,
  type PartyFacts,
  type PartyTransfer,
  type PoolTrade,
  poolSignals,
  PROTECT_RULES,
  type SignalCode,
  SIGNAL_HASH,
  signalHash,
} from "./protect.ts";
import { poolSubject } from "./review.ts";
import {
  type ActivationRecord,
  activationKey,
  noteHubViewed,
  readActivation,
  readActivations,
  readDevices,
  readEvidence,
  readFundingNodes,
  readHubs,
  readSubjectEvents,
  raiseSignals,
  recordEvidence,
  touchActivation,
  writeActivation,
  writeFundingNode,
} from "./review-store.ts";

/**
 * The protection run of the Ryntra Network: for every partner's pool, whether
 * its creator is activated and which signals it shows — the activation written
 * once, the signals raised into the review queue. It never touches the shadow
 * ledger's entries: the ledger reads the queue and the activation.
 *
 * The chain reads are passed in (`ProtectDeps`), bounded per run, and every
 * address is hashed before it is kept. A read that did not answer is not
 * evidence of anything: the pool stays as it was and the next run reads again.
 */

export type ProtectDeps = PartnerDeps &
  Readonly<{
    /** The key of the signal hashes (`signalKeyFrom`). */
    key: Uint8Array;
    funding: (wallet: string) => Promise<FundingRead>;
    transfers: (wallet: string, since: string) => Promise<TransferRead | null>;
    /** A Solana launch curve's trades since a moment; null — the read failed. */
    curveTrades: (curve: string, since: string) => Promise<Readonly<{ trades: PoolTrade[]; complete: boolean }> | null>;
  }>;

export type ProtectPoolReport = Readonly<{
  network: PoolPartner["network"];
  pool: string;
  partner: string;
  /**
   * `CHECKED` — activation and signals read; `NOT_COUNTED` — the demo market; `BLOCKED` — the binding itself already
   * says the partner may not earn; `NO_DATA` — the team's list could not be read.
   */
  state: "CHECKED" | "NOT_COUNTED" | "BLOCKED" | "NO_DATA";
  activated: boolean;
  independent: number;
  signals: readonly SignalCode[];
  /** What the queue got: a new case, more signals on one, or nothing new. */
  review: "OPENED" | "SIGNALS" | "UNCHANGED" | "NONE" | "UNAVAILABLE";
  /** Reads that did not complete this run — the next run tries again. */
  incomplete: readonly ("trades" | "funding" | "transfers" | "budget" | "error")[];
}>;

export type ProtectRunReport = Readonly<{ at: string; pools: readonly ProtectPoolReport[]; chainRequests: number }>;

/** The registry's own addresses: Ryntra's wallets, claimers and payers — the team, beside the internal list. */
export function registryWallets(registry: readonly RegistryRowLike[]): Set<string> {
  return new Set(registry.flatMap((row) => (row.address ? [walletKey(row.address)] : [])));
}

type LaunchTradeRow = Readonly<{
  cluster?: string;
  signature?: string;
  wallet?: string;
  side?: "buy" | "sell";
  curve?: string;
  pool?: string | null;
  state?: string;
  settledAt?: string | null;
  pair?: Readonly<{ mint?: string; decimals?: number; dollar?: boolean }>;
  quote?: Readonly<{ amountInRaw?: string; amountOutRaw?: string }>;
}>;

/** The trades Ryntra itself sent and saw settle on mainnet, by curve — with the dollar side as quoted. */
export async function readAppTrades(store: GuardStore): Promise<Map<string, PoolTrade[]>> {
  const rows = await store.collection<LaunchTradeRow>("launchTradeRecords").valuesWithPrefix("mainnet:");
  const out = new Map<string, PoolTrade[]>();
  for (const row of rows) {
    if (!row || row.cluster !== "mainnet" || row.state !== "DONE" || !row.wallet || !row.signature || !row.settledAt || !row.curve || (row.side !== "buy" && row.side !== "sell")) continue;
    const decimals = row.pair?.mint ? REWARD_PAR_MINTS[row.pair.mint] : undefined;
    const raw = row.side === "buy" ? row.quote?.amountInRaw : row.quote?.amountOutRaw;
    const usd = decimals !== undefined && decimals === row.pair?.decimals && raw && /^[0-9]+$/.test(raw) ? BigInt(raw) * 10n ** BigInt(6 - decimals) : null;
    const trade: PoolTrade = { wallet: row.wallet, side: row.side, usdMicros: usd, at: row.settledAt, tx: row.signature };
    for (const venue of new Set([row.curve, ...(row.pool ? [row.pool] : [])])) out.set(poolKey(venue), [...(out.get(poolKey(venue)) ?? []), trade]);
  }
  return out;
}

/**
 * One run's budget of chain requests — beyond it, a wallet stays unread (not counted), never guessed. Each read is
 * charged what it may cost the public node at most.
 */
type Budget = { left: number; used: number };
export const READ_COST = { funding: 9, transfers: 1 + 300, curve: 1 + 600 } as const;

function spend(budget: Budget, cost: number): boolean {
  if (budget.left < cost) return false;
  budget.left -= cost;
  budget.used += cost;
  return true;
}

/**
 * The funding graph around some wallets, `hops` steps back: from the store's cache first, the chain after, each
 * read kept by hash. The cache keeps hashes, not addresses, so a step it cannot take from the cache is taken by
 * reading the trail again from the wallet itself.
 */
async function resolveGraph(store: GuardStore, deps: ProtectDeps, wallets: readonly string[], now: string, budget: Budget): Promise<Map<string, FundingNode>> {
  const hash = (wallet: string) => signalHash(deps.key, "address", wallet);
  const graph = new Map<string, FundingNode>();
  const addresses = new Map<string, string>();
  const cached = async (key: string): Promise<FundingNode | undefined> => {
    if (!graph.has(key)) {
      const node = (await readFundingNodes(store, [key], now)).get(key);
      if (node) graph.set(key, node);
    }
    return graph.get(key);
  };
  const read = async (address: string): Promise<FundingNode | null> => {
    if (!spend(budget, READ_COST.funding)) return null;
    const key = hash(address);
    const answer = await deps.funding(address).catch((): FundingRead => ({ state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null }));
    const node: FundingNode = { state: answer.state, funder: answer.funder ? hash(answer.funder) : null, firstAt: answer.firstAt, lastAt: answer.lastAt };
    if (answer.funder) addresses.set(node.funder!, answer.funder);
    if (node.state === "UNAVAILABLE") return null;
    graph.set(key, node);
    await writeFundingNode(store, key, node, now);
    return node;
  };
  /* The address of the step `depth` back from `root`, read again from the chain. */
  const relearn = async (root: string, depth: number): Promise<string | null> => {
    let address = root;
    for (let step = 0; step < depth; step += 1) {
      const node = await read(address);
      if (!node || node.state !== "FOUND" || !node.funder) return null;
      const next = addresses.get(node.funder);
      if (!next) return null;
      address = next;
    }
    return address;
  };
  for (const root of new Set(wallets)) {
    if (/^0x/i.test(root)) continue;
    let key = hash(root);
    let address: string | null = root;
    for (let depth = 0; depth < PROTECT_RULES.funding.hops; depth += 1) {
      let node = await cached(key);
      if (!node) {
        address ??= await relearn(root, depth);
        if (!address) break;
        node = (await read(address)) ?? undefined;
        if (!node) break;
      }
      if (node.state !== "FOUND" || !node.funder) break;
      key = node.funder;
      address = addresses.get(key) ?? null;
    }
  }
  return graph;
}

type Incomplete = "trades" | "funding" | "transfers" | "budget" | "error";

/**
 * Check every partner's pool: activation and signals. Raises the signals into the queue first (a case opens on
 * S10: one hard signal or two soft), keeps each signal's evidence hashed — and only then writes the activation, once.
 * A pool whose creator reached activation but whose check could not see everything (the two parties' funding or
 * transfers not read whole, or activation thanks to untraceable wallets) gets an `UNVERIFIED` case: its money waits
 * for a person. A repeated run with nothing new writes nothing to the queue; new evidence of a decided signal
 * reopens its case. Pools are checked least recently checked first, so a run's budget reaches every pool in turn.
 */
export async function protectNetwork(
  store: GuardStore,
  deps: ProtectDeps,
  args: Readonly<{ registry: readonly RegistryRowLike[]; clock?: () => number; maxChainRequests?: number }>,
): Promise<ProtectRunReport> {
  const nowMs = (args.clock ?? Date.now)();
  if (!Number.isFinite(nowMs)) throw new Error("A run needs a readable moment.");
  const now = new Date(nowMs).toISOString();
  const budget: Budget = { left: args.maxChainRequests ?? 4000, used: 0 };
  const configs = countedConfigsOf(args.registry, new Set(launchConfigPlans(args.registry).counted.keys()));
  const own = registryWallets(args.registry);
  const [bindings, reviewerHubs, appTrades, checked] = await Promise.all([readPartnerBindings(store), readHubs(store), readAppTrades(store), readActivations(store)]);
  const internal = await deps.team().catch(() => null);
  const team = internal === null ? null : new Set([...internal, ...own]);
  const hash = (wallet: string) => signalHash(deps.key, "address", wallet);
  const lastChecked = (binding: PoolPartner) => checked.records.get(activationKey(binding.network, binding.pool))?.last.at ?? "";
  const ordered = [...bindings].sort((a, b) => lastChecked(a).localeCompare(lastChecked(b)) || a.pool.localeCompare(b.pool));
  const pools: ProtectPoolReport[] = [];

  for (const binding of ordered) {
    const partner = binding.partner!;
    const base = { network: binding.network, pool: binding.pool, partner, activated: false, independent: 0, signals: [] as SignalCode[], review: "NONE" as const, incomplete: [] as Incomplete[] };
    if (binding.network === "solana" && configs.demo.has(binding.factory)) {
      pools.push({ ...base, state: "NOT_COUNTED" });
      continue;
    }
    if (binding.checks?.reasons.length) {
      pools.push({ ...base, state: "BLOCKED" });
      continue;
    }
    if (team === null) {
      pools.push({ ...base, state: "NO_DATA" });
      continue;
    }
    try {
      pools.push(await checkPool(binding, partner, team, base));
    } catch {
      /* One pool's failed read never stops the others; it is marked as tried, so the next run starts with others. */
      await touchActivation(store, { network: binding.network, pool: binding.pool, creator: binding.creator, now }).catch(() => null);
      pools.push({ ...base, state: "NO_DATA", incomplete: ["error"] });
    }
  }
  return { at: now, pools, chainRequests: budget.used };

  async function checkPool(binding: PoolPartner, partner: string, team: ReadonlySet<string>, base: Omit<ProtectPoolReport, "state">): Promise<ProtectPoolReport> {
    const incomplete: Incomplete[] = [];
    const [creatorId, partnerId] = await Promise.all([
      identityOf(store, deps, familyOf(binding.network), binding.creator),
      identityOf(store, deps, "solana", partner),
    ]);
    /* A creator or a partner of the team — found since the binding was written — is never activated for anybody. */
    if ([binding.creator, partner, ...creatorId.linked, ...partnerId.linked].some((wallet) => team.has(walletKey(wallet)))) return { ...base, state: "BLOCKED" };
    /* An activation record this build cannot read: nothing is read or written for the pool until it can be. */
    const current = await readActivation(store, binding.network, binding.pool).catch(() => undefined);
    if (current === undefined) return { ...base, state: "NO_DATA", incomplete: ["error"] };

    /* The pool's trades: Ryntra's own, and the chain's for a Solana curve. */
    const byTx = new Map<string, PoolTrade>();
    for (const trade of appTrades.get(poolKey(binding.pool)) ?? []) byTx.set(trade.tx, trade);
    if (binding.network === "solana" && spend(budget, READ_COST.curve)) {
      const chain = await deps.curveTrades(binding.pool, binding.launchedAt).catch(() => null);
      if (!chain || !chain.complete) incomplete.push("trades");
      for (const trade of chain?.trades ?? []) if (!byTx.has(trade.tx)) byTx.set(trade.tx, trade);
    } else incomplete.push("trades");
    const trades = [...byTx.values()];

    /* The funding graph of the two parties first, then everyone else but the team. */
    const traders = [...new Set(trades.map((trade) => walletKey(trade.wallet)))].filter((wallet) => !team.has(wallet));
    const creatorWallets = [binding.creator, ...creatorId.linked];
    const partnerWallets = [partner, ...partnerId.linked];
    const solanaOnly = (wallets: readonly string[]) => wallets.filter((wallet) => !/^0x/i.test(wallet));
    const graph = await resolveGraph(store, deps, [...solanaOnly(creatorWallets), ...solanaOnly(partnerWallets), ...traders], now, budget);
    /* The team's own wallets are nobody's shared source: Ryntra paying or funding people joins nobody. */
    const hubs = new Set([...reviewerHubs, ...[...team].filter((wallet) => !/^0x/i.test(wallet)).map(hash)]);
    const creatorAncestry = partyAncestry(solanaOnly(creatorWallets).map(hash), graph, hubs);
    const partnerAncestry = partyAncestry(solanaOnly(partnerWallets).map(hash), graph, hubs);
    /* The parties must be read whole: their links and profiles, and who funded each of their wallets — a wallet with a
       history too long to read hides that; an EVM creator's funding is not read here at all. */
    const partiesWhole =
      creatorAncestry.complete && partnerAncestry.complete && !creatorAncestry.deep && !partnerAncestry.deep && !/^0x/i.test(binding.creator) && !creatorId.unavailable && !partnerId.unavailable;
    if (!partiesWhole || traders.some((wallet) => !ancestryOf(hash(wallet), graph, hubs).complete)) incomplete.push("funding");

    /* The two parties' transfers around the launch and their devices — read before the activation: a trader the
       creator or the partner paid is theirs, however it was first funded. */
    const transfersSince = new Date(Date.parse(binding.launchedAt) - PROTECT_RULES.funding.directDays * DAY_MS).toISOString();
    let transfersWhole = true;
    const partyFacts = async (wallet: string, linked: readonly string[], ancestry: PartyAncestry): Promise<PartyFacts> => {
      const items: PartyTransfer[] = [];
      /* Transfers are read on Solana, for the party's own wallet and every Solana wallet linked to it. */
      for (const address of solanaOnly([wallet, ...linked])) {
        const read = spend(budget, READ_COST.transfers) ? await deps.transfers(address, transfersSince).catch(() => null) : null;
        if (!read || !read.complete) transfersWhole = false;
        for (const item of read?.items ?? []) items.push({ counterparty: hash(item.counterparty), direction: item.direction, at: item.at, ref: hash(`${item.counterparty}|${item.direction}|${item.at}`) });
      }
      if (/^0x/i.test(wallet)) transfersWhole = false;
      const seen = await Promise.all([wallet, ...linked].map((address) => readDevices(store, address, now)));
      return { hash: hash(wallet), ancestry, transfers: items, devices: [...new Set(seen.flatMap((read) => read.hashes))] };
    };
    const creatorFacts = await partyFacts(binding.creator, creatorId.linked, creatorAncestry);
    const partnerFacts = await partyFacts(partner, partnerId.linked, partnerAncestry);
    if (!transfersWhole) incomplete.push("transfers");

    const activation = activationOf({
      launchedAt: binding.launchedAt,
      now,
      creator: { wallet: binding.creator, linked: creatorId.linked },
      partner: { wallet: partner, linked: partnerId.linked },
      team,
      trades,
      hash,
      graph,
      hubs,
      /* Only whom the parties paid: anybody can send a party a little — that makes nobody theirs. */
      insiderCounterparties: new Set([...(creatorFacts.transfers ?? []), ...(partnerFacts.transfers ?? [])].filter((transfer) => transfer.direction === "out").map((transfer) => transfer.counterparty)),
    });

    /* The partner and the wallets linked to them are one person on their own phone: a crowd is of others. */
    const ownWallets = new Set(partnerWallets.map(walletKey));
    const partnerCrowds = (await Promise.all(partnerWallets.map((address) => readDevices(store, address, now))))
      .flatMap((read) => read.crowds)
      .map((crowd) => {
        const others = crowd.members.filter((member) => !ownWallets.has(walletKey(member)));
        return { ...crowd, members: others, wallets: others.length + 1 };
      });
    const signals = poolSignals({ launchedAt: binding.launchedAt, now, creator: creatorFacts, partner: partnerFacts, partnerDeviceCrowds: partnerCrowds, activation, hubs }).map((signal) => ({
      ...signal,
      /* Evidence is kept as hashes only: what is not one yet (a crowd's step, a round trip) is hashed here. */
      evidence: signal.evidence.map((value) => (SIGNAL_HASH.test(value) ? value : hash(value))),
    }));
    /* Activation reached for the first time on a check that could not see everything: a person confirms before the
       money moves. A later run's failed read is no reason to hold what was activated on a whole one. */
    if (activation.at && !current?.activatedAt && (!partiesWhole || !transfersWhole || activation.reliesOnDeep)) signals.push({ code: "UNVERIFIED", evidence: [] });
    const codes = signals.map((signal) => signal.code);

    let review: ProtectPoolReport["review"] = "NONE";
    if (needsReview(codes)) {
      const subject = poolSubject(binding.network, binding.pool);
      /* New evidence is evidence first kept after the last time the case raised its code — by the log's own order, not
         a clock: a decision taken while this run was on its way never covers evidence it was never shown, a run that
         failed to raise it leaves it new for the next, and an open case raises it too. */
      const before = await readSubjectEvents(store, subject);
      const afterSeq = before.events.at(-1)?.seq ?? -1;
      for (const signal of signals) if (signal.evidence.length) await recordEvidence(store, { subject, code: signal.code, hashes: signal.evidence, afterSeq, now });
      const log = await readSubjectEvents(store, subject);
      const live = await readEvidence(store, subject, now);
      const lastRaise = (code: SignalCode) => Math.max(-1, ...log.events.filter((event) => (event.kind === "OPENED" || event.kind === "SIGNALS") && event.signals?.includes(code)).map((event) => event.seq));
      const renewed = codes.filter((code) => live.some((row) => row.code === code && row.afterSeq >= lastRaise(code)) && lastRaise(code) >= 0);
      const raised = await raiseSignals(store, { subject, codes, renewed, now });
      review = !raised ? "UNAVAILABLE" : raised.written ? (raised.written.kind === "OPENED" ? "OPENED" : "SIGNALS") : "UNCHANGED";
    }

    /* Only now the activation: after its signals — `UNVERIFIED` among them — are in the queue. */
    const last: ActivationRecord["last"] = {
      at: now,
      independent: activation.independent,
      external: activation.external,
      unknown: activation.unknown,
      volumeUsdMicros: activation.volumeUsdMicros.toString(),
      teamVolumeUsdMicros: activation.teamVolumeUsdMicros.toString(),
      insiderVolumeUsdMicros: activation.insiderVolumeUsdMicros.toString(),
      roundTripVolumeUsdMicros: activation.roundTripVolumeUsdMicros.toString(),
      unvaluedTrades: activation.unvaluedTrades,
      tradesComplete: !incomplete.includes("trades"),
      partiesComplete: partiesWhole && transfersWhole,
      sharedSources: activation.sharedSources.map((source) => ({ ...source })),
    };
    const activatedAt = review !== "UNAVAILABLE" ? activation.at : null;
    /* Written on every check — its moment is what orders the next run, least recently checked first. */
    const written = await writeActivation(store, { network: binding.network, pool: binding.pool, creator: binding.creator, activatedAt, last, now });
    const activated = Boolean(written?.activatedAt ?? current?.activatedAt);
    if (budget.left <= 0) incomplete.push("budget");
    return { ...base, state: "CHECKED", activated, independent: activation.independent, signals: codes, review, incomplete: [...new Set(incomplete)] };
  }
}

/**
 * The reviewer's look at a shared source before marking it a hub: the pool's traders and parties are followed back
 * on the chain again, and the address whose hash is the one asked for is returned — shown once, never kept.
 */
export async function revealSource(
  store: GuardStore,
  deps: ProtectDeps,
  args: Readonly<{ network: PoolPartner["network"]; pool: string; hash: string; by: string; maxChainRequests?: number }>,
): Promise<string | null> {
  /* Who looked, and when — the address itself is never written. */
  await noteHubViewed(store, { hash: args.hash, by: args.by, now: new Date().toISOString() });
  const binding = (await readPartnerBindings(store)).find((row) => row.network === args.network && poolKey(row.pool) === poolKey(args.pool));
  if (!binding || binding.network !== "solana") return null;
  const budget: Budget = { left: args.maxChainRequests ?? 1500, used: 0 };
  const trades = [...((await readAppTrades(store)).get(poolKey(binding.pool)) ?? [])];
  if (spend(budget, READ_COST.curve)) trades.push(...((await deps.curveTrades(binding.pool, binding.launchedAt).catch(() => null))?.trades ?? []));
  const hash = (wallet: string) => signalHash(deps.key, "address", wallet);
  const roots = [...new Set([binding.creator, binding.partner!, ...trades.map((trade) => walletKey(trade.wallet))])];
  for (const root of roots) {
    let address: string | null = root;
    for (let step = 0; step < PROTECT_RULES.funding.hops && address; step += 1) {
      if (!spend(budget, READ_COST.funding)) return null;
      const read: FundingRead = await deps.funding(address).catch(() => ({ state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null }));
      if (!read.funder) break;
      if (hash(read.funder) === args.hash) return read.funder;
      address = read.funder;
    }
  }
  return null;
}
