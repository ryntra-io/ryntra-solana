import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCityMetadata } from "../../../app/seo.ts";
import { CITY_NEVER, CITY_RULES, DISTRICT_WORDS, HOW_LEAD, RUN_RULE } from "./districts.ts";
import {
  CARD_DISTRICTS,
  CARD_SIZES,
  DESK_MEDIA,
  DISTRICT_FILMS,
  DISTRICT_IDS,
  DISTRICT_WIDTHS,
  districtFrame,
  INTRO,
  INTRO_FADE_MS,
  introFrame,
  introMotion,
  introSizes,
  OG_CARD,
  PHONE_MEDIA,
  pick,
  playsFilm,
  skylineReady,
  srcSet,
} from "./frames.ts";

/* CITY-64: the city's still frames — which one a screen gets, how the intro moves (and stands still for reduced
   motion), the district frames and their words, and the share card of `/`. */

const PUBLIC = new URL("../../../public", import.meta.url);
const read = (src) => readFileSync(new URL(`.${src}`, `${PUBLIC.href}/`));
const css = (name) => readFileSync(new URL(`../../components/art/${name}`, import.meta.url), "utf8");
const source = (name) => readFileSync(new URL(`../../components/art/${name}`, import.meta.url), "utf8");

/** The pixel size a WebP or JPEG file says it has. */
function size(bytes) {
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = bytes.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i < bytes.length; ) {
      const marker = bytes[i + 1];
      const length = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
      i += 2 + length;
    }
  }
  throw new Error("not a WebP or JPEG");
}

/** A screen's answer to the two media queries the page uses (`[not all and ](min|max-aspect-ratio: a/b)`). */
function matches(query, { width, height }) {
  const m = /^(not all and )?\((min|max)-aspect-ratio: (\d+)\/(\d+)\)$/.exec(query);
  assert.ok(m, `a query this test can read: ${query}`);
  const ratio = width / height;
  const bound = Number(m[3]) / Number(m[4]);
  const hit = m[2] === "min" ? ratio >= bound : ratio <= bound;
  return m[1] ? !hit : hit;
}

const SCREENS = [
  { name: "laptop 1440 × 900", width: 1440, height: 900, dpr: 1 },
  { name: "laptop 1440 × 900 @2", width: 1440, height: 900, dpr: 2 },
  { name: "short desk window 1440 × 600", width: 1440, height: 600, dpr: 1 },
  { name: "ultrawide 2560 × 1080", width: 2560, height: 1080, dpr: 1 },
  { name: "phone 390 × 844 @3", width: 390, height: 844, dpr: 3 },
  { name: "small phone 360 × 740 @2", width: 360, height: 740, dpr: 2 },
  { name: "tablet upright 820 × 1180 @2", width: 820, height: 1180, dpr: 2 },
  { name: "phone on its side 844 × 390 @3", width: 844, height: 390, dpr: 3 },
  { name: "square 1000 × 1000", width: 1000, height: 1000, dpr: 1 },
  { name: "just wider than square 1001 × 1000", width: 1001, height: 1000, dpr: 1 },
  { name: "a hair wider than square 1201 × 1200", width: 1201, height: 1200, dpr: 1 },
  { name: "a hair wider than square 1441 × 1440", width: 1441, height: 1440, dpr: 2 },
];

test("a screen as tall as it is wide or taller gets the tall phone frame; a wider one the 21:9 desk frame", () => {
  const kinds = Object.fromEntries(SCREENS.map((s) => [s.name, introFrame(s).kind]));
  assert.deepEqual(kinds, {
    "laptop 1440 × 900": "desk",
    "laptop 1440 × 900 @2": "desk",
    "short desk window 1440 × 600": "desk",
    "ultrawide 2560 × 1080": "desk",
    "phone 390 × 844 @3": "phone",
    "small phone 360 × 740 @2": "phone",
    "tablet upright 820 × 1180 @2": "phone",
    "phone on its side 844 × 390 @3": "desk",
    "square 1000 × 1000": "phone",
    "just wider than square 1001 × 1000": "desk",
    "a hair wider than square 1201 × 1200": "desk",
    "a hair wider than square 1441 × 1440": "desk",
  });
});

test("the frame covers the screen, so it is fetched as wide as it is drawn — never a blurred upscale where a wider file exists", () => {
  // 1440 × 900 draws the 21:9 still 900 × 2.33 = 2100 px wide: the 2560 file, not the 1440 one.
  assert.equal(introFrame({ width: 1440, height: 900, dpr: 1 }).file.src, "/city/art/intro-desk-2560.webp");
  // A short window draws it 1440 wide: the lighter file is enough.
  assert.equal(introFrame({ width: 1440, height: 600, dpr: 1 }).file.src, "/city/art/intro-desk-1440.webp");
  // A phone has one tall file, whatever its pixel ratio.
  assert.equal(introFrame({ width: 390, height: 844, dpr: 3 }).file.src, "/city/art/intro-phone-1080.webp");
  assert.equal(introFrame({ width: 360, height: 740, dpr: 1 }).file.src, "/city/art/intro-phone-1080.webp");
  // Wider than the widest file: the widest.
  assert.equal(pick(INTRO.desk.files, 9000).width, 2560);
  assert.equal(pick(INTRO.desk.files, 1).width, 1440);
});

test("the page's media queries pick the same frame as the rule, and never both: one preload, one fetch", () => {
  for (const s of SCREENS) {
    const phone = matches(PHONE_MEDIA, s);
    const desk = matches(DESK_MEDIA, s);
    assert.notEqual(phone, desk, `${s.name}: exactly one of the two queries matches`);
    assert.equal(phone ? "phone" : "desk", introFrame(s).kind, s.name);
  }
});

test("`sizes` says the width the covering frame is drawn at: max(100vw, the frame's shape × 100vh)", () => {
  for (const kind of ["desk", "phone"]) {
    const m = /^max\(100vw, ([\d.]+)vh\)$/.exec(introSizes(kind));
    assert.ok(m, introSizes(kind));
    assert.ok(Math.abs(Number(m[1]) / 100 - INTRO[kind].ratio) < 0.001, `${kind}: ${m[1]}vh`);
  }
  assert.equal(srcSet(INTRO.desk), "/city/art/intro-desk-1440.webp 1440w, /city/art/intro-desk-2560.webp 2560w");
  assert.equal(srcSet(INTRO.phone), "/city/art/intro-phone-1080.webp 1080w");
});

test("every intro file is in public/ at the width its `w` descriptor claims, and the frame's shape is the files' own", () => {
  for (const kind of ["desk", "phone"]) {
    for (const file of INTRO[kind].files) {
      const px = size(read(file.src));
      assert.equal(px.width, file.width, file.src);
      assert.ok(Math.abs(px.width / px.height - INTRO[kind].ratio) < 0.01, `${file.src}: ${px.width} × ${px.height}`);
    }
  }
});

test("with reduced motion the intro stands still: no push in, no flicker, no film, the city in its place at once", () => {
  const still = { drift: false, glints: 0, fadeMs: 0, film: false };
  assert.deepEqual(introMotion({ reduced: true, saveData: false }, true), still);
  assert.deepEqual(introMotion({ reduced: true, saveData: true }, true), still);
  assert.deepEqual(introMotion({ reduced: true, saveData: false }, false), still);
  // Full motion: the film on a wide screen only — it is the desk still's shape.
  assert.deepEqual(introMotion({ reduced: false, saveData: false }, true), { drift: true, glints: 2, fadeMs: INTRO_FADE_MS, film: true });
  assert.deepEqual(introMotion({ reduced: false, saveData: false }, false), { drift: true, glints: 2, fadeMs: INTRO_FADE_MS, film: false });
  // Saving data: the CSS motion costs no bytes and stays; the film does not play.
  assert.deepEqual(introMotion({ reduced: false, saveData: true }, true), { drift: true, glints: 2, fadeMs: INTRO_FADE_MS, film: false });
});

test("a film plays only for a visitor who asked for neither less motion nor less data", () => {
  assert.equal(playsFilm({ reduced: false, saveData: false }), true);
  assert.equal(playsFilm({ reduced: true, saveData: false }), false);
  assert.equal(playsFilm({ reduced: false, saveData: true }), false);
  assert.equal(playsFilm({ reduced: true, saveData: true }), false);
});

test("the films are in public/, WebM first and MP4 for the rest, and their districts have frames", () => {
  for (const film of Object.values(DISTRICT_FILMS)) {
    assert.equal(read(film.webm).toString("hex", 0, 4), "1a45dfa3", `${film.webm} is WebM`);
    assert.equal(read(film.mp4).toString("ascii", 4, 8), "ftyp", `${film.mp4} is MP4`);
  }
  // No generated film of a city that is not ours.
  assert.deepEqual(Object.keys(DISTRICT_FILMS), []);
  for (const file of ["HowItWorks.tsx"]) {
    const code = source(file);
    const webm = code.indexOf('type="video/webm"');
    const mp4 = code.indexOf('type="video/mp4"');
    assert.ok(webm > 0 && mp4 > webm, `${file}: the WebM source before the MP4 one`);
    // The films are muted and inline, so a phone plays them without taking over the screen.
    assert.match(code, /<video[\s\S]*?muted[\s\S]*?playsInline/);
  }
});

test("nothing goes before the live city, and the windows stop every motion under prefers-reduced-motion", () => {
  // No generated still or film in front of the city.
  assert.doesNotMatch(source("Intro.tsx"), /<img|<video|<picture/);
  assert.doesNotMatch(source("HowItWorks.tsx"), /IntroStill/);
  // The window: it does not slide in, its chevron does not turn, its films do not play.
  const how = css("how.module.css");
  const howReduced = how.slice(how.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(howReduced, /\.layer,\s*\.page\s*\{\s*animation:\s*none;/);
  assert.match(howReduced, /\.chevron\s*\{\s*transition:\s*none;/);
  assert.match(howReduced, /\.film\s*\{\s*display:\s*none;/);
  const howAnimated = [...how.slice(0, how.indexOf("@media (prefers-reduced-motion")).matchAll(/\.(\w+)\s*\{[^}]*animation:/g)].map((m) => m[1]);
  assert.deepEqual(howAnimated, ["layer", "page"]);
  // The card frames settle without their zoom.
  assert.match(css("art.module.css"), /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.img\s*\{\s*transform:\s*none;/);
});

test("the district cards warm up when the live city is drawn, or when the scene says it is ready", () => {
  assert.equal(skylineReady(false, undefined), false);
  assert.equal(skylineReady(false, null), false);
  assert.equal(skylineReady(false, { ready: false }), false);
  assert.equal(skylineReady(false, { ready: "yes" }), false);
  assert.equal(skylineReady(true, undefined), true);
  assert.equal(skylineReady(false, { ready: true }), true);
});

test("every district has its frame at 800 and 1600 wide, 16:9, and the card asks for the width it is drawn at", () => {
  for (const id of DISTRICT_IDS) {
    const frame = districtFrame(id);
    assert.deepEqual(
      frame.files.map((f) => f.width),
      [...DISTRICT_WIDTHS],
    );
    for (const file of frame.files) {
      const px = size(read(file.src));
      assert.equal(px.width, file.width, file.src);
      assert.ok(Math.abs(px.width / px.height - frame.ratio) < 0.01, file.src);
    }
  }
  assert.equal(CARD_SIZES, "(min-aspect-ratio: 1/1) 420px, calc(100vw - 32px)");
  assert.deepEqual([...CARD_DISTRICTS], ["market", "home", "launch", "harbor", "agents"]);
});

const BANNED = ["moon", "100x", "1000x", "guarantee", "risk-free", "riskless", "get rich", "lambo", "passive income", "can't lose", "can’t lose", "sure thing", "profit", "earn money"];

test("every district says what it is and what you do there, in one or two plain sentences, with no promise of profit", () => {
  assert.deepEqual(Object.keys(DISTRICT_WORDS), [...DISTRICT_IDS]);
  const names = Object.fromEntries(DISTRICT_IDS.map((id) => [id, DISTRICT_WORDS[id].name]));
  assert.deepEqual(names, { market: "Market", launch: "Launch Docks", harbor: "Harbor", agents: "Agents", vault: "Vault", ring: "Ring", home: "Home" });
  const lines = [HOW_LEAD, ...DISTRICT_IDS.flatMap((id) => [DISTRICT_WORDS[id].what, DISTRICT_WORDS[id].doing]), ...CITY_RULES, RUN_RULE, ...CITY_NEVER];
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const word of BANNED) assert.ok(!lower.includes(word), `«${word}» in: ${line}`);
    // No technical words on a page a person reads.
    assert.doesNotMatch(lower, /\b(engine|api|endpoint|route|id|mint address|rpc|json|version)\b/, `a technical word in: ${line}`);
    assert.ok(!line.includes("!"), `no exclamation: ${line}`);
    assert.ok(/[.:]$/.test(line), `a whole sentence: ${line}`);
    assert.ok((line.match(/[.](\s|$)/g) ?? []).length <= 2, `at most two sentences: ${line}`);
  }
});

test("the share card of `/` is the 1200 × 630 still, for Open Graph and X alike", () => {
  assert.deepEqual(size(read(OG_CARD.src)), { width: 1200, height: 630 });
  const meta = buildCityMetadata();
  const og = meta.openGraph.images[0];
  assert.deepEqual({ url: og.url, width: og.width, height: og.height }, { url: "https://ryntra.io/city/art/og-1200x630.jpg", width: 1200, height: 630 });
  assert.equal(meta.twitter.card, "summary_large_image");
  assert.deepEqual(meta.twitter.images, ["https://ryntra.io/city/art/og-1200x630.jpg"]);
});
