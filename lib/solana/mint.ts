/**
 * Reading one mint account and decoding what it structurally is.
 *
 * The decode path is deliberately split from the fetch path: fixtures store
 * the raw account bytes exactly as the RPC returned them, and the tests run
 * this decoder over those bytes — so what is tested offline is the real
 * decoder, not a snapshot of its output.
 */

import { getMintDecoder, type Mint } from "@solana-program/token-2022";
import type { SolanaNetwork, SolanaRpcHandle } from "./rpc.ts";
import { withRpcDiscipline } from "./rpc.ts";
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, type TokenProgramKind } from "./types.ts";

/** The raw material: what the chain returned, before any interpretation. */
export type RawMintAccount = Readonly<{
  mint: string;
  network: SolanaNetwork;
  /** Base58 owner program of the account. */
  owner: string;
  /** Account data exactly as returned, base64. */
  dataBase64: string;
  /** ISO-8601 — when this session observed it. */
  observedAt: string;
  /** Context slot the RPC answered at, when it said. */
  slot: string | null;
  endpointHost: string;
}>;

export type MintReadFailure = Readonly<{
  ok: false;
  code: "ACCOUNT_NOT_FOUND" | "NOT_A_MINT" | "DECODE_FAILED" | "RPC_FAILED";
  reason: string;
}>;

export type MintReadSuccess = Readonly<{
  ok: true;
  raw: RawMintAccount;
  programKind: Exclude<TokenProgramKind, "NOT_A_MINT">;
  decoded: Mint;
}>;

export type MintReadResult = MintReadSuccess | MintReadFailure;

export function programKindOf(owner: string): TokenProgramKind {
  if (owner === SPL_TOKEN_PROGRAM_ID) return "SPL_TOKEN";
  if (owner === TOKEN_2022_PROGRAM_ID) return "TOKEN_2022";
  return "NOT_A_MINT";
}

/**
 * Decode mint bytes with the official generated decoder, falling back to the
 * fixed classic layout for plain SPL mints if the generated decoder refuses.
 *
 * The fallback exists because the classic 82-byte layout is frozen consensus
 * history: decoding it by hand is safe, while guessing about Token-2022 TLV
 * by hand is exactly what this module must never do.
 */
export function decodeMintBytes(bytes: Uint8Array): Mint {
  try {
    return getMintDecoder().decode(bytes);
  } catch (failure) {
    if (bytes.length === 82) return decodeClassicMintLayout(bytes);
    throw failure;
  }
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Minimal base58 for 32-byte keys in the classic-layout fallback. */
export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out === "" ? "1" : out;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) + BigInt(bytes[offset + index]);
  return value;
}

function decodeClassicMintLayout(bytes: Uint8Array): Mint {
  const mintAuthorityPresent = bytes[0] === 1;
  const freezeAuthorityPresent = bytes[46] === 1;
  return {
    mintAuthority: mintAuthorityPresent
      ? { __option: "Some", value: base58Encode(bytes.subarray(4, 36)) as never }
      : { __option: "None" },
    supply: readU64LE(bytes, 36),
    decimals: bytes[44],
    isInitialized: bytes[45] === 1,
    freezeAuthority: freezeAuthorityPresent
      ? { __option: "Some", value: base58Encode(bytes.subarray(50, 82)) as never }
      : { __option: "None" },
    extensions: { __option: "None" },
  };
}

/** Fetch one account's raw bytes and owner through the disciplined handle. */
export async function fetchRawMintAccount(handle: SolanaRpcHandle, mint: string): Promise<RawMintAccount | MintReadFailure> {
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getAccountInfo(mint as never, { encoding: "base64" })
        .send({ abortSignal }),
    );
    const observedAt = new Date().toISOString();
    if (!response.value) {
      return { ok: false, code: "ACCOUNT_NOT_FOUND", reason: `No account exists at ${mint} on ${handle.network}.` };
    }
    const [dataBase64] = response.value.data;
    return {
      mint,
      network: handle.network,
      owner: String(response.value.owner),
      dataBase64,
      observedAt,
      slot: response.context?.slot !== undefined ? String(response.context.slot) : null,
      endpointHost: handle.host(),
    };
  } catch (failure) {
    return {
      ok: false,
      code: "RPC_FAILED",
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}

/** The full read: fetch, classify the owner, decode. Never throws. */
export async function readMintAccount(handle: SolanaRpcHandle, mint: string): Promise<MintReadResult> {
  const raw = await fetchRawMintAccount(handle, mint);
  if ("ok" in raw) return raw;
  return decodeRawMintAccount(raw);
}

/** Decode an already-fetched (or fixture-loaded) raw account. Never throws. */
export function decodeRawMintAccount(raw: RawMintAccount): MintReadResult {
  const programKind = programKindOf(raw.owner);
  if (programKind === "NOT_A_MINT") {
    return {
      ok: false,
      code: "NOT_A_MINT",
      reason: `Account ${raw.mint} is owned by ${raw.owner}, which is neither token program — it is not a mint.`,
    };
  }
  try {
    const bytes = Uint8Array.from(Buffer.from(raw.dataBase64, "base64"));
    return { ok: true, raw, programKind, decoded: decodeMintBytes(bytes) };
  } catch (failure) {
    return {
      ok: false,
      code: "DECODE_FAILED",
      reason: `Mint data at ${raw.mint} did not decode: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}
