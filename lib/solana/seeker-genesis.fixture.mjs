// Fixtures for SKR-3 («Перевірено Seeker»): a wallet's Token-2022 accounts and
// mint bytes as mainnet answers them, for the tests and the local stand.
//
// The mint bytes are built in Token-2022's own layout with the extensions a
// real SGT carries (the one read in the M4 candidate scan, 02.09 — MetadataPointer,
// PermanentDelegate, MintCloseAuthority, GroupMemberPointer, TokenGroupMember,
// authority `GT2zuHVa…`, Solana Mobile's mint authority). Every wallet, mint and
// account address here is synthetic, and the member number
// is a fixture value. Nothing here reads a network.
import { SGT_GROUP_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-mobile/skr-genesis-token";
import { getAddressEncoder } from "@solana/kit";

export const OWNER = "97k6qDj5gbkeBFHqxPi1CKQiaoi4D9dy46P3rXCkh3AQ";
export const SGT_MINT = "EBeP4zvX59nNsXX489DyULVLTZxb6pW6x5EWSAgDYXCP";
export const SGT_ACCOUNT = "Fbwb5KhjVR28oQaENbehv9gnMbLFPPvXmYFsMxZBVvsJ";
export const SGT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
export const LOOKALIKE_MINT = "AsdnZ1CdZEek5j8R3g3hHPa916wTh2YRSH7hwhLHZyW2";
export const LOOKALIKE_ACCOUNT = "CHvzMhvfTNxhBzuM1mFvJ97jz5RUuTTMvZMWdZCowcFZ";
export const FORGED_MINT = "4BfXPEjwFSqx1ChtrYhMmsW4TMnUncHkCYEhszYMAnL7";
export const FORGED_ACCOUNT = "5bxjPZX9fi5hw6xZ1pYetFi5ahChvwhug7VC4sQqitcc";
export const EMPTY_MINT = "2qHcXDRjRWgRjomYSKwAd4xRpKuShQ6P35AscjaeHapb";
export const EMPTY_ACCOUNT = "4FapXYCwqk9B9HxQHr2H4kGphWzgTfyZkwuMwNawv7ep";
export const MEMBER_NUMBER = 41_337n;
export { SGT_GROUP_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS };

const encodeAddress = getAddressEncoder();
const key = (address) => Uint8Array.from(encodeAddress.encode(address));

function tlv(type, data) {
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint16(0, type, true);
  new DataView(head.buffer).setUint16(2, data.length, true);
  return [head, data];
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function u64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** A Token-2022 mint: the 82-byte base, padding to 165, the account type, then the extensions. */
export function mintBytes({ mint, group, metadataAddress, memberNumber = MEMBER_NUMBER, authority = SGT_AUTHORITY }) {
  const base = new Uint8Array(82);
  const view = new DataView(base.buffer);
  view.setUint32(0, 1, true);
  base.set(key(authority), 4);
  view.setBigUint64(36, 1n, true);
  base[44] = 0;
  base[45] = 1;
  view.setUint32(46, 1, true);
  base.set(key(authority), 50);
  const padded = new Uint8Array(165);
  padded.set(base);
  return concat([
    padded,
    Uint8Array.of(1),
    ...tlv(18, concat([key(authority), key(metadataAddress)])), // MetadataPointer
    ...tlv(12, key(authority)), // PermanentDelegate
    ...tlv(3, key(authority)), // MintCloseAuthority
    ...tlv(22, concat([key(authority), key(mint)])), // GroupMemberPointer
    ...tlv(23, concat([key(mint), key(group), u64(memberNumber)])), // TokenGroupMember
  ]);
}

export const base64 = (bytes) => Buffer.from(bytes).toString("base64");

/** Every mint the fixture chain knows. */
export const MINTS = {
  [SGT_MINT]: { owner: TOKEN_2022_PROGRAM_ADDRESS, data: mintBytes({ mint: SGT_MINT, group: SGT_GROUP_ADDRESS, metadataAddress: SGT_GROUP_ADDRESS }) },
  /* Named and pictured like a Seeker token, but its own group: not one. */
  [LOOKALIKE_MINT]: { owner: TOKEN_2022_PROGRAM_ADDRESS, data: mintBytes({ mint: LOOKALIKE_MINT, group: LOOKALIKE_MINT, metadataAddress: LOOKALIKE_MINT, authority: OWNER }) },
  /* Claims the SGT group as a member but points its metadata elsewhere: not one. */
  [FORGED_MINT]: { owner: TOKEN_2022_PROGRAM_ADDRESS, data: mintBytes({ mint: FORGED_MINT, group: SGT_GROUP_ADDRESS, metadataAddress: FORGED_MINT, authority: OWNER }) },
  /* A real SGT shape with nothing left in the account: skipped, never read. */
  [EMPTY_MINT]: { owner: TOKEN_2022_PROGRAM_ADDRESS, data: mintBytes({ mint: EMPTY_MINT, group: SGT_GROUP_ADDRESS, metadataAddress: SGT_GROUP_ADDRESS }) },
};

/** A Seeker owner's accounts: the SGT, two look-alikes and an emptied SGT account. */
export const HOLDER_ACCOUNTS = [
  { pubkey: SGT_ACCOUNT, mint: SGT_MINT, amount: "1" },
  { pubkey: LOOKALIKE_ACCOUNT, mint: LOOKALIKE_MINT, amount: "1" },
  { pubkey: FORGED_ACCOUNT, mint: FORGED_MINT, amount: "1" },
  { pubkey: EMPTY_ACCOUNT, mint: EMPTY_MINT, amount: "0" },
];

/** The same wallet without its SGT. */
export const NONE_ACCOUNTS = HOLDER_ACCOUNTS.filter((row) => row.mint !== SGT_MINT);

/** `getTokenAccountsByOwner` (jsonParsed) entry. */
export function parsedAccount(row, owner = OWNER) {
  return {
    pubkey: row.pubkey,
    account: {
      data: { program: "spl-token-2022", parsed: { type: "account", info: { mint: row.mint, owner, state: "frozen", tokenAmount: { amount: row.amount, decimals: 0, uiAmount: Number(row.amount), uiAmountString: row.amount } } }, space: 170 },
      executable: false,
      lamports: 2_074_080,
      owner: TOKEN_2022_PROGRAM_ADDRESS,
      rentEpoch: 0,
      space: 170,
    },
  };
}

/** `getMultipleAccounts` (base64) entry, or null for an unknown mint. */
export function mintAccount(mint) {
  const found = MINTS[mint];
  return found ? { owner: found.owner, data: [base64(found.data), "base64"], executable: false, lamports: 3_000_000, rentEpoch: 0, space: found.data.length } : null;
}

/**
 * A JSON-RPC answer over the fixture chain: `accountsFor(owner)` names what each
 * wallet holds. Returns null for a method the fixture does not serve.
 */
export function fixtureRpcResult(request, accountsFor) {
  if (request.method === "getTokenAccountsByOwner") {
    const owner = request.params[0];
    return { context: { slot: 443767000 }, value: accountsFor(owner).map((row) => parsedAccount(row, owner)) };
  }
  if (request.method === "getMultipleAccounts") return { context: { slot: 443767000 }, value: request.params[0].map(mintAccount) };
  return null;
}
