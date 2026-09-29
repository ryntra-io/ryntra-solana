/** A tiny tab-local convenience: selection is owner-bound and never guessed. */

type StringStorage = Pick<Storage, "getItem" | "setItem">;

const keyFor = (owner: string): string => `ryntra.solana.send.asset:${owner}`;

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
