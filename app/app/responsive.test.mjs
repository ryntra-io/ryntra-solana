import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
/* Comments blanked, their newlines kept, so a rule is never read out of prose about a rule. */
const css = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
/* The bodies of every at-rule whose condition matches, braces counted so a nested rule cannot end one early. */
function queries(source, condition) {
  const bodies = [];
  for (let head = source.indexOf(condition); head !== -1; head = source.indexOf(condition, head + 1)) {
    const start = source.indexOf("{", head);
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(source.slice(start + 1, i));
          break;
        }
      }
    }
  }
  assert.notEqual(bodies.length, 0, `no at-rule ${condition}`);
  return bodies;
}

/** The one body of a condition written once, or the bodies joined where a stylesheet writes it more than once. */
const query = (source, condition) => queries(source, condition).join("\n");

/**
 * The web on a phone and on a laptop, without one thing lying over another.
 *
 * Three of the four rules here can only be seen with eyes on a device, which is why they are written down: the bar that
 * steps aside while a person types, the phone turned on its side, and a loading block the height of what will stand in
 * it. Each is a rule in a stylesheet a later change can quietly undo, and each undoing shows up as a person typing a
 * sum they cannot see, or a page dropping a screen's worth under their thumb.
 */

test("the bar steps aside while a person types, and the page takes its row back", () => {
  const frame = css("app/app/frame.css");
  const typing = query(frame, "@media (max-width: 1023px)");
  /* Not the first `@media (max-width: 1023px)` of the file — the bar's own — so read the block that names typing. */
  const blocks = frame.split("@media (max-width: 1023px)").slice(1);
  const band = blocks.find((block) => block.includes('data-typing="true"'));
  assert.ok(band, "no rule hides the bar while a field has the focus");
  assert.match(band, /\[data-typing="true"\][^{]*\.ryntra-shell__bar\s*\{[^}]*display:\s*none/);
  /* With no bar drawn, nothing is pinned above one: a page's action comes down to the bottom of the screen. */
  assert.match(band, /\[data-typing="true"\][\s\S]*?--shell-bottom:\s*env\(safe-area-inset-bottom/);
  assert.match(band, /\[data-typing="true"\][\s\S]*?\.ryntra-shell__main\s*\{[^}]*padding-bottom:\s*var\(--shell-bottom\)/);
  assert.ok(typing.length > 0);
});

test("the attribute the frame reads is the one the hook writes", () => {
  const frame = read("app/app/frame.css");
  const hook = read("app/app/typing.ts");
  assert.match(hook, /TYPING_ATTRIBUTE\s*=\s*"data-typing"/);
  assert.match(hook, /setAttribute\(TYPING_ATTRIBUTE/);
  assert.match(hook, /removeAttribute\(TYPING_ATTRIBUTE\)/);
  assert.ok(frame.includes('data-typing="true"'), "the stylesheet reads another name than the hook writes");
  /* Written on the document, which is what the stylesheet's selector starts from. */
  assert.match(hook, /const root = document\.documentElement/);
  /* And hung on the frame once, for every page of the cabinet. */
  assert.match(read("app/app/product-shell.tsx"), /useTypingOnPhone\(\);/);
});

test("the browser's own scroll to a field clears the bar", () => {
  const globals = css("app/globals.css");
  const band = query(globals, "@media (max-width: 1023px)");
  assert.match(band, /scroll-padding-bottom:\s*calc\(var\(--sol-phonebar-h,\s*0px\)\s*\+\s*16px\)/);
  /* A page with no bar of its own still gets the breath, never an invalid length that drops the whole declaration. */
  assert.match(band, /--sol-phonebar-h,\s*0px/);
});

test("a phone on its side gives the row the bar took to the page", () => {
  const frame = css("app/app/frame.css");
  const band = query(frame, "@media (orientation: landscape) and (max-height: 500px)");
  /* 121 px of 390 went to the header and the bar. The bar goes — the menu is the header's ☰ below a desk — and the
     header draws itself one touch row tall. */
  assert.match(band, /\.ryntra-shell__bar\s*\{[^}]*display:\s*none/);
  assert.match(band, /--ryntra-size-header:\s*44px/);
  assert.match(band, /--shell-bottom:\s*env\(safe-area-inset-bottom/);
  /* And nothing else: at 844 px the network's plate already stands in the header, and on a phone narrower than 768 in
     landscape its line stays rather than crowding a header that cannot hold it. */
  assert.doesNotMatch(band, /ryntra-header__network|ryntra-shell__network/);
  const taken = 44;
  assert.ok(taken < 56 + 65, "a short landscape screen must give back more than it keeps");
});

test("what the product pins itself comes down with the bar, by the bar's own name", () => {
  const frame = css("app/app/frame.css");
  /* `--sol-phonebar-h` is «the height of the bottom bar as drawn», and the pages pin their own things above it by that
     name: Spot's «Купити | Продати», the four actions of «Гроші», a notice, the assistant's field. Where the bar is not
     drawn the name must say zero, or they hover a row above nothing — which is what a phone narrower than 768 px turned
     on its side did (667×375, 568×320): the bar gone and the trade bar still 65 px up, a fifth of a 320 px screen. */
  const blocks = frame.split("@media (max-width: 1023px)").slice(1);
  const typing = blocks.find((block) => block.includes('data-typing="true"'));
  assert.match(typing, /html\[data-typing="true"\]\s*\{[^}]*--sol-phonebar-h:\s*0px/);
  const land = query(frame, "@media (orientation: landscape) and (max-height: 500px)");
  assert.match(land, /html:has\(\.ry-product\[data-solana-app="true"\]\)\s*\{[^}]*--sol-phonebar-h:\s*0px/);
  /* Named on the document, because the browser's own scroll padding is written there and reads it. */
  assert.match(css("app/globals.css"), /scroll-padding-bottom:\s*calc\(var\(--sol-phonebar-h/);
  /* And the one place that declares its standing height is still the document's root, not a page. */
  assert.match(frame, /:root \{ --sol-phonebar-h: 65px; \}/);
});

test("the header's height has one name, not two that can drift", () => {
  const frame = css("app/app/frame.css");
  /* The core sizes its header with `--ryntra-size-header` and never declares `--ryntra-header-height`; the product's
     stylesheets ask for the second. Tied, or the landscape header is 44 px and everything hung under it still at 56. */
  assert.match(frame, /--ryntra-header-height:\s*var\(--ryntra-size-header\)/);
  for (const path of ["app/app/frame.css", "app/app/form-pair.module.css", "app/app/ryn/trade-plan.module.css"]) {
    assert.ok(read(path).includes("--ryntra-header-height"), path);
  }
});

test("a loading page keeps the geometry of the page that is coming", () => {
  const bones = read("app/app/bones.tsx");
  const sheet = css("app/app/bones.module.css");
  /* The core's own page and block: their padding, gaps and frames are the loaded page's, not an imitation. */
  assert.match(bones, /from "@ryntra\/core\/ui"/);
  assert.match(bones, /<Page\b/);
  assert.match(bones, /<Block\b/);
  /* The heading's place is its own line tall, and a block's head its word's line: nothing moves when the words come. */
  assert.match(sheet, /\.title\s*\{[^}]*height:\s*var\(--ryntra-type-h1-line\)/);
  assert.match(sheet, /\.blockTitle\s*\{[^}]*height:\s*var\(--ryntra-type-ui-line\)/);
  /* No length of its own: every height is the token the loaded page reads. */
  const heights = [...sheet.matchAll(/\bheight:\s*([^;]+);/g)].map(([, value]) => value.trim());
  assert.ok(heights.length > 0);
  for (const value of heights) assert.match(value, /var\(--ryntra-/, `a loading block's height is its own guess: ${value}`);
});

test("the cabinet's loading page is a shape, not a sentence", () => {
  for (const path of ["app/app/loading.tsx", "app/app/portfolio/loading.tsx"]) {
    const page = read(path);
    assert.match(page, /<PageBones\b/, path);
    /* «Loading…» as the whole page is what this replaced: the word stays, for a screen reader, as the bones' label. */
    assert.match(page, /label=/, path);
    assert.doesNotMatch(page, /<p[^>]*>\{/, path);
  }
});

test("Spot's bones name the height of the face that is coming", () => {
  const page = read("app/solana/workspace/spot/spot-workspace.tsx");
  const sheet = css("app/solana/workspace/spot/spot.module.css");
  /* The pending face has a class of its own; it used to borrow the desk's and draw twelve bars of text. */
  assert.match(page, /className=\{phone === null \? styles\.pending :/);
  assert.match(page, /styles\.bonesChart/);
  assert.doesNotMatch(page, /<Skeleton lines=\{12\}/, "twelve bars of text are not a chart's height");
  /* A desk: the terminal's own height, from the property the terminal reads. */
  assert.match(sheet, /\.bonesChart\s*\{[^}]*height:\s*var\(--spot-terminal-h,/);
  assert.match(sheet, /\.terminal\s*\{[\s\S]{0,200}?height:\s*var\(--spot-terminal-h,/);
  /* A phone: the chart's own height, from the property the chart reads, at the same 760 px the faces are chosen by. */
  const narrow = query(sheet, "@container spot (max-width: 759px)");
  assert.match(narrow, /\.bonesChart\s*\{[^}]*height:\s*var\(--spot-phone-fit,\s*200px\)/);
  assert.match(narrow, /--spot-chart-h:\s*var\(--spot-phone-fit,\s*200px\)/);
  assert.match(page, /getBoundingClientRect\(\)\.width < 760/, "the faces and the bones must part at the same width");
  /* And the chart's own waiting state already stands at the chart's height — asserted so it stays that way. */
  assert.match(sheet, /\.chartState\s*\{[\s\S]{0,160}?height:\s*var\(--spot-chart-h\)/);
});

test("a panel never grows taller than the screen it stands on", () => {
  const hook = read("app/components/chart/use-fit-height.ts");
  /* The floor gives way to the room: a `min` written for a desk is what made a phone on its side overflow. */
  assert.match(hook, /export function fitHeight\(/);
  assert.match(hook, /Math\.min\(min, Math\.max\(FIT_FLOOR_PX, room\)\)/);
  assert.match(hook, /fitHeight\(\{ innerHeight: window\.innerHeight/);
});
