import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredSendAsset,
  rememberSendAsset,
} from "./send-asset-preference.client.ts";

const OWNER = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function store() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("the selected wallet asset survives a reload for that wallet", () => {
  const storage = store();
  rememberSendAsset(storage, OWNER, USDC);

  assert.equal(preferredSendAsset(storage, OWNER, ["native:sol", USDC]), USDC);
});
test("a stale or foreign asset preference never falls back silently to SOL", () => {
  const storage = store();
  rememberSendAsset(storage, OWNER, USDC);

  assert.equal(preferredSendAsset(storage, OWNER, ["native:sol"]), "");
  assert.equal(preferredSendAsset(storage, `${OWNER}x`, [USDC]), "");
});

test("blocked browser storage leaves the picker unselected instead of breaking Send", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.doesNotThrow(() => rememberSendAsset(blocked, OWNER, USDC));
  assert.equal(preferredSendAsset(blocked, OWNER, [USDC]), "");
});
