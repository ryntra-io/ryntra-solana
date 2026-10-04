import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * What a person is told before they sign a swap.
 *
 * Two rules, both found by reading the rendered surface rather than the tests,
 * and both about the same failure: a cost that is known and not shown.
 */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const CONTEXT = "app/solana/workspace/trade/swap-context.tsx";
const CARD = "app/solana/workspace/trade/swap-card.tsx";

test("the costs of the trade are shown in both depths, never only in Pro", () => {
  /*
   * It was `pro && facts.minReceivedRaw !== null`, so in Simple a person saw no
   * minimum received, no network fee, no account reserve and no executor — on
   * the screen where they decide whether to sign. Every one of them belongs
   * among what a swap shows, and a material fact is never hidden to reduce
   * noise. The repository's own depth rule says it from the other side: depth
   * is more data and more control, never fewer costs.
   */
  const source = code(CONTEXT);
  assert.doesNotMatch(source, /pro\s*&&/, "the cost disclosure is behind Pro again");
  assert.doesNotMatch(source, /resolveDepth/, "the disclosure reads a depth it must not branch on");

  /* The gate that stays is the honest one: before Review the order carries no
     taker, so these figures are genuinely unknown. */
  assert.match(source, /facts\.minReceivedRaw!==null\?<dl>/);

  for (const field of [
    "minReceivedRaw",
    "slippageBps",
    "networkFeeSol",
    "accountReserveSol",
    "platformFeeBasisPoints",
    "ryntraFee",
  ]) {
    assert.ok(source.includes(`facts.${field}`), `${field} is no longer disclosed`);
  }
});

test("Ryntra's own share is a line of its own, and it is read rather than asserted", () => {
  /* A swap has to show this line by name. It existed only as a zero inside a
     signed receipt, so the surface never printed it — and a product that never
     prints its own fee reads as one that would rather not be asked. */
  const context = code(CONTEXT);
  assert.match(context, /Комісія Ryntra|Ryntra service fee/);
  /* Jupiter's total includes referral; only its remainder is a second charge. */
  assert.match(context, /additionalJupiterFeeBps\(facts.platformFeeBasisPoints, facts.ryntraFee\)/);
  assert.doesNotMatch(context, /Комісія маршруту|Route fee/);

  const card = code(CARD);
  assert.match(card, /ryntraFee: priced \? ryntraServiceFee\(contextOrder\) : null/);
  assert.match(card, /function ryntraServiceFee\(order: object\): RyntraServiceFee \| null/);

  /* The figure stopped being a hard-coded zero. What replaces the old assertion
     is the property that made the zero safe in the first place — the number is
     whatever the provider's own answer says, and it is never claimed on an
     answer that does not carry the referral account. */
  const quotes = read("lib/solana/quotes.ts");
  assert.doesNotMatch(quotes, /ryntraFee: \{ basisPoints: 0/, "the fee is no longer hard-coded");
  assert.match(quotes, /ryntraFee: service\.fee/);
  assert.match(quotes, /providerReferralAccount !== requested\.account/, "an unechoed referral account cannot be earnings");
  assert.match(quotes, /serviceFeeNotApplied\(/);

  /* And the Review a person signs against prints it, beside the two figures they
     are actually deciding on rather than in a disclosure they may never open. */
  assert.match(card, /text\("Ryntra service fee"\)/);
  assert.match(card, /\{reviewServiceFeeText\}/);
  assert.match(read("app/solana/workspace/i18n/catalog.ts"), /"Ryntra service fee": "[^"]+"/);
});

test("a wallet with no SOL is told the fee is what is missing, before Review", () => {
  /*
   * Every Solana transaction is paid for in SOL, whatever it trades. Selling a
   * token with no lamports left failed correctly and *late*: the provider's
   * generic "This wallet does not hold enough for this swap." on a screen
   * showing a perfectly sufficient token balance. The person was told they were
   * short of the thing they had plenty of.
   */
  const card = code(CARD);
  assert.match(card, /const cannotPayNetworkFee =/);
  assert.match(card, /sellMint !== WRAPPED_SOL_MINT &&/, "selling SOL itself must not take this branch");
  assert.match(card, /BigInt\(nativeHolding\.spendableRaw\) === 0n/);
  assert.match(card, /ctaLabel = text\("Add SOL for the network fee"\)/);

  /* Ahead of the quote, so it is said before a Review can be asked for. */
  const branch = card.indexOf('cannotPayNetworkFee) {');
  const quoting = card.indexOf("quoting && !quote");
  assert.ok(branch > 0 && branch < quoting, "the shortfall must be named before the quote branches");

  /* And it renders in Ukrainian, or the uk page throws instead of saying it. */
  assert.match(read("app/solana/workspace/i18n/catalog.ts"), /"Add SOL for the network fee": "[^"]+"/);
});

test("selling SOL needs no such branch, because the reserve is already withheld", () => {
  /* `spendableRaw` withholds the fee reserve for native SOL, so the amount
     field cannot exceed what is signable and MAX stays the largest signable
     figure. The check above exists only for the other case. */
  const inventory = read("lib/solana/send-inventory.ts");
  assert.match(inventory, /NATIVE_SOL_FEE_RESERVE_LAMPORTS = 500_000n/);
  assert.match(inventory, /balance > NATIVE_SOL_FEE_RESERVE_LAMPORTS/);
  assert.match(code(CARD), /MAX passes the spendable figure through untouched|const spendable = BigInt\(sellHolding\.spendableRaw\)/);
});

test("every figure in the Review comes from the one order that will be signed", () => {
  /* The fee, the amount received, the minimum and the transaction must come
     from a single current calculation. The way to make that true is not to
     check it afterwards but to have one object — so the Review reads
     `prepared.order` and nothing else, and the network fee and the account
     reserve are derived from that same order's lamport fields. A figure sourced
     from the live quote instead would drift the moment the order was rebuilt,
     which is exactly what happens when a fee is dropped. */
  const card = code(CARD);
  const review = card.slice(card.indexOf("exactReviewGrid"), card.indexOf("reviewWarnings.length"));
  assert.match(review, /prepared\.order\.inAmountRaw/);
  assert.match(review, /prepared\.order\.minReceivedRaw/);
  assert.match(review, /prepared\.order\.rentFeeLamports/);
  assert.match(review, /reviewServiceFeeText/);
  /* And nothing in it reads the live quote, which is a different calculation. */
  assert.doesNotMatch(review.replace(/text\("[^"\n]*"\)/g, ""), /\bquote\.|contextOrder/, "the Review must not mix the live quote into the signed order");

  /* The two derived figures are derived from the same order. */
  assert.match(card, /const estimatedNetworkFeeSol = prepared\s*\?\s*\(\s*Number\(\s*BigInt\(prepared\.order\.signatureFeeLamports\)/);
  assert.match(card, /const accountReserveSol = prepared\s*\?\s*\(Number\(BigInt\(prepared\.order\.rentFeeLamports\)\)/);
  assert.match(card, /const reviewServiceFee = prepared \? ryntraServiceFee\(prepared\.order\) : null/);
});
