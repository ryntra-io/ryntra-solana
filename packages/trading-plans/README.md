# @ryntra/trading-plans

The deterministic helpers of a Trading Plan — the rules a person writes before
they sign at [ryntra.io/app/strategies](https://ryntra.io/app/strategies). Two
parts of a plan are pure arithmetic, and those are published here: the size
of a spot-long position and the reading of a number a person typed. No
network, no storage, no order placement.

These are the modules the Ryntra product runs on, imported rather than copied:
the same `computePlanSizing` sizes the form in the browser and the stored
version on the server, so no client keeps a second financial logic.

## Sizing

```
lossPerShare        = entry − invalidation + entry × costBufferBps / 10 000
riskLimitedUnits    = plannedRiskUsd / lossPerShare
capitalLimitedUnits = (budgetUsd − reserveForCostsUsd) / entry
units               = min(riskLimitedUnits, capitalLimitedUnits)
notionalUsd         = units × entry
```

```ts
import { computePlanSizing, validatePlanRules } from "@ryntra/trading-plans";

const rules = {
  entry: { pricePerShare: 973.15, maxPricePerShare: 992.61, validUntil: "2026-10-16T12:00:00Z" },
  capital: { budgetUsd: 1000, reserveForCostsUsd: 10 },
  risk: { invalidationPerShare: 882.86, plannedRiskUsd: 100, costBufferBps: 100 },
  exit: { targetPerShare: null, timeExitAt: null },
  evidenceConditions: [],
};

validatePlanRules(rules, Date.now()); // [] — every rule holds as a rule
const result = computePlanSizing(rules, Date.now());
// result.sizing.units        0.999785   (limited by the planned risk)
// result.sizing.notionalUsd  972.94
// result.sizing.assumptions  ["The invalidation at $882.86 per share is a rule you act on, not an exit order.", …]
```

A plan whose rules fail as rules — an invalidation above the entry, a reserve
that eats the budget, an entry already expired — gets `{ ok: false, issues }`
with each issue named by its path, and no size.

The figure is a planning model under stated assumptions. A gap through the
invalidation, slippage, missing liquidity or a missed manual exit change what
is lost, and the model places no exit order; the assumptions travel with the
figure so a user interface can show them beside it.

## Decimal input

```ts
import { parseDecimalInput, decimalReadingDiffers } from "@ryntra/trading-plans";

parseDecimalInput("0,5");       // 0.5
parseDecimalInput("1 000,50");  // 1000.5
parseDecimalInput("1,234.56");  // 1234.56
parseDecimalInput("1.234,56");  // 1234.56
parseDecimalInput("");          // null — never zero
parseDecimalInput("1,23.45");   // null — refused rather than guessed

decimalReadingDiffers("0,5");   // true — show the reading beside the field
```

Spaces, apostrophes and underscores only ever group digits; one separator of
either kind is the decimal separator; when both kinds are present the later
one is the decimal separator and the other must group thousands in threes.
Anything else is `null`, never another valid number.

## Tests

```bash
node --test packages/trading-plans/src/index.test.mjs
```

Network-free; the sizing figures are computed by hand in the comments beside
them.
