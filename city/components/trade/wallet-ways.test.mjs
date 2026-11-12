// Run from repo root: node --test city/components/trade/wallet-ways.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* CITY-237 (CITY-235's phone pass, ask 4): in a phone's own browser the agent's card offers «Open in Phantom» with
   «Back» beside it. The two did not fit a 390 px card: «Back» ended 19–43 px past its edge, cut, and pushed the card's
   lines wider than the card. The action now takes the card's width; «Back» is in the quiet line under it. */
test("«Open in Phantom» takes the card's width; «Back» stands in the quiet line under it", () => {
  const parts = read("./WalletParts.tsx");
  const none = parts.slice(parts.indexOf("if (!wallets.length) {"), parts.indexOf("  return (\n    <>\n      <div className={s.wallets}>"));
  assert.doesNotMatch(none, /className=\{s\.pair\}/u, "no row that sets the action and «Back» side by side");
  const action = none.indexOf("data-wallet-go");
  const ways = none.indexOf("className={s.walletWays}");
  const back = none.indexOf("data-wallet-back");
  assert.ok(action > 0 && ways > action && back > ways, "the action, then the quiet line with «Back» in it");
  assert.match(none, /<button className=\{s\.walletBack\} onClick=\{onBack\} data-wallet-back="">/u);

  const css = read("./trade.module.css");
  const rule = (name) => {
    const at = css.indexOf(`\n${name} {`);
    assert.ok(at >= 0, name);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".walletWays"), /justify-content: space-between;/u);
  assert.match(rule(".walletWays"), /min-width: 0;/u);
  assert.match(rule(".walletBack"), /min-height: 44px;/u, "a target under a finger");
  assert.match(rule(".walletBack"), /white-space: nowrap;/u);
});

/* CITY-237: a connected wallet with nothing to buy with read «Not enough SOL» on a dead button — the tower's one action
   led nowhere. It is the way to get some now: Money's top-up. */
test("an empty wallet's one action on a tower is «Add SOL», not a dead «Not enough SOL»", () => {
  const sheet = read("./TradeSheet.tsx");
  // A balance read as zero — `'0'`; an unread balance is `null` and stays the old words. The rule itself is one for the
  // market ticket, the limit and the stop since CITY-239 (`city/lib/trade/top-up.ts`, tested there).
  assert.match(sheet, /const empty = offersTopUp\(\{ connected: Boolean\(connection\), side, max: choice\.sizing\.max, moneyOpen: MONEY_OPEN \}\);/u);
  assert.match(read("../../lib/trade/top-up.ts"), /return input\.connected && input\.side === 'buy' && input\.max === '0' && input\.moneyOpen;/u);
  const add = sheet.indexOf("else if (empty) return (");
  const dead = sheet.indexOf("else if (choice.problem?.kind === 'balance')");
  assert.ok(add > 0 && dead > add, "asked before the balance problem turns the action off");
  // While it offers the top-up the balance is read again, so the SOL that arrived turns the action back into «Buy».
  assert.match(sheet, /useHoldingsWatch\(empty\);/u);
  const parts = read("./WalletParts.tsx");
  assert.match(parts, /export function useHoldingsWatch\(on: boolean\): void \{/u);
  assert.match(read("../crew/CardWallet.tsx"), /useHoldingsWatch\(short\);/u, "one watch for the agent's card too");
  assert.match(read("../pilot/PilotCard.tsx"), /useHoldingsWatch\(Boolean\(ask && split && walletShort\(split\.legs, PILOT_NET, holdings\)\)\);/u);
  assert.match(sheet.slice(add, dead), /onClick=\{\(\) => openMoney\('topup'\)\} data-trade-topup="">\s*\{w\.addOf\(choice\.spendUnit\)\}/u);
  const words = read("./words.ts");
  assert.match(words, /addOf: \(unit: string\) => `Add \$\{unit\}`,/u);
  assert.match(words, /addOf: \(unit: string\) => `Поповнити \$\{unit\}`,/u);
});
