/**
 * What the exit asks of the engine's own builders, as an interface. Each port builds the unsigned bytes of
 * one unit — one position left, one coin swapped — exactly as the engine already builds that action for its own screen;
 * the exit adds no instruction to them. The service (`service.ts`) checks every transaction against its rule
 * (`checks.ts`), runs it against the chain, and seals what stands.
 *
 * The real ports are `ports.server.ts`; the tests hand in their own, on recorded answers and built bytes.
 *
 * Types only.
 */

import type { AddressLookupTableAccount } from "@solana/web3.js";

import type { StepRule } from "./checks.ts";
import { EXIT_SKIP_REASONS, type ExitSkipReason } from "./steps.ts";
import type { Bring, SweepSpec } from "./sweeps.ts";

export { EXIT_SKIP_REASONS, type ExitSkipReason };

export type BuiltTx = Readonly<{
  wire: string;
  /** A swap on Jupiter's managed lane: the order the bytes answer. */
  requestId: string | null;
  rule: StepRule;
}>;

export type UnitBuilt =
  | Readonly<{
      ok: true;
      /** In the order they are sent. `chained` — each stands on the one before; else each stands alone. */
      txs: readonly BuiltTx[];
      chained: boolean;
      /** The coins the unit brings into the wallet. */
      brings: readonly Bring[];
      /** The rent of the accounts the unit closes, back to the wallet as SOL. */
      rentLamports: bigint;
      /** Ryntra's fee on the unit's swap, basis points; null — no swap, or no fee. */
      feeBps: number | null;
    }>
  | Readonly<{ ok: false; reason: ExitSkipReason }>;

export type ExitPorts = Readonly<{
  /** A Meteora DLMM or DAMM v2 position: all its liquidity out with its fees and rewards, closed when nothing is locked — or its fees and rewards only. */
  pool(request: Readonly<{ owner: string; venue: "meteora-dlmm" | "meteora-damm-v2"; position: string; mode: "exit" | "collect"; close: boolean }>): Promise<UnitBuilt>;
  /** A DLMM Pro position, through earning's own door. */
  pro(request: Readonly<{ owner: string; pool: string; nftMint: string; mode: "exit" | "collect" }>): Promise<UnitBuilt>;
  /** A Jupiter Lend deposit taken back: all of it, or what the market can pay now. */
  lend(request: Readonly<{ owner: string; market: string }>): Promise<UnitBuilt>;
  /** A native stake account: withdrawn whole, or deactivated. */
  stake(request: Readonly<{ owner: string; account: string; op: "withdraw" | "deactivate" }>): Promise<UnitBuilt>;
  /** A coin of the wallet swapped by the swap engine, as its own screen swaps it. */
  swap(request: Readonly<{ owner: string; mint: string; decimals: number; amountRaw: string; outMint: string }>): Promise<UnitBuilt>;
  /** What arrived swapped into the target: a sweep through Zap Out, or a fixed swap of SOL. `inUsd`, `outUsd` — a unit's price, for the reference. */
  sweep(request: Readonly<{ owner: string; spec: SweepSpec; inUsd: number | null; outUsd: number | null }>): Promise<UnitBuilt>;
}>;

/**
 * Whether Jupiter carries a coin into `outMint` now, at this amount — the Swap card's own read-only quote, nothing
 * built: `true` — it quotes a route; `false` — it says it has none; `null` — no clear answer (a full window, a venue
 * that did not answer, swapping paused). The overview asks it so that a coin with no route is not offered as one that
 * sells.
 */
export type ExitRoutable = (request: Readonly<{ mint: string; amountRaw: string; outMint: string }>) => Promise<boolean | null>;

/** The chain as the service needs it: narrow, so a test stands in for it. */
export type ExitChain = Readonly<{
  /** Whether the network takes the transaction as built, now. */
  simulate(wire: string): Promise<boolean>;
  /** The lookup tables at these addresses; one missing is absent from the map. */
  tables(keys: readonly string[]): Promise<ReadonlyMap<string, AddressLookupTableAccount>>;
  /** Send signed bytes once, preflight on; throws with the endpoint's own words on a refusal. */
  send(wire: string, ms: number): Promise<void>;
  /** Where a signature stands: `err` when it failed, `confirmed` when it landed; undefined — not seen. */
  status(signature: string, ms: number): Promise<Readonly<{ err: unknown; confirmed: boolean }> | undefined>;
  /** How long from now the bytes just built may still be signed, ms — their blockhash's life less the relay's time. */
  signableMs(): Promise<number>;
  /** The wallet's lamports now; throws when the chain does not answer. */
  lamports(owner: string): Promise<bigint>;
}>;
