/**
 * Rent, from the chain rather than from provider prose.
 *
 * Jupiter's `/order` states `rentFeeLamports` and documents it as an
 * *estimate*. Measured on 2026-09-14: for a first purchase of NVDAx the
 * estimate was 1,488,440 lamports — the rent-exempt minimum of a plain
 * 165-byte token account under the live parameters (5,080 lamports per
 * byte-year, threshold 1) — while the simulation opened the taker a Token-2022
 * account of 179 bytes (ImmutableOwner, TransferHook and Pausable extensions,
 * as every xStock mint requires) holding 1,559,560. The owner-effect firewall
 * read the estimate as a ceiling and refused every tokenized stock a wallet
 * did not already hold.
 *
 * What the chain actually charges for an account is a function of two things
 * it states itself: the Rent sysvar's parameters and the account's size. This
 * module reads the first, takes the second from the simulation's own
 * post-execution account states, and computes the minimum exactly as the
 * runtime does (`Rent::minimum_balance`). The firewall then proves that an
 * account opened for the taker holds precisely its rent-exempt minimum — not
 * the venue's estimate, and never a lamport more.
 */

import { createSolanaRpcHandle, withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";

export const SYSVAR_RENT_ADDRESS = "SysvarRent111111111111111111111111111111111";
/** The runtime's per-account storage overhead, in bytes, counted for rent. */
export const ACCOUNT_STORAGE_OVERHEAD_BYTES = 128n;
/** The Rent sysvar is 17 bytes: u64 lamports per byte-year, f64 threshold, u8 burn percent. */
export const RENT_SYSVAR_BYTES = 17;

const RENT_CACHE_TTL_MS = 10 * 60_000;
const RENT_STALE_GRACE_MS = 6 * 60 * 60_000;

export type RentParameters = Readonly<{
  lamportsPerByteYear: bigint;
  exemptionThreshold: number;
  burnPercent: number;
}>;

/** One account as the simulation reports it after the transaction would have run. */
export type SimulatedAccountState = Readonly<{
  lamports: bigint;
  space: number;
  owner: string | null;
}>;

/**
 * `Rent::minimum_balance(data_len)`, as the runtime computes it: the storage
 * overhead plus the data length, times lamports per byte-year, as a float,
 * times the exemption threshold, truncated to an integer.
 *
 * Verified against `getMinimumBalanceForRentExemption` on mainnet on
 * 2026-09-14 under (5080, 1): 0 → 650,240 · 165 → 1,488,440 · 179 → 1,559,560;
 * and against the historical (3480, 2): 165 → 2,039,280.
 */
export function rentExemptMinimumLamports(rent: RentParameters, space: number | bigint): bigint {
  const length = typeof space === "bigint" ? space : BigInt(Math.trunc(space));
  if (length < 0n) throw new RangeError("An account cannot have negative space.");
  const base = (ACCOUNT_STORAGE_OVERHEAD_BYTES + length) * rent.lamportsPerByteYear;
  const threshold = rent.exemptionThreshold;
  if (!Number.isFinite(threshold) || threshold < 0) throw new RangeError("The rent exemption threshold is unreadable.");
  /* The runtime multiplies as f64 and truncates. Integer thresholds — the
     only ones the network has ever set — stay exact through this path. */
  if (Number.isInteger(threshold)) return base * BigInt(threshold);
  return BigInt(Math.floor(Number(base) * threshold));
}

/** The Rent sysvar's bytes → its parameters, or null when they are not 17 readable bytes. */
export function decodeRentSysvar(bytes: Uint8Array): RentParameters | null {
  if (bytes.byteLength < RENT_SYSVAR_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lamportsPerByteYear = view.getBigUint64(0, true);
  const exemptionThreshold = view.getFloat64(8, true);
  const burnPercent = view.getUint8(16);
  if (lamportsPerByteYear <= 0n || !Number.isFinite(exemptionThreshold) || exemptionThreshold <= 0 || burnPercent > 100) return null;
  return { lamportsPerByteYear, exemptionThreshold, burnPercent };
}

function decodedBase64Length(encoded: string): number {
  const trimmed = encoded.replace(/=+$/, "");
  return Math.floor((trimmed.length * 3) / 4);
}

/**
 * Pair the addresses a simulation was asked about with what it answered, in
 * order. `null` entries are accounts that do not exist after the transaction
 * and are simply absent from the map; a malformed entry is absent too, so a
 * caller that needs a state and finds none falls back to the stricter path
 * rather than trusting a guess.
 */
export function simulatedAccountStates(
  addresses: readonly string[],
  accounts: readonly unknown[] | null | undefined,
): ReadonlyMap<string, SimulatedAccountState> {
  const states = new Map<string, SimulatedAccountState>();
  if (!Array.isArray(accounts) || accounts.length !== addresses.length) return states;
  addresses.forEach((address, index) => {
    const entry = accounts[index];
    if (!entry || typeof entry !== "object") return;
    const row = entry as { lamports?: unknown; space?: unknown; owner?: unknown; data?: unknown };
    const lamports = typeof row.lamports === "bigint" ? row.lamports : typeof row.lamports === "number" && Number.isSafeInteger(row.lamports) ? BigInt(row.lamports) : null;
    let space: number | null = null;
    if (typeof row.space === "bigint") space = Number(row.space);
    else if (typeof row.space === "number" && Number.isSafeInteger(row.space)) space = row.space;
    else if (Array.isArray(row.data) && typeof row.data[0] === "string") space = decodedBase64Length(row.data[0]);
    if (lamports === null || lamports < 0n || space === null || space < 0 || !Number.isSafeInteger(space)) return;
    states.set(address, { lamports, space, owner: typeof row.owner === "string" ? row.owner : null });
  });
  return states;
}

let cached: { value: RentParameters; readAt: number } | null = null;

/**
 * The live Rent parameters, read from the sysvar and kept for ten minutes per
 * process. They change only with a feature activation — as they did before
 * 2026-09-14, from 3,480 lamports per byte-year at threshold 2 to 5,080 at
 * threshold 1 — so a stale read is still served for hours if the network is
 * briefly unreachable, and only an instance that has never read them fails.
 */
export async function readRentParameters(
  handle: SolanaRpcHandle = createSolanaRpcHandle({ network: "mainnet" }),
  deps: Readonly<{ now?: () => number }> = {},
): Promise<RentParameters> {
  const now = deps.now?.() ?? Date.now();
  if (cached && now - cached.readAt < RENT_CACHE_TTL_MS) return cached.value;
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getAccountInfo(SYSVAR_RENT_ADDRESS as never, { encoding: "base64", commitment: "confirmed" })
        .send({ abortSignal }),
    );
    const value = (response as { value: { data?: unknown } | null }).value;
    const encoded = value && Array.isArray(value.data) && typeof value.data[0] === "string" ? value.data[0] : null;
    const decoded = encoded === null ? null : decodeRentSysvar(Buffer.from(encoded, "base64"));
    if (!decoded) throw new Error("The Rent sysvar did not decode.");
    cached = { value: decoded, readAt: now };
    return decoded;
  } catch (failure) {
    if (cached && now - cached.readAt < RENT_STALE_GRACE_MS) return cached.value;
    throw failure instanceof Error ? failure : new Error(String(failure));
  }
}

/** Test seam: forget the cached parameters. */
export function resetRentParametersCache(): void {
  cached = null;
}
