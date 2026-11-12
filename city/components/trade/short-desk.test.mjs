// Run from repo root: node --test city/components/trade/short-desk.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/* CITY-239: the tower's ticket on a desk 900 px tall. The window opens 640 px tall where the screen has room and 615 px
   on a 900 px screen; the ticket was drawn for 640. There the «You get about» figure went under the pinned dock, the
   dock took it in with its label and grew over half of the row that names it. The ticket's rows stand closer on a
   short screen, by more than the window lost. Layout only: no figure, no rule of the ticket changes. */

const css = readFileSync(new URL("./trade.module.css", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of a block that starts at `open` (an at-rule's or a rule's header), braces balanced. */
function block(text, open) {
  const at = text.indexOf(open);
  assert.ok(at >= 0, `no «${open}»`);
  const start = text.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return text.slice(start + 1, i);
  }
  throw new Error(`«${open}» never closes`);
}

const px = (text, selector, property) => {
  const found = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.\\]/g, "\\$&")} \\{[^}]*?\\n\\s*${property}: (\\d+)px;`, "u").exec(text);
  assert.ok(found, `${selector} { ${property} }`);
  return Number(found[1]);
};

test("on a short desk the ticket beside the chart stands closer, by more than the window lost", () => {
  const short = block(css, "@media (max-height: 940px) and (pointer: fine)");
  const wide = block(short, "@container window (min-width: 760px)");
  // What each row gives back, against its own figure in the ticket's plain rules.
  const gains = [
    px(css, ".amount", "height") - px(wide, ".spotTicket .amount", "height"),
    px(css, ".share", "height") - px(wide, ".spotTicket .share", "height"),
    px(css, ".slider", "height") - px(wide, ".spotTicket .slider", "height"),
    px(css, ".sides", "margin-top") - px(wide, ".spotTicket .sides", "margin-top"),
    // Two rows of the market ticket: «You pay» and «You get about».
    2 * (px(css, ".row", "margin-top") - px(wide, ".spotTicket .row", "margin-top")),
    px(css, ".get", "margin-top") - px(wide, ".spotTicket .get", "margin-top"),
  ];
  for (const gain of gains) assert.ok(gain > 0, `every row gives a little: ${gains}`);
  const given = gains.reduce((sum, gain) => sum + gain, 0);
  // The window: 640 px by its own size (TradeLayer), 615 px on a 900 px screen — measured on the stand. Since CITY-242
  // its first size follows the screen (`firstSize`): on a 900 px desk it is the workspace's whole height, more room than
  // the 615 px these rows were tightened for, which they keep for a window the person made shorter.
  const layer = readFileSync(new URL("./TradeLayer.tsx", import.meta.url), "utf8");
  assert.match(layer, /id: 'spot',[^\n]*size: spotSize/u);
  assert.match(layer, /firstSize\(viewport, SPOT_WIDTHS, SPOT_HEIGHT\)/u);
  assert.ok(given >= 640 - 615 + 8, `${given} px given back for the 25 px the window lost, with room to spare`);
  // A pointer's screen only: what a finger presses on a tablet keeps its 44 px. Under a pointer the chips stay 40 px.
  assert.ok(px(wide, ".spotTicket .share", "height") >= 40 && px(wide, ".spotTicket .amount", "height") >= 56);
});

test("only the ticket beside the chart, only on a short screen", () => {
  const short = block(css, "@media (max-height: 940px) and (pointer: fine)");
  const wide = block(short, "@container window (min-width: 760px)");
  // Nothing in the short-screen rule stands outside the wide window's own query: a phone's sheet is never «wide».
  assert.equal(short.replace(/@container window \(min-width: 760px\) \{/u, "").replace(wide, "").replace(/[\s}]/g, ""), "");
  for (const rule of wide.matchAll(/([^{}]+)\{/gu)) assert.match(rule[1].trim(), /^\.spotTicket(:has\(\.priceField\))?( \.\w+(:has\(\.\w+\))?)+$/u, "each rule names a piece of the ticket's column");
  // The dock's own «you get» line and the rule that drops its label are as they were (CITY-189, CITY-221).
  const dock = readFileSync(new URL("./DockGet.tsx", import.meta.url), "utf8");
  assert.match(dock, /const hidden = at\.top < seen\.top - 2 \|\| at\.bottom > floor \+ 2;/u);
  assert.match(dock, /\{!bare && <span className=\{s\.label\}>\{label\}<\/span>\}/u);
});

/* CITY-240: Limit and Stop on the same desk. They have a price row and its field more than Market, and Stop's dock
   holds two lines of terms. Measured on the stand at 1440×900 with the rules of CITY-239 — the column is 493 px:
   - Stop reached its price field's lower edge at 380 px and its dock took 127 px: the field was cut by 14 px before
     any scroll;
   - with a price typed the price's row takes a second line («5% above») — 402 px — and the dock takes in the «you
     get» line — 163 px: the field stood under the dock, 72 px short;
   - Limit reached its «You get» row at 426 px with a dock of 106 px: the row stood under the dock, 39 px short. */
test("on a short desk a Stop ticket's price field stands whole above the dock, also with a price typed", () => {
  const short = block(css, "@media (max-height: 940px) and (pointer: fine)");
  const wide = block(short, "@container window (min-width: 760px)");
  const ticket0 = readFileSync(new URL("./SpotTicket.tsx", import.meta.url), "utf8");
  // What CITY-239's rules had already set; the rest is read against the ticket's plain rules.
  const was = { sides: 10, row: 12, slider: 36 };
  const rows =
    px(css, ".modes", "margin-top") - px(wide, ".spotTicket .modes", "margin-top") +
    (was.sides - px(wide, ".spotTicket .sides", "margin-top")) +
    // Two rows stand over the field: «You pay» and the price's own.
    2 * (was.row - px(wide, ".spotTicket .row", "margin-top")) +
    (px(css, ".priceField", "margin-top") - px(wide, ".spotTicket .priceField", "margin-top")) +
    (px(css, ".priceField", "height") - px(wide, ".spotTicket .priceField", "height"));
  // Where the ticket has a price field the fine slider gives way: its row and its gap. The four shares above it do
  // its job — «25%», «50%», «75%», «Max» — and Market, which has the room, keeps the slider.
  assert.match(wide, /\.spotTicket:has\(\.priceField\) \.slider \{\s*display: none;\s*\}/u);
  const size = was.slider + px(css, ".size", "gap") + (px(css, ".size", "gap") - px(wide, ".spotTicket .size", "gap"));
  const dock = px(css, ".dock", "padding-top") - px(wide, ".spotTicket .dock", "padding-top") + (px(css, ".action", "margin-top") - px(wide, ".spotTicket .action", "margin-top")) + (px(css, ".action", "height") - px(wide, ".spotTicket .action", "height"));
  assert.ok(rows + size + dock >= 14 + 4, `${rows} + ${size} + ${dock} px for the 14 px the field was cut by`);
  assert.ok(rows + size + dock >= 72 + 4, `${rows} + ${size} + ${dock} px for the 72 px with a price typed, with room to spare`);
  // A Limit ticket is whole: its «You get» row (a third row) and the dock fit the column.
  const limit = rows + (was.row - px(wide, ".spotTicket .row", "margin-top")) + size + dock;
  assert.ok(limit >= 39 + 4, `${limit} px for the 39 px a Limit ticket was over`);
  // Nothing a pointer presses gets small: the action, the price field, a share and Market's slider keep their room.
  assert.ok(px(wide, ".spotTicket .action", "height") >= 52 && px(wide, ".spotTicket .priceField", "height") >= 44 && px(wide, ".spotTicket .share", "height") >= 40);
  assert.ok(px(wide, ".spotTicket .slider", "height") >= px(css, ".thumb", "height") + 8, "the thumb and its glow fit the slider's row");
  // The dock's own «you get» line is as it was (CITY-189, CITY-221): with it the dock's edge stands on the row it hides.
  assert.doesNotMatch(wide, /dockGet/u);
  // Stop's last row starts under the dock's edge, not across it: 16 px more than a row's own gap, measured.
  assert.ok(Number(/\.spotTicket \.row:has\(\.expiries\) \{\s*margin-top: (\d+)px;/u.exec(wide)?.[1]) >= px(wide, ".spotTicket .row", "margin-top") + 16);
  assert.match(ticket0, /<span className=\{s\.expiries\} role="radiogroup"/u);
  // Limit and Stop are the tickets with a price field; Market has none.
  assert.match(ticket0, /<label className=\{`\$\{s\.priceField\} /u);
  assert.doesNotMatch(readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8"), /s\.priceField/u);
});

test("what a Stop ticket has left scrolls inside the window, under the pinned action — never the window itself", () => {
  // The ticket's own column scrolls; the card around it does not; the dock stays at the column's foot.
  const frames = [...css.matchAll(/@container window \(min-width: 760px\) \{/gu)].map((found) => block(css.slice(found.index), "@container window (min-width: 760px)"));
  const frame = frames.find((body) => /\n\s*\.spotTicket \{/u.test(body));
  assert.ok(frame, "the wide window's own rules");
  assert.match(block(frame, ".spotTicket {"), /min-height: 0;\s+overflow-y: auto;\s+overscroll-behavior: contain;/u);
  assert.match(block(frame, ".sheet.framed:has(.spotGrid)"), /overflow: hidden;/u);
  assert.match(block(css, "\n.dock {"), /position: sticky;\s+bottom: 0;/u);
  // The order's terms and its one action are the dock's, in Limit and in Stop.
  const ticket = readFileSync(new URL("./SpotTicket.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(ticket, /<div className=\{s\.dock\}>\s+\{getFigure && \(\s+<DockGet target=\{getRef\} label=\{t\.youGet\}>[\s\S]*?\{terms\}\s+<SpotNotes problem=\{problem\} notice=\{notice\} \/>\s+<SpotAction/u);
});
