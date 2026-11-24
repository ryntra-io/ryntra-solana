/**
 * The address book's two questions, behind `/api/v1/contacts`:
 *
 * - `readContacts` — the proven wallet's contacts;
 * - `changeContact` — one change the wallet signed: the text is built again here from the fields (`changeText`), never
 *   taken from the client; the signature must be the wallet's own over exactly that text; the wallet must be the one
 *   that proved itself to this route; the change must be fresh, and its nonce is spent in the same transaction that
 *   writes it, so a signature works once.
 *
 * Nothing here moves money or touches a key. A contact is only a name for an address: «Send» still reads the address
 * the engine's way and still warns on a new recipient.
 */

import { PublicKey } from "@solana/web3.js";

import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { changeFresh, changeRefusal, changeText, type Contact, type ContactChange } from "./model.ts";
import { ContactsUnavailable, contactsStore, type ChangeRefused, type ContactsStore } from "./store.server.ts";

export const CONTACTS_ENV = "RYNTRA_CONTACTS";

/**
 * The server's switch for the address book (`RYNTRA_CONTACTS` — `1`, `on` or `true`): closed, `/api/v1/contacts` answers
 * that it is not open here and calls nothing. The screen's own switch (`NEXT_PUBLIC_RYNTRA_CONTACTS`) only shows the tab.
 */
export function contactsOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env[CONTACTS_ENV]?.trim().toLowerCase();
  return value === "1" || value === "on" || value === "true";
}

export type ContactsDeps = Readonly<{ store?: ContactsStore; now?: () => number }>;

export type ContactsRead = Readonly<{ ok: true; contacts: readonly Contact[] }> | Readonly<{ ok: false; code: "UNAVAILABLE" }>;

export async function readContacts(owner: string, deps: ContactsDeps = {}): Promise<ContactsRead> {
  try {
    return { ok: true, contacts: await (deps.store ?? contactsStore()).list(owner) };
  } catch (error) {
    if (error instanceof ContactsUnavailable) return { ok: false, code: "UNAVAILABLE" };
    throw error;
  }
}

/** Why a change was not made, as the route answers it. */
export type ChangeCode = "VALIDATION_ERROR" | "WALLET_MISMATCH" | "SIGNATURE_INVALID" | "NONCE_INVALID" | "NOT_FOUND" | "FULL" | "TAKEN" | "UNAVAILABLE";

export type ChangeResult = Readonly<{ ok: true; contact: Contact | null }> | Readonly<{ ok: false; code: ChangeCode; reason: string }>;

const STORE_REFUSALS: Readonly<Record<ChangeRefused, Readonly<{ code: ChangeCode; reason: string }>>> = {
  replayed: { code: "NONCE_INVALID", reason: "This signature was used already. Sign the change again." },
  not_found: { code: "NOT_FOUND", reason: "There is no such contact in this wallet's book." },
  full: { code: "FULL", reason: "The book holds 200 contacts. Remove one to add another." },
  taken: { code: "TAKEN", reason: "This address is in the book already." },
};

/** The wallet's signature, base64 of 64 bytes; null when it is not one. */
export function signatureBytes(text: string): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(text)) return null;
  const bytes = Uint8Array.from(Buffer.from(text, "base64"));
  return bytes.length === 64 ? bytes : null;
}

/** Whether `signature` is the wallet's own over the change's text. */
export function changeSigned(change: ContactChange, signature: Uint8Array): boolean {
  try {
    return ed25519Valid(new TextEncoder().encode(changeText(change)), signature, new PublicKey(change.wallet));
  } catch {
    return false;
  }
}

export async function changeContact(input: Readonly<{ proven: string; change: ContactChange; signature: string }>, deps: ContactsDeps = {}): Promise<ChangeResult> {
  const { change } = input;
  const refusal = changeRefusal(change);
  if (refusal) return { ok: false, code: "VALIDATION_ERROR", reason: `The change is not one the book takes: ${refusal}.` };
  if (change.wallet !== input.proven) return { ok: false, code: "WALLET_MISMATCH", reason: "The change names another wallet than the one signed in." };
  const now = (deps.now ?? Date.now)();
  if (!changeFresh(change, now)) return { ok: false, code: "NONCE_INVALID", reason: "The signature is older than a few minutes. Sign the change again." };
  const signature = signatureBytes(input.signature);
  if (!signature || !changeSigned(change, signature)) return { ok: false, code: "SIGNATURE_INVALID", reason: "The wallet's signature does not match this change." };
  try {
    const stored = await (deps.store ?? contactsStore()).change(change);
    if (!stored.ok) return { ok: false, ...STORE_REFUSALS[stored.refused] };
    return { ok: true, contact: stored.contact };
  } catch (error) {
    if (error instanceof ContactsUnavailable) return { ok: false, code: "UNAVAILABLE", reason: "The contacts could not be saved. Try again." };
    throw error;
  }
}
