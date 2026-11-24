import { CONTACT_ID, contactOf, type ChangeAction, type Contact, type ContactChange } from '../../../lib/contacts/model.ts';

/**
 * «Contacts» as data: when the tab stands, what the list reads as, the
 * change a wallet signs, and what each refusal of the engine means on screen. The book itself and every rule of a
 * contact are the engine's (`lib/contacts/**`); a contact is only a name for an address — «Send» still reads the address
 * and still warns on a new one.
 *
 * Pure: no clock it is not given, no network, no store — the tests read it as it is.
 */

export const CONTACTS_ENDPOINT = '/api/v1/contacts';

export { contactsOpen } from './open.ts';

/** The list as the screen holds it: being read, the wallet's own contacts, locked behind the wallet's proof, or not read. */
export type ContactsRead = Readonly<{ state: 'reading' }> | Readonly<{ state: 'ready'; contacts: readonly Contact[] }> | Readonly<{ state: 'locked' }> | Readonly<{ state: 'failed' }>;

/** The engine's answer to `GET /api/v1/contacts` for this wallet. */
export function listOf(status: number, body: unknown, owner: string): ContactsRead {
  if (status === 401) return { state: 'locked' };
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { state: 'failed' };
  const answer = body as { address?: unknown; contacts?: unknown };
  // A proof this browser holds for another wallet lists that wallet's book: never shown as this one's.
  if (answer.address !== owner) return { state: 'locked' };
  if (!Array.isArray(answer.contacts)) return { state: 'failed' };
  return { state: 'ready', contacts: answer.contacts.map(contactOf).filter((contact): contact is Contact => contact !== null) };
}

const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** A nonce of 24 letters and digits drawn from the browser's own randomness. */
export function nonceFrom(random: Uint8Array): string {
  return Array.from(random.slice(0, 24), (byte) => ALPHANUM[byte % ALPHANUM.length]).join('');
}

/** A contact's id for a new one: a UUID the browser draws, so the signed text can name it. */
export function idFrom(uuid: string): string | null {
  const id = uuid.toLowerCase();
  return CONTACT_ID.test(id) ? id : null;
}

/** One change as the wallet signs it: the fields as the book keeps them, the wallet, a fresh nonce and this moment. */
export function changeOf(input: Readonly<{ action: ChangeAction; wallet: string; id: string; fields: Readonly<{ name: string; to: string; note: string | null }> | null; nonce: string; nowMs: number }>): ContactChange {
  const fields = input.action === 'remove' ? null : input.fields;
  return {
    action: input.action,
    wallet: input.wallet,
    id: input.id,
    name: fields?.name ?? null,
    to: fields?.to ?? null,
    note: fields?.note ?? null,
    nonce: input.nonce,
    issuedAt: new Date(input.nowMs).toISOString(),
  };
}

/** What a change came to, as the screen says it. */
export type ChangeOutcome = 'done' | 'declined' | 'unsupported' | 'locked' | 'signature' | 'stale' | 'taken' | 'full' | 'missing' | 'failed';

/** The engine's refusal of a change, in the screen's words. */
export function outcomeOf(status: number, body: unknown): ChangeOutcome {
  if (status >= 200 && status < 300) return 'done';
  if (status === 401) return 'locked';
  const error = body && typeof body === 'object' ? (body as { error?: { code?: unknown; issues?: readonly { path?: unknown }[] } }).error : null;
  const code = typeof error?.code === 'string' ? error.code : null;
  const path = typeof error?.issues?.[0]?.path === 'string' ? error.issues[0].path : null;
  if (code === 'SIGNATURE_INVALID') return 'signature';
  if (code === 'NONCE_INVALID') return 'stale';
  if (path === 'change.to') return 'taken';
  if (path === 'contacts') return 'full';
  if (path === 'change.id') return 'missing';
  return 'failed';
}

/** An address shortened for a row: its first and last four, the whole of it stays a tap away. A name stays whole. */
export function shortTo(to: string): string {
  return to.endsWith('.skr') || to.length <= 12 ? to : `${to.slice(0, 4)}…${to.slice(-4)}`;
}

/** «Send» to a contact: the Money section's «Send» with the address in «To». */
export function sendTo(contact: Pick<Contact, 'to'>): string {
  return `/money?to=${encodeURIComponent(contact.to)}`;
}

/** What `?to=` asks «Send» to put in «To»: an address or a `.skr` name as typed, nothing else. */
export function toFromQuery(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text) || /^[a-z0-9_-]{1,63}\.skr$/i.test(text) ? text : null;
}
