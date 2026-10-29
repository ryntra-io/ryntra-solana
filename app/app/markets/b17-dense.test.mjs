// B17 «Ринки щільно» (огляд B13, п. 9): «Ринки» й «Пули» — один ряд вибору (клас · сортування · пошук) без H1 і
// заголовка блоку на екрані, рядок 40 px, шапка таблиці липка; у «Пулах» — «Комісії/TVL 24 год»; слова «Ринків»,
// «Пулів» і «Лаунчу» — людські, без «драбини», «кроку біна», «DAMM v2», «Ще на кривій», «Обслуговування».
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { feeTvl24hPct, catalogRows } from "../../../lib/liquidity/catalog/model.ts";
import { LAUNCH_WORDS } from "../launch/launch-words.ts";
import { MARKETS_WORDS } from "./markets-words.ts";
import { POOLS_WORDS } from "./pools/pools-words.ts";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const SCREENER = read("app/app/markets/markets-screener.tsx");
const SCREENER_CSS = read("app/app/markets/screener.module.css");
const PLACE = read("app/app/markets/markets-place.tsx");
const CATALOG = read("app/app/markets/pools/pools-catalog.tsx");
const CATALOG_PAGE = read("app/app/markets/pools/page.tsx");
const POOLS_CSS = read("app/app/markets/pools/pools.module.css");

/* The engine's words a person does not read on these screens; each with the reason it is out. */
const JARGON = [
  [/драбин/iu, "«драбина» — заявки Ryntra на купівлю нижче ціни"],
  [/ladder/i, "ladder — Ryntra's buy orders under the price"],
  [/крок\S* бін/iu, "«крок біна» — на сторінці пулу «Крок ціни», у каталозі його немає"],
  [/(^|[^а-яіїєґ'])бін(а|ів|и|ах|ам)?([^а-яіїєґ']|$)/iu, "«бін» — внутрішнє слово Meteora"],
  [/bin step/i, "bin step — the engine's word"],
  [/DAMM|DLMM/, "DAMM v2 / DLMM — «плавний» і «покроковий»"],
  [/Ще на кривій|Still on the curve/i, "«Ще на кривій» — «Ще не на біржі»"],
  [/Шлях до DEX/, "«Шлях до DEX» — «До біржі»"],
  [/Обслуговування|Maintaining/, "«Обслуговування» — «Ryntra підтримує»"],
  [/Технічна валідація|technical validation/i, "«Технічна валідація» — «Тест Ryntra»"],
  [/Компаундинг|Compounding/, "«Компаундинг» — «Комісії лягають назад у пул»"],
  [/У тренді|Trending/, "«У тренді» was the day's volume — «Найбільший обсяг»"],
  [/Крива повна|Curve full/i, "«Крива повна» — «Готовий вийти на DEX»"],
  [/Не верифіковано|Найбільший обіг/, "one voice across «Ринки» and «Пули»: «Не перевірено», «Найбільший обсяг»"],
];

test("the words of «Ринки», «Пули» and «Лаунч» carry none of the engine's jargon, in either language", () => {
  for (const [name, words] of [
    ["MARKETS_WORDS", MARKETS_WORDS],
    ["POOLS_WORDS", POOLS_WORDS],
    ["LAUNCH_WORDS", LAUNCH_WORDS],
  ]) {
    for (const [key, pair] of Object.entries(words)) {
      for (const text of [pair.en, pair.uk]) {
        for (const [pattern, why] of JARGON) assert.doesNotMatch(text, pattern, `${name}.${key}: ${why}`);
      }
    }
  }
});

test("the launch's words name the move one way — a DEX, never «біржа» beside it — and a state says what Ryntra does, not that it backs a token", () => {
  for (const [key, pair] of Object.entries(LAUNCH_WORDS)) {
    assert.doesNotMatch(pair.uk, /біржа|біржі|біржу/u, `LAUNCH_WORDS.${key}: «DEX», one word for one thing`);
    assert.doesNotMatch(pair.en, /\ban exchange\b/i, `LAUNCH_WORDS.${key}: «a DEX», one word for one thing`);
  }
  assert.equal(LAUNCH_WORDS.stillOnCurve.uk, "Ще не на DEX");
  assert.equal(LAUNCH_WORDS.state_MAINTAINING.uk, "Ryntra переставляє заявки", "what Ryntra does — never «Ryntra підтримує», read as backing a token");
});

test("«Ринки»: one row of choices — the kind, one select for the order, the filter — and no row of orders under it", () => {
  assert.match(SCREENER, /<div className=\{styles\.toolbar\}>[\s\S]*?className=\{styles\.tabs\}[\s\S]*?<label className=\{styles\.sort\}>[\s\S]*?<select[\s\S]*?<label className=\{styles\.search\}>/);
  assert.doesNotMatch(SCREENER, /styles\.orders/);
  assert.doesNotMatch(SCREENER_CSS, /\.orders\b/);
  assert.doesNotMatch(PLACE, /lead=/, "no slogan under the heading");
  assert.match(SCREENER_CSS, /\.page > :global\(\.ryntra-page__head\) \{\s*position: absolute;/, "the heading is for a screen reader");
  assert.match(SCREENER_CSS, /\.tableBlock > :global\(\.ryntra-block__head\) \{\s*position: absolute;/, "no block title «Усі» under the tab «Усі»");
});

test("«Ринки» and «Пули»: rows of 40 px, a head that sticks under the frame's header on a desk", () => {
  for (const [name, css] of [
    ["screener", SCREENER_CSS],
    ["pools", POOLS_CSS],
  ]) {
    assert.match(css, /\.table td \{\s*height: 40px;/, `${name}: the core's 40`);
    assert.doesNotMatch(css, /\.table td \{\s*height: 56px;/, `${name}: no 56`);
    assert.match(css, /\n\.table \{\s*overflow-x: clip;\s*\}\s*\.table th \{\s*top: var\(--ryntra-size-header, 56px\);/, `${name}: the sticky head — the table clips, never scrolls sideways`);
  }
  assert.match(SCREENER, /<MarketIcon [^>]*size=\{24\}/, "the asset's picture fits the 40 px row");
  assert.match(SCREENER_CSS, /\.star \{[^}]*height: 32px;\s*min-height: 0;/, "the star does not stretch the row to 44");
  assert.match(SCREENER, /data-dense=""\s*className=\{styles\.star\}/, "a desk's dense control: the product's 44 px for a finger is the phone's row, not the desk's");
});

test("«Ринки»: the columns follow the table's own width, so a tab of nine figures never runs past an edge that clips", () => {
  /* Which figures a width keeps is the pure model's, asserted with real widths in `lib/markets/screener-columns.test.mjs`
     (the pair that changes places on a laptop among them). Here: the screener reads its own width to ask, and asks
     before the first paint, so the columns never jump. */
  assert.match(SCREENER, /screenerColumns\(tab, width \?\? SCREENER_DESK_PX\)/);
  assert.match(SCREENER, /new ResizeObserver\(read\)/);
  assert.doesNotMatch(SCREENER, /window\.innerWidth/, "never the window's width");
  assert.match(SCREENER, /typeof window === "undefined" \? useEffect : useLayoutEffect/, "measured before the first paint — no jump");
  /* And the model is asked for the drawn tab, not for a tab it keeps of its own: the table draws what it was given. */
  assert.match(SCREENER, /const \[measure, columns\] = useRoom\(tab\);/);
});

test("«Ринки» on a phone: the asset, its price, its day and the star — nothing cut, a label in words on the name's line", () => {
  assert.match(SCREENER_CSS, /@media \(max-width: 760px\) \{[\s\S]*\.table table \{\s*table-layout: fixed;/);
  assert.match(SCREENER_CSS, /\.flag,\s*\.name\[data-flagged\] \{\s*display: none;/);
  assert.match(SCREENER_CSS, /\.flagLine \{\s*display: block;/);
  assert.match(SCREENER, /<span className=\{styles\.flagLine\}[^>]*>\s*\{first\.short \? \(\s*<>\s*<span aria-hidden="true">\{first\.short\}<\/span>\s*<span className=\{styles\.srOnly\}>\{first\.text\}<\/span>\s*<\/>\s*\) : \(\s*first\.text\s*\)\}/, "the label's own words, not a sign — a shorter phrase of them where the line is short");
  assert.match(SCREENER_CSS, /\.table th,\s*\.table th :global\(\.ryntra-table__sort\) \{\s*white-space: normal;\s*overflow-wrap: anywhere;/, "a head too wide for its column wraps");
});

test("«Пули»: one row of choices, the catalogue's own width decides its columns, «Комісії/TVL 24 год» a column and an order", () => {
  assert.match(CATALOG, /<div className=\{styles\.toolbar\}>[\s\S]*?className=\{styles\.tabs\}[\s\S]*?<label className=\{styles\.sort\}>[\s\S]*?<select[\s\S]*?className=\{styles\.search\}/);
  assert.doesNotMatch(CATALOG, /styles\.orders/);
  assert.match(CATALOG, /const COLUMNS: readonly Column\[\] = \["tvl", "volume24h", "fees24h", "feeTvl", "fee"\];/);
  assert.match(CATALOG, /\{ sort: "feeTvl", word: "sortFeeTvl" \}/);
  assert.doesNotMatch(CATALOG, /sort: "fee", word/, "the highest fee is not an order of the list — it lifts the newest memes");
  assert.match(CATALOG, /new ResizeObserver\(read\)/, "the side column takes part of a desk: the columns follow the catalogue, not the window");
  assert.match(CATALOG, /\{word\("unverifiedShort"\)\}/, "an unverified token is said in words, not a bare «!»");
  assert.match(CATALOG_PAGE, /className=\{styles\.catalogPage\}/);
  /* SOL-C17, «Реєстр зайвого» M9-money: the rule now holds on a pool's own
     page too. It kept the card «as the place its positions will stand» — a
     place for nothing beside a column of real figures, and a second
     «Підключити гаманець» under the page's first one. */
  assert.match(POOLS_CSS, /\.catalogPage :global\(\.ryntra-page__aside\):has\(\[data-pools-guest\]\),\s*\.page :global\(\.ryntra-page__aside\):has\(\[data-pools-guest\]\) \{\s*display: none;/, "a guest's empty side column gives its width to the content, on both pages");
  assert.match(read("app/app/markets/pools/my-positions.tsx"), /data-pools-guest=""/, "one rule, whichever page the column stands on");
  assert.doesNotMatch(CATALOG_PAGE, /help=/, "nothing behind a heading nobody sees");
  assert.match(POOLS_CSS, /\.catalogPage > :global\(\.ryntra-page__head\) \{\s*position: absolute;/);
  assert.equal(POOLS_WORDS.colFeeTvl.uk, "Комісії/TVL 24\u00a0год", "the day stays one word under a narrow head");
  assert.match(POOLS_WORDS.feeTvlFoot.uk, /не обіцянка/, "a fact of the day gone, said as one");
});

test("Fees/TVL 24h: the day's fees as a percent of the pool's depth; none without both, none on an empty pool", () => {
  assert.equal(feeTvl24hPct({ fees24hUsd: 500, tvlUsd: 100_000 }), 0.5);
  assert.equal(feeTvl24hPct({ fees24hUsd: null, tvlUsd: 100_000 }), null);
  assert.equal(feeTvl24hPct({ fees24hUsd: 500, tvlUsd: null }), null);
  assert.equal(feeTvl24hPct({ fees24hUsd: 500, tvlUsd: 0 }), null);
  const pool = (address, fees24hUsd, tvlUsd) => ({ address, kind: "dlmm", fees24hUsd, tvlUsd });
  const rows = catalogRows([pool("a", 1_000, 1_000_000), pool("b", 900, 100_000), pool("c", null, 500_000), pool("d", 300, 10_000)], "all", "feeTvl", "desc");
  assert.deepEqual(rows.map((row) => row.address), ["b", "a", "c", "d"], "highest first; a pool without a figure, or under $100K TVL, after the rest by depth");
});
