/**
 * SPACEX (UX-503, UX-504): every way to the token's page opens it — the path
 * strip on SPCXx, a holding's swap and sale, a reminder and the bell, Spot's
 * deadline line, the token's address — and none of them lands on «not
 * found», whether or not a catalogue still lists the token; the universe
 * keeps the token until the issuer's cut-off.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { issuerEventHref } from "../monitoring/inbox.ts";
import { companyPageAnswer, eventPageForMint, eventPagePath } from "./company-page-route.ts";
import { companyPathFor } from "./company-path.ts";
import { isWatched, spotDeadlineLine, swapHref } from "./conversion-watch.ts";
import { LIFECYCLE_EVENTS, lifecycleEventFor, lifecycleEventForTicker } from "./lifecycle-events.ts";
import { buildRepresentation } from "./representations.ts";
import { asWindowRepresentation, openWindowTokens, withWindowTokens } from "./universe.server.ts";

const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const SPCXX = "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8";
const XAI = "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx";
const NOW = Date.parse("2026-10-21T09:00:00.000Z");
const AFTER = Date.parse("2027-03-13T00:00:00.000Z");
const event = lifecycleEventFor(SPACEX);

/** The ticker the app's company route `app/app/stocks/[ticker]` reads from an address — the English one or its `/uk` twin (`lib/site/localized.ts`). */
function tickerOfHref(href) {
  const match = /^\/(?:uk\/)?app\/stocks\/([^/?#]+)(?:[?#].*)?$/.exec(href);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Every address in the product that leads to SPACEX's page, as each place builds it. */
function spacexWays() {
  const strip = companyPathFor({ mint: SPCXX, symbol: "SPCXx", issuerId: "xstocks", instrumentClass: "listed-equity" }, NOW);
  const stripToken = strip?.steps.find((step) => step.step === "private")?.token;
  assert.ok(stripToken, "SPCXx's strip names the private token");
  const page = eventPagePath(event);
  return {
    "path strip on SPCXx": `/app/stocks/${encodeURIComponent(stripToken.symbol)}`,
    "holding: swap": `${page}?convert=1`,
    "holding: sale": `${page}?sell=1`,
    "reminder (Telegram, email)": swapHref(event.watch.symbol),
    "the bell": issuerEventHref(SPACEX),
    "Spot's deadline line": page,
    "the token's address": eventPageForMint(SPACEX),
    "Ukrainian address": `/uk${page}`,
    "the mint itself": `/app/stocks/${SPACEX}`,
  };
}

test("every way to SPACEX names its page, and the page answers with the event whatever the catalogues say", () => {
  assert.ok(isWatched(event));
  for (const [way, href] of Object.entries(spacexWays())) {
    assert.ok(href, `${way}: an address`);
    const ticker = tickerOfHref(href);
    assert.ok(ticker, `${way}: ${href} is a company page`);
    for (const read of [{ ok: false, code: "UNKNOWN_ASSET" }, { ok: false, code: "PROVIDER" }]) {
      const answer = companyPageAnswer(ticker, read);
      assert.equal(answer.kind, "event", `${way} (${read.code}): never «not found»`);
      assert.equal(answer.event.mint, SPACEX, way);
    }
    assert.equal(companyPageAnswer(ticker, { ok: true }).kind, "company", `${way}: the full page when the universe lists it`);
  }
});

test("the swap stays one press from every way: the event's page names the swap into SPCXx until the cut-off", () => {
  assert.equal(event.watch.into?.symbol, "SPCXx");
  assert.equal(event.deadline, "2027-03-12T23:59:00.000Z");
  assert.equal(spotDeadlineLine(event, "uk", NOW), "Обміняти до 12.03.2027, інакше токен згорить · не акція");
  assert.equal(spotDeadlineLine(event, "en", NOW), "Swap by March 12, 2027 or the token expires worthless · not a share");
  assert.equal(spotDeadlineLine(event, "uk", NOW, false), "Обміняти до 12.03.2027, інакше токен згорить", "beside a rights line that already says «not a share»");
  assert.equal(spotDeadlineLine(event, "en", AFTER), "The swap deadline passed — the issuer no longer supports the token");
});

test("a ticker is read in any case, by symbol or mint; an unknown one stays «not found», a silent provider «read again»", () => {
  assert.equal(lifecycleEventForTicker("spacex")?.mint, SPACEX);
  assert.equal(lifecycleEventForTicker(SPACEX)?.mint, SPACEX);
  assert.equal(lifecycleEventForTicker("XAI")?.mint, XAI, "a closed window keeps its page too, saying so");
  assert.equal(lifecycleEventForTicker("NVDAx"), null);
  assert.equal(lifecycleEventForTicker(""), null);
  assert.deepEqual(companyPageAnswer("NVDAx", { ok: false, code: "UNKNOWN_ASSET" }), { kind: "not-found" });
  assert.deepEqual(companyPageAnswer("NVDAx", { ok: false, code: "PROVIDER" }), { kind: "unavailable" });
  assert.equal(eventPageForMint(SPCXX), null, "an ordinary mint goes on as before");
  assert.equal(tickerOfHref("/app/spot?mint=x"), null);
  assert.equal(tickerOfHref("/app/stocks/SPACEX?convert=1&from=monitoring"), "SPACEX");
});

test("the universe keeps a token in its swap window until the cut-off, as the issuer's own, and drops it after", () => {
  const kept = openWindowTokens(NOW);
  assert.deepEqual(kept.map((asset) => asset.solanaMint), [SPACEX], "XAI's window has closed");
  assert.equal(kept[0].symbol, "SPACEX");
  assert.equal(kept[0].company, "SpaceX");
  assert.equal(kept[0].mark.tokenPriceUsd, null, "no mark the registry does not state");
  assert.deepEqual(openWindowTokens(AFTER), []);
  assert.equal(openWindowTokens(NOW, LIFECYCLE_EVENTS.filter((entry) => entry.mint !== SPACEX)).length, 0);

  /* The catalogue that dropped SPACEX: the window puts it back; one that still lists it keeps its own entry. */
  const dropped = withWindowTokens(new Map(), kept);
  assert.equal(dropped.get(SPACEX)?.symbol, "SPACEX");
  const own = { ...kept[0], name: "SpaceX PreStocks", description: "issuer's own" };
  assert.equal(withWindowTokens(new Map([[SPACEX, own]]), kept).get(SPACEX), own);
  assert.equal(withWindowTokens(null, kept).get(SPACEX)?.symbol, "SPACEX", "a silent catalogue still keeps the window's token");
  assert.equal(withWindowTokens(null, []), null);

  /* The venue's verified row of the mint becomes the company's representation again. */
  const market = { mint: SPACEX, symbol: "SPACEX", name: "SpaceX PreStocks", verified: true, tags: ["verified", "prestocks"], tokenProgram: "token-2022", decimals: 9 };
  const representation = buildRepresentation(market, { xstocks: null, prestocks: dropped });
  assert.ok(representation, "SPACEX is a row of the universe again");
  assert.equal(representation.symbol, "SPACEX");
  assert.equal(representation.issuer.id, "prestocks");
  assert.equal(representation.underlying.name, "SpaceX");
  assert.equal(buildRepresentation(market, { xstocks: null, prestocks: new Map() }), null, "without the window, as on production on 21.10");
  /* Kept by the window alone: never «confirmed by the issuer's catalogue». */
  const kept0 = asWindowRepresentation(representation);
  assert.equal(kept0.issuerConfirmation, "tag-only");
  assert.deepEqual(kept0.sources, ["jupiter-verified", "issuer-event-registry"]);
  assert.equal(kept0.mint, SPACEX);
});
