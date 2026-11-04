import { VersionedTransaction } from '@solana/web3.js';

/**
 * The checks the window makes on the mandate's transactions (CITY-174), before the wallet and after it — loaded with
 * `mandate-sign.ts` on the tap.
 */

const SSA = 'SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG';
const ALLOWED = new Set([SSA, '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL']);

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

/**
 * The server's unsigned transactions, read before the wallet sees them: each is the person's alone — she pays, she is
 * the only signer — and calls nothing but her smart account, the token and system programs. The agent's own key is
 * named only inside the policy's data; it signs none of these.
 */
export function checkUnsigned(transactions: readonly string[], owner: string): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  if (!transactions.length || transactions.length > 3) return { ok: false, reason: 'Unexpected number of transactions.' };
  for (const wire of transactions) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(fromBase64(wire));
    } catch {
      return { ok: false, reason: 'Unreadable transaction.' };
    }
    const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
    if (keys[0] !== owner || tx.message.header.numRequiredSignatures !== 1) return { ok: false, reason: 'Unexpected signers.' };
    if (tx.message.addressTableLookups.length) return { ok: false, reason: 'Unexpected lookup tables.' };
    if (tx.message.compiledInstructions.some((ix) => !ALLOWED.has(keys[ix.programIdIndex] ?? ''))) return { ok: false, reason: 'A program outside the mandate.' };
    if (!tx.message.compiledInstructions.some((ix) => keys[ix.programIdIndex] === SSA)) return { ok: false, reason: 'Not a mandate transaction.' };
  }
  return { ok: true };
}

/** What the wallet hands back is the same message, signed: nothing changed between the check and the signature. */
export function sameMessage(unsignedWire: string, signedWire: string): boolean {
  try {
    const a = VersionedTransaction.deserialize(fromBase64(unsignedWire)).message.serialize();
    const b = VersionedTransaction.deserialize(fromBase64(signedWire));
    return a.length === b.message.serialize().length && a.every((byte, index) => byte === b.message.serialize()[index]) && !(b.signatures[0] ?? new Uint8Array(64)).every((byte) => byte === 0);
  } catch {
    return false;
  }
}
