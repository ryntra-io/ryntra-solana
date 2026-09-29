import assert from "node:assert/strict";
import test from "node:test";

import {
  eligibleForProductBroadcast,
  prefsFromRow,
  settingsBody,
  settingsButtons,
  togglePref,
} from "./notifications.ts";

test("missing preference rows stay eligible for product updates", () => {
  assert.equal(eligibleForProductBroadcast(null), true);
  assert.equal(eligibleForProductBroadcast({ product_updates: false }), false);
});

test("service/security notices cannot be turned off", () => {
  const off = togglePref(prefsFromRow({ service_security: true }), "service_security");
  assert.equal(off.service_security, true);
  assert.equal(prefsFromRow({ service_security: false }).service_security, true);
});

test("product updates can be opted out after an explicit save", () => {
  const next = togglePref(prefsFromRow({ product_updates: true }), "product_updates");
  assert.equal(next.product_updates, false);
  assert.equal(eligibleForProductBroadcast(next), false);
});

test("bot settings copy never offers a service_security off state", () => {
  const prefs = prefsFromRow(null);
  const body = settingsBody("uk", prefs);
  assert.match(body, /Сповіщення/);
  assert.doesNotMatch(body, /▫️ Сервіс/);
  const buttons = settingsButtons("en", prefs);
  assert.equal(buttons.at(-1)?.[0]?.callback_data, "np:service_security");
  assert.match(buttons.at(-1)?.[0]?.text ?? "", /🔒/);
});
