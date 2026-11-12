// Run from repo root: node --test lib/ticket/review-before-sign.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BASE_FEE_LAMPORTS, CLASSIC_MINTS, TOKEN_ACCOUNT_RENT_LAMPORTS, reviewNetworkFrom, reviewSol, reviewWord } from "./review-words.ts";
import { cancelReturns } from "../../app/solana/workspace/spot/limit-cancel-review.ts";

/**
 * SOL-C14 (audit UX 21.10, theme T5): no wallet signature without the core's Review — on `/pay` (a payment link and the
 * assistant's credits, which are paid there), in a limit's cancellation and in a pool position's permission. Only the
 * showing changed: the Review comes first, and the bytes are built after «Підписати в гаманці» (their blockhash last, as
 * in SOL-S1). This file keeps both halves: every flow opens the core's Review before anything is built, and the money
 * path — what is built, from which request, for which amounts and recipients — is the one it was before.
 */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/* CITY-156: the payer page is a window of the city — its screen and its flow. */
const PAY = code("city/components/pay/PayerPage.tsx");
const FLOW = code("city/lib/pay/flow.ts");
const ORDERS = code("app/solana/workspace/spot/my-orders.tsx");
const LIMIT_API = code("app/solana/workspace/spot/limit-api.ts");
const POOL = code("app/app/launch/[mint]/pool-panel.tsx");

/** One function's text, from its signature to the closing brace at the signature's own indent. */
function fn(path, signature) {
  const source = read(path);
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} is in ${path}`);
  const indent = source.slice(source.lastIndexOf("\n", start) + 1, start).match(/^\s*/)[0];
  const end = source.indexOf(`\n${indent}}\n`, start);
  assert.ok(end > start, `${signature} closes in ${path}`);
  return source.slice(start, end + indent.length + 2);
}
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

test("the shared words of a Review: one dictionary in both languages, every digit of SOL kept", () => {
  assert.equal(reviewSol(BASE_FEE_LAMPORTS, "en"), "0.000005 SOL");
  assert.equal(reviewSol(BASE_FEE_LAMPORTS, "uk"), "0,000005 SOL");
  assert.equal(reviewSol(TOKEN_ACCOUNT_RENT_LAMPORTS, "en"), "0.00203928 SOL");
  assert.equal(reviewSol(BASE_FEE_LAMPORTS + TOKEN_ACCOUNT_RENT_LAMPORTS, "uk"), "0,00204428 SOL");
  assert.equal(reviewSol(1_234_000_000_000n, "en"), "1,234 SOL");
  assert.equal(reviewNetworkFrom("en"), "from 0.000005 SOL");
  assert.equal(reviewNetworkFrom("uk"), "від 0,000005 SOL");
  assert.equal(reviewWord("uk", "network"), "Комісія мережі");
  assert.equal(reviewWord("en", "upTo", { x: "1 SOL" }), "up to 1 SOL");
  /* The network's floor is the protocol's: 5,000 lamports a signature; a classic token account's rent, 165 bytes. */
  assert.equal(BASE_FEE_LAMPORTS, 5_000n);
  assert.equal(TOKEN_ACCOUNT_RENT_LAMPORTS, 2_039_280n);
  const source = read("lib/ticket/review-words.ts");
  const keys = (lang) => [...source.slice(source.indexOf(`  ${lang}: {`)).split("\n  },")[0].matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]);
  assert.deepEqual(keys("uk"), keys("en"), "every line has both languages");
});

test("a cancellation's Review says what the venue gives back: Jupiter the unfilled part, DLMM also what converted", () => {
  const base = { inputMint: "IN", outputMint: "OUT", makingRaw: "1000", filledInputRaw: "400", filledOutputRaw: "60" };
  assert.deepEqual(cancelReturns({ ...base, venue: "trigger" }), [{ mint: "IN", raw: "600" }], "Jupiter paid the fills out as they came");
  assert.deepEqual(cancelReturns({ ...base, venue: "dlmm" }), [{ mint: "IN", raw: "600" }, { mint: "OUT", raw: "60" }], "DLMM holds what converted until it closes");
  assert.deepEqual(cancelReturns({ ...base, venue: "dlmm", filledInputRaw: "1000", filledOutputRaw: "150" }), [{ mint: "OUT", raw: "150" }], "a converted order brings back only its output");
  assert.deepEqual(cancelReturns({ ...base, venue: "trigger", filledInputRaw: "0", filledOutputRaw: "0" }), [{ mint: "IN", raw: "1000" }]);
});

test("/pay (CITY-156): the city's window says every cost before the wallet; only its one press builds the payment", () => {
  /* Since CITY-156 the page is a window of Ryntra City, not the core's Review: the window itself is the Review — the
     sum, to whom, and one line of costs with the breakdown behind «i» — all on screen before the one amber action. */
  assert.doesNotMatch(PAY, /@ryntra\/core/, "nothing of the core's shell on the city's page");
  const terms = PAY.indexOf("<Terms");
  assert.ok(terms > 0 && terms < PAY.indexOf("data-pay-action"), "the costs stand above the action that opens the wallet");
  const block = PAY.slice(terms, PAY.indexOf("</Terms>"));
  for (const word of ["w.youPay", "w.fee", "w.ryntraFee", "w.toAddress"]) assert.match(block, new RegExp(word.replace(".", "\\.")), word);
  assert.match(block, /costs\.opensAccount \? \([\s\S]*?w\.theirAccount/, "a coin payment may open the recipient's account — said before the wallet");
  /* Nothing is built yet, so no cost is a closed range: the wallet's priority fee and a Token-2022 account come on top.
     Only USDC and USDT are known classic coins — for any other the rent is a floor and the coin's own fee a line. */
  assert.match(block, /costs\.classic \? w\.upTo\(costs\.accountSol\) : w\.feeFrom\(costs\.accountSol\)/);
  assert.match(block, /costs\.opensAccount && !costs\.classic \? \([\s\S]*?w\.coinFee/);
  assert.match(FLOW, /networkSol: sol\(BASE_FEE_LAMPORTS\)/);
  assert.match(FLOW, /classic: opensAccount && CLASSIC_MINTS\.has\(token\.mint as string\)/);
  assert.match(FLOW, /accountSol: sol\(TOKEN_ACCOUNT_RENT_LAMPORTS\)/);
  assert.deepEqual([...CLASSIC_MINTS].sort(), ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
  /* One payment from one place: the press (or the wallet chosen after it), one at a time; the typed amount is locked while it runs. */
  assert.equal(PAY.match(/\bpayRequest\(/g)?.length, 1, "the payment starts from one function");
  assert.match(PAY, /if \(connection\) return void once\(\(\) => payFrom\(connection\)\);/);
  assert.match(PAY, /if \(ok && now\) await payFrom\(now\);/);
  assert.match(PAY, /if \(inFlight\.current\) return;\s*inFlight\.current = true;/, "a second tap while the wallet is asked does nothing");
  assert.match(PAY, /onChange=\{\(event\) => setTyped\(event\.target\.value\)\}\s*disabled=\{busy\}/);
});

test("/pay: the same request is built and sent — payer, amount, intent — as before the Review", () => {
  assert.match(FLOW, /body: JSON\.stringify\(\{ payer: args\.payer, amount: args\.amount \}\)/);
  assert.match(PAY, /\{ id: request\.id, payer: wallet\.address, amount: request\.amount \? null : amount\.text \}/);
  assert.match(FLOW, /body: JSON\.stringify\(\{ intentId: fresh\.built\.intentId, signedWireBase64: fresh\.signed \}\)/);
  assert.match(FLOW, /signFreshBytes<Built, string, Refused>\(\{\s*build: async \(\) => \{\s*deps\.onPhase\?\.\('preparing'\);\s*try \{\s*const prepared = await deps\.fetch\(`\$\{route\}\/transaction`/, "the bytes are built inside the press, never ahead of it");
  assert.match(FLOW, /const route = `\/api\/pay\/\$\{encodeURIComponent\(args\.id\)\}`;/);
  /* The credits of the assistant are paid on this page, through this window: the fold hands over the page's link only. */
  const credits = code("app/app/ryn/credits-buy.tsx");
  assert.match(credits, /href=\{current\.payPage\}/);
  assert.doesNotMatch(credits, /signTransaction|signFreshBytes/, "the credits fold never asks a wallet itself");
});

test("«Мої ордери»: «Скасувати» and «Забрати» open the core's Review; only its action builds the cancellation", () => {
  assert.match(ORDERS, /import \{ Button, Review, Table, type TableColumn \} from "@ryntra\/core\/ui";/);
  assert.match(ORDERS, /onClick=\{\(\) => \{\s*setNotice\(null\);\s*setReviewing\(order\);\s*\}\}/, "the order's button opens its Review");
  assert.match(ORDERS, /onConfirm=\{\(\) => void act\(shown\)\}/);
  assert.equal(ORDERS.match(/\bact\(/g)?.length, 2, "act is defined once and called from the Review alone");
  for (const prop of ["title=", "pay=", "get=", "costs=", "costsTotal=", "whatItIs=", "signer=", "details="]) assert.match(ORDERS.slice(ORDERS.indexOf("<Review")), new RegExp(prop), prop);
  assert.match(ORDERS, /cancelReturns\(shown\)/, "what comes back is the venue's rule, not a guess");
  /* An order that closed or left the list while its Review stood is not offered for a signature. */
  assert.match(ORDERS, /ready=\{stillOpen \|\| acting === shown\.key\}/);
  assert.match(ORDERS, /onClose=\{\(\) => \{\s*if \(acting === null\) setReviewing\(null\);\s*\}\}/, "the sheet closed any way closes the Review");
  assert.match(ORDERS, /reviewWord\(lang, "network"\)/);
});

test("«Мої ордери»: the same cancellation — owner, venue, order — is built and relayed as before the Review", () => {
  assert.match(LIMIT_API, /post<CancelBuild>\("\/api\/solana\/limits\/cancel", \{ owner: wallet\.address, venue: order\.venue, order: order\.order \}\)/);
  assert.match(LIMIT_API, /kind: "cancel",\s*venue: order\.venue,\s*owner: wallet\.address,\s*order: order\.order,\s*requestId: built\.value\.requestId,\s*signedTransactionBase64: signed\.signedWireBase64,\s*terms: null,/);
  assert.match(ORDERS, /signAndCancel\(\{ wallet: connection\.wallet, address: connection\.address \}, order\)/);
});

test("a pool position's permission: «Увімкнути» and «Відкликати» open the core's Review; only its action builds it", () => {
  assert.match(POOL, /import \{ Block, Button, Review \} from "@ryntra\/core\/ui";/);
  assert.doesNotMatch(POOL, /act\("grant"\)|act\("revoke"\)/, "no button builds and asks the wallet in one press");
  assert.match(POOL, /onClick=\{\(\) => setReview\("revoke"\)\}[\s\S]*onClick=\{\(\) => setReview\("revoke"\)\}[\s\S]*onClick=\{\(\) => setReview\("grant"\)\}/, "both revokes and the grant open the Review");
  assert.match(POOL, /onConfirm=\{\(\) => void act\(review\)\}/);
  const panel = POOL.slice(POOL.indexOf("const permissionReview"));
  for (const prop of ["title=", "pay=", "get=", "costs=", "costsTotal=", "whatItIs=", "details="]) assert.match(panel.slice(0, panel.indexOf("/>\n  ) : null;")), new RegExp(prop), prop);
  assert.match(POOL, /reviewWord\(lang, "network"\)/);
  /* The same permission as before: the wallet, the position, the action — then the same submit. */
  assert.match(POOL, /holder\/permission\/build`, \{ method: "POST", body: JSON\.stringify\(\{ wallet: connection\.address, position: position\.position, action \}\) \}\)/);
  assert.match(POOL, /holder\/permission\/submit`, \{ method: "POST", body: JSON\.stringify\(\{ buildId: built\.data\.buildId, wallet: connection\.address, signedWireBase64: signed\.signedWireBase64\[0\] \}\) \}\)/);
});

test("the creator's «Забрати» got its own Review in its own task (SOL-L12): what the wallet signs is still SOL-L1d's claim (§11.8)", () => {
  const cabinet = code("app/app/launch/mine/creator-cabinet.tsx");
  /* The button opens the Review; the claim starts only from it, and its bytes must be the claim the Review showed. */
  assert.match(cabinet, /onClick=\{\(\) => void openReview\(\)\}/);
  assert.match(cabinet, /onSign=\{\(\) => void claim\(review\.data\)\}/);
  assert.match(cabinet, /if \(built\.ok && !buildMatchesReview\(shown, built\.data\)\) return \{ ok: false as const, code: CLAIM_CHANGED, message: "" \};/);
  assert.match(code("app/app/launch/mine/claim-all-review.tsx"), /from "@\/lib\/ticket\/review-words"/, "the Review's lines are the shared ones");
  /* The build route is the one SOL-L1d left. */
  assert.match(cabinet, /api<LaunchClaimBuildResponse>\(`\$\{base\}\/build`, \{ method: "POST", body: JSON\.stringify\(\{ wallet \}\) \}\)/);
});

/*
 * The money path under the three Reviews, pinned by its text: the builders of the payment, the cancellation and the
 * permission are what they were when the Review came in front of them (origin/master 044c6c1e). A change to any of
 * them is a change of what a wallet signs.
 */
const MONEY_PATH = [
  ["lib/pay/transaction.ts", "export async function buildPaymentTransaction(", "4f9e19af7699751b"],
  /* MC-1 (decision 68, 25.10): the submit arms the request's one attempt before the bytes leave — what the wallet signs is unchanged. */
  ["lib/pay/transaction.ts", "export async function submitPaymentTransaction(", "52b9fa40424baefa"],
  ["app/solana/workspace/spot/limit-api.ts", "export async function signAndCancel(", "642bacbfc7810a19"],
  ["lib/solana/limits/review.server.ts", "export async function buildLimitCancel(", "482c7ad1e67f8a99"],
  ["lib/solana/limits/trigger.server.ts", "export async function buildTriggerCancel(", "e7f789fbc6b017e5"],
  /* CITY-231: one close, not two — the SDK's cancel already closes the order account. */
  ["lib/solana/limits/dlmm.server.ts", "export async function buildDlmmCancel(", "13a1542b18dc42e9"],
  ["lib/launch/holder.server.ts", "export async function buildHolderPermission(", "25bc1d630b326c5e"],
  ["lib/launch/holder.server.ts", "export async function submitHolderPermission(", "19daf61ea0b413b4"],
  ["lib/core/venues/meteora-damm-v2/holder.server.ts", "async function buildGrant(", "a426386429c4ef2b"],
  ["lib/core/venues/meteora-damm-v2/holder.server.ts", "async function buildRevoke(", "98a01c2cce5bd14c"],
];

test("the money path under the Reviews is the one it was: payment, cancellation and permission builders unchanged", () => {
  for (const [path, signature, expected] of MONEY_PATH) assert.equal(digest(fn(path, signature)), expected, `${path} · ${signature}`);
});
