import assert from "node:assert/strict";
import test from "node:test";

import {
  combinedAudience,
  googleConfigured,
  projectInsights,
  projectSeoInventory,
  sanitizeInsightPayload,
} from "./insights.ts";

test("the three truth sources stay separate and have no combined audience", () => {
  const model = projectInsights({ cta14d: 12 });
  assert.equal(model.firstParty.source, "first_party");
  assert.equal(model.ga4.source, "ga4");
  assert.equal(model.searchConsole.source, "search_console");
  assert.equal(combinedAudience(model), null);
  assert.equal(model.firstParty.events.find((row) => row.name === "telegram_cta_click")?.count, 12);
});

test("missing Google credentials are unconfigured, not a measured zero", () => {
  const model = projectInsights({});
  assert.equal(model.ga4.status, "unconfigured");
  assert.equal(model.searchConsole.status, "unconfigured");
  assert.equal(model.ga4.reason, "no_server_credentials");
  assert.equal("visitors" in model.ga4, false);
  assert.deepEqual(googleConfigured({}), { ga4: false, searchConsole: false });
});

test("a present property without a live read is unknown, not zero", () => {
  const model = projectInsights({
    env: { GA4_PROPERTY_ID: "properties/1", GSC_SITE_URL: "sc-domain:ryntra.io" },
  });
  assert.equal(model.ga4.status, "unknown");
  assert.equal(model.searchConsole.status, "unknown");
});

test("insight payloads drop wallet, P&L and trade size", () => {
  assert.deepEqual(
    sanitizeInsightPayload({ workspace: "solana", pnl: 9, wallet_address: "0xabc", paperActions: 2 }),
    { workspace: "solana", paperActions: 2 },
  );
});

test("SEO inventory never invents a score and records admin as not indexed", () => {
  const inventory = projectSeoInventory({
    urls: [
      { lastModified: "2026-08-04T00:00:00.000Z" },
      { lastModified: new Date("2026-07-19T00:00:00.000Z") },
    ],
    robotsDisallow: ["/api/", "/admin", "/app/"],
  });
  assert.equal(inventory.sitemapUrlCount, 2);
  assert.equal(inventory.adminIndexed, false);
  assert.equal(inventory.treatsPriorityAsRank, false);
  assert.equal(inventory.robotsDisallowAdmin, true);
  assert.equal("score" in inventory, false);
});
