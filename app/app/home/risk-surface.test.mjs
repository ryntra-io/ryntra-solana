import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * RYN-PROTECT-SIGNAL-001, subtask 2 — «Ризик портфеля» on Home (canon v5 §11):
 * the server's one word for the wallet under «Розподіл» on a wide head and
 * under the day's change on a narrow one; the reason and its one action; no
 * rule judged in the browser; never an orange of its own beside the head's
 * one orange action.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const RISK = read("./portfolio-risk.tsx");
const HOOK = read("../invest/use-portfolio-risk.ts");
const SURFACE = read("./home-surface.tsx");
const CSS = read("./home.module.css");
const LIVE = read("../stocks/[ticker]/company-live.tsx");

test("the line draws the server's verdict and decides none: no cap, no rule, no share counted in the browser", () => {
  assert.doesNotMatch(RISK, /judgePortfolioRisk|ASSET_CAP_PCT|PRIVATE_CAP_PCT|CAPS_FROM_USD|valueUsd/, "the verdict arrives from GET /api/v1/positions/risk");
  assert.match(RISK, /riskStateWord\(state, lang\)/);
  assert.match(RISK, /data-risk=\{state \?\? risk\.phase\}/);
  assert.match(HOOK, /fetch\("\/api\/v1\/positions\/risk"/);
  assert.match(HOOK, /"X-Ryntra-API": "1"/);
  /* Behind the wallet's proof, and nothing asked while the proof is looked up. */
  assert.match(HOOK, /const proven = proof\.state\.status === "proven" && proof\.state\.address === address;/);
  assert.match(HOOK, /proof\.state\.status === "idle" \|\| proof\.state\.status === "checking"/);
});

test("each reason has its one action — the sale, the company's watch, the asset, Portfolio — and the rest are quiet rows", () => {
  for (const reason of ["action", "weekend-no-limit", "concentration", "private-share"]) assert.match(RISK, new RegExp(`case "${reason}":`), reason);
  assert.match(RISK, /\$\{company\}\?sell=1/, "«Дія» opens the company with the sale");
  assert.match(RISK, /\$\{company\}\?watch=1/, "«Налаштувати» opens the company with «Ryntra попередить»");
  assert.match(LIVE, /params\.get\("watch"\) !== "1"/);
  assert.match(LIVE, /if \(watch\.action === "warn"\) setWarning\(watch\);/);
  assert.match(RISK, /\/app\/spot\?mint=/, "a coin opens its market");
  assert.match(RISK, /href: "\/app\/portfolio", word: "look"/);
  assert.match(RISK, /<Capsule caret="down" quiet>/, "«ще N» is a way to more, not an amber action");
  assert.match(RISK, /className=\{home\.riskMoreLink\}/);
  assert.doesNotMatch(RISK, /rw-btn--primary/, "the head's one orange action stays «Купити»");
  /* «Не вдалося перевірити» and a failed read offer a retry; an unconfirmed wallet, its signature — nothing moves. */
  assert.match(RISK, /data-risk-action="retry"/);
  assert.match(RISK, /onClick=\{risk\.prove\}/);
  assert.match(RISK, /<Help topic="portfolioRisk" locale=\{locale\} \/>/);
  /* «Увага» on what was read while something else was not says so, with the retry. */
  assert.match(RISK, /state === "attention" && verdict\.gaps\.length > 0/);
  assert.match(RISK, /riskWord\("restUnread", lang\)/);
  assert.match(RISK, /aria-live="polite"/);
  /* A lapsed proof asks for the signature again, never a retry into the same 401. */
  assert.match(HOOK, /response\.status === 401 \? "expired" : "failed"/);
  assert.match(HOOK, /!proven \|\| expired \? "unproven"/);
});

test("Home: the line once there is something in the wallet — under «Розподіл» on a wide head, under the change on a narrow one", () => {
  assert.match(SURFACE, /\{owned\.length > 0 \? <PortfolioRisk locale=\{locale\} place="main" \/> : null\}/);
  assert.match(SURFACE, /<PortfolioRisk locale=\{locale\} place="side" \/>\n\s*<\/div>/, "the side copy closes «Розподіл»");
  assert.match(CSS, /@container \(min-width: 640px\) \{[\s\S]*?\.riskMain \{\n\s*display: none;/, "a wide head draws only the side copy");
  /* The block's own class on every capsule control — a rule of this module cannot reach watch.module.css's hashed one. */
  assert.equal((RISK.match(/className=\{`\$\{watch\.inlineAction\} \$\{home\.riskAction\}`\}/g) ?? []).length, 4, "retry, the first reason's action, «ще N», confirm");
  assert.doesNotMatch(CSS, /\.risk[^{]*\.inlineAction/, "no rule of this module names another module's class");
  assert.match(CSS, /\.risk\[data-tone\] \.quietCapsule,\n\.risk\[data-tone\] \.riskAction:hover > \.quietCapsule \{/, "«ще N» stays quiet on a hover or a tap");
  assert.match(CSS, /:global\(\.ry-product\) \.risk \.riskAction:focus-visible \{\n\s*box-shadow: none;/, "one focus ring, on the capsule");
  assert.match(CSS, /\.head\[data-need\] \{\n\s*align-items: start;/, "opening the reasons does not move «Купити»");
});
