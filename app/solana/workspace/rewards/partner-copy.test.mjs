import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TRACK_BADGE_IDS } from "../../../../lib/growth/badges.ts";
import { partnerCopy } from "./partner-copy.ts";
import { programmeCopy } from "./programme-copy.ts";

/* «Creator partners» and the media kit say what lives and promise nothing: the share and how it is paid, never «earn». */

const flat = (value) => (typeof value === "function" ? "" : typeof value === "string" ? value : Array.isArray(value) ? value.map(flat).join(" ") : Object.values(value).map(flat).join(" "));

for (const locale of ["en", "uk"]) {
  const words = partnerCopy(locale);
  const text = flat(words) + words.posts.map((post) => post("https://ryntra.io/r/CODE")).join(" ");

  test(`${locale}: the promise is the share and how it is paid, with no word the programme forbids`, () => {
    /* Ріст 19 (UX-752): «Counted now, paid once partner payouts open» until the first test payout; then «paid in USDC». */
    const fact = programmeCopy(locale).partnerFact;
    const then = { afterDays: 180, percent: 10 };
    assert.equal(fact(20, then, "COUNTED"), locale === "uk" ? "Приведіть творця: 20% частки Ryntra з його пулу протягом 180 днів від першої комісії пулу, далі 10%. Уже рахуємо; виплатимо, щойно запрацюють виплати партнерам." : "Bring a creator: 20% of Ryntra's part of their pool for 180 days from its first fee, then 10%. Counted now, paid once partner payouts open.");
    assert.match(fact(20, then, "USDC"), locale === "uk" ? /Виплата в USDC\.$/ : /Paid in USDC\.$/);
    assert.match(fact(20, then, "PAUSED"), locale === "uk" ? /виплати на паузі\.$/ : /payouts are paused\.$/);
    for (const paidAs of ["COUNTED", "USDC", "PAUSED"]) assert.doesNotMatch(fact(20, then, paidAs), /revenue|доходу|заробля|earn/i);
    for (const post of words.posts) assert.match(post("https://ryntra.io/r/CODE"), locale === "uk" ? / #реклама$/ : / #ad$/, "a partner's post is marked as partner content");
    assert.doesNotMatch(text, /заробляй|пасивний дохід|passive income|earn a share|guarantee|гарантовано|risk-free|без ризику|safe|безпечн|airdrop|аірдроп|official partner|офіційн|\bRyn\b|вашій країні|your country/i);
  });

  test(`${locale}: every track badge has a name and what it is for; payouts are said to be closed`, () => {
    for (const id of TRACK_BADGE_IDS) {
      assert.ok(words.badge[id], id);
      assert.ok(words.badgeHow[id], id);
    }
    assert.match(words.payoutsClosed, locale === "uk" ? /ще не відкриті/ : /aren't open yet/);
    assert.match(words.adLabel, /Paid Partnership/);
    assert.equal(words.schedule("STANDARD", [{ untilDay: 180, bps: 2000 }, { untilDay: null, bps: 1000 }]).includes("20%"), true);
  });
}

test("the partner's link opens the launch, and the page shows it without the landing", () => {
  const route = readFileSync(new URL("../../../api/growth/partner/network/route.ts", import.meta.url), "utf8");
  assert.match(route, /const LAUNCH_PATH = "\/app\/launch\/new";/);
  assert.match(route, /\?to=\$\{LAUNCH_PATH\}/);
  const view = readFileSync(new URL("./partner-view.tsx", import.meta.url), "utf8");
  assert.match(view, /replace\(\/\\\?\.\*\$\/, ""\)/);
});

test("the media kit's screens are the live product's, in both languages, beside the page that shows them", () => {
  const kit = readFileSync(new URL("./kit-view.tsx", import.meta.url), "utf8");
  for (const id of ["launch", "rules", "review"]) {
    for (const locale of ["en", "uk"]) {
      assert.match(kit, new RegExp(`./kit/${id}-${locale}\.png`));
      assert.ok(readFileSync(new URL(`./kit/${id}-${locale}.png`, import.meta.url)).subarray(1, 4).toString() === "PNG");
    }
  }
  /* The brand's own marks, never a mark drawn here. */
  assert.doesNotMatch(kit.replace(/\/\*[\s\S]*?\*\//g, ""), /<svg|<path/);
});
