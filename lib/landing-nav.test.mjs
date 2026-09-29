import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The landing header shipped a nav link to `#how` while no section ever
 * rendered that id. Nothing threw and nothing looked broken in review — the
 * link simply did nothing, in all twelve locales, for every visitor who asked
 * the most basic question a landing page has to answer.
 *
 * A broken in-page anchor cannot be caught by types or by the build, so it gets
 * caught here: every `href="#id"` the landing renders must name an id the
 * landing also mounts.
 */

const HOME_CLIENT = "app/home-client.tsx";
const LANDING_DIR = "app/landing";

function landingSources() {
  const files = [HOME_CLIENT];
  for (const entry of readdirSync(LANDING_DIR)) {
    if (entry.endsWith(".tsx")) files.push(join(LANDING_DIR, entry));
  }
  return files.map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

const SOURCES = landingSources();

/**
 * Ids are read from every landing source, not just the section that owns the
 * anchor, because the target of a nav link is routinely mounted by a sibling
 * component (`#loop` lives in raven-loop.tsx, the link in home-client.tsx).
 */
function renderedIds() {
  const ids = new Set();
  for (const { source } of SOURCES) {
    for (const match of source.matchAll(/\bid="([a-z0-9-]+)"/g)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

/**
 * Anchors are collected in both spellings the file uses: the literal
 * `href="#loop"` and the indirected `href={HOW_HREF}` whose constant resolves
 * to a hash. Without the second form, moving a href behind a constant would
 * quietly opt it out of this gate.
 */
function renderedAnchors() {
  const anchors = [];

  for (const { path, source } of SOURCES) {
    const hashConstants = new Map();
    for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*"#([a-z0-9-]+)"/g)) {
      hashConstants.set(match[1], match[2]);
    }

    for (const match of source.matchAll(/href="#([a-z0-9-]+)"/g)) {
      anchors.push({ path, id: match[1], via: `href="#${match[1]}"` });
    }

    for (const match of source.matchAll(/href=\{([A-Z][A-Z0-9_]*)\}/g)) {
      const id = hashConstants.get(match[1]);
      if (id) anchors.push({ path, id, via: `href={${match[1]}}` });
    }
  }

  return anchors;
}

test("every in-page anchor on the landing targets a section that exists", () => {
  const ids = renderedIds();
  const dead = renderedAnchors().filter((anchor) => !ids.has(anchor.id));

  assert.deepEqual(
    dead,
    [],
    `dead anchors: ${dead
      .map((a) => `${a.via} in ${a.path}`)
      .join(", ")} — rendered ids are ${[...ids].sort().join(", ")}`,
  );
});

test("the header still offers the four ways into the page", () => {
  // The four nav labels are passed into the shared chrome from the page, so the
  // page is still where a missing entry would be introduced.
  const header = readFileSync(HOME_CLIENT, "utf8");

  for (const link of ["copy.nav.now", "copy.nav.how", "copy.nav.trust", "copy.nav.methodology"]) {
    assert.ok(
      header.includes(link),
      `${link} disappeared from the header — the nav is the only path to the mid-page sections`,
    );
  }
});
