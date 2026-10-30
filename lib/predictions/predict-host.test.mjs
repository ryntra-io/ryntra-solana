// Run from repo root: node --test lib/predictions/predict-host.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { modifyRouteRegex } from "next/dist/lib/redirect-status.js";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination.js";
import { formatUrl } from "next/dist/shared/lib/router/utils/format-url.js";

import nextConfig from "../../next.config.ts";
import { predictHostName, predictHostRedirects } from "./predict-host.ts";

/** The first row that answers a request, as Next reads a table: path (no redirect touches `/_next`), then host. */
function firstMatch(rows, href, kind = "redirect") {
  const url = new URL(href);
  const query = Object.fromEntries(url.searchParams);
  for (const row of rows) {
    const match = getPathMatch(row.source, { strict: true, removeUnnamedParams: true, regexModifier: (regex) => modifyRouteRegex(regex, kind === "redirect" ? ["/_next"] : undefined) });
    const params = match(url.pathname);
    if (!params) continue;
    const hasParams = matchHas({ headers: { host: url.host } }, query, row.has, row.missing);
    if (!hasParams) continue;
    const { parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination: row.destination, params: { ...params, ...hasParams }, query });
    delete parsedDestination.search;
    return { row, target: new URL(formatUrl(parsedDestination), url).href };
  }
  return null;
}

async function withHost(value, body) {
  const before = process.env.NEXT_PUBLIC_RYNTRA_PREDICT_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_RYNTRA_PREDICT_URL;
  else process.env.NEXT_PUBLIC_RYNTRA_PREDICT_URL = value;
  try {
    return await body({ redirects: await nextConfig.redirects(), rewrites: (await nextConfig.rewrites()).beforeFiles });
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_RYNTRA_PREDICT_URL;
    else process.env.NEXT_PUBLIC_RYNTRA_PREDICT_URL = before;
  }
}

test("predict.ryntra.io leads into the Solana cabinet's section in one hop; only its API and the build's files answer there (NAV-6c)", async () => {
  await withHost(undefined, ({ redirects, rewrites }) => {
    assert.equal(firstMatch(rewrites, "https://predict.ryntra.io/", "rewrite"), null, "the host has no front page of its own");
    for (const [path, to] of [
      ["/", "https://ryntra.io/app/predictions"],
      ["/predict", "https://ryntra.io/app/predictions"],
      ["/predict/portfolio", "https://ryntra.io/app/predictions/portfolio"],
      ["/predict/abc123", "https://ryntra.io/app/predictions/abc123"],
      ["/app/predictions", "https://ryntra.io/app/predictions"],
      ["/app/predictions/abc123", "https://ryntra.io/app/predictions/abc123"],
      ["/app", "https://ryntra.io/app"],
      ["/app/swap", "https://ryntra.io/app/swap"],
      ["/docs/start/cabinet", "https://ryntra.io/docs/start/cabinet"],
      ["/uk", "https://ryntra.io/uk"],
      ["/predictions", "https://ryntra.io/app/predictions"],
      ["/app/stocks/BRK.B", "https://ryntra.io/app/stocks/BRK.B"],
    ]) {
      const hit = firstMatch(redirects, `https://predict.ryntra.io${path}`);
      assert.ok(hit, `${path} must not answer on predict.ryntra.io`);
      assert.equal(hit.target.replace(/\/$/, ""), to, `${path} → ${hit.target}`);
      assert.equal(hit.row.permanent, false, "the host can be taken back");
      /* On ryntra.io the section's old address is the city's Oracle since CITY-13: one more hop, and there it ends. */
      if (to.includes("/app/predictions")) {
        const oracle = firstMatch(redirects, hit.target);
        assert.match(oracle?.target ?? "", /^https:\/\/ryntra\.io\/\?open=oracle/, `${hit.target} opens the Oracle`);
        assert.equal(firstMatch(redirects, oracle.target), null, `${oracle.target} is where it ends`);
      }
    }
    for (const kept of ["/api/predictions/discover", "/api/predictions/preferences", "/favicon.ico", "/brand/logo.svg", "/_next/static/chunks/x.js"]) {
      assert.equal(firstMatch(redirects, `https://predict.ryntra.io${kept}`), null, `${kept} still answers on the host`);
    }
    /* On ryntra.io the section and the old shell's addresses open the city's Oracle (CITY-13), each in one hop. */
    assert.equal(firstMatch(redirects, "https://ryntra.io/app/predictions")?.target, "https://ryntra.io/?open=oracle");
    assert.equal(firstMatch(redirects, "https://ryntra.io/app/predictions/abc123")?.target, "https://ryntra.io/?open=oracle&market=abc123");
    assert.equal(firstMatch(redirects, "https://ryntra.io/predict")?.target, "https://ryntra.io/?open=oracle");
    assert.equal(firstMatch(redirects, "https://ryntra.io/predict/portfolio")?.target, "https://ryntra.io/?open=oracle&page=positions");
  });
});

/** The redirect table a build makes with the host named: the switch is read when the build loads its config. */
function tableBuiltWith(env) {
  const config = new URL("../../next.config.ts", import.meta.url).href;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", `const c = (await import(${JSON.stringify(config)})).default; console.log(JSON.stringify(await c.redirects()));`], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
}

test("the host named or not, its rules stay its own; once app.ryntra.io is live the host leads there", () => {
  for (const named of ["", "https://predict.ryntra.io"]) {
    const redirects = tableBuiltWith({ NEXT_PUBLIC_RYNTRA_PREDICT_URL: named, RYNTRA_APP_HOST_LIVE: "" });
    assert.equal(firstMatch(redirects, "https://ryntra.io/app/predictions/abc123")?.target, "https://ryntra.io/?open=oracle&market=abc123", "the section's old address opens its market in the Oracle");
    assert.equal(firstMatch(redirects, "https://predict.ryntra.io/predict/abc123")?.target, "https://ryntra.io/app/predictions/abc123");
  }
  const live = tableBuiltWith({ NEXT_PUBLIC_RYNTRA_PREDICT_URL: "https://predict.ryntra.io", RYNTRA_APP_HOST_LIVE: "1" });
  assert.equal(firstMatch(live, "https://predict.ryntra.io/")?.target, "https://app.ryntra.io/solana/predictions");
  assert.equal(firstMatch(live, "https://predict.ryntra.io/predict/abc123")?.target, "https://app.ryntra.io/solana/predictions/abc123");
});

test("the host's rules follow the host the deployment names", () => {
  const env = { NEXT_PUBLIC_RYNTRA_PREDICT_URL: "https://predict-staging.ryntra.io" };
  assert.equal(predictHostName({}), "predict.ryntra.io");
  assert.equal(predictHostName(env), "predict-staging.ryntra.io");
  for (const refused of ["https://evil.example", "https://app.ryntra.io", "https://ryntra.io", "https://www.ryntra.io", "https://trade.ryntra.io", "https://markets.ryntra.io"]) {
    assert.equal(predictHostName({ NEXT_PUBLIC_RYNTRA_PREDICT_URL: refused }), "predict.ryntra.io", `${refused} is not the product's host`);
  }
  for (const row of predictHostRedirects(env).filter((rule) => rule.has)) assert.equal(row.has[0].value, "predict-staging\\.ryntra\\.io");
});
