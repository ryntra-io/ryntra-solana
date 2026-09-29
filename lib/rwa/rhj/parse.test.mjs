import assert from "node:assert/strict";
import test from "node:test";

import { SOURCE_IDENTITY_FIELDS, RHJ_CACHE_WINDOW_SECONDS } from "./identity.ts";
import {
  ASSET_STATUSES,
  CORPORATE_ACTION_STATUSES,
  CORPORATE_ACTION_TYPES,
  DETAILS_KEY_BY_TYPE,
  parseAssets,
  parseCorporateActions,
  parsePrices,
  processDateText,
} from "./parse.ts";

const CONTEXT = {
  receivedAt: "2026-08-23T16:00:00.000Z",
  dataRightsState: "PUBLIC_READ",
  maxAgeSeconds: 120,
};

/* The provider's own published example, verbatim. */
const ASSETS_EXAMPLE = {
  assets: [
    {
      id: "0x0000000000000000000000000000000002c4d1ce31ec4310b2c507c921a52b70",
      tokenSymbol: "P",
      tokenName: "Everpure • Robinhood Token",
      deployments: [{ contractAddress: "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D", chainId: 4663 }],
      currentMultiplier: "1.000000000000000000",
      pendingMultiplier: "",
      logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/0x1cdad396db64bda184d5182a97dd9b3c62100b7d.png",
      tradingCapabilities: {
        fractionalTradability: "tradable",
        allDayTradability: "tradable",
        extendedHoursFractionalTradability: true,
      },
      status: "ASSET_STATUS_ACTIVE",
    },
  ],
};

const PRICES_EXAMPLE = {
  quotes: [
    {
      tokenSymbol: "AAPL",
      deployments: [{ contractAddress: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", chainId: 4663 }],
      bid: "213.45",
      ask: "213.47",
      currency: "USD",
      dailyTradingVolume: "48293710",
      isTradingHalt: false,
      generatedAt: "2026-06-23T15:53:30Z",
    },
  ],
};

const CORP_EXAMPLE = {
  corpActions: [
    {
      id: "0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649",
      type: "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
      status: "CORPORATE_ACTION_STATUS_COMPLETED",
      processDate: { year: 2026, month: 6, day: 15 },
      tokenSymbol: "AAPL",
      deployments: [{ contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", chainId: 4663 }],
      details: { forwardSplit: { underlyingSymbol: "AAPL", oldRate: "1", newRate: "4" } },
    },
  ],
};

test("the provider's own published examples parse without a single dropped row", function () {
  const assets = parseAssets(ASSETS_EXAMPLE, CONTEXT);
  const prices = parsePrices(PRICES_EXAMPLE, CONTEXT);
  const corp = parseCorporateActions(CORP_EXAMPLE, CONTEXT);

  assert.deepEqual(assets.dropped, []);
  assert.deepEqual(prices.dropped, []);
  assert.deepEqual(corp.dropped, []);
  assert.equal(assets.rows.length, 1);
  assert.equal(prices.rows.length, 1);
  assert.equal(corp.rows.length, 1);

  assert.equal(assets.rows[0].tokenSymbol, "P");
  assert.equal(assets.rows[0].deployments[0].chainId, 4663);
  assert.equal(prices.rows[0].bid, "213.45");
  assert.equal(corp.rows[0].detailsKey, "forwardSplit");
  assert.equal(corp.rows[0].details.newRate, "4");
});

test("every parsed row carries the complete source identity", function () {
  /* Structural, not by convention: the observation cannot exist without it. */
  const rows = [
    ...parseAssets(ASSETS_EXAMPLE, CONTEXT).rows,
    ...parsePrices(PRICES_EXAMPLE, CONTEXT).rows,
    ...parseCorporateActions(CORP_EXAMPLE, CONTEXT).rows,
  ];
  assert.equal(rows.length, 3);
  for (const row of rows) {
    for (const field of SOURCE_IDENTITY_FIELDS) {
      assert.ok(field in row.identity, row.identity.surfaceId + " identity is missing " + field);
    }
    assert.equal(row.identity.providerId, "robinhood-rhj");
    assert.equal(row.identity.ecosystemId, "robinhood-chain");
    assert.equal(row.identity.authoritativeness, "ISSUER");
    /* RHJ is the issuer, not a venue. Ranking it as one would put an issuer
       disclosure beside a venue quote as if they answered the same question. */
    assert.equal(row.identity.venueId, null);
  }
});

test("only a price carries a price role, and it is REFERENCE because the endpoint says so", function () {
  assert.equal(parsePrices(PRICES_EXAMPLE, CONTEXT).rows[0].identity.priceRole, "REFERENCE");
  assert.equal(parseAssets(ASSETS_EXAMPLE, CONTEXT).rows[0].identity.priceRole, null);
  assert.equal(parseCorporateActions(CORP_EXAMPLE, CONTEXT).rows[0].identity.priceRole, null);
});

test("freshness is only claimed where the endpoint actually timestamps itself", function () {
  /* /prices carries generatedAt; /assets and /corporate-actions carry no
     timestamp field at all, so their freshness is UNKNOWN rather than assumed. */
  const quote = parsePrices(PRICES_EXAMPLE, CONTEXT).rows[0];
  assert.equal(quote.identity.observedAt, "2026-06-23T15:53:30Z");
  assert.equal(quote.identity.freshnessState, "STALE", "a two-month-old quote is stale");

  assert.equal(parseAssets(ASSETS_EXAMPLE, CONTEXT).rows[0].identity.observedAt, null);
  assert.equal(parseAssets(ASSETS_EXAMPLE, CONTEXT).rows[0].identity.freshnessState, "UNKNOWN");
  assert.equal(parseCorporateActions(CORP_EXAMPLE, CONTEXT).rows[0].identity.freshnessState, "UNKNOWN");
});

test("a reading inside the published cache window is WITHIN_CACHE, not FRESH", function () {
  const payload = {
    quotes: [{ ...PRICES_EXAMPLE.quotes[0], generatedAt: "2026-08-23T15:59:55.000Z" }],
  };
  const quote = parsePrices(payload, CONTEXT).rows[0];
  /* Five seconds old against a documented 15-second cache: the provider serves
     these from a cache and says so, so "fresh" would overstate it. */
  assert.equal(quote.identity.freshnessState, "WITHIN_CACHE");
  assert.equal(quote.identity.cacheWindow, 15);
});

test("only the two endpoints that publish a cache window carry one", function () {
  /* The provider's page has a Cache/Rate-Limit table for /prices and
     /corporate-actions and none for /assets, while saying every endpoint is
     cached. So "cached, window not published" is its own fact — different from
     15 seconds and different from uncached. */
  assert.equal(RHJ_CACHE_WINDOW_SECONDS["rhj-assets"], null);
  assert.equal(RHJ_CACHE_WINDOW_SECONDS["rhj-prices"], 15);
  assert.equal(RHJ_CACHE_WINDOW_SECONDS["rhj-corporate-actions"], 3600);
});

test("an empty pendingMultiplier means nothing scheduled, and is not confused with a failed read", function () {
  const none = parseAssets(ASSETS_EXAMPLE, CONTEXT).rows[0];
  assert.equal(none.pendingMultiplier, null);
  assert.equal(none.pendingMultiplierEffectiveTime, null);

  const pending = parseAssets(
    {
      assets: [
        {
          ...ASSETS_EXAMPLE.assets[0],
          pendingMultiplier: "4.000000000000000000",
          pendingMultiplierEffectiveTime: "2026-09-01T13:30:00Z",
        },
      ],
    },
    CONTEXT,
  ).rows[0];
  assert.equal(pending.pendingMultiplier, "4.000000000000000000");
  assert.equal(pending.pendingMultiplierEffectiveTime, "2026-09-01T13:30:00Z");
});

test("tradingCapabilities keeps null, empty-string and untradable apart", function () {
  /* The provider documents all three as different answers: null = not set,
     "" = an explicit blank on allDayTradability, "untradable" = an affirmative
     no. Collapsing them loses the only distinction that matters here. */
  const rows = parseAssets(
    {
      assets: [
        { ...ASSETS_EXAMPLE.assets[0], tokenSymbol: "A", tradingCapabilities: null },
        {
          ...ASSETS_EXAMPLE.assets[0],
          tokenSymbol: "B",
          tradingCapabilities: {
            fractionalTradability: null,
            allDayTradability: "",
            extendedHoursFractionalTradability: null,
          },
        },
        {
          ...ASSETS_EXAMPLE.assets[0],
          tokenSymbol: "C",
          tradingCapabilities: {
            fractionalTradability: "untradable",
            allDayTradability: "position_closing_only",
            extendedHoursFractionalTradability: false,
          },
        },
      ],
    },
    CONTEXT,
  ).rows;

  assert.equal(rows[0].tradingCapabilities, null, "an unresolvable underlier has no capabilities object");
  assert.equal(rows[1].tradingCapabilities.fractionalTradability, null);
  assert.equal(rows[1].tradingCapabilities.allDayTradability, "", "the explicit blank must survive");
  assert.equal(rows[1].tradingCapabilities.extendedHoursFractionalTradability, null);
  assert.equal(rows[2].tradingCapabilities.fractionalTradability, "untradable");
  assert.equal(rows[2].tradingCapabilities.extendedHoursFractionalTradability, false);
});

test("a zero daily volume is absence, not a zero", function () {
  /* Documented: "0" when unavailable. A stablecoin or a thin token showing a
     literal 0 reads as "no one trades this", which is a different claim. */
  const rows = parsePrices(
    { quotes: [{ ...PRICES_EXAMPLE.quotes[0], dailyTradingVolume: "0" }] },
    CONTEXT,
  ).rows;
  assert.equal(rows[0].dailyTradingVolume, null);
  assert.notEqual(rows[0].dailyTradingVolume, 0);
});

test("a quote with no generatedAt is dropped rather than carried unageable", function () {
  const result = parsePrices(
    { quotes: [{ ...PRICES_EXAMPLE.quotes[0], generatedAt: undefined }] },
    CONTEXT,
  );
  assert.equal(result.rows.length, 0);
  assert.match(result.dropped[0], /generatedAt/);
});

test("an asset with no readable multiplier is dropped rather than defaulted to 1.0", function () {
  const result = parseAssets(
    { assets: [{ ...ASSETS_EXAMPLE.assets[0], currentMultiplier: undefined }] },
    CONTEXT,
  );
  assert.equal(result.rows.length, 0);
  assert.match(result.dropped[0], /currentMultiplier/);
});

test("a float instead of decimal text is refused, never coerced", function () {
  const result = parsePrices({ quotes: [{ ...PRICES_EXAMPLE.quotes[0], bid: 213.45 }] }, CONTEXT);
  assert.equal(result.rows.length, 0);
  assert.match(result.dropped[0], /decimal/);
});

test("one bad row does not blank the surface", function () {
  const result = parseAssets(
    { assets: [{ nonsense: true }, ASSETS_EXAMPLE.assets[0]] },
    CONTEXT,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.dropped.length, 1);
});

test("every documented corporate action type maps to exactly one details key", function () {
  for (const type of CORPORATE_ACTION_TYPES) {
    const key = DETAILS_KEY_BY_TYPE[type];
    if (type === "CORPORATE_ACTION_TYPE_UNSPECIFIED") {
      assert.equal(key, null);
      continue;
    }
    assert.equal(typeof key, "string", type + " has no details key");
  }
  const keys = Object.values(DETAILS_KEY_BY_TYPE).filter(function (k) { return k !== null; });
  assert.equal(new Set(keys).size, keys.length, "two types share one details key");
});

test("an unrecognised corporate action type is dropped loudly, not silently unspecified", function () {
  /* The provider marks nine types forward-compatible and may add more. Mapping
     an unknown one to UNSPECIFIED would turn a new corporate action into a row
     that renders as "no action", which is the failure this endpoint exists to
     prevent. */
  const result = parseCorporateActions(
    { corpActions: [{ ...CORP_EXAMPLE.corpActions[0], type: "CORPORATE_ACTION_TYPE_TIME_TRAVEL" }] },
    CONTEXT,
  );
  assert.equal(result.rows.length, 0);
  assert.match(result.dropped[0], /TIME_TRAVEL/);
});

test("all nine forward-compatible types parse today, before they are ever sent", function () {
  const rows = parseCorporateActions(
    {
      corpActions: CORPORATE_ACTION_TYPES.filter(function (t) {
        return t !== "CORPORATE_ACTION_TYPE_UNSPECIFIED";
      }).map(function (type, index) {
        return {
          ...CORP_EXAMPLE.corpActions[0],
          id: "0x" + String(index).padStart(64, "0"),
          type,
          details: { [DETAILS_KEY_BY_TYPE[type]]: { underlyingSymbol: "AAPL" } },
        };
      }),
    },
    CONTEXT,
  );
  assert.equal(rows.dropped.length, 0);
  assert.equal(rows.rows.length, CORPORATE_ACTION_TYPES.length - 1);
});

test("a missing processDate stays missing and never becomes today", function () {
  const rows = parseCorporateActions(
    {
      corpActions: [
        {
          ...CORP_EXAMPLE.corpActions[0],
          status: "CORPORATE_ACTION_STATUS_IN_PROGRESS",
          processDate: null,
        },
      ],
    },
    CONTEXT,
  ).rows;
  assert.equal(rows[0].processDate, null);
  assert.equal(processDateText(rows[0].processDate), null);
  assert.equal(processDateText({ year: 2026, month: 6, day: 15 }), "2026-06-15");
});

test("an unknown status degrades to UNSPECIFIED, which the enum already carries", function () {
  const rows = parseCorporateActions(
    { corpActions: [{ ...CORP_EXAMPLE.corpActions[0], status: "SOMETHING_NEW" }] },
    CONTEXT,
  ).rows;
  assert.equal(rows[0].status, "CORPORATE_ACTION_STATUS_UNSPECIFIED");
  assert.ok(CORPORATE_ACTION_STATUSES.includes(rows[0].status));
  assert.ok(ASSET_STATUSES.includes("ASSET_STATUS_UNSPECIFIED"));
});

test("a response missing its array says so instead of rendering as empty", function () {
  assert.match(parseAssets({}, CONTEXT).dropped[0], /assets/);
  assert.match(parsePrices(null, CONTEXT).dropped[0], /quotes/);
  assert.match(parseCorporateActions("nope", CONTEXT).dropped[0], /corpActions/);
});
