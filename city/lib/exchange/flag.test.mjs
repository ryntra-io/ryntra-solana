import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { exchangeOpen } from "./flag.ts";

const source = (path) => readFileSync(new URL(`../../components/exchange/${path}`, import.meta.url), "utf8");

test("the Exchange opens only where the switch says `open`", () => {
  assert.equal(exchangeOpen("open"), true);
  assert.equal(exchangeOpen(" open\n"), true);
  for (const value of [undefined, "", "closed", "OPEN", "true", "1", "canary", "paper"]) assert.equal(exchangeOpen(value), false, String(value));
});

test("closed, the city shows no Exchange anywhere: no window, no dock button, no «Trade futures», and reads nothing", () => {
  // Every way into the Exchange asks the switch before anything of it renders or reads.
  for (const [file, gate] of [
    ["ExchangeLayer.tsx", "if (!EXCHANGE_OPEN) return null;"],
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
