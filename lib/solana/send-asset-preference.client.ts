/** A tiny tab-local convenience: selection is owner-bound and never guessed. */

type StringStorage = Pick<Storage, "getItem" | "setItem">;

const keyFor = (owner: string): string => `ryntra.solana.send.asset:${owner}`;

/** USDC on Solana — the coin purchases are made in, so «Надіслати» opens on it (B18). */
export const SEND_OPENING_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Native SOL's id in the Send picker. */
export const SEND_NATIVE_SOL = "native:sol";

export function rememberSendAsset(
  storage: StringStorage,
  owner: string,
  assetId: string,
): void {
  if (!owner || !assetId) return;
  try {
    storage.setItem(keyFor(owner), assetId);
  } catch {
    /* Private mode and embedded browsers may block storage. Selection still
       works for the current render; persistence is convenience, never a gate. */
  }
}
export function preferredSendAsset(
  storage: StringStorage,
  owner: string,
  availableAssetIds: readonly string[],
): string {
  if (!owner) return "";
  try {
    const remembered = storage.getItem(keyFor(owner));
    return remembered && availableAssetIds.includes(remembered) ? remembered : "";
  } catch {
    return "";
  }
}

/**
 * What «Надіслати» opens on (B18, the B13 review's item 12: «USDC одразу, без «? Актив»»).
 *
 * The coin this wallet last sent, while it still holds it; otherwise USDC, the coin purchases are made in; otherwise
 * the wallet's SOL. Never a coin the wallet does not hold — the pill names what the form will send, and the Review
 * repeats it before any signature — and nothing at all when the wallet holds neither.
 */
export function openingSendAsset(remembered: string, availableAssetIds: readonly string[]): string {
  if (remembered && availableAssetIds.includes(remembered)) return remembered;
  if (availableAssetIds.includes(SEND_OPENING_USDC)) return SEND_OPENING_USDC;
  if (availableAssetIds.includes(SEND_NATIVE_SOL)) return SEND_NATIVE_SOL;
  return "";
}
