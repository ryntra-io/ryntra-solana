import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { OLD_ADDRESSES, SHORT_ADDRESSES, oldAddressRedirects } from "../../city/lib/open/old-addresses.ts";
import { TERMINAL_FLAG, kitOpen, terminalMode, terminalOpen } from "./flag.ts";
import {
  CITY_PATH,
  COIN_PATH,
  HOME_PAGE,
  HOME_PATH,
  KIT_PATH,
  PHONE_CENTER,
  PHONE_SHEET,
  PHONE_TABS,
  SHELF_IDS,
  SHELVES,
  coinHref,
  isKitPath,
  ownAddresses,
  shelfAt,
  shelfHref,
  shelfOn,
  shelvesShown,
  takenByTerminal,
  viewOf,
} from "./shelves.ts";

/* The terminal's frame: one switch, eight shelves, one address each — and with the switch closed nothing of it answers. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");

/** Every page's address: the folders under `app/` with their route groups taken out. */
function pageAddresses() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(name)) {
        const folder = relative(join(REPO, "app"), dir).split("\\").join("/");
        out.push({ folder, address: `/${folder.split("/").filter((part) => part && !/^\(.*\)$/.test(part)).join("/")}`.replace(/\/$/, "") || "/" });
      }
    }
  };
  walk(join(REPO, "app"));
  return out;
}

const READY = (ids) => Object.fromEntries(SHELF_IDS.map((id) => [id, { ...SHELVES[id], ready: ids.includes(id) }]));

test("the switch: `stand` and `open` open the terminal, the kit page only on a stand, anything else keeps it closed", () => {
  assert.equal(TERMINAL_FLAG, "NEXT_PUBLIC_RYNTRA_TERMINAL");
  assert.equal(terminalMode("stand"), "stand");
  assert.equal(terminalMode(" open "), "open");
  for (const value of [undefined, null, "", "closed", "OPEN", "true", "1", "yes", "kit"]) assert.equal(terminalMode(value), "closed", String(value));
  assert.equal(terminalOpen("closed"), false);
  assert.equal(terminalOpen("stand"), true);
  assert.equal(terminalOpen("open"), true);
  assert.equal(kitOpen("stand"), true);
  assert.equal(kitOpen("open"), false, "people never see the kit page");
  assert.equal(kitOpen("closed"), false);
  // The browser's code is built with the switch written out in full, or the build cannot inline it.
  assert.match(read("terminal/shell/flag.ts"), /process\.env\.NEXT_PUBLIC_RYNTRA_TERMINAL\)/);
});

test("eight shelves in the rail's order, each with an address of its own; the phone's five tabs and its sheet hold all of them", () => {
  assert.deepEqual([...SHELF_IDS], ["market", "swap", "futures", "predict", "earn", "agents", "launch", "portfolio"]);
  const paths = SHELF_IDS.map((id) => SHELVES[id].path);
  assert.equal(new Set(paths).size, paths.length, "no two shelves share an address");
  for (const path of [...paths, COIN_PATH, KIT_PATH]) assert.match(path, /^\/[a-z][a-z/-]*$/, path);
  assert.equal(PHONE_TABS.length, 5);
  assert.equal(PHONE_TABS[2], PHONE_CENTER, "the agent is the middle tab");
  assert.equal(PHONE_CENTER, "agents");
  assert.deepEqual([...PHONE_TABS, ...PHONE_SHEET].sort(), [...SHELF_IDS].sort(), "every shelf has its place on a phone, once");
});

test("a shelf stands only once its screen is ready and the switch is open: no empty shelf, no «soon»", () => {
  for (const id of SHELF_IDS) assert.equal(SHELVES[id].ready, shelfOn(id, "stand"), `${id}: on exactly when ready`);
  assert.deepEqual(shelvesShown("live", "closed", READY([...SHELF_IDS])), [], "the switch closed: nothing, even when ready");
  assert.deepEqual(shelvesShown("live", "stand", READY([])), []);
  assert.deepEqual(shelvesShown("live", "open", READY(["swap", "market"])), ["market", "swap"], "in the rail's order");
  assert.deepEqual(shelvesShown("preview", "stand", READY([])), [...SHELF_IDS], "the kit page shows every shelf");
  // Each shelf keeps its lines apart, so two screens turning theirs on at once never edit the same line.
  const source = read("terminal/shell/shelves.ts");
  for (const id of SHELF_IDS) assert.match(source, new RegExp(`\\n  ${id}: \\{\\n    path: '[^']+',\\n    ready: (true|false),\\n  \\},`), id);
});

test("addresses: a shelf's own and the ones under it, a coin's screen in the Market, the kit's previews inside the kit", () => {
  for (const id of SHELF_IDS) {
    assert.equal(shelfHref(id, "live"), id === "market" ? HOME_PATH : SHELVES[id].path);
    assert.equal(shelfHref(id, "preview"), `${KIT_PATH}/${id}`);
    assert.equal(shelfAt(SHELVES[id].path), id);
    assert.equal(shelfAt(`${SHELVES[id].path}/`), id);
    assert.equal(shelfAt(`${SHELVES[id].path}/x?y=1#z`), id);
    assert.equal(shelfAt(`${KIT_PATH}/${id}`), id);
  }
  const mint = "So11111111111111111111111111111111111111112";
  assert.equal(coinHref(mint, "live"), `${COIN_PATH}/${mint}`);
  assert.equal(coinHref(mint, "preview"), `${KIT_PATH}/market`);
  assert.equal(shelfAt(`${COIN_PATH}/${mint}`), "market");
  assert.deepEqual(ownAddresses("market"), [SHELVES.market.path, COIN_PATH]);
  assert.equal(shelfAt(HOME_PATH), "market", "the home page is the Market");
  for (const path of ["/c/x", "/city", "/agents", "/predict", "/swapper", "/earnings", KIT_PATH, `${KIT_PATH}/nope`]) assert.equal(shelfAt(path), null, path);
  assert.equal(viewOf(KIT_PATH), "preview");
  assert.equal(viewOf(`${KIT_PATH}/swap`), "preview");
  assert.equal(viewOf("/swap"), "live");
  assert.equal(isKitPath("/terminal/kits"), false);
  assert.equal(CITY_PATH, "/city", "the terminal is the home page; the city stands at its own address");
  assert.equal(HOME_PAGE, SHELVES.market.path, "the home page is served from the Market's page");
});

test("every shelf's address is free: no other page stands at it, and no browser keeps an old redirect from it for good", () => {
  const pages = pageAddresses();
  for (const id of SHELF_IDS) {
    for (const own of ownAddresses(id)) {
      const taken = pages.filter((page) => !page.folder.startsWith("(terminal)") && (page.address === own || page.address.startsWith(`${own}/`)));
      assert.deepEqual(taken, [], `${id}: ${own} is another page's address`);
      // A 308 is cached by a browser for good: an address it ever answered can never become a shelf's.
      for (const row of [...OLD_ADDRESSES, ...SHORT_ADDRESSES]) {
        const stem = row.source.split("/:")[0];
        if (row.permanent) assert.ok(stem !== own && !row.source.startsWith(`${own}/`), `${id}: ${own} was redirected for good by ${row.source}`);
      }
    }
  }
  assert.ok(pages.some((page) => page.folder === "agents"), "the old agents pages keep /agents, so the Agents shelf is /agent");
  assert.ok(OLD_ADDRESSES.some((row) => row.source === "/predict/:path*" && row.permanent), "/predict was redirected for good, so Predictions is /predictions");
});

test("a shelf turned on has its screen: its page, and for the Market a coin's page too", () => {
  for (const id of SHELF_IDS.filter((shelf) => SHELVES[shelf].ready)) {
    const pages = [`app/(terminal)${SHELVES[id].path}/page.tsx`, ...(id === "market" ? [`app/(terminal)${COIN_PATH}/[mint]/page.tsx`] : [])];
    for (const page of pages) assert.ok(existsSync(join(REPO, page)), `${id} is on without ${page}: the rail would lead to a 404 and the city's short address would be gone`);
  }
});

test("with the switch closed nothing of the terminal answers: the frame and the kit pages stop at 404 first", () => {
  const layout = read("app/(terminal)/layout.tsx");
  assert.match(layout, /export default function TerminalLayout\([^)]*\)\s*\{\s*if \(!terminalOpen\(\)\) notFound\(\);/, "the frame refuses every address under it before anything else");
  for (const page of ["app/(terminal)/terminal/kit/page.tsx", "app/(terminal)/terminal/kit/[shelf]/page.tsx"]) {
    assert.match(read(page), /if \(!kitOpen\(\).*\) notFound\(\);/, `${page} answers only on a stand`);
  }
  // Every page of the terminal stands under the frame, so the frame's switch covers all of them.
  const outside = pageAddresses().filter((page) => page.folder.startsWith("(terminal)") === false && /^\/(terminal)(\/|$)/.test(page.address));
  assert.deepEqual(outside, []);
});

test("with the switch closed, or no shelf ready, every redirect of the city stands as it was", () => {
  const rows = oldAddressRedirects({ condition: { type: "host", value: "app\\.ryntra\\.io" }, origin: "https://ryntra.io" });
  const anyReady = SHELF_IDS.some((id) => SHELVES[id].ready);
  for (const row of rows) {
    assert.equal(takenByTerminal(row, "closed", READY([...SHELF_IDS])), false, `closed: ${row.source}`);
    assert.equal(takenByTerminal(row, "closed"), false, `closed, as built: ${row.source}`);
    assert.equal(takenByTerminal(row, "stand", READY([])), false, `none ready: ${row.source}`);
    if (!anyReady) assert.equal(takenByTerminal(row, "open"), false, `no shelf is ready yet: ${row.source}`);
  }
});

test("a shelf that is on takes back only its own short address, on ryntra.io; every other one still leads into the city", () => {
  const rows = oldAddressRedirects({ condition: { type: "host", value: "app\\.ryntra\\.io" }, origin: "https://ryntra.io" });
  const taken = (ids) => rows.filter((row) => takenByTerminal(row, "open", READY(ids))).map((row) => row.source);
  assert.deepEqual(taken(["swap"]), ["/swap"]);
  assert.deepEqual(taken(["earn"]), ["/earn"]);
  assert.deepEqual(taken(["portfolio"]), ["/portfolio"]);
  assert.deepEqual(taken(["launch"]), ["/launch"]);
  assert.deepEqual(taken(["futures"]), ["/futures"]);
  assert.deepEqual(taken(["predict"]), ["/predictions"], "the old /predict keeps leading to the Oracle");
  assert.deepEqual(taken(["agents"]), [], "/agent never led anywhere; /agents stays the old pages'");
  assert.deepEqual(taken(["market"]), [rows.find((row) => row.source.startsWith("/coin/") && !row.has)?.source].filter(Boolean));
  assert.equal(taken([...SHELF_IDS]).length, 7);
  for (const row of rows.filter((r) => r.has?.some((c) => c.type === "host"))) assert.equal(takenByTerminal(row, "open", READY([...SHELF_IDS])), false, `the app host's own: ${row.source}`);
});

test("the build's redirects give way to the terminal through this registry, and with the switch closed they are the city's own", async () => {
  const config = read("next.config.ts");
  assert.match(config, /oldAddressRedirects\([^)]*\)\s*\.filter\(\(row\) => !takenByTerminal\(row\)\)/);
  assert.match(config, /from "\.\/terminal\/shell\/shelves\.ts"/);
  // The config as each switch builds it: no shelf is ready yet, so every switch leaves the redirects as they were.
  const tables = {};
  for (const value of ["", "stand", "open"]) {
    const code = "const c = (await import('./next.config.ts')).default; const r = await c.redirects(); process.stdout.write(JSON.stringify(r));";
    tables[value] = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: REPO,
      env: { ...process.env, [TERMINAL_FLAG]: value },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const closed = JSON.parse(tables[""]);
  assert.ok(closed.some((row) => row.source === "/swap" && row.destination === "/?open=trade"), "the short /swap still opens the city's trade window");
  if (!SHELF_IDS.some((id) => SHELVES[id].ready)) {
    assert.equal(tables.stand, tables[""], "a stand with no shelf ready redirects as before");
    assert.equal(tables.open, tables[""], "open with no shelf ready redirects as before");
  }
});
