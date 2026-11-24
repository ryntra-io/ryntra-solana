// Run from repo root: node --test terminal/money/contacts/contacts-view.test.mjs
//
// «Contacts» on screen: when the tab stands, how the list reads, the change a wallet signs, and what each
// refusal of the engine means.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair } from "@solana/web3.js";

import { changeRefusal, changeText } from "../../../lib/contacts/model.ts";
import { changeOf, contactsOpen, idFrom, listOf, nonceFrom, outcomeOf, sendTo, shortTo, toFromQuery } from "./contacts-view.ts";
import { autopayNetwork, autopayOpen } from "../autopay/open.ts";
import { moreTabs, tabsShown } from "../money-view.ts";

const owner = Keypair.generate().publicKey.toBase58();
const friend = Keypair.generate().publicKey.toBase58();
const ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const at = "2026-11-20T12:00:00.000Z";

test("the tabs stand only where the release opened their engines", () => {
  assert.equal(contactsOpen(undefined), false);
  assert.equal(contactsOpen(""), false);
  assert.equal(contactsOpen("1"), true);
  assert.equal(contactsOpen(" ON "), true);
  assert.equal(autopayNetwork(undefined), null);
  assert.equal(autopayNetwork("devnet"), "devnet");
  assert.equal(autopayNetwork("Mainnet"), "mainnet");
  assert.equal(autopayNetwork("yes"), null);
  assert.equal(autopayOpen("devnet"), true);
  assert.deepEqual(tabsShown(true), ["send", "receive", "invoices"], "closed — «Money» is as it was");
  assert.deepEqual(tabsShown(true, false, { contacts: true, autopay: true }), ["send", "receive", "invoices", "contacts", "autopay"]);
  assert.deepEqual(tabsShown(false, false, { contacts: true }), ["receive", "invoices", "contacts"]);
  assert.deepEqual(moreTabs({ contacts: true, autopay: true }), ["contacts", "autopay"]);
  assert.deepEqual(moreTabs({ autopay: true }), ["autopay"]);
  assert.deepEqual(moreTabs({}), []);
});

test("the list: the wallet's own book, locked behind its proof, never another wallet's", () => {
  const body = { address: owner, contacts: [{ id: ID, name: "Mom", to: friend, note: null, createdAt: at, updatedAt: at }, { id: "x" }] };
  const ready = listOf(200, body, owner);
  assert.equal(ready.state, "ready");
  assert.equal(ready.contacts.length, 1);
  assert.deepEqual(listOf(401, null, owner), { state: "locked" });
  assert.deepEqual(listOf(200, { ...body, address: friend }, owner), { state: "locked" }, "a proof of another wallet");
  assert.deepEqual(listOf(503, null, owner), { state: "failed" });
  assert.deepEqual(listOf(200, { address: owner }, owner), { state: "failed" });
});

test("a change: a fresh nonce, the browser's id, the fields as the book keeps them — the engine's own text", () => {
  const nonce = nonceFrom(Uint8Array.from({ length: 32 }, (_, i) => i * 7));
  assert.match(nonce, /^[A-Za-z0-9]{24}$/);
  assert.equal(idFrom(ID.toUpperCase()), ID);
  assert.equal(idFrom("nope"), null);
  const change = changeOf({ action: "add", wallet: owner, id: ID, fields: { name: "Mom", to: friend, note: null }, nonce, nowMs: Date.parse(at) });
  assert.equal(changeRefusal(change), null, "the engine takes what the screen builds");
  assert.match(changeText(change), /Change: add/);
  const removal = changeOf({ action: "remove", wallet: owner, id: ID, fields: { name: "Mom", to: friend, note: null }, nonce, nowMs: Date.parse(at) });
  assert.deepEqual([removal.name, removal.to, removal.note], [null, null, null], "a removal carries no fields");
  assert.equal(changeRefusal(removal), null);
});

test("the engine's refusals, in the screen's words", () => {
  assert.equal(outcomeOf(200, {}), "done");
  assert.equal(outcomeOf(401, {}), "locked");
  assert.equal(outcomeOf(400, { error: { code: "SIGNATURE_INVALID" } }), "signature");
  assert.equal(outcomeOf(400, { error: { code: "NONCE_INVALID" } }), "stale");
  assert.equal(outcomeOf(400, { error: { code: "VALIDATION_ERROR", issues: [{ path: "change.to" }] } }), "taken");
  assert.equal(outcomeOf(400, { error: { code: "VALIDATION_ERROR", issues: [{ path: "contacts" }] } }), "full");
  assert.equal(outcomeOf(400, { error: { code: "VALIDATION_ERROR", issues: [{ path: "change.id" }] } }), "missing");
  assert.equal(outcomeOf(503, null), "failed");
});

test("a row and «Send»: the address shortened, a name whole, «To» filled from the address only", () => {
  assert.equal(shortTo(friend), `${friend.slice(0, 4)}…${friend.slice(-4)}`);
  assert.equal(shortTo("alice.skr"), "alice.skr");
  assert.equal(sendTo({ to: friend }), `/money?to=${friend}`);
  assert.equal(toFromQuery(friend), friend);
  assert.equal(toFromQuery("alice.skr"), "alice.skr");
  assert.equal(toFromQuery("javascript:alert(1)"), null);
  assert.equal(toFromQuery(null), null);
});
