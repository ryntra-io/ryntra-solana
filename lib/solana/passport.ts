/**
 * Assembling the Solana Asset Passport from a decoded mint.
 *
 * Pure over its inputs: the passport is a function of the raw account and
 * nothing else, so fixtures and live reads produce byte-identical passports
 * for byte-identical accounts. Anything unresolvable stays visible as its
 * own honest state — this module never fills a gap with a guess.
 */

import type { Mint } from "@solana-program/token-2022";
import { decodeRawMintAccount, type MintReadFailure, type RawMintAccount } from "./mint.ts";
import { describeExtension } from "./semantics.ts";
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type MintAuthorityFact,
  type SolanaAssetPassport,
  type SolanaExtensionFact,
} from "./types.ts";

function unwrapAddress(option: Mint["mintAuthority"]): string | null {
  return option.__option === "Some" ? String(option.value) : null;
}

function authorityFact(value: string | null, role: "mint" | "freeze"): MintAuthorityFact {
  if (value === null) {
    return {
      value: null,
      provenance: "ONCHAIN_VERIFIED",
      meaning:
        role === "mint"
          ? "No mint authority: the supply is fixed and nobody can mint more."
          : "No freeze authority: nobody can freeze holders' token accounts.",
    };
  }
  return {
    value,
    provenance: "ONCHAIN_VERIFIED",
    meaning:
      role === "mint"
        ? "This authority can mint new tokens and change the supply."
        : "This authority can freeze any holder's token account.",
  };
}

export type PassportBuildResult =
  | Readonly<{ ok: true; passport: SolanaAssetPassport }>
  | MintReadFailure;

/** Build a passport from raw account material. Never throws. */
export function buildPassport(raw: RawMintAccount): PassportBuildResult {
  const read = decodeRawMintAccount(raw);
  if (!read.ok) return read;
  const { decoded, programKind } = read;

  const extensionList: readonly SolanaExtensionFact[] =
    decoded.extensions.__option === "Some" ? decoded.extensions.value.map(describeExtension) : [];

  const unsupportedKinds = extensionList
    .filter((fact) => fact.meaning.includes("no written semantics"))
    .map((fact) => fact.kind);

  const passport: SolanaAssetPassport = {
    schema: "ryntra.solana.asset-passport",
    schemaVersion: "0.1.0",
    network: raw.network,
    identity: {
      mint: raw.mint,
      programKind,
      programId: programKind === "SPL_TOKEN" ? SPL_TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
      decimals: {
        value: decoded.decimals,
        provenance: "ONCHAIN_VERIFIED",
        meaning: `Amounts divide into ${decoded.decimals} decimal places.`,
      },
      supply: {
        value: decoded.supply.toString(),
        provenance: "ONCHAIN_VERIFIED",
        meaning: "Total raw supply at the observed slot, in base units.",
      },
      mintAuthority: authorityFact(unwrapAddress(decoded.mintAuthority), "mint"),
      freezeAuthority: authorityFact(unwrapAddress(decoded.freezeAuthority), "freeze"),
      isInitialized: {
        value: decoded.isInitialized,
        provenance: "ONCHAIN_VERIFIED",
        meaning: decoded.isInitialized ? "The mint is initialized." : "The mint account exists but is not initialized.",
      },
    },
    extensions: extensionList,
    unsupportedKinds,
    observedAt: raw.observedAt,
    source: {
      ref: `solana:${raw.network}:rpc:getAccountInfo/${raw.mint}`,
      label: `Solana ${raw.network} JSON-RPC (${raw.endpointHost})`,
    },
  };
  return { ok: true, passport };
}
