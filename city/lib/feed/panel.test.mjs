import { test } from "node:test";
import assert from "node:assert/strict";

import { feedTakesEscape, hasNews, useFeedPanel, windowCame } from "./panel.ts";

test("the bell: the visit's first events are seen, a newer one lights the dot, opening the panel sees it", () => {
  assert.equal(hasNews(null, 5), false, "nothing is news before the first events settle");
  const panel = useFeedPanel.getState();
  panel.settle(5);
  assert.equal(useFeedPanel.getState().seen, 5);
  useFeedPanel.getState().settle(9);
  assert.equal(useFeedPanel.getState().seen, 5, "settling happens once a visit");
  assert.equal(hasNews(useFeedPanel.getState().seen, 9), true);
  useFeedPanel.getState().toggle(9);
  assert.equal(useFeedPanel.getState().open, true);
  assert.equal(hasNews(useFeedPanel.getState().seen, 9), false);
  useFeedPanel.getState().close();
  assert.equal(useFeedPanel.getState().open, false);
});

test("a card without a spark lets its line run into the spark's column (CITY-200)", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../components/feed/feed.module.css", import.meta.url), "utf8");
  assert.match(css, /\.card:not\(:has\(\.spark\)\) \.line \{\s*grid-column: 2 \/ 4;\s*\}/);
  assert.match(css, /'icon line spark'/, "the spark's column is the line's neighbour it borrows");
  assert.match(css, /\.feed:not\(\[data-open\]\) \.card \.line \{\s*grid-area: line;/, "the collapsed strip keeps its own row");
});

/* CITY-239: the events' panel stayed open under the agent's card (a phone's sheet rose over it) and did not close on
   Escape after the bell's own click. */
test("a window of the frame that comes folds the panel; one that closes, or the same ones in another order, does not", () => {
  assert.equal(windowCame([], ["autopilot"]), true, "the agent's card, opened by a sentence");
  assert.equal(windowCame(["earn"], ["earn", "ring"]), true);
  assert.equal(windowCame(["earn", "ring"], ["ring"]), false, "a window closed");
  assert.equal(windowCame(["earn", "ring"], ["ring", "earn"]), false, "one raised over another: its own tap folds the panel");
  assert.equal(windowCame(["earn"], ["earn"]), false);
  assert.equal(windowCame(["earn"], []), false);
});

test("the bell watches the frame's windows, and Escape closes the panel with the focus still on the bell", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const bell = read("../../components/feed/EventsBell.tsx");
  assert.match(bell, /useWindows\.subscribe\(\(\) => \{\s+const now = ids\(\);\s+if \(windowCame\(before, now\)\) useFeedPanel\.getState\(\)\.close\(\);\s+before = now;/u);
  // The windows the home names itself, as before: one coming folds the panel. Pressed while one is open, the bell's
  // panel stands over it (CITY-242), so nothing is left «open» unseen.
  assert.match(bell, /useEffect\(\(\) => \{\s+if \(hidden\) useFeedPanel\.getState\(\)\.close\(\);\s+\}, \[hidden\]\);/u);
  const feed = read("../../components/feed/LiveFeed.tsx");
  assert.match(feed, /!feedRef\.current\?\.contains\(focus\) && !focus\.closest\('\[data-feed-bell\]'\)\) return;/u, "the bell is the panel's own control");
  assert.match(bell, /data-feed-bell=""/u);
  // «Back» still counts the panel as one layer of its own, over the windows (city/components/hud/useBackLayers.ts).
  assert.match(read("../../components/hud/useBackLayers.ts"), /\{ id: 'feed', open: \(\) => useFeedPanel\.getState\(\)\.open, close: \(\) => useFeedPanel\.getState\(\)\.close\(\) \},\n\];/u);
});

test("Escape is the panel's while it is open and nothing else holds the keyboard; the HUD asks the same rule", async () => {
  const el = (inside) => ({ closest: (selector) => (selector === "[data-feed-bell], #city-feed" && inside ? {} : null) });
  const body = el(false);
  const doc = (focus, modal = false) => ({ body, activeElement: focus, querySelector: (selector) => (selector === '[aria-modal="true"]' && modal ? {} : null) });
  assert.equal(feedTakesEscape(true, doc(body)), true);
  assert.equal(feedTakesEscape(true, doc(null)), true);
  assert.equal(feedTakesEscape(true, doc(el(true))), true, "the bell, or a control inside the panel");
  assert.equal(feedTakesEscape(true, doc(el(false))), false, "the search, a sheet: their own Escape");
  assert.equal(feedTakesEscape(true, doc(body, true)), false, "a modal window over the city owns it");
  assert.equal(feedTakesEscape(false, doc(body)), false, "a closed panel takes nothing");
  const { readFileSync } = await import("node:fs");
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // One press, one layer: the HUD's Escape (a picked pool's card, the Play layer) waits for the next press.
  const hud = read("../../components/hud/Hud.tsx");
  const guard = hud.indexOf("if (feedTakesEscape(useFeedPanel.getState().open, document)) return;");
  assert.ok(guard > 0 && guard < hud.indexOf("if (useCity.getState().selectedId) return useCity.getState().select(null);"));
  // CITY-242: a bell pressed over an open window opens the panel over it — no press is swallowed — and a window coming
  // folds the panel, never a window that was already there.
  const bell = read("../../components/feed/EventsBell.tsx");
  assert.match(bell, /onClick=\{\(\) => \{\s+if \(useCity\.getState\(\)\.sound\) playTick\(\);\s+useFeedPanel\.getState\(\)\.toggle\(newest \?\? 0\);/u);
  assert.match(bell, /useEffect\(\(\) => \{\s+if \(hidden\) useFeedPanel\.getState\(\)\.close\(\);\s+\}, \[hidden\]\);/u);
});

/* CITY-242: opened over the Ring or the bots, the panel was drawn under the window (the HUD's layer is under the
   windows' layer, whatever z-index the panel had inside it). It stands in a layer of its own over the windows. */
test("the bell's panel stands in a layer of its own over the city's windows", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const css = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const z = (file, selector) => Number(new RegExp(`\\n${selector.replace(/[.]/g, "\\$&")} \\{[^}]*z-index: (\\d+);`, "u").exec(css(file))?.[1]);
  const over = z("../../components/feed/feed.module.css", ".over");
  const windows = z("../../components/window/window.module.css", ".layer");
  const hud = z("../../components/hud/hud.module.css", ".layer");
  assert.ok(over > windows && windows > hud, `the panel's layer ${over} over the windows' ${windows} over the HUD's ${hud}`);
  assert.equal(over, z("../../components/quarter/wallet.module.css", ".over"), "beside the wallet's panel");
  const feed = read("../../components/feed/LiveFeed.tsx");
  assert.match(feed, /createPortal\(<div className=\{s\.over\}>\{section\}<\/div>, root\)/u);
  // The HUD no longer hides the panel while a window is open: the person asked for it.
  assert.match(read("../../components/hud/Hud.tsx"), /\{feedOpen && <LiveFeed panel \/>\}/u);
});

/* CITY-240: the panel's heading in Ukrainian read as small letters beside «EVENTS». The wide face has no Cyrillic, so
   «ПОДІЇ» is drawn in the interface face — a narrower cut, five letters that look the same small and capital. */
test("the events' panel is headed in capitals in both languages, and the Ukrainian ones are a size up", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const css = read("../../components/feed/feed.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector) => new RegExp(`\\n${selector.replace(/[.()]/g, "\\$&")} \\{([^}]*)\\}`, "u").exec(css)?.[1] ?? "";
  // Capitals by the heading's own rule, whatever the word is: the title stands inside the kicker.
  assert.match(rule(".kicker"), /text-transform: uppercase;/u);
  assert.doesNotMatch(rule(".panelTitle"), /text-transform/u, "nothing undoes it for the title");
  assert.match(read("../../components/feed/LiveFeed.tsx"), /<span className=\{s\.kicker\}>\s+<BoltGlyph \/>\s+\{panel && <span className=\{s\.panelTitle\}>\{w\.events\}<\/span>\}/u);
  const size = (body) => Number(/font-size: (\d+)px;/u.exec(body)?.[1]);
  const air = (body) => Number(/letter-spacing: ([\d.]+)em;/u.exec(body)?.[1]);
  const uk = rule(".panelTitle:lang(uk)");
  assert.ok(size(uk) > size(rule(".panelTitle")), `Ukrainian ${size(uk)} px over ${size(rule(".panelTitle"))} px`);
  assert.ok(air(uk) > air(rule(".panelTitle")), "and more air between the letters");
  const { FEED } = await import("./words.ts");
  assert.equal(FEED.en.events.toUpperCase(), "EVENTS");
  assert.equal(FEED.uk.events.toLocaleUpperCase("uk"), "ПОДІЇ");
});
