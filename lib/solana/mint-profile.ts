/**
 * What a mint's issuer can still do, read from the mint account's own bytes (SOL-L12) — the classic token program's
 * two authorities, and on Token-2022 every extension that lets the issuer act on holders after the fact: the transfer
 * fee and its schedule, a permanent delegate, a default frozen state, a transfer hook, the right to close the mint, a
 * pause. A badge Meteora gives a quote token does not bind its issuer (Meteora's documentation), so this profile is
 * what Launch keeps watching for every pair currency it trades against — USDC and JUP now, any Token-2022 pair later
 * (SOL-L11).
 *
 * Pure: it reads the bytes it is given. What changes on its own — the fee withheld on the mint, the supply — is not
 * part of the profile; what only the issuer changes is.
 */

import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getDefaultAccountState,
  getExtensionTypes,
  getMintCloseAuthority,
  getPausableConfig,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { MINT_PROFILE_FIELDS, type MintProfileField } from "./mint-profile-fields.ts";

export { MINT_PROFILE_FIELDS, type MintProfileField };

/** One epoch's transfer fee as the mint stores it. */
export type MintTransferFee = Readonly<{ epoch: string; bps: number; maxRaw: string }>;

export type MintProfile = Readonly<{
  mint: string;
  /** The program that owns the mint; `missing` — no account at the address (a mint closed, or never one). */
  program: "spl-token" | "token-2022" | "other" | "missing";
  decimals: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Token-2022's extensions on the mint, by the program's type number (`ExtensionType`), ascending; empty on the classic program. */
  extensions: readonly string[];
  /** The fee in force from `older.epoch` and the one scheduled from `newer.epoch` — the issuer may set the next one at any time. */
  transferFee: Readonly<{ authority: string | null; withdrawAuthority: string | null; older: MintTransferFee; newer: MintTransferFee }> | null;
  permanentDelegate: string | null;
  defaultAccountState: "initialized" | "frozen" | "uninitialized" | null;
  transferHook: Readonly<{ authority: string | null; program: string | null }> | null;
  closeAuthority: string | null;
  pausable: Readonly<{ authority: string | null; paused: boolean }> | null;
}>;

type AccountBytes = Readonly<{ owner: PublicKey | string; data: Uint8Array; lamports?: number; executable?: boolean }>;

const key = (value: PublicKey | null | undefined): string | null => {
  if (!value) return null;
  /* The programs write an absent authority as the zero key. */
  return value.equals(PublicKey.default) ? null : value.toBase58();
};

const feeOf = (fee: { epoch: bigint; maximumFee: bigint; transferFeeBasisPoints: number }): MintTransferFee => ({
  epoch: fee.epoch.toString(),
  bps: fee.transferFeeBasisPoints,
  maxRaw: fee.maximumFee.toString(),
});

const ACCOUNT_STATES = { 0: "uninitialized", 1: "initialized", 2: "frozen" } as const;

/** The mint's profile from its account as a node answers it; null bytes — `missing`. */
export function mintProfileOf(mint: string, account: AccountBytes | null): MintProfile {
  const none: MintProfile = {
    mint,
    program: "missing",
    decimals: null,
    mintAuthority: null,
    freezeAuthority: null,
    extensions: [],
    transferFee: null,
    permanentDelegate: null,
    defaultAccountState: null,
    transferHook: null,
    closeAuthority: null,
    pausable: null,
  };
  if (!account) return none;
  const owner = typeof account.owner === "string" ? new PublicKey(account.owner) : account.owner;
  const program = owner.equals(TOKEN_PROGRAM_ID) ? "spl-token" : owner.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : "other";
  if (program === "other") return { ...none, program };
  const parsed = unpackMint(new PublicKey(mint), { owner, data: Buffer.from(account.data), lamports: account.lamports ?? 0, executable: account.executable ?? false }, owner);
  const base = { ...none, program, decimals: parsed.decimals, mintAuthority: parsed.mintAuthority?.toBase58() ?? null, freezeAuthority: parsed.freezeAuthority?.toBase58() ?? null } satisfies MintProfile;
  if (program === "spl-token") return base;
  const types = getExtensionTypes(parsed.tlvData);
  const fee = types.includes(ExtensionType.TransferFeeConfig) ? getTransferFeeConfig(parsed) : null;
  const delegate = types.includes(ExtensionType.PermanentDelegate) ? getPermanentDelegate(parsed) : null;
  const state = types.includes(ExtensionType.DefaultAccountState) ? getDefaultAccountState(parsed) : null;
  const hook = types.includes(ExtensionType.TransferHook) ? getTransferHook(parsed) : null;
  const close = types.includes(ExtensionType.MintCloseAuthority) ? getMintCloseAuthority(parsed) : null;
  const pause = types.includes(ExtensionType.PausableConfig) ? getPausableConfig(parsed) : null;
  return {
    ...base,
    /* By the program's own numbers, not a library's names: a new spl-token naming an extension changes no fingerprint. */
    extensions: types.map((type) => String(type)).sort((a, b) => Number(a) - Number(b)),
    transferFee: fee
      ? { authority: key(fee.transferFeeConfigAuthority), withdrawAuthority: key(fee.withdrawWithheldAuthority), older: feeOf(fee.olderTransferFee), newer: feeOf(fee.newerTransferFee) }
      : null,
    permanentDelegate: delegate ? key(delegate.delegate) : null,
    defaultAccountState: state ? (ACCOUNT_STATES[state.state as 0 | 1 | 2] ?? "uninitialized") : null,
    transferHook: hook ? { authority: key(hook.authority), program: key(hook.programId) } : null,
    closeAuthority: close ? key(close.closeAuthority) : null,
    pausable: pause ? { authority: key(pause.authority), paused: Boolean(pause.paused) } : null,
  };
}

/** The value a field is compared by — the profile's own words for it. */
function fieldValue(profile: MintProfile, field: MintProfileField): string {
  switch (field) {
    case "transferFee":
      return JSON.stringify(profile.transferFee ? { older: profile.transferFee.older, newer: profile.transferFee.newer } : null);
    case "transferFeeAuthority":
      return JSON.stringify(profile.transferFee ? { authority: profile.transferFee.authority, withdraw: profile.transferFee.withdrawAuthority } : null);
    default:
      return JSON.stringify(profile[field]);
  }
}

/** The fields whose value is not the same in the two profiles, in the order of `MINT_PROFILE_FIELDS`. */
export function mintProfileChanges(before: MintProfile, after: MintProfile): MintProfileField[] {
  return MINT_PROFILE_FIELDS.filter((field) => fieldValue(before, field) !== fieldValue(after, field));
}

/** The profile in one canonical line: equal profiles, equal lines — what a fingerprint is taken of. */
export function mintProfileLine(profile: MintProfile): string {
  return JSON.stringify(MINT_PROFILE_FIELDS.map((field) => [field, fieldValue(profile, field)]));
}

