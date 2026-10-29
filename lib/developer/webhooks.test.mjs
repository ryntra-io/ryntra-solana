// Run from repo root: node --test lib/developer/webhooks.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { WEBHOOK_ID_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER, newDeliveryId, newWebhookSecret, signWebhook, verifyWebhook } from "./webhooks.ts";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const SECOND = Math.floor(NOW.getTime() / 1000);
const SECRET = "whsec_the-receiver-and-the-sender-share-this";
const BODY = JSON.stringify({ id: "x", event: "ping", data: {} });

/** A receiver's memory of the ids it has taken, as the real one is: ask once, record on the way. */
function memory() {
  const taken = new Set();
  return (id) => {
    if (taken.has(id)) return false;
    taken.add(id);
    return true;
  };
}

const signed = (over = {}) => {
  const id = over.id ?? newDeliveryId();
  const timestamp = over.timestamp ?? SECOND;
  const body = over.body ?? BODY;
  return { id, timestamp, body, headers: signWebhook({ id, timestamp, body, secrets: over.secrets ?? [SECRET] }) };
};

const verify = (delivery, over = {}) =>
  verifyWebhook({ body: delivery.body, headers: delivery.headers, secrets: [SECRET], now: NOW, windowSeconds: 300, seen: memory(), ...over });

test("a delivery this receiver's secret signed, inside the window, with an id it has not seen", async () => {
  const delivery = signed();
  const answer = await verify(delivery);
  assert.equal(answer.ok, true);
  assert.equal(answer.id, delivery.id);
  assert.equal(answer.timestamp, SECOND);
});

test("the same delivery twice is refused the second time", async () => {
  const delivery = signed();
  const seen = memory();
  assert.equal((await verify(delivery, { seen })).ok, true);
  const again = await verify(delivery, { seen });
  assert.equal(again.ok, false);
  assert.equal(again.refusal, "REPLAYED", "the bytes and the signature are unchanged and correct; that is the point");
});

test("a changed body, a changed id and a changed timestamp all break the signature", async () => {
  const delivery = signed();
  assert.equal((await verify({ ...delivery, body: `${BODY} ` })).refusal, "SIGNATURE_INVALID");
  assert.equal((await verify({ ...delivery, headers: { ...delivery.headers, [WEBHOOK_ID_HEADER]: newDeliveryId() } })).refusal, "SIGNATURE_INVALID");
  assert.equal((await verify({ ...delivery, headers: { ...delivery.headers, [WEBHOOK_TIMESTAMP_HEADER]: String(SECOND - 1) } })).refusal, "SIGNATURE_INVALID");
});

test("another secret's signature does not pass", async () => {
  const delivery = signed({ secrets: [newWebhookSecret()] });
  assert.equal((await verify(delivery)).refusal, "SIGNATURE_INVALID");
});

test("a delivery older or newer than the window is refused, signature and all", async () => {
  assert.equal((await verify(signed({ timestamp: SECOND - 301 }))).refusal, "TIMESTAMP_OUTSIDE_WINDOW");
  assert.equal((await verify(signed({ timestamp: SECOND + 301 }))).refusal, "TIMESTAMP_OUTSIDE_WINDOW");
  assert.equal((await verify(signed({ timestamp: SECOND - 299 }))).ok, true);
});

test("an id is never recorded for a delivery that failed the signature or the window", async () => {
  const taken = [];
  const seen = (id) => {
    taken.push(id);
    return true;
  };
  await verify({ ...signed(), body: "tampered" }, { seen });
  await verify(signed({ timestamp: SECOND - 1000 }), { seen });
  assert.deepEqual(taken, [], "a forged delivery cannot fill a receiver's replay store");
});

test("a missing or malformed header is MALFORMED rather than a crash", async () => {
  const delivery = signed();
  for (const header of [WEBHOOK_ID_HEADER, WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_SIGNATURE_HEADER]) {
    const headers = { ...delivery.headers };
    delete headers[header];
    assert.equal((await verify({ ...delivery, headers })).refusal, "MALFORMED", header);
  }
  assert.equal((await verify({ ...delivery, headers: { ...delivery.headers, [WEBHOOK_ID_HEADER]: "not-hex" } })).refusal, "MALFORMED");
  assert.equal((await verify({ ...delivery, headers: { ...delivery.headers, [WEBHOOK_TIMESTAMP_HEADER]: "soon" } })).refusal, "MALFORMED");
  assert.equal((await verify({ ...delivery, headers: { ...delivery.headers, [WEBHOOK_SIGNATURE_HEADER]: "v9,abc" } })).refusal, "MALFORMED");
});

test("a rotation signs with both, and a receiver holding either accepts", async () => {
  const older = SECRET;
  const newer = newWebhookSecret();
  const delivery = signed({ secrets: [newer, older] });
  assert.equal(delivery.headers[WEBHOOK_SIGNATURE_HEADER].split(" ").length, 2);
  assert.equal((await verify(delivery, { secrets: [older] })).ok, true);
  assert.equal((await verify(delivery, { secrets: [newer] })).ok, true);
  assert.equal((await verify(delivery, { secrets: [newWebhookSecret()] })).refusal, "SIGNATURE_INVALID");
});

test("the headers are read the same from a Headers object as from a plain record", async () => {
  const delivery = signed();
  const headers = new Headers(delivery.headers);
  assert.equal((await verify({ ...delivery, headers })).ok, true);
  const lowercased = Object.fromEntries(Object.entries(delivery.headers).map(([name, value]) => [name.toLowerCase(), value]));
  assert.equal((await verify({ ...delivery, headers: lowercased })).ok, true);
});
