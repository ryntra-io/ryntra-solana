// Run from repo root:
// node --test --test-isolation=none app/agents/workspace/commerce/commerce-surface.test.mjs
//
// What the commerce surface is allowed to be. Two of these exist because
// looking at the rendered page found something no measurement had: a disclosure
// that expanded past a fixed-height panel and was clipped with no way to reach
// the rest of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WORKSPACE_SURFACES, workspaceSurface } from "../surfaces.ts";

/*
 * Line endings normalized, for the reason `agent-control-surface.test.mjs`
 * records: these read the working tree, and `core.autocrlf` rewrites it on
 * checkout. A check whose answer depends on how a file arrived on disk is not
 * checking the file.
 */
const src = (path) => readFileSync(path, "utf8").split("\r\n").join("\n");

const PAGE = src("app/agents/workspace/commerce/page.tsx");
const CLIENT = src("app/agents/workspace/commerce/route-matrix.tsx");
const SHELL = src("app/agents/workspace/agent-manifest.ts");
const CSS = src("app/agents/workspace/commerce/commerce.module.css");

test("the surface is in the manifest, in the Pro rail, and states a blocker", () => {
  const surface = workspaceSurface("commerce");
  assert.equal(surface.href, "/agents/workspace/commerce");
  assert.equal(surface.state, "READ ONLY");
  assert.ok(surface.works.length >= 2, "a READ ONLY surface must say what it actually does");
  assert.ok(surface.blocker && surface.blocker.length > 40, "the blocker must be the exact missing thing");
  assert.ok(
    /no facilitator credential|no signer|no key/i.test(surface.blocker),
    "the blocker must name the missing money path rather than a date",
  );
  assert.ok(SHELL.includes('href: "/agents/workspace/commerce"'), "the Pro rail does not list the route");
});

test("its heading is unique across the workspace", () => {
  const headings = WORKSPACE_SURFACES.map((surface) => surface.heading);
  assert.equal(new Set(headings).size, headings.length);
  assert.ok(PAGE.includes("<h1>Jobs and payments</h1>"));
});

test("every panel carrying a disclosure can scroll, so nothing expands out of reach", () => {
  /* GATE-PROVED by looking at the page rather than by measuring it. Five panels
     hold an `<Explain>`; the panel body is `overflow-y: hidden` unless `scroll`
     is set, so an opened disclosure was clipped and the end of the explanation
     was simply gone. `scroll` also gives the region a tab stop and a name,
     which is the same defect for a keyboard user. */
  const panels = PAGE.split(/<Panel\b/).slice(1);
  assert.equal(panels.length, 6, "the page is expected to render six panels");
  /* A panel's disclosure may be written here or inside a component it renders,
     and the second kind is the one that would be missed by reading this file
     alone — the route grid's explanation lives in `route-matrix.tsx`. */
  assert.ok(CLIENT.includes("<details"), "the route matrix is expected to carry its own disclosure");
  let withDisclosure = 0;
  for (const panel of panels) {
    const body = panel.split("</Panel>")[0];
    const title = body.match(/title=\{?["`]([^"`]+)/)?.[1] ?? "(untitled)";
    const hasDisclosure = /<Explain\b/.test(body) || /<RouteMatrix\b/.test(body);
    if (!hasDisclosure) continue;
    withDisclosure += 1;
    const props = body.split(">")[0];
    assert.ok(
      /\bscroll\b/.test(props),
      `"${title}" holds a disclosure inside a fixed-height panel and cannot scroll`,
    );
  }
  assert.equal(withDisclosure, 5);
});

test("the explanation lives behind an icon and is never printed on the page", () => {
  /* Founder rule: a workspace that reads as documentation with controls
     attached is a failed workspace. Every explanatory paragraph on this surface
     is inside a `<details>`; the visible text is a heading, a number or a
     state. */
  const explains = PAGE.split("<Explain").length - 1;
  assert.ok(explains >= 4, "the surface must keep its explanations behind a disclosure");
  assert.ok(CSS.includes(".explain summary"), "the disclosure must be styled as a control");
  assert.ok(/min-height:\s*44px/.test(CSS), "the disclosure summary must meet the 44px target");
  /* And the disclosure is a real element rather than a hover-only tooltip,
     which a keyboard or a touch device cannot open. */
  assert.ok(PAGE.includes("<details className={styles.explain}>"));
});

test("the page reads the projection and never decides anything itself", () => {
  assert.ok(PAGE.includes("buildCommerceSurface"));
  assert.ok(
    !/resolvePaymentRoute|buildCommerceReceipt|buildRoutePreview/.test(PAGE),
    "the page calls the engine directly, so there are two places that decide",
  );
  /* The client component draws precomputed verdicts. If it could resolve a
     route it would be a second engine, in a browser, with no registry. */
  assert.ok(
    !/payments\/(x402-engine|receipt|implementations)['"]\s*;/.test(
      CLIENT.replace(/import type[^;]+;/g, ""),
    ),
    "the client component imports engine behaviour rather than types",
  );
  assert.ok(!/AGENT_CONTROL_REGISTRY/.test(CLIENT));
});

test("no status word on the surface is hand-written", () => {
  /* Canon 08 §5 forbids editing a status into JSX. Every verdict here comes
     from a projection field, and the words that would be a claim are absent. */
  const visible = PAGE.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const forbidden of [">Live<", ">Supported<", ">Integrated<", ">Production<", ">Coming soon<"]) {
    assert.ok(!visible.includes(forbidden), `the page hand-writes ${forbidden}`);
  }
  assert.ok(!/\bcoming soon\b/i.test(visible));
});

test("the surface promises no capability it does not have", () => {
  const surface = workspaceSurface("commerce");
  const copy = [surface.lede, surface.blocker, ...surface.works].join(" ");
  for (const forbidden of ["first", "only", "safe", "compliant", "guaranteed", "instant"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`, "i").test(copy),
      `the manifest copy claims "${forbidden}"`,
    );
  }
  /* And it does not describe a payment as something this product can perform. */
  assert.ok(!/\bwe pay\b|\bpays for\b|\bsend(s)? payment\b/i.test(copy));
});

test("the surface renders no control smaller than the target, by rule rather than by luck", () => {
  /* The one link on the page was 17px tall and was caught on the rendered
     screen. The rule is written down so the next one is caught here. */
  assert.ok(/\.source a \{[^}]*min-height:\s*44px/s.test(CSS), "the source link has no minimum target");
  assert.ok(/\.control select \{[^}]*min-height:\s*44px/s.test(CSS), "the selects have no minimum target");
});
