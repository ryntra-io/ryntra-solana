import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// CITY-6b: in the app the city must never sign outside the bridge. The router (`route.ts`) is the city's only door to
// a wallet's signature; this keeps every other city file from reaching Wallet Standard's signing functions directly,
// and keeps the system share sheet behind the app's own.

const CITY = fileURLToPath(new URL("../../", import.meta.url));
const ROUTE = "lib/app-bridge/route.ts";

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = sources(CITY).map((path) => ({ path: relative(CITY, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));

test("no city file but the router takes a signing function from the browser's wallet modules", () => {
  const signing = /import\s*\{[^}]*\b(signTransaction|signTransactions|signInWithWallet|signMessageWithWallet)\b[^}]*\}\s*from\s*['"][^'"]*lib\/solana\/(wallet|wallet-signin)\.client(\.ts)?['"]/;
  const reached = files.filter((file) => file.path !== ROUTE && signing.test(file.text)).map((file) => file.path);
  assert.deepEqual(reached, []);
  assert.match(files.find((file) => file.path === ROUTE).text, signing, "the router itself is the one door");
});

test("the system share sheet is asked only after the app's", () => {
  for (const file of files.filter((f) => /navigator\.share\(|nav\.share\(/.test(f.text))) {
    const share = file.text.search(/navigator\.share\(|nav\.share\(/);
    const app = file.text.indexOf("shareThroughApp(");
    assert.ok(app >= 0 && app < share, `${file.path} tries the app first`);
  }
});
