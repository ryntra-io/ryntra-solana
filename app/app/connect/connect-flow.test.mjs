import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(new URL("./connect-flow.tsx", import.meta.url), "utf8");
const copy = readFileSync(new URL("../copy.ts", import.meta.url), "utf8");
const swapTerminal = readFileSync(new URL("../../robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
const swapPage = readFileSync(new URL("../../robinhood/workspace/swap/page.tsx", import.meta.url), "utf8");
const appRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function productionSources(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionSources(path));
    else if ([".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.endsWith(".test.mjs")) files.push(path);
  }
  return files;
}

test("wallet discovery for an Arcus credential never mutates account identity or watch data", () => {
  assert.doesNotMatch(source, /fetch\("\/api\/settings"/);
  assert.doesNotMatch(source, /savedWallet|walletSaved|setWalletSaved/);
  assert.doesNotMatch(source, /connecting IS ownership proof/);
});

test("wallet discovery cannot persist legacy wallet state from any application surface", () => {
  const offenders = productionSources(appRoot)
    .filter((path) => {
      const text = readFileSync(path, "utf8");
      return text.includes("eth_requestAccounts") && text.includes("/api/settings");
    })
    .map((path) => relative(appRoot, path).replaceAll("\\", "/"));

  assert.deepEqual(offenders, []);
  assert.doesNotMatch(swapTerminal, /savedWallet|\/api\/settings/);
  assert.doesNotMatch(swapPage, /wallet_address|savedWallet/);
});

test("the Arcus flow keeps provider revoke and local-only removal as different outcomes", () => {
  assert.match(source, /revokeApiKeyMessage/);
  assert.match(source, /revokeFailed/);
  assert.match(source, /forgetLocalOnly/);
  assert.match(source, /the key stays active on Arcus until expiry/i);
});

test("the credential flow does not claim account identity or exact action authority", () => {
  assert.match(source, /c\.step1Boundary/);
  assert.match(source, /c\.step2Authority/);
  assert.match(copy, /does not link this wallet to your Ryntra account/i);
  assert.match(copy, /does not authorize an order/i);
  assert.doesNotMatch(source, /unlocks live|execution ready|ownership proved/i);
});
