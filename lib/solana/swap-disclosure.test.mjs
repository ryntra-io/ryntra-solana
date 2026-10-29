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

const CARD = "app/solana/workspace/trade/swap-card.tsx";

test("the costs of the trade are shown before the signature, in one count", () => {
  /*
   * It was once `pro && …`, so in Simple a person saw no minimum received, no
   * network fee, no account reserve and no executor — on the screen where
   * they decide whether to sign. Every one of them belongs among what a swap
   * shows, and a material fact is never hidden to reduce noise.
   *
   * SOL-C13 (UX-257, UX-263): the panel beside the card that repeated them is gone; the core's ticket says them — the
   * form's «Витрати» from the live quote, Review's lines and total from one count of the exact order (Jupiter, Ryntra,
   * the network), the account's reserve as its own row, the minimum as Review's own line.
   */
  const card = code(CARD);
  assert.doesNotMatch(card, /pro\s*&&/, "the cost disclosure is behind Pro again");
  assert.doesNotMatch(card, /resolveDepth/, "the disclosure reads a depth it must not branch on");
  assert.match(card, /const counted = costLines\(\{ \.\.\.figures\.fees, \.\.\.\(gas \? \{ gas \} : \{\}\) \}, paidAmount, "Jupiter"/, "the costs are no longer one count with the network's fee");
  assert.match(card, /const reviewCosts = ticketStage === "review" \? costsOf\(prepared\?\.order \?\? null\) : null/);
  assert.match(card, /const formCosts = [^\n]*costsOf\(quote\.order\)/, "the form's «Витрати» no longer count the live quote");
  assert.match(card, /label: text\("Account reserve, returned when the account closes"\), value: `\$\{accountReserveSol\} SOL`/, "the account's reserve is no longer said before the signature");
});

test("Ryntra's own share is a line of its own, and it is read rather than asserted", () => {
  /* A swap has to show this line by name. It existed only as a zero inside a
     signed receipt, so the surface never printed it — and a product that never
     prints its own fee reads as one that would rather not be asked. */
  /* SOL-C13: the ticket's own count names it — «Ryntra» beside Jupiter's own and the network's — read from the order's
     `ryntraFee`; Jupiter's total includes the referral, so only its remainder is a second charge. */
  const ticket = read("lib/ticket/solana-ticket.ts");
  assert.match(ticket, /const fee = order\.ryntraFee \?\? null/);
  assert.match(ticket, /additionalJupiterFeeBps\(order\.totalFeeBasisPoints, fee\)/);

  const card = code(CARD);
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
     are actually deciding on rather than in a disclosure they may never open:
     one of the core ticket's own cost lines, counted from the exact order. */
  assert.match(card, /costLines=\{reviewCosts \? reviewCosts\.lines : \[\]\}/);
  /* An estimate of it — a rate of the quote, not the order's stated amount — keeps its «≈» (UX-257). */
  assert.match(card, /const estimated = fee !== null && fee\.amountRaw === null;/);
  assert.match(card, /line\.label\.startsWith\("Ryntra"\) \? \{ \.\.\.line, value: `≈ \$\{line\.value\}` \}/);
  /* And the settled card names it once more, by name. */
  assert.match(card, /text\("Ryntra fee"\)/);
  assert.match(read("app/solana/workspace/i18n/catalog.ts"), /"Ryntra fee": "[^"]+"/);
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

  /* Ahead of the Review, so it is said before a Review can be asked for (since 2026-10-11 the Review waits for no estimate). */
  const branch = card.indexOf('cannotPayNetworkFee) {');
  const review = card.indexOf('ctaLabel = text("Review swap")');
  assert.ok(branch > 0 && branch < review, "the shortfall must be named before the Review is offered");

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
  /* SOL-T3: the ticket's «Max» is the wallet's spendable figure, and selling SOL keeps no second reserve. */
  assert.match(code(CARD), /\{ coin: sellCoin, raw: sellHolding \? sellHolding\.spendableRaw : balanceKnown \? "0" : null \}/);
  assert.match(code(CARD), /const ticketGas = solGas\(sellMint === WRAPPED_SOL_MINT \? 0n : 1n\)/);
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
  /* SOL-T3: the core ticket's Review is drawn from `agreedOrder` — the prepared order — and its cost lines from the same order. */
  const review = card.slice(card.indexOf("let ticketReviewed"), card.indexOf("const hostCta"));
  assert.match(review, /const agreedOrder = ticketStage === "review" \? \(prepared\?\.order \?\? null\) : null/);
  /* After the press the result reads what Review agreed to, kept with the order it stood on. */
  assert.match(review, /setAgreedSwap\(\{ reviewed: reviewedNow, order: prepared\.order \}\)/);
  assert.match(review, /ticketQuoteOf\(agreedOrder, /);
  assert.match(review, /prepared\.order\.rentFeeLamports/);
  assert.match(review, /costsOf\(prepared\?\.order \?\? null\)/);
  /* The amount paid, the minimum and the output inside that quote are the order's own fields. */
  assert.match(card, /figures = jupiterFigures\(order, \{ pay: sellCoin, get: buyCoin \}/);
  /* And nothing in it reads the live quote, which is a different calculation. */
  assert.doesNotMatch(review.replace(/text\("[^"\n]*"\)/g, ""), /\bquote\.|contextOrder/, "the Review must not mix the live quote into the signed order");

  /* The derived figures are derived from the same order: the network's fee is the order's own lamports (`jupiterFigures`). */
  assert.match(read("lib/ticket/solana-ticket.ts"), /lamports\(order\.signatureFeeLamports\) \+ lamports\(order\.priorityFeeLamports\)/);
  assert.match(card, /const accountReserveSol = prepared\s*\?\s*\(Number\(BigInt\(prepared\.order\.rentFeeLamports\)\)/);
  assert.match(card, /const reviewServiceFee = prepared \? ryntraServiceFee\(prepared\.order\) : null/);
});
