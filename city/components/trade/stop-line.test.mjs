import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SPOT } from "./words.ts";

// CITY-149 — the stop's one line on the ticket: with stops in the engine, «Стежимо, поки Ryntra відкрита» gives way to
// «Нагадаємо, коли ціна дійде, — продаж підписуєш ти», from the dictionary in both languages; shut, the old line stays.

test("the ticket's line says the engine reminds and the person signs, in both languages", () => {
  assert.equal(SPOT.uk.remindWhenThere(true), "Нагадаємо, коли ціна дійде, — продаж підписуєш ти");
  assert.equal(SPOT.uk.remindWhenThere(false), "Нагадаємо, коли ціна дійде, — купівлю підписуєш ти");
  assert.equal(SPOT.en.remindWhenThere(true), "We'll remind you when the price gets there — you sign the sale");
  assert.equal(SPOT.en.remindWhenThere(false), "We'll remind you when the price gets there — you sign the purchase");
  assert.equal(SPOT.uk.byRyntra, "Ryntra, навіть коли місто закрите");
});

test("the line follows the engine's switch: shut, the stop is still watched while Ryntra is open", () => {
  const ticket = readFileSync(new URL("./SpotTicket.tsx", import.meta.url), "utf8");
  assert.match(ticket, /STOPS_ENGINE \? w\.remindWhenThere\(side === 'sell'\) : w\.watchedWhileOpen/);
  assert.match(ticket, /STOPS_ENGINE \? w\.byRyntra : w\.onDevice/);
});
