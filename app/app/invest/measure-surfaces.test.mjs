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
const SUM_FIELD = source("../stocks/[ticker]/sum-field.tsx");
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
  assert.match(SUM_FIELD, /onFocus=\{\(event\) => \{\s*choosing\.current = true;\s*chooseAll\(event\.currentTarget\);/);
  /* The press that focused the field places its caret after the focus: the choice is made again on that press's click, once. */
  assert.match(SUM_FIELD, /onClick=\{\(event\) => \{\s*if \(!choosing\.current\) return;\s*choosing\.current = false;\s*chooseAll\(event\.currentTarget\);/);
  assert.match(SUM_FIELD, /input\.setSelectionRange\(0, input\.value\.length\)/);
  assert.match(SUM_FIELD, /inputMode="decimal"/);
});

test("the keyboard's own action key is the sheet's one action, and only when that action runs now", () => {
  assert.match(SUM_FIELD, /enterKeyHint="go"/);
  assert.match(SUM_FIELD, /<form\s+className=\{company\.sumForm\}\s+noValidate\s+onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*onGo\(\);/);
  for (const [name, sheet] of [["buy", BUY_SHEET], ["sell", SELL_SHEET]]) {
    assert.match(sheet, /<SumField[\s\S]*?onGo=\{\(\) => \{\s*if \(!cta\.disabled\) cta\.run\?\.\(\);\s*\}\}/, `${name}: the key runs the one action, never a disabled one`);
    assert.doesNotMatch(sheet, /className=\{company\.amountInput\}/, `${name}: one sum field, the shared one`);
  }
  /* The form adds no box: the sheet's grid is unchanged. */
  assert.match(COMPANY_CSS, /\.sumForm \{\s*display: contents;\s*\}/);
});

test("on a desk the sum is ready as the sheet opens; on a phone the keyboard rises only on the person's tap", () => {
  assert.match(SUM_FIELD, /window\.matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)\.matches/);
  assert.match(SUM_FIELD, /if \(readied\.current \|\| disabled \|\| !input \|\| !typesWithoutRising\(\)\) return undefined;/);
  assert.match(SUM_FIELD, /if \(!input\.closest\("dialog"\)\?\.open \|\| input\.disabled\) return;/, "only inside the open sheet");
  assert.match(SUM_FIELD, /input\.focus\(\{ preventScroll: true \}\);\s*chooseAll\(input\);/);
  /* The sum's own focus line, never the shell's ring, on a field that opens chosen. */
  assert.match(COMPANY_CSS, /\.sheetBody \.amount \.amountInput:focus-visible \{\s*outline: none;\s*box-shadow: inset 0 -2px 0 var\(--ry-text\);/);
  /* It outweighs the shell's ring, seen drawn around the sum on the stand: `[tabindex]` inside `:is()` makes that rule three classes' weight, this one four. */
  assert.match(source("../product.css"), /\.ry-product :is\(input, select, textarea, button, a, \[role="button"\], \[tabindex\]\):focus-visible \{ outline: none; box-shadow: var\(--ry-focus\);/);
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
  assert.match(QUOTE_ROUTE, /askOnceMoreAfterRate\(\(\) =>\s*fetchJupiterOrder\(\{[^}]*\}, selection\),\s*\);/);
  /* A person's order waits for the window itself, up to its ten seconds: a $1 purchase on production was refused with the reset 4 s away (2026-09-28). */
  assert.match(ORDER_ROUTE, /askOnceMoreAfterRate\(\s*\(\) =>\s*fetchJupiterExecutableOrder\(/);
  assert.match(ORDER_ROUTE, /\{ maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS \},\s*\);/);
  /* Asked before the order is locked or stored: the Review is reserved only after the provider's answer. */
  /* The ask lives in the venue's own quote; the venue's step runs in the swap's prepare half before the transaction check and the Review's reservation. */
  const quoteMethod = VENUE.slice(VENUE.indexOf("async quote("), VENUE.indexOf("async build("));
  assert.match(quoteMethod, /askOnceMoreAfterRate\(/, "the venue's quote asks once more after the provider's pause");
  assert.match(stepBody(PREPARE, "venue-order"), /await venue\.quote\(intent\)/);
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
