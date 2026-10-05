import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";
import { homepageModel } from "../../lib/site/homepage-model.ts";
import { POINTS_POLICY_V1, levelFor } from "../../lib/points/policy.ts";
import { REWARD_RANKS, REWARD_RULES_CURRENT } from "../../lib/rewards/rules.ts";
import { MENU_DESTINATIONS } from "../shell/domains.ts";
import { PRODUCT_ROUTES } from "../shell/product-routes.ts";
import { POINTS, POINTS_EXAMPLE, REWARDS } from "./rewards-facts.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");

/*
 * Ryntra Rewards and the close — the fourth and last block (2026-09-14).
 * What these pin: the words in both languages and the claims they may not
 * make; that the three rates on the page are the programme's own and the
 * points example sits on a level the policy has; that the panel's chip is
 * the registry's word; the one primary action, the trust line and the
 * footer folded into the same ground; and the motion rules. The look was
 * checked on rendered pages at 1440, 2560, 768 and 390 px and under reduced
 * motion before release.
 */

const STATUS_OF = { available: "AVAILABLE", building: "BUILDING", planned: "PLANNED", limited: "LIMITED" };

test("the block carries its words in both languages and claims nothing the programme does not pay", () => {
  for (const locale of ["en", "uk"]) {
    const r = HOMEPAGE_COPY[locale].rewards;
    assert.equal(r.titleLines.length, 2);
    assert.equal(r.statementLines.length, 2);
    assert.equal(r.trust.length, 3);
    assert.equal(r.loop.length, 4);
    assert.deepEqual(Object.keys(r.segments), ["fees", "points", "referral"]);
    assert.match(r.segments.fees.body, /\{rate\}/, `${locale}: the fee sentence takes its rate from the facts`);
    assert.doesNotMatch(r.segments.fees.body, /\d/, `${locale}: no rate typed into the words`);
    for (const key of ["eyebrow", "lead", "panelTitle", "example", "loopLabel", "open", "explore"]) assert.ok(r[key].length > 2, `${locale}.${key}`);
    const f = HOMEPAGE_COPY[locale].footer;
    assert.deepEqual(f.links.map((link) => link.href), ["/app/markets", "/app/autoinvest", "/app/rewards", "/docs", "/stats"]);
    /* The support page joined the legal pair on 2026-09-29 — the Android app's store listing names both. */
    assert.deepEqual(f.legal.map((link) => link.href), ["/legal/terms", "/legal/privacy", "/support"]);
    assert.match(f.copyright, /^© 2026 Ryntra$/);
  }
  /* Up to half the fee back and the referral programme stay; the close says
     whose wallet and whose signature it is. */
  const en = HOMEPAGE_COPY.en.rewards;
  assert.deepEqual(en.titleLines, ["Buy with Ryntra.", "Up to half the fee back."]);
  assert.deepEqual(en.statementLines, ["Your wallet. Your signature.", "From $1."]);
  assert.match(en.segments.fees.body, /^Get back up to \{rate\} of eligible Ryntra service fees\.$/, "always “up to”, always “eligible”");
  assert.deepEqual(en.trust, ["Solana Mainnet", "Ryntra never holds your money", "You sign every purchase"]);
  const uk = HOMEPAGE_COPY.uk.rewards;
  assert.deepEqual(uk.titleLines, ["Купуй з Ryntra.", "До половини комісії — назад."]);
  assert.deepEqual(uk.statementLines, ["Твій гаманець. Твій підпис.", "Від $1."]);
  const words = JSON.stringify([HOMEPAGE_COPY.en.rewards, HOMEPAGE_COPY.uk.rewards, HOMEPAGE_COPY.en.footer, HOMEPAGE_COPY.uk.footer]);
  for (const forbidden of [/passive income/i, /make money/i, /guarantee/i, /airdrop/i, /\bAPY\b|\bAPR\b|yield/i, /RYN token/i, /token reward/i, /investment return/i, /casino|confetti|jackpot/i, /\b\d{3,}\+/]) {
    assert.doesNotMatch(words, forbidden, `the block must not say ${forbidden}`);
  }
  /* Points are said to be what the policy says they are: no cash value, not a token. */
  assert.match(en.segments.points.note, /No cash value · not a token/);
  /* Every footer destination is a page of the site. */
  assert.ok(PRODUCT_ROUTES.some((route) => route.href === "/app/rewards"), "/app/rewards is a registered page");
  for (const id of ["home", "markets", "autoinvest"]) assert.equal(MENU_DESTINATIONS[id].href, `/app/${id}`, `/app/${id} is a destination of the menu`);
  for (const file of ["app/docs/page.tsx", "app/legal/terms/page.tsx", "app/legal/privacy/page.tsx"]) assert.ok(existsSync(new URL("../../" + file, import.meta.url)), file);
});

test("the three rates are the programme's own and the points example sits on a level the policy has", () => {
  const level1 = REWARD_RANKS.map((rank) => REWARD_RULES_CURRENT.referralL1BpsByRank[rank] / 100);
  assert.equal(REWARDS.feeSharePercent, REWARD_RULES_CURRENT.cashbackBps / 100);
  assert.equal(REWARDS.referralLevel1Percent, `${Math.min(...level1)}–${Math.max(...level1)}`);
  assert.equal(REWARDS.referralLevel2Percent, REWARD_RULES_CURRENT.referralL2Bps / 100);
  assert.equal(REWARDS.feeSharePercent, 50);
  const placed = levelFor(POINTS_POLICY_V1, POINTS_EXAMPLE);
  assert.equal(POINTS.level, placed.level);
  assert.equal(POINTS.nextAt, placed.nextAt === null ? null : Number(placed.nextAt));
  assert.equal(POINTS.total, Number(POINTS_EXAMPLE));
  assert.ok(POINTS.progress > 0 && POINTS.progress < 1, "the example sits inside its level, not on its edge");
  assert.ok(POINTS.level >= 1 && POINTS.level <= POINTS_POLICY_V1.levels.length);
  /* The page prints the facts, never its own figures. */
  const source = withoutComments(read("app/(home)/rewards.tsx"));
  assert.match(source, /r\.segments\.fees\.body\.replace\("\{rate\}", `\$\{REWARDS\.feeSharePercent\}%`\)/);
  assert.match(source, /\{REWARDS\.referralLevel1Percent\}%/);
  assert.match(source, /\{REWARDS\.referralLevel2Percent\}%/);
  assert.match(source, /String\(POINTS\.level\)\.padStart\(2, "0"\)/);
  assert.doesNotMatch(source, /\b(?:50|10|5)%/, "no rate typed into the component");
  assert.match(source, /\{r\.example\}/, "the points figure is marked as an example");
});

test("the panel's chip is the registry's word, the close has one primary action, and the footer is the landing's own on the same ground", () => {
  const route = PRODUCT_ROUTES.find((entry) => entry.id === "rewards");
  assert.equal(homepageModel("en").rewards, STATUS_OF[route.readiness]);
  assert.equal(homepageModel("en", [], []).rewards, "UNAVAILABLE", "an absent registry fails closed");
  const source = withoutComments(read("app/(home)/rewards.tsx"));
  assert.match(source, /homepageModel\(locale\)\.rewards/);
  assert.match(source, /\{c\.statuses\[status\]\}/);
  assert.match(source, /data-live=\{status === "AVAILABLE" \|\| undefined\}/);
  /* One orange button, one text link, the network's mark on the trust line. */
  assert.equal((source.match(/className=\{styles\.open\}/g) ?? []).length, 1, "one primary action");
  assert.match(source, /className=\{styles\.open\} href=\{localizedPath\("\/app\/home", locale\)\}/);
  assert.match(source, /className=\{styles\.explore\} href=\{localizedPath\("\/app\/markets", locale\)\}/);
  assert.match(source, /src="\/site\/solana-mark\.svg"/);
  assert.match(source, /<div className=\{styles\.ring\} aria-hidden="true">/);
  assert.match(source, /<div className=\{styles\.levels\} aria-hidden="true">/);
  assert.doesNotMatch(source, /framer-motion|gsap|lenis|lottie|canvas-confetti/);
  assert.doesNotMatch(source, /#[0-9A-Fa-f]{6}\b/, "no hex literal in the component");
  /* The page ends as the original design did: Rewards and the close, then the landing footer. */
  const page = read("app/(home)/homepage.tsx");
  assert.match(page, /<Questions locale=\{locale\} \/>\s*<Rewards locale=\{locale\} \/>\s*<\/main>\s*<FrozenFooter locale=\{locale\} landing \/>/);
  /* The bar carries the site's one menu and one Open Ryntra, which the
     landing wears in its own look, with the language menu and the
     theme switch like every page. */
  assert.match(page, /<PublicHeader locale=\{locale\} mainId="main-content" landing ctaTone="quiet" languageHrefs=\{LANDING_PATH\} homeHref=\{LANDING_PATH\[locale\]\} \/>/);
  const header = withoutComments(read("app/site/frozen/public-header.tsx"));
  assert.match(header, /const menu = siteMenu\(locale\);/);
  assert.match(header, /function MenuLinks\(/);
  assert.match(header, /className=\{\`\$\{styles\.openApp\}\$\{quiet\}\`\} href=\{menu\.open\.href\}/, "one Open Ryntra, quiet where the page has its own orange action");
  const copy = withoutComments(read("lib/site/homepage-copy.ts"));
  assert.match(copy, /links: copy\.footer\.links\.map\(\(link\) => \(\{ \.\.\.link, href: localizedPath\(link\.href, locale\) \}\)\),\s*open: \{ label: copy\.open, href: localizedPath\("\/app\/home", locale\) \},/, "the bar and the footer read one list, at the addresses of the reader's language");
  const footer = withoutComments(read("app/site/frozen/public-footer.tsx"));
  /* One footer everywhere: the landing's, from the same
     list the header reads; `landing` is its look, folded into the ground. */
  assert.match(footer, /const footer = siteFooter\(locale\);/);
  assert.match(footer, /className=\{landing \? `\$\{styles\.footer\} \$\{styles\.footerLanding\}` : styles\.footer\}/);
  assert.doesNotMatch(footer, /footerCompany|footerContact|footerTagline|compact/);
  assert.match(footer, /href=\{CONTACTS\.companyX\}/, "the company's X account comes from contacts");
  assert.match(footer, /href=\{GITHUB_ORGANIZATION_URL\}/);
  assert.match(footer, /src="\/brand\/ryntra-wordmark-dark\.svg"/, "the brand's wordmark, never set type");
  assert.match(footer, /src="\/brand\/ryntra-wordmark-light\.svg"/, "and its light file, since the landing follows the theme");
  assert.doesNotMatch(footer, />\s*R?YNTRA\s*</);
  const chrome = read("app/site/frozen/chrome.module.css");
  assert.match(chrome, /\.footerLanding \{ border-top: 0; background: transparent; \}/, "no band and no line under the last block");
  assert.match(read("app/(home)/landing.module.css"), /\.root \{\s*--landing-ground: color-mix\(in srgb, var\(--ry-midnight\) 30%, black\);[\s\S]*?background: var\(--landing-ground\);\s*\}/, "the one ground runs under the footer too");
});

test("the light stays inside the block and the motion is restrained: one count, a slow drift, a long breath, still under reduced motion", () => {
  const css = read("app/(home)/rewards.module.css");
  const source = withoutComments(read("app/(home)/rewards.tsx"));
  assert.match(css, /\.rewards \{[\s\S]*?background: transparent;/);
  assert.match(css, /overflow: clip;/);
  /* The bloom is centred under the block's middle and fades out well inside it; nothing lights the edges. */
  assert.match(css, /\.bloom \{[\s\S]*?top: 48%;[\s\S]*?transparent 68%\)/);
  assert.doesNotMatch(css, /at 50% 0%|at 50% 100%/, "no light meets an edge of the block");
  assert.doesNotMatch(withoutComments(css), /planet|orbit|data-ring/i, "no return to the space of the second block");
  /* Slow: the bloom drifts on a half-minute clock, the rays on minutes, the button breathes on seven seconds. */
  assert.match(css, /animation: bloomDrift 30s ease-in-out infinite alternate;/);
  assert.match(css, /animation: raysTurn 240s linear infinite;/);
  assert.match(css, /animation: breathe 7s ease-in-out infinite alternate;/);
  assert.match(css, /\.segment:hover \{ transform: translateY\(-3px\);/, "a hovered segment lifts a few pixels, no more");
  /* The counters run once, from the panel's arrival, and settle on the facts. */
  assert.match(source, /arrive\.disconnect\(\);/);
  assert.match(source, /setShare\(Math\.round\(REWARDS\.feeSharePercent \* eased\)\);/);
  assert.match(source, /setPoints\(Math\.round\(POINTS\.total \* eased\)\);/);
  assert.match(source, /useState<number>\(REWARDS\.feeSharePercent\)/, "the figures render complete without the script");
  assert.match(source, /if \(reduced\.matches\) \{\s*root\.dataset\.seen = "";\s*root\.dataset\.counted = "";\s*root\.dataset\.end = "";\s*return;/);
  /* The ring is drawn to the share, the levels light after the count. */
  assert.match(css, /transition: stroke-dashoffset 1500ms/);
  assert.match(css, /\.rewards\[data-js\]:not\(\[data-counted\]\) \.levelLine \{ transform: scaleX\(0\); \}/);
  /* Still under reduced motion; paused off screen; the reveal only once the script has the block. */
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.rewards \*, \.rewards \*::before, \.rewards \*::after \{ animation: none !important; transition: none !important; \}/);
  assert.match(css, /\.rewards\[data-js\]:not\(\[data-active\]\) \.bloom[\s\S]*?animation-play-state: paused;/);
  assert.match(css, /\.rewards\[data-js\]:not\(\[data-seen\]\) \.panel \{ opacity: 0;/);
  assert.match(source, /root\.dataset\.js = "";/);
  assert.doesNotMatch(css, /#[0-9A-Fa-f]{3,8}\b/, "no hex literal in the stylesheet");
});
