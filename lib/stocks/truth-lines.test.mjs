/**
 * The token under the company's name (UX-502) and a private company's rights
 * at the purchase (UX-500): three «SpaceX» pages of three issuers read three
 * different lines, each naming the symbol the wallet will show.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SALE_MAY_FAIL } from "./check.ts";
import { preIpoRightsChip, tokenLine } from "./truth.ts";

test("the head names the token and its issuer, and that it is not a share", () => {
  assert.equal(tokenLine("SPCXx", "xstocks", "en"), "SPCXx · token by xStocks · not a share");
  assert.equal(tokenLine("SPCX", "backpack", "en"), "SPCX · token by Backpack · not a share");
  assert.equal(tokenLine("SPCXon", "ondo", "uk"), "SPCXon · токен Ondo · не акція");
  assert.equal(tokenLine("SPACEX", "prestocks", "uk"), "SPACEX · токен PreStocks · не акція");
  const heads = ["xstocks", "backpack", "ondo"].map((issuer) => tokenLine("SPCX", issuer, "en"));
  assert.equal(new Set(heads).size, 3, "one company's three tokens never share a head");
});

test("a private company's purchase says a sale may fail, in the chip and in the sheet's own words", () => {
  assert.equal(preIpoRightsChip("en"), "Not a share · selling may fail");
  assert.equal(preIpoRightsChip("uk"), "Не акція · продати може не вийти");
  assert.match(SALE_MAY_FAIL.en, /^Selling may not be possible/);
  assert.match(SALE_MAY_FAIL.uk, /^Продати може не вийти/);
});
