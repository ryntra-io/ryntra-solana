import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import type { FeeShare } from '../../../lib/core/launch/fee-shares.ts';

/**
 * The sharing of a launch's fees, read before the wallet sees it (CITY-212). The review showed who gets what; the
 * engine built a second transaction for it. Before the creator's wallet is opened, the city reads those bytes back and
 * signs nothing that is not exactly what the review showed:
 *
 * - the creator pays its fee, and only the creator and the new mint sign it (the mint is the vault's seed);
 * - it lands in the creation's own blockhash, right after it;
 * - two instructions and nothing else: Meteora's Dynamic Fee Sharing makes the vault with the shares the review showed —
 *   the same wallets, the same parts, in the same order —, and the bonding curve hands the curve's creator role from the
 *   creator to that vault.
 *
 * The layouts are the programs' own IDLs (`@meteora-ag/dynamic-fee-sharing-sdk` 1.x `initialize_fee_vault_pda`,
 * `@meteora-ag/dynamic-bonding-curve-sdk` `transfer_pool_creator`); the test builds the engine's real instructions and
 * checks this reader against them. Loaded only when a launch shares its fees.
 */

export const FEE_SHARING_PROGRAM = 'dfsdo2UqvwfN8DuUVrMRNfQe11VaiNoKcMqLHVvDPzh';
export const BONDING_CURVE_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';

const INIT_VAULT = [250, 250, 156, 113, 88, 143, 60, 233];
const HANDOVER = [20, 7, 169, 33, 58, 147, 166, 33];
/** `initialize_fee_vault_pda`: discriminator, `padding: [u64; 8]`, then `users: Vec<{ address, share: u32 }>`. */
const PADDING_BYTES = 64;
const USER_BYTES = 36;
/* The accounts by the IDL's order. */
const VAULT_AT = { feeVault: 0, tokenMint: 3, owner: 4, base: 5, payer: 6 } as const;
const HANDOVER_AT = { creator: 2, newCreator: 3 } as const;

export type SplitCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const starts = (data: Uint8Array, prefix: readonly number[]) => prefix.every((byte, i) => data[i] === byte);

function read(wire: string): VersionedTransaction | null {
  try {
    return VersionedTransaction.deserialize(fromBase64(wire));
  } catch {
    return null;
  }
}

export function checkSplit(args: Readonly<{ creationWire: string; splitWire: string; creator: string; token: string; feeVault: string | null | undefined; shares: readonly FeeShare[] }>): SplitCheck {
  const no = (reason: string): SplitCheck => ({ ok: false, reason });
  if (!args.feeVault) return no('No vault named.');
  const tx = read(args.splitWire);
  const creation = read(args.creationWire);
  if (!tx || !creation) return no('Unreadable transaction.');
  const message = tx.message;
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  if (message.addressTableLookups.length) return no('Unexpected lookup tables.');
  if (keys[0] !== args.creator) return no('The creator does not pay for it.');
  const signers = keys.slice(0, message.header.numRequiredSignatures);
  if (signers.length !== 2 || !signers.includes(args.creator) || !signers.includes(args.token)) return no('Unexpected signers.');
  if (message.recentBlockhash !== creation.message.recentBlockhash) return no('Not the creation’s window.');
  const instructions = message.compiledInstructions;
  if (instructions.length !== 2) return no('Unexpected instructions.');
  const [init, handover] = instructions as [(typeof instructions)[number], (typeof instructions)[number]];
  const account = (ix: (typeof instructions)[number], at: number) => keys[ix.accountKeyIndexes[at] ?? -1];

  /* The vault, with the shares the review showed. */
  if (keys[init.programIdIndex] !== FEE_SHARING_PROGRAM || !starts(init.data, INIT_VAULT)) return no('Not the vault the review showed.');
  if (account(init, VAULT_AT.feeVault) !== args.feeVault || account(init, VAULT_AT.base) !== args.token) return no('Another vault.');
  if (account(init, VAULT_AT.owner) !== args.creator || account(init, VAULT_AT.payer) !== args.creator) return no('Another owner.');
  const data = init.data;
  const head = INIT_VAULT.length + PADDING_BYTES;
  if (data.length !== head + 4 + USER_BYTES * args.shares.length) return no('Other shares.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.subarray(INIT_VAULT.length, head).some((byte) => byte !== 0)) return no('Other shares.');
  if (view.getUint32(head, true) !== args.shares.length) return no('Other shares.');
  for (const [i, share] of args.shares.entries()) {
    const at = head + 4 + USER_BYTES * i;
    if (new PublicKey(data.subarray(at, at + 32)).toBase58() !== share.address || view.getUint32(at + 32, true) !== share.bps) return no('Other shares.');
  }

  /* The curve's creator role, from the creator to that vault. */
  if (keys[handover.programIdIndex] !== BONDING_CURVE_PROGRAM || handover.data.length !== HANDOVER.length || !starts(handover.data, HANDOVER)) return no('Not the handover the review showed.');
  if (account(handover, HANDOVER_AT.creator) !== args.creator || account(handover, HANDOVER_AT.newCreator) !== args.feeVault) return no('Handed to another.');
  return { ok: true };
}
