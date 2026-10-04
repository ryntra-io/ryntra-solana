import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("all cabinet screens stay beneath one unkeyed wallet provider and shell", () => {
  const layout = code("app/app/layout.tsx");
  const shell = code("app/app/product-shell.tsx");
  assert.equal((layout.match(/<SolanaConnectionProvider>/g) ?? []).length, 1);
  assert.equal((layout.match(/<WalletDataProvider>/g) ?? []).length, 1);
  assert.equal((layout.match(/<ProductShell\b/g) ?? []).length, 1);
  /* The account provider sits between the wallet connection and the wallet
     data — two principals, one tree, still unkeyed. */
  assert.match(layout, /<SolanaConnectionProvider>\s*<AccountProvider summary=\{account\}>\s*<WalletDataProvider>\s*<ProductShell/);
  assert.doesNotMatch(layout, /<SolanaConnectionProvider[^>]*\bkey=|<WalletDataProvider[^>]*\bkey=/);
  assert.doesNotMatch(layout, /\bredirect\(|<HomeShell|<AgentControlShell|<SolanaHubShell/);
  assert.match(shell, /product=\{\{\s*routes: PRODUCT_ROUTES/);
  assert.match(shell, /navGroups=\{\[\]\}/);

  /* Two names left this list with their pages. Bridge, because the cross-chain
     swap replaced it on 2026-09-08 — its engine still runs, embedded in Swap.
     And Markets, because the surface is now named Trends and `/app/markets`
     redirects there; the cabinet re-export it left behind was a page nobody
     could reach. */
  for (const route of ["portfolio", "swap", "send", "receive", "activity", "receipts", "assets"]) {
    const page = code(`app/app/${route}/page.tsx`);
    assert.match(page, /@\/app\/solana\/workspace\//, route);
    assert.doesNotMatch(page, /<RyntraAppShell|<SolanaConnectionProvider|<WalletDataProvider/, route);
  }
  const agents = code("app/app/agents/layout.tsx");
  assert.match(agents, /<PassportDirectoryProvider>/);
  assert.doesNotMatch(agents, /<RyntraAppShell|<SolanaConnectionProvider|<WalletDataProvider|<ActionCaseProvider/);
});

test("wallet reads are owner-scoped and reject responses from a replaced connection", () => {
  const provider = code("app/app/wallet-data.tsx");
  assert.match(provider, /owner=connection\?\.address\?\?null/);
  assert.match(provider, /if\(!owner\)[\s\S]*?return;/);
  assert.match(provider, /JSON\.stringify\(\{owner,network:"mainnet"\}\)/);
  assert.match(provider, /new AbortController\(\)/);
  /* Balances go through the one partial-aware reader (2026-09-12) on the
     effect's own abort signal; activity keeps its bounded timeout. */
  assert.match(provider, /readWalletHoldingsUntilComplete<unknown>\(\{owner:address,signal:controller\.signal/);
  assert.match(provider, /signal:AbortSignal\.any\(\[controller\.signal,AbortSignal\.timeout\(60_000\)/);
  assert.match(provider, /if\(!live\|\|sequence\.current!==request\) return;/);
  assert.match(provider, /return\s*\(\)\s*=>\s*\{live=false;controller\.abort\(\)/);
  assert.match(provider, /state\.owner===owner\?state:/);
  assert.match(provider, /\[owner,version\]/);
  assert.doesNotMatch(provider, /getSession|session\.identityWallet|watchAddress/);
});

test("returning from a money action refreshes the shared data rather than reconnecting", () => {
  const provider = code("app/app/wallet-data.tsx");
  /* Two paths, not three. `/app/bridge` no longer exists, and a refresh list
     naming a route the router does not serve is a rule that cannot fire. */
  for (const path of ["/app/send", "/app/swap"]) assert.ok(provider.includes(`"${path}"`));
  assert.ok(!provider.includes('"/app/bridge"'), "the refresh list still names a route that was removed");
  assert.match(provider, /previousPath\.current!==pathname[\s\S]*?\.includes\(previousPath\.current\)\) refresh\(\)/);
  assert.doesNotMatch(provider, /connectWallet\(|reconnectWallet\(|disconnect\(/);
});

test("Portfolio and Activity consume the same verified operation projection", () => {
  const provider = code("app/app/wallet-data.tsx");
  assert.match(provider, /readSolanaReceipts\(window\.localStorage,owner\)/);
  assert.match(provider, /verifyReceiptCandidates\(candidates,\(\)=>live\)/);
  const verifier = code("app/app/receipt-verification.client.ts");
  assert.match(verifier, /result\.integrity\.valid\s*&&\s*result\.issuer\.verdict === "SIGNATURE_VALID"/);
  assert.match(provider, /findReceiptForAction\(receiptRows,action\)/);
  assert.match(provider, /projectVerifiedReceiptOutcome\(/);
  assert.match(provider, /receipts\.owner===owner/);
  assert.match(provider, /<Context\.Provider value=\{\{\.\.\.current,activity,receiptRows,refresh\}\}/);
  /* Two surfaces, not three. Portfolio absorbed the overview, so the Home
     dashboard that was the third reader is gone. */
  for (const file of ["app/solana/workspace/holdings/holdings-card.tsx", "app/solana/workspace/history/history-card.tsx"]) {
    const surface = code(file);
    assert.match(surface, /useWalletData\(\)/, file);
    assert.doesNotMatch(surface, /projectVerifiedReceiptOutcome\(|verifyArtifact\(/, `${file} must not produce a second status`);
  }
});

test("cabinet locale changes propagate to nested providers and server-rendered plans", () => {
  for (const file of ["app/app/layout.tsx", "app/app/agents/layout.tsx"]) {
    assert.match(code(file), /normalizeWorkspaceLocale\(store\.get\(WORKSPACE_LOCALE_COOKIE\)\?\.value\)/, file);
  }
  /* My strategies reads the same cookie through the server locale helper and hands it to the plans panel. */
  assert.match(code("app/app/strategies/page.tsx"), /await solanaServerLocale\(\)/);
  assert.match(code("app/app/strategies/page.tsx"), /<PlansPanel locale=\{locale\} \/>/);
  for (const file of ["app/app/i18n/provider.tsx", "app/agents/workspace/i18n/provider.tsx", "app/solana/workspace/i18n/provider.tsx"]) {
    const source = code(file);
    assert.match(source, /useEffect\(\(\)\s*=>\s*\{\s*setLocaleState\(initialLocale\);\s*\},\s*\[initialLocale\]\)/, file);
    assert.match(source, /persistWorkspaceLocale\(next\)/, file);
    /* A page with an address per language goes to the chosen one's (`/uk/app/markets` ↔ `/app/markets`);
       every other page is asked for again in the cookie's language. */
    assert.match(source, file === "app/agents/workspace/i18n/provider.tsx" ? /router\.refresh\(\)/ : /showPageInLanguage\(router, next\)/, file);
  }
  assert.match(code("lib/site/use-page-path.ts"), /if \(target && target !== pathname \+ search\) router\.push\(target\);\s*else router\.refresh\(\);/);
  assert.match(code("app/app/settings/product-settings.tsx"), /useSolanaI18n\(\)/);
  /* The language is a row of the wallet's menu, writing the same locale. */
  assert.match(code("app/app/product-shell.tsx"), /<MenuPreferences\s+locale=\{locale\}\s+onLocale=\{setLocale\}/);
});

test("the foot of the rail carries Відгук and Settings; the language and the theme live in the wallet's menu", () => {
  /* The depth switch is gone — the product is one version; the language and
     the theme moved off the rail's foot to the top bar's one menu, where a
     person looks for their own settings: Налаштування, Мова, Тема,
     Від'єднати. */
  const shell = code("app/app/product-shell.tsx");
  assert.doesNotMatch(shell, /<DepthSwitch|depth-switch/, "the rail's foot carries the «Простий»/«Профі» switch again");
  assert.doesNotMatch(shell, /<ShellLanguageToggle|<ThemeToggle|rs-view-pair/, "the language or the theme is back on the rail's foot");
  assert.match(shell, /viewExtras=\{<FeedbackLauncher \/>\}/);
  /* The wallet's menu: Settings, Language, Theme — then the way out the panel itself draws last. */
  assert.match(shell, /<SolanaConnectionControl[\s\S]*?compact[\s\S]*?preferences=\{\(close\) => \(\s*<MenuPreferences/);
  const menu = code("app/shell/menu-preferences.tsx");
  let cursor = -1;
  for (const token of ["words.settings", "words.language", "words.theme"]) {
    const at = menu.indexOf(token);
    assert.ok(at > cursor, `${token} is missing from the wallet's menu or out of its order`);
    cursor = at;
  }
  const control = code("app/shell/connection-control.tsx");
  const connected = control.slice(control.indexOf('data-section="preferences">{preferences(close)}'));
  assert.ok(connected.indexOf("preferences(close)") < connected.indexOf("adapter.disconnect?.()"), "Від'єднати is not after the settings");

  /* And the product renders the foot inside a container of its own, Settings last. */
  const appShell = code("app/shell/app-shell.tsx");
  assert.match(appShell, /domainRoutes \? <div className="rs-view">\{viewExtras\}<\/div>/);
  const pinned = appShell.slice(appShell.indexOf('<div className="rs-nav-pinned">'));
  assert.ok(pinned.indexOf("viewExtras") < pinned.indexOf("settings ? ("), "Settings is no longer last in the pinned foot");

  /* The theme row holds no preference of its own, so Settings and the menu
     cannot drift apart. One writer, two views. */
  assert.match(menu, /getThemePref\(\)/);
  assert.match(menu, /attributeFilter: \["data-theme"\]/);
  assert.match(menu, /applyThemePref\(nextTheme\)/);
});

test("every section of the product's menu is visible — a caption is a label, not a control", () => {
  /* The groups got an arrow on 2026-09-08; since 2026-09-24 everything is
     visible without «Ще», so the product takes the arrow back: nothing of the
     menu is shut. The collapse machinery stays for the workspaces that still
     ask for it, and it still never shuts the group of the page a person is
     on. */
  const appShell = code("app/shell/app-shell.tsx");
  const product = appShell.slice(appShell.indexOf("const groups: readonly NavGroup[] = menu"), appShell.indexOf("const settingsEntry"));
  assert.doesNotMatch(product, /collapsible: true/, "a section of the product's menu can be shut");
  assert.match(product, /title: section\.title \?\? undefined/);
  assert.match(appShell, /aria-expanded=\{!shut\}/);
  assert.match(appShell, /openGroupOfActive\(readCollapsedGroups\(window\.localStorage\), groupsRef\.current, activeHref\)/,
    "the stored set must be read before the active group is opened, or a reload lands with the group shut over the page");
  assert.equal((appShell.match(/setCollapsed\(openGroupOfActive\(/g) ?? []).length, 1);
  /* On a desk the whole menu stands in one screen: compact rows above 900px wide. */
  const css = read("app/shell/shell.css");
  assert.match(css, /@media \(min-width: 901px\) \{\s*\.ry-product \.rs\[data-product="true"\] \.rs-nav \.rs-link \{\s*min-height: 32px;/);
});

test("the new Agents screens start with real input or stored inspections, never demo records", () => {
  const directory = code("app/app/agents/agent-directory.tsx");
  assert.match(directory, /usePassportDirectory\(\)/);
  assert.match(directory, /records\.filter\(/);
  assert.match(directory, /href="\/app\/agents\/inspect"/);
  assert.match(directory, /href="\/app\/agents\/verify"/);
  for (const file of ["app/app/agents/agent-directory.tsx", "app/app/agents/agent-inspector.tsx", "app/app/agents/file-verifier.tsx"]) {
    const source = code(file);
    assert.doesNotMatch(source, /(?:from|import\()\s*["'][^"']*(?:fixture|demo|sample)/i, file);
    assert.doesNotMatch(source, /<InfoControl|<details|Load sample|RYN-[A-Z]+|npm run|docs\/tasks\//, file);
    assert.doesNotMatch(source, /signTransaction\(|sendTransaction\(|signTypedData\(|eth_sendTransaction/, file);
  }
});
