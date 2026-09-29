# @ryntra/tokenized-stocks

The model of a tokenized stock on Solana, as pure functions over facts the
caller has already read from the chain or from the issuer. No network, no
signing, no transaction building: this package answers what a stock token
*is*, what one unit of it *means*, whether a reference price is *current*,
and whether the issuer still *supports* the token — the four questions a
venue has to answer before it shows a price.

These are the modules the Ryntra product runs on at
[ryntra.io/app/stocks](https://ryntra.io/app/stocks), imported rather than
copied.

## The model

| Concern | Module | What it decides |
|---|---|---|
| Instrument | `lib/stocks/instrument.ts` | A listed equity or ETF, or pre-IPO exposure; priced per underlying share or per token; the holder's rights in the issuer's own terms |
| Transfer fee | `lib/stocks/instrument.ts` | The fee a Token-2022 mint withholds, from its own `TransferFeeConfig` and the current epoch — the older config before the newer one's epoch, the newer from then on |
| Lifecycle | `lib/stocks/instrument.ts`, `lib/stocks/lifecycle-events.ts` | Whether a new purchase is offered: a chain pause outranks a verified issuer notice, which outranks the issuer's catalogue; a conversion window is expired once the clock passes the issuer's cut-off |
| Units | `lib/stocks/units.ts` | The Scaled UI Amount multiplier as an exact ratio of integers; raw ↔ scaled amounts without a floating product on a balance; per-share prices from per-token prices; the deviation of an executable price from a reference |
| Session | `lib/stocks/session.ts` | The state of a reference price — `current`, `last-available`, `confirmed-close`, `stale`, `unavailable` — judged from the source's own observation time against the exchange session, never promoted |

## Usage

```ts
import {
  deviationPct,
  lifecycleOf,
  multiplierRatio,
  perShareExecutable,
  referenceStateOf,
  scaledAmountString,
  transferFeeOf,
} from "@ryntra/tokenized-stocks";

// A raw balance of 1_000_000 at 6 decimals under a multiplier of 1.486135
scaledAmountString(1_000_000n, 6, 1.486135); // "1.486135" — truncated, never rounded up
multiplierRatio(1.486135); // { num: 297227n, den: 200000n }

// $1,000 buys 4.668673 underlying shares: the executable per-share price and its deviation
const executable = perShareExecutable(1000, "4.668673"); // 214.19…
deviationPct(executable, 213.03); // +0.54 %

// The fee the mint withholds at epoch 1035, from the mint's two configs
transferFeeOf({ older: { epoch: "1000", basisPoints: 20, maximumFeeRaw: "18446744073709551615" }, newer: { epoch: "1035", basisPoints: 50, maximumFeeRaw: "1000000" } }, 1035n);
// { basisPoints: 50, configUsed: "NEWER", pending: null, … }

// Whether a purchase is offered: a pause, a verified issuer notice, the catalogue, or nothing
lifecycleOf({ paused: false, event: null, listedByIssuer: true, catalogueFetchedAt: "2026-09-16T11:00:00Z", chainObservedAt: null });
// { state: "active", tradable: true, source: "issuer-catalogue", … }

// A reference fetched a second ago that the feed published ten minutes ago is stale
referenceStateOf({ perShare: 213.03, observedAt: tenMinutesAgo, fetchedAt: justNow }, true, Date.now()); // "stale"
```

## What this package does not do

- It does not read the chain or any issuer. The caller supplies the mint's
  decoded extension data, the issuer's catalogue facts and the clock.
- It does not decide that a token is a good purchase. `tradable` says whether
  the issuer still supports new purchases; the issuer's mark is context, never
  a market reference; a deviation is a fact about one quote against one
  reference at one time.
- It does not hold the issuer catalogues. The lifecycle registry carries only
  verified issuer notices with their source, read time and re-check date.

## Tests

```bash
node --test packages/tokenized-stocks/src/index.test.mjs
```

Network-free; every figure in the tests is computed by hand in the comment
beside it.
