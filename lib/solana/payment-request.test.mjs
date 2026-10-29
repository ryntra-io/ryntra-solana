import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSolanaPayUrl, matchPayment } from "./payment-request.ts";

const WALLET = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const REFERENCE = "5YEAL2qTHvFCuTXzxY8wbQTBaQGRAD7pY4EymLACYvWt";

/* ---------------------------------------------------------------- *
 * The URL
 * ---------------------------------------------------------------- */

test("the plainest request is an address and nothing else", () => {
  const built = buildSolanaPayUrl({ recipient: WALLET });
  assert.equal(built.ok, true);
  assert.equal(built.url, `solana:${WALLET}`);
  assert.equal(built.amountRaw, null);
});

test("an amount is carried in display units and its base units come back", () => {
  const built = buildSolanaPayUrl({ recipient: WALLET, amount: "12.5", splToken: USDC, decimals: 6 });
  assert.equal(built.ok, true);
  /* Display units in the URL — the one place in this lane where that is true,
     and the spec's decision rather than ours. */
  assert.match(built.url, /amount=12\.5/);
  assert.match(built.url, new RegExp(`spl-token=${USDC}`));
  /* Base units come back for the matcher, so nothing downstream re-parses the
     person's typing. */
  assert.equal(built.amountRaw, "12500000");
});

test("a trailing zero is trimmed and nothing is ever rounded", () => {
  assert.match(buildSolanaPayUrl({ recipient: WALLET, amount: "1.50", decimals: 9 }).url, /amount=1\.5(&|$)/);
  assert.match(buildSolanaPayUrl({ recipient: WALLET, amount: "2.000", decimals: 9 }).url, /amount=2(&|$)/);

  /* More precision than the token can hold is refused rather than rounded.
     Rounding here would move money by an amount nobody typed. */
  const tooFine = buildSolanaPayUrl({ recipient: WALLET, amount: "0.1234567", splToken: USDC, decimals: 6 });
  assert.equal(tooFine.ok, false);
  assert.equal(tooFine.code, "AMOUNT_INVALID");
  assert.match(tooFine.reason, /rounding silently would change the amount/);
});

test("an amount without decimals is refused, because there is no way to spell it", () => {
  const built = buildSolanaPayUrl({ recipient: WALLET, amount: "5", splToken: USDC, decimals: null });
  assert.equal(built.ok, false);
  assert.equal(built.code, "AMOUNT_INVALID");
  assert.match(built.reason, /decimals are unknown/);
});

test("native SOL carries no spl-token, and a token carries exactly one", () => {
  assert.ok(!buildSolanaPayUrl({ recipient: WALLET, amount: "1", decimals: 9 }).url.includes("spl-token"));
  assert.match(buildSolanaPayUrl({ recipient: WALLET, splToken: USDC }).url, /spl-token=/);
});

test("label, message and memo are percent-encoded, and a space is never a plus", () => {
  const built = buildSolanaPayUrl({
    recipient: WALLET,
    label: "Ryntra Coffee",
    message: "Invoice #7 & change",
    memo: "table 4",
  });
  assert.equal(built.ok, true);
  /* `URLSearchParams` spells a space as `+`, which is right for a form body and
     wrong for a URI a wallet percent-decodes: the payer would see a literal
     plus in the merchant name. */
  assert.ok(!built.url.includes("+"));
  assert.match(built.url, /label=Ryntra%20Coffee/);
  assert.match(built.url, /message=Invoice%20%237%20%26%20change/);
  assert.match(built.url, /memo=table%204/);
});

test("everything that is not a Solana address is refused by name", () => {
  assert.equal(buildSolanaPayUrl({ recipient: "not-an-address" }).code, "RECIPIENT_INVALID");
  assert.equal(buildSolanaPayUrl({ recipient: WALLET, splToken: "nope" }).code, "MINT_INVALID");
  assert.equal(buildSolanaPayUrl({ recipient: WALLET, reference: "nope" }).code, "REFERENCE_INVALID");
  assert.equal(buildSolanaPayUrl({ recipient: WALLET, label: "x".repeat(65) }).code, "LABEL_TOO_LONG");
  assert.equal(buildSolanaPayUrl({ recipient: WALLET, message: "x".repeat(129) }).code, "MESSAGE_TOO_LONG");
  assert.equal(buildSolanaPayUrl({ recipient: WALLET, memo: "x".repeat(129) }).code, "MEMO_TOO_LONG");
});

test("the reference travels so one invoice can be told from another", () => {
  /* A wallet address cannot distinguish two invoices for the same amount, and
     matching on amount alone is how somebody else's payment gets credited to
     your request. */
  const built = buildSolanaPayUrl({ recipient: WALLET, amount: "3", decimals: 9, reference: REFERENCE });
  assert.match(built.url, new RegExp(`reference=${REFERENCE}`));
});

/* ---------------------------------------------------------------- *
 * Matching
 * ---------------------------------------------------------------- */

const payment = (overrides = {}) => ({
  signature: "4TX1LSCt597YZVzTKoAJG2Tvma1gxTP6di5hDVz8LkS9",
  creditedRaw: "12500000",
  mint: USDC,
  ...overrides,
});

const match = (overrides = {}) =>
  matchPayment({ expectedRaw: "12500000", expectedMint: USDC, observed: [], expired: false, ...overrides });

test("nothing seen is waiting, and nothing seen past the deadline is expired", () => {
  assert.equal(match().state, "AWAITING");
  assert.equal(match({ expired: true }).state, "EXPIRED");
});

test("the exact amount of the exact token is the only way to be paid", () => {
  assert.equal(match({ observed: [payment()] }).state, "PAID");
});

test("too little, too much and the wrong token are three different answers", () => {
  /* They are genuinely different to the person waiting: one is an incomplete
     payment, one is somebody owed a refund, one is money that arrived and
     cannot be counted. */
  assert.equal(match({ observed: [payment({ creditedRaw: "12000000" })] }).state, "UNDERPAID");
  assert.equal(match({ observed: [payment({ creditedRaw: "13000000" })] }).state, "OVERPAID");
  assert.equal(match({ observed: [payment({ mint: null })] }).state, "WRONG_TOKEN");
  /* And a SOL request paid in a token is equally wrong in the other direction. */
  assert.equal(
    matchPayment({ expectedRaw: "1000000000", expectedMint: null, observed: [payment({ mint: USDC })], expired: false }).state,
    "WRONG_TOKEN",
  );
});

test("a second payment is a second payment, never a confirmation of the first", () => {
  /* Folding it in is how a person is told they were paid once when they were
     paid twice. */
  const twice = match({ observed: [payment(), payment({ signature: "9f3kQ2mV7wXhL5tR8nB4cY6dE1aZ2sG3hJ4kM5nP6qR7" })] });
  assert.equal(twice.state, "OVERPAID");
  assert.match(twice.detail, /paid 2 times/);
});

test("money that already arrived is not un-received by the clock running out", () => {
  const late = match({ observed: [payment()], expired: true });
  assert.equal(late.state, "PAID");
});

test("an open request is satisfied by any amount of the right token", () => {
  const open = matchPayment({ expectedRaw: null, expectedMint: USDC, observed: [payment({ creditedRaw: "1" })], expired: false });
  assert.equal(open.state, "PAID");
});

/* ---- FIX-PAY-1 (SEC-1): a payment is a credit, and the requested mint's credits add up ---- */

const SIG_B = "9f3kQ2mV7wXhL5tR8nB4cY6dE1aZ2sG3hJ4kM5nP6qR7";
const SIG_C = "3xQ9mV7wXhL5tR8nB4cY6dE1aZ2sG3hJ4kM5nP6qR7aB";

test("attack: a transaction that carries the reference and credits nothing is no payment", () => {
  /* The reference is public; anyone can put it in a transaction that moves nothing for ~10 000 lamports. */
  const empty = payment({ creditedRaw: "0" });
  const open = matchPayment({ expectedRaw: null, expectedMint: USDC, observed: [empty], expired: false });
  assert.equal(open.state, "AWAITING", "an open request is not paid by an empty transaction");
  assert.equal(open.payment, null);
  assert.equal(
    matchPayment({ expectedRaw: null, expectedMint: null, observed: [payment({ creditedRaw: "0", mint: null })], expired: false }).state,
    "AWAITING",
    "nor an open SOL request",
  );
  /* Two empty transactions are not two payments: no OVERPAID, nothing for the page to call «Paid». */
  const twice = match({ observed: [empty, payment({ signature: SIG_B, creditedRaw: "0" })] });
  assert.equal(twice.state, "AWAITING");
  assert.equal(twice.receivedRaw, "0");
  /* Past the deadline the empty transactions still are nothing. */
  assert.equal(match({ observed: [empty], expired: true }).state, "EXPIRED");
  /* An empty transaction before a real payment changes nothing about it. */
  const real = match({ observed: [empty, payment({ signature: SIG_B })] });
  assert.equal(real.state, "PAID");
  assert.equal(real.payment?.signature, SIG_B);
  assert.equal(real.payments, 1);
});

test("an open request is paid by one positive payment, and a second real one is said as paid twice", () => {
  const once = matchPayment({ expectedRaw: null, expectedMint: USDC, observed: [payment({ creditedRaw: "0" }), payment({ signature: SIG_B, creditedRaw: "5" })], expired: false });
  assert.equal(once.state, "PAID");
  assert.equal(once.receivedRaw, "5");
  const twice = matchPayment({ expectedRaw: null, expectedMint: USDC, observed: [payment({ creditedRaw: "5" }), payment({ signature: SIG_B, creditedRaw: "7" })], expired: false });
  assert.equal(twice.state, "OVERPAID");
  assert.match(twice.detail, /paid 2 times/);
  assert.equal(twice.receivedRaw, "12");
});

test("the first transaction does not decide for ever: later payments in the requested mint add up", () => {
  const partial = match({ observed: [payment({ creditedRaw: "12000000" })] });
  assert.equal(partial.state, "UNDERPAID");
  assert.equal(partial.receivedRaw, "12000000");
  const topped = match({ observed: [payment({ creditedRaw: "12000000" }), payment({ signature: SIG_B, creditedRaw: "500000" })] });
  assert.equal(topped.state, "PAID");
  assert.equal(topped.receivedRaw, "12500000");
  assert.equal(topped.payment?.signature, SIG_B, "the payment that reached the amount settles it");
  const beyond = match({ observed: [payment({ creditedRaw: "12000000" }), payment({ signature: SIG_B, creditedRaw: "600000" })] });
  assert.equal(beyond.state, "OVERPAID");
  assert.equal(beyond.receivedRaw, "12600000");
});

test("another token first does not stop the requested one being counted after it", () => {
  /* One unit of any token used to make the request WRONG_TOKEN for good (SEC-1, P2). */
  const dust = payment({ creditedRaw: "1", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" });
  assert.equal(match({ observed: [dust] }).state, "WRONG_TOKEN");
  const paid = match({ observed: [dust, payment({ signature: SIG_B })] });
  assert.equal(paid.state, "PAID");
  assert.equal(paid.payment?.signature, SIG_B);
  const under = match({ observed: [dust, payment({ signature: SIG_B, creditedRaw: "1000000" })] });
  assert.equal(under.state, "UNDERPAID", "the requested mint's verdict, not the foreign token's");
});

test("a token's own transfer fee: underpaid by the fee, said so, and a top-up completes it", () => {
  /* 12.5 USDC sent; a 1 % Token-2022 fee kept 0.125 of it on the way. */
  const net = payment({ creditedRaw: "12375000", feeWithheldRaw: "125000" });
  const byFee = match({ observed: [net] });
  assert.equal(byFee.state, "UNDERPAID");
  assert.equal(byFee.feeWithheldRaw, "125000");
  assert.match(byFee.detail, /transfer fee/);
  /* Short by more than the fee is an ordinary underpayment, not «the fee». */
  const short = match({ observed: [payment({ creditedRaw: "10000000", feeWithheldRaw: "100000" })] });
  assert.equal(short.state, "UNDERPAID");
  assert.doesNotMatch(short.detail, /transfer fee/);
  /* What arrived counts, so a top-up of the shortfall settles it. */
  const topped = match({ observed: [net, payment({ signature: SIG_C, creditedRaw: "125000", feeWithheldRaw: "1250" })] });
  assert.equal(topped.state, "PAID");
  assert.equal(topped.receivedRaw, "12500000");
  assert.equal(topped.feeWithheldRaw, "126250");
  /* A fee mint paid gross enough is simply paid. */
  assert.equal(match({ observed: [payment({ creditedRaw: "12500000", feeWithheldRaw: "126263" })] }).state, "PAID");
});
