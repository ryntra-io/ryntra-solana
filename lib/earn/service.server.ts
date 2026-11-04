/**
 * Thin on purpose. Every decision Earn makes lives in `actions.ts` with its dependencies handed to it, which
 * is what makes them testable; this file is the place where those dependencies stop being arguments and
 * become the deployment. It is also the only Earn module that reads `process.env`, so there is one answer to
 * «where does the key come from» and one place a secret could ever be read.
 */

import "server-only";

import { kitChainReader, readFreshBuildWindowMs } from "../solana/blockhash-life.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { sendTransactionOnce } from "../solana/submit-rpc.ts";

import {
  readEarnSignatures as readSignaturesWith,
  readEarnSurface as readSurfaceWith,
  reviewEarn as reviewWith,
  submitEarn as submitWith,
  type EarnDeps,
} from "./actions.ts";
import { readHeld, readNative } from "./chain.server.ts";
import type { EarnAdapter } from "./contract.ts";
import { jupiterLendAdapter } from "./jupiter-adapter.ts";
import { KAMINO_API_ENV } from "./kamino.ts";
import { kaminoLendAdapter } from "./kamino-adapter.ts";
import { EARN_REVIEW_WINDOW_MS } from "./model.ts";
import { jupiterLendKey, kaminoOn } from "./providers.ts";

/** Both providers, Kamino Lend second and off until it is turned on. */
export function earnAdapters(env: NodeJS.ProcessEnv = process.env): readonly EarnAdapter[] {
  return [
    jupiterLendAdapter({ key: jupiterLendKey(env), readHeld }),
    kaminoLendAdapter({ on: kaminoOn(env), baseUrl: env[KAMINO_API_ENV]?.trim() || null }),
  ];
}

export function earnDeps(env: NodeJS.ProcessEnv = process.env): EarnDeps {
  return {
    env,
    adapters: earnAdapters(env),
    readHeld,
    readNative: (owner) => readNative(owner),
    /* One handle per call rather than one per process: the handle carries the record of which endpoint
       answered, and that record belongs to one action rather than to the server's whole uptime. */
    handle: () => createSolanaRpcHandle({ network: "mainnet", timeoutMs: 8_000, retries: 0 }),
    send: sendTransactionOnce,
    /* The Lend API returns bytes without the block height they die at, so the window is one blockhash's life
       at the chain's measured slot speed, less the build's own time, and never longer than the Review's own
       reading window. */
    signableWindowMs: (startedAtMs) =>
      readFreshBuildWindowMs(kitChainReader(createSolanaRpcHandle({ network: "mainnet", timeoutMs: 5_000, retries: 0 })), {
        startedAtMs,
        capMs: EARN_REVIEW_WINDOW_MS,
      }),
  };
}

export const readEarnSurface = (owner: string | null) => readSurfaceWith(owner, earnDeps());
export const reviewEarn = (body: unknown) => reviewWith(body, earnDeps());
export const submitEarn = (body: unknown) => submitWith(body, earnDeps());
export const readEarnSignatures = (signatures: readonly string[]) => readSignaturesWith(signatures, earnDeps());

export type { EarnSurface } from "./actions.ts";
export type { EarnReceipt } from "./receipt.ts";
export type { EarnReview } from "./review.ts";
