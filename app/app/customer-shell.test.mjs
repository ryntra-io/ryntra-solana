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
     data — two principals, one tree, still unkeyed — inside the one shared
     proof answer the server seeds before the page renders. */
  assert.match(layout, /<SolanaConnectionProvider>\s*<WalletProofSeed[^>]*>\s*<AccountProvider summary=\{account\}>\s*<WalletDataProvider>\s*<ProductShell/);
  assert.doesNotMatch(layout, /<SolanaConnectionProvider[^>]*\bkey=|<WalletDataProvider[^>]*\bkey=/);
  assert.doesNotMatch(layout, /\bredirect\(|<HomeShell|<AgentControlShell|<SolanaHubShell/);
  /* The frame is the core's (B1): its AppShell on Menu 3, the row on screen from the one registry (NAV-1). */
  assert.match(shell, /<AppShell\b[\s\S]*?current="solana"/);
  assert.match(shell, /return rowForPath\(pathname\);/);
  assert.doesNotMatch(shell, /<RyntraAppShell|navGroups=/, "the product is back in the old frame");

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
  /* «Мої боти» reads the same cookie through the server locale helper and hands it, through its view (B16), to the plans panel. */
  assert.match(code("app/app/bots/page.tsx"), /await solanaServerLocale\(\)/);
  assert.match(code("app/app/bots/page.tsx"), /<BotsView locale=\{locale\} authority=\{authorityViews\(BOTS_AUTHORITY_IDS\)\} \/>/);
  assert.match(code("app/app/bots/bots-view.tsx"), /<PlansPanel locale=\{locale\} \/>/);
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
  /* The language is the core's «Налаштувати», writing the same locale. */
  assert.match(code("app/app/product-shell.tsx"), /lang=\{locale\}\s+onLangChange=\{setLocale\}/);
});

test("nothing above the page: the assistant at the end of the header, Settings, the notifications and «Відгук» in the wallet's panel", () => {
  /* Menu 3 (NAV-1, decision 55): every place is a row of the menu, so no row of tabs or tools stands above the page.
     The assistant Ryntra is the core header's own button; «Запустити токен» is the Launch page's action, «Винагороди» a
     row of Заробіток; Settings, the notifications and «Відгук» stand in the wallet's panel; the language, the theme,
     the density and the menu's place are the core's «Налаштувати» at the foot of the menu. */
  const shell = code("app/app/product-shell.tsx");
  assert.doesNotMatch(shell, /<DepthSwitch|depth-switch|<ShellLanguageToggle|<ThemeToggle|<MenuPreferences/, "a second place for the language or the theme is back");
  assert.doesNotMatch(shell, /sol-pagebar|<AskRyntraButton|<HeaderRewards|<NotificationsBell|MENU_ACTION/, "a tool stands above the page again");
  assert.match(shell, /onAssistant=\{pathname === ASSISTANT\.href \? undefined : onAssistant\}/);
  assert.match(shell, /helpHref="\/docs"/);
  /* The wallet's panel: the account, then Settings, the notifications and «Відгук» — then the way out the panel draws last. */
  assert.match(shell, /<SolanaConnectionControl\s+identity=\{<WalletAccountIdentity \/>\}\s+compact\s+triggerId=\{WALLET_TRIGGER\}\s+preferences=\{\(close\) => \(\s*<>\s*<Link className="rs-menu-item" href="\/app\/settings"/);
  const panel = shell.slice(shell.indexOf("preferences={(close)"));
  assert.ok(panel.indexOf('href="/app/settings"') < panel.indexOf("<NotificationsRow") && panel.indexOf("<NotificationsRow") < panel.indexOf("setFeedback(true)"), "the panel's rows are out of their order");
  assert.match(shell, /<FeedbackLauncher open=\{feedback\} onClose=\{closeFeedback\} \/>/);
  const control = code("app/shell/connection-control.tsx");
  const connected = control.slice(control.indexOf('data-section="preferences">{preferences(close)}'));
  assert.ok(connected.indexOf("preferences(close)") < connected.indexOf("adapter.disconnect?.()"), "Від'єднати is not after the settings");
  /* The header's wallet button opens that panel; its own trigger is out of sight and out of the Tab order. */
  assert.match(shell, /document\.getElementById\(WALLET_TRIGGER\)\?\.click\(\)/);
  assert.match(shell, /trigger\.tabIndex = -1;/);
  /* Settings holds no theme of its own: it opens «Налаштувати» — the menu's own row — so the two cannot drift apart. */
  const settings = code("app/app/settings/product-settings.tsx");
  assert.doesNotMatch(settings, /applyThemePref|getThemePref/);
  assert.match(settings, /onClick=\{\(\)=>openCustomize\(\)\}/);
  assert.match(settings, /import \{ openCustomize \} from "\.\.\/customize-open";/);
  assert.match(code("app/app/customize-open.ts"), /\.ryntra-menu__settings/);
  /* The theme and the language have one home (UX-013): the account's page draws no switch of its own. */
  assert.doesNotMatch(settings, /setLocale|aria-pressed=\{locale/);
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
  /* The menu v6.2: groups without headings — a thin line, not a caption, stands between them. */
  assert.doesNotMatch(product, /title:/, "a group of the product's menu carries a heading");
  assert.match(appShell, /aria-expanded=\{!shut\}/);
  assert.match(appShell, /openGroupOfActive\(readCollapsedGroups\(window\.localStorage\), groupsRef\.current, activeHref\)/,
    "the stored set must be read before the active group is opened, or a reload lands with the group shut over the page");
  assert.equal((appShell.match(/setCollapsed\(openGroupOfActive\(/g) ?? []).length, 1);
  /* On a desk the whole menu stands in one screen: compact rows above 900px wide. */
  const css = read("app/shell/shell.css");
  assert.match(css, /@media \(min-width: 901px\) \{\s*\.ry-product \.rs\[data-product="true"\] \.rs-nav \.rs-link \{\s*min-height: 32px;/);
});

test("the Agents tools start with real input, never demo records; the old address leads by its content (B18)", () => {
  /* `/app/agents` is no longer the passport directory nor the recurring-buy rules: it leads to the treasury, where an
     agent's multisig and limits are made, or to «Боти» where the treasury is not served. */
  const agents = code("app/app/agents/page.tsx");
  assert.match(agents, /redirect\(treasuryNetwork\(\) \? "\/app\/treasury" : "\/app\/bots"\)/);
  /* The config answers first, with a real 307: a page's redirect under a streamed layout answers 200. */
  assert.match(code("next.config.ts"), /source: "\/app\/agents",\s*destination: treasuryNetworkFrom\(process\.env\.NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK\) \? "\/app\/treasury" : "\/app\/bots",\s*permanent: false,/);
  for (const file of ["app/app/agents/agent-inspector.tsx", "app/app/agents/file-verifier.tsx"]) {
    const source = code(file);
    assert.doesNotMatch(source, /(?:from|import\()\s*["'][^"']*(?:fixture|demo|sample)/i, file);
    assert.doesNotMatch(source, /<InfoControl|<details|Load sample|RYN-[A-Z]+|npm run|docs\/tasks\//, file);
    assert.doesNotMatch(source, /signTransaction\(|sendTransaction\(|signTypedData\(|eth_sendTransaction/, file);
  }
});

test("a Ukrainian address lights the same row: the frame reads the page's own path", async () => {
  const shell = code("app/app/product-shell.tsx");
  assert.match(shell, /const pathname = usePagePath\(\);/);
  assert.doesNotMatch(shell, /usePathname\(/, "the frame reads the address with its language prefix");
  const { pagePath } = await import("../../lib/site/localized.ts");
  const { rowForPath } = await import("../shell/domains.ts");
  assert.equal(pagePath("/uk/app/markets"), "/app/markets");
  assert.equal(rowForPath(pagePath("/uk/app/markets")), "markets");
  assert.equal(rowForPath(pagePath("/uk/app/stocks/NVDAx")), "markets");
});
