/* A real stock's mint for the tests: Anthropic's ANT (Backpack Securities), its own bytes as mainnet held them
   on 20.11.2026 (the copy the DLMM rehearsal reads, `lib/earn-dlmm/fixtures`), and a way to flip one of its
   issuer's switches in a copy of those bytes. Nothing here reaches a network. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export const ANT_ADDRESS = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";

const SNAPSHOT = JSON.parse(gunzipSync(readFileSync(new URL("../../earn-dlmm/fixtures/stock-ant-usdc-mainnet.json.gz", import.meta.url))).toString("utf8")).snapshot;

/** The epoch the copy was read at. */
export const ANT_EPOCH = BigInt(SNAPSHOT.clock.epoch);

/** ANT's mint, a fresh copy of mainnet's bytes each time. */
export const antMintData = () => Uint8Array.from(Buffer.from(SNAPSHOT.accounts[ANT_ADDRESS].data, "base64"));

/** A copy of a Token-2022 mint's bytes with one feature's own bytes changed in place; throws when the mint has no such feature. */
export function withFeature(data, type, change) {
  const copy = Uint8Array.from(data);
  for (let at = 166; at + 4 <= copy.length; ) {
    const found = copy[at] | (copy[at + 1] << 8);
    const length = copy[at + 2] | (copy[at + 3] << 8);
    if (found === 0) break;
    if (found === type) {
      change(copy.subarray(at + 4, at + 4 + length));
      return copy;
    }
    at += 4 + length;
  }
  throw new Error(`the mint has no feature ${type}`);
}

/** The issuer's switches, flipped: paused; a program named to check transfers; new wallets starting frozen. */
export const paused = (data) => withFeature(data, 26, (bytes) => (bytes[32] = 1));
export const hooked = (data) => withFeature(data, 14, (bytes) => bytes.fill(7, 32));
export const startsFrozen = (data) => withFeature(data, 6, (bytes) => (bytes[0] = 2));

/** A Token-2022 token account as the program writes it for a stock: 165 bytes, the account type, then its extensions. */
export function stockAccountData(mint, owner, { amount = 0n, state = 1, extensions = [] } = {}) {
  const base = new Uint8Array(165);
  base.set(mint.toBytes(), 0);
  base.set(owner.toBytes(), 32);
  new DataView(base.buffer).setBigUint64(64, BigInt(amount), true);
  base[108] = state;
  const tlv = extensions.flatMap(([type, bytes]) => [type & 255, type >> 8, bytes.length & 255, bytes.length >> 8, ...bytes]);
  return Uint8Array.from([...base, 2, ...tlv]);
}
