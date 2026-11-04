import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { getAddressDecoder } from "@solana/kit";

/** Test fixtures for the connector: a real Ed25519 wallet (address = public key in base58) and a PKCE pair. */

export function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const address = getAddressDecoder().decode(new Uint8Array(raw));
  return { address, sign: (bytes) => new Uint8Array(sign(null, Buffer.from(bytes), privateKey)) };
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier, "ascii").digest("base64url") };
}
