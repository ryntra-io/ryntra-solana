import assert from "node:assert/strict";
import test from "node:test";

import { cutOffOf, noticeFinding, noticeOnPage, pageText } from "./issuer-notices.ts";
import { PRESTOCKS_PAGES } from "./issuer-pages.ts";
import { LIFECYCLE_EVENTS, lifecycleEventFor } from "./lifecycle-events.ts";

/* The banners as the issuer's product pages served them on 2026-09-25 (06:00 UTC), trimmed around the notice. */
const SPACEX_PAGE = `<div>Transparency</div><button>Get <!-- -->SpaceX<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button></div></div><div class="w-full"><div class="w-full rounded-lg bg-yellow-100 border border-yellow-300 px-4 py-3 text-sm text-yellow-900"><span class="block">⚠️ SpaceX has gone public!</span><span class="block">SpaceX PreStocks tokens must be swapped into<!-- --> <a href="https://solscan.io/token/Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8" target="_blank" rel="noopener noreferrer" class="border-b border-current font-medium">$SPCXx</a> <!-- -->or any other token before 11:59pm UTC on 12 March 2027, or they will expire worthless.<!-- --></span></div></div><div>Price Token Price</div>`;
const XAI_PAGE = `<button>Get <!-- -->xAI<svg></svg></button></div></div><div class="w-full"><div class="w-full rounded-lg bg-yellow-100"><span class="block">🚨 xAI was acquired by SpaceX.</span><span class="block">Each XAI token must be swapped into <!-- -->0.7165<!-- --> SPACEX before 11:59pm UTC on 12 September 2026, or it will expire worthless.</span></div></div><div class="hidden md:grid">`;
const QUIET_PAGE = `<div>Transparency</div><button>Get OpenAI</button><div>Price Token Price Impl Val Implied Val Premium Mark</div><script>var x = "must be swapped before 11:59pm UTC on 1 May 2026 worthless";</script>`;

const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const XAI = "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx";
const OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";

test("SpaceX's banner reads as an IPO notice with its cut-off to the minute", () => {
  const notice = noticeOnPage(SPACEX_PAGE);
  assert.ok(notice);
  assert.equal(notice.cause, "ipo");
  assert.equal(notice.deadline, "2027-03-12T23:59:00.000Z");
  assert.match(notice.text, /^SpaceX has gone public! SpaceX PreStocks tokens must be swapped into \$SPCXx or any other token before 11:59pm UTC on 12 March 2027, or they will expire worthless$/);
});

test("xAI's banner reads as an acquisition, the ratio's decimal point no end of a sentence", () => {
  const notice = noticeOnPage(XAI_PAGE);
  assert.ok(notice);
  assert.equal(notice.cause, "acquisition");
  assert.equal(notice.deadline, "2026-09-12T23:59:00.000Z");
  assert.match(notice.text, /^xAI was acquired by SpaceX\. Each XAI token must be swapped into 0\.7165 SPACEX before/);
});

test("a page without a banner carries no notice — text inside a script is not read", () => {
  assert.equal(noticeOnPage(QUIET_PAGE), null);
  assert.doesNotMatch(pageText(QUIET_PAGE), /must be swapped/);
});

test("the cut-off is read only from the issuer's own wording, and a day the month lacks is refused", () => {
  assert.equal(cutOffOf("before 11:59pm UTC on 12 March 2027"), "2027-03-12T23:59:00.000Z");
  assert.equal(cutOffOf("before 12:00am UTC on 1 June 2027"), "2027-06-01T00:00:00.000Z");
  assert.equal(cutOffOf("before 12:30pm UTC on 1 June 2027"), "2027-06-01T12:30:00.000Z");
  assert.equal(cutOffOf("before 11:59pm UTC on 31 February 2027"), null);
  assert.equal(cutOffOf("before midnight on 12 March 2027"), null);
  assert.equal(cutOffOf("before 11:59pm UTC on 12 Marchember 2027"), null);
});

test("the registry and the pages agree today, and every other shape of drift is named", () => {
  assert.equal(noticeFinding(noticeOnPage(SPACEX_PAGE), lifecycleEventFor(SPACEX)), "agrees");
  assert.equal(noticeFinding(noticeOnPage(XAI_PAGE), lifecycleEventFor(XAI)), "agrees");
  assert.equal(noticeFinding(noticeOnPage(QUIET_PAGE), lifecycleEventFor(OPENAI)), "agrees");
  /* OpenAI goes public tomorrow: the page says so before the registry does. */
  assert.equal(noticeFinding(noticeOnPage(SPACEX_PAGE), lifecycleEventFor(OPENAI)), "new-notice");
  /* The issuer moves the cut-off. */
  const moved = { ...lifecycleEventFor(SPACEX), deadline: "2027-04-12T23:59:00.000Z" };
  assert.equal(noticeFinding(noticeOnPage(SPACEX_PAGE), moved), "deadline-differs");
  /* The banner is taken down while the registry still carries the event. */
  assert.equal(noticeFinding(null, lifecycleEventFor(SPACEX)), "notice-gone");
  assert.equal(noticeFinding("unreadable", lifecycleEventFor(SPACEX)), "unreadable");
});

test("the watch reads the eight companies' pages and xAI's, and every event's page is among them", () => {
  assert.equal(PRESTOCKS_PAGES.length, 9);
  assert.deepEqual(
    PRESTOCKS_PAGES.map((page) => page.symbol),
    ["ANDURIL", "ANTHROPIC", "FIGUREAI", "KALSHI", "NEURALINK", "OPENAI", "POLYMARKET", "SPACEX", "XAI"],
  );
  for (const page of PRESTOCKS_PAGES) {
    assert.match(page.url, /^https:\/\/www\.prestocks\.com\/[a-z]+$/);
    assert.match(page.mint, /^Pre[1-9A-HJ-NP-Za-km-z]{40,41}$/);
  }
  for (const event of LIFECYCLE_EVENTS) {
    const page = PRESTOCKS_PAGES.find((row) => row.mint === event.mint);
    assert.ok(page, `${event.mint} has a page the watch reads`);
    assert.equal(page.url, event.url);
  }
});
