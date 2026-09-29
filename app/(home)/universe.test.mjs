import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";

import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";
import { needsDevelopmentRepository } from "../../lib/development-repository.mjs";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
const manifest = JSON.parse(read("app/(home)/universe-assets.json"));

/*
 * The market universe — the second block of the landing (2026-09-13). What
 * these pin: every asset in orbit is a real market on Spot with its own
 * picture served from this site; the words the Owner gave, in both
 * languages; the honesty and motion rules the scene lives by. The look was
 * checked in a real browser before release.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

test("every picture is a disc: transparent outside the circle, so the scene never has to clip it round", { skip: needsDevelopmentRepository("the icon script scripts/site/fetch-universe-icons.mjs") }, async () => {
  /* A token's plane is split by its ring's plane and Chrome drops the rounded
     clip on a split quad — a square tile came through square at 2560px
     (2026-09-14). The script cuts every tile to a disc; this keeps it so. */
  for (const asset of manifest.assets) {
    const { data, info } = await sharp(new URL(`../../public/site/universe/${asset.icon}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 320);
    const alpha = (x, y) => data[(y * info.width + x) * 4 + 3];
    assert.equal(alpha(0, 0), 0, `${asset.icon}: the corner is transparent`);
    assert.equal(alpha(319, 319), 0, `${asset.icon}: the far corner is transparent`);
    assert.equal(alpha(160, 160), 255, `${asset.icon}: the centre is opaque`);
  }
  assert.match(read("scripts/site/fetch-universe-icons.mjs"), /blend: "dest-in"/, "the script cuts the disc");
});

test("every asset in orbit is a Spot market with a picture of its own on this site", () => {
  assert.equal(manifest.assets.length, 13);
  const symbols = manifest.assets.map((asset) => asset.symbol);
  assert.deepEqual(symbols.slice(0, 8), ["NVDAx", "AAPLx", "TSLAx", "SPYx", "MSFTx", "GOOGLx", "METAx", "AMZNx"], "the eight tokenized stocks come first");
  assert.deepEqual(symbols.slice(8), ["SOL", "JUP", "USDC", "BONK", "PENGU"]);
  for (const asset of manifest.assets) {
    assert.match(asset.mint, BASE58, `${asset.symbol} names its mint`);
    assert.ok(existsSync(new URL(`../../public/site/universe/${asset.icon}`, import.meta.url)), `${asset.symbol}: ${asset.icon} is on this site`);
    assert.match(asset.source, /^https:\/\//, "the picture's origin is recorded");
    assert.match(asset.glow, /^#[0-9A-Fa-f]{6}$/, "the logo's own hue lights it");
    assert.ok([1, 2, 3].includes(asset.ring));
    assert.ok(asset.phase >= 0 && asset.phase < 1);
    assert.ok(["stock", "crypto", "meme"].includes(asset.kind));
    if (asset.kind === "stock") assert.equal(asset.watermark, "xstocks", `${asset.symbol}: the issuer's watermark is flattened`);
  }
  /* The stocks are the inner rings — the picture must read as stocks on Solana. */
  assert.ok(manifest.assets.filter((asset) => asset.kind === "stock").every((asset) => asset.ring <= 2));
  /* No two assets share a phase on the same ring, so none ever sits on another. */
  for (const ring of [1, 2, 3]) {
    const phases = manifest.assets.filter((asset) => asset.ring === ring).map((asset) => asset.phase).sort();
    for (let i = 1; i < phases.length; i++) assert.ok(phases[i] - phases[i - 1] >= 0.15, `ring ${ring} keeps its riders apart`);
  }
});

test("the universe carries the Owner's words in both languages and one real destination", () => {
  for (const locale of ["en", "uk"]) {
    const u = HOMEPAGE_COPY[locale].universe;
    assert.equal(u.titleLines.length, 2);
    assert.ok(u.lead.length <= 130);
    assert.deepEqual(Object.keys(u.kinds).sort(), ["crypto", "meme", "stock"]);
    for (const key of ["eyebrow", "explore", "sceneLabel", "open", "core"]) assert.ok(u[key].length > 2, `${locale}.${key}`);
  }
  assert.deepEqual(HOMEPAGE_COPY.en.universe.titleLines, ["Wall Street closes.", "Solana doesn’t."]);
  assert.equal(HOMEPAGE_COPY.en.universe.eyebrow, "Built on Solana");
  assert.equal(HOMEPAGE_COPY.en.universe.explore, "See the companies");
  assert.deepEqual(HOMEPAGE_COPY.uk.universe.titleLines, ["Волл-стріт закривається.", "Solana — ні."], "the orbit keeps the Owner's line (the Owner's word of 2026-09-26)");
  const words = JSON.stringify([HOMEPAGE_COPY.en.universe, HOMEPAGE_COPY.uk.universe]);
  for (const forbidden of [/\b\d{3,}\+/, /Diamond/i, /RYN token/i, /win[- ]rate/i, /liquidity/i, /guarantee/i]) {
    assert.doesNotMatch(words, forbidden, `the universe must not claim ${forbidden}`);
  }

  const source = withoutComments(read("app/(home)/universe.tsx"));
  assert.match(source, /className=\{styles\.explore\} href=\{localizedPath\("\/app\/markets", locale\)\}/, "«Дивитися компанії» opens Markets, where the companies are, in the page's language");
  /* A company opens its own page, where the purchase from $1 lives (canon v5.5), in the page's language; a coin opens its market in Spot. */
  assert.match(source, /href=\{company \? localizedPath\(`\/app\/stocks\/\$\{asset\.symbol\}`, locale\) : `\/app\/spot\?mint=\$\{asset\.mint\}`\}/);
  assert.match(source, /aria-label=\{`\$\{label\} — \$\{company \? u\.openCompany : u\.open\}`\}/);
  for (const asset of manifest.assets.filter((entry) => entry.kind === "stock")) {
    assert.match(asset.symbol, /^[A-Za-z0-9.]{1,12}$/, `${asset.symbol}: a ticker the company page reads`);
  }
  assert.match(source, /src=\{`\/site\/universe\/\$\{asset\.icon\}`\}/, "pictures are served from this site");
  assert.match(source, /src="\/site\/solana-mark\.svg"/, "the real Solana mark sits in the core");
  assert.doesNotMatch(source, /three|@react-three|framer-motion/, "no library carries the scene");
  assert.match(read("app/(home)/homepage.tsx"), /<Hero locale=\{locale\} \/>\s*<Universe locale=\{locale\} \/>/, "the universe is the second block, after the hero");
});

test("the scene is honest motion: one clock per asset, still under reduced motion, paused off screen, no library", () => {
  const css = read("app/(home)/universe.module.css");
  const source = withoutComments(read("app/(home)/universe.tsx"));
  /* The orbit, the counter-rotation and the depth pass share `--period` and
     the same negative delay, so an asset always faces the reader and is
     small exactly when it is far. */
  assert.match(css, /\.orbiter \{[\s\S]*?animation: orbit var\(--period\) linear infinite;[\s\S]*?animation-delay: calc\(-1 \* var\(--phase\) \* var\(--period\)\);/);
  assert.match(css, /\.token \{[\s\S]*?animation: counter var\(--period\) linear infinite;[\s\S]*?animation-delay: calc\(-1 \* var\(--phase\) \* var\(--period\)\);/);
  assert.match(css, /\.tokenBody \{[\s\S]*?animation: depth var\(--period\) linear infinite;[\s\S]*?animation-delay: calc\(-1 \* var\(--phase\) \* var\(--period\)\);/);
  /* Static fallbacks put every asset at its phase when animations are off. */
  assert.match(css, /transform: rotateZ\(calc\(90deg \+ var\(--phase\) \* 360deg\)\) translateX\(var\(--r\)\);/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important; transition: none !important;/);
  /* Off screen the clocks stop; the reveal and the pause only exist once the script has the section. */
  assert.match(css, /\.universe\[data-js\]:not\(\[data-active\]\) \.orbiter[\s\S]*?animation-play-state: paused;/);
  assert.match(css, /\.universe\[data-js\]:not\(\[data-seen\]\) \.head > \* \{ opacity: 0;/);
  /* The section is transparent over the landing's one ground and carries no
     seam line; the words rise from the scroll where the browser can. */
  assert.match(css, /\.universe \{[\s\S]*?background: transparent;/);
  assert.match(css, /overflow: clip;/);
  assert.doesNotMatch(source, /styles\.seam/);
  /* No light meets the section's top edge: the ember sits low, behind the
     near arcs, and the cool light is centred on the scene. */
  assert.match(css, /\.warm \{[\s\S]*?radial-gradient\(ellipse 46% 20% at 50% 66%/);
  assert.doesNotMatch(css, /at 50% 0%|at 6% 0%|at 94% 0%/, "nothing lights the head of the section");
  assert.match(css, /@supports \(animation-timeline: view\(\)\)[\s\S]*?\.universe\[data-js\] \.head > \* \{ animation: headRise linear both; animation-timeline: view\(\);/);
  assert.match(source, /root\.dataset\.js = "";/);
  assert.match(source, /if \(reduced\.matches\) root\.dataset\.seen = "";/, "reduced motion: simply there");
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /updatePlaybackRate\(0\.3\)/, "a hovered asset slows its own orbit without a jump");
  assert.match(source, /updatePlaybackRate\(1\)/);
  /* Slow: the fastest ring takes over a minute. */
  for (const period of [...source.matchAll(/period: (\d+)/g)].map((match) => Number(match[1]))) assert.ok(period >= 60, "no fast spinning");
  /* Nothing inside the scene carries a filter or a blend: a filtered layer in
     a 3D context rasterises as a rectangle, clips its glow to it and covers
     the ring behind it (seen at 2560px, 2026-09-14). Depth is size and opacity. */
  /* The tooltip lives outside the 3D scene, so its shadow is not part of this. */
  const scene = css.slice(css.indexOf(".scene {"), css.indexOf("/* ── the reveal")).replace(/\.tip \{[^}]*\}/, "");
  assert.doesNotMatch(scene, /filter:|mix-blend-mode:/, "no filter and no blend inside the 3D scene");
  /* Every box-shadow inside the scene is inset; the glows are gradients in
     boxes of their own (the token's `::before`, the `.cool` light behind). */
  for (const match of scene.matchAll(/box-shadow:([^;]*);/g)) {
    for (const part of match[1].split(/,\s*\n/)) assert.match(part.trim(), /^inset /, `an outer shadow inside the scene: ${part.trim()}`);
  }
  assert.match(css, /\.token::before \{[\s\S]*?radial-gradient\(circle at 50% 50%, color-mix\(in srgb, var\(--glow\) 28%, transparent\)/, "the logo's light is a gradient on the token's own plane");
  assert.doesNotMatch(css, /\.tokenEnter::before/, "nothing larger than the disc lives inside the reveal's surface");
  assert.match(css, /@keyframes depth \{\s*0% \{ transform: scale\(var\(--near\)\); opacity: 1; \}\s*50% \{ transform: scale\(var\(--far\)\); opacity: \.58; \}/);
  /* The core is graphite with the network's own light — never an orange disc. */
  assert.match(css, /\.core \{[\s\S]*?radial-gradient\(circle closest-side at 50% 50%, var\(--ry-elevated\) 0%, var\(--ry-midnight\) 58%, black 99%, transparent 100%\)/);
  /* No disc fills its box flat: a 3D-sorted layer paints its own background
     as the whole rectangle. */
  assert.match(css, /\.tokenBody \{[\s\S]*?background: radial-gradient\(circle closest-side, var\(--ry-midnight\) 0%, var\(--ry-midnight\) 99%, transparent 100%\);/);
  assert.match(css, /var\(--ry-sol-violet\)/);
  assert.match(css, /var\(--ry-sol-green\)/);
  const coreBackground = /\.core \{[^}]*?background:([^;]*);/.exec(css)?.[1] ?? "";
  assert.ok(coreBackground.length > 0);
  assert.doesNotMatch(coreBackground, /var\(--ry-iris\)/, "the orange is light, not the core's colour");
});

test("the network's light is canon and projected, and the logos' hues stay out of our palette", { skip: needsDevelopmentRepository("the design system document DESIGN.md") }, () => {
  const canon = read("DESIGN.md");
  const tokens = read("app/design/tokens.css");
  for (const [name, token, value] of [["solana-green", "--ry-sol-green", "#00FFA3"], ["solana-purple", "--ry-sol-purple", "#DC1FFF"], ["solana-violet", "--ry-sol-violet", "#9945FF"]]) {
    assert.match(canon, new RegExp(`${name}: "${value}"`), `${name} is declared by the canon`);
    assert.match(tokens, new RegExp(`${token}: ${value};`), `${name} is projected`);
  }
  /* The per-logo hue reaches the page as an inline variable from the
     manifest — data about a third party's logo, never a stylesheet value. */
  const source = withoutComments(read("app/(home)/universe.tsx"));
  assert.match(source, /"--glow": asset\.glow/);
  assert.doesNotMatch(source, /#[0-9A-Fa-f]{6}\b/, "no hex literal in the component");
  assert.doesNotMatch(read("app/(home)/universe.module.css"), /#[0-9A-Fa-f]{3,8}\b/, "no hex literal in the stylesheet");
});
