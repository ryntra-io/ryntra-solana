// Run from repo root: node --test lib/contacts/contacts.test.mjs
//
// The address book: what a contact is, the text a wallet signs for a change, and the server's checks of
// that signature (fresh, once, the wallet's own, over exactly the fields it was sent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  CHANGE_FRESH_MS,
  CONTACTS_MAX,
  NAME_MAX,
  NOTE_MAX,
  changeFresh,
  changeRefusal,
  changeText,
  cleanDraft,
  contactFor,
  contactOf,
  draftIssue,
  isAddress,
  lookalikeContact,
  nameOf,
  noteOf,
  suggestions,
  targetOf,
} from "./model.ts";
import { changeContact, changeSigned, readContacts, signatureBytes } from "./service.server.ts";
import { ContactsUnavailable, contactsStore } from "./store.server.ts";

const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

/** A wallet's signature over a text, as `solana:signMessage` returns it. */
function signText(keypair, text) {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(keypair.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return Buffer.from(sign(null, Buffer.from(new TextEncoder().encode(text)), key)).toString("base64");
}

const wallet = Keypair.generate();
const other = Keypair.generate();
const friend = Keypair.generate().publicKey.toBase58();
const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

function change(fields = {}) {
  return {
    action: "add",
    wallet: wallet.publicKey.toBase58(),
    id: ID,
    name: "Mom",
    to: friend,
    note: "rent",
    nonce: "a1b2c3d4e5f6a7b8c9d0",
    issuedAt: new Date(NOW).toISOString(),
    ...fields,
  };
}

/** A store that answers as the database would, and remembers the nonces it spent. */
function memoryStore() {
  const nonces = new Set();
  const rows = new Map();
  return {
    rows,
    async list(owner) {
      return [...rows.values()].filter((row) => row.owner === owner).map(({ owner: _owner, ...contact }) => contact);
    },
    async change(c) {
      const key = `${c.wallet}:${c.nonce}`;
      if (nonces.has(key)) return { ok: false, refused: "replayed" };
      nonces.add(key);
      if (c.action === "remove") {
        if (!rows.delete(c.id)) return { ok: false, refused: "not_found" };
        return { ok: true, contact: null };
      }
      if ([...rows.values()].some((row) => row.owner === c.wallet && row.to === c.to && row.id !== c.id)) return { ok: false, refused: "taken" };
      const at = new Date(NOW).toISOString();
      const contact = { id: c.id, name: c.name, to: c.to, note: c.note, createdAt: at, updatedAt: at };
      rows.set(c.id, { owner: c.wallet, ...contact });
      return { ok: true, contact };
    },
  };
}

test("an address is base58 of exactly 32 bytes; a .skr name is plain ASCII", () => {
  assert.equal(isAddress(friend), true);
  assert.equal(isAddress("11111111111111111111111111111111"), true, "the system program's address is 32 zero bytes");
  assert.equal(isAddress(friend.slice(0, 30)), false, "a cut paste is too short");
  assert.equal(isAddress(`${friend}zzzz`), false, "too long");
  assert.equal(isAddress(friend.replace(/[1-9A-HJ-NP-Za-km-z]/, "0")), false, "a misread character");
  assert.deepEqual(targetOf(" Alice.SKR "), { kind: "name", value: "alice.skr" });
  assert.equal(targetOf("аlice.skr"), null, "a Cyrillic homograph is never a name");
  assert.equal(targetOf("alice.sol"), null);
  assert.equal(targetOf("0x52908400098527886E0F7030069857D2E4169EE7"), null);
  assert.deepEqual(targetOf(friend), { kind: "address", value: friend });
});

test("a name and a note are tidied: invisible marks become spaces, runs of space one, bounded lengths", () => {
  assert.equal(nameOf("  Mo​m \n\t Dad  "), "Mo m Dad");
  assert.equal(nameOf(""), null);
  assert.equal(nameOf("‮"), null, "a direction override alone is no name");
  assert.equal(nameOf("x".repeat(NAME_MAX)), "x".repeat(NAME_MAX));
  assert.equal(nameOf("x".repeat(NAME_MAX + 1)), null);
  assert.equal(noteOf(null), null);
  assert.equal(noteOf("   "), null);
  assert.equal(noteOf("y".repeat(NOTE_MAX + 1)), undefined);
  assert.equal(noteOf("for\nthe rent"), "for the rent");
});

test("a draft: its first wrong field, never the wallet itself", () => {
  const owner = wallet.publicKey.toBase58();
  assert.equal(draftIssue({ name: "", to: friend }, owner), "name");
  assert.equal(draftIssue({ name: "Mom", to: "nope" }, owner), "to");
  assert.equal(draftIssue({ name: "Me", to: owner }, owner), "self");
  assert.equal(draftIssue({ name: "Mom", to: friend, note: "z".repeat(200) }, owner), "note");
  assert.deepEqual(cleanDraft({ name: " Mom ", to: ` ${friend} `, note: "" }, owner), { name: "Mom", to: friend, note: null });
});

test("the signed text names the change, the wallet, the contact, the nonce and the moment, line for line", () => {
  const text = changeText(change());
  assert.equal(
    text,
    ["Ryntra — contacts", "Change: add", `Wallet: ${wallet.publicKey.toBase58()}`, `Contact: ${ID}`, "Name: Mom", `To: ${friend}`, "Note: rent", "Nonce: a1b2c3d4e5f6a7b8c9d0", `Issued: ${new Date(NOW).toISOString()}`].join("\n"),
  );
  const removal = changeText(change({ action: "remove", name: null, to: null, note: null }));
  assert.ok(!removal.includes("Name:"), "a removal carries no fields");
  assert.notEqual(changeText(change({ note: null })), text);
});

test("a change is refused before any signature when its fields are not the book's", () => {
  assert.equal(changeRefusal(change()), null);
  assert.match(changeRefusal(change({ action: "wipe" })), /add, edit or remove/);
  assert.match(changeRefusal(change({ id: "x" })), /UUID/);
  assert.match(changeRefusal(change({ nonce: "short" })), /nonce/);
  assert.match(changeRefusal(change({ issuedAt: "2026-11-20 12:00" })), /ISO/);
  assert.match(changeRefusal(change({ name: " Mom" })), /tidy/);
  assert.match(changeRefusal(change({ to: wallet.publicKey.toBase58() })), /not one the book keeps/);
  assert.match(changeRefusal(change({ action: "remove" })), /no fields/);
});

test("freshness: a few minutes either way", () => {
  assert.equal(changeFresh(change(), NOW + CHANGE_FRESH_MS), true);
  assert.equal(changeFresh(change(), NOW + CHANGE_FRESH_MS + 1), false);
  assert.equal(changeFresh(change(), NOW - CHANGE_FRESH_MS - 1), false);
});

test("the server: the wallet's own signature over exactly this change, fresh and once", async () => {
  const store = memoryStore();
  const deps = { store, now: () => NOW + 1_000 };
  const proven = wallet.publicKey.toBase58();
  const c = change();
  const signature = signText(wallet, changeText(c));
  assert.equal(signatureBytes(signature)?.length, 64);
  assert.equal(changeSigned(c, signatureBytes(signature)), true);

  const made = await changeContact({ proven, change: c, signature }, deps);
  assert.equal(made.ok, true);
  assert.equal(made.contact.name, "Mom");

  const again = await changeContact({ proven, change: c, signature }, deps);
  assert.deepEqual([again.ok, again.code], [false, "NONCE_INVALID"], "a signature works once");

  const tampered = change({ to: Keypair.generate().publicKey.toBase58(), nonce: "z9y8x7w6v5u4t3s2r1q0" });
  const forTampered = signText(wallet, changeText({ ...tampered, to: friend }));
  const swapped = await changeContact({ proven, change: tampered, signature: forTampered }, deps);
  assert.deepEqual([swapped.ok, swapped.code], [false, "SIGNATURE_INVALID"], "a field changed after signing breaks the signature");

  const byOther = change({ nonce: "q1w2e3r4t5y6u7i8o9p0" });
  const othersSignature = signText(other, changeText(byOther));
  const forged = await changeContact({ proven, change: byOther, signature: othersSignature }, deps);
  assert.deepEqual([forged.ok, forged.code], [false, "SIGNATURE_INVALID"], "another wallet's signature changes nothing");

  const elsewhere = change({ wallet: other.publicKey.toBase58(), nonce: "m1n2b3v4c5x6z7l8k9j0" });
  const mismatch = await changeContact({ proven, change: elsewhere, signature: signText(other, changeText(elsewhere)) }, deps);
  assert.deepEqual([mismatch.ok, mismatch.code], [false, "WALLET_MISMATCH"], "a change names the wallet that proved itself");

  const stale = change({ nonce: "s1t2a3l4e5s6t7a8l9e0", issuedAt: new Date(NOW - CHANGE_FRESH_MS - 60_000).toISOString() });
  const late = await changeContact({ proven, change: stale, signature: signText(wallet, changeText(stale)) }, deps);
  assert.deepEqual([late.ok, late.code], [false, "NONCE_INVALID"], "an old signature is refused");

  const removal = change({ action: "remove", name: null, to: null, note: null, nonce: "r1e2m3o4v5e6r7e8m9o0" });
  const removed = await changeContact({ proven, change: removal, signature: signText(wallet, changeText(removal)) }, deps);
  assert.equal(removed.ok, true);
  assert.equal(store.rows.size, 0);
});

test("the server: the store's refusals and its silence", async () => {
  const proven = wallet.publicKey.toBase58();
  const refusing = (refused) => ({ list: async () => [], change: async () => ({ ok: false, refused }) });
  for (const [refused, code] of [
    ["not_found", "NOT_FOUND"],
    ["full", "FULL"],
    ["taken", "TAKEN"],
  ]) {
    const c = change({ nonce: `n${refused}0000000000000000`.slice(0, 20).replace(/_/g, "x") });
    const result = await changeContact({ proven, change: c, signature: signText(wallet, changeText(c)) }, { store: refusing(refused), now: () => NOW });
    assert.deepEqual([result.ok, result.code], [false, code]);
  }
  const silent = contactsStore(async () => ({ ok: false, error: "temporarily unavailable" }));
  await assert.rejects(silent.list(proven), ContactsUnavailable);
  assert.deepEqual(await readContacts(proven, { store: silent }), { ok: false, code: "UNAVAILABLE" });
  const c = change();
  const result = await changeContact({ proven, change: c, signature: signText(wallet, changeText(c)) }, { store: silent, now: () => NOW });
  assert.deepEqual([result.ok, result.code], [false, "UNAVAILABLE"]);
});

test("the store's rows read back, and a row that is not a contact is dropped", async () => {
  const at = new Date(NOW).toISOString();
  const store = contactsStore(async (fn) => {
    assert.equal(fn, "contacts_list");
    return { ok: true, data: { ok: true, contacts: [{ id: ID, name: "Mom", to: friend, note: null, createdAt: at, updatedAt: at }, { id: "nope", name: "x", to: friend }] } };
  });
  const contacts = await store.list(wallet.publicKey.toBase58());
  assert.equal(contacts.length, 1);
  assert.deepEqual(contactOf({ id: ID, name: " Mom ", to: friend, createdAt: at }), { id: ID, name: "Mom", to: friend, note: null, createdAt: at, updatedAt: at });
  assert.ok(CONTACTS_MAX >= 100);
});

test("«Send» finds a contact by name or address; a look-alike of a kept address is caught", () => {
  const at = (n) => new Date(NOW + n).toISOString();
  const keep = Keypair.generate().publicKey.toBase58();
  const contacts = [
    { id: ID, name: "Mom", to: friend, note: null, createdAt: at(0), updatedAt: at(0) },
    { id: "2b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Landlord", to: keep, note: "rent", createdAt: at(1), updatedAt: at(1) },
    { id: "3b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Alice", to: "alice.skr", note: null, createdAt: at(2), updatedAt: at(2) },
  ];
  assert.deepEqual(
    suggestions(contacts, "").map((c) => c.name),
    ["Alice", "Landlord", "Mom"],
  );
  assert.deepEqual(
    suggestions(contacts, "lan").map((c) => c.name),
    ["Landlord"],
  );
  assert.deepEqual(
    suggestions(contacts, friend.slice(0, 6)).map((c) => c.name),
    ["Mom"],
  );
  assert.equal(contactFor(contacts, ` ${friend} `)?.name, "Mom");
  assert.equal(contactFor(contacts, "ALICE.skr")?.name, "Alice");
  // A look-alike: the same first and last four characters, another middle.
  let fake;
  for (;;) {
    const candidate = Keypair.generate().publicKey.toBase58();
    const body = candidate.slice(4, -4);
    fake = `${keep.slice(0, 4)}${body}${keep.slice(-4)}`;
    if (fake !== keep && targetOf(fake)) break;
  }
  assert.equal(lookalikeContact(contacts, fake)?.name, "Landlord");
  assert.equal(lookalikeContact(contacts, keep), null, "the kept address itself is no look-alike");
  assert.ok(new PublicKey(friend));
});
