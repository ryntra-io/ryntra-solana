// B4 «Markets і Launch на нових блоках»: the screener, «Лаунчі на Ryntra», a token's page, the launch
// form in three steps and «Мої лаунчі» stand on the core's components — and only the components changed: every check
// of an honest launch is still drawn where a person meets it, and every call of MarketOS is the one it was.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const BOARD = read("app/app/launch/markets/markets-board.tsx");
const TOKEN_PAGE = read("app/app/launch/[mint]/page.tsx");
const TOKEN = read("app/app/launch/[mint]/token-market.tsx");
const TRADE = read("app/app/launch/[mint]/trade-panel.tsx");
const HEALTH = read("app/app/launch/[mint]/market-health.tsx");
const LOG = read("app/app/launch/[mint]/flight-log.tsx");
const POOL = read("app/app/launch/[mint]/pool-panel.tsx");
const FLOW = read("app/app/launch/new/launch-flow.tsx");
const MINE = read("app/app/launch/mine/creator-cabinet.tsx");
const SCREENER = read("app/app/markets/markets-screener.tsx");
const PLACE = read("app/app/markets/markets-place.tsx");

const SCREENS = { BOARD, TOKEN_PAGE, TOKEN, TRADE, HEALTH, LOG, POOL, FLOW, MINE, SCREENER };

test("every screen of B4 is drawn by the core's page, blocks, table, number, review and receipt", () => {
  assert.match(BOARD, /<Page\s[\s\S]*kind="overview"/, "«Лаунчі на Ryntra» is the core's page");
  assert.match(BOARD, /<Table\s[\s\S]*columns=\{columns\}/, "its markets are the core's table");
  assert.match(TOKEN_PAGE, /<Page kind="overview"/, "a token's page is the core's page");
  assert.match(TOKEN, /<HeroNumber\s[\s\S]*label=\{word\("marketCap"\)\}/, "its one number is the core's");
  /* SOL-T3: the trade is the core's ticket — its Review before the wallet, its receipt after. */
  assert.match(TRADE, /<TradeTicket\b/, "a trade passes through the core's ticket: its Review before the wallet");
  assert.match(TRADE, /receipt: settledReceipt\(/, "and ends in the core's receipt, on the chain's figures");
  assert.match(FLOW, /<Page\s[\s\S]*kind="action"/, "the launch form is the core's action page");
  assert.match(FLOW, /const STEPS: readonly Step\[\] = \["token", "rules", "review"\];/, "in three steps");
  assert.match(FLOW, /<Review\s/, "its last step is the core's Review");
  assert.match(MINE, /<HeroNumber\s/, "«Мої лаунчі» has one number");
  assert.match(MINE, /<CoreReceipt\s/, "and the core's receipts");
  assert.match(SCREENER, /<Table\s/, "the screener's table is the core's");
  assert.match(PLACE, /<Page kind="overview"/, "on the core's page");
  for (const [name, source] of Object.entries(SCREENS)) {
    assert.doesNotMatch(source, /\$\{styles\.card\}|className=\{styles\.card\}/, `${name}: no card of Launch's own is left`);
    assert.doesNotMatch(source, /"rw-btn|`rw-btn/, `${name}: no button of the old kit is left`);
  }
});

test("every check of an honest launch is still on the page where a person meets it", () => {
  /* A token's page: the program's rules with their accounts, the creator's lock, the facts before a trade, their reasons. */
  assert.match(TOKEN_PAGE, /<Block title=\{word\("marks"\)\}[^>]*id="launch-marks"/, "«Чесний лаунч» keeps its block and its anchor");
  assert.match(TOKEN_PAGE, /mark_CREATOR_BUY_LOCKED/, "the creator's locked buy");
  assert.match(TOKEN_PAGE, /markWord\(mark, receipt, partners\)/, "each mark in its words");
  assert.match(TOKEN_PAGE, /explorerUrl\(token\.network, "account", mark\.account\)/, "each mark with the account anyone can check");
  assert.match(TOKEN_PAGE, /word\("marksChecked"/, "when the chain was read for them");
  assert.match(TOKEN, /<RiskStrip /, "the facts worth a look before a trade, on the first screen");
  assert.match(TOKEN, /riskChip_\$\{fact\.code\}/, "each in its word");
  assert.match(TOKEN, /riskWhy_\$\{fact\.code\}/, "and its reason");
  assert.match(TOKEN, /<RiskHealth /, "what governs the market");
  assert.match(TOKEN, /<NoGuarantee /, "and that no price is guaranteed, under the trade");
  assert.match(HEALTH, /enforce_\$\{rule\.enforcement\}/, "a rule is said as a rule or a policy");
  assert.match(HEALTH, /<CreatorLockLine /, "the creator's lock in the risk");
  /* The form: what a preset does to snipers, the creator's cap and lock, the numbers of the curve, what is fixed for ever. */
  /* SOL-C10 (UX-406): the cards say what each preset is for; snipers, the cap, the creator's share and the lock of every preset sit side by side in «All numbers». */
  for (const key of ["compareSniper", "compareCap", "compareYourFee", "compareLock", "presetGraduation", "presetLp", "presetToken", "reviewFixed", "lockRequiredHint", "buyAboveCap"]) {
    assert.match(FLOW, new RegExp(`word\\("${key}"`), `the form says ${key}`);
  }
  /* The board: the creator's lock, whether they sold, no price guaranteed; Ryntra's own launches off it (B15). */
  assert.match(BOARD, /publicLaunchMarkets\(list\?\.markets/, "the team's technical validations are kept off the public board");
  for (const key of ["creatorLockedUntil", "creatorSoldYes", "creatorSoldNo", "creatorSoldUnread", "noGuarantee", "notRead"]) {
    assert.match(BOARD, new RegExp(`word\\("${key}"`), `the board says ${key}`);
  }
});

test("the calls of MarketOS are the ones they were: the same routes, the same build, the same signature", () => {
  assert.match(FLOW, /api<LaunchMetadataResponse>\("\/api\/v1\/launch\/metadata"/);
  assert.match(FLOW, /api<LaunchBuildResponse>\("\/api\/v1\/launch\/build"/);
  /* AG-1: the same signature over the same build — inside `signFreshBytes`, which builds once more only when the
     wallet answered after the bytes' ~30 s, so the build it signs is passed in as `data`. */
  assert.match(FLOW, /signTransactions\(\{ wallet: connection\.wallet, address: connection\.address, unsignedWireBase64: wires, chain: data\.network \}\)/);
  assert.match(FLOW, /signFreshBytes\(/);
  assert.match(FLOW, /api<LaunchSubmitResponse>\("\/api\/v1\/launch\/submit"/);
  assert.match(FLOW, /checkLaunchForm\(fields\)/, "the form is checked by the server's own rules");
  assert.match(TRADE, /`\$\{base\}\/trade\/quote`/);
  assert.match(TRADE, /`\$\{base\}\/trade\/build`/);
  assert.match(TRADE, /`\$\{base\}\/trade\/submit`/);
  assert.match(TRADE, /onConfirm=\{\(\) => void trade\(\)\}/, "the review's action is the trade's own");
  assert.match(MINE, /`\$\{base\}\/build`/);
  assert.match(MINE, /`\$\{base\}\/submit`/);
  assert.match(POOL, /signTransactions\(/);
});
