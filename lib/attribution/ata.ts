/**
 * The canonical fee accounts of a product fee wallet — the associated token
 * account of each fee mint, the one a fee is sent to.
 *
 * A fee wallet is a published plain address: anybody can open more token
 * accounts it owns. Only these canonical accounts are its fee accounts — for
 * the chain reader, the rule, the Dune queries and the registry route alike —
 * so nothing anybody else opens can enter its figures or its history.
 */

import { address as toAddress, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

import { FEE_WALLET_MINTS } from "./rule.ts";

const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const LEGACY_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** The associated token account of an owner for a mint, under the legacy token program. */
export async function associatedTokenAccount(owner: string, mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: toAddress(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [encoder.encode(toAddress(owner)), encoder.encode(toAddress(LEGACY_TOKEN_PROGRAM)), encoder.encode(toAddress(mint))],
  });
  return pda;
}

/** A fee wallet's canonical fee accounts, one per fee mint, in the order of the mints. */
export async function feeWalletAccounts(owner: string): Promise<readonly Readonly<{ mint: string; account: string }>[]> {
  const accounts: { mint: string; account: string }[] = [];
  for (const mint of FEE_WALLET_MINTS) accounts.push({ mint, account: await associatedTokenAccount(owner, mint) });
  return accounts;
}
