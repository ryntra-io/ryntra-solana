import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { exchangeMode, exchangeOpen } from "./flag.ts";

const source = (path) => readFileSync(new URL(`../../components/exchange/${path}`, import.meta.url), "utf8");

test("the Exchange opens only where the switch says `open`", () => {
  assert.equal(exchangeOpen("open"), true);
  assert.equal(exchangeOpen(" open\n"), true);
  for (const value of [undefined, "", "closed", "OPEN", "true", "1", "canary", "paper"]) assert.equal(exchangeOpen(value), false, String(value));
});

test("`exit` closes out (decision 86): no trading, but the window stands for a wallet that holds something on Phoenix", () => {
  assert.equal(exchangeMode("exit"), "exit");
  assert.equal(exchangeMode(" exit\n"), "exit");
  assert.equal(exchangeMode("open"), "open");
  for (const value of [undefined, "", "closed", "EXIT", "exits", "true"]) assert.equal(exchangeMode(value), "closed", String(value));
  assert.equal(exchangeOpen("exit"), false);
  // The tower card's «Trade futures» and the dock stay on `open` alone; the window stands for `exit` too.
  assert.ok(source("FuturesAction.tsx").includes("if (!EXCHANGE_OPEN) return null;"));
  assert.ok(source("ExchangeLayer.tsx").includes("if (!EXCHANGE_SHOWN) return null;"));
  // Closing out puts nothing in: no deposit on the account, none built by the store, nothing opened from the ticket.
  assert.match(source("Account.tsx"), /\{!EXCHANGE_EXIT && \(\s*<button[^>]*'deposit'/);
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /EXCHANGE_EXIT && intent\.kind === 'open'\) return;/);
  assert.match(store, /EXCHANGE_EXIT && action === 'deposit'\)\) return;/);
  assert.match(store, /EXCHANGE_EXIT && form\.action === 'deposit'\)\) return;/);
});

test("closed, the city shows no Exchange anywhere: no window, no dock button, no «Trade futures», and reads nothing", () => {
  // Every way into the Exchange asks the switch before anything of it renders or reads.
  for (const [file, gate] of [
    ["ExchangeLayer.tsx", "if (!EXCHANGE_SHOWN) return null;"],
    ["ExchangeDockItem.tsx", "if (!EXCHANGE_OPEN) return null;"],
    ["FuturesAction.tsx", "if (!EXCHANGE_OPEN) return null;"],
  ]) {
    const text = source(file);
    assert.ok(text.includes(gate), `${file} does not ask the switch`);
    // The gate is the first line of the exported component: a closed switch runs no hook, reads no store, asks no route.
    const body = text.slice(text.indexOf("export function"));
    assert.equal(body.split("\n")[1].trim(), gate, `${file}: something runs before the switch`);
  }
  // FuturesAction reads Phoenix's markets only inside the open branch.
  const action = source("FuturesAction.tsx");
  assert.ok(action.indexOf("loadMarkets") > action.indexOf("function OpenFuturesAction"));
});

test("the money routes are the engine's own and nothing else: the city never builds, signs for or holds anything", () => {
  const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
  const paths = [...engine.matchAll(/\$\{BASE\}(\/[a-z/]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(paths)].sort(), ["/account", "/book", "/candles", "/collateral", "/collateral/review", "/collateral/status", "/collateral/submit", "/funding", "/history", "/markets", "/orders", "/orders/review", "/orders/status", "/orders/submit", "/ticket"]);
  assert.match(engine, /const BASE = '\/api\/solana\/futures';/);
});
