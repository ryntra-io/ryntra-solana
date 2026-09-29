/**
 * Exact asset identity on Stellar.
 *
 * "USDC" is not an identity. There are many assets called USDC on Stellar and
 * only one of them is Circle's; the identity is the code **plus the issuer**,
 * and getting that wrong is not a display bug — it is the user holding a
 * different asset than they believe. Every function here refuses ambiguous or
 * malformed input rather than repairing it, because a repaired identity is a
 * confident wrong answer.
 *
 * Three models coexist and are not interchangeable:
 *
 * - `CLASSIC` — a code/issuer pair in the ledger's native asset system.
 * - `SAC` — the Stellar Asset Contract: the same classic asset exposed through
 *   a contract address, so it can be used by Soroban contracts.
 * - `SEP41` — a token that exists only as a contract and has no classic pair.
 *
 * A classic asset and its SAC are the *same* asset reachable two ways, which is
 * why `contractId` lives on the identity instead of creating a second one.
 */

export type AssetModel = "CLASSIC" | "SAC" | "SEP41";

export type AssetIdentity = Readonly<{
  model: AssetModel;
  /** `XLM` for the native asset; the alphanumeric code otherwise. */
  code: string;
  /** The G-address that issued it. `null` only for the native asset. */
  issuer: string | null;
  /** The C-address, when the asset is reachable as a contract. */
  contractId: string | null;
  /**
   * Classic assets and their SACs are fixed at seven. A SEP-41 token declares
   * its own and we have not read it, which is `null` rather than a guess.
   */
  decimals: number | null;
  native: boolean;
}>;

/** StrKey is base32 over this alphabet, 56 characters for both G and C keys. */
const STRKEY = /^[A-Z2-7]{56}$/;
const ALPHANUM = /^[A-Za-z0-9]+$/;

export const NATIVE_DECIMALS = 7;

export function isAccountAddress(value: string): boolean {
  return value.startsWith("G") && STRKEY.test(value);
}

export function isContractAddress(value: string): boolean {
  return value.startsWith("C") && STRKEY.test(value);
}

/** Horizon's own name for the shape, which also bounds the code length. */
export function classicAssetType(code: string): "native" | "credit_alphanum4" | "credit_alphanum12" | null {
  if (code === "XLM") return "native";
  if (!ALPHANUM.test(code)) return null;
  if (code.length >= 1 && code.length <= 4) return "credit_alphanum4";
  if (code.length >= 5 && code.length <= 12) return "credit_alphanum12";
  return null;
}

export const NATIVE_ASSET: AssetIdentity = {
  model: "CLASSIC",
  code: "XLM",
  issuer: null,
  contractId: null,
  decimals: NATIVE_DECIMALS,
  native: true,
};

export type AssetParseError = Readonly<{ ok: false; reason: string }>;
export type AssetParseOk = Readonly<{ ok: true; asset: AssetIdentity }>;
export type AssetParseResult = AssetParseOk | AssetParseError;

/**
 * Parse the canonical text form.
 *
 * Accepted: `native` or `XLM`; `CODE:ISSUER`; a bare `C…` contract address.
 * Everything else is refused with a reason — including a bare `USDC`, which is
 * the single most tempting input to accept and the one that would silently pick
 * an asset for the user.
 */
export function parseAsset(input: string): AssetParseResult {
  const value = input.trim();
  if (!value) return { ok: false, reason: "Empty asset identifier." };

  if (value === "native" || value === "XLM") return { ok: true, asset: NATIVE_ASSET };

  if (isContractAddress(value)) {
    /* A contract address alone cannot tell us whether it is a SAC wrapping a
       classic asset or a standalone SEP-41 token, and the difference matters:
       one has an issuer with freeze and clawback powers, the other has an admin
       whose powers we have not read. Resolving it needs a contract read, so the
       model stays SEP41 — the weaker, more cautious of the two — until
       something with evidence says otherwise. */
    return {
      ok: true,
      asset: { model: "SEP41", code: "", issuer: null, contractId: value, decimals: null, native: false },
    };
  }

  const separator = value.indexOf(":");
  if (separator === -1) {
    return {
      ok: false,
      reason: `"${value}" names no issuer. Many different assets share a code on Stellar, so an asset is identified as CODE:ISSUER.`,
    };
  }

  const code = value.slice(0, separator);
  const issuer = value.slice(separator + 1);
  if (classicAssetType(code) === null) {
    return { ok: false, reason: `"${code}" is not a valid asset code: 1–12 alphanumeric characters.` };
  }
  if (!isAccountAddress(issuer)) {
    return { ok: false, reason: `"${issuer}" is not a valid Stellar account address.` };
  }
  return {
    ok: true,
    asset: { model: "CLASSIC", code, issuer, contractId: null, decimals: NATIVE_DECIMALS, native: false },
  };
}

/** The canonical text form. Round-trips through `parseAsset`. */
export function formatAsset(asset: AssetIdentity): string {
  if (asset.native) return "native";
  if (asset.issuer) return `${asset.code}:${asset.issuer}`;
  if (asset.contractId) return asset.contractId;
  /* Unreachable through the constructors above, and a throw rather than a
     placeholder: an asset that cannot name itself must not be rendered. */
  throw new Error("Asset identity has neither an issuer nor a contract id.");
}

/**
 * Attach a discovered SAC contract id to a classic asset.
 *
 * The model becomes `SAC` because the same asset is now known to be reachable
 * through a contract. It stays the same asset: code, issuer and decimals do not
 * move, and a caller comparing identities must still see them as equal.
 */
export function withContractId(asset: AssetIdentity, contractId: string): AssetIdentity {
  if (!isContractAddress(contractId)) {
    throw new Error(`"${contractId}" is not a valid Stellar contract address.`);
  }
  if (asset.model === "SEP41") return { ...asset, contractId };
  return { ...asset, model: "SAC", contractId };
}

/** Same asset, regardless of which way it is currently reachable. */
export function sameAsset(a: AssetIdentity, b: AssetIdentity): boolean {
  if (a.native || b.native) return a.native === b.native;
  if (a.issuer && b.issuer) return a.code === b.code && a.issuer === b.issuer;
  if (a.contractId && b.contractId) return a.contractId === b.contractId;
  return false;
}

/** Short display form. Never used as an identity — only for a label. */
export function assetLabel(asset: AssetIdentity): string {
  if (asset.native) return "XLM";
  if (asset.code) return asset.code;
  return asset.contractId ? `${asset.contractId.slice(0, 4)}…${asset.contractId.slice(-4)}` : "unknown";
}
