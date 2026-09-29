import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { navigationFromManifest, settingsEntry } from "./modules.ts";
import { homeManifest } from "../app/home-manifest.ts";
import { HOME_CATALOG } from "../app/i18n/catalog.ts";
import { agentManifest } from "../agents/workspace/agent-manifest.ts";
import { AGENT_CATALOG } from "../agents/workspace/i18n/catalog.ts";
import { SHELL_CHROME_COPY, SHELL_STRINGS } from "./chrome-copy.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(ROOT, relative), "utf8");

test("Home Simple is the skeleton; Settings is pinned; Pro reveals children", () => {
  const simple = navigationFromManifest(homeManifest((key) => HOME_CATALOG.en[key]), "simple");
  const pro = navigationFromManifest(homeManifest((key) => HOME_CATALOG.en[key]), "pro");
  const simpleHrefs = simple.flatMap((group) => group.entries).map((entry) => entry.href);
  assert.deepEqual(simpleHrefs, [
    "/app",
    "/app/research",
    "/app/portfolio",
    "/app/strategies",
    "/app/journal",
  ]);
  assert.equal(settingsEntry(homeManifest((key) => HOME_CATALOG.en[key]))?.href, "/app/settings");
  assert.ok(pro.length > simple.length, "Pro groups the modules separately");
  const proHrefs = pro.flatMap((group) => group.entries).map((entry) => entry.href);
  assert.ok(proHrefs.includes("/app/action-cases"));
  assert.ok(proHrefs.includes("/app/connect"));
  assert.ok(!simpleHrefs.includes("/app/connect"));
});

test("Agent Control Simple is the skeleton; Settings is pinned; Pro reveals children", () => {
  const simple = navigationFromManifest(agentManifest((key) => AGENT_CATALOG.en[key]), "simple");
  const pro = navigationFromManifest(agentManifest((key) => AGENT_CATALOG.en[key]), "pro");
  const simpleHrefs = simple.flatMap((group) => group.entries).map((entry) => entry.href);
  assert.deepEqual(simpleHrefs, [
    "/agents/workspace",
    "/agents/workspace/agents",
    "/agents/workspace/actions",
    "/agents/workspace/policies",
    "/agents/workspace/evidence",
  ]);
  assert.equal(
    settingsEntry(agentManifest((key) => AGENT_CATALOG.en[key]))?.href,
    "/agents/workspace/settings",
  );
  const proHrefs = pro.flatMap((group) => group.entries).map((entry) => entry.href);
  assert.ok(proHrefs.includes("/agents/workspace/attention"));
  assert.ok(proHrefs.includes("/agents/workspace/passport"));
  assert.ok(!simpleHrefs.includes("/developers/agent-control"));
});

test("Home and Agent Control chrome catalogs have EN/UA parity", () => {
  assert.deepEqual(Object.keys(HOME_CATALOG.en).sort(), Object.keys(HOME_CATALOG.uk).sort());
  assert.deepEqual(Object.keys(AGENT_CATALOG.en).sort(), Object.keys(AGENT_CATALOG.uk).sort());
  assert.deepEqual(Object.keys(SHELL_CHROME_COPY.en.layout).sort(), Object.keys(SHELL_CHROME_COPY.uk.layout).sort());
  assert.deepEqual(Object.keys(SHELL_STRINGS.en).sort(), Object.keys(SHELL_STRINGS.uk).sort());
});

test("Home and Agent Control mount the shared shell, not a second chrome", () => {
  assert.match(read("app/app/home-shell.tsx"), /RyntraAppShell/);
  assert.match(read("app/agents/workspace/agent-control-shell.tsx"), /RyntraAppShell/);
  assert.doesNotMatch(read("app/app/nav.tsx"), /LangSwitch|cbs-lang/);
  assert.doesNotMatch(read("app/agents/workspace/agent-control-shell.tsx"), /NO WALLET|walletBelongsOn/);
  assert.match(read("app/app/home-shell.tsx"), /WORKSPACE_LOCALE|ShellLanguageToggle|chrome.language/);
  assert.match(read("app/agents/workspace/agent-control-shell.tsx"), /ShellLanguageToggle/);
});
