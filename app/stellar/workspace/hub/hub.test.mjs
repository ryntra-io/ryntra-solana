import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The gate that would have caught what shipped.
 *
 * On 2026-08-13 the Stellar Hub shipped styled with `--line` and `--fg-faint`.
 * Neither token exists. CSS does not treat that as an error — it treats the
 * declaration as invalid at computed-value time and drops it — so
 * `border: 1px solid var(--line)` did not fall back to a thinner border. It
 * produced `border-width: 0px; border-style: none`, and **every card, input,
 * row separator and state pill on the workspace rendered with no border at
 * all**. The colour token failed the same way, leaving uppercase labels,
 * provenance lines and 56-character issuer addresses at full strength,
 * identical to the values they qualify.
 *
 * Typecheck passed. Lint passed. All 1,414 tests passed. The stylesheet was
 * valid CSS and the markup was correct. The only thing that found it was reading
 * the computed border width off a live element — a thing a person has to
 * remember to do, and therefore not a gate.
 *
 * This is the gate. It asks one question a machine can answer with certainty:
 * is this custom property defined anywhere the product could define it.
 *
 * Three things it had to learn on its first run, each recorded rather than
 * quietly patched:
 *
 * **Comments count as code to a regex.** The first version failed against the
 * paragraph above, which quotes the broken declaration to explain it. The
 * Passport's no-score test hit exactly this and the repository wrote it down;
 * this one read that note afterwards rather than before.
 *
 * **Not every token is defined in CSS.** `--font-inter` comes from `next/font`
 * in `app/layout.tsx`, and `--i` / `--step` / `--n` are set inline on a style
 * object in the landing's orbit components. A definition sweep that only reads
 * stylesheets calls all of those undefined.
 *
 * **A fallback is not a defect.** `var(--x, 12px)` degrades to something rather
 * than to nothing, so only fallback-free references are checked.
 */

const ROOT = "app";

/**
 * Custom properties that are genuinely undefined today and were already so
 * before this gate existed.
 *
 * They are **not** waived. Each one is the same defect on another surface, and
 * fixing them means deciding what each was meant to be — which is a change to
 * the site, the landing and older internal surfaces,
 * none of which is this task's to make. Listing them stops the gate reporting
 * old news while still failing the moment a *new* one appears.
 *
 * The list may only shrink: the second test below fails if an entry here is no
 * longer found, so fixing one forces its removal instead of leaving a stale
 * allowance behind.
 */
const KNOWN_UNRESOLVED = new Set([
  /* `--glow` left this list with the Academy v2 rebuild (2026-09-13): its one
     reference was the old academy stylesheet, which was replaced whole. */
  /* `--rt-paper-reconciled-green-fg` and `--rt-paper-review-amber-fg` left
     this list with the v1.0 brand tokens (2026-09-11): the projection now
     declares the paper inks for success and caution beside the paper ladder. */
  "--fs-18",
  "--font-space-grotesk",
]);

/* `--sans` is deliberately absent from that list. It was the same defect and
   somebody already repaired it, leaving the explanation at `app/globals.css`
   line ~1940: "var(--sans) was never defined, so this whole shorthand was
   silently invalid". Its only remaining mention is that comment, which the
   sweep strips — so the gate now agrees with the note, and the shrink test is
   what noticed. */

function walk(dir, test_, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, test_, found);
    else if (test_(entry)) found.push(path);
  }
  return found;
}

const STYLESHEETS = walk(ROOT, (name) => name.endsWith(".css"));
const SOURCES = walk(ROOT, (name) => name.endsWith(".ts") || name.endsWith(".tsx"));

/** CSS comments are prose. A regex cannot tell the difference, so they go first. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* A definition is `--name:` at a declaration position. The negative lookbehind
   keeps `var(--name)` from counting as one — otherwise a stylesheet would
   define every token it merely mentions, and the gate would pass on exactly the
   defect it exists to catch. */
const CSS_DEFINITION = /(?<!var\(\s*)(--[a-zA-Z0-9_-]+)\s*:/g;

/* In TypeScript a token is defined as a quoted string: `variable: "--font-inter"`
   from next/font, or `{ "--i": index }` on a style object. */
const TS_DEFINITION = /["'](--[a-zA-Z0-9_-]+)["']/g;

/* Only fallback-free references. */
const REFERENCE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g;

function sweep() {
  const defined = new Set();
  const referenced = new Map();

  for (const file of SOURCES) {
    for (const [, token] of readFileSync(file, "utf8").matchAll(TS_DEFINITION)) defined.add(token);
  }

  for (const file of STYLESHEETS) {
    const css = stripComments(readFileSync(file, "utf8"));
    for (const [, token] of css.matchAll(CSS_DEFINITION)) defined.add(token);
    for (const [, token] of css.matchAll(REFERENCE)) {
      if (!referenced.has(token)) referenced.set(token, new Set());
      referenced.get(token).add(file);
    }
  }

  const unresolved = new Map([...referenced].filter(([token]) => !defined.has(token)));
  return { defined, referenced, unresolved };
}

test("no stylesheet paints with a custom property that does not exist", () => {
  const { unresolved } = sweep();

  const fresh = [...unresolved.entries()]
    .filter(([token]) => !KNOWN_UNRESOLVED.has(token))
    .map(([token, files]) => `${token} — referenced in ${[...files].sort().join(", ")}`);

  assert.deepEqual(
    fresh,
    [],
    "These custom properties are used with no fallback and defined nowhere.\n" +
      "CSS drops the whole declaration rather than falling back, so a border becomes 0px and a\n" +
      "colour silently inherits — invisible to typecheck, lint and every source-level test.\n\n" +
      fresh.join("\n"),
  );
});

test("the known-unresolved list only shrinks", () => {
  const { unresolved } = sweep();

  const repaired = [...KNOWN_UNRESOLVED].filter((token) => !unresolved.has(token));

  assert.deepEqual(
    repaired,
    [],
    "These are no longer undefined, so they must come out of KNOWN_UNRESOLVED.\n" +
      "An allowance nobody removes is how recorded debt turns back into invisible debt.\n\n" +
      repaired.join("\n"),
  );
});

test("the sweep actually looked at something", () => {
  /* A recursive walk that silently finds nothing would make both tests above
     pass forever. The gate asserts its own reach rather than trusting it. */
  const { defined, referenced } = sweep();

  assert.ok(STYLESHEETS.length >= 5, `Expected several stylesheets under ${ROOT}/, found ${STYLESHEETS.length}.`);
  assert.ok(
    STYLESHEETS.some((file) => file.includes(join("stellar", "workspace"))),
    "The Stellar workspace stylesheet is not in the sweep, which is the surface this gate exists for.",
  );
  assert.ok(defined.size > 50, `Expected the token layer to define many properties, found ${defined.size}.`);
  assert.ok(referenced.size > 20, `Expected many fallback-free references, found ${referenced.size}.`);

  /* And the two names that caused the defect must stay undefined. If someone
     later defines `--line` to make an old stylesheet work, the drift this gate
     prevents has simply been legalised somewhere else. */
  for (const retired of ["--line", "--fg-faint"]) {
    assert.ok(
      !defined.has(retired),
      `${retired} is defined again. It was never a token; the real names are --border and --text-faint.`,
    );
  }
});
