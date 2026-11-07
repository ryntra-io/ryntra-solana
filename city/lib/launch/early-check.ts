import { VersionedTransaction } from '@solana/web3.js';
import type { LaunchEarlyAccessBuildResponse } from '../../../lib/api/v1/contract.ts';
import { earlyAccessSchedule, presaleBpsOf, type EarlyAccessRules } from '../../../lib/core/launch/early-access.ts';
import type { Network } from './engine.ts';

/**
 * An early-access creation, read before the wallet sees it (CITY-212): the network the sheet is on, three transactions
 * in their order — the mint, the pool, the vault —, each paid for by the creator and signed by nobody the city does not
 * know, and the schedule and the vault's share exactly the ones the rules the sheet sent make. The engine reads every
 * instruction back before it answers (`earlyAccessCreationProblems`); this is the city's own look, so bytes for another
 * launch never reach the wallet. Loaded only when a launch opens early access.
 */

export type EarlyCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export function checkEarly(built: LaunchEarlyAccessBuildResponse, args: Readonly<{ network: Network; creator: string; rules: EarlyAccessRules }>): EarlyCheck {
  const no = (reason: string): EarlyCheck => ({ ok: false, reason });
  if (built.network !== args.network) return no('Another network.');
  if (built.unsignedWireBase64.length !== 3) return no('Unexpected number of transactions.');
  const schedule = earlyAccessSchedule(args.rules);
  for (const key of Object.keys(schedule) as (keyof typeof schedule)[]) if (built.schedule[key] !== schedule[key]) return no('Another schedule.');
  if (built.presaleBps !== presaleBpsOf(args.rules)) return no('Another share for the vault.');
  /* Each step names its own new account: the mint in the first, the pool in the second, the vault in the third. */
  const named = [built.mint, built.pool, built.vault];
  for (const [i, wire] of built.unsignedWireBase64.entries()) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(fromBase64(wire));
    } catch {
      return no('Unreadable transaction.');
    }
    const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
    if (tx.message.addressTableLookups.length) return no('Unexpected lookup tables.');
    if (keys[0] !== args.creator) return no('The creator does not pay for it.');
    if (!keys.includes(named[i]!)) return no('Another launch.');
    /* Only the creator and the fresh keys the engine makes for this creation sign: the mint, then the pool's position. */
    const signers = keys.slice(1, tx.message.header.numRequiredSignatures);
    if (i === 0 && !signers.includes(built.mint)) return no('Unexpected signers.');
    if (signers.length > 1) return no('Unexpected signers.');
  }
  return { ok: true };
}
