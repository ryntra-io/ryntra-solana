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
