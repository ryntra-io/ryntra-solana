/**
 * A person's own Send receipts, in their own browser.
 *
 * **The product reversed the position this comment used to argue.** It read:
 * *this browser and nowhere else, which is the design rather than a limitation
 * to route around — a server-side archive of who paid whom is a database this
 * product has no reason to hold and every reason not to.* Since 2026-09-03 the
 * product holds the opposite, for a reason: a cabinet that lives in
 * `localStorage` belongs to a device, so the same wallet shows different history
 * on a phone and a laptop, and *a private receipt only its owner can see* is a
 * wish rather than a fact. The argument above was about the wrong risk — the
 * question is not whether to hold receipts, it is who may open them.
 *
 * So this is now a **cache with a known gap**, not the design. The server
 * archive it should become waits on one thing: a receipt is private data,
 * opened only after proof of ownership, and this repository has no Solana
 * sign-in — `/api/auth/wallet` is EVM SIWE and refuses wallet-only accounts on
 * purpose. Until that sign-in exists this stays the receipt journal.
 *
 * What did move meanwhile: the wallet-scoped action ledger records *that* a
 * transfer happened, keyed by the wallet, and is public by address because
 * everything in it is already on the chain. History reads that from any
 * browser, and a swap recovered there writes its receipt into this vault. The
 * consequence that remains is stated plainly on the surface — clearing site
 * data clears the receipts — and the downloadable signed JSON is the copy that
 * outlives it.
 *
 * Every read and write is wrapped. A private window, blocked site data or a
 * quota that is already full must produce an empty history, never a page that
 * fails to render because storage threw.
 */

/* Keep the shipped key so every receipt already in this browser survives the
   journal becoming shared by Send and Swap. The exported Send name remains a
   compatibility alias for callers released before the shared journal. */
export const SOLANA_RECEIPT_VAULT_KEY = "ryntra.solana.send-receipts.v1";
export const SOLANA_SEND_RECEIPT_VAULT_KEY = SOLANA_RECEIPT_VAULT_KEY;
export const SOLANA_SEND_RECEIPT_VAULT_LIMIT = 50;
/** The one-time verifier handoff, matching the Agent Control contract. */
export const SOLANA_SEND_RECEIPT_HANDOFF_KEY = "ryntra:action-passport-preview:handoff";

/** Only the fields a receipt card and the verifier need. */
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredSendReceipt = Readonly<{
  wallet: string;
  storedAt: string;
  receipt: Record<string, unknown>;
}>;

export type StoreReceiptResult =
  | Readonly<{ ok: true; duplicate?: true }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * A receipt is an object carrying an id and a content hash.
 *
 * Deliberately shallow: this validates that the artifact is the kind of thing
 * a receipt card can render and the verifier can read, and nothing more. The
 * artifact's own signature is what makes it true, and that is checked by the
 * verifier rather than re-implemented here.
 */
function isReceipt(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : record.receiptId;
  return typeof id === "string" && id.length > 0 && typeof record.contentHash === "string";
}

function receiptIdOf(receipt: Record<string, unknown>): string {
  return String(typeof receipt.id === "string" ? receipt.id : receipt.receiptId);
}

/** Nothing signable and nothing secret is ever written to a browser store. */
const NEVER_STORED = new Set(["privatekey", "secretkey", "mnemonic", "seedphrase"]);

function mustStrip(key: string): boolean {
  const compact = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return NEVER_STORED.has(compact) || /(?:transaction|wire)(?:base64|bytes)$/.test(compact);
}

function strippedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strippedValue);
  if (typeof value !== "object" || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (mustStrip(key)) continue;
    copy[key] = strippedValue(nested);
  }
  return copy;
}

function stripped(receipt: Record<string, unknown>): Record<string, unknown> {
  return strippedValue(receipt) as Record<string, unknown>;
}

function readAll(storage: StorageLike): StoredSendReceipt[] {
  let raw: string | null;
  try {
    raw = storage.getItem(SOLANA_SEND_RECEIPT_VAULT_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredSendReceipt =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as StoredSendReceipt).wallet === "string" &&
        typeof (entry as StoredSendReceipt).storedAt === "string" &&
        isReceipt((entry as StoredSendReceipt).receipt),
    );
  } catch {
    return [];
  }
}

/** Newest first, for this exact wallet. Base58 is case-sensitive. */
export function readSolanaReceipts(storage: StorageLike, wallet: string): readonly StoredSendReceipt[] {
  return readAll(storage).filter((entry) => entry.wallet === wallet);
}

/** Compatibility name for the first release of the same browser-local vault. */
export const readSendReceipts = readSolanaReceipts;

export function storeSolanaReceipt(
  storage: StorageLike,
  wallet: string,
  receipt: unknown,
  now: Date = new Date(),
): StoreReceiptResult {
  if (!isReceipt(receipt)) {
    return { ok: false, reason: "That artifact is not a receipt this history can hold." };
  }
  const existing = readAll(storage);
  if (existing.some((entry) => entry.wallet === wallet && entry.receipt.contentHash === receipt.contentHash)) {
    return { ok: true, duplicate: true };
  }
  const next = [
    { wallet, storedAt: now.toISOString(), receipt: stripped(receipt) },
    ...existing,
  ];
  /* The cap is per wallet, so one busy address cannot evict another's history. */
  const kept: StoredSendReceipt[] = [];
  const perWallet = new Map<string, number>();
  for (const entry of next) {
    const count = perWallet.get(entry.wallet) ?? 0;
    if (count >= SOLANA_SEND_RECEIPT_VAULT_LIMIT) continue;
    perWallet.set(entry.wallet, count + 1);
    kept.push(entry);
  }
  try {
    storage.setItem(SOLANA_SEND_RECEIPT_VAULT_KEY, JSON.stringify(kept));
    return { ok: true };
  } catch {
    return { ok: false, reason: "This browser would not store the receipt. Download the signed JSON instead." };
  }
}

/** Compatibility name for callers that predate the shared receipt journal. */
export const storeSendReceipt = storeSolanaReceipt;

/**
 * A settled artifact belongs to the wallet that produced the settlement.
 * `expectedWallet` comes from the authoritative action record — direct taker
 * or recovery attempt — never from whichever wallet happens to be connected
 * when React renders the result.
 */
export function storeBoundSolanaReceipt(
  storage: StorageLike,
  settledWallet: string | null,
  expectedWallet: string | null,
  receipt: unknown,
  now: Date = new Date(),
): StoreReceiptResult {
  if (!settledWallet || settledWallet !== expectedWallet) {
    return { ok: false, reason: "The receipt belongs to a different wallet session." };
  }
  return storeSolanaReceipt(storage, settledWallet, receipt, now);
}

/** Hand one receipt to the verifier. It removes the artifact after reading it. */
export function stageReceiptForVerifier(storage: StorageLike, receipt: unknown): void {
  if (!isReceipt(receipt)) return;
  try {
    storage.setItem(SOLANA_SEND_RECEIPT_HANDOFF_KEY, JSON.stringify(receipt));
  } catch {
    /* A verifier that cannot be handed an artifact is opened without one and
       says so; it is not worth failing the receipt card over. */
  }
}

/** The durable copy: the exact signed artifact, as a file the person keeps. */
export function downloadReceipt(receipt: unknown, filename?: string): boolean {
  if (!isReceipt(receipt) || typeof document === "undefined") return false;
  try {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename ?? `ryntra-receipt-${receiptIdOf(receipt)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
