import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Нагляд's states where a position is drawn: the company page under «Твоя
 * позиція», Portfolio under each company row, and Нагляд's own «Твої
 * позиції». One line, one action, decided by the server; never an orange of
 * their own beside the page's one orange action.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const WATCH = read("./position-watch.tsx");
const HOOK = read("./use-positions.ts");
const LIVE = read("../stocks/[ticker]/company-live.tsx");
const HOLDINGS = read("../../solana/workspace/holdings/holdings-card.tsx");
const ALERTS = read("../alerts/monitoring-view.tsx");
const CSS = read("./watch.module.css");

test("the line draws the server's state and decides none: no rule, no threshold, no price judged in the browser", () => {
  assert.doesNotMatch(WATCH, /judgeWatch|NEAR_LIMIT_PCT|ABOVE_EXCHANGE_PCT/, "the state arrives from GET /api/v1/positions");
  assert.match(WATCH, /watchStateWord\(view\.state, lang\)/);
  assert.match(WATCH, /data-watch=\{view\.state\}/);
  assert.match(HOOK, /fetch\("\/api\/v1\/positions"/);
  assert.match(HOOK, /"X-Ryntra-API": "1"/);
  /* Behind the wallet's proof: a position's exit is the wallet's own record. */
  assert.match(HOOK, /const proven = proof\.state\.status === "proven" && proof\.state\.address === address;/);
});

test("each state has its one action: the sale, the sheet, the channel, the pause's details, a look — and «Все за планом» none", () => {
  for (const action of ["open-sale", "look", "warn", "connect-telegram", "details"]) assert.match(WATCH, new RegExp(`case "${action}":`), action);
  assert.match(WATCH, /href="\/app\/settings#account"/, "«Підключи Telegram» goes where Telegram is connected");
  assert.match(WATCH, /place === "page" \? null/, "on the company's own page there is nothing more to look at");
  assert.match(WATCH, /ISSUER_PAUSED_DETAILS\[lang\]/);
  /* «Ryntra попередить» is turned on by the server from the price now: the sheet sends the preset, never a figure. */
  assert.match(WATCH, /body: JSON\.stringify\(\{ mint: view\.mint, preset, locale: lang \}\)/);
  assert.match(WATCH, /code === "CHANNEL_REQUIRED"/);
});

test("the company page: the line under «Твоя позиція», the sale opening from a warning's link, one sale action on the block", () => {
  assert.match(LIVE, /<WatchLine\n\s+view=\{watch\}\n\s+locale=\{locale\}\n\s+place="page"/);
  assert.match(LIVE, /params\.get\("sell"\) !== "1"/);
  assert.match(LIVE, /const saleInLine = canSell && \(watch\?\.action === "open-sale" \|\| watch\?\.state === "issuer-paused"\);/, "«Пауза емітента»: nothing can be sold now");
  assert.match(LIVE, /\{canSell && !saleInLine \? \(/, "«Дія»'s «Відкрити продаж» is the block's one sale");
  assert.doesNotMatch(LIVE, /rw-btn--primary/, "the page's one orange action stays «Купити»");
});

test("Portfolio: the state is a line of the position itself under its name; «Дія» marks the row's own «Продати»; never orange, one sale per row", () => {
  assert.match(HOLDINGS, /const watch = row\.category === "stock" && !row\.retired \? watches\.of\(row\.mint\) : null;/);
  assert.match(HOLDINGS, /<WatchLine view=\{watch\} locale=\{locale\} place="row"[^\n]*saleBeside=\{sellButton\} \/>/);
  assert.match(HOLDINGS, /const sellButton = sellable && watch\?\.state !== "issuer-paused";/, "«Пауза емітента»: nothing can be sold now");
  assert.match(HOLDINGS, /const urgent = sellButton && watch\?\.action === "open-sale" \? \(watch\.reason === "target" \? "target" : "limit"\) : undefined;/);
  assert.match(HOLDINGS, /data-urgent=\{urgent\}/);
  assert.match(WATCH, /if \(row && saleBeside\) return null;/, "the row's «Продати» is the sale — the line only says why");
  assert.equal(HOLDINGS.split("rw-btn--primary").length - 1, 0);
  /* A row's line is a line: no panel; its action a small capsule whose press still reaches the product's 44 px. */
  assert.match(CSS, /\.inlineAction \{[^}]*min-height: 44px;[^}]*margin-block: -9px;/);
  assert.match(CSS, /\.capsule \{[^}]*height: 26px;/);
});

test("the range is drawn from the server's figures and judges nothing: the limit, the price now and the target", () => {
  assert.match(WATCH, /export function WatchRange\(/);
  assert.match(WATCH, /const where = price === null \? "unknown" : price <= limit \? "limit" : target !== null && price >= target \? "target" : "between";/, "where the dot stands is drawn, the state still comes from the server");
  assert.match(WATCH, /role="img" aria-label=\{said\}/, "the range is said, not only drawn");
  /* The sheet draws both presets over one span, so «Обережно» reads narrower than «Збалансовано». */
  assert.match(WATCH, /domain=\{\[view\.price \* \(1 - SHEET_SPAN\), view\.price \* \(1 \+ SHEET_SPAN\)\]\}/);
  /* Turned on, the sheet says so with the figures the server wrote. */
  assert.match(WATCH, /<WatchRange limit=\{watch\.limitPerUnit\} target=\{watch\.targetPerUnit\}/);
});

test("Нагляд: «Твої позиції» first, the one that needs the person holding the orange, a position shown once", () => {
  assert.match(ALERTS, /<PositionsSection positions=\{positions\}/);
  assert.match(ALERTS, /const actNow = held\.find\(\(view\) => view\.state === "action"\) \?\? null;/);
  assert.match(ALERTS, /primary=\{actNow\?\.mint === view\.mint\}/);
  assert.match(ALERTS, /card\.subject\?\.kind === "position" \|\| \(card\.subject\?\.kind === "trading-plan" && positionPlans\.has\(card\.subject\.id\)\)/);
  assert.match(ALERTS, /watchWord\("positionsUnread", lang\)/, "a read that failed says so, never an empty list");
});

test("the amber state is in the caution's colour measured for text on both grounds: the panel, the row's word and its capsule", () => {
  assert.match(CSS, /\.panel\[data-watch="exit-not-set"\] \{[^}]*background: var\(--ry-caution-soft\);/);
  assert.match(CSS, /\[data-tone="caution"\] > \* > \.watchState \{\s*color: var\(--rt-review-amber-fg, var\(--ry-caution\)\);/);
  assert.match(CSS, /\[data-tone="caution"\] \.capsule \{[^}]*color: var\(--rt-review-amber-fg, var\(--ry-caution\)\);/);
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "roles, never a raw hue");
});
