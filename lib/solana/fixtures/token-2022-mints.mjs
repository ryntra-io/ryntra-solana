/**
 * Token-2022 mint accounts for the pair-currency watch's tests (SOL-L12), laid out byte for byte by `@solana/spl-token`'s
 * own layouts — the base mint, the account type, then each extension as type · length · data — so `unpackMint` reads
 * them as it reads a mint on chain. Synthetic: the classic USDC beside them is mainnet's (`./usdc-spl.json`).
 */
import {
  ACCOUNT_SIZE,
  AccountType,
  DefaultAccountStateLayout,
  ExtensionType,
  MetadataPointerLayout,
  MintCloseAuthorityLayout,
  MintLayout,
  PausableConfigLayout,
  PermanentDelegateLayout,
  ScaledUiAmountConfigLayout,
  TOKEN_2022_PROGRAM_ID,
  TransferFeeConfigLayout,
  TransferHookLayout,
  getTypeLen,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const ISSUER = new PublicKey("9WBQamBC9Amdzzrq8QANXweZCKpfhLMLvPQJzMBgFbbu");
export const OTHER = new PublicKey("Fb2AbDwuQ4yNvmQRK7bTZWXoDZRE3AYLcqamPyhg4tL8");
export const HOOK = new PublicKey("EAMKay5kBxeN78xCvHVyL77ZkhGqkuTmJC2G4D2MsUuC");

const fee = (epoch, bps, max = 1_000_000_000n) => ({ epoch: BigInt(epoch), maximumFee: BigInt(max), transferFeeBasisPoints: bps });

const LAYOUTS = {
  [ExtensionType.TransferFeeConfig]: TransferFeeConfigLayout,
  [ExtensionType.PermanentDelegate]: PermanentDelegateLayout,
  [ExtensionType.DefaultAccountState]: DefaultAccountStateLayout,
  [ExtensionType.TransferHook]: TransferHookLayout,
  [ExtensionType.MintCloseAuthority]: MintCloseAuthorityLayout,
  [ExtensionType.PausableConfig]: PausableConfigLayout,
  [ExtensionType.ScaledUiAmountConfig]: ScaledUiAmountConfigLayout,
  [ExtensionType.MetadataPointer]: MetadataPointerLayout,
};

/** A Token-2022 mint's account: `extensions` maps an extension type to the fields its layout encodes. */
export function token2022Mint({ decimals = 6, mintAuthority = ISSUER, freezeAuthority = null, extensions = {} } = {}) {
  const base = Buffer.alloc(ACCOUNT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: mintAuthority ? 1 : 0,
      mintAuthority: mintAuthority ?? PublicKey.default,
      supply: 1_000_000_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: freezeAuthority ? 1 : 0,
      freezeAuthority: freezeAuthority ?? PublicKey.default,
    },
    base,
  );
  const parts = [base, Buffer.from([AccountType.Mint])];
  for (const [type, fields] of Object.entries(extensions)) {
    const length = getTypeLen(Number(type));
    const data = Buffer.alloc(length);
    LAYOUTS[type].encode(fields, data);
    const head = Buffer.alloc(4);
    head.writeUInt16LE(Number(type), 0);
    head.writeUInt16LE(length, 2);
    parts.push(head, data);
  }
  return { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.concat(parts), lamports: 1, executable: false };
}

/**
 * A transfer fee extension: `older` in force, `newer` from its epoch. An authority given as null is written as the zero
 * key, which is how the token program itself stores a revoked one.
 */
export function transferFee({ older = fee(0, 0, 0), newer = fee(0, 0, 0), authority = ISSUER, withdraw = ISSUER } = {}) {
  return {
    [ExtensionType.TransferFeeConfig]: {
      transferFeeConfigAuthority: authority ?? PublicKey.default,
      withdrawWithheldAuthority: withdraw ?? PublicKey.default,
      withheldAmount: 0n,
      olderTransferFee: older,
      newerTransferFee: newer,
    },
  };
}

/**
 * The Scaled UI Amount extension — a tokenized stock's own (SOL-L11): one token stands for `multiplier` of the unit,
 * and `newMultiplier` from `effectiveAt` (seconds) where the issuer has scheduled a change.
 */
export function scaledUiAmount({ multiplier = 1, newMultiplier = 1, effectiveAt = 0, authority = ISSUER } = {}) {
  return {
    [ExtensionType.ScaledUiAmountConfig]: { authority, multiplier, newMultiplierEffectiveTimestamp: BigInt(effectiveAt), newMultiplier },
  };
}

/** The metadata pointer — one of the three extensions DBC needs no token badge for. */
export function metadataPointer({ authority = ISSUER, metadataAddress = ISSUER } = {}) {
  return { [ExtensionType.MetadataPointer]: { authority, metadataAddress } };
}

export { fee };
