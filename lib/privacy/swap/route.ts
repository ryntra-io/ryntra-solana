/**
 * The market route of a private swap is the open swap's own exact order — the bytes the swap's card already built on
 * the server from Jupiter `/build` with Ryntra's fee in them, checked and simulated there (`lib/core/solana-swap/**`).
 * Nothing new is asked from Jupiter, no fee is added or changed: this file only reads those bytes.
 *
 * - `routeOf` — the route's shape for the path's choice (`plan.ts`): its addresses, whether it reads lookup tables, its
 *   instructions' sizes, who must sign, the compute limit it set.
 * - `routeInstructions` — the route's own instructions, compute budget left out, to stand inside one version 1
 *   transaction; only for a route without lookup tables (a v1 transaction has none).
 * - `boughtAccount` — where the route pays the coin bought: the token account its setup opens for the person, so the
 *   step back into the ring can be built before the swap has landed.
 */

import { AccountRole, decompileTransactionMessage, getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';

import type { RouteShape } from './plan.ts';

export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

type Compiled = Readonly<{
  header: Readonly<{ numSignerAccounts: number; numReadonlySignerAccounts: number; numReadonlyNonSignerAccounts: number }>;
  staticAccounts: readonly string[];
  instructions: readonly Readonly<{ programAddressIndex: number; accountIndices?: readonly number[]; data?: Uint8Array | Readonly<ArrayLike<number>> }>[];
  addressTableLookups?: readonly unknown[];
  lifetimeToken: string;
  version: unknown;
}>;

export function compiledOf(wireBase64: string): Compiled {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wireBase64));
  return getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as Compiled;
}

/** The compute limit a compute-budget instruction sets (`SetComputeUnitLimit`, tag 2), or null. */
function limitOf(data: Readonly<ArrayLike<number>> | undefined): number | null {
  if (!data || data.length !== 5 || data[0] !== 2) return null;
  return (data[1] | (data[2] << 8) | (data[3] << 16)) + data[4] * 0x1000000;
}

/** The route's shape from the open order's exact bytes. */
export function routeOf(wireBase64: string): RouteShape {
  const m = compiledOf(wireBase64);
  const tables = (m.addressTableLookups?.length ?? 0) > 0;
  const signerCount = m.header.numSignerAccounts;
  const at = (i: number): string | null => (i < m.staticAccounts.length ? m.staticAccounts[i] : null);
  const addresses = new Set<string>();
  const signers = new Set<string>();
  const instructions: { accounts: number; data: number }[] = [];
  let computeUnits: number | null = null;
  for (const ix of m.instructions) {
    const program = at(ix.programAddressIndex);
    if (program === COMPUTE_BUDGET_PROGRAM) {
      computeUnits = limitOf(ix.data) ?? computeUnits;
      continue;
    }
    if (program) addresses.add(program);
    const indices = ix.accountIndices ?? [];
    for (const i of indices) {
      const a = at(i);
      if (a) addresses.add(a);
      if (i < signerCount && a) signers.add(a);
    }
    instructions.push({ accounts: indices.length, data: ix.data?.length ?? 0 });
  }
  // The fee payer signs the open order whether or not an instruction names it.
  if (m.staticAccounts[0]) signers.add(m.staticAccounts[0]);
  return { addresses: [...addresses], tables, instructions, signers: [...signers], computeUnits };
}

export type RouteInstruction = Readonly<{
  programAddress: string;
  accounts: readonly Readonly<{ address: string; role: AccountRole }>[];
  data: Uint8Array;
}>;

/** The route's own instructions without the compute budget — only for bytes that read no lookup table. */
export function routeInstructions(wireBase64: string): readonly RouteInstruction[] {
  const m = compiledOf(wireBase64);
  if ((m.addressTableLookups?.length ?? 0) > 0) throw new Error('the route reads lookup tables and cannot stand in a version 1 transaction');
  const message = decompileTransactionMessage(m as never) as unknown as { instructions: readonly { programAddress: string; accounts?: readonly { address: string; role: AccountRole }[]; data?: Uint8Array }[] };
  return message.instructions
    .filter((ix) => ix.programAddress !== COMPUTE_BUDGET_PROGRAM)
    .map((ix) => ({ programAddress: ix.programAddress, accounts: (ix.accounts ?? []).map((a) => ({ address: a.address, role: a.role })), data: new Uint8Array(ix.data ?? []) }));
}

/**
 * The token account the route opens for the person in the coin bought (associated-token «create»: payer, account,
 * owner, mint, system, token program), with its token program; null when the route opens none — the account exists
 * already and is read from the chain. Plain SOL needs no account: null too.
 */
export function boughtAccount(wireBase64: string, owner: string, outMint: string): Readonly<{ account: string; program: string }> | null {
  const m = compiledOf(wireBase64);
  for (const ix of m.instructions) {
    if (m.staticAccounts[ix.programAddressIndex] !== ASSOCIATED_TOKEN_PROGRAM) continue;
    const [, account, holder, mint, , program] = (ix.accountIndices ?? []).map((i) => m.staticAccounts[i] ?? null);
    if (account && program && holder === owner && mint === outMint) return { account, program };
  }
  return null;
}
