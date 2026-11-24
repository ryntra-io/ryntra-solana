/**
 * Meteora DLMM Pro's SDK behind one adapter (the review of 14.11 —
 * `docs/research/meteora-dlmm-pro-2026-11-14/REPORT.md`).
 *
 * DLMM Pro is a program of its own, not an upgrade of DLMM: `dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n` on mainnet
 * and devnet, release 0.1.0, open since 12.11.2026 as a beta whose interface Meteora may still break. So the SDK is
 * pinned exactly — `@meteora-ag/dlmm-pro-sdk` 0.1.3, no range — and `DLMM_PRO_SDK_VERSION` is held to the installed
 * copy by `./sdk.test.mjs`: an upgrade is a read of the changelog and a run of the rehearsal
 * (`scripts/launch-qa/dlmm-pro-rehearsal.mjs`), never a silent bump.
 *
 * The SDK brings its own Anchor 0.32.1, `@solana/spl-token` 0.4.15 and `bn.js` 5.2.5 beside the repository's 0.31.1,
 * 0.4.14 and 5.2.3. They never meet: the venue asks the SDK for every coder (the events' too), `@solana/web3.js` is one
 * copy for both (the repository's override), and a `BN` crosses only as a value the other copy reads by its words.
 * Everything that imports the SDK is a `*.server.ts` file — the venue is never in a browser bundle.
 *
 * One client per connection: making one builds the program's coders from the IDL, which costs processor and holds
 * nothing of a request. Kept here rather than in `../meteora-clients.server.ts`, so no route of the live Launch on DBC
 * loads this SDK.
 */

import { ACCESS_REGISTRY_PROGRAM_ID, DLMM_PRO_PROGRAM_ID, DlmmProClient, DlmmProIDL, PoolErrorCode } from "@meteora-ag/dlmm-pro-sdk";
import type { Connection } from "@solana/web3.js";

/** The SDK version this venue was read, built and rehearsed against. */
export const DLMM_PRO_SDK_VERSION = "0.1.3";
/** The program release the SDK's IDL describes — the one deployed on mainnet. */
export const DLMM_PRO_PROGRAM_VERSION = "0.1.0";

export const DLMM_PRO_PROGRAM = DLMM_PRO_PROGRAM_ID.toBase58();
/** Meteora's access registry: the owner of the token badges a pool's mints may need. Read, never called. */
export const DLMM_PRO_ACCESS_REGISTRY = ACCESS_REGISTRY_PROGRAM_ID.toBase58();

/** The version the IDL in the installed SDK names; the test holds it to `DLMM_PRO_PROGRAM_VERSION`. */
export const dlmmProIdlVersion = (): string => DlmmProIDL.metadata.version;

const CLIENTS = new WeakMap<Connection, DlmmProClient>();

/** The DLMM Pro client of this connection, at `confirmed`. */
export function dlmmProClientOf(connection: Connection): DlmmProClient {
  let client = CLIENTS.get(connection);
  if (!client) {
    client = new DlmmProClient(connection, "confirmed");
    CLIENTS.set(connection, client);
  }
  return client;
}

/** The eight bytes an account of the program starts with, from the IDL the venue is pinned to. */
export function accountDiscriminator(name: "Pool" | "PositionArray" | "LimitOrder" | "TickArray"): Uint8Array {
  const account = DlmmProIDL.accounts.find((entry) => entry.name === name);
  if (!account) throw new Error(`The IDL has no account ${name}.`);
  return Uint8Array.from(account.discriminator);
}

/** Why a read, a quote or a build was refused; the caller decides the person's words. */
export type DlmmProRefusalCode =
  | "BAD_INPUT"
  | "AMOUNT_ZERO"
  | "NO_POOL"
  | "POOL_EXISTS"
  | "NOT_OPEN"
  | "PAUSED"
  | "NO_LIQUIDITY"
  | "PARTIAL_FILL"
  | "BALANCE_LOW"
  | "NOTHING_TO_DO"
  | "TX_TOO_LARGE"
  | "FOREIGN_SIGNER"
  | "FAILED";

export class DlmmProRefusal extends Error {
  readonly code: DlmmProRefusalCode;
  /** The program's own error number when the SDK named one (6000…6050); null otherwise. */
  readonly program: number | null;

  constructor(code: DlmmProRefusalCode, message: string, program: number | null = null) {
    super(message);
    this.name = "DlmmProRefusal";
    this.code = code;
    this.program = program;
  }
}

/** The name of a program error number, as the IDL spells it; null for a number the release does not have. */
export function dlmmProErrorName(code: number): string | null {
  return (PoolErrorCode as unknown as Record<number, string | undefined>)[code] ?? null;
}

const SDK_REFUSALS: Readonly<Record<number, DlmmProRefusalCode>> = {
  [PoolErrorCode.AmountIsZero]: "AMOUNT_ZERO",
  [PoolErrorCode.LiquidityIsZero]: "NO_LIQUIDITY",
  [PoolErrorCode.InvalidActivationAccess]: "NOT_OPEN",
  [PoolErrorCode.InvalidParameters]: "BAD_INPUT",
  [PoolErrorCode.InvalidPermission]: "BAD_INPUT",
  [PoolErrorCode.InvalidTokenBadge]: "BAD_INPUT",
  [PoolErrorCode.InvalidRewardIndex]: "BAD_INPUT",
  [PoolErrorCode.LiquidityIsTooHigh]: "BAD_INPUT",
};

/**
 * What the SDK threw, as a refusal: its own `PoolError` keeps its program number and reads as the nearest reason; a
 * refusal passes through; anything else is `FAILED` with the first of its words.
 */
export function refusalOf(error: unknown): DlmmProRefusal {
  if (error instanceof DlmmProRefusal) return error;
  const code = (error as { code?: unknown; name?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message.slice(0, 300) : "The venue refused.";
  if ((error as { name?: unknown } | null)?.name === "PoolError" && typeof code === "number") return new DlmmProRefusal(SDK_REFUSALS[code] ?? "FAILED", message, code);
  return new DlmmProRefusal("FAILED", message);
}

/** Runs a read or a build and turns whatever it throws into a refusal. */
export async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw refusalOf(error);
  }
}
