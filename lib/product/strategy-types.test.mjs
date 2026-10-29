import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { STRATEGY_TYPES, STRATEGY_TYPE_IDS } from "./strategy-types.ts";

/**
 * The strategy-type catalog, as fixed on 2026-09-11.
 *
 * Seven types inside My strategies, in a fixed order; three of them live —
 * the trade plan, the recurring buy and, since B10, the grid on DLMM — and the
 * rest locked; none of them a page. A locked type is registered and drawn
 * nowhere, so a type cannot reach the rail by mistake and a planned one
 * cannot reach a screen.
 */

test("seven strategy types, in the fixed order, and nothing else", () => {
  assert.deepEqual(STRATEGY_TYPE_IDS, [
    "trading-plan", "dca", "grid", "free-capital", "rebalancing", "liquidity", "spend-invest",
  ]);
  assert.deepEqual(STRATEGY_TYPES.map((type) => type.id), STRATEGY_TYPE_IDS);
  assert.deepEqual(
    STRATEGY_TYPES.map((type) => type.name.en),
    ["Trade plan", "Recurring buy", "Grid", "Free Capital / Treasury", "Rebalancing", "Liquidity", "Spend & Invest"],
  );
});

test("the plan, the recurring buy and the grid are live; every other type is locked", () => {
  /* The plan since 2026-09-15, the recurring buy since 1.31.0, the grid on DLMM since B10. */
  const LIVE = ["trading-plan", "dca", "grid"];
  for (const type of STRATEGY_TYPES) {
    assert.ok(["available", "building", "planned"].includes(type.readiness), `${type.id} carries a readiness outside the three`);
    if (LIVE.includes(type.id)) {
      assert.equal(type.readiness, "available");
      assert.ok(type.runs && type.runs.en && type.runs.uk, `${type.id} says how it runs`);
      assert.match(type.setup ?? "", /^\/app\//, `${type.id} names where it is set up`);
    } else {
      assert.equal(type.readiness, "planned", `${type.id} must stay locked until its engine exists`);
      assert.equal(type.setup, undefined, `${type.id} is locked and leads nowhere`);
    }
  }
});

test("both languages are complete, and a blurb says what the type is rather than what it earns", () => {
  for (const type of STRATEGY_TYPES) {
    for (const locale of ["en", "uk"]) {
      assert.ok(type.name[locale].length > 0, `${type.id} has no ${locale} name`);
      assert.ok(type.blurb[locale].length > 0, `${type.id} has no ${locale} blurb`);
      assert.ok(type.blurb[locale].length <= 120, `${type.id} ${locale} blurb is a paragraph, not a line`);
    }
    /* Every name is translated. */
    assert.notEqual(type.name.uk, type.name.en, `${type.id} is untranslated`);
    for (const line of [type.blurb.en, type.runs?.en ?? ""]) assert.doesNotMatch(line, /profit|guarantee|yield|return/i, `${type.id} promises a result`);
  }
});

test("a locked type reaches no screen, and no type is a rail page", () => {
  /* Since 2026-09-23 only what is built is drawn. My strategies renders the
     person's own plans and no list of planned types — no «Other strategy types
     · planned», no «У планах», no count of six. */
  const source = readFileSync(new URL("../../app/app/strategies/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /StrategyCatalog|STRATEGY_TYPES\.(filter|map)|<details/, "My strategies draws the planned types");
  assert.equal(existsSync(new URL("../../app/app/strategies/strategy-catalog.tsx", import.meta.url)), false, "the planned-types catalog came back");
  const words = readFileSync(new URL("../../app/app/strategies/plans/plan-words.ts", import.meta.url), "utf8");
  assert.doesNotMatch(words, /"У планах"|· у планах|"Незабаром"|"Coming soon"|· planned/, "the plan words still carry a future label");
  /* No type is a rail page: the registry has no route for any of them. */
  const routes = readFileSync(new URL("../../app/shell/product-routes.ts", import.meta.url), "utf8");
  for (const id of STRATEGY_TYPE_IDS) {
    assert.doesNotMatch(routes, new RegExp(`id: "${id}"`), `${id} is a sidebar row`);
  }
});
