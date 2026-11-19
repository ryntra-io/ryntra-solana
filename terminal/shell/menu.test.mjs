import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LANGS } from "../../city/lib/i18n/langs.ts";
import { partOf, withPart } from "./address.ts";
import { botsWorking } from "./bots-count.ts";
import { terminalDestination } from "./home.ts";
import { BRIDGE_HREF, MARKET_ITEM, MENU, MENU_GROUP_IDS, RXN_FUTURES, RXN_PREDICTIONS, SOL_MINT, isOuter, itemAt, itemHref, menuShown } from "./menu.ts";
import { MENU_BOOT_SCRIPT, MENU_KEY, MENU_OPEN_ATTR, MENU_SHUT_ATTR, groupOpen, parseChoice, toggledChoice } from "./menu-fold.ts";
import { KIT_PATH, ownAddresses, REWARDS_PATH, SHELVES, shelfAt } from "./shelves.ts";
import { PARTNERS_OPEN } from "../rewards/partners.ts";
import { MENU_WORDS } from "./words.ts";

/* The menu by groups and Futures and Predictions on RXN. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const ids = (groups) => groups.map((group) => [group.id, group.items.map((item) => item.id)]);
const DOORS_OPEN = () => true;
const READY_SWAP = Object.fromEntries(Object.entries(SHELVES).map(([id, shelf]) => [id, { ...shelf, ready: id === "swap" || id === "market" }]));

test("the groups and their items", () => {
  assert.deepEqual(MENU_GROUP_IDS, ["trade", "launch", "bots", "agents", "earn", "portfolio", "money", "rewards"]);
  assert.deepEqual(ids(MENU), [
    ["trade", ["swap", "spot", "futures", "predict", "bridge"]],
    ["launch", ["launchNew", "launchMine"]],
    ["bots", ["recurring", "grid", "ladder", "copy", "signals", "keeper", "autopilot"]],
    ["agents", ["aiTrader", "scout", "analyst", "ownAi"]],
    ["earn", ["pools", "dlmmPro", "staking", "lending", "earnMine"]],
    ["portfolio", ["overview", "positions", "history", "saved"]],
    ["money", ["send", "receive", "invoices", "private", "contacts", "autopay"]],
    ["rewards", ["points", "invite", "partners"]],
  ]);
  assert.equal(MARKET_ITEM.href, "/", "the Market is the home page, above the groups");
});

test("an item stands only once its screen is ready: today's menu, and no group without an item", () => {
  assert.deepEqual(ids(menuShown("live", DOORS_OPEN, "stand")), [
    ["trade", ["swap", "spot", "futures", "predict", "bridge"]],
    ["launch", ["launchNew", "launchMine"]],
    ["bots", ["recurring", "grid", "ladder", "signals", "autopilot"]],
    ["agents", ["analyst"]],
    ["earn", ["pools", "dlmmPro", "staking", "lending", "earnMine"]],
    ["portfolio", ["overview", "positions", "history", "saved"]],
    ["money", ["send", "receive", "invoices"]],
    ["rewards", PARTNERS_OPEN ? ["points", "invite", "partners"] : ["points", "invite"]],
  ]);
  const shown = new Set(menuShown("live", DOORS_OPEN, "stand").flatMap((group) => group.items.map((item) => item.id)));
  for (const id of ["copy", "keeper", "aiTrader", "scout", "ownAi", "private", "contacts", "autopay", ...(PARTNERS_OPEN ? [] : ["partners"])]) {
    assert.equal(shown.has(id), false, `${id} has no screen yet`);
  }
  assert.deepEqual(menuShown("live", DOORS_OPEN, "closed"), [], "with the switch closed nothing of the menu stands");
});

test("an engine door that is shut takes its item away, and an empty group with it", () => {
  const noSend = menuShown("live", (gate) => gate !== "send", "stand");
  assert.deepEqual(noSend.find((group) => group.id === "money")?.items.map((item) => item.id), ["receive", "invoices"]);
  const noMoney = menuShown("live", () => false, "stand");
  assert.deepEqual(noMoney.find((group) => group.id === "money")?.items.map((item) => item.id), ["receive", "invoices"], "an address and a payment link move nothing: they stand without the money switch");
  assert.equal(noMoney.find((group) => group.id === "trade")?.items.some((item) => item.id === "bridge"), false, "no bridge where no move between networks runs");
  // The bots: each by its engine's door — the mandate's, the ladder's network, the money autopilot's switch;
  // the paper ones stand everywhere, so «Bots» never goes empty.
  const bots = (door) => menuShown("live", door, "stand").find((group) => group.id === "bots")?.items.map((item) => item.id);
  assert.deepEqual(bots((gate) => gate !== "trader"), ["grid", "ladder", "signals", "autopilot"], "no mandate's engine here: no «Recurring buys»");
  assert.deepEqual(bots((gate) => gate !== "ladder"), ["recurring", "grid", "signals", "autopilot"], "no ladder's network here: no «Order ladder»");
  assert.deepEqual(bots((gate) => gate !== "pilot"), ["recurring", "grid", "ladder", "signals"], "the money autopilot only where its engine is open");
  assert.deepEqual(bots(() => false), ["grid", "signals"], "on paper everywhere");
});

test("Futures and Predictions lead to RXN, in a new tab, with no mark RXN does not read", () => {
  const trade = MENU.find((group) => group.id === "trade");
  const out = trade.items.filter(isOuter);
  assert.deepEqual(out.map((item) => [item.id, item.out]), [
    ["futures", "https://rxn.gg/trade"],
    ["predict", "https://rxn.gg/trade?tab=predictions"],
  ]);
  assert.equal(RXN_FUTURES, "https://rxn.gg/trade");
  assert.equal(RXN_PREDICTIONS, "https://rxn.gg/trade?tab=predictions");
  for (const item of out) assert.equal(itemHref(item, "live"), item.out);
  const rail = read("terminal/shell/Rail.tsx");
  assert.match(rail, /href=\{item\.out\} target="_blank" rel="noopener noreferrer"/);
  const sheet = read("terminal/shell/SectionsSheet.tsx");
  assert.match(sheet, /href=\{item\.out\} target="_blank" rel="noopener noreferrer"/);
  assert.equal(SHELVES.futures.ready, false, "the old shelves stay off");
  assert.equal(SHELVES.predict.ready, false);
});

test("every item inside the terminal leads to a page that is", () => {
  for (const group of MENU) {
    for (const item of group.items) {
      if (isOuter(item) || !item.ready) continue;
      const path = item.href.split(/[?#]/)[0];
      const page = path === "/" ? "app/(terminal)/market/page.tsx" : path.startsWith("/coin/") ? "app/(terminal)/coin/[mint]/page.tsx" : `app/(terminal)${path}/page.tsx`;
      assert.ok(existsSync(join(REPO, page)), `${item.id}: ${page}`);
      // The bridge's page is the Swap shelf's where money moves between networks (the build's switch; open in the test).
      const shelves = { ...SHELVES, swap: { ...SHELVES.swap, also: ["/bridge"] } };
      assert.equal(shelfAt(path, shelves), item.shelf, `${item.id} stands in its shelf`);
      if (path === "/money") assert.ok(existsSync(join(REPO, "terminal/money/MoneyScreen.tsx")), "«Money» has its screen");
    }
  }
  const spot = MENU[0].items.find((item) => item.id === "spot");
  assert.equal(spot.href, `/coin/${SOL_MINT}`, "the Spot opens SOL's page");
});

test("the item a person is at: the closest address, a coin's page is the Spot, a tab without an item lights its screen", () => {
  const shown = menuShown("live", DOORS_OPEN, "stand");
  const at = (path, tail = "") => itemAt(path, tail, shown, true);
  assert.equal(at("/"), "market");
  assert.equal(at("/market"), "market");
  assert.equal(at("/", "?tab=saved"), "saved", "the Market's «Saved» is the Portfolio's item");
  assert.equal(at("/", "?tab=gainers"), "market");
  assert.equal(at(`/coin/${SOL_MINT}`), "spot");
  assert.equal(at("/coin/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"), "spot");
  assert.equal(at("/swap"), "swap");
  assert.equal(at("/bridge"), "bridge");
  assert.equal(at("/swap", "?tab=bridge"), "swap", "the old tab leads to the bridge's page itself");
  assert.equal(at("/swap", "?tab=limit"), "swap");
  assert.equal(at("/launch"), "launchNew");
  assert.equal(at("/launch", "?tab=mine"), "launchMine");
  assert.equal(at("/launch", "?tab=fresh"), "launchNew");
  assert.equal(at("/agent"), "analyst");
  assert.equal(at("/agent", "#new"), "analyst");
  for (const bot of ["recurring", "grid", "ladder", "signals", "autopilot"]) assert.equal(at(`/bots/${bot}`), bot, `the bot's own page lights its item`);
  assert.equal(at("/bots/copy"), null, "a bot without a screen lights nothing");
  assert.equal(at("/earn"), "pools");
  assert.equal(at("/earn", "?tab=staking"), "staking");
  assert.equal(at("/earn", "?tab=lending"), "lending");
  assert.equal(at("/earn", "?tab=mine"), "earnMine", "«My positions» lights its own item, never «Pools»");
  assert.equal(at("/pro"), "dlmmPro", "Meteora DLMM Pro's pools");
  assert.equal(at("/pool/JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d"), "dlmmPro", "a pool whose kind is not read yet stays DLMM Pro's");
  const pool = (kind) => itemAt("/pool/5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6", "", shown, true, kind);
  assert.equal(pool("other"), "pools", "a DLMM or DAMM v2 pool lights «Pools», never DLMM Pro (QA 19.11, m16)");
  assert.equal(pool("pro"), "dlmmPro", "a DLMM Pro pool lights DLMM Pro");
  assert.equal(at("/portfolio"), "overview");
  assert.equal(at("/portfolio", "?owner=x"), "overview");
  assert.equal(at("/portfolio", "#history"), "history");
  assert.equal(at("/portfolio", "#positions"), "positions");
  assert.equal(at("/money"), "send", "«Money» opens on «Send»");
  assert.equal(at("/money", "?tab=receive"), "receive");
  assert.equal(at("/money", "?tab=invoices"), "invoices");
  assert.equal(at("/money", "?tab=contacts"), "send", "a tab without an item lights the section's first");
  const noSend = menuShown("live", (gate) => gate !== "send", "stand");
  assert.equal(itemAt("/money", "", noSend, true), "receive", "without «Send» the section opens on «Receive»");
  assert.equal(at(REWARDS_PATH), "points", "«Rewards» opens on its points");
  assert.equal(at(REWARDS_PATH, "?tab=invite"), "invite");
  assert.equal(at(REWARDS_PATH, "?tab=partners"), PARTNERS_OPEN ? "partners" : "points", "a tab without an item lights its screen");
  assert.equal(at("/city"), null);
  assert.equal(at(`${KIT_PATH}/earn`), "pools", "the kit page lights its shelf's first item");
  assert.equal(at(KIT_PATH), null);
});

test("on the kit page every item leads to its shelf's preview", () => {
  for (const group of menuShown("preview", DOORS_OPEN, "stand")) {
    for (const item of group.items) {
      if (isOuter(item)) assert.equal(itemHref(item, "preview"), item.out);
      else assert.equal(itemHref(item, "preview"), `${KIT_PATH}/${item.shelf}`);
    }
  }
});

test("every group and item has its name in both languages", () => {
  const names = [...MENU_GROUP_IDS, "market", ...MENU.flatMap((group) => group.items.map((item) => item.id))];
  for (const lang of LANGS) for (const name of names) assert.ok(typeof MENU_WORDS[lang][name] === "string" && MENU_WORDS[lang][name].trim(), `${lang}: ${name}`);
  assert.deepEqual(MENU_GROUP_IDS.map((id) => MENU_WORDS.uk[id]), ["Торгівля", "Запуск", "Боти", "Агенти", "Заробіток", "Портфель", "Гроші", "Винагороди"]);
});

test("the groups stand folded but the one the person is in; their own choice is kept and set on the root before the first paint", () => {
  const none = { open: [], shut: [] };
  assert.equal(groupOpen("trade", true, none), true, "the group of the place a person is in stands open");
  assert.equal(groupOpen("earn", false, none), false, "every other group stands folded");
  assert.deepEqual(parseChoice(null), none);
  assert.deepEqual(parseChoice("not json"), none);
  assert.deepEqual(parseChoice('["trade"]'), none, "the old list of folded groups is not this choice");
  assert.deepEqual(parseChoice('{"open":["money","x","trade","trade"],"shut":["trade","earn"]}'), { open: ["trade", "money"], shut: ["earn"] }, "known ids, once, in the menu's order, never both ways");
  // A press turns a group the other way; only what differs from the default is kept, and no other group moves.
  const opened = toggledChoice(none, "earn", false);
  assert.deepEqual(opened, { open: ["earn"], shut: [] });
  const two = toggledChoice(opened, "bots", false);
  assert.deepEqual(two, { open: ["bots", "earn"], shut: [] }, "two groups open: the first stays open");
  assert.deepEqual(toggledChoice(two, "earn", false), { open: ["bots"], shut: [] });
  const shutHere = toggledChoice(none, "trade", true);
  assert.deepEqual(shutHere, { open: [], shut: ["trade"] });
  assert.equal(groupOpen("trade", true, shutHere), false, "the person folded the group they are in: it stays folded");
  assert.deepEqual(toggledChoice(shutHere, "trade", true), none);
  assert.match(MENU_BOOT_SCRIPT, /^try\{/);
  assert.ok(MENU_BOOT_SCRIPT.includes(MENU_KEY) && MENU_BOOT_SCRIPT.includes(MENU_OPEN_ATTR) && MENU_BOOT_SCRIPT.includes(MENU_SHUT_ATTR));
  // The script runs as written: a kept choice sets the attributes; a broken one leaves the root alone.
  const root = (kept) => {
    const attrs = {};
    const fn = new Function("localStorage", "document", MENU_BOOT_SCRIPT);
    fn({ getItem: () => kept }, { documentElement: { setAttribute: (k, v) => (attrs[k] = v) } });
    return attrs;
  };
  assert.deepEqual(root('{"open":["earn","trade"],"shut":["bots","trade"]}'), { [MENU_OPEN_ATTR]: "trade earn", [MENU_SHUT_ATTR]: "bots" });
  assert.deepEqual(root("]"), {});
  assert.deepEqual(root(null), {});
  // Folded by default on the open rail; open where the person is or where they opened it; folded where they folded it.
  const css = read("terminal/shell/shell.module.css");
  const RAIL = ":global(html:not([data-rail='folded']))";
  assert.ok(css.includes(`${RAIL} .items {\n    grid-template-rows: 0fr;`), "folded by default");
  assert.ok(css.includes(`${RAIL} .group[data-lit] > .items,`), "open where the person is");
  for (const id of MENU_GROUP_IDS) {
    assert.ok(css.includes(`:global(html:not([data-rail='folded'])[data-menu-open~='${id}']) .group[data-group='${id}'] > .items`), id);
    assert.ok(css.includes(`:global(html:not([data-rail='folded'])[data-menu-shut~='${id}']) .group[data-group='${id}'][data-lit] > .items`), id);
  }
  const shell = read("terminal/shell/TerminalShell.tsx");
  assert.match(shell, /RAIL_BOOT_SCRIPT \+ MENU_BOOT_SCRIPT/);
  // The rail hides to the side with the arrow at its edge, by the mark — not a row at its foot.
  const rail = read("terminal/shell/Rail.tsx");
  assert.ok(rail.indexOf('data-terminal="rail-fold"') < rail.indexOf('data-terminal="menu"'), "the arrow stands above the menu");
  assert.match(css, /\.railFold \{\s*position: absolute;\s*top: 31px;\s*right: -13px;/);
});

test("beside «Bots»: the traders, the autopilot and the pools kept that work now — from the engine's one answer", () => {
  const mandate = (status, pilot = false) => ({ status, pilot });
  assert.equal(botsWorking(null), 0);
  assert.equal(botsWorking({ read: false, mandates: [mandate("working")], pilot: null, cares: [] }), 0, "an answer not read counts nothing");
  assert.equal(
    botsWorking({
      read: true,
      mandates: [mandate("working"), mandate("paused"), mandate("working", true), mandate("stopped")],
      pilot: { status: "working", policy: "x" },
      cares: [{ key: "a", pool: "p", status: "working" }, { key: "b", pool: "q", status: "stopped" }],
    }),
    3,
  );
  const source = read("terminal/shell/bots-count.ts");
  assert.match(source, /useEffect\(\(\) => \{\n\s+if \(owner && MANDATE_NET\) void syncAgents\(owner\);\n\s+\}, \[owner\]\);/, "asked once a wallet, never once a render");
});

test("a shelf's other own addresses: the city's old redirect gives way to them too", () => {
  const shelves = { ...SHELVES, swap: { ...SHELVES.swap, also: ["/bridge"] } };
  assert.equal(shelfAt("/bridge", shelves), "swap");
  assert.deepEqual(ownAddresses("swap", shelves), ["/swap", "/bridge"]);
  assert.equal(shelfAt("/bridge"), null, "where money does not move between networks, the old /bridge leads where it did");
  assert.equal(BRIDGE_HREF, "/bridge", "«Bridge» opens its own page");
  assert.equal(terminalDestination("/?open=money&tab=bridge", "open", READY_SWAP, true), "/bridge", "the city's old bridge addresses lead to the bridge's page");
  assert.equal(terminalDestination("/?open=money&tab=bridge", "open", READY_SWAP, false), "/swap", "…and to the Swap where the bridge is shut");
});

test("the address's parts: read and written back, the fragment kept", () => {
  assert.equal(partOf("?tab=mine#x", "tab"), "mine");
  assert.equal(partOf("#x", "tab"), null);
  assert.equal(partOf("", "act"), null);
  assert.equal(withPart("https://ryntra.io/earn?tab=pools#a", "tab", "staking"), "https://ryntra.io/earn?tab=staking#a");
  assert.equal(withPart("https://ryntra.io/earn?tab=pools", "tab", null), "https://ryntra.io/earn");
});

test("the screens read their tab or panel from the address the menu leads to", () => {
  const earn = read("terminal/earn/EarnScreen.tsx");
  assert.match(earn, /useTabInAddress\(tab, setTab, EARN_TABS, 'pools'\)/);
  assert.match(earn, /const onPro = pathname === PRO_PATH;/, "DLMM Pro's tab is its own address, /pro");
  assert.match(read("terminal/launch/LaunchScreen.tsx"), /useTabInAddress\(tab, setTab, TABS, 'new'\)/);
  const portfolio = read("terminal/portfolio/PortfolioScreen.tsx");
  assert.match(portfolio, /useMoneyForward\(act, sends\)/, "the old «Send» and «Receive» panels lead on to «Money»");
  assert.match(read("terminal/money/MoneyScreen.tsx"), /useTabInAddress\(tab, setTab, tabs, first\)/);
  assert.match(portfolio, /id="history"/);
  assert.match(read("terminal/portfolio/Groups.tsx"), /id="positions"/);
});
