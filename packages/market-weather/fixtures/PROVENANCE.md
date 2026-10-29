# Fixtures

The tests read only these files; they never touch the network.

| File | What it is |
| --- | --- |
| `meteora-dlmm-NVDAx.recorded-2026-09-21.json` | Recorded answer of `GET https://dlmm.datapi.meteora.ag/pools?…filter_by=token_x=<NVDAx> \|\| token_y=<NVDAx>`, 2026-09-21. |
| `meteora-dlmm-tOpenAI.recorded-2026-09-21.json` | The same for tOpenAI. |
| `meteora-damm-v2-NVDAx-base.recorded-2026-09-21.json` | Recorded DAMM v2 answer: NVDAx as token X. |
| `meteora-damm-v2-NVDAx-quote.recorded-2026-09-21.json` | Recorded DAMM v2 answer: NVDAx as token Y (the price is inverted). |
| `meteora-damm-v2-tOpenAI.recorded-2026-09-21.json` | Recorded DAMM v2 answer for tOpenAI, with a blacklisted pool and empty pools. |
| `jupiter-price-v3.shape.json` | Built in the shape of the Price V3 documentation. Prices match the recorded Meteora answers of the same day; moves are chosen for the tests. |
| `jupiter-tokens-v2.shape.json` | Built in the shape of the Tokens V2 documentation: four real mints, a DBC launch (`MWDemoLaunch…`), and an unverified token with a right-to-left ticker. The two `MWDemo…` mints are not real accounts. |
| `meteora-damm-v2-graduated.shape.json` | Built in the shape of a DAMM v2 pool record: the pool the demo launch graduated into. |

`*.recorded-*` files are answers as the endpoint gave them. `*.shape.json` files are built by hand in the documented
shape. They test the parsers and rules, not the market. To replace them with live recordings, run on a machine that
can reach the endpoints:

```bash
node scripts/record-fixtures.mjs
```

It writes `fixtures/live-<date>/` with GET calls only and no keys. Review the files before you commit them.
