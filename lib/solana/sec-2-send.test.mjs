import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { recentSendRecipients, isNewRecipient, rememberSendRecipient } from "./send-recipients.client.ts";
import { addressGroups, lookalikeOf } from "./skr-name.ts";

/**
 * SEC-2 — the two address checks of «Надіслати» in the web, and the one standing fact of its Review.
 *
 * The look-alike check landed with SKR-4 (22.10): the same four-plus-four edges the phone compares, against the
 * recent recipients and the wallet's own address, holding the action until «Адреса правильна». This adds the first
 * transfer to a new address, as the phone says it (`isNewRecipient`,
 * `apps/mobile/src/features/money/recipients.ts`), and asks for it separately: an address planted by poisoning is
 * both a look-alike of a recent one and new, and a person who answers «this is the one I meant» has not thereby said
 * «and I checked it with whoever gave it». One notice for both would collect one answer for two questions.
 */

const OWNER = "4Nd1mYkSHPfqH4LKM5VfMcWnUaVGdCVLeRM4VtDfLZCF";
const ALICE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BOB = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
/* ALICE's first and last four, another middle — the address a poisoned history plants. */
const POISON = `${ALICE.slice(0, 4)}${BOB.slice(4, -4)}${ALICE.slice(-4)}`;

const storage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
};

test("a new address, a known one, a look-alike and the wallet's own — each read for what it is", () => {
  const store = storage();
  rememberSendRecipient(store, OWNER, ALICE);
  const recents = recentSendRecipients(store, OWNER);
  assert.deepEqual(recents, [ALICE]);

  /* A new address: nothing was sent to it, and it imitates nothing. */
  assert.equal(isNewRecipient(recents, BOB), true);
  assert.equal(lookalikeOf([...recents, OWNER], BOB), null);

  /* A known one: neither notice. A second transfer to the same address says nothing. */
  assert.equal(isNewRecipient(recents, ALICE), false);
  assert.equal(lookalikeOf([...recents, OWNER], ALICE), null, "the same address is not its own look-alike");

  /* The wallet's own address — the look-alike list holds it too (SKR-4). */
  const ownPoison = `${OWNER.slice(0, 4)}${BOB.slice(4, -4)}${OWNER.slice(-4)}`;
  assert.equal(lookalikeOf([...recents, OWNER], ownPoison), OWNER);
  /* `recents` never holds the owner, so the card asks `isNewRecipient` only of addresses that are not it. */
  assert.equal(recentSendRecipients(store, OWNER).includes(OWNER), false);
});

test("a look-alike of a recent address is new as well — both notices, never one", () => {
  const store = storage();
  rememberSendRecipient(store, OWNER, ALICE);
  const recents = recentSendRecipients(store, OWNER);
  assert.equal(lookalikeOf([...recents, OWNER], POISON), ALICE, "the edges match a recent address");
  assert.equal(isNewRecipient(recents, POISON), true, "and nothing was ever sent to it");
  /* The two checks answer independently: neither reads the other's list or its answer. */
  assert.equal(isNewRecipient([...recents, POISON], POISON), false);
  assert.equal(lookalikeOf([...recents, POISON], POISON), ALICE, "a sent-to look-alike still looks like the other one");
});

test("the look-alike rule of SKR-4 is untouched: four and four, nothing shorter", () => {
  assert.equal(lookalikeOf([ALICE], `${ALICE.slice(0, 3)}${BOB.slice(3, -4)}${ALICE.slice(-4)}`), null, "three leading characters are not the rule");
  assert.equal(lookalikeOf([ALICE], `${ALICE.slice(0, 4)}${BOB.slice(4, -3)}${ALICE.slice(-3)}`), null, "nor three trailing ones");
  assert.equal(lookalikeOf([], POISON), null, "an empty list imitates nothing");
  assert.equal(lookalikeOf([ALICE], "1234"), null, "an input shorter than the two edges is no look-alike");
  assert.deepEqual(addressGroups("abcdefghij"), ["abcd", "efgh", "ij"], "Review prints every character, in fours");
});

const card = readFileSync(new URL("../../app/solana/workspace/send/send-card.tsx", import.meta.url), "utf8");

test("«Надіслати» draws the two checks apart and waits for both", () => {
  assert.match(card, /lookalikeOf\(knownAddresses, recipientAddress\)/, "SKR-4's look-alike check stays as it was");
  assert.match(
    card,
    /const newAddress = recipientAddress !== null && !sendingToSelf && recentsRead && isNewRecipient\(recents, recipientAddress\)/,
    "the new-address check reads the recipients this browser sent to, not the look-alike list with the owner in it",
  );
  assert.match(card, /setRecentsRead\(Boolean\(read\)\)/, "and says nothing until that list has been looked at");
  assert.match(card, /const newAddressHolds = newAddress && newAddressAccepted !== recipientAddress/, "accepted for that exact address only");

  /* Two blocks, each rendered on its own condition: with both true, both are drawn. */
  const lookalikeBlock = card.indexOf("{lookalike && recipientAddress ? (");
  const newBlock = card.indexOf("{newAddress && recipientAddress ? (");
  assert.ok(lookalikeBlock > 0 && newBlock > lookalikeBlock, "the look-alike notice first, the new-address notice after it");
  assert.match(card.slice(newBlock), /setNewAddressAccepted\(recipientAddress\)/, "its own confirmation, its own state");
  assert.match(card.slice(lookalikeBlock, newBlock), /setLookalikeAccepted\(recipientAddress\)/);
  assert.doesNotMatch(card.slice(lookalikeBlock, newBlock), /newAddressHolds/, "neither notice stands inside the other's branch");

  /* The action waits, and not only the label: a stale render must not be able to authorize the transfer. */
  assert.match(card, /if \(resumeBlocks \|\| lookalikeHolds \|\| newAddressHolds\) return;/);
  assert.match(card, /} else if \(newAddressHolds\) \{\n\s*ctaLabel = text\("Check the new address"\);/);
});

test("Review says who signs, in both languages", () => {
  const review = card.slice(card.indexOf('<section className={styles.exactReview}'));
  assert.match(review, /text\("Ryntra never sees your keys\."\)/, "the keys line reads inside the Review, where the signature is given");
  const uk = readFileSync(new URL("../../app/solana/workspace/i18n/catalog.ts", import.meta.url), "utf8");
  for (const key of [
    "Ryntra never sees your keys.",
    "Nothing was sent to this address yet. Match its first and last characters with whoever gave it.",
    "Address checked",
    "Check the new address",
  ])
    assert.ok(uk.includes(JSON.stringify(key)), `«${key}» has a Ukrainian pair`);
  assert.match(uk, /"Ryntra не бачить твоїх ключів\."/, "the phone's own words (`features/wallet/signing-copy.ts`)");
  assert.match(uk, /"На цю адресу переказів ще не було\. Звір перші й останні символи з тим, хто її дав\."/, "the phone's own words (`features/money/pay-copy.ts`)");
});
