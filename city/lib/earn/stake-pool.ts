import { rateOf, type SolRate } from './lst.ts';

/**
 * An SPL stake pool account (the program's `StakePool`, Borsh), read only for what the SOL Saver shows: whose pool it
 * is (its token mint), what its token is worth in SOL now and at the epoch before, the share of staking rewards the
 * pool keeps, and what the pool itself takes to give SOL back. Sanctum's single- and multi-validator programs keep the
 * same layout. Pure — the bytes come from the server's read, and the tests feed it bytes they built.
 */

export type StakePool = Readonly<{
  poolMint: string;
  /** The token's worth now: the pool's lamports over its supply. */
  now: SolRate | null;
  /** The same at the end of the epoch before the last update. */
  before: SolRate | null;
  lastUpdateEpoch: bigint;
  /** The pool's share of staking rewards each epoch, per cent — already taken before the token's worth grows. */
  rewardsFeePct: number | null;
  /** What the pool keeps when SOL is taken out of it directly, per cent. */
  solWithdrawalFeePct: number | null;
}>;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}

class Reader {
  offset: number;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.offset = offset;
  }
  need(n: number): void {
    if (this.offset + n > this.bytes.length) throw new RangeError('short');
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.offset++]!;
  }
  u64(): bigint {
    this.need(8);
    let value = 0n;
    for (let i = 7; i >= 0; i -= 1) value = (value << 8n) + BigInt(this.bytes[this.offset + i]!);
    this.offset += 8;
    return value;
  }
  key(): string {
    this.need(32);
    const out = base58(this.bytes.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return out;
  }
  skip(n: number): void {
    this.need(n);
    this.offset += n;
  }
  fee(): Readonly<{ denominator: bigint; numerator: bigint }> {
    return { denominator: this.u64(), numerator: this.u64() };
  }
  /** `FutureEpoch<Fee>`: none, or one fee for the next epoch or the one after. */
  futureFee(): void {
    const tag = this.u8();
    if (tag === 1 || tag === 2) this.skip(16);
    else if (tag !== 0) throw new RangeError('tag');
  }
  optionKey(): void {
    const tag = this.u8();
    if (tag === 1) this.skip(32);
    else if (tag !== 0) throw new RangeError('tag');
  }
}

function pct(fee: Readonly<{ denominator: bigint; numerator: bigint }>): number | null {
  if (fee.denominator === 0n) return fee.numerator === 0n ? 0 : null;
  const value = (Number(fee.numerator) / Number(fee.denominator)) * 100;
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** The pool's account type `StakePool` is 1; anything else is not a pool. */
const ACCOUNT_STAKE_POOL = 1;

/** Decode a stake pool account; null for anything that is not one or is cut short. */
export function decodeStakePool(bytes: Uint8Array): StakePool | null {
  try {
    const r = new Reader(bytes);
    if (r.u8() !== ACCOUNT_STAKE_POOL) return null;
    r.skip(32 * 3); // manager, staker, stake deposit authority
    r.skip(1); // withdraw bump seed
    r.skip(32 * 2); // validator list, reserve stake
    const poolMint = r.key();
    r.skip(32 * 2); // manager fee account, token program
    const totalLamports = r.u64();
    const poolTokenSupply = r.u64();
    const lastUpdateEpoch = r.u64();
    r.skip(8 + 8 + 32); // lockup
    const epochFee = r.fee();
    r.futureFee(); // next epoch fee
    r.optionKey(); // preferred deposit validator
    r.optionKey(); // preferred withdraw validator
    r.skip(16); // stake deposit fee
    r.skip(16); // stake withdrawal fee
    r.futureFee(); // next stake withdrawal fee
    r.skip(1); // stake referral fee
    r.optionKey(); // sol deposit authority
    r.skip(16); // sol deposit fee
    r.skip(1); // sol referral fee
    r.optionKey(); // sol withdraw authority
    const solWithdrawalFee = r.fee();
    r.futureFee(); // next sol withdrawal fee
    const lastEpochPoolTokenSupply = r.u64();
    const lastEpochTotalLamports = r.u64();
    return {
      poolMint,
      now: rateOf(totalLamports, poolTokenSupply),
      before: rateOf(lastEpochTotalLamports, lastEpochPoolTokenSupply),
      lastUpdateEpoch,
      rewardsFeePct: pct(epochFee),
      solWithdrawalFeePct: pct(solWithdrawalFee),
    };
  } catch {
    return null;
  }
}
