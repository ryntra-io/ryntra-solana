/*
 * The symbols this product can actually execute, derived from the pre-sign
 * allowlist rather than restated beside it.
 *
 * `lib/arcus/spot-exec-policy.ts` is the fail-closed validator every spot
 * execution passes through, and its token metadata map is the authority on
 * what can be signed. Writing the list again here would create the exact
 * defect the Radar exists to prevent — a surface claiming an instrument is
 * executable while the validator refuses it, or the reverse.
 *
 * `USDG` is excluded deliberately: it is the quote asset, not a tradable base.
 */
import { readRialtoExecutionTokenMetadata } from "../arcus/spot-exec-policy.ts";

const EXECUTION_TOKEN_ADDRESSES: readonly string[] = Object.freeze([
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
  "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc",
]);

/**
 * Read through the validator, so a token removed from the allowlist disappears
 * here too rather than lingering as a claim.
 */
export const EXECUTABLE_SPOT_SYMBOLS: readonly string[] = Object.freeze(
  EXECUTION_TOKEN_ADDRESSES.map((address) => readRialtoExecutionTokenMetadata(address)?.symbol).filter(
    (symbol): symbol is string => typeof symbol === "string",
  ),
);
