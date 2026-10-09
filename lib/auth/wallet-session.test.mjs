import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * One wallet sign-in for the whole site. The rules live in a few files;
 * these checks keep each of them where it is.
 */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const SESSION = read("lib/session.ts");
const ACCOUNT = read("lib/auth/account-session.ts");
const SIGNIN = read("app/api/auth/solana/route.ts");
const STATUS = read("app/api/auth/solana/session/route.ts");
const LAYOUT = read("app/app/layout.tsx");

test("a wallet sign-in lives as long as an email one", () => {
  assert.match(ACCOUNT, /export const WALLET_SIGNIN_TTL_S = CUSTOMER_SESSION_TTL_S;/);
  assert.match(SIGNIN, /walletAddress: address, ttlSeconds: WALLET_SIGNIN_TTL_S \}\)/, "the customer session of a sign-in");
  assert.match(SIGNIN, /res\.cookies\.set\("rt", customerToken, \{ \.\.\.cookieBase\(req\.url\), maxAge: WALLET_SIGNIN_TTL_S \}\)/);
  assert.match(SIGNIN, /if \(!customer\) \{\s+proof = await sessionOpen\(/, "a sign-in opens no separate account-less proof");
  assert.match(SIGNIN, /res\.cookies\.delete\("rw"\);/, "and drops a replaced one");
  assert.match(SIGNIN, /if \(token\) res\.cookies\.set\("rw", token, \{ \.\.\.cookieBase\(req\.url\), maxAge: WALLET_PROOF_TTL_S \}\)/, "prove keeps its short term");
});

test("the wallet sign-in is the proof of its own address, bound to the account's wallets", () => {
  const body = SESSION.slice(SESSION.indexOf("export async function readWalletProof"), SESSION.indexOf("export async function getWalletProof"));
  assert.ok(body.indexOf('jar.get("rw")') < body.indexOf('jar.get("rt")'), "a separate proof is read first");
  assert.match(body, /s\.kind === "customer" && s\.method === "solana_siws" && s\.walletChain && s\.walletAddress && walletSessionBound\(s\)/);
  assert.match(SESSION, /export async function getWalletProof\(\): Promise<WalletProof \| null> \{\n  const read = await readWalletProof\(\);/);
});

test("a store that does not answer is told apart from a signed-out request", () => {
  assert.match(SESSION, /if \(outcome\.status === "unavailable"\) return \{ status: "unavailable" \};/);
  assert.match(STATUS, /status: 503/, "the status route answers 503, never a 200 that signs somebody out");
  assert.match(LAYOUT, /const checking = read\.status === "unavailable"/);
});

test("prove still creates no account; the web asks a person without one to sign in", () => {
  assert.match(SIGNIN, /`prove` still creates no account/);
  assert.equal((SIGNIN.match(/accountResolveSolana\(/g) ?? []).length, 1);
  assert.match(SIGNIN, /if \(body\.action === "signin"\) \{\n    const account = await accountResolveSolana/);
});

test("a sign-in in use is renewed in place — same account, same signed address, the old row left to end on its own", () => {
  const body = ACCOUNT.slice(ACCOUNT.indexOf("export async function renewWalletSignin"));
  assert.match(body, /input\.method !== "solana_siws"/, "only a wallet sign-in");
  assert.match(body, /left > \(WALLET_SIGNIN_TTL_S \* 1000\) \/ 2\) return null;/, "only after half of its term");
  assert.match(body, /accountId: input\.accountId,\n    walletChain: "solana", walletAddress: input\.walletAddress/);
  assert.doesNotMatch(body, /sessionRevoke\(input\.sessionId/, "a request in flight with the old cookie is not signed out");
  assert.match(STATUS, /renewWalletSignin\(/);
  assert.match(LAYOUT, /sessionKey: session\?\.accountId \?\? session\?\.sessionId \?\? null/, "a renewed row does not remount the page");
});

test("a store that blinked is not a 401 on line A's data routes", () => {
  assert.match(SESSION, /if \(read\.status === "unavailable"\) throw new SessionStoreUnavailable\(\);/);
  for (const file of ["app/api/solana/receipts/archive/route.ts", "app/api/spot/watchlist/route.ts", "app/api/pay/requests/route.ts"]) {
    assert.match(read(file), /if \(read\.status === "unavailable"\) return json\(\{ error: "unavailable" \}, 503\);/, file);
  }
});

test("a wallet change or Disconnect closes only what the wallet opened", () => {
  assert.match(STATUS, /const walletOpened = result\.session\.kind === "wallet" \|\| \(result\.session\.kind === "customer" && result\.session\.method === "solana_siws"\);/);
  assert.match(STATUS, /if \(!walletOpened\) continue;/);
});
