import { randomBytes } from "node:crypto";

import type { BeaconRound } from "./beacon";
import { bytesToHex, hexToBytes, sha256, sha256Hex } from "./hash";
import { RULES, type Seat } from "./rules";

/**
 * The dice without anyone choosing them (CITY-69). Both agents commit to secret seeds; once the commitments are
 * closed, a beacon round that is not yet published is fixed. The dice come from all three, so neither agent nor the
 * host can steer them, and the finished log derives every roll again.
 */

const DOMAIN = "ryntra-dice";

/** The value an agent commits to: binds the seed to this match and seat, so it cannot be copied. */
export function commitmentFor(matchId: string, seat: Seat, seed: string): string {
  return sha256Hex(`${DOMAIN}/commit/v1|${matchId}|${seat}|${seed}`);
}

/** A fresh 32-byte seed from the platform's CSPRNG. */
export function randomSeed(): string {
  return bytesToHex(randomBytes(32));
}

/** The match seed: both revealed seeds and the beacon round. Secret until the match ends. */
export function combineSeeds(matchId: string, seeds: readonly [string, string], beacon: BeaconRound): string {
  return sha256Hex(`${DOMAIN}/seed/v1|${matchId}|${seeds[0]}|${seeds[1]}|${beacon.round}|${beacon.randomness}`);
}

/** A deterministic stream: SHA-256 in counter mode over a 32-byte key, eight 32-bit numbers a block. */
export class HashRng {
  readonly #key: Uint8Array;
  #block = 0;
  #pool: Uint8Array = new Uint8Array(0);
  #offset = 0;

  constructor(keyHex: string) {
    this.#key = hexToBytes(keyHex);
  }

  #u32(): number {
    if (this.#offset + 4 > this.#pool.length) {
      const counter = new Uint8Array(4);
      new DataView(counter.buffer).setUint32(0, this.#block++);
      this.#pool = sha256(this.#key, counter);
      this.#offset = 0;
    }
    const value = new DataView(this.#pool.buffer, this.#pool.byteOffset).getUint32(this.#offset);
    this.#offset += 4;
    return value;
  }

  /** A uniform integer in [0, n). Rejection sampling keeps every value equally likely. */
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`int(n) needs 1 <= n <= 2^32, got ${n}`);
    const limit = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const v = this.#u32();
      if (v < limit) return v % n;
    }
  }
}

/** Who opens round 1. */
export function drawOpener(matchSeed: string): Seat {
  return new HashRng(sha256Hex(`${DOMAIN}/opener/v1|${matchSeed}`)).int(2) === 0 ? 0 : 1;
}

/** Rolls a round: seat 0's dice first, then seat 1's, in roll order. */
export function rollHands(matchSeed: string, round: number, dice: readonly [number, number]): [number[], number[]] {
  const rng = new HashRng(sha256Hex(`${DOMAIN}/round/v1|${matchSeed}|${round}`));
  const roll = (n: number) => Array.from({ length: n }, () => rng.int(RULES.faces) + 1);
  const first = roll(dice[0]);
  return [first, roll(dice[1])];
}
