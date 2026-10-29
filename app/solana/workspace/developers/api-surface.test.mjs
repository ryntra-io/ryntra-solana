// Run from repo root: node --test app/solana/workspace/developers/api-surface.test.mjs
//
// Everything the Developers page says about the API, checked against the
// repository rather than against itself.
//
// The page's own rule is that it names only what exists: a «coming soon» row, a
// disabled link and a documented path that is not there are the same defect, and
// the one this file is written against is the quietest of the three — a file
// path that was true when it was typed. `lib/documented-routes.test.mjs` catches
// a URL a document names; nothing catches a *file* a page names, so this does.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { needsDevelopmentRepository } from "../../../../lib/development-repository.mjs";
import { API_CONTRACT_VERSION, ERROR_CODES } from "../../../../lib/api/v1/contract.ts";
import { OPERATIONS } from "../../../../packages/ryntra-client/src/generated/contract.ts";
import { CLIENT, CONTRACT, IDEMPOTENCY, PAGING, REFUSALS, readsByTag } from "./api-surface.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const page = () => readFileSync(join(REPO, "app/solana/workspace/developers/page.tsx"), "utf8");

test("every file and folder the page names exists in this repository", { skip: needsDevelopmentRepository("the generators, the OpenAPI document and the examples the page names") }, function () {
  const named = [
    CONTRACT.source,
    CONTRACT.document,
    CONTRACT.generator,
    CONTRACT.examples,
    CONTRACT.reference,
    CLIENT.source,
    CLIENT.generator,
    CLIENT.example,
  ];
  const missing = named.filter((path) => !existsSync(join(REPO, path)));
  assert.deepEqual(missing, [], `the page names these, and they are not here: ${missing.join(", ")}`);
});

test("the runnable example really is runnable from a clean install", { skip: needsDevelopmentRepository("examples/, which the development repository keeps beside the code") }, function () {
  /* The acceptance criterion is a clean `npm install`, so the two things that
     make that true are asserted: the example declares the package as a
     dependency, and it imports it by name rather than by a path into the
     repository — an example that reaches across the checkout proves nothing
     about what an integrator gets. */
  const manifest = JSON.parse(readFileSync(join(REPO, CLIENT.example, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies), ["@ryntra/client"], "no dependency beyond the client itself");
  const declared = manifest.dependencies["@ryntra/client"];
  assert.match(declared, /^file:/, "the example installs the package from this checkout");
  assert.equal(resolve(join(REPO, CLIENT.example), declared.slice("file:".length)), join(REPO, CLIENT.source));

  const source = readFileSync(join(REPO, CLIENT.example, "quickstart.ts"), "utf8");
  assert.match(source, /from "@ryntra\/client"/, "the example must import the package by its name");
  assert.doesNotMatch(source, /from "\.\.\/\.\.\/packages\//, "importing across the checkout would not prove a clean install works");
});

test("the figures on the page are counted from the contract, not typed into it", function () {
  assert.equal(CONTRACT.version, API_CONTRACT_VERSION);
  assert.equal(REFUSALS.codes, ERROR_CODES.length);
  assert.equal(CLIENT.reads, Object.keys(OPERATIONS).length);
  assert.ok(CLIENT.reads > 0, "a developer page with no reads on it is describing nothing");

  const byTag = readsByTag();
  assert.equal(
    byTag.reduce((total, row) => total + row.count, 0),
    CLIENT.reads,
    "every read belongs to exactly one tag",
  );
  assert.ok(byTag.every((row) => row.count > 0));

  assert.ok(REFUSALS.retryable > 0 && REFUSALS.retryable < REFUSALS.codes, "some refusals are worth retrying and some are not");
  assert.ok(REFUSALS.statuses.every((status) => status >= 400 && status < 600));

  /* No figure is written out in the page's own text: a number in the markup is
     a second copy of a fact, and that is exactly how the Passport claim went
     wrong for four documents. */
  assert.doesNotMatch(page(), /\btext\("\d/, "a figure belongs in the data module, not in a sentence");
});

test("the page states the idempotency key as it is, and nothing more", function () {
  assert.equal(IDEMPOTENCY.honoured, false, "if a route starts honouring the header, this page and its catalogue copy must change with it");

  const source = page();
  assert.match(source, /IDEMPOTENCY\.honoured/, "the page must read the fact rather than assert it");
  assert.match(source, /no route reads the header/i, "the absence must be stated where a reader will see it");

  /* The honest half of the key: because no route remembers it, the client does
     not retry a write. The page says so, and the transport does it. */
  const transport = readFileSync(join(REPO, CLIENT.source, "src/transport.ts"), "utf8");
  assert.match(transport, /method === "GET" \? retries \+ 1 : 1/, "a non-GET must be attempted exactly once");
});

test("every read the page says pages really does page", function () {
  assert.ok(PAGING.reads.length > 0, "the document says at least one read pages");
  for (const operationId of PAGING.reads) {
    const spec = OPERATIONS[operationId];
    assert.ok(spec, `${operationId} is not a read the client serves`);
    assert.ok(spec.paged);
    assert.ok(spec.parameters.some((parameter) => parameter.name === PAGING.parameter), `${operationId} takes no ${PAGING.parameter}`);
  }
});

test("the page claims nothing the router does not serve", function () {
  /* Written when keys, webhooks and quotas were all absences, and kept now that DEV-2 serves them: the rule was
     never «do not mention these», it was «mention nothing this repository cannot do». So a line that names one of
     them passes either because it reads as an absence, or because the route behind it exists. Publishing has no
     route and never will — it is the owner's own act — so it stays on the absence side. */
  const source = page();
  const served = [
    [/\bapi key\b|\bcredential/i, "app/api/v1/developer/projects/[id]/keys/route.ts"],
    [/\bwebhook/i, "app/api/v1/developer/projects/[id]/endpoints/route.ts"],
    [/\bquota/i, "app/api/v1/developer/usage/route.ts"],
    [/\btariff/i, "app/api/v1/developer/plan/route.ts"],
  ];
  const absence = (line) => /not|no |never|absen|would end it/i.test(line);
  for (const [claim, route] of served) {
    const exists = existsSync(join(REPO, route));
    for (const line of source.split("\n").filter((line) => claim.test(line))) {
      assert.ok(absence(line) || exists, `the page mentions ${claim} and ${route} does not exist: ${line.trim()}`);
    }
  }
  for (const claim of [/\bnpm publish\b/i, /\bnpm i @ryntra\b/i]) {
    for (const line of source.split("\n").filter((line) => claim.test(line))) {
      assert.ok(absence(line), `the page mentions ${claim} outside an absence: ${line.trim()}`);
    }
  }
  assert.doesNotMatch(source, /coming soon/i, "dead navigation and dead prose are the same promise, and this page makes neither");
});
