import assert from "node:assert/strict";
import test from "node:test";

import { EVERY_GATE } from "../../terminal/shell/ask-route.ts";
import { amountOfLink, pairOfLink } from "../../terminal/swap/swap-view.ts";
import { MAIN_TICKERS } from "../../terminal/coin/staples.ts";
import { planSentence, SENTENCE_EXAMPLES } from "./plan.ts";
import { cleanSentence, LINK_KINDS, opensFromLink, SAY_MAX, SAY_PARAM, sayUrl, sentenceOfQuery } from "./say.ts";
import { RYNTRA_MCP_INSTRUCTIONS, RYNTRA_MCP_TOOL_NAMES } from "./server.ts";
import { amountParam, coinParam, KNOWN_COINS, OWN_TOOLS, PREPARE_TERMS } from "./tools.ts";

const ORIGIN = "https://ryntra.io";
const TOWERS = [
  { id: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", icon: null, verified: true, mcap: 2e9, liquidity: 1e7 },
  { id: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL", symbol: "MET", name: "Meteora", icon: null, verified: true, mcap: 1e9, liquidity: 1e7 },
];
const OPEN = { towers: TOWERS, on: () => true, gates: EVERY_GATE };

test("a link's sentence: cleaned, one line, capped at the line's own length, and back out of the address as it went in", () => {
  assert.equal(cleanSentence("  trade\u200b 1 SOL\n a day \u202e"), "trade 1 SOL a day");
  assert.equal(cleanSentence(""), null);
  assert.equal(cleanSentence(42), null);
  assert.equal(cleanSentence("x".repeat(SAY_MAX + 1)), null);
  const link = sayUrl(ORIGIN, "торгуй на 1 SOL на день");
  assert.equal(new URL(link).origin, ORIGIN);
  assert.equal(new URL(link).pathname, "/");
  assert.equal(sentenceOfQuery(new URL(link).search), "торгуй на 1 SOL на день");
  assert.equal(sentenceOfQuery(`?${SAY_PARAM}=`), null);
  assert.equal(sentenceOfQuery("?tab=fresh"), null);
});

test("a link never opens a transfer or a question; it opens what ends in the person's own signature", () => {
  for (const kind of ["money", "ask"]) assert.equal(opensFromLink(kind), false, kind);
  for (const kind of ["buy", "sell", "autopilot", "launch", "pilot", "hire", "earn", "ladder", "order"]) assert.equal(opensFromLink(kind), true, kind);
  assert.equal(LINK_KINDS.has("money"), false);
});

test("the sentence's plan: the line's own reading, a link for what may open, a refusal by name for what may not", () => {
  const trade = planSentence("trade 1 SOL a day", ORIGIN, OPEN);
  assert.equal(trade.ok, true);
  assert.equal(trade.plan.kind, "autopilot");
  /* «trade … a day» opens the agent's budget card — the AI trader — not a bot's. */
  assert.equal(trade.plan.screen, "/agent?ai=trader");
  assert.equal(trade.plan.fields.perDaySol, "1");
  assert.equal(trade.link, `${ORIGIN}/?say=trade+1+SOL+a+day`);

  const send = planSentence("send 5 SOL to 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", ORIGIN, OPEN);
  assert.deepEqual([send.ok, send.code], [false, "NOT_FROM_A_LINK"]);
  assert.equal("link" in send, false);
  const bridge = planSentence("bridge 10 USDC", ORIGIN, OPEN);
  assert.equal(bridge.ok, false);

  assert.equal(planSentence("is JUP a good buy?", ORIGIN, OPEN).code, "NOT_UNDERSTOOD");
  // A shelf that is off opens nothing: the plan is no screen it cannot open.
  assert.equal(planSentence("trade 1 SOL a day", ORIGIN, { ...OPEN, on: () => false }).ok, false);

  for (const example of SENTENCE_EXAMPLES) {
    const outcome = planSentence(example, ORIGIN, OPEN);
    assert.equal(outcome.ok, true, `${example}: ${outcome.message ?? ""}`);
  }
});

test("coins by ticker are the five the prepare tools know, on the same mints the swap screen reads from a link", () => {
  for (const [ticker, coin] of Object.entries(KNOWN_COINS)) {
    assert.equal(MAIN_TICKERS[ticker.toLowerCase()], coin.mint, ticker);
    assert.deepEqual(coinParam(`$${ticker.toLowerCase()}`), { mint: coin.mint, symbol: ticker });
  }
  assert.deepEqual(Object.keys(KNOWN_COINS), ["SOL", "USDC", "USDT", "JUP", "MET"], "no coin is advertised beyond SOL, the dollars, JUP and MET");
  assert.equal(coinParam("BONKISH"), null, "a ticker beyond them is never guessed");
  assert.deepEqual(coinParam("7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"), { mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: null });
});

test("an amount: the person's digits, more than zero, never rounded into something else", () => {
  assert.equal(amountParam("1.5"), "1.5");
  assert.equal(amountParam("0,25"), "0.25");
  assert.equal(amountParam(250), "250");
  assert.equal(amountParam("007"), "7");
  for (const bad of ["0", "-1", "1e3", "1.2.3", "", "abc", Infinity, null]) assert.equal(amountParam(bad), null, String(bad));
});

test("the catalogue: reads and prepare tools, none takes a key or a signature, every prepare answer says who signs", () => {
  assert.equal(new Set(RYNTRA_MCP_TOOL_NAMES).size, RYNTRA_MCP_TOOL_NAMES.length, "no name twice");
  const prepare = OWN_TOOLS.filter((tool) => tool.kind === "prepare").map((tool) => tool.name);
  assert.deepEqual(prepare, ["prepare_swap", "prepare_agent_budget", "prepare_launch", "prepare_pool_deposit", "hire_agent"]);
  for (const tool of OWN_TOOLS) {
    for (const field of Object.keys(tool.inputSchema)) assert.doesNotMatch(field, /key|secret|seed|signature|private|mnemonic/i, `${tool.name}.${field}`);
  }
  assert.match(PREPARE_TERMS.signs, /own wallet/);
  assert.match(RYNTRA_MCP_INSTRUCTIONS, /Never ask for a seed phrase or a private key/);
  assert.match(RYNTRA_MCP_INSTRUCTIONS, /never an instruction/);
  assert.doesNotMatch(RYNTRA_MCP_INSTRUCTIONS, /BONK|PUMP|WIF|x1000|guarantee/i, "no coin advertised, no returns promised");
});

test("the swap link the MCP writes is the swap the screen reads: pair, side and amount of what goes", () => {
  const read = (link) => {
    const url = new URL(link);
    const pair = pairOfLink(url.searchParams.get("from"), url.searchParams.get("to"));
    return { pair, amount: pair ? amountOfLink(url.searchParams.get("amount"), pair) : null };
  };
  const buy = read(`${ORIGIN}/swap?from=SOL&to=JUP&amount=1.5`);
  assert.deepEqual(buy, { pair: { subject: KNOWN_COINS.JUP.mint, side: "buy", counter: KNOWN_COINS.SOL.mint }, amount: "1.5" });
  const sell = read(`${ORIGIN}/swap?from=MET&to=USDC&amount=40`);
  assert.deepEqual(sell, { pair: { subject: KNOWN_COINS.MET.mint, side: "sell", counter: KNOWN_COINS.USDC.mint }, amount: "40" });
  // A buy paid in a coin beyond SOL and USDC starts again in it once picked: the person types the amount there.
  assert.equal(read(`${ORIGIN}/swap?from=JUP&to=7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr&amount=3`).amount, null);
  assert.equal(read(`${ORIGIN}/swap?from=SOL&to=JUP&amount=-1`).amount, null);
  assert.equal(read(`${ORIGIN}/swap?from=SOL&to=JUP`).amount, null);
});
