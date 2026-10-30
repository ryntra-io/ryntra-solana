import { test } from "node:test";
import assert from "node:assert/strict";

import { flowLive, isMoneyTab, MONEY_FLOWS, MONEY_OPEN, MONEY_PATHS, MONEY_TABS, moneyOpen, tabLive } from "./flag.ts";
import { closeMoney, openMoney, useMoney } from "./open.ts";

test("the money switch opens only on the exact word «open»", () => {
  assert.equal(moneyOpen("open"), true);
  assert.equal(moneyOpen(" open\n"), true);
  for (const value of [undefined, "", "closed", "OPEN", "true", "1", "opened"]) assert.equal(moneyOpen(value), false, String(value));
});

test("Send moves money and waits for the switch — to Solana and, through the bridge's engine, to another network; the other tabs never do", () => {
  assert.deepEqual([...MONEY_TABS], ["topup", "send", "paylink", "activity", "portfolio"]);
  assert.deepEqual([...MONEY_PATHS], ["send"]);
  assert.equal(isMoneyTab("bridge"), false, "the bridge is Send's way now, not a tab");
  for (const tab of MONEY_TABS) {
    assert.equal(tabLive(tab, true), true, tab);
    assert.equal(tabLive(tab, false), !MONEY_PATHS.has(tab), tab);
  }
});

test("a deployment without the switch has Send closed, both its ways", () => {
  // The tests run without NEXT_PUBLIC_RYNTRA_CITY_MONEY, as production does until the owner opens it.
  assert.equal(process.env.NEXT_PUBLIC_RYNTRA_CITY_MONEY, undefined);
  assert.equal(MONEY_OPEN, false);
  assert.equal(tabLive("send"), false);
  assert.equal(flowLive("bridge"), false);
  assert.equal(tabLive("topup"), true);
  assert.equal(tabLive("portfolio"), true);
});

test("every path that moves money — Send, Bridge, a deposit from another network — waits for the same switch", () => {
  assert.deepEqual([...MONEY_FLOWS], ["send", "bridge", "deposit"]);
  for (const flow of MONEY_FLOWS) {
    assert.equal(flowLive(flow), false, `${flow} is closed by default`);
    assert.equal(flowLive(flow, false), false, flow);
    assert.equal(flowLive(flow, true), true, flow);
  }
  assert.equal(flowLive("withdraw", true), false, "a path that is not one of them never opens");
});

test("openMoney opens the window on the tab asked for, and only on a real tab", () => {
  useMoney.setState({ open: false, tab: "portfolio", busy: false });
  openMoney("send");
  assert.deepEqual([useMoney.getState().open, useMoney.getState().tab], [true, "send"]);
  openMoney("nowhere");
  assert.equal(useMoney.getState().tab, "send");
  openMoney();
  assert.equal(useMoney.getState().tab, "send");
  closeMoney();
  assert.equal(useMoney.getState().open, false);
  assert.equal(isMoneyTab("topup"), true);
  assert.equal(isMoneyTab("Top up"), false);
});

test("while money is mid-way the window neither closes nor leaves its tab", () => {
  useMoney.setState({ open: true, tab: "send", busy: true });
  closeMoney();
  openMoney("activity");
  useMoney.getState().setTab("portfolio");
  assert.deepEqual([useMoney.getState().open, useMoney.getState().tab], [true, "send"]);
  useMoney.getState().setBusy(false);
  closeMoney();
  assert.equal(useMoney.getState().open, false);
});
