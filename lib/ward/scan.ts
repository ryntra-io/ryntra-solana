/**
 * What a transaction's instructions say they will do to authority — read from the bytes themselves, top level and
 * (once simulated) every inner call, before anything is weighed. Only the instructions that hand over control are
 * read here; balances are the simulation's to tell.
 *
 * Every layout below is the program's own, little-endian: the System, Stake and Upgradeable Loader programs open with
 * a u32 instruction index, both token programs with a u8.
 */

import { encodeAddress } from "./accounts.ts";
import { STAKE_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAMS, UPGRADEABLE_LOADER_PROGRAM } from "./known.ts";

export type ScannedInstruction = Readonly<{
  program: string;
  /** Account keys in instruction order; null where a lookup table was not read. */
  accounts: readonly (string | null)[];
  data: Uint8Array;
  /** Top-level position, and whether this is an inner call made by that instruction. */
  index: number;
  inner: boolean;
}>;

export type AuthorityEvent =
  | Readonly<{ kind: "assign"; account: string; program: string }>
  | Readonly<{ kind: "nonce-advance"; nonce: string; authority: string | null; first: boolean }>
  | Readonly<{ kind: "nonce-authorize"; nonce: string; to: string }>
  | Readonly<{ kind: "token-set-authority"; account: string; current: string | null; authorityType: number; to: string | null }>
  | Readonly<{ kind: "token-approve"; source: string; delegate: string; owner: string | null; amount: bigint; mint: string | null }>
  | Readonly<{ kind: "token-close"; account: string; destination: string; owner: string | null }>
  | Readonly<{ kind: "stake-authorize"; stake: string; authority: string | null; to: string }>
  | Readonly<{ kind: "upgrade-authority"; programData: string; current: string | null; to: string | null }>
  | Readonly<{ kind: "system-transfer"; from: string; to: string; lamports: bigint }>
  | Readonly<{ kind: "token-transfer"; source: string; destination: string; owner: string | null; amount: bigint; mint: string | null }>;

/** Token SetAuthority types that belong to a token account; every other type is a mint's. */
export const ACCOUNT_AUTHORITY_TYPES = { owner: 2, close: 3 } as const;

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const u32At = (data: Uint8Array, at: number): number | null => (data.length >= at + 4 ? view(data).getUint32(at, true) : null);
const u64At = (data: Uint8Array, at: number): bigint | null => (data.length >= at + 8 ? view(data).getBigUint64(at, true) : null);
const keyAt = (data: Uint8Array, at: number): string | null => (data.length >= at + 32 ? encodeAddress(data.subarray(at, at + 32)) : null);

function system(ix: ScannedInstruction): AuthorityEvent | null {
  const index = u32At(ix.data, 0);
  const [a0, a1, a2] = ix.accounts;
  switch (index) {
    case 1: {
      /* Assign { owner } — accounts: [assigned (signer)]. */
      const program = keyAt(ix.data, 4);
      return a0 && program ? { kind: "assign", account: a0, program } : null;
    }
    case 10: {
      /* AssignWithSeed { base, seed, owner } — accounts: [assigned, base (signer)]. */
      const seedLength = u64At(ix.data, 36);
      if (seedLength === null || seedLength > 32n) return null;
      const program = keyAt(ix.data, 44 + Number(seedLength));
      return a0 && program ? { kind: "assign", account: a0, program } : null;
    }
    case 2: {
      const lamports = u64At(ix.data, 4);
      return a0 && a1 && lamports !== null ? { kind: "system-transfer", from: a0, to: a1, lamports } : null;
    }
    case 4:
      /* AdvanceNonceAccount — accounts: [nonce, recent blockhashes, authority]. */
      return a0 ? { kind: "nonce-advance", nonce: a0, authority: a2 ?? null, first: !ix.inner && ix.index === 0 } : null;
    case 7: {
      const to = keyAt(ix.data, 4);
      return a0 && to ? { kind: "nonce-authorize", nonce: a0, to } : null;
    }
    default:
      return null;
  }
}

function token(ix: ScannedInstruction): AuthorityEvent | null {
  const tag = ix.data[0];
  const a = ix.accounts;
  switch (tag) {
    case 3: {
      const amount = u64At(ix.data, 1);
      return a[0] && a[1] && amount !== null ? { kind: "token-transfer", source: a[0], destination: a[1], owner: a[2] ?? null, amount, mint: null } : null;
    }
    case 12: {
      const amount = u64At(ix.data, 1);
      return a[0] && a[2] && amount !== null ? { kind: "token-transfer", source: a[0], destination: a[2], owner: a[3] ?? null, amount, mint: a[1] ?? null } : null;
    }
    case 4: {
      const amount = u64At(ix.data, 1);
      return a[0] && a[1] && amount !== null ? { kind: "token-approve", source: a[0], delegate: a[1], owner: a[2] ?? null, amount, mint: null } : null;
    }
    case 13: {
      const amount = u64At(ix.data, 1);
      return a[0] && a[2] && amount !== null ? { kind: "token-approve", source: a[0], delegate: a[2], owner: a[3] ?? null, amount, mint: a[1] ?? null } : null;
    }
    case 6: {
      /* SetAuthority { type: u8, new: COption<Pubkey> as u8 tag + 32 } — accounts: [account, current authority]. */
      if (ix.data.length < 3 || !a[0]) return null;
      const to = ix.data[2] === 1 ? keyAt(ix.data, 3) : null;
      if (ix.data[2] === 1 && to === null) return null;
      return { kind: "token-set-authority", account: a[0], current: a[1] ?? null, authorityType: ix.data[1], to };
    }
    case 9:
      return a[0] && a[1] ? { kind: "token-close", account: a[0], destination: a[1], owner: a[2] ?? null } : null;
    default:
      return null;
  }
}

function stake(ix: ScannedInstruction): AuthorityEvent | null {
  const index = u32At(ix.data, 0);
  const a = ix.accounts;
  if (!a[0]) return null;
  /* Authorize { new, which } and AuthorizeWithSeed { new, … } carry the new authority in the data; the checked
     forms (10, 11) carry it as an account that signs. */
  if (index === 1 || index === 8) {
    const to = keyAt(ix.data, 4);
    return to ? { kind: "stake-authorize", stake: a[0], authority: (index === 1 ? a[2] : a[1]) ?? null, to } : null;
  }
  if (index === 10) return a[3] ? { kind: "stake-authorize", stake: a[0], authority: a[2] ?? null, to: a[3] } : null;
  if (index === 11) return a[3] ? { kind: "stake-authorize", stake: a[0], authority: a[1] ?? null, to: a[3] } : null;
  return null;
}

function loader(ix: ScannedInstruction): AuthorityEvent | null {
  const index = u32At(ix.data, 0);
  const a = ix.accounts;
  /* SetAuthority (4): [program data, current, new?]; SetAuthorityChecked (7): [program data, current, new (signer)]. */
  if ((index === 4 || index === 7) && a[0]) return { kind: "upgrade-authority", programData: a[0], current: a[1] ?? null, to: a[2] ?? null };
  return null;
}

/** Every authority event in the instructions given, in order. Instructions of other programs say nothing here. */
export function scanInstructions(instructions: readonly ScannedInstruction[]): readonly AuthorityEvent[] {
  const events: AuthorityEvent[] = [];
  for (const ix of instructions) {
    let event: AuthorityEvent | null = null;
    if (ix.program === SYSTEM_PROGRAM) event = system(ix);
    else if (TOKEN_PROGRAMS.has(ix.program)) event = token(ix);
    else if (ix.program === STAKE_PROGRAM) event = stake(ix);
    else if (ix.program === UPGRADEABLE_LOADER_PROGRAM) event = loader(ix);
    if (event) events.push(event);
  }
  return events;
}
