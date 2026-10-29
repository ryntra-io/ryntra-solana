import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Ріст 19 «Винагороди: чесно й одна картка» (аудит UX 21.10: UX-750 … UX-753), held from source:
 * - one programme of points in the app — the rank's — and one word for it: EN «points», UA «очки»; never «бали»,
 *   «поінти», «PTS», a «Level 0N» or «Ryntra Points» on a Rewards page;
 * - beside every promise, how it is paid: in USDC, counted until partner payouts open, or status only;
 * - a guest reads the programme from the rules in force, and a signed-in wallet sees one card, the rest behind «Details».
 */

const here = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const code = (file) => here(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COPY = ["rank-copy.ts", "partner-copy.ts", "league-copy.ts", "referral-copy.ts", "wallet-copy.ts", "programme-copy.ts"];
const VIEWS = ["rewards-card.tsx", "programme-card.tsx", "rank-card.tsx", "badges-card.tsx", "season-card.tsx", "partner-view.tsx", "leaderboard-view.tsx", "season-view.tsx", "kit-view.tsx"];

test("one programme of points: no second name for them on any Rewards page", () => {
  for (const file of [...COPY, ...VIEWS]) {
    const source = code(file);
    assert.doesNotMatch(source, /(?<!\p{L})бал(и|ів|ам|ами)(?!\p{L})|поінт|\bPTS\b|Ryntra Points|Points programme|\bLevel 0\d|рівень 0\d/iu, `${file} names a second programme of points`);
  }
});

test("the partner promise is a fact with its state, never «a share of revenue» alone", () => {
  for (const file of ["partner-copy.ts", "partner-view.tsx", "programme-copy.ts", "../../../promo/partners/terms/terms-copy.ts"]) {
    assert.doesNotMatch(code(file), /Share in Ryntra's revenue|Отримуй частку доходу Ryntra|Build real markets|справжні ринки/, file);
  }
  const words = code("programme-copy.ts");
  assert.match(words, /Counted now, paid once partner payouts open\./);
  assert.match(words, /Уже рахуємо; виплатимо, щойно запрацюють виплати партнерам\./);
  /* The share steps down after its first days: said wherever the share is. */
  assert.match(code("partner-pages.tsx"), /then: programme\.partnerThen/);
  assert.match(code("partner-view.tsx"), /<PartnerFact fact=\{fact\} \/>/);
  /* A Founding partner is never told the Standard steps on their own page (critic, round 4). */
  assert.match(code("partner-view.tsx"), /<PartnerFact fact=\{fact\} founding=\{page\.tier === "FOUNDING"\} \/>/);
});

test("every way a programme is paid has its mark in both languages", () => {
  const words = code("programme-copy.ts");
  const marks = [...words.matchAll(/paidAs: \{ USDC: "([^"]+)", COUNTED: "([^"]+)", PAUSED: "([^"]+)", STATUS: "([^"]+)" \}/g)];
  assert.equal(marks.length, 2, "EN and UA");
  assert.deepEqual(marks[0].slice(1), ["Paid in USDC", "Counted · payouts not open yet", "Counted · payouts paused", "Status only"]);
  assert.deepEqual(marks[1].slice(1), ["Виплата в USDC", "Рахуємо · виплати ще не відкриті", "Рахуємо · виплати на паузі", "Лише статус"]);
  /* Status that earns no money says so where it is drawn. */
  /* Not on the rank: it sets the share of a friend's trade, money (critic, round 2). */
  for (const file of ["badges-card.tsx", "season-card.tsx", "leaderboard-view.tsx", "season-view.tsx", "partner-view.tsx"]) {
    assert.match(code(file), /<PaidAsChip paidAs="STATUS" \/>/, file);
  }
});

test("the guest's card: every share from the rules in force, none written on the page", () => {
  const card = code("programme-card.tsx");
  assert.match(card, /facts\.cashbackPercent/);
  assert.match(card, /facts\.friends\.from/);
  assert.match(card, /facts\.theirFriendsPercent/);
  assert.match(card, /facts\.partnerPercent/);
  assert.match(card, /facts\.partnerPaidAs/);
  assert.match(card, /facts\.firstTen\.percent/);
  assert.match(card, /facts\.partnerThen/);
  assert.doesNotMatch(card, /\b(100|50|30|20|10|5)\s?%/, "no share is typed into the card");
  /* Every condition the rows leave out is in the card's one «Conditions», from the same facts (LINE §5: a row at rest is
     one line): the inviter earns nothing while a friend is in «First $10 back», the 90-day window, the partner steps. */
  assert.match(card, /words\.terms\.friends\(facts\.friendWindow, cap\)/);
  assert.match(card, /words\.terms\.theirFriends\(cap\)/);
  assert.match(card, /words\.terms\.partners\(facts\.partnerPercent, facts\.partnerThen\)/);
  assert.match(card, /words\.terms\.firstTen\(facts\.firstTen\.capUsd, facts\.firstTen\.days, facts\.firstTen\.walletsPerMonth\)/);
  assert.match(card, /<details className=\{styles\.programmeTerms\}>/);
  const words = code("programme-copy.ts");
  assert.match(words, /nothing while they are in First \$\$\{cap\} back/);
  assert.match(words, /нічого, поки друг у «Перших \$\$\{cap\} назад»/);
  /* Founding seats step down too: no flat Founding figure anywhere, the Terms carry them (critic, round 3). */
  assert.doesNotMatch(card + words, /founding\.percent|partnerFounding|seats|first \$\{[^}]*\} partners|перші \$\{[^}]*\} партнерів/);
  const page = code("page.tsx");
  assert.match(page, /await readGuestProgrammeNow\(\)/);
  assert.match(page, /<RewardsCard programme=\{programme\} \/>/);
  const rewards = code("rewards-card.tsx");
  /* No wallet, or one not signed in: the programme and the one way in — never a bare gate. */
  assert.match(rewards, /if \(wallet\.gate === "connect" \|\| !proven \|\| !address\) \{[\s\S]*?<ProgrammeCard/);
});

test("after the sign-in: one card of money, everything else behind «Details»", () => {
  const rewards = code("rewards-card.tsx");
  const card = rewards.slice(rewards.indexOf('id="rewards-earnings"'), rewards.indexOf("{detailsOpen ? ("));
  assert.ok(card.length > 0);
  for (const kept of ["honest.ready", "summary.available", "honest.earned", "summary.lifetime", "honest.waiting", "summary.pending", "claim()", 'aria-controls="rewards-details"']) {
    assert.ok(card.includes(kept), `the card has ${kept}`);
  }
  for (const moved of ["<RankCard", "<BadgesCard", "<SeasonCard", 'id="rewards-history"', 'id="rewards-invite"', "How rewards work", "summary.referral.link"]) {
    assert.ok(!card.includes(moved), `${moved} is behind «Details», not on the card`);
  }
  /* The region the buttons control is always in the document; its content only when asked. */
  assert.match(rewards, /<div className=\{styles\.details\} id="rewards-details" hidden=\{!detailsOpen\}>/);
  const details = rewards.slice(rewards.indexOf("{detailsOpen ? ("));
  for (const moved of ["<RankCard", "<BadgesCard", "<SeasonCard", 'id="rewards-history"', 'id="rewards-invite"']) assert.ok(details.includes(moved), moved);
  /* The friends' money is said once — in «Where it came from» — not again as tiles. */
  assert.doesNotMatch(rewards, /Earned from friends|Earned from their friends/);
});

test("each Rewards page — title, tabs and content — is one column in the middle", () => {
  const css = here("rewards.module.css");
  assert.match(css, /\.frameAction,\n\.frameWide \{[^}]*margin-inline: auto;/);
  assert.match(css, /\.frameAction \{\n  max-width: var\(--ryntra-page-action, 640px\);/);
  assert.match(code("page.tsx"), /<div className=\{styles\.frameAction\}>\s*<PageHead/);
  for (const file of ["partner-pages.tsx", "league-pages.tsx"]) {
    const source = code(file);
    assert.equal(source.match(/<div className=\{styles\.frameWide\}>\s*<header className="so-head">/g)?.length, 2, file);
  }
  /* The new quiet actions have their own class: the referral card's «.quietAction» stays as it was. */
  assert.equal(css.match(/^\.quietAction \{/gm)?.length, 1);
});
