import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A wallet connected once stays connected
 * through sign-in and sign-out. A full reload remounted every provider and the
 * wallet had to come back from the silent restore — the moment it dropped.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const context = read("./account-context.tsx");
const control = read("./account-control.tsx");
const sheet = read("./login-sheet.tsx");

test("signing in with the wallet re-reads the layout in place, never reloads the page", () => {
  for (const [name, source] of [["account-control", control], ["login-sheet", sheet]]) {
    assert.match(source, /signedInHere/, `${name} finishes a sign-in through the account`);
  }
  assert.doesNotMatch(control, /window\.location\.(assign|reload|replace)/, "the wallet panel's sign-in does not navigate");
  assert.doesNotMatch(sheet, /<WalletEntry onSuccess=\{\(\) => \{[^}]*window\.location/, "the sheet's wallet door does not navigate");
  const done = context.slice(context.indexOf("const signedInHere"), context.indexOf("const signedInHere") + 400);
  assert.match(done, /router\.refresh\(\)/);
  assert.doesNotMatch(done, /window\.location/);
});

test("signing out re-reads the layout in place: the private view closes, the wallet stays, other tabs hear it", () => {
  const out = context.slice(context.indexOf("const logout = useCallback"), context.indexOf("const logout = useCallback") + 1400);
  assert.doesNotMatch(out, /window\.location\.(assign|reload|replace)/, "no reload after a confirmed sign-out");
  assert.match(out, /setBlocked\(true\)/, "the private view closes at once");
  assert.match(out, /announceAccountChange\(\)/, "other tabs re-read too");
  assert.match(out, /router\.refresh\(\)/);
});

test("the wallet's proof waits for a change that holds, unless the person chose the other wallet; a sign-in settles it", () => {
  /* The behaviour itself — A→B→A clears nothing, A→B held clears once, a sign-in meanwhile settles first — is
     lib/account/wallet-auth.test.mjs; here, that the page is wired to it. */
  const effect = context.slice(context.indexOf("if (address === null) return;"), context.indexOf("}, [address, router]);"));
  assert.match(effect, /return clearWalletAccountSoon\(WALLET_CHANGE_SETTLE_MS, act\)/, "a change from the wallet or the restore waits");
  assert.match(effect, /connectedByRef\.current === "chosen"[\s\S]*clearWalletAccount\(\)/, "the person's own Connect of another wallet clears at once");
  const settle = Number(/const WALLET_CHANGE_SETTLE_MS = (\d+);/.exec(context)?.[1]);
  assert.ok(settle >= 1000 && settle <= 3000, `a moment, not a delay a person waits on (${settle} ms)`);
  const proof = readFileSync(new URL("../../solana/workspace/wallet-proof.tsx", import.meta.url), "utf8");
  const run = proof.slice(proof.indexOf("const run = useCallback"));
  assert.ok(run.indexOf("settleWalletChange()") > 0 && run.indexOf("settleWalletChange()") < run.indexOf("walletAuthGeneration()"), "every sign-in settles a waiting change before it reads the generation");
});
