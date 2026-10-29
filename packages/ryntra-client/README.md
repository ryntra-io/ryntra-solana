# @ryntra/client

The typed client for the Ryntra API v1. Reads only.

```ts
import { createRyntraClient } from "@ryntra/client";

const ryntra = createRyntraClient({ baseUrl: "https://ryntra.io" });

const capabilities = await ryntra.read("getCapabilities");
const markets = await ryntra.read("listSpotMarkets", { limit: 10 });
const market = await ryntra.read("getSpotMarket", { mint: markets.rows[0].mint });
```

No dependency beyond `fetch`. Runs from source — no build step — so a clean
`npm install` is the whole setup. A runnable example lives at
[`examples/ryntra-client-quickstart`](../../examples/ryntra-client-quickstart).

## Where it comes from

One direction, no second list anywhere in it:

```
lib/api/v1/contract.ts          the zod schemas the routes validate with
  → scripts/api/build-openapi-v1.mjs   →  openapi/ryntra-api-v1.yaml   (OpenAPI 3.1)
  → scripts/api/build-client-v1.mjs    →  src/generated/               (this package)
```

`src/generated/` holds the read surface, the contract's error table and the
response schemas as data, plus one TypeScript type per answer. Nothing in it is
chosen by hand: the surface is `x-ryntra-client.operations` in the document,
which the document derives as *every GET it serves without a bearer*. A new
public read joins this package the moment it joins the contract, and a read the
document does not describe cannot be called from here at all.

`src/validate.ts`, `src/errors.ts`, `src/transport.ts` and `src/client.ts` are
written by hand, because those are decisions rather than transcriptions.

Run `node scripts/api/build-client-v1.mjs --check` to prove the generated half
matches the document; `packages/ryntra-client/src/generated.test.mjs` does it in
the suite.

## Reads only

Every operation is a GET the document serves without a bearer, so there is
nothing for this client to authenticate with and nothing it could authorise. It
holds no key, builds no transaction and signs nothing — not as a policy it
could relax, but because none of that code is in it. A write needs an authority
this package has no way to carry.

Three methods, and they are all reads:

| | |
|---|---|
| `read(operation, params?)` | one answer, checked against the contract |
| `pages(operation, params?)` | an async iterator over a cursor |
| `collect(operation, select, params?, pageLimit?)` | the cursor flattened by your selector |

`client.operations` is the whole surface as data — where each read asks, what it
answers with, and which ones page.

## Answers are checked

Every answer is validated against the contract's own schema before it is
returned. A 200 whose body is not the shape the document promises raises
`RyntraSchemaError`, which names the schema and every field that disagrees —
rather than handing you an object that type-checks and reads `undefined` three
levels down.

Two judgement calls are worth knowing about:

- **An unknown property is not an error.** The contract's schemas are strict,
  and that strictness is the server's, about requests it accepts. A released
  client has the opposite duty: the point of an additive contract is that adding
  a field is safe, so this validator checks everything the schema declares and
  ignores everything it does not.
- **A declared field is checked all the way down.** Glancing at the envelope and
  trusting the rest is the kind of validation that reports success while a
  caller reads nothing out of a renamed nested object.

`validate: "off"` skips the check and casts. That is the right choice only when
you have already validated the body yourself.

## Errors have classes

Five, because the five mean different things to the code that catches them:

| class | what happened | retryable |
|---|---|---|
| `RyntraTransportError` | the request never got an answer | always — nothing was decided |
| `RyntraApiError` | `/api/v1` refused, with a stable contract `code` | from the contract's table |
| `RyntraRouteError` | a route outside `/api/v1` refused, with its own `code` | 429 and 5xx |
| `RyntraProtocolError` | something answered, but not with an answer | 5xx |
| `RyntraSchemaError` | a 200 that is not the shape the contract states | never |

`retryable` is read from the contract's own error table, which this package
carries as `ERRORS`, so «can I ask again?» has one answer in one place: a 409 is
a decision and a 429 is a queue. `RyntraApiError.known` says whether the code is
one this build has heard of — a newer server may name a refusal this client
predates, and that is still an error, not a crash.

Branch on the class and the code, never on the message: the code is stable and
the message is for a person.

```ts
try {
  await ryntra.read("getSpotMarket", { mint });
} catch (failure) {
  if (failure instanceof RyntraRouteError && failure.code === "UNKNOWN_ASSET") return null;
  if (failure instanceof RyntraApiError && failure.retryable) return later();
  throw failure;
}
```

## Cursors

A page carries the cursor for the next one. There is no total and no page
number, so a reader that keeps asking until `nextCursor` is null has read
everything the server was willing to show.

```ts
for await (const page of ryntra.pages("discoverPredictions", { category: "sports" })) {
  for (const event of page.events) console.log(event.title);
}
```

The client never invents a cursor, and it stops if the server hands back one it
has already seen — a repeated cursor would otherwise spin the loop for ever.

## Retries, and the idempotency key

A GET is asked again, up to `retries` (default 2), and only on a failure the
contract's table calls retryable. `Retry-After` is obeyed when the server sends
it.

Every request that is not a GET carries `Idempotency-Key`. You may supply it,
and you should when retrying: the point of the key is that the same intent keeps
the same key, so one minted per attempt would prove nothing.
`newIdempotencyKey()` makes one.

**No route reads that header yet.** The document says so plainly —
`x-ryntra-idempotency.honouredBy` is empty — because the store that would
remember a key belongs with the developer console's API keys. The header is sent
now so the retry story is settled before the first write rather than after it,
and the honest consequence is drawn rather than papered over: **a non-GET is
never retried automatically**, because until the server remembers the key,
retrying a write is simply writing twice.

## Not published

`private: true`, version `0.1.0`. Nothing in this repository publishes it, and
the decision to — which registry, which SemVer line, which third-party notices
clear first — is made outside the code. The contract it was generated from is
`CONTRACT_VERSION`, exported from `src/generated/contract.ts`, so no copy of
that number can go stale.
