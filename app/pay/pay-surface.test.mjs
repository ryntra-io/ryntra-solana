import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The payer page and its routes, pinned at the source level.
 *
 * What the owner task forbids on `/pay/:id` is not a matter of taste: no
 * internal request ids, no database identifiers, no provider internals, no
 * private owner or account data. The public projection is unit-tested; this
 * file pins that the surfaces only ever reach the public read, that creation
 * and listing stay behind proof of ownership, and that the two routes that
 * touch money refuse a cross-site call.
 */
const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("the payer page and its status route read only the public projection", () => {
  for (const path of ["app/pay/[id]/page.tsx", "app/pay/[id]/pay-client.tsx", "app/api/pay/[id]/route.ts"]) {
    const source = code(path);
    assert.doesNotMatch(source, /paymentRequestOwners|listPaymentRequestsByWallet|readPaymentSettlement|proofSessionId|accountId/, path);
    assert.doesNotMatch(source, /getWalletProof|getSession\(/, `${path} must not read a creator session`);
  }
  assert.match(code("app/api/pay/[id]/route.ts"), /loadPublicPaymentRequest/);
  assert.match(code("app/pay/[id]/page.tsx"), /loadPublicPaymentRequest/);
  assert.match(code("app/pay/[id]/page.tsx"), /robots: \{ index: false, follow: false \}/, "a payment link is never indexed");
});

test("creating and listing requests sit behind proof of wallet ownership and same-origin", () => {
  const source = code("app/api/pay/requests/route.ts");
  assert.match(source, /getWalletProof\(\)/);
  assert.match(source, /proof\.chain !== "solana"/);
  assert.match(source, /recipient: proof\.address/, "the recipient is the proven address, never a body field");
  assert.match(source, /mutationOriginAllowed\(/);
  assert.doesNotMatch(source, /recipient: parsed|recipient: input\./, "no client-chosen recipient");
});

test("the transaction and submit routes refuse cross-site calls, pay only as the phone's own wallet, and pin the intent", () => {
  /* Since contract 1.22.0 a browser still must come from this site, and the
     phone carries its bearer instead (the swap routes' rule): the carrier
     decides both, and a bearer never falls through to the origin check. */
  for (const path of ["app/api/pay/[id]/transaction/route.ts", "app/api/pay/[id]/submit/route.ts"]) {
    assert.match(code(path), /readSwapCarrier\(request, "This request did not come from the payment page\."\)/, path);
  }
  assert.match(code("lib/solana/swap-carrier.ts"), /mutationOriginAllowed\(request\.url, request\.origin, request\.secFetchSite\)/);
  assert.match(code("app/api/pay/[id]/transaction/route.ts"), /walletMismatch\(carrier, parsed\.data\.payer\)/, "a bearer pays only as its own wallet");
  assert.match(code("app/api/pay/[id]/submit/route.ts"), /intent\.payer !== carrier\.address/, "a bearer submits only what was built for its wallet");
  const submit = code("lib/pay/transaction.ts");
  assert.match(submit, /actual !== expectedMessageHash/, "the submit boundary compares the signed message hash to the pinned one");
  /* Phantom recompiles the message with a ComputeBudget pair and Lighthouse
     guards before signing; the founder's second wallet was refused as "a
     different transaction". A mismatch must go through the Send lane's shared
     comparison, which admits only those recognised additions. */
  assert.match(submit, /compareWalletTransaction\(\{[\s\S]*expectsTokenGuard: tolerance\.expectsTokenGuard/);
  assert.match(submit, /comparison\.verdict !== "EXACT" && comparison\.verdict !== "WALLET_GUARDS_ONLY"/);
  assert.match(submit, /verifySignatureOnly\(\{ signedWireBase64, expectedSigner: tolerance\.expectedSigner \}\)/);
  assert.match(submit, /intent\.requestId !== args\.requestId/, "an intent built for another request is refused");
  assert.match(submit, /sendTransactionOnce\(/);
  assert.doesNotMatch(submit, /signTransaction|privateKey|secretKey/, "the server never signs");
});

test("paid is derived from the reference observation and never from an amount alone", () => {
  const observe = code("lib/pay/observe.ts");
  assert.match(observe, /getSignaturesForAddress\(request\.reference/);
  assert.match(observe, /settlementFromMatch\(/);
  assert.doesNotMatch(observe, /getSignaturesForAddress\(request\.recipient/, "the recipient's history is not a settlement source");
  const model = code("lib/pay/model.ts");
  assert.match(model, /settlement\.state === "PAID" \|\| settlement\.state === "OVERPAID"/);
});

test("proof of ownership resolves the wallet through the registry that actually sees it", () => {
  /* With Phantom connected and its address in the top bar, sign-in answered
     "Phantom is no longer registered in this browser": the sign-in module
     looked only at the never-shipped `navigator.wallets.get()` draft and at a
     global nothing wrote to. It must consult the event-based registry first. */
  const signIn = code("lib/solana/wallet-signin.client.ts");
  assert.match(signIn, /import \{ registeredWallet, withWalletPromptTimeout \} from "\.\/wallet\.client"/);
  assert.match(signIn, /const fromRegistry = registeredWallet\(name\)/);
  assert.match(code("lib/solana/wallet.client.ts"), /export function registeredWallet\(name: string\)/);
});

test("the Receive card hands out the HTTPS link and keeps the protocol URI one disclosure deep", () => {
  const card = code("app/solana/workspace/receive/receive-card.tsx");
  assert.match(card, /fetch\("\/api\/pay\/requests"/);
  assert.match(card, /proof\.state\.status !== "proven"/, "creation waits for proof of ownership");
  assert.match(card, /advanced \?[\s\S]*Wallet link/, "the solana: URI is shown only under Details");
  assert.doesNotMatch(card, /createReference\(/, "the browser no longer invents the reference; the server does");
});
