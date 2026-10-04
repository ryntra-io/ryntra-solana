import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

/**
 * Both directives are pinned to their exact contents rather than merely checked
 * for a wildcard. The point is not that today's hosts are the right ones — it is
 * that adding a third-party origin to this site has to be a deliberate edit to a
 * test that says which origins are allowed and why, instead of a line quietly
 * appended to a config nobody re-reads.
 */

test("CSP allows only the two vetted remote image hosts", () => {
  /* `branding.arcus.xyz` serves market logos in the demo terminal.
     `i.ytimg.com` is the poster host of the embedded product film on the
     reviewer film page, requested only once a visitor presses play. */
  assert.match(
    config,
    /"img-src 'self' data: https:\/\/branding\.arcus\.xyz https:\/\/i\.ytimg\.com"/,
  );
  const directive = config.match(/"img-src ([^"]+)"/)?.[1] ?? "";
  assert.ok(directive, "img-src directive must exist");
  assert.doesNotMatch(directive, /\*/, "remote images must never use a wildcard allowlist");
});

test("CSP frames exactly one third-party host, and it is the no-cookie one", () => {
  /* The reviewer film page embeds the product film. `youtube-nocookie.com` rather than
     `youtube.com` is the whole point of the grant, so a change to the plain
     host has to fail here rather than pass unnoticed. */
  const directive = config.match(/"frame-src ([^"]+)"/)?.[1] ?? "";
  assert.equal(directive, "https://www.youtube-nocookie.com");
  assert.doesNotMatch(directive, /\*/, "frames must never use a wildcard allowlist");

  /* And the page must not be framed by anyone, which is a separate rule that a
     frame-src grant is easy to confuse with. */
  assert.match(config, /"frame-ancestors 'none'"/);
});

test("the AGG lab carries its own policy, and it names exactly the AGG origins", () => {
  /* `/preview/agg-lab` is the one route that reaches the prediction-market
     aggregator from the browser. Its policy is declared separately so the
     site-wide directives above stay exactly as pinned, and it is pinned here
     for the same reason they are: a third-party origin enters this site only
     by a deliberate edit to a test that says why. `api.agg.market` is the REST
     API the SDK reads and, in paper mode, trades against; `ws.agg.market` the
     live orderbook and trade feed; `assets.agg.market` the event images; the
     two CDNs the stylesheet's own Inter face and uicons glyph font. Nothing is
     framed. */
  const lab = config.match(/const AGG_LAB_CSP = \[([\s\S]*?)\]\.join/)?.[1] ?? "";
  assert.ok(lab, "next.config.ts no longer declares the AGG lab policy");
  assert.match(lab, /"img-src 'self' data: blob: https:\/\/assets\.agg\.market"/);
  assert.match(lab, /connect-src 'self' https:\/\/api\.agg\.market wss:\/\/ws\.agg\.market/);
  assert.match(lab, /"style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com https:\/\/cdn-uicons\.flaticon\.com"/);
  assert.match(lab, /"font-src 'self' data: https:\/\/fonts\.gstatic\.com https:\/\/cdn-uicons\.flaticon\.com"/);
  assert.match(lab, /"frame-src 'none'"/);
  assert.match(lab, /"frame-ancestors 'none'"/);
  assert.doesNotMatch(lab, /\*/, "the lab policy must never use a wildcard allowlist");
  assert.doesNotMatch(lab, /oauth\.telegram\.org|arcus\.xyz|robinhood\.com|stellar\.org/, "the lab policy carries the AGG origins only");

  /* And the site-wide policy is untouched by it: the lab origins appear only
     inside the lab's own array. */
  const site = config.match(/const CSP = \[([\s\S]*?)\]\.join/)?.[1] ?? "";
  assert.doesNotMatch(site, /agg\.market/, "the site-wide policy must not name the aggregator");

  /* The lab policy is bound to the lab route and to nothing wider. */
  assert.match(config, /source: "\/preview\/agg-lab", headers: \[\{ key: "Content-Security-Policy", value: AGG_LAB_CSP \}\]/);
  assert.match(config, /source: "\/preview\/agg-lab\/:path\*", headers: \[\{ key: "Content-Security-Policy", value: AGG_LAB_CSP \}\]/);
});

test("the customer Predictions route adds exactly the live feed and the event covers to the site policy, never the REST origin", () => {
  /* Customer Predictions: the browser reads the aggregator through Ryntra's
     routes and holds no provider token; only the public WebSocket (the book
     and the trades, the app id in the URL) and the venues' event covers are
     the browser's own. The policy is the site's with
     those two origins spliced in — so every other grant, and every other
     header, is the site's. */
  const line = config.match(/const PREDICTIONS_CSP = (.+);/)?.[1] ?? "";
  assert.ok(line, "PREDICTIONS_CSP must be derived from the site policy");
  assert.match(line, /^CSP\.replace\("img-src 'self' data:", "img-src 'self' data: https:\/\/assets\.agg\.market"\)\.replace\("connect-src 'self'", "connect-src 'self' wss:\/\/ws\.agg\.market"\)$/);
  assert.doesNotMatch(line, /api\.agg\.market/, "the customer policy must not open the REST origin to the browser");
  assert.match(config, /source: "\/app\/predictions", headers: \[\{ key: "Content-Security-Policy", value: PREDICTIONS_CSP \}\]/);
  assert.match(config, /source: "\/app\/predictions\/:path\*", headers: \[\{ key: "Content-Security-Policy", value: PREDICTIONS_CSP \}\]/);
});
