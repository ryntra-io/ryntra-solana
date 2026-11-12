import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import type { Network } from './engine.ts';
import type { EntryAction } from './entry.ts';

/**
 * A step of early access, read before the wallet sees it (CITY-220): coming in with USDC, taking it back, the one buy
 * for everyone, the tokens, the rest of the USDC. The engine builds each one for this wallet alone — its fee payer and
 * only signer — and compares the signed bytes with the built ones before it sends; this is the city's own look, so a
 * transaction for another vault, another wallet or another amount never reaches the person's wallet:
 *
 * - this network; the wallet pays and is the only signer; no lookup tables;
 * - only Meteora's Alpha Vault and the associated-token program (opening the wallet's or the vault's own account);
 * - a withdrawal, a claim or the rest lands only in the wallet's own account of that mint;
 * - exactly one instruction of the step asked, on this launch's vault, for this wallet — and for a deposit, exactly the
 *   amount typed; a new deposit may first open the wallet's escrow in the same vault;
 * - the one buy for everyone (`FILL`) spends at most what the window showed deposited — its `max_amount` is exactly that
 *   figure, as the engine builds it from the vault (review 8.11).
 *
 * The layouts are the program's IDL (`@meteora-ag/alpha-vault` 1.1.x); the test builds them with the SDK's own coder.
 */

export const ALPHA_VAULT_PROGRAM = 'vaU6kP7iNEGkbmPkLmZfGwiGxd4Mob24QQCie5R9kd2';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** The wallet's own account of a mint: the engine sends a withdrawal or a claim there and nowhere else. */
export function walletAccount(wallet: string, mint: string, tokenProgram: string): string | null {
  try {
    return PublicKey.findProgramAddressSync([new PublicKey(wallet).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ASSOCIATED_TOKEN_PROGRAM))[0].toBase58();
  } catch {
    return null;
  }
}

export type EntryKind = 'DEPOSIT' | EntryAction;

/** Each step's instruction: its discriminator, where the vault and the wallet stand, and whether it carries an amount. */
type Lands = Readonly<{ destination: number; mint: number; tokenProgram: number }>;
/** Where a step that pays out names its destination, its mint and the mint's token program (the IDL's order). */
export const LANDS: Readonly<Partial<Record<EntryKind, Lands>>> = {
  WITHDRAW: { destination: 3, mint: 5, tokenProgram: 6 },
  WITHDRAW_REMAINING: { destination: 4, mint: 5, tokenProgram: 6 },
  CLAIM: { destination: 3, mint: 4, tokenProgram: 5 },
};
const STEPS: Readonly<Record<EntryKind, Readonly<{ data: readonly number[]; vault: number; wallet: number; amount: boolean; lands?: Lands }>>> = {
  DEPOSIT: { data: [242, 35, 198, 137, 82, 225, 242, 182], vault: 0, wallet: 7, amount: true },
  WITHDRAW: { data: [183, 18, 70, 156, 148, 109, 161, 34], vault: 0, wallet: 7, amount: true, lands: LANDS.WITHDRAW },
  WITHDRAW_REMAINING: { data: [54, 253, 188, 34, 100, 145, 59, 127], vault: 0, wallet: 7, amount: false, lands: LANDS.WITHDRAW_REMAINING },
  CLAIM: { data: [116, 206, 27, 191, 166, 19, 0, 73], vault: 0, wallet: 6, amount: false, lands: LANDS.CLAIM },
  FILL: { data: [221, 175, 108, 48, 19, 204, 125, 23], vault: 0, wallet: 15, amount: true },
};
/** `create_new_escrow`: the vault at 0, the owner at 3, the payer at 4. */
const NEW_ESCROW = { data: [60, 154, 170, 202, 252, 109, 83, 199], vault: 0, owner: 3, payer: 4 } as const;

export type EntryCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const starts = (data: Uint8Array, prefix: readonly number[]) => prefix.every((byte, i) => data[i] === byte);

export function checkEntry(args: Readonly<{ wire: string; builtNetwork: string; network: Network; kind: EntryKind; wallet: string; vault: string; amountRaw: string | null }>): EntryCheck {
  const no = (reason: string): EntryCheck => ({ ok: false, reason });
  if (args.builtNetwork !== args.network) return no('Another network.');
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(fromBase64(args.wire));
  } catch {
    return no('Unreadable transaction.');
  }
  const message = tx.message;
  if (message.addressTableLookups.length) return no('Unexpected lookup tables.');
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  if (keys[0] !== args.wallet || message.header.numRequiredSignatures !== 1) return no('Unexpected signers.');
  const want = STEPS[args.kind];
  let steps = 0;
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const account = (at: number) => keys[ix.accountKeyIndexes[at] ?? -1];
    if (program === ASSOCIATED_TOKEN_PROGRAM) {
      /* Opening an account, paid by the wallet: `create` (no data) or `create_idempotent` (1). */
      if ((ix.data.length > 1 || (ix.data.length === 1 && ix.data[0] !== 1)) || account(0) !== args.wallet) return no('Unexpected account.');
      /* The wallet's own account or the vault's — never a stranger's at the wallet's cost. */
      if (account(2) !== args.wallet && account(2) !== args.vault) return no('Unexpected account.');
      continue;
    }
    if (program !== ALPHA_VAULT_PROGRAM) return no('Unexpected program.');
    if (args.kind === 'DEPOSIT' && starts(ix.data, NEW_ESCROW.data) && !steps) {
      if (account(NEW_ESCROW.vault) !== args.vault || account(NEW_ESCROW.owner) !== args.wallet || account(NEW_ESCROW.payer) !== args.wallet) return no('Another vault.');
      continue;
    }
    if (!starts(ix.data, want.data) || steps) return no('Not the step shown.');
    steps += 1;
    if (account(want.vault) !== args.vault) return no('Another vault.');
    if (account(want.wallet) !== args.wallet) return no('Another wallet.');
    if (want.lands) {
      const mint = account(want.lands.mint);
      const tokenProgram = account(want.lands.tokenProgram);
      if (!mint || !tokenProgram || account(want.lands.destination) !== walletAccount(args.wallet, mint, tokenProgram)) return no('Another wallet.');
    }
    if (want.amount) {
      if (ix.data.length !== 16 || !args.amountRaw) return no('Another amount.');
      const amount = new DataView(ix.data.buffer, ix.data.byteOffset, 16).getBigUint64(8, true);
      if (amount.toString() !== args.amountRaw) return no('Another amount.');
    } else if (ix.data.length !== 8) return no('Not the step shown.');
  }
  if (steps !== 1) return no('Not the step shown.');
  return { ok: true };
}
