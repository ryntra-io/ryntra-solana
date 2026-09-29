import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectSessionIdentity } from "./session-identity.ts";

const watchAddress = "0x1111111111111111111111111111111111111111";
const provedWallet = "0x2222222222222222222222222222222222222222";

test("a Telegram session keeps the watch address separate and proves no wallet", () => {
  assert.deepEqual(
    projectSessionIdentity({
      subjectKind: "TELEGRAM",
      subjectWallet: null,
      watchAddress,
    }),
    {
      subjectKind: "TELEGRAM",
      identityWallet: null,
      legacyWatchAddress: watchAddress,
      walletOwnership: "NOT_PROVEN_IN_THIS_SESSION",
    },
  );
});

test("a wallet-subject session exposes only the exact SIWE address as identity", () => {
  assert.deepEqual(
    projectSessionIdentity({
      subjectKind: "WALLET",
      subjectWallet: provedWallet.toUpperCase().replace("0X", "0x"),
      watchAddress,
    }),
    {
      subjectKind: "WALLET",
      identityWallet: provedWallet,
      legacyWatchAddress: watchAddress,
      walletOwnership: "PROVEN_BY_SIWE",
    },
  );
});

test("wallet proof and watch selection never seed the connected Solana wallet", () => {
  const session = readFileSync(new URL("../session.ts", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../../app/app/layout.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../../app/app/settings/product-settings.tsx", import.meta.url), "utf8");
  const control = readFileSync(new URL("../../app/app/connection.tsx", import.meta.url), "utf8");

  assert.match(session, /projectSessionIdentity\(\{/);
  assert.doesNotMatch(session, /wallet:\s*state\.user\.wallet_address/);
  assert.match(settings, /<SolanaConnectionControl\s*\/>/);
  assert.match(layout, /<SolanaConnectionProvider>/);
  assert.doesNotMatch(layout, /<SolanaConnectionProvider\s+[^>]*(?:identityWallet|watchAddress|wallet_address)/);
  assert.match(control, /identityWallet:\s*string \| null/);
  assert.doesNotMatch(control, /wallet:\s*string \| null/);
});
