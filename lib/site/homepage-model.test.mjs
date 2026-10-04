import assert from "node:assert/strict";
import test from "node:test";
import { homepageModel } from "./homepage-model.ts";
import { productMapEntries } from "./product-map.ts";

test("homepage asset readiness retains the tokenized capability boundary", () => {
  const model = homepageModel("en");
  const rwa = productMapEntries("en").find(row => row.id === "rwa-markets");
  assert.equal(model.assets.length, 5);
  assert.equal(model.assets.find(row => row.id === "rwa").status, rwa.label);
  assert.equal(model.assets.find(row => row.id === "stocks").status, rwa.label);
  /* Spot is live; the homepage says what the registry says, and the registry
     says available. */
  assert.equal(model.trading.find(row => row.id === "spot").status, "AVAILABLE");
  assert.equal(model.trading.find(row => row.id === "perps").status, "PLANNED");
});

test("a non-live Swap never advertises supported trading categories", () => {
  const model = homepageModel("en", [{ id: "swap", href: "/app/swap", readiness: "building" }], []);
  for (const id of ["crypto", "memes", "stables"]) {
    assert.equal(model.assets.find(row => row.id === id).status, "BUILDING");
  }
  assert.equal(model.trading[0].status, "BUILDING");
});

test("missing or unknown sources fail closed in the public projection", () => {
  const absent = homepageModel("uk", [], []);
  assert.ok(absent.assets.every(row => row.status === "UNAVAILABLE"));
  assert.ok(absent.trading.every(row => row.status === "UNAVAILABLE"));
  const unknown = homepageModel("en", [{ id: "swap", href: "/app/swap", readiness: "invented" }], []);
  assert.equal(unknown.assets[0].status, "UNAVAILABLE");
});
