import { createPrivateKey, createPublicKey, generateKeyPairSync, randomInt, randomUUID } from "node:crypto";
import { after } from "next/server";

import { readCandles } from "../../bots/backtest/candles.server.ts";
import { modelGateway } from "../../models/gateway.server.ts";
import { createStamper, signerOf, stampVerifier, type Stamper, type StampVerifier } from "../judge/stamp.ts";
import { SEAL_SECRET_ENV, keyMode, ringReady } from "../ready.ts";
import { createSealer } from "../seal.ts";
import { account, ringStore } from "../server.ts";
import type { Brain } from "../contract.ts";
import type { RatingRecord } from "../rating.ts";
import type { AgentRecord, RingStore } from "../store.ts";
import { MATCH } from "../weight.ts";
import { createDuelApi, type DuelApi } from "./api.ts";
import { modelAgent } from "./model-agent.ts";
import { duelsReady, MARKET_POOL_ENV, STAMP_KEY_ENV, DEFAULT_MARKET_POOL } from "./ready.ts";
import { createDuelService, createMemoryDuelStore, type DuelService, type DuelStore } from "./service.ts";

/**
 * The duels as the deployed server runs them (CITY-51): the Ring's own store and session (`../server.ts`), the model
 * gateway (CITY-45) with each agent's own key opened for its match, the market-data gateway's candles for Market
 * Replay, and the harness's time-stamp key from the server's environment (`RYNTRA_RING_STAMP_KEY`, never in the
 * repository). On a developer's machine without that key a fresh one is made per process; production stays closed
 * without it, and without a store every instance shares (`ready.ts`).
 */

/** A store that can hand a sealed key back: the memory store of a developer's machine. The database has no such read yet. */
type SealedKeys = { keyRows(): { hash: string; agentId: string; sealed: string; retiredAt: number | null }[] };
const hasKeyRows = (store: RingStore): store is RingStore & SealedKeys => typeof (store as Partial<SealedKeys>).keyRows === "function";
type Rates = { seedRating(agentId: string, brain: Pick<Brain, "id" | "provider">, row: RatingRecord): void };
const canRate = (store: RingStore): store is RingStore & Rates => typeof (store as Partial<Rates>).seedRating === "function";

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

function brainOf(store: RingStore) {
  return async (record: AgentRecord) => {
    if (keyMode(process.env) !== "live" || record.key.state !== "live" || !record.key.hash || !hasKeyRows(store)) return null;
    const sealer = createSealer(process.env[SEAL_SECRET_ENV]);
    const row = store.keyRows().find((k) => k.hash === record.key.hash && k.agentId === record.id && k.retiredAt === null);
    const apiKey = sealer && row ? sealer.open(record.id, row.sealed) : null;
    if (!apiKey) return null;
    return modelAgent({
      gateway: modelGateway(),
      agent: { id: record.id, model: record.brain.id, provider: record.brain.provider, scenario: record.scenario, structured: record.formats.includes("market-replay") },
      apiKey,
      moveMicroUsd: Math.ceil(record.brain.matchMicroUsd / MATCH.moves),
    });
  };
}

let duelStore: DuelStore | null = null;
let service: DuelService | null = null;
let api: DuelApi | null = null;
let keys: ReturnType<typeof harnessKey> | undefined;

export function duelApi(): DuelApi {
  duelStore ??= createMemoryDuelStore();
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
          ...(canRate(store) ? { keepRating: async (id, brain, row) => store.seedRating(id, brain, row) } : {}),
        },
        brain: brainOf(store),
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
  });
  return api;
}
