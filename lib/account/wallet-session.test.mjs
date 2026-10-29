import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("a customer wallet session must still belong to the proven link", async () => {
  const { walletSessionBound } = await import("./wallet-session.ts");
  const session = { kind: "customer", method: "solana_siws", walletChain: "solana", walletAddress: "wallet-a", account: { wallets: [{ chain: "solana", address: "wallet-a" }] } };
  assert.equal(walletSessionBound(session), true);
  assert.equal(walletSessionBound({ ...session, walletAddress: "wallet-b" }), false);
  assert.equal(walletSessionBound({ ...session, walletChain: "evm" }), false);
  assert.equal(walletSessionBound({ ...session, account: { wallets: [] } }), false);
  assert.equal(walletSessionBound({ ...session, method: "email_password", walletAddress: null }), true);
  assert.equal(walletSessionBound({ ...session, kind: "admin" }), false);
});

/* SOL-W3: a wallet linked to the account by its own signature is the proof
   for that account's session — while it stays linked and the session lives. */
const A = "So1anaWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const B = "So1anaWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1";
const EMAIL = Object.freeze({
  id: "sess-email", kind: "customer", method: "email_password", accountId: "acct-1", walletChain: null, walletAddress: null,
  expiresAt: "2026-11-19T00:00:00.000Z",
  account: { authUserId: "auth-1", telegramLinked: false, operator: false, wallets: [{ chain: "solana", address: A, verifiedAt: "2026-10-20T10:00:00.000Z" }] },
});
const ok = (session) => ({ status: "ok", session });

test("linked → the account's session reads without a signature", async () => {
  const { sessionWalletProof } = await import("./wallet-session.ts");
  for (const method of ["email_password", "email_recovery", "google_oidc", "telegram_oidc"]) {
    const read = sessionWalletProof(ok({ ...EMAIL, method }), null, true);
    assert.equal(read.status, "ok", method);
    assert.deepEqual(read.proof, { sessionId: "sess-email", chain: "solana", address: A, method, expiresAt: EMAIL.expiresAt, via: "link" });
  }
});

test("unlinked → no proof: the next read asks for the link again", async () => {
  const { sessionWalletProof } = await import("./wallet-session.ts");
  assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, account: { ...EMAIL.account, wallets: [] } }), A), { status: "absent" });
  assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, account: null }), null), { status: "absent" });
  /* An EVM link proves no Solana address. */
  assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, account: { ...EMAIL.account, wallets: [{ chain: "evm", address: "0xabc", verifiedAt: "x" }] } }), null), { status: "absent" });
});

test("another account's wallet → refused: only this account's own links prove, whatever the browser names", async () => {
  const { sessionWalletProof, sessionWalletAddress } = await import("./wallet-session.ts");
  /* B is linked to some other account, so it is not in this session's row; the hint cookie cannot add it. */
  assert.equal(sessionWalletAddress(EMAIL, B), A);
  assert.equal(sessionWalletProof(ok(EMAIL), B, true).proof.address, A);
  assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, account: { ...EMAIL.account, wallets: [] } }), B), { status: "absent" });
  /* A session with no account proves nothing. */
  assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, accountId: null }), A), { status: "absent" });
});

test("an expired, idle or revoked account session → refused; a store that blinked is «checking», not a proof", async () => {
  const { sessionWalletProof } = await import("./wallet-session.ts");
  for (const reason of ["expired", "idle", "revoked", "not_found"]) {
    assert.deepEqual(sessionWalletProof({ status: "refused", reason }, A), { status: "absent" }, reason);
  }
  assert.deepEqual(sessionWalletProof({ status: "unavailable" }, A), { status: "unavailable" });
});

test("the wallet sign-in (SIWS) proves its own address, as it did — never another linked wallet", async () => {
  const { sessionWalletProof } = await import("./wallet-session.ts");
  const siws = { ...EMAIL, id: "sess-siws", method: "solana_siws", walletChain: "solana", walletAddress: A,
    account: { ...EMAIL.account, wallets: [{ chain: "solana", address: A, verifiedAt: "1" }, { chain: "solana", address: B, verifiedAt: "2" }] } };
  assert.equal(sessionWalletProof(ok(siws), B).proof.address, A, "the hint does not move a sign-in");
  assert.equal(sessionWalletProof(ok(siws), null).proof.method, "solana_siws");
  assert.equal(sessionWalletProof(ok(siws), null).proof.via, "signin");
  assert.deepEqual(sessionWalletProof(ok({ ...siws, account: { ...siws.account, wallets: [{ chain: "solana", address: B, verifiedAt: "2" }] } }), null), { status: "absent" }, "its own address unlinked");
  assert.deepEqual(sessionWalletProof(ok({ ...siws, walletChain: "evm" }), null), { status: "absent" });
});

test("only a customer session proves: an admin or a separate wallet proof row is not an account's link", async () => {
  const { sessionWalletProof } = await import("./wallet-session.ts");
  assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, kind: "admin" }), null, true), { status: "absent" });
  assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, kind: "wallet" }), null, true), { status: "absent" });
});

test("only the named doors prove a link: email, its recovery, Google, Telegram OpenID — not the bot link, not an EVM sign-in", async () => {
  const { sessionWalletProof } = await import("./wallet-session.ts");
  for (const method of ["telegram_link", "wallet_siwe", "some_future_door"]) {
    assert.deepEqual(sessionWalletProof(ok({ ...EMAIL, method }), A, true), { status: "absent" }, method);
  }
});

test("the doors whose link proves, by name — a link from any other keeps the short rw, as before", async () => {
  const { linkProvesFor } = await import("./wallet-session.ts");
  for (const method of ["email_password", "email_recovery", "google_oidc", "telegram_oidc"]) assert.equal(linkProvesFor(method), true, method);
  for (const method of ["telegram_link", "wallet_siwe", "solana_siws", "some_future_door"]) assert.equal(linkProvesFor(method), false, method);
});

test("a link proves a wallet for reading only: refused unless the caller opts in; a wallet sign-in is as it was", async () => {
  const { sessionWalletProof } = await import("./wallet-session.ts");
  assert.deepEqual(sessionWalletProof(ok(EMAIL), A), { status: "absent" }, "a write, a payout or a binding never sees a link");
  assert.deepEqual(sessionWalletProof(ok(EMAIL), A, false), { status: "absent" });
  assert.equal(sessionWalletProof(ok(EMAIL), A, true).proof.via, "link", "a read opts in");
  const siws = { ...EMAIL, method: "solana_siws", walletChain: "solana", walletAddress: A };
  assert.equal(sessionWalletProof(ok(siws), null).proof.via, "signin", "SIWS needs no opt-in, for reads and writes alike");
  assert.equal(sessionWalletProof(ok(siws), null, true).proof.via, "signin");
});

test("several linked wallets: the one the last link in this browser named, else the one linked last", async () => {
  const { sessionWalletAddress } = await import("./wallet-session.ts");
  const two = { ...EMAIL, account: { ...EMAIL.account, wallets: [{ chain: "solana", address: A, verifiedAt: "1" }, { chain: "solana", address: B, verifiedAt: "2" }] } };
  assert.equal(sessionWalletAddress(two, null), B);
  assert.equal(sessionWalletAddress(two, A), A);
  assert.equal(sessionWalletAddress(two, "not-linked"), B);
});

/* readWalletProof's own rule, run end to end: the cookies a browser holds, the token check and the session store
   (faked here — node cannot load next/headers). */
const RW = Object.freeze({ id: "sess-rw", kind: "wallet", method: "solana_siws", accountId: null, walletChain: "solana", walletAddress: B,
  expiresAt: "2026-10-21T00:00:00.000Z", account: null });
const SIWS = Object.freeze({ ...EMAIL, id: "sess-siws", method: "solana_siws", walletChain: "solana", walletAddress: A });
function store(rows, down = false) {
  const asked = [];
  return {
    asked,
    deps: {
      verify: (token) => token === "admin" ? { subject: { kind: "session", sessionId: "x" }, admin: true }
        : token.startsWith("s:") ? { subject: { kind: "session", sessionId: token.slice(2) }, admin: false } : null,
      resolve: async (id) => { asked.push(id); return down ? { status: "unavailable" } : rows[id] ? ok(rows[id]) : { status: "refused", reason: "not_found" }; },
    },
  };
}
const jar = (cookies) => ({ rw: null, rt: null, linked: null, ...cookies });

test("readWalletProof: an email account's rt with a linked wallet — no proof unless the read opts in", async () => {
  const { readCookieWalletProof } = await import("./wallet-session.ts");
  const { deps } = store({ "sess-email": EMAIL });
  assert.deepEqual(await readCookieWalletProof(jar({ rt: "s:sess-email" }), deps), { status: "absent" }, "off by default");
  assert.deepEqual(await readCookieWalletProof(jar({ rt: "s:sess-email" }), deps, { allowLink: false }), { status: "absent" });
  const read = await readCookieWalletProof(jar({ rt: "s:sess-email" }), deps, { allowLink: true });
  assert.equal(read.status, "ok");
  assert.deepEqual(read.proof, { sessionId: "sess-email", chain: "solana", address: A, method: "email_password", expiresAt: EMAIL.expiresAt, via: "link" });
  /* The hint picks only among this account's links. */
  assert.equal((await readCookieWalletProof(jar({ rt: "s:sess-email", linked: B }), deps, { allowLink: true })).proof.address, A);
});

test("readWalletProof: the rw proof and the wallet sign-in prove as they did, with or without the opt-in", async () => {
  const { readCookieWalletProof } = await import("./wallet-session.ts");
  const { deps } = store({ "sess-rw": RW, "sess-email": EMAIL, "sess-siws": SIWS });
  for (const options of [{}, { allowLink: true }]) {
    const rw = await readCookieWalletProof(jar({ rw: "s:sess-rw", rt: "s:sess-email" }), deps, options);
    assert.deepEqual(rw, { status: "ok", proof: { sessionId: "sess-rw", chain: "solana", address: B, method: "solana_siws", expiresAt: RW.expiresAt, via: "proof" } }, "rw first");
    const siws = await readCookieWalletProof(jar({ rt: "s:sess-siws" }), deps, options);
    assert.equal(siws.proof.via, "signin");
    assert.equal(siws.proof.address, A);
  }
  /* A lapsed rw falls through to the account's own answer. */
  assert.deepEqual(await readCookieWalletProof(jar({ rw: "s:gone", rt: "s:sess-email" }), deps), { status: "absent" });
  assert.equal((await readCookieWalletProof(jar({ rw: "s:gone", rt: "s:sess-siws" }), deps)).proof.via, "signin");
});

test("readWalletProof: an admin token, a forged token or no cookie proves nothing; a store that blinked is «checking»", async () => {
  const { readCookieWalletProof } = await import("./wallet-session.ts");
  const { deps, asked } = store({ "sess-email": EMAIL });
  assert.deepEqual(await readCookieWalletProof(jar({ rt: "admin", rw: "admin" }), deps, { allowLink: true }), { status: "absent" });
  assert.deepEqual(await readCookieWalletProof(jar({ rt: "forged" }), deps, { allowLink: true }), { status: "absent" });
  assert.deepEqual(await readCookieWalletProof(jar({}), deps, { allowLink: true }), { status: "absent" });
  assert.deepEqual(asked, [], "nothing reaches the store without a valid session token");
  const down = store({}, true).deps;
  assert.deepEqual(await readCookieWalletProof(jar({ rt: "s:sess-email" }), down, { allowLink: true }), { status: "unavailable" });
  assert.deepEqual(await readCookieWalletProof(jar({ rw: "s:sess-rw" }), down), { status: "unavailable" });
});

test("requireWalletProof's rule: a mutation refuses a link alone, a read takes it; the wallet's own proofs pass both", async () => {
  const { readCookieWalletProof, intentWalletProof } = await import("./wallet-session.ts");
  const { deps } = store({ "sess-rw": RW, "sess-email": EMAIL, "sess-siws": SIWS });
  const reader = (cookies) => (options) => readCookieWalletProof(jar(cookies), deps, options);
  assert.deepEqual(await intentWalletProof("mutation", reader({ rt: "s:sess-email" })), { status: "absent" }, "«sign with the wallet», as with no proof");
  assert.equal((await intentWalletProof("read", reader({ rt: "s:sess-email" }))).proof.via, "link");
  assert.equal((await intentWalletProof("mutation", reader({ rw: "s:sess-rw", rt: "s:sess-email" }))).proof.via, "proof");
  assert.equal((await intentWalletProof("mutation", reader({ rt: "s:sess-siws" }))).proof.via, "signin");
  /* Even a reader that ignored the opt-out never hands a mutation a link. */
  const careless = async () => ({ status: "ok", proof: { sessionId: "s", chain: "solana", address: A, method: "email_password", expiresAt: "x", via: "link" } });
  assert.deepEqual(await intentWalletProof("mutation", careless), { status: "absent" });
  assert.deepEqual(await intentWalletProof("mutation", async () => ({ status: "unavailable" })), { status: "unavailable" });
});

test("readWalletProof and requireWalletProof run that rule, with the real cookies and store", () => {
  const SESSION = read("lib/session.ts");
  const body = SESSION.slice(SESSION.indexOf("export async function readWalletProof"), SESSION.indexOf("export class SessionStoreUnavailable"));
  assert.match(body, /readCookieWalletProof\(/);
  assert.match(body, /jar\.get\(LINKED_WALLET_COOKIE\)/);
  assert.match(body, /verify: verifySession, resolve: \(id\) => sessionResolve\(id\)/);
  assert.match(SESSION, /export async function readWalletProof\(options: WalletProofOptions = \{\}\)/, "off by default");
  assert.equal((read("lib/api/v1/proof.ts").match(/await intentWalletProof\(intent, readWalletProof\)/g) ?? []).length, 2, "both v1 proof readers");
});

test("a link opens no `rw`, closes an older one, and names the wallet for this browser", () => {
  const SIGNIN = read("app/api/auth/solana/route.ts");
  assert.match(SIGNIN, /const linkProves = body\.action === "link" && Boolean\(session\?\.sessionId\) && Boolean\(session\?\.method && linkProvesFor\(session\.method\)\);/,
    "a recorded session of a door that proves its links; a bot link, a wallet sign-in linking a second wallet or a legacy token keeps the rw");
  assert.match(SIGNIN, /if \(body\.action === "prove" \|\| \(body\.action === "link" && !linkProves\)\) \{\n    proof = await sessionOpen\(/,
    "only prove — and a link made from a legacy stateless session, which has no row to prove it — opens the 24-hour proof");
  const link = SIGNIN.slice(SIGNIN.indexOf('if (body.action === "link") {\n    if (!session?.accountId)'), SIGNIN.indexOf("let customer:"));
  assert.ok(link.indexOf("accountWalletLink(") < link.indexOf("sessionRevoke(outcome.session.id"), "an older rw is closed only once the link is written: a refused link costs nobody their proof");
  assert.match(link, /accountWalletLink\(session\.accountId, "solana", address\)/);
  assert.match(link, /wallet_taken" \? 409/, "a wallet linked to another account is refused");
  assert.match(SIGNIN, /if \(linkProves\) \{\n    res\.cookies\.delete\("rw"\);\n    res\.cookies\.set\(LINKED_WALLET_COOKIE, address, \{ \.\.\.cookieBase\(req\.url\), maxAge: CUSTOMER_SESSION_TTL_S \}\)/);
  assert.match(read("app/api/auth/logout/route.ts"), /res\.cookies\.delete\(LINKED_WALLET_COOKIE\)/, "a sign-out drops the hint");
});

test("unlinking a wallet ends its proof here and now", () => {
  const IDENTITY = read("app/api/auth/identity/route.ts");
  const body = IDENTITY.slice(IDENTITY.indexOf('if (parsed.action === "unlink_wallet")'));
  assert.match(body, /rwOutcome\.session\.walletAddress === parsed\.address/);
  assert.ok(body.indexOf("sessionResolve(") < body.indexOf("accountWalletUnlink("), "the rw is asked before the link changes");
  assert.match(body, /if \(rwOutcome\?\.status === "unavailable"\) return json\(\{ error: "unavailable" \}, 503\);/, "a store that blinked leaves the link in place");
  assert.match(body, /res\.cookies\.delete\("rw"\)/);
  assert.match(body, /!\(await sessionRevoke\(rwOutcome\.session\.id, "logout"\)\)\) res = json\(\{ error: "unavailable", unlinked: true \}, 503\);\n\s+else res\.cookies\.delete\("rw"\);/, "a proof the store would not close keeps its cookie: 503");
  assert.match(read("app/app/settings/account-settings.tsx"), /revalidateWalletFact\(\{ fresh: true \}\)/, "every page hears it");
});

/* Every proof-gated route, by what it does. A write, a payout or a binding reads the proof without `allowLink`, so a
   link alone is refused there («sign with the wallet», as before) while the rw proof and the wallet sign-in work as
   they did; a read opts in. The function bodies are read from the source, method by method. */
function bodyOf(src, method) {
  const at = src.indexOf(`export async function ${method}(`);
  assert.ok(at >= 0, `no ${method}`);
  const next = src.indexOf("\nexport async function ", at + 1);
  return src.slice(at, next < 0 ? undefined : next);
}
const WRITES = [
  ["app/api/rewards/claim/route.ts", "POST"], ["app/api/rewards/claim/route.ts", "GET"],
  ["app/api/growth/partner/claim/route.ts", "POST"],
  ["app/api/rewards/referral/route.ts", "POST"], ["app/api/rewards/referral/route.ts", "GET"],
  ["app/api/growth/cards/route.ts", "POST"], ["app/api/growth/leaderboards/visibility/route.ts", "POST"],
  ["app/api/growth/partner/appeal/route.ts", "POST"], ["app/api/growth/partner/link/route.ts", "POST"],
  ["app/api/solana/receipts/archive/route.ts", "PUT"], ["app/api/pay/requests/route.ts", "POST"],
  ["app/api/spot/watchlist/route.ts", "PUT"], ["app/api/v1/launch/build/route.ts", "POST"],
  ["app/api/feedback/route.ts", "POST"], ["app/api/auth/logout/route.ts", "POST"],
  /* The partner a launch would bind is read as the build reads it: without a link, so the review never offers what
     the build will not keep. */
  ["app/api/growth/partner/route.ts", "GET"],
];
const READS = [
  ["app/api/solana/activity/route.ts", "POST"], ["app/api/solana/receipts/archive/route.ts", "GET"],
  ["app/api/pay/requests/route.ts", "GET"], ["app/api/spot/watchlist/route.ts", "GET"],
  ["app/api/auth/solana/session/route.ts", "GET"],
];

test("every write, payout and binding refuses a link alone; the wallet's own proof works there as before", () => {
  for (const [file, method] of WRITES) {
    const body = bodyOf(read(file), method);
    assert.match(body, /(get|read)WalletProof(From)?\(/, `${file} ${method} reads a proof`);
    assert.doesNotMatch(body, /allowLink/, `${file} ${method} must not take a link`);
  }
});

test("every read takes a link", () => {
  for (const [file, method] of READS) {
    assert.match(bodyOf(read(file), method), /WalletProof(From)?\([^)]*\{ allowLink: true \}\)/, `${file} ${method}`);
  }
  for (const file of ["app/app/layout.tsx"]) {
    assert.match(read(file), /readWalletProof\(\{ allowLink: true \}\)/, file);
  }
});

test("v1: the carrier is named", () => {
  assert.match(read("lib/api/v1/proof.ts"), /sessionId: proof\.sessionId \?\? null, via: proof\.via \}/);
});

test("a note opened from a link marks nothing: the note page reads without a link", () => {
  assert.match(read("app/app/alerts/open/page.tsx"), /await readWalletProof\(\);/, "the note page marks a note read: no link");
});

test("asked again on a link-proven address, the hook signs the short prove", () => {
  assert.match(read("app/solana/workspace/wallet-proof.tsx"), /if \(action === "none" && fresh\.provenVia === "link"\) action = actActionFor\(fresh, target\);/);
});

test("the link's hint goes with every sign-out door", () => {
  assert.match(read("app/api/session/route.ts"), /res\.cookies\.delete\(LINKED_WALLET_COOKIE\)/);
  assert.match(read("app/api/auth/logout/route.ts"), /res\.cookies\.delete\(LINKED_WALLET_COOKIE\)/);
});
