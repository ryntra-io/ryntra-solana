// Run from repo root: node --test lib/documented-routes.test.mjs
//
// Every application URL a document names must resolve to something the router
// actually serves.
//
// Written after four documents all stated that the Asset Passport was live at
// `/stellar/asset/{CODE:ISSUER}`. It is
// the exact URL somebody pastes as proof of a working product.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { hasUkAddress } from "./site/localized.ts";
import { needsDevelopmentRepository } from "./development-repository.mjs";
import { OLD_ADDRESSES } from "../city/lib/open/old-addresses.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every path the App Router serves, as a matcher. */
function routes() {
  const found = [];
  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        /* Route groups `(name)` and private folders `_name` are not URL
           segments; parallel routes `@slot` are not either. */
        const name = entry.name;
        if (name.startsWith("_") || name.startsWith("@")) continue;
        const part = name.startsWith("(") && name.endsWith(")") ? null : name;
        walk(join(dir, name), part === null ? segments : [...segments, part]);
      } else if (/^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) {
        found.push(segments);
      } else if (/^(opengraph-image|twitter-image|icon|apple-icon)\.(tsx?|jsx?|png|jpe?g|svg|ico)$/.test(entry.name) && !/[\\/]\(/.test(dir)) {
        /* A metadata image answers at its own address beside the segment —
           `/uk/opengraph-image`. Inside a route group Next hashes that address
           (`opengraph-image-<hash>`), so only a file outside a group counts. */
        found.push([...segments, entry.name.replace(/\.\w+$/, "")]);
      }
    }
  };
  walk(join(REPO, "app"), []);
  /* The cabinet's catch-all (`app/app/[...missing]`) answers every unknown
     address under `/app` with the cabinet's «not found» — it serves no route,
     so it must not make an undocumented or future address look shipped. */
  return found.filter((segments) => segments.at(-1) !== "[...missing]");
}

/**
 * Redirect sources are served too, and a stale document may legitimately use one.
 *
 * Two files, not one. `next.config.ts` writes some rows out literally and
 * *spreads the rest in* from `lib/product/customer-routing.ts`, where the
 * customer aliases live as pairs. Reading only the config found the literals and
 * missed every alias.
 */
function redirectSources() {
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");
  const config = strip(readFileSync(join(REPO, "next.config.ts"), "utf8"));
  const routing = strip(readFileSync(join(REPO, "lib/product/customer-routing.ts"), "utf8"));
  const found = [
    ...[...config.matchAll(/source:\s*"([^"]+)"/g)].map(([, source]) => source),
    ...[...routing.matchAll(/\["(\/[^"]*)",\s*"[^"]*"\]/g)].map(([, source]) => source),
    /* The `/agents/workspace/<name>` family, built by mapping a list of names. */
    ...[...routing.matchAll(/`\/agents\/workspace\/\$\{name\}`/g)].map(() => "/agents/workspace/:name"),
    /* The old interface's addresses, each leading into the city (CITY-13): a table of its own, read by the config. */
    ...OLD_ADDRESSES.map((row) => row.source),
  ];
  return found.filter((source) => source.startsWith("/")).map(sourceSegments);
}

/**
 * A redirect source cut where the router cuts it.
 *
 * A parameter may carry its own pattern, and the pattern may hold a slash: since
 * 2026-10-17 the Markets redirect reads `/app/markets/:path((?!pools(?:/|$)).+)`,
 * so that Markets keeps its own Pools view. Splitting on every slash cut that
 * pattern in two, the source read as four segments, and the three-segment
 * addresses it does serve — `/app/markets/predictions` among them — looked
 * unserved. The cut is made only outside parentheses, past escaped characters.
 */
function sourceSegments(source) {
  const segments = [""];
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      segments[segments.length - 1] += character + (source[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "/" && depth === 0) segments.push("");
    else segments[segments.length - 1] += character;
  }
  return segments.filter(Boolean);
}

const dynamic = (segment) =>
  (segment.startsWith("[") && segment.endsWith("]")) || segment.startsWith(":") || segment === "*";
/* `:name*` in a redirect source is the router's catch-all too: zero segments or more. */
const catchAll = (segment) => segment.startsWith("[...") || segment.startsWith("[[...") || /^:\w+\*$/.test(segment);
/** `:name(pattern)` — a parameter that brings its own pattern instead of one plain segment. */
const patterned = (segment) => /^:\w+\(.*\)$/.test(segment);
/** Whether that pattern accepts `text`, anchored as the router anchors it. */
const accepts = (segment, text) =>
  new RegExp(`^(?:${segment.slice(segment.indexOf("(") + 1, segment.lastIndexOf(")"))})$`).test(text);

function matches(pattern, actual) {
  for (let index = 0; index < pattern.length; index += 1) {
    if (catchAll(pattern[index])) return actual.length >= index;
    if (index >= actual.length) return false;
    /* Its pattern may cross a slash, so as the last segment it is asked about
       the rest of the address, and anywhere else about its own segment. */
    if (patterned(pattern[index])) {
      if (index === pattern.length - 1) return accepts(pattern[index], actual.slice(index).join("/"));
      if (!accepts(pattern[index], actual[index])) return false;
      continue;
    }
    if (dynamic(pattern[index])) continue;
    if (pattern[index] !== actual[index]) return false;
  }
  return pattern.length === actual.length;
}

/** A documented placeholder — `{CODE:ISSUER}`, `[asset]`, `:id` — is a segment. */
const normalise = (path) =>
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => (/^[{[:]|[}\]]$/.test(segment[0]) || segment.startsWith(":") ? "[x]" : segment));

function markdown(dir = join(REPO, "docs"), found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) markdown(path, found);
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

/**
 * Paths that look like a URL a person could open.
 *
 * Deliberately narrow: only backticked paths whose first segment is a real
 * top-level route directory. Prose is full of `/v1/...` fragments, file paths
 * and shell arguments, and a check that flags those is a check nobody runs.
 */
function documentedPaths(source) {
  const tops = new Set(
    readdirSync(join(REPO, "app"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("("))
      .map((entry) => entry.name),
  );
  const cleaned = source.replace(/```[\s\S]*?```/g, " ");
  return [...cleaned.matchAll(/`(\/[A-Za-z0-9\-_[\]{}:.…/]+)`/g)]
    .map(([, path]) => path.replace(/[.,;]+$/, ""))
    .filter((path) => tops.has(path.split("/").filter(Boolean)[0]))
    /* A path carrying an ellipsis is an abbreviation, not a URL. The ASCII
       three-dot spelling joined on 2026-08-30, when the byte-preserved Jupiter
       audit import named `/solana/.../predictions` as a FORBIDDEN duplicate
       route and this scan read the abbreviation as a claimed link. */
    .filter((path) => !path.includes("…"))
    .filter((path) => !path.split("/").includes("..."))
    /* `.tsx` and friends are files that happen to live under `app/`. */
    .filter((path) => !/\.\w+$/.test(path));
}

/**
 * Namespaces this check does not police, and why.
 *
 * `/v1` and `/api` are API surfaces, and a document naming one is describing a
 * contract rather than linking a page a reviewer opens. They are also shared
 * spelling: `docs/ARCUS-API.md` documents **Arcus's** `/v1/quote`, which has
 * nothing to do with Ryntra's own `app/v1/`. Policing them would report a
 * third party's endpoint as our broken link.
 *
 * It is the shared-spelling problem in its purest form: a `.well-known`
 * path is defined by an RFC and every server on the internet publishes it at
 * the identical URL, so a document naming one is usually naming somebody
 * else's. Ryntra's own two discovery documents are checked by something
 * stronger than a link scan — `app/api/agents/mcp/hosted-mcp-e2e.test.mjs`
 * fetches both by path through the real route handlers and asserts what they
 * say.
 */
const UNPOLICED = ["v1", "api", ".well-known"];

/**
 * Paths a document names as planned or deliberately deferred.
 *
 * Not broken — not built. Each needs a reason, and an entry leaves when the
 * route ships or when the document stops naming it; a new entry names the
 * registered subtask that builds it.
 */
const DECLARED_FUTURE = [
  { path: "/app/w/[workspaceId]", reason: "workspace routing by id, deferred until the workspaces themselves are built" },
  { path: "/stellar/deck", reason: "a Stellar presentation page, taken out of the Stellar release on 2026-08-14 and deferred" },
  { path: "/stellar/receipts/{id}", reason: "per-id receipt permalinks, named in the 2026-08-14 /stellar brief and deliberately not built — receipts are verified by pasting a document at /stellar/workspace/receipts, and there is no receipt store behind an id" },
  { path: "/app/radar", reason: "closed rather than left frozen: the Changes Radar is a view of `/app/research`, this path is never built, and no redirect is added because a route whose only behaviour is to send a reader elsewhere is a dead route with a redirect attached" },
  { path: "/app/today", reason: "Home v2's first spelling for the attention-first view; that view was built at `/app` itself rather than at a second URL, so this path stays unrouted and is named only as accepted direction" },
  { path: "/app/assets/[instrumentKey]", reason: "the planned Home v2 canonical instrument context route; it waits on identity and source coverage rather than borrowing a specialist passport" },
  /* 2026-10-06 — two addresses that answer with a bare 404 today; the menu's
     next release leads each to its new place. */
  { path: "/app/launch", reason: "Launch's section address: only its form, «Мої лаунчі» and each launch's page are served; the menu's next release leads it to its place without a 404" },
  { path: "/app/trade", reason: "named in Swap's route list but never served; the menu's next release leads it to «Торгувати» without a 404" },
  /* 2026-10-26 — two addresses that only a research document proposes. Both
     are written there as a proposal, with the condition they wait on, and
     neither is a claim about today's product. */
  { path: "/developers/agents", reason: "the Developers section's page for agents — API, MCP, x402, SDK and status — proposed in the agents and x402 research of 2026-10-22; DEV-1 builds the Developers surface, and the route arrives with it" },
  { path: "/app/discover", reason: "proposed by the Discovery research of 2026-10-22 as the place for market events, and written there as a proposal waiting on a decision about the navigation; the events feed shipped inside the surfaces that already exist, so nothing builds this address yet" },
];

test("every application URL a document names resolves to a real route", { skip: needsDevelopmentRepository("the documents under docs/") }, () => {
  const patterns = [...routes(), ...redirectSources()];
  const future = new Set(DECLARED_FUTURE.map((entry) => entry.path));
  const broken = [];

  for (const file of markdown()) {
    const relative = file.slice(REPO.length + 1).replace(/\\/g, "/");
    /* Archived and vendored copies are somebody else's record, and repairing
       them would be rewriting history rather than fixing a link. */
    if (relative.includes("/archive/") || relative.includes("/vendor/")) continue;

    for (const path of new Set(documentedPaths(readFileSync(file, "utf8")))) {
      const actual = normalise(path);
      if (UNPOLICED.includes(actual[0])) continue;
      if (future.has(path)) continue;
      if (patterns.some((pattern) => matches(pattern, actual))) continue;
      /* A page's Ukrainian address, `/uk` + its path, served by `middleware.ts`. */
      if (actual[0] === "uk" && hasUkAddress(`/${actual.slice(1).join("/")}`)) continue;
      broken.push(`${relative} → ${path}`);
    }
  }

  assert.deepEqual(
    broken,
    [],
    `These documents name application URLs the router does not serve:\n  ${broken.join("\n  ")}\n` +
      `A URL in a document is something a reviewer will open. Correct it, or add a redirect.`,
  );
});

test("the check rejects the exact path that four documents used to claim", () => {
  /* Proving the gate by handing it the real defect, rather than trusting that
     it would have caught it. */
  const patterns = routes();
  assert.equal(
    patterns.some((pattern) => matches(pattern, normalise("/stellar/asset/USTRY:GCRY"))),
    false,
    "no router route serves /stellar/asset/{asset} — that is why the documents were wrong",
  );
  assert.equal(
    patterns.some((pattern) => matches(pattern, normalise("/stellar/workspace/assets/USTRY:GCRY"))),
    true,
    "the real Passport route must resolve",
  );
  /* And the redirect is what makes a stale copy of the old URL harmless. */
  assert.ok(
    redirectSources().some((pattern) => matches(pattern, normalise("/stellar/asset/USTRY:GCRY"))),
    "the legacy Passport path must keep a permanent redirect",
  );
});

test("a redirect whose parameter brings its own pattern is read the way the router reads it", () => {
  /* The Markets redirect sends every old `/app/markets/<anything>` address on,
     except Markets' own Pools view. Both halves are proven against the real
     config: an old address is served by the redirect, and Pools is served by
     its page and is not taken by the redirect. */
  const markets = redirectSources().filter((pattern) => pattern.some(patterned));
  assert.ok(markets.length > 0, "the config no longer has a redirect whose parameter brings its own pattern");
  for (const address of ["/app/markets/predictions", "/app/markets/watchlist/observe", "/app/markets/AAPL"]) {
    assert.ok(markets.some((pattern) => matches(pattern, normalise(address))), `${address} is redirected, so it is served`);
  }
  for (const address of ["/app/markets/pools", "/app/markets/pools/[address]"]) {
    assert.equal(markets.some((pattern) => matches(pattern, normalise(address))), false, `${address} is Markets' own and is not redirected`);
    assert.ok(routes().some((pattern) => matches(pattern, normalise(address))), `${address} is served by its page`);
  }
});

test("the planned-route register expires entries when their routes ship", () => {
  /* An exemption that outlives that reason is how the route gate
     stops finding things: once the route ships it must leave this list, or a
     later rename of a real route would pass unnoticed. */
  const patterns = routes();
  const shipped = DECLARED_FUTURE.filter((entry) => patterns.some((pattern) => matches(pattern, normalise(entry.path))));
  assert.deepEqual(
    shipped.map((entry) => entry.path),
    [],
    `These routes exist now and must be removed from DECLARED_FUTURE: ${shipped.map((entry) => entry.path).join(", ")}`,
  );
  for (const entry of DECLARED_FUTURE) {
    assert.ok(entry.reason && entry.reason.length > 20, `${entry.path} is exempted without a reason.`);
  }
});
