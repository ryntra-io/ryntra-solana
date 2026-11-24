/**
 * The address book in the database: one call to one `public.contacts_*` function per question, each gated
 * by the app secret and each one transaction (`supabase/migrations/20261121090000_contacts_autopay_v1.sql`). The
 * tables live in the `private` schema with every grant revoked; the server never holds the service key. The transport
 * is the server's usual one (`rpcResult`, which adds the secret); a test passes its own.
 *
 * Until the migration is applied a function that is not there is a store that did not answer: the book reads as
 * unavailable, never as empty.
 */

import { contactOf, type Contact, type ContactChange } from "./model.ts";

export type ContactsRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

/** The server's usual transport, loaded on first use (it reads the deployment's database settings). */
export const contactsRpc: ContactsRpc = async (fn, args) => (await import("../supabase-rpc.ts")).rpcResult("contacts", fn, args);

export class ContactsUnavailable extends Error {
  constructor(reason: string) {
    super(`The contacts store did not answer: ${reason}.`);
    this.name = "ContactsUnavailable";
  }
}

/** Why the store refused a change, in its own words: a nonce used before, no such contact, the book full, the address kept already. */
export type ChangeRefused = "replayed" | "not_found" | "full" | "taken";

export type ChangeStored = Readonly<{ ok: true; contact: Contact | null }> | Readonly<{ ok: false; refused: ChangeRefused }>;

const REFUSALS: readonly ChangeRefused[] = ["replayed", "not_found", "full", "taken"];
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export type ContactsStore = Readonly<{
  list(owner: string): Promise<readonly Contact[]>;
  change(change: ContactChange): Promise<ChangeStored>;
}>;

export function contactsStore(rpc: ContactsRpc = contactsRpc): ContactsStore {
  return {
    async list(owner) {
      const answer = await rpc("contacts_list", { p_owner: owner });
      if (!answer.ok) throw new ContactsUnavailable(answer.error);
      const data = answer.data;
      if (!isRecord(data) || data.ok !== true || !Array.isArray(data.contacts)) throw new ContactsUnavailable("contacts_list: unreadable answer");
      return data.contacts.map(contactOf).filter((contact): contact is Contact => contact !== null);
    },
    async change(change) {
      const answer = await rpc("contacts_change", {
        p_owner: change.wallet,
        p_action: change.action,
        p_id: change.id,
        p_name: change.name,
        p_to: change.to,
        p_note: change.note,
        p_nonce: change.nonce,
      });
      if (!answer.ok) throw new ContactsUnavailable(answer.error);
      const data = answer.data;
      if (!isRecord(data)) throw new ContactsUnavailable("contacts_change: unreadable answer");
      if (data.ok === true) return { ok: true, contact: data.contact === null || data.contact === undefined ? null : contactOf(data.contact) };
      if (REFUSALS.includes(data.error as ChangeRefused)) return { ok: false, refused: data.error as ChangeRefused };
      throw new ContactsUnavailable(`contacts_change: ${typeof data.error === "string" ? data.error : "refused"}`);
    },
  };
}
