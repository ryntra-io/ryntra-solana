// Run from repo root: node --test lib/markets/discovery.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { buildRadar, epochMs, isTradable } from "./radar.ts";
import {
  SCREEN_FIELDS,
  SCREEN_PRESETS,
  VALUATION_FIELDS,
  fieldCoverage,
  judge,
  MAX_CONDITIONS,
  decodeConditions,
  describeCondition,
  encodeConditions,
  runScreen,
  screenField,
} from "./screen.ts";
import {
  DEFAULT_SCAN_POLICY,
  SCANNER_KINDS,
  kindSpec,
  raise,
  runScan,
} from "./scan.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

/** Every stylesheet under a surface, so a gate cannot be outgrown by a new file. */
function stylesheetsUnder(directory) {
  const root = new URL("../../", import.meta.url);
  const walk = (relative) =>
    readdirSync(new URL(relative, root), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${relative}/${entry.name}`)
        : entry.name.endsWith(".css")
          ? [`${relative}/${entry.name}`]
          : [],
    );
  return walk(directory).sort();
}
/** Comments name what was rejected; only shipped code is scanned. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const DAY = 86_400_000;
const NOW = 1_755_600_000_000;

/** A universe with the exact shapes the live venue returns, including its gaps. */
function universe() {
  const tokens = [
    { symbol: "AAPL", name: "Apple", address: "0xaa", category: "stock", verified: true, addedTimestamp: (NOW - 400 * DAY) / 1000, source: "server" },
    { symbol: "TSLA", name: "Tesla", address: "0xtt", category: "stock", verified: true, addedTimestamp: (NOW - 2 * DAY) / 1000, source: "server" },
    { symbol: "WBTC", name: "Wrapped BTC", address: "0xbb", category: "crypto", verified: true, addedTimestamp: NOW - 3 * DAY, source: "server" },
    { symbol: "CASHCAT", name: "Cash Cat", address: "0xcc", category: "meme", verified: false, addedTimestamp: (NOW - 1 * DAY) / 1000, source: "admin" },
    /* No timestamp at all — twenty real tokens are in this state. */
    { symbol: "USDG", name: "USDG", address: "0xdd", category: "crypto", verified: true },
  ];
  const overview = [
    { ticker: "AAPL", category: "stock", quote: { price: 310.6, changePercent24h: -1.2, volume24h: 5_000_000 }, financials: { marketCap: 4.6e12, peRatio: 31.2, dividendYield: 0.41, priceToBook: 52.1, revenue: 4.1e11, currency: "USD" } },
    { ticker: "TSLA", category: "stock", quote: { price: 336.1, changePercent24h: 0.9, volume24h: 27_000_000 }, financials: { marketCap: 1.1e12, peRatio: 190.4, dividendYield: null, priceToBook: 14.2, revenue: 9.7e10, currency: "USD" } },
    /* A crypto token: priced, and with no fundamentals at all. */
    { ticker: "WBTC", category: "crypto", quote: { price: 64_000, changePercent24h: 0.2, volume24h: 900_000 }, financials: {} },
    /* The live category conflict: `meme` to one endpoint, `CRYPTO` to the other. */
    { ticker: "CASHCAT", category: "CRYPTO", quote: { price: 0.004, changePercent24h: 12.5, volume24h: 1_200 }, financials: {} },
    /* Listed and unpriced — three real tokens are in this state. */
    { ticker: "USDG", category: "crypto", quote: {} },
  ];
  return buildRadar(tokens, overview, ["TSLA"]);
}

/* ------------------------------------------------------- the separation */

test("Radar, the Screener and the Scanner are three objects and not three tabs", () => {
  /*
   * Keeping them apart is the single most important structural decision in
   * the product, and it is the acceptance these modules are written against.
   * The failure it prevents is not a bug — it is a product that looks like
   * every competitor's, because one query with three presets is what everyone
   * else ships.
   *
   * So the assertion is structural rather than behavioural: neither module can
   * do the other's job, and neither knows the other exists.
   */
  const screen = code("lib/markets/screen.ts");
  const scan = code("lib/markets/scan.ts");

  assert.doesNotMatch(screen, /\bsubscribe\b|\baddEventListener\b|\bemit\b|\braise\b/, "a Screen must not be able to raise an event");
  assert.doesNotMatch(screen, /from "\.\/scan/, "the Screener must not import the Scanner");
  assert.doesNotMatch(scan, /\brunScreen\b|\bScreenResult\b|\bmatched\b/, "a Watch must not return a result set");
  assert.doesNotMatch(scan, /from "\.\/screen/, "the Scanner must not import the Screener");

  /* Both read the same universe, which is correct — one universe, three ways
     of asking about it. Sharing the *rows* is the point; sharing a query
     object underneath is what this forbids. */
  assert.match(screen, /from "\.\/radar/);
  assert.match(scan, /from "\.\/radar/);
});

/* ---------------------------------------------------------- the Screener */

test("an absent figure is unjudgeable, which is neither a miss nor a zero", () => {
  /*
   * 51 of 231 instruments have no price/earnings ratio, because crypto and
   * community tokens do not have one. A screen that counts them as misses
   * reports a finding it never made; one that reads the absence as 0 reports
   * the opposite and passes them all. Absence is its own verdict.
   */
  const rows = universe();
  const wbtc = rows.find((row) => row.symbol === "WBTC");
  const aapl = rows.find((row) => row.symbol === "AAPL");

  assert.equal(judge({ field: "peRatio", op: "atMost", value: 40 }, aapl, NOW), "match");
  assert.equal(judge({ field: "peRatio", op: "atMost", value: 40 }, wbtc, NOW), "unjudgeable");
  assert.notEqual(judge({ field: "peRatio", op: "atMost", value: 40 }, wbtc, NOW), "miss");
  /* And the same figure read as a large number must not pass either — the
     guard is the absence, not the direction of the comparison. */
  assert.equal(judge({ field: "peRatio", op: "atLeast", value: 0 }, wbtc, NOW), "unjudgeable");

  const result = runScreen(
    { id: "s1", name: "Cheap equities", conditions: [{ field: "peRatio", op: "atMost", value: 40 }] },
    rows,
    NOW,
  );
  assert.deepEqual(result.matched.map((row) => row.symbol), ["AAPL"]);
  assert.equal(result.checked, 5);
  /* The unjudged rows are reported by name and carry the venue's own reason,
     so the surface can say what it could not decide instead of narrowing the
     universe silently. */
  const unjudgedSymbols = result.unjudged.map((entry) => entry.symbol).sort();
  assert.deepEqual(unjudgedSymbols, ["CASHCAT", "USDG", "WBTC"]);
  assert.match(result.unjudged[0].reason, /price\/earnings|not in the venue/);
});

test("a saved screen re-runs and answers for the universe it is given", () => {
  /*
   * "Saved as a named screen, re-runnable" is a product requirement, and the
   * failure mode is a screen that replays its old answer. Nothing here stores
   * a result: a screen is a name and its conditions, and running it twice
   * against two universes gives two answers.
   */
  const screen = { id: "movers", name: "Up more than 5%", conditions: [{ field: "changePercent24h", op: "atLeast", value: 5 }] };

  const before = runScreen(screen, universe(), NOW);
  assert.deepEqual(before.matched.map((row) => row.symbol), ["CASHCAT"]);

  const later = buildRadar(
    [{ symbol: "AAPL", name: "Apple", address: "0xaa", category: "stock", verified: true }],
    [{ ticker: "AAPL", category: "stock", quote: { price: 340, changePercent24h: 9.4 }, financials: {} }],
    [],
  );
  const after = runScreen(screen, later, NOW + DAY);
  assert.deepEqual(after.matched.map((row) => row.symbol), ["AAPL"]);
  assert.equal(after.ranAt, NOW + DAY, "a re-run answers for when it ran");
  assert.notEqual(before.ranAt, after.ranAt);
});

test("every screen field names the venue field it reads", () => {
  /* A condition a person cannot trace to a source is a filter that has to be
     believed. Each field carries its own, and the Screener has no field that
     reads nothing. */
  for (const field of SCREEN_FIELDS) {
    assert.ok(field.source && field.source.length > 4, `${field.id} names no source`);
    assert.ok(field.label.trim(), `${field.id} has no label`);
    assert.equal(typeof field.read, "function");
  }
  /* Tradability is derived and stays derived: the Screener exposes it as a
     condition and still cannot set it. */
  const executable = screenField("executable");
  assert.match(executable.source, /derived/);
  const rows = universe();
  assert.equal(executable.read(rows.find((r) => r.symbol === "TSLA"), NOW).value, true);
  assert.equal(executable.read(rows.find((r) => r.symbol === "AAPL"), NOW).value, false);
  assert.equal(isTradable(rows.find((r) => r.symbol === "USDG").tradability), false);
});

test("field coverage is measured against the rows in hand, not remembered", () => {
  /* Coverage moves when the venue's data moves. A number written down at probe
     time is a number that goes quietly wrong. */
  const rows = universe();
  assert.deepEqual(fieldCoverage(screenField("peRatio"), rows, NOW), { judgeable: 2, total: 5 });
  assert.deepEqual(fieldCoverage(screenField("class"), rows, NOW), { judgeable: 5, total: 5 });
  assert.deepEqual(fieldCoverage(screenField("listedDaysAgo"), rows, NOW), { judgeable: 4, total: 5 });
});

test("listing age reads seconds and milliseconds without dating a token to 1970", () => {
  /* The registry has returned both units for this field. Getting it wrong is a
     silent wrong answer rather than a loud one: every token would look ancient
     and "listed recently" would match nothing. */
  assert.equal(epochMs(1_755_600_000).value, 1_755_600_000_000);
  assert.equal(epochMs(1_755_600_000_000).value, 1_755_600_000_000);
  assert.equal(epochMs(undefined).known, false);
  assert.equal(epochMs(0).known, false);
  assert.match(epochMs(null).reason, /no listing timestamp/);
});

/* ----------------------------------------------------------- the Scanner */

test("an event cannot be built without the source that raised it", () => {
  /*
   * The provenance requirement, made structural. `source` is a required field
   * of `ScannerEvent`, `raise()` is the only constructor in the module, and no
   * event object is assembled anywhere else — so provenance cannot be added at
   * render time or forgotten.
   */
  const scan = code("lib/markets/scan.ts");
  assert.doesNotMatch(scan, /source\?:/, "source must not be optional on an event");
  assert.doesNotMatch(scan, /source:\s*null\s*\}\)/, "an event must not be raised with a null source");
  /* One constructor. Anything else building `{ kind, symbol` is a second door. */
  const constructions = [...scan.matchAll(/\{\s*kind,\s*symbol/g)];
  assert.equal(constructions.length, 1, "ScannerEvent must have exactly one constructor");

  const rows = universe();
  const event = raise(
    "new-listing",
    rows[0],
    "Listed 2 day(s) ago",
    "information",
    { feed: "arcus:spot-tokens", field: "addedTimestamp", observedAt: NOW },
  );
  assert.equal(event.source.feed, "arcus:spot-tokens");
  assert.equal(event.source.field, "addedTimestamp");
  assert.equal(event.source.observedAt, NOW);
});

test("every registered kind either reads something or states what it cannot", () => {
  /*
   * Three of the conditions the product lists have no source in any endpoint
   * this product reads. Dropping them would make the Scanner read complete,
   * which is the more expensive error — so each is registered carrying the
   * exact thing that would end it, and a kind may not be silent about both.
   */
  assert.ok(SCANNER_KINDS.length >= 10);
  for (const spec of SCANNER_KINDS) {
    assert.ok(spec.question.trim().endsWith("?"), `${spec.kind} states no standing question`);
    if (spec.source) {
      assert.equal(spec.gate, null, `${spec.kind} has a source and a gate; it can only have one`);
      assert.ok(spec.source.feed && spec.source.field, `${spec.kind} names an incomplete source`);
    } else {
      assert.ok(spec.gate && spec.gate.length > 40, `${spec.kind} has no source and no stated gate`);
      assert.doesNotMatch(spec.gate, /coming soon|shortly|soon\b/i, `${spec.kind} dates its gate`);
    }
  }
  /* The three the data cannot support, named so removing one is a decision. */
  for (const kind of ["spread-threshold", "liquidity-deterioration", "route-changed"]) {
    assert.equal(kindSpec(kind).source, null, `${kind} must not claim a source`);
  }
  assert.match(kindSpec("spread-threshold").gate, /bid, an ask or a book/);
  assert.match(kindSpec("corporate-action-scheduled").gate, /newUIMultiplier/);
});

test("the scan raises only what it read, and says how much it could see", () => {
  const rows = universe();
  const perps = [
    { baseAsset: "AAPL", status: "ONLINE", isOutsideRth: true },
    { baseAsset: "TSLA", status: "ONLINE", isOutsideRth: false },
    { baseAsset: "CCL", status: "OFFLINE", isOutsideRth: null },
    { baseAsset: "WBTC", status: "OFFLINE", isOutsideRth: null },
  ];
  const result = runScan(rows, perps, NOW, DEFAULT_SCAN_POLICY);
  const kinds = result.events.map((event) => event.kind);

  assert.ok(kinds.includes("new-listing"), "TSLA, WBTC and CASHCAT were listed inside the window");
  assert.ok(kinds.includes("underlying-closed"), "AAPL's underlying is outside regular hours");
  assert.ok(kinds.includes("venue-market-offline"), "WBTC's market is offline");
  assert.ok(kinds.includes("class-disagreement"), "CASHCAT is meme to one endpoint and CRYPTO to the other");
  assert.ok(kinds.includes("price-unavailable"), "USDG is listed and unpriced");
  assert.ok(kinds.includes("unverified-listing"), "CASHCAT is not verified by the venue");

  /* Every event carries its own provenance, with no exception. */
  for (const event of result.events) {
    assert.ok(event.source.feed && event.source.field, `${event.kind} on ${event.symbol} has an incomplete source`);
    assert.equal(event.source.observedAt, NOW);
  }

  /* Coverage is per kind and measured. The market-hours join sees only the
     rows that have a perps market — three here, 33 of 231 live. */
  const covered = new Map(result.coverage.map((entry) => [entry.kind, entry]));
  assert.equal(covered.get("underlying-closed").covered, 2, "only AAPL and TSLA carry a boolean isOutsideRth");
  assert.equal(covered.get("underlying-closed").fired, 1);
  assert.equal(covered.get("venue-market-offline").covered, 3, "three rows have a perps market at all");
  assert.equal(covered.get("new-listing").covered, 4, "one token carries no listing timestamp");
  assert.equal(covered.get("class-disagreement").total, 5);

  /* A kind with no source reports zero coverage rather than zero findings —
     the difference between "nothing is wrong" and "nothing was looked at". */
  for (const kind of ["spread-threshold", "liquidity-deterioration", "route-changed", "corporate-action-scheduled"]) {
    assert.equal(covered.get(kind).covered, 0, `${kind} must not claim coverage`);
    assert.equal(covered.get(kind).fired, 0);
  }
});

test("zero events is an answer, and it still says what was checked", () => {
  /*
   * At the probe that shaped these modules, `isOutsideRth` was `true` on none of
   * the 47 markets. An empty Scanner has to read as *nothing is firing* with
   * the check behind it, never as an empty box — and never as a reason to
   * invent a row.
   */
  const quiet = buildRadar(
    [{ symbol: "AAPL", name: "Apple", address: "0xaa", category: "stock", verified: true, addedTimestamp: (NOW - 400 * DAY) / 1000 }],
    [{ ticker: "AAPL", category: "stock", quote: { price: 310 }, financials: {} }],
    [],
  );
  const result = runScan(quiet, [{ baseAsset: "AAPL", status: "ONLINE", isOutsideRth: false }], NOW);

  assert.deepEqual(result.events, []);
  assert.equal(result.checked, 1);
  assert.equal(result.ranAt, NOW);
  const hours = result.coverage.find((entry) => entry.kind === "underlying-closed");
  assert.equal(hours.covered, 1, "it was looked at");
  assert.equal(hours.fired, 0, "and nothing fired");
  assert.equal(result.coverage.length, SCANNER_KINDS.length, "every kind reports, including the ones that found nothing");
});

test("conditions survive a round trip through a URL, and a hand-edited one is dropped", () => {
  /*
   * The conditions live in the address bar, which makes "re-runnable" literal:
   * the same link run tomorrow answers for tomorrow. It also makes them
   * untrusted input, so decoding is defensive the way `layout-store` is —
   * anything unrecognised is **dropped**, never coerced. A screen that
   * silently reinterprets a condition answers a question nobody asked.
   */
  const conditions = [
    { field: "class", op: "is", value: "STOCK_TOKEN" },
    { field: "peRatio", op: "atMost", value: 40 },
    { field: "venueVerified", op: "is", value: true },
  ];
  const encoded = encodeConditions(conditions);
  assert.deepEqual([...encoded], ["class.is.STOCK_TOKEN", "peRatio.atMost.40", "venueVerified.is.true"]);
  assert.deepEqual(decodeConditions(encoded).map((c) => ({ ...c })), conditions);

  // A single value, not an array, is what a one-condition URL hands back.
  assert.deepEqual([...decodeConditions("peRatio.atMost.40")], [{ field: "peRatio", op: "atMost", value: 40 }]);

  for (const junk of [
    "nosuchfield.atMost.40",           // a field with no source
    "peRatio.between.40",              // a comparator that does not exist
    "peRatio.atMost.abc",              // a number that is not one
    "peRatio.is.40",                   // a number is compared, never matched
    "class.atLeast.STOCK_TOKEN",       // an enum is not ordered
    "class.is.SOMETHING_ELSE",         // outside the field's own options
    "venueVerified.is.maybe",          // a flag is true or false
    "malformed",
    "",
  ]) {
    assert.deepEqual([...decodeConditions(junk)], [], `"${junk}" must be dropped, not interpreted`);
  }

  // A URL cannot grow into a query plan.
  const many = Array.from({ length: 40 }, () => "peRatio.atMost.40");
  assert.equal(decodeConditions(many).length, MAX_CONDITIONS);
  assert.equal(encodeConditions(Array.from({ length: 40 }, () => conditions[1])).length, MAX_CONDITIONS);

  assert.equal(describeCondition(conditions[1]), "Price / earnings at most 40");
  assert.equal(describeCondition(conditions[2]), "Verified by the venue is yes");
});

test("a named preset is never wider than its name", () => {
  /*
   * Found by looking at the live surface rather than by any number.
   *
   * "Equities under 40 P/E" carried one condition — `peRatio atMost 40` —
   * which is literally correct and answers a different question. A loss-making
   * company has a **negative** price/earnings ratio, so every one of them is
   * "at most 40": the preset passed `INTC` at −45.8 and `SLV` at −23.9, a
   * valuation screen returning companies with no earnings to value.
   *
   * The comparator is left literal, because `atMost` means at most. What is
   * enforced is the preset: bound a valuation multiple from above and you must
   * bound it from below, or the name promises something the conditions do not
   * deliver.
   */
  for (const preset of SCREEN_PRESETS) {
    assert.ok(preset.name.trim(), "a preset with no name is a filter");
    assert.ok(preset.conditions.length > 0, `${preset.name} sets no conditions`);
    /* Every preset must survive the same reader a hand-edited URL does — a
       preset that cannot be encoded is a screen nobody can share or save. */
    assert.deepEqual(
      decodeConditions(encodeConditions(preset.conditions)).map((c) => ({ ...c })),
      preset.conditions.map((c) => ({ ...c })),
      `${preset.name} does not survive a round trip through its own URL`,
    );

    for (const field of VALUATION_FIELDS) {
      const ceiling = preset.conditions.some((c) => c.field === field && c.op === "atMost");
      const floor = preset.conditions.some((c) => c.field === field && c.op === "atLeast");
      assert.ok(
        !ceiling || floor,
        `${preset.name} caps ${field} from above and not from below; a negative multiple passes it`,
      );
    }
  }

  /* And the fixed preset does on real shapes what its name says. */
  const rows = buildRadar(
    [
      { symbol: "GOOD", name: "Earning", address: "0x1", category: "stock", verified: true },
      { symbol: "LOSS", name: "Loss-making", address: "0x2", category: "stock", verified: true },
      { symbol: "DEAR", name: "Expensive", address: "0x3", category: "stock", verified: true },
    ],
    [
      { ticker: "GOOD", category: "stock", quote: { price: 10 }, financials: { peRatio: 22 } },
      { ticker: "LOSS", category: "stock", quote: { price: 10 }, financials: { peRatio: -45.8 } },
      { ticker: "DEAR", category: "stock", quote: { price: 10 }, financials: { peRatio: 190 } },
    ],
    [],
  );
  const preset = SCREEN_PRESETS.find((entry) => entry.name.includes("P/E"));
  const matched = runScreen({ id: "p", name: preset.name, conditions: preset.conditions }, rows, NOW).matched;
  assert.deepEqual(matched.map((row) => row.symbol), ["GOOD"], "the loss-maker and the expensive one are both out");
});

test("the discovery surfaces take every colour from the shell's own tokens", () => {
  /*
   * Caught by the design hook, and it was worse than a palette drift.
   *
   * The first version of the Screener and Scanner styles used the **public
   * site's** token family with a hardcoded hex fallback behind each one. That
   * family is not defined in CSS anywhere the cabinet can see, so every
   * fallback was doing the work and both surfaces were pinned to the dark
   * palette — `app/design/tokens.css` carries a light theme they ignored.
   *
   * It looked right because it was only ever looked at in dark, and the
   * contrast sweep measured that same one state twice. **The fallback is what
   * hid it**: without one the surfaces would have rendered unstyled the first
   * time they were opened, which is a defect that announces itself.
   *
   * The check named `markets.css` and nothing else, which made it a gate with
   * an expiry date: the first stylesheet added beside it would have been
   * unguarded, and a later change added one. It walks the surface now, so a
   * new file joins the gate by existing rather than by somebody remembering.
   *
   * **And it pinned the wrong family.** It required `--rt`, which is a real
   * family and passes `design:check` — but `app/design/tokens.css` states that
   * the legacy tokens remain only until each surface migrates and that new
   * surfaces use `--ry-*` only, and Shell v2 draws its chrome from `--ry-*`.
   * So this gate was actively holding these surfaces on the superseded family
   * while the rail beside them rendered Iris: two accent hues on one screen,
   * which a person spotted on sight. A gate that enforces the wrong rule is
   * worse than no gate, because it answers the question with confidence.
   */
  const files = [...stylesheetsUnder("app/robinhood/workspace"), ...stylesheetsUnder("app/components/tiles")];
  assert.ok(files.length >= 2, `the sweep found ${files.length} stylesheet(s); it is meant to walk the surface`);

  for (const file of files) {
    const declarations = read(file).replace(/\/\*[\s\S]*?\*\//g, " ");

    assert.doesNotMatch(
      declarations,
      /#[0-9a-fA-F]{3,8}\b/,
      `${file}: a literal colour is a colour the theme cannot change`,
    );
    assert.doesNotMatch(
      declarations,
      /var\(--[a-z0-9-]+,/,
      `${file}: a token with a fallback hides the day the token stops resolving`,
    );
    /* One family, and it is the shell's. */
    const families = new Set([...declarations.matchAll(/var\((--[a-z]+)-/g)].map((m) => m[1]));
    assert.deepEqual([...families], ["--ry"], `${file} reaches outside the cabinet's tokens: ${[...families]}`);
  }
});
