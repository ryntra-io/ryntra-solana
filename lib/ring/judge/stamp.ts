/**
 * The time stamp of a submission (CITY-68, level L1): the harness signs «this match's seat handed in this hash at this
 * time» the moment it receives an agent's work, so nobody — the agent, the harness after the fact, the judge — can move a
 * late submission back in time, swap its bytes under an old stamp or carry a stamp over from another match or seat.
 *
 *   signed text = "ryntra-ring-stamp/1|<matchId>|<seat>|<sha256 hex of the submission>|<unix ms>"
 *   signature   = Ed25519 over the UTF-8 of that text, base64url; signer = the raw public key, base64url (JWK `x`)
 *
 * The judge trusts only the signers it is given. Keys never live in the repository: the harness holds its private key
 * in the server's environment; tests make a fresh one.
 */

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { isHex32 } from "./hash.ts";
import { MATCH_ID } from "./memo.ts";

export type Stamp = { at: number; signer: string; signature: string };

/** What a stamp names: whose work, which bytes. */
export type Stamped = { matchId: string; seat: number; hash: string };

/** Checks a stamp against a submission's match, seat and hash. */
export type StampVerifier = (stamped: Stamped, stamp: Stamp) => boolean;

/** Stamps a submission at a time (unix ms). */
export type Stamper = (stamped: Stamped, at: number) => Stamp;

export const STAMP_PREFIX = "ryntra-ring-stamp/1";

export const stampText = ({ matchId, seat, hash }: Stamped, at: number): string => `${STAMP_PREFIX}|${matchId}|${seat}|${hash}|${at}`;

const B64URL = /^[A-Za-z0-9_-]+$/;

const isStamped = (value: Stamped): boolean =>
  typeof value?.matchId === "string" && MATCH_ID.test(value.matchId) && Number.isSafeInteger(value.seat) && value.seat >= 0 && isHex32(value.hash);

/** A stamper for an Ed25519 private key (a `KeyObject` or PEM). */
export function createStamper(privateKey: KeyObject | string): Stamper {
  const key = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey;
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("a stamp needs an Ed25519 key");
  const signer = signerOf(createPublicKey(key));
  return (stamped, at) => {
    if (!isStamped(stamped) || !Number.isSafeInteger(at) || at < 0) throw new TypeError("a stamp needs a match id, a seat, a sha256 hex hash and unix ms");
    return { at, signer, signature: sign(null, Buffer.from(stampText(stamped, at), "utf8"), key).toString("base64url") };
  };
}

/** The signer id of an Ed25519 public key: its 32 raw bytes, base64url. */
export function signerOf(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new TypeError("not an Ed25519 public key");
  return jwk.x;
}

/** A verifier that trusts exactly these signers. Anything malformed is simply not a valid stamp. */
export function stampVerifier(trusted: readonly string[]): StampVerifier {
  const keys = new Map<string, KeyObject>();
  for (const x of trusted) keys.set(x, createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" }));
  return (stamped, stamp) => {
    if (!isStamped(stamped) || !stamp || typeof stamp !== "object") return false;
    const { at, signer, signature } = stamp;
    if (!Number.isSafeInteger(at) || at < 0 || typeof signature !== "string" || !B64URL.test(signature)) return false;
    const key = typeof signer === "string" ? keys.get(signer) : undefined;
    if (!key) return false;
    try {
      return verify(null, Buffer.from(stampText(stamped, at), "utf8"), key, Buffer.from(signature, "base64url"));
    } catch {
      return false;
    }
  };
}
