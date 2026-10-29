/**
 * The move to the DEX as its own transaction records it — the two positions
 * the curve's migration opened in the graduated DAMM v2 pool, the exit
 * liquidity locked for ever (half the partner's, half the creator's on every
 * preset), each with the mint and the account of its NFT.
 *
 * Those two are the positions «LP замкнено назавжди» speaks of. Anyone may add
 * a position of their own to the same pool later — the creator through «Заробляй
 * у пулі» too —; such an entry is a holder's position, not the exit's, so a mark
 * and the creator's locked-LP fees are read from the positions named here and
 * never from whatever positions a wallet holds.
 *
 * Pure: the transaction is read by `./exit-positions.server.ts` and handed in.
 */

/** DBC's program, and the discriminator of its `migration_damm_v2` instruction (the SDK's IDL). */
export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const MIGRATION_DAMM_V2 = Uint8Array.from([156, 169, 230, 103, 53, 228, 80, 64]);

/** Where `migration_damm_v2` keeps each account it names (the IDL's order). */
const ACCOUNT = { virtualPool: 0, pool: 4, firstNftMint: 5, firstNftAccount: 6, firstPosition: 7, secondNftMint: 8, secondNftAccount: 9, secondPosition: 10 } as const;

/** A transaction as the chain recorded it, reduced to what the exit is read from: its account keys and every instruction, inner ones too. */
export type ExitTransaction = Readonly<{
  failed: boolean;
  keys: readonly string[];
  instructions: readonly Readonly<{ programIndex: number; accounts: readonly number[]; data: Uint8Array }>[];
}>;

/** One position the move to the DEX opened: the position, its NFT's mint and the account the NFT was minted into. */
export type ExitSlot = Readonly<{ position: string; nftMint: string; nftAccount: string }>;

/**
 * The positions this transaction's migration of `curve` into `pool` opened; null when it carries no such migration, or
 * failed. An optional second position Anchor passes as the program's own address: then there is one.
 */
export function migrationExitOf(tx: ExitTransaction, curve: string, pool: string): readonly ExitSlot[] | null {
  if (tx.failed) return null;
  const key = (index: number | undefined) => (index === undefined ? "" : (tx.keys[index] ?? ""));
  for (const ix of tx.instructions) {
    if (key(ix.programIndex) !== DBC_PROGRAM || ix.data.length < 8 || !MIGRATION_DAMM_V2.every((byte, index) => ix.data[index] === byte)) continue;
    const at = (name: keyof typeof ACCOUNT) => key(ix.accounts[ACCOUNT[name]]);
    if (at("virtualPool") !== curve || at("pool") !== pool) continue;
    const slots: ExitSlot[] = [];
    const first = { position: at("firstPosition"), nftMint: at("firstNftMint"), nftAccount: at("firstNftAccount") };
    if (first.position && first.nftMint && first.nftAccount) slots.push(first);
    const second = { position: at("secondPosition"), nftMint: at("secondNftMint"), nftAccount: at("secondNftAccount") };
    if (second.position && second.position !== DBC_PROGRAM && second.nftMint && second.nftMint !== DBC_PROGRAM && second.nftAccount) slots.push(second);
    return slots.length ? slots : null;
  }
  return null;
}

/** A token account's mint, owner and amount from its bytes (SPL Token and Token-2022 share the first 72); null when too short. */
export function tokenAccountOf(data: Uint8Array): Readonly<{ mint: Uint8Array; owner: Uint8Array; amount: bigint }> | null {
  if (data.length < 72) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { mint: data.subarray(0, 32), owner: data.subarray(32, 64), amount: view.getBigUint64(64, true) };
}
