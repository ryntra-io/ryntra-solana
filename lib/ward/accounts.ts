/**
 * Account states as the check reads them — before the transaction (the chain now) and after it (the simulation) —
 * and the two layouts it needs to read inside them: a token account (the same 165 bytes under both token programs)
 * and a mint (the official Token-2022 decoder, which reads every extension by name).
 */

import { getBase58Decoder } from "@solana/kit";

import { decodeMintBytes } from "../solana/mint.ts";
import { SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAMS } from "./known.ts";

export type AccountState = Readonly<{
  lamports: bigint;
  /** The program that owns the account. */
  owner: string;
  data: Uint8Array;
}>;

const base58 = getBase58Decoder();
export const encodeAddress = (bytes: Uint8Array): string => base58.decode(bytes);

/** An account as an RPC answers it in base64 (`getMultipleAccounts`, a simulation's `accounts`), or null. */
export function accountFromRpc(entry: unknown): AccountState | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as { lamports?: unknown; owner?: unknown; data?: unknown };
  const lamports =
    typeof row.lamports === "bigint" ? row.lamports : typeof row.lamports === "number" && Number.isSafeInteger(row.lamports) ? BigInt(row.lamports) : null;
  if (lamports === null || lamports < 0n || typeof row.owner !== "string") return null;
  let data = new Uint8Array(0);
  if (Array.isArray(row.data) && typeof row.data[0] === "string") data = new Uint8Array(Buffer.from(row.data[0], "base64"));
  else if (typeof row.data === "string") data = new Uint8Array(Buffer.from(row.data, "base64"));
  /* A simulation reports an account the transaction closed as zero lamports owned by the System program. */
  if (lamports === 0n && row.owner === SYSTEM_PROGRAM && data.length === 0) return null;
  return { lamports, owner: row.owner, data };
}

export type TokenAccount = Readonly<{
  mint: string;
  owner: string;
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
  frozen: boolean;
  closeAuthority: string | null;
}>;

const U64_MAX = (1n << 64n) - 1n;
export { U64_MAX };

function u64(data: Uint8Array, at: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(at, true);
}

function u32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true);
}

function optionKey(data: Uint8Array, at: number): string | null {
  return u32(data, at) === 1 ? encodeAddress(data.subarray(at + 4, at + 36)) : null;
}

/**
 * A token account: mint 0..32, owner 32..64, amount 64..72, delegate 72..108, state 108, native 109..121, delegated
 * amount 121..129, close authority 129..165. A Token-2022 account longer than 165 bytes carries its type at 165 (2).
 */
export function readTokenAccount(state: AccountState | null): TokenAccount | null {
  if (!state || !TOKEN_PROGRAMS.has(state.owner) || state.data.length < 165) return null;
  const data = state.data;
  if (data.length === 82) return null;
  if (data.length > 165 && (state.owner !== TOKEN_2022_PROGRAM || data[165] !== 2)) return null;
  const status = data[108];
  if (status !== 1 && status !== 2) return null;
  return {
    mint: encodeAddress(data.subarray(0, 32)),
    owner: encodeAddress(data.subarray(32, 64)),
    amount: u64(data, 64),
    delegate: optionKey(data, 72),
    frozen: status === 2,
    delegatedAmount: u64(data, 121),
    closeAuthority: optionKey(data, 129),
  };
}

export type MintRead = Readonly<{
  program: "spl-token" | "spl-token-2022";
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  permanentDelegate: string | null;
  transferHook: string | null;
  /** New accounts of the mint start frozen. */
  frozenByDefault: boolean;
  nonTransferable: boolean;
  /** Null when the mint cannot be paused. */
  paused: boolean | null;
  /** The fee in force now, in basis points; null without a transfer fee. */
  transferFeeBps: number | null;
  extensions: readonly string[];
}>;

const ZERO_KEY = "11111111111111111111111111111111";
const someKey = (option: unknown): string | null => {
  if (!option || typeof option !== "object") return typeof option === "string" && option !== ZERO_KEY ? option : null;
  const value = option as { __option?: string; value?: unknown };
  return value.__option === "Some" && typeof value.value === "string" && value.value !== ZERO_KEY ? value.value : null;
};

/** A mint, with the extensions that change what holding or moving it means. Null when the bytes are not a mint. */
export function readMint(state: AccountState | null, epoch: bigint | null = null): MintRead | null {
  if (!state || !TOKEN_PROGRAMS.has(state.owner)) return null;
  if (state.data.length !== 82 && !(state.owner === TOKEN_2022_PROGRAM && state.data.length > 165 && state.data[165] === 1)) return null;
  let decoded: ReturnType<typeof decodeMintBytes>;
  try {
    decoded = decodeMintBytes(state.data);
  } catch {
    return null;
  }
  if (!decoded.isInitialized) return null;
  const extensions = (decoded.extensions.__option === "Some" ? decoded.extensions.value : []) as readonly Readonly<Record<string, unknown> & { __kind: string }>[];
  const find = (kind: string) => extensions.find((extension) => extension.__kind === kind) ?? null;
  const delegate = find("PermanentDelegate");
  const hook = find("TransferHook");
  const defaultState = find("DefaultAccountState");
  const pausable = find("PausableConfig");
  const fee = find("TransferFeeConfig") as (Readonly<Record<string, unknown>> & {
    olderTransferFee?: { epoch: bigint; transferFeeBasisPoints: number };
    newerTransferFee?: { epoch: bigint; transferFeeBasisPoints: number };
  }) | null;
  let transferFeeBps: number | null = null;
  if (fee?.newerTransferFee && fee.olderTransferFee) {
    transferFeeBps = epoch !== null && epoch < BigInt(fee.newerTransferFee.epoch) ? fee.olderTransferFee.transferFeeBasisPoints : fee.newerTransferFee.transferFeeBasisPoints;
  }
  return {
    program: state.owner === TOKEN_2022_PROGRAM ? "spl-token-2022" : "spl-token",
    decimals: decoded.decimals,
    supply: decoded.supply,
    mintAuthority: someKey(decoded.mintAuthority),
    freezeAuthority: someKey(decoded.freezeAuthority),
    permanentDelegate: delegate ? someKey(delegate.delegate) ?? (typeof delegate.delegate === "string" && delegate.delegate !== ZERO_KEY ? delegate.delegate : null) : null,
    transferHook: hook ? (typeof hook.programId === "string" && hook.programId !== ZERO_KEY ? hook.programId : someKey(hook.programId)) : null,
    frozenByDefault: defaultState ? String(defaultState.state).toLowerCase() === "frozen" || defaultState.state === 2 : false,
    nonTransferable: find("NonTransferable") !== null,
    paused: pausable ? Boolean(pausable.paused) : null,
    transferFeeBps,
    extensions: extensions.map((extension) => extension.__kind),
  };
}

/** A plain wallet: owned by the System program and holding no data. A missing account is one that was never funded. */
export function isWalletState(state: AccountState | null): boolean {
  return state === null || (state.owner === SYSTEM_PROGRAM && state.data.length === 0);
}
