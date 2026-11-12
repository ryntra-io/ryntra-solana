import { createPrivateKey, createPublicKey, generateKeyPairSync, randomInt, randomUUID } from "node:crypto";
import { after } from "next/server";

import { readCandles } from "../../bots/backtest/candles.server.ts";
import { readGatewayEnv } from "../../predictions/gateway.ts";
import { modelGateway } from "../../models/gateway.server.ts";
import { rpcResult } from "../../supabase-rpc";
import { createStamper, signerOf, stampVerifier, type Stamper, type StampVerifier } from "../judge/stamp.ts";
import { SEAL_SECRET_ENV, catalogKind, keyMode, ringReady, storeKind } from "../ready.ts";
import { createSealer } from "../seal.ts";
import { account, ringStore } from "../server.ts";
import type { AgentRecord, RingStore } from "../store.ts";
import { MATCH } from "../weight.ts";
import { createDuelApi, type DuelApi } from "./api.ts";
import { modelAgent } from "./model-agent.ts";
import { DAILY_CAP_ENV, DEFAULT_MARKET_POOL, MARKET_POOL_ENV, SERVER_MOVE_MS, STAMP_KEY_ENV, dailyCapMicroUsd, duelsReady } from "./ready.ts";
import { createDuelService, createMemoryDuelStore, type DuelService, type DuelStore } from "./service.ts";
import { stubBrain } from "./stub-brain.ts";
import { createSupabaseDuelStore } from "./supabase-store.ts";

/**
 * The duels as the deployed server runs them (CITY-51, CITY-217): the Ring's own store and session (`../server.ts`),
 * the duels in the database wherever the agents are (`supabase-store.ts`), the model gateway (CITY-45) with each
 * agent's own key read back sealed and opened for its match, the market-data gateway's candles for Market Replay, the
 * day's ceiling on models (`RYNTRA_RING_DAILY_USD`), and the harness's time-stamp key from the server's environment
 * (`RYNTRA_RING_STAMP_KEY`, never in the repository). On a developer's machine without that key a fresh one is made per
 * process, and with the fixture catalog (`RYNTRA_RING_MODELS=stub`) agents play with the stand's brain; production
 * stays closed without the stamp key, and without a store every instance shares (`ready.ts`).
 */

function harnessKey(): { stamp: Stamper; verifyStamp: StampVerifier } | null {
  const pem = process.env[STAMP_KEY_ENV]?.trim();
  try {
    const key = pem ? createPrivateKey(pem.replace(/\\n/g, "\n")) : process.env.NODE_ENV === "production" ? null : generateKeyPairSync("ed25519").privateKey;
    if (!key) return null;
    return { stamp: createStamper(key), verifyStamp: stampVerifier([signerOf(createPublicKey(key))]) };
  } catch {
    console.error("[ring] the harness's stamp key does not read as Ed25519");
    return null;
  }
}

/** The stand's brains: a developer's machine on the fixture catalog. Never in production (`catalogKind`). */
const stubBrains = () => catalogKind(process.env) === "stub";

function brainOf(store: RingStore) {
  return async (record: AgentRecord) => {
    if (stubBrains()) return stubBrain(record);
    if (keyMode(process.env) !== "live" || record.key.state !== "live" || !record.key.hash) return null;
    const sealer = createSealer(process.env[SEAL_SECRET_ENV]);
    const sealed = sealer ? await store.sealedKey(record.id, record.key.hash) : null;
    const apiKey = sealer && sealed ? sealer.open(record.id, sealed) : null;
    if (!apiKey) return null;
    return modelAgent({
      gateway: modelGateway(),
      agent: { id: record.id, model: record.brain.id, provider: record.brain.provider, scenario: record.scenario, structured: record.formats.includes("market-replay") },
      apiKey,
      moveMicroUsd: Math.ceil(record.brain.matchMicroUsd / MATCH.moves),
      moveMs: SERVER_MOVE_MS,
    });
  };
}

let duelStore: DuelStore | null = null;
let service: DuelService | null = null;
let api: DuelApi | null = null;
let keys: ReturnType<typeof harnessKey> | undefined;

export function duelApi(): DuelApi {
  duelStore ??= storeKind(process.env) === "database" ? createSupabaseDuelStore((fn, args) => rpcResult("ring", fn, args)) : createMemoryDuelStore();
  keys ??= harnessKey();
  const store = ringStore();
  const kept = duelStore;
  const signed = keys;
  api ??= createDuelApi({
    service: () => {
      if (!signed) throw new Error("no stamp key");
      service ??= createDuelService({
        store: kept,
        agents: {
          agent: (id) => store.agent(id),
          ratings: (id, brain) => store.ratings(id, brain),
          rate: (input, now) => store.rate(input, now),
          rivals: (input) => store.rivals(input),
        },
        brain: brainOf(store),
        // A rival is drawn only among agents that can answer: a live key, or any agent on the stand's brains.
        playable: (record) => stubBrains() || record.key.state === "live",
        capMicroUsd: () => dailyCapMicroUsd(process.env[DAILY_CAP_ENV]),
        moveMs: SERVER_MOVE_MS,
        candles: async () => {
          const instrument = `solana:pool:${process.env[MARKET_POOL_ENV]?.trim() || DEFAULT_MARKET_POOL}`;
          const read = await readCandles(instrument, "30d");
          return read.ok ? { instrument, candles: read.candles } : null;
        },
        stamp: signed.stamp,
        verifyStamp: signed.verifyStamp,
        now: Date.now,
        randomInt: (n) => randomInt(n),
        newId: () => `duel-${randomUUID()}`,
        background: (task) => after(() => task),
      });
      return service;
    },
    open: () =>
      !!signed &&
      ringReady(store, process.env.NEXT_PUBLIC_RYNTRA_CITY_RING, process.env.NODE_ENV) &&
      duelsReady(kept, process.env.NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS, process.env.NODE_ENV),
    account,
    store,
    // Market Replay plays real candles only: without the market-data gateway the city does not offer it.
    formats: () => (readGatewayEnv(process.env) ? ["duo-crack", "market-replay"] : ["duo-crack"]),
  });
  return api;
}
