/**
 * A launch's picture and metadata on IPFS (SOL-L3, audit SOL-L0 finding З19).
 *
 * Ryntra keeps each under the sha256 of its own bytes (`metadata.server.ts`), and that sha256 already is the file's
 * IPFS address in other letters: a file of one block — the picture is at most 256 KiB, IPFS's block — added with CID v1
 * and raw leaves has the address `bafkrei…`, the base32 of the raw codec and the sha2-256 multihash of its bytes. So
 * the address in the mint, `/api/launch/metadata/<sha256>`, names the same bytes anyone can fetch from IPFS, and a copy
 * pinned there is checked against it to the bit.
 *
 * Pure and client-safe.
 */

/** CID v1 · raw codec (0x55) · sha2-256 multihash (0x12, 32 bytes). */
const CID_PREFIX = [0x01, 0x55, 0x12, 0x20] as const;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export const IPFS_CID_RAW = /^bafkrei[a-z2-7]{52}$/;
/** The public gateway a page links: any gateway serves the same bytes by the same address. */
export const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
/** The largest file one IPFS block holds: past it the address is no longer the raw sha256. */
export const IPFS_BLOCK_BYTES = 256 * 1024;

function base32(bytes: readonly number[]): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/** The IPFS address (CID v1, raw) of a file of one block, from the sha256 of its bytes in hex; null for anything else. */
export function ipfsCidOfSha256(sha256Hex: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) return null;
  const digest: number[] = [];
  for (let index = 0; index < 64; index += 2) digest.push(Number.parseInt(sha256Hex.slice(index, index + 2), 16));
  return `b${base32([...CID_PREFIX, ...digest])}`;
}

/** The sha256 a raw IPFS address names, in hex; null for an address of any other kind. */
export function sha256OfIpfsCid(cid: string): string | null {
  if (!IPFS_CID_RAW.test(cid)) return null;
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of cid.slice(1)) {
    buffer = (buffer << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
      buffer &= (1 << bits) - 1;
    }
  }
  if (bytes.length !== 36 || CID_PREFIX.some((byte, index) => bytes[index] !== byte)) return null;
  return bytes
    .slice(4)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function ipfsGatewayUrl(cid: string): string {
  return `${IPFS_GATEWAY}${cid}`;
}
