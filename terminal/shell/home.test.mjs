import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TERMINAL_FLAG } from "./flag.ts";
import { asTerminalHome, cityHome, homeAsk, shelfOfWindow, terminalDestination, terminalHomeRedirects, terminalHomeRewrites } from "./home.ts";
import { CITY_PATH, HOME_PAGE, SHELF_IDS, SHELVES } from "./shelves.ts";

/* The terminal as the home page: one switch turns `/` into the Market and every old address into its section, in one
   hop; the same switch closed leaves the city's home and its table exactly as they were. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const READY = (ids) => Object.fromEntries(SHELF_IDS.map((id) => [id, { ...SHELVES[id], ready: ids.includes(id) }]));
const BUILT = READY(SHELF_IDS.filter((id) => SHELVES[id].ready));

/** The build's config as one switch builds it. */
function built(value) {
  const code =
    "const c = (await import('./next.config.ts')).default; const r = await c.redirects(); const w = await c.rewrites(); process.stdout.write(JSON.stringify({ r, w }));";
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: REPO, env: { ...process.env, [TERMINAL_FLAG]: value }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  );
}

const closed = built("");
const open = built("open");
const plain = (rows) => rows.filter((row) => !row.has);

test("closed: `/` is the city, nothing is rewritten, no row of the terminal's home", () => {
  assert.deepEqual(terminalHomeRedirects("closed"), []);
  assert.deepEqual(terminalHomeRewrites("closed"), []);
  assert.equal(homeAsk("?open=trade", "closed"), null);
  assert.equal(cityHome("closed"), "/");
  assert.ok(!closed.w.beforeFiles.some((row) => row.source === "/"), "the city's home stands at /");
  assert.ok(plain(closed.r).some((row) => row.source === CITY_PATH && row.destination === "/"), "the short /city still leads to the city at /");
  assert.ok(plain(closed.r).some((row) => row.source === "/app/swap/:path*" && row.destination === "/?open=trade"));
  assert.ok(!closed.r.some((row) => row.source === "/c/:mint([1-9A-HJ-NP-Za-km-z]{32,44})"), "a coin's link is the city's own page");
  const rows = [{ source: "/app/x", destination: "/?open=trade", permanent: true }];
  assert.deepEqual(asTerminalHome(rows, "closed", BUILT), rows);
});

test("open: `/` answers with the Market's page, `/market` leads back to `/`, the city stands at `/city`", () => {
  assert.deepEqual(open.w.beforeFiles.filter((row) => !row.has), [{ source: "/", destination: HOME_PAGE }]);
  assert.ok(plain(open.r).some((row) => row.source === HOME_PAGE && row.destination === "/" && !row.permanent));
  assert.ok(!plain(open.r).some((row) => row.source === CITY_PATH), "nothing leads /city away: the city is there");
  assert.equal(cityHome("open", BUILT), CITY_PATH);
  assert.match(read("app/city/page.tsx"), /<CityApp initial=\{BUNDLED_CITY\} \/>/, "the city's page at /city is the city as it was");
});

test("open: every old address leads to a section in one hop, never back to the city's home ask", () => {
  const rows = plain(open.r);
  const at = (source) => rows.find((row) => row.source === source)?.destination;
  assert.equal(at("/app/swap/:path*"), "/swap");
  assert.equal(at("/app/earn/:path*"), "/earn");
  assert.equal(at("/app/portfolio/:path*"), "/portfolio");
  assert.equal(at("/app/launch/:path*"), "/launch");
  assert.equal(at("/app/bots/:path*"), "/agent");
  assert.equal(at("/app/ryn/:path*"), "/agent");
  assert.equal(at("/app/bridge/:path*"), "/swap");
  assert.equal(at("/app/send/:path*"), "/portfolio");
  assert.equal(at("/app/:path*"), "/");
  assert.equal(at("/c/:mint([1-9A-HJ-NP-Za-km-z]{32,44})"), "/coin/:mint");
  assert.equal(at(`/app/token/:mint([1-9A-HJ-NP-Za-km-z]{32,44})`), "/coin/:mint");
  assert.equal(at("/launches"), "/launch");
  assert.equal(at("/map"), CITY_PATH);
  assert.ok(open.r.some((row) => row.source === CITY_PATH && row.has && row.destination === `https://ryntra.io${CITY_PATH}`), "the app host's /city opens the city");
  // A coin named in the query of an old address: its screen.
  assert.ok(open.r.some((row) => row.source === "/app/spot" && row.destination === "/coin/:mint"));
  // Futures and Predictions have no shelf yet: their addresses keep opening the city's windows, never a 404.
  for (const source of ["/futures", "/perps", "/exchange", "/app/perps/:path*"]) assert.equal(at(source), SHELVES.futures.ready ? "/futures" : "/city?open=exchange", source);
  for (const source of ["/predictions", "/oracle", "/predict/:path*"]) assert.equal(at(source), SHELVES.predict.ready ? "/predictions" : "/city?open=oracle", source);
  assert.equal(at("/predict/:eventId"), SHELVES.predict.ready ? "/predictions" : "/city?open=oracle&market=:eventId");
  assert.equal(at("/rewards"), "/city?open=hall", "Rewards stay the city's");
  for (const row of open.r) {
    assert.ok(!/^(https:\/\/ryntra\.io)?\/\?open=/.test(row.destination), `${row.source} still asks the city's home: ${row.destination}`);
  }
  // One hop: a plain destination is never itself the source of another plain row.
  const sources = new Set(rows.map((row) => row.source));
  for (const row of rows) {
    const path = row.destination.split("?")[0];
    if (path.startsWith("/") && path !== row.source) assert.ok(!sources.has(path), `${row.source} → ${row.destination} → again`);
  }
  // A row that now leads into the terminal never answers for good.
  for (const row of rows.filter((r) => /^\/(swap|earn|portfolio|launch|agent|coin)(\/|$)/.test(r.destination))) assert.equal(row.permanent, false, row.source);
});

test("the city's windows and Money's tabs: the section that does the same work", () => {
  assert.equal(shelfOfWindow("trade"), "swap");
  assert.equal(shelfOfWindow("money", "bridge"), "swap");
  assert.equal(shelfOfWindow("money", "send"), "portfolio");
  assert.equal(shelfOfWindow("money"), "portfolio");
  assert.equal(shelfOfWindow("agent"), "agents");
  assert.equal(shelfOfWindow("settings"), null);
  assert.equal(terminalDestination("https://ryntra.io/?open=harbor", "open", BUILT), "https://ryntra.io/earn");
  assert.equal(terminalDestination("/docs", "open", BUILT), "/docs");
  assert.equal(terminalDestination("/?open=oracle&page=positions", "open", READY(["market"])), "/city?open=oracle&page=positions");
});

test("a link to the home page that asks for a window or a coin: its section, the rest of the query kept", () => {
  const mint = "So11111111111111111111111111111111111111112";
  assert.deepEqual(homeAsk("?open=trade", "open", BUILT), { path: "/swap", drop: ["open", "tab", "market", "page"] });
  assert.deepEqual(homeAsk("?open=agent", "open", BUILT), { path: "/agent", drop: ["open", "tab", "market", "page"] });
  assert.deepEqual(homeAsk("?open=earn&tab=mine", "open", BUILT), { path: "/earn", drop: ["open", "tab", "market", "page"] });
  assert.deepEqual(homeAsk("?open=hall", "open", BUILT), { path: CITY_PATH, drop: [] });
  assert.deepEqual(homeAsk(`?coin=${mint}`, "open", BUILT), { path: `/coin/${mint}`, drop: ["coin"] });
  assert.equal(homeAsk("?coin=nope", "open", BUILT), null);
  assert.equal(homeAsk("?invite=ABC", "open", BUILT), null, "an invitation lands on the Market");
  const mw = read("middleware.ts");
  assert.match(mw, /homeAsk\(request\.nextUrl\.search\)/);
  assert.match(mw, /\{ source: "\/", has: \[\{ type: "query", key: "open" \}\] \}/);
  assert.match(mw, /\{ source: "\/", has: \[\{ type: "query", key: "coin" \}\] \}/);
});
