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
import { DAMM_V2_MIGRATION_FEE_ADDRESS, DynamicBondingCurveClient, deriveDammV2PoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getBase58Decoder } from "@solana/kit";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";

import { partnerEarnedRaw } from "../core/launch/autopilot.ts";
import { readCreatorFees } from "../core/venues/meteora-dbc/claim.server.ts";
import { buildPartnerClaim, readPartnerFees } from "../core/venues/meteora-dbc/partner.server.ts";
import { dammPrice } from "../core/venues/meteora-dbc/market.server.ts";
import { heldRaw } from "../core/venues/meteora-dbc/trade.server.ts";
import { createHolderVenue } from "../core/venues/meteora-damm-v2/holder.server.ts";
import { createFloorVenue } from "../core/venues/meteora-dlmm/floor.server.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSupportsConcurrentInstances, type GuardStore } from "../guard/store.ts";
import { resolveEndpoint, resolveEndpoints } from "../solana/rpc.ts";
import { sendPlainDelivery } from "../telegram/api.ts";
import type { AutopilotChain, AutopilotDeps, TxFacts } from "./autopilot.server.ts";
import { launchArchiveConnection, launchConnection, launchExecutor, launchFloorOpen, launchHistoryConnection, launchHistoryEndpoint, launchNetwork, launchOpen, launchWritesHere, type LaunchNetwork } from "./config.server.ts";
import { assertExecutorSignable, type Idl } from "./executor-signing.server.ts";
import { executorPaused, operatorTelegramId, readExecutorStops, type AutopilotPaused } from "./executor.server.ts";
import { sendOnce, signatureOutcome } from "./flow.server.ts";
import { ryntraOwnWallets } from "./runtime.server.ts";

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
  return { network, store, chain: autopilotChain(network, executor), floorOpen: launchFloorOpen(), ryntraLaunched, now: () => new Date(), alert: (text) => operatorAlert(text, store, network.cluster) };
}

/** A word to the operator in Telegram; false when no address is known or the message did not go. */
async function operatorAlert(text: string, store: GuardStore, cluster: string): Promise<boolean> {
  const id = operatorTelegramId(process.env, await readExecutorStops(store, cluster).catch(() => null));
  if (id === null) return false;
  return (await sendPlainDelivery(id, text).catch(() => ({ kind: "failed" as const }))).kind === "sent";
}

/* One per process: a node other than the executor's own, for the price a market's budget is checked against. */
const SECONDS = new Map<string, Connection>();
function secondConnection(network: LaunchNetwork): Connection | null {
  const primary = resolveEndpoint(network.cluster);
  const url = [...resolveEndpoints(network.cluster).map((endpoint) => endpoint.url), launchHistoryEndpoint(network)].find((candidate) => candidate !== primary) ?? null;
  if (!url) return null;
  const known = SECONDS.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  SECONDS.set(url, known);
  return known;
}

export function autopilotChain(network: LaunchNetwork, executor: Keypair): AutopilotChain {
  const connection = launchConnection(network);
  const second = launchArchiveConnection(network);
  const history = launchHistoryConnection(network);
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const cpAmm = new CpAmm(connection);
  const owner = executor.publicKey;
  const decimals = new Map<string, number>();

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

  const send: AutopilotChain["send"] = (tx, validUntil) => sendOnce(connection, tx, validUntil, () => new Date(), SEND, { second });

  async function decimalsOf(mint: string): Promise<number> {
    const known = decimals.get(mint);
    if (known !== undefined) return known;
    const info = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
    if (!info || info.data.length < 45) throw new Error(`No mint at ${mint}.`);
    const value = info.data[44]!;
    decimals.set(mint, value);
    return value;
  }

  return {
    executor: owner.toBase58(),

    async curve(record) {
      const virtual = await client.state.getPool(new PublicKey(record.pool));
      if (!virtual) return null;
      const state = virtual.poolState;
      const config = await client.state.getPoolConfig(state.config);
      if (!config) return null;
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
      const finished = Number(state.finishCurveTimestamp.toString());
      return {
        migrated: state.isMigrated === 1,
        reserveRaw: BigInt(state.quoteReserve.toString()),
        thresholdRaw: BigInt(config.migrationQuoteThreshold.toString()),
        finishedAt: finished > 0 ? finished : null,
        dammPool: dammConfig ? deriveDammV2PoolAddress(dammConfig, new PublicKey(record.token), config.quoteMint).toBase58() : null,
      };
    },

    async buildMigration(record) {
      const virtual = await client.state.getPool(new PublicKey(record.pool));
      const config = virtual ? await client.state.getPoolConfig(virtual.poolState.config) : null;
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
      const read = (from: Connection) => from.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
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

    async price(dammPool, token) {
      const state = await cpAmm.fetchPoolState(new PublicKey(dammPool));
      const tokenIsA = state.tokenAMint.toBase58() === token;
      const pairMint = (tokenIsA ? state.tokenBMint : state.tokenAMint).toBase58();
      const tokenDecimals = await decimalsOf(token);
      const pairDecimals = await decimalsOf(pairMint);
      return { price: dammPrice(state.sqrtPrice.toString(), tokenIsA, tokenDecimals, pairDecimals), pairMint, tokenDecimals, pairDecimals };
    },

    async partnerEarned(record) {
      return partnerEarnedRaw((await readCreatorFees(connection, { token: record.token, pool: record.pool })).read);
    },

    partnerFees: (record) => readPartnerFees(connection, { token: record.token, pool: record.pool }),
    buildPartnerClaim: (read, source) => buildPartnerClaim(connection, { read, source, claimer: owner.toBase58() }),

    async priceSecond(dammPool, token) {
      const other = secondConnection(network);
      if (!other) return null;
      const state = await new CpAmm(other).fetchPoolState(new PublicKey(dammPool));
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
