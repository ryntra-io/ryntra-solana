import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WORKSPACE_LOCALE_COOKIE } from "../../../shell/locale.ts";
import {
  SOLANA_UK_TEXT,
  translateSolana,
} from "./catalog.ts";
import { SOLANA_MODULES, localizedSolanaModules } from "../hub/modules.ts";

test("Solana uses the one workspace locale cookie and has exact core EN/UA copy", () => {
  assert.equal(WORKSPACE_LOCALE_COOKIE, "ryntra_hub_locale");
  /* One name for the work — «Між мережами», the menu's word — never «Міст» (B18). */
  assert.equal(translateSolana("uk", "Bridge"), "Між мережами");
  assert.equal(translateSolana("uk", "Review bridge"), "Перевірити переказ між мережами");
  assert.equal(translateSolana("uk", "Mainnet · read only"), "Мейннет · лише читання");
  assert.equal(translateSolana("en", "Bridge"), "Bridge");
  assert.throws(() => translateSolana("uk", "__missing_translation__"), /missing/i);
});

test("every module field has Ukrainian copy and localization changes no capability fact", () => {
  for (const entry of SOLANA_MODULES) {
    for (const value of [entry.label, entry.purpose, entry.detail, entry.exists, entry.missing, entry.gate]) {
      assert.equal(typeof SOLANA_UK_TEXT[value], "string", `${entry.id} misses UA for: ${value}`);
      assert.notEqual(SOLANA_UK_TEXT[value], value, `${entry.id} leaves English in UA: ${value}`);
    }
  }

  const uk = localizedSolanaModules("uk");
  assert.equal(uk.length, SOLANA_MODULES.length);
  for (let index = 0; index < uk.length; index += 1) {
    const original = SOLANA_MODULES[index];
    const translated = uk[index];
    assert.deepEqual(
      {
        id: translated.id,
        route: translated.route,
        environment: translated.environment,
        mode: translated.mode,
        maturity: translated.maturity,
        lastVerifiedAt: translated.lastVerifiedAt,
        visibleInGuided: translated.visibleInGuided,
        visibleInPro: translated.visibleInPro,
        searchable: translated.searchable,
      },
      {
        id: original.id,
        route: original.route,
        environment: original.environment,
        mode: original.mode,
        maturity: original.maturity,
        lastVerifiedAt: original.lastVerifiedAt,
        visibleInGuided: original.visibleInGuided,
        visibleInPro: original.visibleInPro,
        searchable: original.searchable,
      },
      `${original.id} changed a fact while translating`,
    );
  }
});

test("layout and shell wire the shared locale server-first with a real language control", () => {
  const layout = readFileSync("app/solana/workspace/layout.tsx", "utf8");
  const shell = readFileSync("app/solana/workspace/hub/shell.tsx", "utf8");
  assert.match(layout, /cookies\(\)/);
  assert.match(layout, /WORKSPACE_LOCALE_COOKIE/);
  assert.match(layout, /SolanaI18nProvider/);
  assert.match(shell, /useSolanaI18n/);
  assert.match(shell, /ShellLanguageToggle/);
  assert.match(shell, /SHELL_CHROME_COPY/);
  assert.match(shell, /SHELL_STRINGS/);
  assert.match(shell, /lang=\{locale\}/);
});
