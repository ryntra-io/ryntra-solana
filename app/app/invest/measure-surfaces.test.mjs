import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * «Замір 60 секунд»: from a company's page to the wallet's signature in at
 * most six taps and sixty seconds, one transaction — for a purchase and a
 * sale. What stood in the way on production (2026-09-28): a sum the sheet
 * opened on had to be erased key by key, a phone's keyboard covered the one
 * action, and the shared Jupiter window answered a quote or an order
 * «Забагато запитів». These pin the fixes;
 * `scripts/buy-flow-qa/measure-walk.mjs` counts the taps.
 */

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const KEYBOARD = source("../stocks/[ticker]/sheet-keyboard.ts");
const BUY_SHEET = source("../stocks/[ticker]/buy-sheet.tsx");
const SELL_SHEET = source("../stocks/[ticker]/sell-sheet.tsx");
const COMPANY_CSS = source("../stocks/[ticker]/company.module.css");
const QUOTE_ROUTE = source("../../api/solana/swap/quote/route.ts");
/* The order's and the execute's paths since the core pipeline, each read in the order it runs: the venue, the swap's steps and the shared safety chain, then the route. */
const ORDER_ROUTE = [
  "../../../lib/core/venues/jupiter.ts",
  "../../../lib/core/solana-swap/prepare.ts",
  "../../../lib/core/solana-swap/guard.ts",
  "../../api/solana/swap/order/route.ts",
].map(source).join("\n");
const VENUE = source("../../../lib/core/venues/jupiter.ts");
const PREPARE = source("../../../lib/core/solana-swap/prepare.ts");
const GUARD = source("../../../lib/core/solana-swap/guard.ts");
/** One pipeline step's own text: from its `name` to the next step's. */
const stepBody = (file, name) => {
  const start = file.indexOf(`name: "${name}"`);
  assert.ok(start > 0, `no step ${name}`);
  const next = file.indexOf('name: "', start + 1);
  return file.slice(start, next < 0 ? undefined : next);
};
const EXECUTE_ROUTE = [
  "../../../lib/core/solana-swap/guard.ts",
  "../../../lib/core/solana-swap/settle.ts",
  "../../api/solana/swap/execute/route.ts",
].map(source).join("\n");
const DEAL_BLOCK = source("../stocks/[ticker]/deal-block.tsx");

test("a press on the sum chooses all of it, so the next key replaces it — $1 is a tap and a key from $10", () => {
  /* SOL-T3: the sum is the core ticket's own field, and the core chooses it whole on the press that focuses it
     (`@ryntra/core/ui` 0.7.0, `TradeTicket`); the sheets draw no field of their own. */
  for (const [name, sheet] of [["buy", BUY_SHEET], ["sell", SELL_SHEET]]) {
    assert.match(sheet, /<TradeTicket\b/, `${name}: the ticket's field`);
    assert.doesNotMatch(sheet, /<SumField\b|<input\b/, `${name}: no sum field of its own`);
  }
});

test("the keyboard's own action key is the sheet's one action, and only when that action runs now", () => {
  for (const [name, sheet] of [["buy", BUY_SHEET], ["sell", SELL_SHEET]]) {
    /* The sum is the core's ticket's own field: Enter in it opens Review only when the ticket is ready (`TradeTicket`, `m.ready`). */
    assert.match(sheet, /<TradeTicket\b[\s\S]*?onReview=\{/, `${name}: the key runs the ticket's one action, never a disabled one`);
    assert.doesNotMatch(sheet, /className=\{company\.amountInput\}|<SumField\b/, `${name}: one sum field, the ticket's`);
  }
});

test("on a desk the sum is ready as the sheet opens; on a phone the keyboard rises only on the person's tap", () => {
  assert.match(KEYBOARD, /window\.matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)\.matches/);
  assert.match(KEYBOARD, /if \(!element\?\.open\) return;/, "only inside the open sheet");
  assert.match(KEYBOARD, /querySelector<HTMLInputElement>\('\[data-ticket-field="amount"\]'\)/, "the ticket's own sum");
  assert.match(KEYBOARD, /input\.focus\(\{ preventScroll: true \}\);\s*input\.select\(\);/);
  assert.match(BUY_SHEET, /useSumReadyOnDesk\(dialog, open\);/);
  assert.match(SELL_SHEET, /useSumReadyOnDesk\(dialog, open\);/);
});

test("both sheets stand above a phone's keyboard, their one action in sight", () => {
  assert.match(KEYBOARD, /window\.innerHeight - view\.height - view\.offsetTop/);
  assert.match(KEYBOARD, /element\.style\.setProperty\("--sheet-keyboard", `\$\{covered\}px`\)/);
  assert.match(KEYBOARD, /element\.style\.setProperty\("--sheet-visible", `\$\{Math\.round\(view\.height\)\}px`\)/);
  assert.match(KEYBOARD, /element\.style\.removeProperty\("--sheet-keyboard"\)/, "nothing is left on the sheet once it closes");
  assert.match(BUY_SHEET, /useSheetAboveKeyboard\(dialog, open\);/);
  assert.match(SELL_SHEET, /useSheetAboveKeyboard\(dialog, open\);/);
  assert.match(COMPANY_CSS, /\.sheet\[open\] \{[^}]*padding-bottom: var\(--sheet-keyboard, 0px\);/);
  assert.match(COMPANY_CSS, /max-height: min\(92dvh, calc\(var\(--sheet-visible, 100dvh\) - var\(--ry-s3\)\)\);/);
  /* Seen on Android with its number pad (2026-09-28): the purchase's sheet was 36 px taller than what stood above the keys — while a keyboard is up the spacing tightens, and a browser bar folding away is no keyboard. */
  assert.match(KEYBOARD, /element\.toggleAttribute\("data-keyboard", covered > KEYBOARD_MIN_PX\);/);
  assert.match(KEYBOARD, /const KEYBOARD_MIN_PX = 120;/);
  assert.match(KEYBOARD, /element\.removeAttribute\("data-keyboard"\);/);
  assert.match(COMPANY_CSS, /\.sheet\[data-keyboard\] \.sheetBody \{\s*gap: var\(--ry-s2\);\s*padding-bottom: var\(--ry-s3\);\s*\}/);
});

test("the swap's quote and its signable order are asked once more after the provider's own pause; /execute never", () => {
  /* A quote — a read — waits at most 2.5 s (the rule of 2026-09-15). */
  /* Since fee policy v2 the quote is the lane choice's — the web's and the phone's alike (line B's request 41) — whose every ask is asked once more the same way. */
  /* SOL-S1: asked beside the passports and awaited before the price is used. */
  assert.match(QUOTE_ROUTE, /const priced = chooseQuote\(\{/);
  assert.match(QUOTE_ROUTE, /const settled = await priced;/);
  const LANES = source("../../../lib/core/solana-swap/fee-route.server.ts");
  /* The v2 branch's own ask, not only the as-now one: the phone's quotes take it too. */
  assert.match(LANES, /const askOrder = \(\) => askOnceMoreAfterRate\(\(\) => fetchQuote\(\{ inputMint, outputMint, amountRaw, referral \}, selection\)\);/);
  assert.match(LANES, /askOnceMoreAfterRate\(\(\) => \(deps\.fetchBuild \?\? fetchJupiterBuild\)\(/);
  /* A person's order waits for the window itself, up to its ten seconds: a $1 purchase on production was refused with the reset 4 s away (2026-09-28). */
  assert.match(ORDER_ROUTE, /askOnceMoreAfterRate\(\s*\(\) =>\s*fetchJupiterExecutableOrder\(/);
  assert.match(ORDER_ROUTE, /\{ maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS \},\s*\);/);
  /* Asked before the order is locked or stored: the Review is reserved only after the provider's answer. */
  /* The ask lives in the venue's own quote; the venue's step runs in the swap's prepare half before the transaction check and the Review's reservation. */
  const quoteMethod = VENUE.slice(VENUE.indexOf("async quote("), VENUE.indexOf("async build("));
  assert.match(quoteMethod, /askOnceMoreAfterRate\(/, "the venue's quote asks once more after the provider's pause");
  /* Since 2026-10-11 through \`askVenueOrder\` (\`venue-order.ts\`), which also asks once more after the venue's own 4xx or 5xx. */
  /* SOL-S1: the ask is started beside the passports (`askVenue`) and awaited by the venue's own step. */
  assert.match(PREPARE.slice(PREPARE.indexOf("async function askVenue("), PREPARE.indexOf('name: "venue-order"')), /await askVenueOrder\(venue, intent\)/);
  assert.match(stepBody(PREPARE, "venue-order"), /await \(context\.venueAsk \?\?= askVenue\(context\)\)/);
  assert.match(source("../../../lib/core/solana-swap/venue-order.ts"), /await venue\.quote\(intent\)/);
  const steps = PREPARE.slice(PREPARE.indexOf("  steps: ["), PREPARE.indexOf("  ],", PREPARE.indexOf("  steps: [")));
  const venueAt = steps.indexOf("venueOrder,");
  assert.ok(venueAt > 0 && venueAt < steps.indexOf("transactionCheck,"), "the second ask comes before anything is built on the answer");
  assert.ok(venueAt < steps.indexOf("ownerLockReserve,"), "and before the wallet's Review is reserved");
  assert.match(stepBody(GUARD, "transaction-check"), /inspectJupiterSwapTransaction\(\{/);
  assert.match(stepBody(GUARD, "owner-lock-reserve"), /reserveSwapOwnerReview\(\{/);
  assert.doesNotMatch(EXECUTE_ROUTE, /askOnceMoreAfterRate/, "a signed transaction is sent once");
});

test("the comparison under a company's closed «Деталі» asks Jupiter nothing until it is opened", () => {
  /* It asked up to five quotes on every visit, of the key's shared window, before the person's own order (2026-09-28). */
  assert.match(DEAL_BLOCK, /const folded = cardRef\.current\?\.closest\("details"\) \?\? null;/);
  assert.match(DEAL_BLOCK, /folded\.addEventListener\("toggle", look\);/);
  assert.match(DEAL_BLOCK, /useEffect\(\(\) => \{\s*if \(!seen\) return undefined;\s*let live = true;[\s\S]*?fetch\(`\/api\/stocks\/compare/);
  assert.match(DEAL_BLOCK, /\}, \[mint, side, usd, locale, seen\]\);/);
});
