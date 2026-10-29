/**
 * The chain as Ryntra Launch's executor reaches it — Meteora's own SDKs for
 * the curve, the graduated pool and the DLMM steps, the partner's fees where
 * the executor is the config's fee claimer, the executor's key for signing —
 * only what its list allows (`./executor-signing.server.ts`) —, one send per
 * transaction and the chain's own word on each.
 *
 * `autopilotDeps()` gives the executor's pass everything it needs here, or the
 * reason it does not run: no network, Launch's operator stop closed, or no
 * executor's key (on mainnet only the key of the address the attribution
 * registry publishes is one).
 */

import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { IDL as DlmmIdl } from "@meteora-ag/dlmm";
import { DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDammV2PoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getBase58Decoder } from "@solana/kit";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";

import { partnerEarnedRaw } from "../core/launch/autopilot.ts";
import { readCreatorFees } from "../core/venues/meteora-dbc/claim.server.ts";
import { buildPartnerClaim, readPartnerFees } from "../core/venues/meteora-dbc/partner.server.ts";
import { dammPrice } from "../core/venues/meteora-dbc/market.server.ts";
import { createDbcClient } from "../core/venues/meteora-dbc/sdk.server.ts";
import { heldRaw } from "../core/venues/meteora-dbc/trade.server.ts";
import { createHolderVenue } from "../core/venues/meteora-damm-v2/holder.server.ts";
import { createFloorVenue } from "../core/venues/meteora-dlmm/floor.server.ts";
import { ENGINE_RULE } from "../core/launch/engine.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSupportsConcurrentInstances, type GuardStore } from "../guard/store.ts";
import { resolveEndpoint, resolveEndpoints } from "../solana/rpc.ts";
import { sendPlainDelivery } from "../telegram/api.ts";
import type { AutopilotChain, AutopilotDeps, CurveRead, TxFacts } from "./autopilot.server.ts";
import type { LaunchRecord } from "./flow.server.ts";
import { executorConnection, failoverConnection, type FailoverHealth } from "./failover.server.ts";
import { peopleOpen } from "./engine.server.ts";
import { launchArchiveConnection, launchExecutor, launchFloorOpen, launchHistoryConnection, launchHistoryEndpoint, launchNetwork, launchOpen, launchWritesHere, type LaunchNetwork } from "./config.server.ts";
import { assertExecutorSignable, type Idl } from "./executor-signing.server.ts";
import { executorPaused, operatorTelegramId, readExecutorStops, type AutopilotPaused } from "./executor.server.ts";
import { sendOnce, signatureOutcome } from "./flow.server.ts";
import { ryntraOwnWallets } from "./runtime.server.ts";
import { getTransactionAnyVersion } from "../solana/v1-tx.ts";

const SEND = { confirmMs: 25_000, settleMs: 8_000 } as const;
/** A priority fee on the executor's transactions, so they land on a busy network; a few thousand lamports at most. */
const PRIORITY_MICRO_LAMPORTS = 50_000;

/** What the executor needs here, or why it does not run (`executorPaused`). */
export function autopilotDeps(): AutopilotDeps | Readonly<{ paused: AutopilotPaused }> {
  const network = launchNetwork();
  const store = getGuardRuntime().store;
  const executor = network ? launchExecutor(process.env, network) : null;
  const paused = executorPaused({ network, laneOpen: launchOpen(), writesHere: network ? launchWritesHere(network) : false, sharedStore: storeSupportsConcurrentInstances(store), key: executor !== null });
  if (paused || !network || !executor) return { paused: paused ?? "NO_EXECUTOR" };
  /* A launch is Ryntra's own by its creator — one of Ryntra's internal wallets; a list read in part leaves a creator out, never in. */
  const ryntraLaunched = async (creator: string) => (await ryntraOwnWallets(network, store)).wallets.has(creator);
  return {
    network,
    store,
    chain: autopilotChain(network, executor),
    floorOpen: launchFloorOpen(),
    ryntraLaunched,
    /* People's Micro markets: the operator's switch in the store (SOL-L6) — open on devnet until closed, closed on mainnet until opened. */
    peopleOpen: () => peopleOpen(store, network.cluster),
    now: () => new Date(),
    alert: (text) => operatorAlert(text, store, network.cluster),
  };
}

/** A word to the operator in Telegram; false when no address is known or the message did not go. */
async function operatorAlert(text: string, store: GuardStore, cluster: string): Promise<boolean> {
  const id = operatorTelegramId(process.env, await readExecutorStops(store, cluster).catch(() => null));
  if (id === null) return false;
  return (await sendPlainDelivery(id, text).catch(() => ({ kind: "failed" as const }))).kind === "sent";
}

/** The node other than the executor's own: the price a market's budget is checked against, and the reads the main node does not answer. */
export function secondEndpoint(network: LaunchNetwork): string | null {
  const primary = resolveEndpoint(network.cluster);
  return [...resolveEndpoints(network.cluster).map((endpoint) => endpoint.url), launchHistoryEndpoint(network)].find((candidate) => candidate !== primary) ?? null;
}

/* One per process and node: the executor's own connections — no silent waits on a rate limit, each request cut off in time. */
const NODES = new Map<string, Connection>();
function nodeConnection(url: string): Connection {
  const known = NODES.get(url) ?? executorConnection(url);
  NODES.set(url, known);
  return known;
}

/* A DBC config never changes once made: read once per process, by address. */
/* A mint's decimals never change: read once per process, by network and mint. */
const DECIMALS = new Map<string, number>();

const CONFIGS = new Map<string, Readonly<{ migrationQuoteThreshold: { toString(): string }; migrationFeeOption: number; quoteMint: PublicKey }>>();

export function autopilotChain(network: LaunchNetwork, executor: Keypair): AutopilotChain & Readonly<{ nodes(): FailoverHealth }> {
  /*
   * The executor's own connections (SOL-L6): the main node with the second behind it for every read — a read the main
   * node does not answer goes to the second at once, and after two failures in a row the main node rests a minute. The
   * price a budget is checked by stays two nodes' apart: `price` asks the main node alone, `priceSecond` the second.
   */
  const mainNode = nodeConnection(resolveEndpoint(network.cluster));
  const secondUrl = secondEndpoint(network);
  const secondNode = secondUrl ? nodeConnection(secondUrl) : null;
  const failover = failoverConnection(mainNode, secondNode);
  const connection = failover.connection;
  const second = launchArchiveConnection(network);
  const history = launchHistoryConnection(network);
  const client = createDbcClient(connection);
  const mainAmm = new CpAmm(mainNode);
  const owner = executor.publicKey;

  const priced = (tx: Transaction): Transaction => {
    const has = tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3);
    if (!has) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }));
    return tx;
  };

  const prepare: AutopilotChain["prepare"] = async (tx, extra, payees = []) => {
    /* Nothing outside the executor's list is ever signed — checked here, before the key touches the bytes. */
    assertExecutorSignable(tx.instructions, owner.toBase58(), DlmmIdl as unknown as Idl, payees);
    const latest = await connection.getLatestBlockhash("confirmed");
    priced(tx);
    tx.feePayer = owner;
    tx.recentBlockhash = latest.blockhash;
    tx.signatures = [];
    tx.sign(executor, ...extra);
    return { signature: getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array())), validUntil: latest.lastValidBlockHeight };
  };

  /*
   * Sent through the main node; while it rests, the same signed bytes go through the second — one signature, so a
   * transaction sent twice lands once. A send whose answer was lost is read by the next pass from whichever node answers.
   */
  const send: AutopilotChain["send"] = (tx, validUntil) => sendOnce(failover.health().resting && secondNode ? secondNode : mainNode, tx, validUntil, () => new Date(), SEND, { second: second ?? secondNode });

  async function decimalsOf(mint: string): Promise<number> {
    const known = DECIMALS.get(`${network.cluster}:${mint}`);
    if (known !== undefined) return known;
    const info = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
    if (!info || info.data.length < 45) throw new Error(`No mint at ${mint}.`);
    const value = info.data[44]!;
    DECIMALS.set(`${network.cluster}:${mint}`, value);
    return value;
  }

  /* Many mints' decimals in one request of the node: those not known yet. */
  async function decimalsMany(mints: readonly string[], from: Connection): Promise<void> {
    const missing = [...new Set(mints)].filter((mint) => !DECIMALS.has(`${network.cluster}:${mint}`));
    for (let at = 0; at < missing.length; at += ENGINE_RULE.readBatch) {
      const chunk = missing.slice(at, at + ENGINE_RULE.readBatch);
      const infos = await from.getMultipleAccountsInfo(chunk.map((mint) => new PublicKey(mint)), "confirmed").catch(() => null);
      infos?.forEach((info, index) => {
        if (info && info.data.length >= 45) DECIMALS.set(`${network.cluster}:${chunk[index]}`, info.data[44]!);
      });
    }
  }

  /*
   * Many graduated pools' prices from one node — a hundred pools a request. A pool not read (its request refused, its
   * mints' decimals not known) is left out: the ladder then reads nothing this pass rather than one by one.
   */
  async function pricesFrom(from: Connection, pools: ReadonlyArray<Readonly<{ dammPool: string; token: string }>>): Promise<Map<string, Readonly<{ price: number; pairMint: string; tokenDecimals: number; pairDecimals: number }>>> {
    const out = new Map<string, Readonly<{ price: number; pairMint: string; tokenDecimals: number; pairDecimals: number }>>();
    const amm = new CpAmm(from);
    for (let at = 0; at < pools.length; at += ENGINE_RULE.readBatch) {
      const chunk = pools.slice(at, at + ENGINE_RULE.readBatch);
      const states = await amm._program.account.pool.fetchMultiple(chunk.map((row) => new PublicKey(row.dammPool))).catch(() => null);
      if (!states) continue;
      const mints = states.flatMap((state) => (state ? [state.tokenAMint.toBase58(), state.tokenBMint.toBase58()] : []));
      await decimalsMany(mints, from);
      states.forEach((state, index) => {
        if (!state) return;
        const row = chunk[index]!;
        const tokenIsA = state.tokenAMint.toBase58() === row.token;
        const pairMint = (tokenIsA ? state.tokenBMint : state.tokenAMint).toBase58();
        const tokenDecimals = DECIMALS.get(`${network.cluster}:${row.token}`);
        const pairDecimals = DECIMALS.get(`${network.cluster}:${pairMint}`);
        if (tokenDecimals === undefined || pairDecimals === undefined) return;
        out.set(row.dammPool, { price: dammPrice(state.sqrtPrice.toString(), tokenIsA, tokenDecimals, pairDecimals), pairMint, tokenDecimals, pairDecimals });
      });
    }
    return out;
  }

  type PoolState = Readonly<{ config: PublicKey; isMigrated: number; quoteReserve: { toString(): string }; finishCurveTimestamp: { toString(): string } }>;
  type ConfigState = NonNullable<ReturnType<typeof CONFIGS.get>>;
  const curveOf = (record: LaunchRecord, state: PoolState, config: ConfigState): CurveRead => {
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
    const finished = Number(state.finishCurveTimestamp.toString());
    return {
      migrated: state.isMigrated === 1,
      reserveRaw: BigInt(state.quoteReserve.toString()),
      thresholdRaw: BigInt(config.migrationQuoteThreshold.toString()),
      finishedAt: finished > 0 ? finished : null,
      dammPool: dammConfig ? deriveDammV2PoolAddress(dammConfig, new PublicKey(record.token), config.quoteMint).toBase58() : null,
    };
  };
  const configOf = async (address: PublicKey): Promise<ConfigState | null> => {
    const key = `${network.cluster}:${address.toBase58()}`;
    const known = CONFIGS.get(key);
    if (known) return known;
    const config = await client.state.getPoolConfig(address);
    if (config) CONFIGS.set(key, config);
    return config ?? null;
  };

  return {
    executor: owner.toBase58(),
    nodes: () => failover.health(),

    async curve(record) {
      const virtual = await client.state.getPool(new PublicKey(record.pool));
      if (!virtual) return null;
      const state = virtual.poolState;
      const config = await configOf(state.config);
      if (!config) return null;
      return curveOf(record, state, config);
    },

    /*
     * A hundred curves a request, and the configs they name once each: a pass over hundreds of markets reads them in a
     * few. A request that fails leaves its hundred out — not read this pass; a curve found to be no plain curve (another
     * kind of pool) is null, to be read alone.
     */
    async curves(records) {
      const out = new Map<string, CurveRead | null>();
      const program = client.state.program;
      for (let at = 0; at < records.length; at += ENGINE_RULE.readBatch) {
        const chunk = records.slice(at, at + ENGINE_RULE.readBatch);
        const pools = await program.account.virtualPool.fetchMultiple(
          chunk.map((record) => new PublicKey(record.pool)),
          "confirmed",
        ).catch(() => null);
        if (!pools) continue;
        const missing = [...new Set(pools.filter((pool) => pool !== null).map((pool) => pool!.poolState.config.toBase58()))].filter((address) => !CONFIGS.has(`${network.cluster}:${address}`));
        if (missing.length) {
          const configs = await program.account.poolConfig.fetchMultiple(missing.map((address) => new PublicKey(address)), "confirmed").catch(() => []);
          configs.forEach((config, index) => {
            if (config) CONFIGS.set(`${network.cluster}:${missing[index]}`, config);
          });
        }
        chunk.forEach((record, index) => {
          const pool = pools[index];
          if (!pool) {
            out.set(record.token, null);
            return;
          }
          /* Its config not read: the curve is not read this pass either. */
          const config = CONFIGS.get(`${network.cluster}:${pool.poolState.config.toBase58()}`);
          if (config) out.set(record.token, curveOf(record, pool.poolState, config));
        });
      }
      return out;
    },

    async buildMigration(record) {
      const virtual = await client.state.getPool(new PublicKey(record.pool));
      const config = virtual ? await configOf(virtual.poolState.config) : null;
      const dammConfig = config ? DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption] : undefined;
      if (!dammConfig) throw new Error("No DAMM v2 config for this curve.");
      const built = await client.migration.migrateToDammV2({ payer: owner, pool: new PublicKey(record.pool), dammConfig });
      return { transaction: built.transaction, signers: [built.firstPositionNftKeypair, built.secondPositionNftKeypair] };
    },

    async oldestSignature(address) {
      let before: string | undefined;
      let oldest: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const batch = await history.getSignaturesForAddress(new PublicKey(address), { before, limit: 1_000 }, "confirmed");
        if (!batch.length) return oldest;
        /* A failed attempt older than the creation is not the creation. */
        const landed = batch.filter((row) => row.err === null);
        if (landed.length) oldest = landed.at(-1)!.signature;
        if (batch.length < 1_000) return oldest;
        before = batch.at(-1)!.signature;
      }
      return null;
    },

    async transaction(signature) {
      const read = (from: Connection) => getTransactionAnyVersion(from, signature);
      const tx = (await read(connection).catch(() => null)) ?? (second ? await read(second).catch(() => null) : null) ?? (await read(history).catch(() => null));
      if (!tx?.meta) return null;
      const meta = tx.meta;
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses });
      const executorAddress = owner.toBase58();
      const index = keys.staticAccountKeys.findIndex((key) => key.toBase58() === executorAddress);
      const of = (rows: typeof meta.preTokenBalances, mint: string) => (rows ?? []).filter((row) => row.owner === executorAddress && row.mint === mint).reduce((total, row) => total + BigInt(row.uiTokenAmount.amount), 0n);
      const facts: TxFacts = {
        feePayer: keys.staticAccountKeys[0]?.toBase58() ?? "",
        at: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
        slot: tx.slot,
        logs: meta.logMessages ?? [],
        lamportsSpent: index >= 0 ? BigInt((meta.preBalances[index] ?? 0) - (meta.postBalances[index] ?? 0)) : null,
        failed: meta.err !== null,
        delta: (mint) => of(meta.postTokenBalances, mint) - of(meta.preTokenBalances, mint),
        deltaOf: (wallet, mint) => {
          const rows = (list: typeof meta.preTokenBalances) => (list ?? []).filter((row) => row.owner === wallet && row.mint === mint).reduce((total, row) => total + BigInt(row.uiTokenAmount.amount), 0n);
          return rows(meta.postTokenBalances) - rows(meta.preTokenBalances);
        },
      };
      return facts;
    },

    /* The pass's ladders' prices in bulk — the main node's, and the second's apart: two nodes, never one node's answer twice. */
    prices: (pools) => pricesFrom(mainNode, pools),
    ...(secondNode ? { pricesSecond: async (pools: ReadonlyArray<Readonly<{ dammPool: string; token: string }>>) => new Map([...(await pricesFrom(secondNode, pools))].map(([pool, read]) => [pool, read.price])) } : {}),

    /* The main node alone: the second checks it (`priceSecond`), so the two are never one node's answer twice. */
    async price(dammPool, token) {
      const state = await mainAmm.fetchPoolState(new PublicKey(dammPool));
      const tokenIsA = state.tokenAMint.toBase58() === token;
      const pairMint = (tokenIsA ? state.tokenBMint : state.tokenAMint).toBase58();
      const tokenDecimals = await decimalsOf(token);
      const pairDecimals = await decimalsOf(pairMint);
      return { price: dammPrice(state.sqrtPrice.toString(), tokenIsA, tokenDecimals, pairDecimals), pairMint, tokenDecimals, pairDecimals };
    },

    async partnerEarned(record) {
      return partnerEarnedRaw((await readCreatorFees(connection, { token: record.token, pool: record.pool })).read);
    },

    partnerFees: (record) => readPartnerFees(connection, { token: record.token, pool: record.pool }, { indexed: second }),
    buildPartnerClaim: (read, source) => buildPartnerClaim(connection, { read, source, claimer: owner.toBase58() }),

    async priceSecond(dammPool, token) {
      if (!secondNode) return null;
      const state = await new CpAmm(secondNode).fetchPoolState(new PublicKey(dammPool));
      const tokenIsA = state.tokenAMint.toBase58() === token;
      const pairMint = (tokenIsA ? state.tokenBMint : state.tokenAMint).toBase58();
      return dammPrice(state.sqrtPrice.toString(), tokenIsA, await decimalsOf(token), await decimalsOf(pairMint));
    },

    async heldBy(wallet, mint) {
      const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(mint) }, "confirmed");
      return accounts.value.reduce((total, row) => total + BigInt((row.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount ?? "0"), 0n);
    },

    decimals: decimalsOf,
    held: (mint) => heldRaw(connection, owner, new PublicKey(mint)),
    lamports: async () => BigInt(await connection.getBalance(owner, "confirmed")),
    floor: createFloorVenue({ connection, cluster: network.cluster }),
    /* The collector claims only: no entry is built here, so no share and no Zap. */
    holder: createHolderVenue({ connection, zap: network.zap, collector: owner.toBase58(), fee: null }),
    prepare,
    send,
    outcome: (signature, validUntil) => signatureOutcome(connection, signature, validUntil, second),
  };
}
