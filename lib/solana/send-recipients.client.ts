/**
 * The addresses this wallet sent money to from this browser, newest first (B18): the three chips under «Кому».
 *
 * Only an address a transfer actually reached — written once the chain was read back, never on typing — so a chip is
 * never an address somebody pasted at the page, and never one learned from incoming transactions (the way address
 * poisoning plants look-alikes). Owner-bound, like the remembered asset: another wallet in this browser sees its own.
 * Public addresses only; nothing here is secret, and blocked storage costs the chips, never the form.
 */

type StringStorage = Pick<Storage, "getItem" | "setItem">;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const KEEP = 5;

const keyFor = (owner: string): string => `ryntra.solana.send.recipients:${owner}`;

export function recentSendRecipients(storage: StringStorage, owner: string): readonly string[] {
  if (!owner) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(keyFor(owner)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && BASE58_ADDRESS.test(value) && value !== owner).slice(0, KEEP);
  } catch {
    return [];
  }
}

export function rememberSendRecipient(storage: StringStorage, owner: string, recipient: string): readonly string[] {
  if (!owner || !BASE58_ADDRESS.test(recipient) || recipient === owner) return recentSendRecipients(storage, owner);
  const next = [recipient, ...recentSendRecipients(storage, owner).filter((value) => value !== recipient)].slice(0, KEEP);
  try {
    storage.setItem(keyFor(owner), JSON.stringify(next));
  } catch {
    /* Private mode may refuse storage; the chips are a convenience, never a gate. */
  }
  return next;
}

/**
 * No transfer from this browser has reached this address yet (SEC-2) — the phone's rule, the same list
 * (`isNewRecipient`, `apps/mobile/src/features/money/recipients.ts`). It is asked of the recipients only: the wallet's
 * own address is not a recipient, and a transfer to it is refused before this is read.
 */
export function isNewRecipient(recents: readonly string[], address: string): boolean {
  return !recents.includes(address);
}
