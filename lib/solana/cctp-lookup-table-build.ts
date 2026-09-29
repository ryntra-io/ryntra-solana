/**
 * Creating the lane's lookup table, once, from a wallet.
 *
 * This is operator setup rather than a customer action: it happens one time per
 * deployment, it is signed by a wallet this product does not hold a key for, and
 * after it the address goes into `RYNTRA_SOLANA_CCTP_LOOKUP_TABLE` and nothing
 * ever touches it again.
 *
 * The two instructions are hand-encoded for the same reason the CCTP ones are —
 * there is no generated client for the address lookup table programme in this
 * repository — but the layout here is published and stable rather than
 * reverse-engineered:
 *
 * - **Create** is discriminant `0`, then the recent slot as a little-endian
 *   `u64` and the PDA bump as a `u8`. The table's own address is a programme
 *   derived address of `[authority, recentSlot]`, which is why the slot has to
 *   travel in the data as well as in the seeds: the runtime re-derives it and
 *   refuses anything that does not match.
 * - **Extend** is discriminant `2`, then the number of addresses as a
 *   little-endian `u64`, then the addresses themselves.
 *
 * A table is append-only. `extend` appends, and no instruction rewrites an entry
 * that already exists — which is the property that lets a compressed index be
 * trusted between the moment it is read and the moment the transaction lands.
 */

import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";

import { ADDRESS_LOOKUP_TABLE_PROGRAM } from "./cctp-lookup-table.ts";
import { SOLANA_SYSTEM_PROGRAM } from "./cctp-receive.ts";

const ADDRESS = getAddressEncoder();

/** How many addresses one `extend` may carry without overrunning a packet. */
export const LOOKUP_TABLE_EXTEND_CHUNK = 20;

/**
 * The address the runtime will give this table.
 *
 * Derived, never chosen. `createLookupTable` fails if the account it is handed
 * is not the programme derived address of the authority and the slot it was
 * told about, so getting this wrong is a refused transaction rather than a table
 * somewhere unexpected.
 */
export async function deriveLookupTableAddress(args: {
  authority: string;
  recentSlot: bigint;
}): Promise<Readonly<{ address: string; bump: number }>> {
  const slot = Buffer.alloc(8);
  slot.writeBigUInt64LE(args.recentSlot);
  const [address, bump] = await getProgramDerivedAddress({
    programAddress: ADDRESS_LOOKUP_TABLE_PROGRAM as Address,
    seeds: [Uint8Array.from(ADDRESS.encode(args.authority as Address)), new Uint8Array(slot)],
  });
  return { address: String(address), bump: Number(bump) };
}

function tableAccounts(table: string, authority: string, payer: string) {
  return [
    { address: table as Address, role: AccountRole.WRITABLE },
    { address: authority as Address, role: AccountRole.READONLY_SIGNER },
    { address: payer as Address, role: AccountRole.WRITABLE_SIGNER },
    { address: SOLANA_SYSTEM_PROGRAM as Address, role: AccountRole.READONLY },
  ];
}

export function buildCreateLookupTableInstruction(args: {
  table: string;
  authority: string;
  payer: string;
  recentSlot: bigint;
  bump: number;
}): Instruction {
  const data = Buffer.alloc(4 + 8 + 1);
  data.writeUInt32LE(0, 0);
  data.writeBigUInt64LE(args.recentSlot, 4);
  data.writeUInt8(args.bump, 12);
  return {
    programAddress: ADDRESS_LOOKUP_TABLE_PROGRAM as Address,
    accounts: tableAccounts(args.table, args.authority, args.payer),
    data: new Uint8Array(data),
  };
}

export function buildExtendLookupTableInstruction(args: {
  table: string;
  authority: string;
  payer: string;
  addresses: readonly string[];
}): Instruction {
  if (args.addresses.length === 0) throw new Error("An extend with no addresses does nothing.");
  if (args.addresses.length > LOOKUP_TABLE_EXTEND_CHUNK) {
    throw new Error(`An extend carries at most ${LOOKUP_TABLE_EXTEND_CHUNK} addresses.`);
  }
  const data = Buffer.alloc(4 + 8 + args.addresses.length * 32);
  data.writeUInt32LE(2, 0);
  data.writeBigUInt64LE(BigInt(args.addresses.length), 4);
  args.addresses.forEach((address, index) => {
    Buffer.from(ADDRESS.encode(address as Address)).copy(data, 12 + index * 32);
  });
  return {
    programAddress: ADDRESS_LOOKUP_TABLE_PROGRAM as Address,
    accounts: tableAccounts(args.table, args.authority, args.payer),
    data: new Uint8Array(data),
  };
}
