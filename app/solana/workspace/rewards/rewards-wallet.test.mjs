import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { proofKey, REFUSAL_WINDOW_MS, refusalVerdict, rewardsWallet } from "./rewards-wallet.ts";

/* Ріст 18: Rewards takes the wallet's proof from the sign-in and remembers it — no second «Connect», no «Confirm wallet». */

const A = "3y3f4Hia3hhwEt3ZwW2wu2xYzG69bAHwUYSjz7K89gcs";
const B = "GY38NHgDaK6NgCHrf3hRqnsSktP8mW5uyWuiH34aEyqv";
const known = (provenAddress, expiresAt = null) => ({ status: "known", provenAddress, expiresAt });
const unknown = { status: "unknown", provenAddress: null, expiresAt: null };

test("a wallet signed in here opens Rewards, connected or not yet reconnected", () => {
  assert.deepEqual(rewardsWallet(A, known(A), null), { gate: "open", address: A });
  /* After a reload the wallet reconnects a moment later: the sign-in already names the address. */
  assert.deepEqual(rewardsWallet(null, known(A), null), { gate: "open", address: A });
  /* The store blinked after it had answered: what it knew still opens the page; the server judges the read. */
  assert.deepEqual(rewardsWallet(null, { status: "down", provenAddress: A, expiresAt: null }, null), { gate: "open", address: A });
});

test("a connected wallet that never signed in sees the one sign-in, nothing else", () => {
  assert.deepEqual(rewardsWallet(A, known(null), null), { gate: "signin", address: A });
  /* Another wallet than the one signed in: its own sign-in, never the other wallet's rewards. */
  assert.deepEqual(rewardsWallet(B, known(A), null), { gate: "signin", address: B });
});

test("nobody and no wallet: the wallet choice; an answer on its way: checking, never a prompt", () => {
  assert.deepEqual(rewardsWallet(null, known(null), null), { gate: "connect", address: null });
  assert.deepEqual(rewardsWallet(null, unknown, null), { gate: "checking", address: null });
  assert.deepEqual(rewardsWallet(A, unknown, null), { gate: "checking", address: A });
  assert.deepEqual(rewardsWallet(A, { status: "down", provenAddress: null, expiresAt: null }, null), { gate: "checking", address: A });
});

test("re-entry: sign in, reload, sign out, sign in again — asked exactly once per sign-in", () => {
  const asked = [];
  const visit = (connected, fact, refused = null) => {
    const wallet = rewardsWallet(connected, fact, refused);
    if (wallet.gate === "signin" || wallet.gate === "connect") asked.push(wallet.gate);
    return wallet.gate;
  };
  /* Connect on Rewards: the sign-in is asked for. */
  assert.equal(visit(A, known(null)), "signin");
  /* Signed: every page, a reload before the wallet reconnects, a new tab — open, nothing asked. */
  const first = known(A, "2026-11-19T10:00:00.000Z");
  for (let page = 0; page < 5; page += 1) assert.equal(visit(A, first), "open");
  assert.equal(visit(null, known(A)), "open");
  assert.equal(visit(A, known(A)), "open");
  /* Signed out (this device or every device): the sign-in again, once. */
  assert.equal(visit(A, known(null)), "signin");
  /* Signed in again: open on every return. */
  const second = known(A, "2026-11-19T11:00:00.000Z");
  for (let page = 0; page < 5; page += 1) assert.equal(visit(A, second), "open");
  assert.equal(visit(null, known(A)), "open");
  assert.deepEqual(asked, ["signin", "signin"]);
});

test("a read the server refused is remembered for that proof only; a new sign-in opens the page again", () => {
  const ended = known(A, "2026-10-20T10:00:00.000Z");
  const refused = proofKey(A, ended);
  /* The session was closed elsewhere while the page still believed it: ask to sign in, not to read again. */
  assert.deepEqual(rewardsWallet(A, ended, refused), { gate: "signin", address: A });
  /* No wallet in the browser to sign with: the wallet choice. */
  assert.deepEqual(rewardsWallet(null, ended, refused), { gate: "connect", address: null });
  /* A new sign-in is a new proof. */
  assert.deepEqual(rewardsWallet(A, known(A, "2026-11-19T12:00:00.000Z"), refused), { gate: "open", address: A });
  /* Another wallet's refusal never closes this one. */
  assert.deepEqual(rewardsWallet(A, known(A, "2026-11-19T12:00:00.000Z"), proofKey(B, known(B))), { gate: "open", address: A });
});

test("more gates: a refusal with no expiry, a store that cannot answer, another wallet's refusal", () => {
  /* A seed carries no expiry: the refusal of «A|» closes «A|» and nothing else. */
  assert.deepEqual(rewardsWallet(A, known(A), proofKey(A, known(A))), { gate: "signin", address: A });
  /* Refused, and the store cannot answer now: checking, never the sign-in. */
  assert.deepEqual(rewardsWallet(A, { status: "down", provenAddress: A, expiresAt: null }, proofKey(A, known(A))), { gate: "checking", address: A });
  /* Connected B; the refusal was A's: B's own sign-in, never A's page. */
  assert.deepEqual(rewardsWallet(B, known(A), proofKey(A, known(A))), { gate: "signin", address: B });
});

test("a refusal is not taken on its own word: the fact decides, and only the same proof refused twice closes the page", () => {
  const now = 1_000_000;
  const fresh = known(A, "2026-11-19T10:00:00.000Z");
  /* The sign-in still stands (a store that blinked, a read that crossed a sign-in): read once more. */
  assert.equal(refusalVerdict(A, fresh, [], now), "retry");
  /* The same proof refused again within the window: a refusal. */
  assert.equal(refusalVerdict(A, fresh, [now - 5_000], now), "refused");
  /* An old strike is a blink long gone: read once more. */
  assert.equal(refusalVerdict(A, fresh, [now - REFUSAL_WINDOW_MS - 1], now), "retry");
  /* The fact dropped the address: the gate follows it. */
  assert.equal(refusalVerdict(A, known(null), [], now), "gone");
  assert.equal(refusalVerdict(A, known(B), [], now), "gone");
  /* The fact cannot be read: neither a prompt nor a refusal. */
  assert.equal(refusalVerdict(A, { status: "down", provenAddress: A, expiresAt: null }, [], now), "unknown");
  /* A read whose empty answer may be a read failure (the season's own rows) never closes the page. */
  assert.equal(refusalVerdict(A, fresh, [now - 5_000], now, false), "unknown");
  assert.equal(refusalVerdict(A, known(null), [], now, false), "gone");
});

test("the refuse-and-read cycle of a page: a blink asks nothing; a closed session asks once; a new sign-in reads afresh", () => {
  /* A page's loop as the pages run it: read; on a refusal ask the fact, read once more on «retry», remember on «refused». */
  const refused = new Set();
  const strikes = new Map();
  let now = 1_000_000;
  let fact = known(A, "2026-11-19T10:00:00.000Z");
  /* How many reads the server refuses next, and whether it still holds the session at all. */
  let blinks = 0;
  let session = true;
  let reads = 0;
  const visit = () => {
    const wallet = rewardsWallet(A, fact, refused.has(proofKey(A, fact)) ? proofKey(A, fact) : null);
    if (wallet.gate !== "open") return wallet.gate;
    for (;;) {
      reads += 1;
      if (session && blinks === 0) return "read";
      blinks = Math.max(0, blinks - 1);
      const key = proofKey(A, fact);
      const verdict = refusalVerdict(A, fact, strikes.get(key) ?? [], now);
      if (verdict !== "retry") {
        if (verdict === "refused") refused.add(key);
        return verdict;
      }
      strikes.set(key, [...(strikes.get(key) ?? []), now]);
    }
  };
  assert.equal(visit(), "read");
  /* A store that blinked once: one refused read, read again, open — nothing asked. */
  blinks = 1;
  assert.equal(visit(), "read");
  assert.equal(reads, 3);
  /* The session closed on another device and the fact has not heard yet: refused twice, then the sign-in. */
  now += 2 * REFUSAL_WINDOW_MS;
  session = false;
  assert.equal(visit(), "refused");
  assert.equal(visit(), "signin");
  /* A new sign-in: a new proof, open, and one fresh read. */
  fact = known(A, "2026-11-19T12:00:00.000Z");
  session = true;
  const before = reads;
  assert.equal(visit(), "read");
  assert.equal(reads, before + 1);
});

/* The pages themselves: none asks the wallet on its own any more. */
const pages = ["rewards-card.tsx", "leaderboard-view.tsx", "season-view.tsx", "partner-view.tsx", "kit-view.tsx"];
for (const file of pages) {
  test(`${file}: the wallet comes from useRewardsWallet, and no page draws «Confirm wallet»`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /useWalletProof\(\)/, "the page reads the shared proof through useRewardsWallet");
    assert.doesNotMatch(source, /Confirm wallet|Confirm this wallet|words\.confirm\b|proof\.prove\(\)/);
    assert.match(source, file === "kit-view.tsx" ? /usePartnerPage\(\)/ : /useRewardsWallet\(\)/);
    assert.doesNotMatch(source, /useSolanaConnection\(\)/, "the address comes from the sign-in, not only from the browser's wallet");
  });
}
