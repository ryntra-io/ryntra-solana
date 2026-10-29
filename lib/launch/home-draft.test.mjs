import assert from "node:assert/strict";
import test from "node:test";

import { decodeHomeDraft, encodeHomeDraft, HOME_DRAFT_TTL_MS } from "./home-draft.ts";

/* A 1×1 PNG's head is enough: the draft checks the address's shape, the form checks the bytes again. */
const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PICTURE = { url: `data:image/png;base64,${BASE64}`, base64: BASE64, bytes: 68 };
const NOW = 1_800_000_000_000;

test("a draft written on the home page reads back whole in the form", () => {
  const raw = encodeHomeDraft({ name: "Kite", symbol: "KITE", picture: PICTURE }, NOW);
  assert.deepEqual(decodeHomeDraft(raw, NOW + 5_000), { name: "Kite", symbol: "KITE", picture: PICTURE });
});

test("an old draft, a draft from the future and an empty one are ignored", () => {
  const raw = encodeHomeDraft({ name: "Kite", symbol: "KITE", picture: null }, NOW);
  assert.equal(decodeHomeDraft(raw, NOW + HOME_DRAFT_TTL_MS + 1), null);
  assert.equal(decodeHomeDraft(raw, NOW - 120_000), null);
  assert.equal(decodeHomeDraft(encodeHomeDraft({ name: " ", symbol: "", picture: null }, NOW), NOW), null);
});

test("anything that is not the dock's draft reads as nothing", () => {
  for (const raw of [null, "", "not json", "[]", "{}", JSON.stringify({ v: 2, at: NOW, name: "Kite" })]) assert.equal(decodeHomeDraft(raw, NOW), null);
});

test("only a data: picture the form would make is carried — never another address, size or type", () => {
  const bad = [
    { ...PICTURE, url: "https://example.com/kite.png" },
    { ...PICTURE, url: `data:image/svg+xml;base64,${BASE64}` },
    { ...PICTURE, base64: "AAAA" },
    { ...PICTURE, bytes: 0 },
    { ...PICTURE, bytes: 256 * 1024 + 1 },
    { url: `data:image/jpeg;base64,${BASE64}`, base64: BASE64, bytes: 68 },
    { url: "data:image/png;base64,PHN2Zz4=", base64: "PHN2Zz4=", bytes: 5 },
  ];
  for (const picture of bad) {
    const draft = decodeHomeDraft(JSON.stringify({ v: 1, at: NOW, name: "Kite", symbol: "KITE", picture }), NOW);
    assert.deepEqual(draft, { name: "Kite", symbol: "KITE", picture: null });
  }
});

test("long fields are cut to the form's room for them, and the form's own rules then mark what is still too long", () => {
  const draft = decodeHomeDraft(JSON.stringify({ v: 1, at: NOW, name: "N".repeat(500), symbol: "S".repeat(500), picture: null }), NOW);
  assert.equal(draft?.name.length, 64);
  assert.equal(draft?.symbol.length, 20);
});
