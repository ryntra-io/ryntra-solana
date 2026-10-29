/**
 * A Token-2022 mint's own metadata (the `TokenMetadata` extension), decoded from the mint's bytes already read — so the
 * name, ticker, picture and who may change them come with the one read of the mint, and no second request to a node can
 * fail on its own and hide what the first one read.
 *
 * The layout is the SPL Token Metadata interface's (Borsh): the update authority (32 bytes, all zero for none), the mint
 * (32), the name, the symbol and the URI (each a little-endian u32 length and UTF-8 bytes), then the additional fields.
 *
 * Pure: `@solana/spl-token`'s `getExtensionData(ExtensionType.TokenMetadata, mint.tlvData)` hands the bytes in.
 */

import { getBase58Decoder } from "@solana/kit";

export type MintMetadata = Readonly<{ updateAuthority: string | null; mint: string; name: string; symbol: string; uri: string }>;

/** The metadata in these bytes; throws when they are not the interface's layout. */
export function mintMetadataOf(bytes: Uint8Array): MintMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const key = () => {
    if (at + 32 > bytes.length) throw new Error("The token metadata is shorter than its keys.");
    const value = bytes.subarray(at, at + 32);
    at += 32;
    return value;
  };
  const text = () => {
    if (at + 4 > bytes.length) throw new Error("The token metadata ends inside a length.");
    const length = view.getUint32(at, true);
    at += 4;
    if (at + length > bytes.length) throw new Error("The token metadata ends inside a field.");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at, at + length));
    at += length;
    return value;
  };
  const authority = key();
  const mint = key();
  const name = text();
  const symbol = text();
  const uri = text();
  const base58 = getBase58Decoder();
  return { updateAuthority: authority.every((byte) => byte === 0) ? null : base58.decode(authority), mint: base58.decode(mint), name, symbol, uri };
}
