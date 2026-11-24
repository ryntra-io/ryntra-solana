// Test helpers: chain accounts in the smart account program's own layout (`../../mandate/ssa.ts` reads them).
import { PublicKey } from "@solana/web3.js";

import { SSA_PROGRAM_ID } from "../../mandate/ssa.ts";

const SETTINGS = [223, 179, 163, 190, 177, 224, 67, 173];
const POLICY = [222, 135, 7, 163, 235, 177, 33, 68];

/** A settings account whose signers are `signers` (threshold `threshold`, no time lock), the policy counter at `policySeed`. */
export function settingsAccount(signers, { threshold = 1, timeLock = 0, policySeed = 2n } = {}) {
  const head = Buffer.alloc(8 + 16 + 32 + 2 + 4 + 8 + 8 + 1 + 8 + 1);
  Buffer.from(SETTINGS).copy(head, 0);
  head.writeUInt16LE(threshold, 56);
  head.writeUInt32LE(timeLock, 58);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(signers.length);
  const keys = Buffer.concat(signers.map((key) => Buffer.concat([key.toBuffer(), Buffer.of(7)])));
  const seed = Buffer.alloc(9);
  seed[0] = 1;
  seed.writeBigUInt64LE(policySeed, 1);
  return { owner: SSA_PROGRAM_ID, lamports: 1, data: Buffer.concat([head, count, keys, Buffer.of(0), seed]) };
}

/** A policy account: `settings`, `seed`, one signer, then `policy_state` of `variant` acting on vault `accountIndex`. */
export function policyAccount({ settings, seed, signer, variant = 3, accountIndex }) {
  const head = Buffer.alloc(8 + 32 + 8 + 1 + 8 + 8);
  Buffer.from(POLICY).copy(head, 0);
  settings.toBuffer().copy(head, 8);
  head.writeBigUInt64LE(seed, 40);
  const signers = Buffer.alloc(4);
  signers.writeUInt32LE(1);
  const tail = Buffer.alloc(2 + 4);
  tail.writeUInt16LE(1, 0);
  return { owner: SSA_PROGRAM_ID, lamports: 1, data: Buffer.concat([head, signers, signer.toBuffer(), Buffer.of(7), tail, Buffer.of(variant, accountIndex), Buffer.alloc(64)]) };
}

export const someKey = () => PublicKey.unique();
