import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PayLinkSchema } from "../../lib/api/v1/contract.ts";
import { MENU } from "../shell/menu.ts";
import { SHELVES, shelfAt } from "../shell/shelves.ts";
import {
  DEFAULT_EXPIRY,
  EXPIRIES,
  INVOICE_COINS,
  MONEY_PATH,
  createBody,
  firstTab,
  forwardOf,
  invoiceAmount,
  invoiceOf,
  listOf,
  moneyHref,
  stateKey,
  tabsShown,
  toneOf,
} from "./money-view.ts";
import { MONEY_WORDS } from "./words.ts";

/* «Money»: one page with «Send · Receive · Invoices», the Portfolio's old
   panels leading there, and payment links on the engine (`lib/pay/**`) as it is — the form sends the contract's fields
   and nothing else, the list reads the engine's answer and nothing more. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const [USDC_COIN, SOL_COIN] = INVOICE_COINS;
const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const OTHER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

test("the section's address and tabs: «Send» first where money may move, «Receive» first where it may not", () => {
  assert.equal(MONEY_PATH, "/money");
  assert.deepEqual(tabsShown(true), ["send", "receive", "invoices"]);
  assert.deepEqual(tabsShown(false), ["receive", "invoices"], "no «Send» without the money switch; an address and a link move nothing");
  assert.equal(firstTab(true), "send");
  assert.equal(firstTab(false), "receive");
  assert.equal(moneyHref("send"), "/money");
  assert.equal(moneyHref("receive"), "/money?tab=receive");
  assert.equal(moneyHref("invoices"), "/money?tab=invoices");
  assert.equal(moneyHref("receive", false), "/money", "the first tab is the section's address itself");
  assert.equal(shelfAt("/money", SHELVES), "portfolio", "«Money» stands in the Portfolio's shelf");
  const money = MENU.find((group) => group.id === "money");
  const ready = money.items.filter((item) => item.ready).map((item) => [item.id, item.href]);
  assert.deepEqual(ready, [
    ["send", "/money"],
    ["receive", "/money?tab=receive"],
    ["invoices", "/money?tab=invoices"],
  ]);
  assert.deepEqual(money.items.filter((item) => !item.ready).map((item) => item.id), ["private", "contacts", "autopay"], "no item without its screen");
});

test("the Portfolio's old panels lead on to the same tab of «Money»", () => {
  assert.equal(forwardOf("send", true), "/money");
  assert.equal(forwardOf("receive", true), "/money?tab=receive");
  assert.equal(forwardOf("send", false), "/money", "where nothing may be sent, the address to receive at");
  assert.equal(forwardOf("receive", false), "/money");
  for (const other of [null, undefined, "", "clean", "exit", "trade", "topUp"]) assert.equal(forwardOf(other, true), null, String(other));
  const portfolio = read("terminal/portfolio/PortfolioScreen.tsx");
  assert.doesNotMatch(portfolio, /kind: 'send'|kind: 'receive'/, "the Portfolio opens no transfer and no address of its own");
  assert.doesNotMatch(read("terminal/portfolio/Acts.tsx"), /SendPanel|ReceivePanel/);
  assert.match(portfolio, /QuietLink href=\{moneyHref\('send', sends\)\}/, "«Send» is a door to «Money»");
});

test("an amount is the engine's: a positive decimal with no more places than the coin has, never rounded", () => {
  assert.equal(invoiceAmount("25", USDC_COIN), "25");
  assert.equal(invoiceAmount("25.50", USDC_COIN), "25.5");
  assert.equal(invoiceAmount("0.000001", USDC_COIN), "0.000001");
  assert.equal(invoiceAmount("0.0000001", USDC_COIN), null, "seven places in a six-place coin");
  assert.equal(invoiceAmount("0.000000001", SOL_COIN), "0.000000001");
  assert.equal(invoiceAmount(".5", SOL_COIN), "0.5");
  assert.equal(invoiceAmount("007", SOL_COIN), "7");
  for (const bad of ["", ".", "0", "0.00", "1.2.3", "-1", "abc", "1e3"]) assert.equal(invoiceAmount(bad, USDC_COIN), null, bad);
});

test("the form sends the contract's fields and nothing else — never a recipient", () => {
  const body = createBody(USDC_COIN, "25", "  Design work  ", "24h");
  assert.deepEqual(body, { mint: USDC_COIN.mint, amount: "25", description: "Design work", expiration: "24h" });
  assert.deepEqual(createBody(SOL_COIN, "1", "   ", DEFAULT_EXPIRY), { mint: null, amount: "1", description: null, expiration: "7d" });
  assert.equal(createBody(SOL_COIN, "1", "x".repeat(200), "1h").description.length, 120);
  assert.deepEqual([...EXPIRIES], ["1h", "24h", "7d", "30d"], "the engine's own presets");
  assert.equal(USDC_COIN.mint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const hook = read("terminal/money/useInvoices.ts");
  assert.match(hook, /const outcome = await proven\(connection\);\n\s+if \(outcome !== 'ok'\)/, "the wallet proves it is the one connected before a link is made");
  assert.doesNotMatch(hook, /recipient/, "the recipient is the proven wallet, never a field");
});

const LINK = {
  id: "8Hq2rT4xWbN9kLmP3v",
  url: "https://ryntra.io/pay/8Hq2rT4xWbN9kLmP3v",
  payUrl: `solana:${OWNER}?amount=25&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&reference=${OTHER}`,
  status: "AWAITING",
  note: null,
  token: { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  amount: { raw: "25000000", display: "25" },
  description: "Design work",
  recipient: { abbreviated: "4EeX…KPGW", address: OWNER },
  reference: OTHER,
  createdAt: "2026-11-18T08:00:00.000Z",
  expiresAt: "2026-11-25T08:00:00.000Z",
  paid: null,
  received: null,
};
const SIG = "5".repeat(88);
const PAID = { ...LINK, id: "9Hq2rT4xWbN9kLmP3w", status: "PAID", paid: { signature: SIG, creditedRaw: "25000000", credited: "25", paidAt: "2026-11-18T09:00:00.000Z" }, received: { raw: "25000000", amount: "25", feeWithheldRaw: null, feeWithheld: null } };

test("the list reads the engine's own answer: links in the contract's shape, locked without a proof or for another wallet", () => {
  assert.ok(PayLinkSchema.safeParse(LINK).success && PayLinkSchema.safeParse(PAID).success, "the fixtures are the contract's");
  const ready = listOf(200, { address: OWNER, links: [LINK, PAID, { id: "x" }] }, OWNER);
  assert.equal(ready.state, "ready");
  assert.equal(ready.links.length, 2, "a link the screen cannot show is left out");
  assert.deepEqual(ready.links[0], {
    id: LINK.id,
    url: LINK.url,
    payUrl: LINK.payUrl,
    status: "AWAITING",
    note: null,
    symbol: "USDC",
    asked: "25",
    description: "Design work",
    createdAt: LINK.createdAt,
    expiresAt: LINK.expiresAt,
    received: null,
    paid: null,
  });
  assert.deepEqual(ready.links[1].paid, { signature: SIG, at: "2026-11-18T09:00:00.000Z" }, "the payment on Solana, where the payer stands");
  assert.equal(ready.links[1].received, "25");
  assert.deepEqual(listOf(401, { error: { code: "UNAUTHORIZED" } }, OWNER), { state: "locked" });
  assert.deepEqual(listOf(200, { address: OTHER, links: [LINK] }, OWNER), { state: "locked" }, "another wallet's proof never shows its links as this one's");
  assert.deepEqual(listOf(503, {}, OWNER), { state: "failed" });
  assert.deepEqual(listOf(200, null, OWNER), { state: "failed" });
  assert.equal(invoiceOf({ ...LINK, status: "MAYBE" }), null);
  assert.equal(invoiceOf({ ...LINK, amount: null }).asked, null, "the payer chooses");
});

test("a link's state: paid in mint, still to come in amber, a mismatch said before the bare state", () => {
  assert.equal(toneOf({ status: "PAID", note: null }), "ok");
  assert.equal(toneOf({ status: "PAID", note: "OVERPAID" }), "ok");
  assert.equal(toneOf({ status: "AWAITING", note: null }), "warn");
  assert.equal(toneOf({ status: "CHECKING", note: "UNDERPAID" }), "warn");
  assert.equal(toneOf({ status: "EXPIRED", note: null }), "plain");
  assert.equal(toneOf({ status: "UNKNOWN", note: null }), "plain");
  assert.equal(stateKey({ status: "CHECKING", note: "UNDERPAID" }), "UNDERPAID");
  assert.equal(stateKey({ status: "AWAITING", note: null }), "AWAITING");
  for (const lang of ["en", "uk"]) {
    for (const key of ["AWAITING", "PAID", "EXPIRED", "CHECKING", "UNKNOWN", "UNDERPAID", "OVERPAID", "WRONG_TOKEN"]) assert.equal(typeof MONEY_WORDS[lang][key], "string", `${lang}.${key}`);
  }
});

test("the screen is the one page: its name and tabs, one amber press a tab, recent transfers beside it", () => {
  const screen = read("terminal/money/MoneyScreen.tsx");
  assert.match(screen, /<PageHead title=\{w\.title\} tabs=\{<Tabs bare/);
  assert.match(screen, /<ActionBody side=\{<Transfers \/>\}/);
  assert.match(screen, /<SendPanel bare \/>/, "«Send» is the money logic's own transfer, as it stands");
  const receive = read("terminal/money/Receive.tsx");
  assert.equal((receive.match(/<Action\b/g) ?? []).length, 1, "one amber press: copy the address");
  // No wallet yet: every tab is the same blank — its sign, its name, one line — and one press that connects.
  assert.match(screen, /!owner \? \(\s*(?:\/\/[^\n]*\n\s*)?<NoWallet tab=\{tab\} onConnect=\{connect\} \/>/);
  const blank = read("terminal/money/NoWallet.tsx");
  assert.equal((blank.match(/<Action\b/g) ?? []).length, 1, "one amber press: connect a wallet");
  for (const lang of ["en", "uk"]) {
    for (const tab of ["send", "receive", "invoices"]) {
      for (const part of ["BlankTitle", "BlankLine"]) assert.ok(MONEY_WORDS[lang][`${tab}${part}`], `${lang}.${tab}${part}`);
    }
  }
  assert.doesNotMatch(read("terminal/money/Invoices.tsx") + receive, /signTransaction|sendTransaction/, "nothing here signs a transaction");
  assert.match(read("terminal/money/Transfers.tsx"), /filter\(\(row\) => row\.kind !== 'swap'\)/, "transfers only: swaps are the Swap's");
});
