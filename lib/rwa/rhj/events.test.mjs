import assert from "node:assert/strict";
import test from "node:test";

import { ATTENTION_SEVERITIES } from "../../home/portfolio/attention.ts";
import { CHANGE_KINDS } from "../../home/research/change.ts";
import { rhjIdentity } from "./identity.ts";
import { parseAssets, parseCorporateActions, parsePrices } from "./parse.ts";
import {
  RHJ_EVENT_CATALOGUE,
  RHJ_EVENT_KINDS,
  armable,
  deriveRhjEvents,
  eventDefinition,
} from "./events.ts";

const ASOF = "2026-08-23T16:00:00.000Z";
const CONTEXT = { receivedAt: ASOF, dataRightsState: "PUBLIC_READ", maxAgeSeconds: 120 };

function assets(overrides = {}) {
  return parseAssets(
    {
      assets: [
        {
          id: "0x" + "a".repeat(64),
          tokenSymbol: "AAPL",
          tokenName: "Apple • Robinhood Token",
          deployments: [{ contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", chainId: 4663 }],
          currentMultiplier: "1.000000000000000000",
          pendingMultiplier: "",
          logoUrl: null,
          tradingCapabilities: {
            fractionalTradability: "tradable",
            allDayTradability: "tradable",
            extendedHoursFractionalTradability: true,
          },
          status: "ASSET_STATUS_ACTIVE",
          ...overrides,
        },
      ],
    },
    CONTEXT,
  ).rows;
}

function quotes(overrides = {}) {
  return parsePrices(
    {
      quotes: [
        {
          tokenSymbol: "AAPL",
          deployments: [{ contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", chainId: 4663 }],
          bid: "310.4250",
          ask: "310.4300",
          currency: "USD",
          dailyTradingVolume: "48293710",
          isTradingHalt: false,
          generatedAt: ASOF,
          ...overrides,
        },
      ],
    },
    CONTEXT,
  ).rows;
}

function corporateActions(overrides = {}) {
  return parseCorporateActions(
    {
      corpActions: [
        {
          id: "0x" + "c".repeat(64),
          type: "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
          status: "CORPORATE_ACTION_STATUS_IN_PROGRESS",
          processDate: { year: 2026, month: 9, day: 1 },
          tokenSymbol: "AAPL",
          deployments: [{ contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", chainId: 4663 }],
          details: { forwardSplit: { underlyingSymbol: "AAPL", oldRate: "1", newRate: "4" } },
          ...overrides,
        },
      ],
    },
    CONTEXT,
  ).rows;
}

function executable(value, currency = "USD") {
  return [
    {
      tokenSymbol: "AAPL",
      value,
      currency,
      identity: rhjIdentity({
        surfaceId: "rhj-prices",
        instrumentId: "AAPL",
        productType: "STOCK_TOKEN",
        priceRole: "EXECUTABLE",
        observedAt: ASOF,
        receivedAt: ASOF,
        dataRightsState: "PUBLIC_READ",
        maxAgeSeconds: 120,
        venueId: "arcus",
      }),
    },
  ];
}

function derive(overrides = {}) {
  return deriveRhjEvents({
    asOf: ASOF,
    assets: assets(),
    quotes: quotes(),
    corporateActions: [],
    executable: [],
    onchainMultipliers: [],
    venueMarkets: null,
    baselines: [],
    divergenceBps: 50,
    ...overrides,
  });
}

const baseline = (overrides = {}) => ({
  tokenSymbol: "AAPL",
  status: null,
  isTradingHalt: null,
  tradingCapabilities: null,
  currentMultiplier: null,
  corporateActionIds: null,
  contractAddresses: null,
  venueMarkets: null,
  ...overrides,
});

test("every named kind is registered exactly once, with a vocabulary the Radar already speaks", function () {
  assert.equal(RHJ_EVENT_CATALOGUE.length, RHJ_EVENT_KINDS.length);
  const seen = new Set();
  for (const definition of RHJ_EVENT_CATALOGUE) {
    assert.ok(RHJ_EVENT_KINDS.includes(definition.kind), definition.kind + " is not in the union");
    assert.ok(!seen.has(definition.kind), definition.kind + " is registered twice");
    seen.add(definition.kind);
    /* The Radar renders `ChangeKind` and sorts by `AttentionSeverity`. An event
       carrying a word from neither vocabulary would render as nothing at all. */
    assert.ok(CHANGE_KINDS.includes(definition.changeKind), definition.kind + " has an unknown changeKind");
    assert.ok(ATTENTION_SEVERITIES.includes(definition.severity), definition.kind + " has an unknown severity");
  }
  assert.equal(seen.size, 12, "the catalogue names twelve event kinds");
});

test("a kind that needs a baseline says exactly what would let it fire, and a single-read kind does not", function () {
  for (const definition of RHJ_EVENT_CATALOGUE) {
    if (definition.derivation === "BASELINE_REQUIRED") {
      assert.equal(typeof definition.requires, "string", definition.kind + " is silent about why it cannot fire");
      assert.ok(definition.requires.length > 20, definition.kind + " gives no usable reason");
    } else {
      assert.equal(definition.requires, null, definition.kind + " claims a blocker it does not have");
    }
  }
});

test("without a baseline exactly the four single-read kinds are armable", function () {
  const armed = RHJ_EVENT_KINDS.filter(function (kind) { return armable(kind, false); });
  assert.deepEqual([...armed].sort(), [
    "MULTIPLIER_CHANGED",
    "REFERENCE_EXECUTABLE_DIVERGENCE",
    "SOURCE_CONFLICT",
    "SOURCE_STALE",
  ]);
  /* With a baseline all twelve arm — the engine is complete, the deployment is
     what is missing, and the day persistence exists nothing here is rewritten. */
  for (const kind of RHJ_EVENT_KINDS) {
    assert.equal(armable(kind, true), true, kind + " cannot fire even with a baseline");
  }
});

test("a scheduled multiplier fires with no memory at all, because the issuer declares it", function () {
  const events = derive({
    assets: assets({ pendingMultiplier: "4.000000000000000000", pendingMultiplierEffectiveTime: "2026-09-01T13:30:00Z" }),
  });
  const found = events.filter(function (e) { return e.kind === "MULTIPLIER_CHANGED"; });
  assert.equal(found.length, 1);
  assert.equal(found[0].previous, "1.000000000000000000");
  assert.equal(found[0].current, "4.000000000000000000");
  assert.equal(found[0].severity, "CRITICAL");
  assert.match(found[0].summary, /2026-09-01T13:30:00Z/);
  assert.equal(found[0].identities.length, 1, "the event must name its source");
});

test("an empty pendingMultiplier raises nothing, and neither does one equal to current", function () {
  assert.equal(derive().filter(function (e) { return e.kind === "MULTIPLIER_CHANGED"; }).length, 0);
  const equal = derive({ assets: assets({ pendingMultiplier: "1.0" }) });
  assert.equal(
    equal.filter(function (e) { return e.kind === "MULTIPLIER_CHANGED"; }).length,
    0,
    "a pending multiplier equal to the current one is not a change",
  );
});

test("the off-chain and on-chain multiplier disagreeing is a conflict that keeps both values", function () {
  const events = derive({
    onchainMultipliers: [{ tokenSymbol: "AAPL", value: "1.000566080061", sourceId: "robinhood-chain-uiMultiplier" }],
  });
  const conflict = events.find(function (e) { return e.kind === "SOURCE_CONFLICT"; });
  assert.ok(conflict, "a multiplier disagreement must surface");
  assert.equal(conflict.conflict.length, 2);
  assert.equal(conflict.current, null, "a conflict has no single current value");
  const values = conflict.conflict.map(function (c) { return c.value; }).sort();
  assert.deepEqual(values, ["1.000000000000000000", "1.000566080061"]);
  assert.match(conflict.summary, /neither is reconciled/);
});

test("equal multipliers across sources raise nothing, whatever their scale", function () {
  const events = derive({
    onchainMultipliers: [{ tokenSymbol: "AAPL", value: "1.0", sourceId: "robinhood-chain-uiMultiplier" }],
  });
  assert.equal(events.filter(function (e) { return e.kind === "SOURCE_CONFLICT"; }).length, 0);
});

test("a divergence is measured only after the multiplier converts the two bases", function () {
  /*
   * The REST quote is the raw underlying share; a venue quote is the token.
   * With a unity multiplier a 1% gap is a real 1% gap.
   */
  const events = derive({ executable: executable("313.5000") });
  const found = events.find(function (e) { return e.kind === "REFERENCE_EXECUTABLE_DIVERGENCE"; });
  assert.ok(found, "a 99 bps gap past a 50 bps threshold must fire");
  assert.ok(Math.abs(found.measuredBps) >= 50);
  assert.equal(found.identities.length, 2, "both sides must be named");
  assert.match(found.summary, /underlying share|token/);
});

test("a gap inside the threshold does not fire", function () {
  const events = derive({ executable: executable("310.4300") });
  assert.equal(events.filter(function (e) { return e.kind === "REFERENCE_EXECUTABLE_DIVERGENCE"; }).length, 0);
});

test("with no asset there is no multiplier, so the divergence refuses instead of guessing", function () {
  /* The failure this guards is the quiet one: an unread multiplier treated as
     1.0 produces a comparison that looks entirely ordinary and is wrong by the
     whole corporate-action history of the token. */
  const events = deriveRhjEvents({
    asOf: ASOF,
    assets: [],
    quotes: quotes(),
    corporateActions: [],
    executable: executable("313.5000"),
    onchainMultipliers: [],
    venueMarkets: null,
    baselines: [],
    divergenceBps: 50,
  });
  assert.equal(events.filter(function (e) { return e.kind === "REFERENCE_EXECUTABLE_DIVERGENCE"; }).length, 0);
  const conflict = events.find(function (e) { return e.kind === "SOURCE_CONFLICT"; });
  assert.ok(conflict, "an unmeasurable divergence must be stated, not silently skipped");
  assert.match(conflict.summary, /multiplier/);
});

test("a currency mismatch refuses rather than comparing two different monies", function () {
  const events = derive({ executable: executable("290.0000", "EUR") });
  const conflict = events.find(function (e) { return e.kind === "SOURCE_CONFLICT"; });
  assert.ok(conflict);
  assert.match(conflict.summary, /different currencies/);
});

test("a stale quote raises SOURCE_STALE against its own generatedAt", function () {
  const events = derive({ quotes: quotes({ generatedAt: "2026-08-23T15:00:00.000Z" }) });
  const stale = events.find(function (e) { return e.kind === "SOURCE_STALE"; });
  assert.ok(stale, "an hour-old quote against a 120-second policy is stale");
  assert.equal(stale.current, "2026-08-23T15:00:00.000Z");
});

test("with no baseline none of the eight transitions fire, however much changed", function () {
  /* Every input below would be a transition against a previous read. Without
     one, the honest answer is silence rather than a first-sighting reported as
     a change. */
  const events = deriveRhjEvents({
    asOf: ASOF,
    assets: assets({ status: "ASSET_STATUS_INACTIVE" }),
    quotes: quotes({ isTradingHalt: true }),
    corporateActions: corporateActions(),
    executable: [],
    onchainMultipliers: [],
    venueMarkets: ["AAPL-USD"],
    baselines: [],
    divergenceBps: 50,
  });
  const transitions = events.filter(function (e) {
    return eventDefinition(e.kind).derivation === "BASELINE_REQUIRED";
  });
  assert.deepEqual(transitions, [], "a transition without a baseline is not observable");
});

test("given a baseline, each of the eight transitions fires on its own input", function () {
  const cases = [
    {
      kind: "ASSET_STATUS_CHANGED",
      input: { assets: assets({ status: "ASSET_STATUS_INACTIVE" }), baselines: [baseline({ status: "ASSET_STATUS_ACTIVE" })] },
    },
    {
      kind: "TRADING_HALT_STARTED",
      input: { quotes: quotes({ isTradingHalt: true }), baselines: [baseline({ isTradingHalt: false })] },
    },
    {
      kind: "TRADING_HALT_ENDED",
      input: { quotes: quotes({ isTradingHalt: false }), baselines: [baseline({ isTradingHalt: true })] },
    },
    {
      kind: "TRADABILITY_CHANGED",
      input: {
        assets: assets({
          tradingCapabilities: {
            fractionalTradability: "untradable",
            allDayTradability: "tradable",
            extendedHoursFractionalTradability: true,
          },
        }),
        baselines: [
          baseline({
            tradingCapabilities: {
              fractionalTradability: "tradable",
              allDayTradability: "tradable",
              extendedHoursFractionalTradability: true,
            },
          }),
        ],
      },
    },
    {
      kind: "CORPORATE_ACTION_ADDED",
      input: { corporateActions: corporateActions(), baselines: [baseline({ corporateActionIds: [] })] },
    },
    {
      kind: "CONTRACT_DEPLOYMENT_CHANGED",
      input: { baselines: [baseline({ contractAddresses: ["0x0000000000000000000000000000000000000001"] })] },
    },
    {
      kind: "VENUE_MARKET_LISTED",
      input: { venueMarkets: ["AAPL-USD"], baselines: [baseline({ venueMarkets: [] })] },
    },
    {
      kind: "VENUE_MARKET_REMOVED",
      input: { venueMarkets: [], baselines: [baseline({ venueMarkets: ["AAPL-USD"] })] },
    },
  ];

  for (const testCase of cases) {
    const events = derive(testCase.input);
    const found = events.filter(function (e) { return e.kind === testCase.kind; });
    assert.equal(found.length, 1, testCase.kind + " did not fire on its own input");
    assert.ok(found[0].dedupeKey.startsWith(testCase.kind), testCase.kind + " has a mismatched dedupe key");
  }
});

test("an unchanged baseline raises no transition at all", function () {
  const events = derive({
    baselines: [
      baseline({
        status: "ASSET_STATUS_ACTIVE",
        isTradingHalt: false,
        contractAddresses: ["0xaf3d76f1834a1d425780943c99ea8a608f8a93f9"],
        corporateActionIds: [],
        venueMarkets: [],
      }),
    ],
    venueMarkets: [],
  });
  assert.deepEqual(events, [], "nothing changed, so nothing may be reported");
});

test("an unrecorded baseline field cannot invent a transition", function () {
  /*
   * The regression for the defect this suite found. A baseline captured without
   * `tradingCapabilities` used to report a change from "unresolved" on the very
   * next read, because absence-of-record and absence-of-capabilities were the
   * same value. `null` means not recorded, on every field, and a field nobody
   * recorded cannot have moved.
   */
  const events = derive({
    baselines: [baseline({ status: "ASSET_STATUS_ACTIVE", tradingCapabilities: null })],
  });
  assert.equal(
    events.filter(function (e) { return e.kind === "TRADABILITY_CHANGED"; }).length,
    0,
    "an unrecorded baseline field must not produce a change",
  );
});

test("a tradability field moving between null, blank and untradable is three different changes", function () {
  /* The provider gives all three their own meaning, so folding them together
     would hide a real move from unset to an affirmative "not tradable". */
  const seen = new Set();
  for (const value of [null, "", "untradable"]) {
    const events = derive({
      assets: assets({
        tradingCapabilities: {
          fractionalTradability: "tradable",
          allDayTradability: value,
          extendedHoursFractionalTradability: true,
        },
      }),
      baselines: [
        baseline({
          tradingCapabilities: {
            fractionalTradability: "tradable",
            allDayTradability: "tradable",
            extendedHoursFractionalTradability: true,
          },
        }),
      ],
    });
    const found = events.find(function (e) { return e.kind === "TRADABILITY_CHANGED"; });
    assert.ok(found, "moving allDayTradability to " + JSON.stringify(value) + " must be a change");
    seen.add(found.current);
  }
  assert.equal(seen.size, 3, "the three states must render as three distinct values");
});

test("every emitted event carries a source identity, except a venue fact which never borrows one", function () {
  const events = derive({
    assets: assets({ pendingMultiplier: "4.0", pendingMultiplierEffectiveTime: "2026-09-01T13:30:00Z" }),
    executable: executable("313.5000"),
    venueMarkets: ["AAPL-USD"],
    baselines: [baseline({ venueMarkets: [] })],
  });
  assert.ok(events.length >= 3);
  for (const event of events) {
    if (event.kind === "VENUE_MARKET_LISTED" || event.kind === "VENUE_MARKET_REMOVED") {
      /* Attaching the issuer's provenance to a venue observation would
         misattribute it, so these carry none rather than the wrong one. */
      assert.deepEqual(event.identities, []);
      continue;
    }
    assert.ok(event.identities.length >= 1, event.kind + " is anonymous");
    for (const identity of event.identities) {
      assert.equal(identity.providerId, "robinhood-rhj");
    }
  }
});

test("no event carries a reconciled figure for a fact its sources disagree about", function () {
  const events = derive({
    onchainMultipliers: [{ tokenSymbol: "AAPL", value: "1.000566080061", sourceId: "chain" }],
  });
  for (const event of events) {
    if (event.conflict.length === 0) continue;
    assert.equal(event.current, null, event.kind + " published a single value for a disputed fact");
    assert.equal(event.measuredBps, null, event.kind + " measured a disputed fact");
  }
});
