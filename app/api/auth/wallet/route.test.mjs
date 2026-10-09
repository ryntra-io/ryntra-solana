/* Source-level checks on the EVM wallet proof route. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../../../../" + path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\r\n/g, "\n");

const ROUTE = code("app/api/auth/wallet/route.ts");
const BODY = ROUTE;

test("the nonce is checked for two different properties, and neither is skipped", () => {
  /*
   * The hole this ordering closes.
   *
   * `beta_consume_login_nonce` records *consumption*, not *issuance* — it takes
   * any well-formed 24-character string and returns true the first time. An
   * attacker who invents a nonce, builds a message around it and signs it is on
   * first use and would be accepted. The HMAC tag answers "did this server mint
   * it"; the database answers "has it been spent". Both are required.
   */
  assert.match(BODY, /walletNonceIssuedHere\(nonce\)/);
  assert.match(BODY, /consumeLoginNonce\(nonce,/);

  const issuedAt = BODY.indexOf("walletNonceIssuedHere(nonce)");
  const spentAt = BODY.indexOf("consumeLoginNonce(nonce,");
  const verifiedAt = BODY.indexOf("await verifySiwe(");
  assert.ok(issuedAt > 0 && spentAt > 0 && verifiedAt > 0);

  // Issuance is free, so it runs first and keeps invented nonces out of the DB.
  assert.ok(issuedAt < spentAt, "the issuance tag must be checked before the database is asked");
  /* And the nonce is spent BEFORE the signature is verified: a captured
     signature then finds its nonce gone, and two concurrent requests carrying
     the same one cannot both proceed. */
  assert.ok(spentAt < verifiedAt, "the nonce must be spent before verification, not after");
});

test("the server builds the message; the client never supplies one to be trusted", () => {
  /* GET returns a server-built message. If the client could hand in its own, it
     would choose its own domain, expiry and statement and every check in
     verifySiwe would become a formality it can satisfy. */
  assert.match(BODY, /buildSiweMessage\(\{/);
  const getAt = BODY.indexOf("export async function GET");
  const postAt = BODY.indexOf("export async function POST");
  assert.ok(BODY.indexOf("buildSiweMessage({") > getAt && BODY.indexOf("buildSiweMessage({") < postAt);

  /* Domain and uri come from the request URL, never from the body or a header a
     caller controls. */
  assert.match(BODY, /const url = new URL\(req\.url\);\s*return \{ domain: url\.host, uri: url\.origin \};/);
  assert.doesNotMatch(BODY, /body\.domain|body\.uri|headers\.get\("host"\)/);
});

test("the proof-minting path is same-origin, rate limited and size capped", () => {
  assert.match(BODY, /mutationOriginAllowed\(req\.url, req\.headers\.get\("origin"\), req\.headers\.get\("sec-fetch-site"\)\)/);
  const originAt = BODY.indexOf("mutationOriginAllowed");
  assert.ok(originAt > 0 && originAt < BODY.indexOf("await req.text()"));
  assert.match(BODY, /new FixedWindowLimiter\(\{ windowMs: 60_000, limit: 20, maxKeys: 5_000 \}\)/);
  assert.match(BODY, /clientIp\(req\.headers\)/);
  assert.match(BODY, /raw\.length > MAX_BODY_BYTES/);
  assert.equal((BODY.match(/const capped = limited\(req\);/g) ?? []).length, 2);
});

test("a signature proves an address and opens a wallet-proof session — never an account", () => {
  /* A wallet is not a Ryntra account. The signature mints the
     `rw` proof cookie; the `rt` account cookie is minted only by the three
     account doors, and no account row is created from a signature. */
  const verifyAt = BODY.indexOf("await verifySiwe(");
  const proofAt = BODY.indexOf('kind: "wallet"');
  const mintAt = BODY.indexOf("issueSessionRefToken(");
  assert.ok(verifyAt > 0 && proofAt > verifyAt, "the proof session may only be opened after verification");
  assert.ok(mintAt > verifyAt, "the proof cookie may only be minted after verification");
  assert.match(BODY, /if \(!verified\.ok\) return fail\("verification failed", 401\);/);
  assert.doesNotMatch(BODY, /createWalletUser|issueSessionToken\(|issueWalletSessionToken\(/, "no account is created or opened by a signature");
  assert.doesNotMatch(BODY, /cookies\.set\("rt"/, "the account cookie is not written here");
  assert.equal((BODY.match(/res\.cookies\.set\("rw", token, \{/g) ?? []).length, 1, "one proof cookie writer");
  assert.match(BODY, /httpOnly: true/);
  assert.match(BODY, /sameSite: "lax"/);
  assert.match(BODY, /secure: new URL\(req\.url\)\.protocol === "https:"/);
  assert.match(BODY, /maxAge: WALLET_PROOF_TTL_S/);
  assert.match(BODY, /walletChain: "evm"/);
  assert.match(BODY, /method: "wallet_siwe"/);

  /* Linking binds the proven address to the account in the session and to
     nothing else; a taken address is a refusal, not a move. */
  assert.match(BODY, /accountWalletLink\(session\.accountId, "evm", wallet\)/);
  assert.match(BODY, /linked\.error === "wallet_taken" \? 409/);
  const linkAt = BODY.indexOf('if (action === "link")');
  assert.ok(linkAt > verifyAt, "linking happens only after verification");

  /* The token grammar carries a wallet subject for the legacy stateless form
     and never a synthetic Telegram id. */
  const token = read("lib/beta/token.ts");
  assert.match(token, /kind: "wallet"; wallet: string/);
  assert.match(token, /sess:w\$\{normalized\}/);
  assert.match(token, /raw\.startsWith\("w"\)/);
  assert.doesNotMatch(token, /siwe/i, "signature verification stays out of the token module");
});
