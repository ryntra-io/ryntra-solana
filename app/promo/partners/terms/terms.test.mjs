import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NETWORK_RULES_V1 } from "../../../../lib/rewards/network-rules.ts";
import { termsCopy } from "./terms-copy.ts";

/* The Terms say what the ledger counts by, in both languages, and nothing the programme forbids saying. */

const REQUIRED = ["base", "cap", "term", "attribution", "activated", "states", "review", "versions", "forbidden", "ads", "badges", "taxes"];

for (const locale of ["en", "uk"]) {
  const words = termsCopy(locale);
  const text = JSON.stringify(words);

  test(`${locale}: every part of the programme has its section, and the shares are the ledger's own`, () => {
    assert.deepEqual(words.sections.map((section) => section.id), REQUIRED);
    const shares = words.rates.map((rate) => rate.share);
    const S = NETWORK_RULES_V1.schedules.STANDARD;
    const F = NETWORK_RULES_V1.schedules.FOUNDING;
    assert.deepEqual(shares, [...S, ...F].map((step) => `${step.bps / 100}%`));
    assert.ok(text.includes(`${NETWORK_RULES_V1.poolCapBps / 100}%`), "the cap");
    assert.ok(text.includes(String(NETWORK_RULES_V1.holdDays)), "the hold");
    assert.ok(text.includes(String(NETWORK_RULES_V1.foundingSeats)), "the Founding seats");
    assert.ok(text.includes("$1"), "the minimum payout");
    assert.match(text, /Paid Partnership/);
    assert.match(text, /Ad»/);
  });

  test(`${locale}: no country is named, nobody is excluded, and no promise of earnings`, () => {
    assert.doesNotMatch(text, /your country|вашій країні|недоступн|not available in|KYC|юрист|lawyer/i);
    assert.doesNotMatch(text, /United States|USA|\bUK\b|Ukraine|США|Україн|Британ/);
    assert.doesNotMatch(text, /заробляй|пасивний дохід|passive income|earn a share|earn money|токен скоро|airdrop|аірдроп|\bRyn\b/i);
    /* «guaranteed» and «risk-free» appear only as what a partner may not promise. */
    const outside = words.sections.filter((section) => section.id !== "forbidden").flatMap((section) => section.lines).join(" ") + words.intro + words.promise;
    assert.doesNotMatch(outside, /guarantee|гарантовано|risk-free|без ризику/i);
    /* Ріст 19 (UX-752): the line under the title says what is paid and when — never «a share of revenue» alone. */
    assert.doesNotMatch(text, /Share in Ryntra's revenue|Отримуй частку доходу Ryntra/);
    assert.match(words.promise, locale === "uk" ? /виплата в USDC — коли виплати партнерам відкриються після першої тестової виплати/ : /paid in USDC once partner payouts open after Ryntra's first test payout/);
  });

  test(`${locale}: taxes are the recipient's`, () => {
    const taxes = words.sections.find((section) => section.id === "taxes");
    assert.match(taxes.lines.join(" "), locale === "uk" ? /отримувач/ : /yours to declare and pay/);
  });
}

test("the page names no limit by country and reads its language from the address or the reader's own choice", () => {
  const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(page, /await searchParams\)\.lang/);
  assert.match(page, /PUBLIC_LOCALE_COOKIE/);
  assert.doesNotMatch(page, /country|geo|x-vercel-ip/i);
});
