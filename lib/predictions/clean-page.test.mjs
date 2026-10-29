// Run from repo root: node --test lib/predictions/clean-page.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/*
 * The market page clean: the core's «Стандарт» with «Повернути стандарт», a guest with one button, the
 * venues' unknown access said once, and the money form as the core's action column. These read the sources: the
 * rendered page is looked at by scripts/predictions-qa/eyes-clean.mjs.
 */

const read = (path) => readFileSync(path, "utf8");
const WORKSPACE = read("app/app/predictions/[eventId]/market-workspace.tsx");
const DETAIL = read("app/app/predictions/[eventId]/market-detail.tsx");
const TICKET = read("app/app/predictions/[eventId]/ticket.tsx");
const ACCOUNT = read("app/app/predictions/account-card.tsx");
const HUB = read("app/app/predictions/hub.tsx");
const CARD = read("app/app/predictions/event-card.tsx");
const PORTFOLIO = read("app/app/predictions/portfolio/portfolio-view.tsx");
const CSS = read("app/app/predictions/predictions.module.css");

test("the market opens in the core's «Стандарт»: the core's terminal with this page's start, no ready layouts of its own", () => {
  assert.match(WORKSPACE, /<Terminal\b[\s\S]*?standard=\{standard\}/);
  assert.match(WORKSPACE, /cleanMarketLayout\(side, now\)/);
  // What is kept is chosen as it is read (lib/predictions/market-layout.ts, chooseKept): a side or a slot writes nothing.
  assert.match(WORKSPACE, /chooseKept\(own \?\? null, others, sideRef\.current\.side, sideRef\.current\.at\)/);
  assert.match(WORKSPACE, /key=\{`\$\{page\}:\$\{side\}`\}/);
  // No row of layouts, no list of panels, no line of put-away panels of its own: «Додати панель», «Налаштувати» and
  // «Повернути стандарт» are the core's row under the terminal.
  for (const gone of ["{ slot:", "HiddenBlocks", "readyOfSlot", "layoutReset", "panelsHelp", "foldButton"]) assert.equal(WORKSPACE.includes(gone), false, gone);
  assert.equal(/\.slot\b|\.workbar\b|\.foldButton\b|ryntra-hidden/.test(CSS), false);
});

test("a guest has one button — in the ticket — and no sentence about signing in", () => {
  // The ticket: the one way in, as wide as its column.
  assert.match(TICKET, /account\.state\.status === "guest" \?[\s\S]{0,200}<ConnectAction account=\{account\} locale=\{locale\} block \/>/);
  assert.equal(TICKET.includes('word("walletFirst")'), false);
  // The figures over the chart say nothing about signing in; «Watch» and «Build plan» wait for an account.
  assert.equal(DETAIL.includes('word("walletFirst")'), false);
  assert.match(DETAIL, /\{member \? \(/);
  assert.match(DETAIL, /const member = account\.state\.account != null;/);
  // The card beside the ticket and on the hub says nothing a second time; the portfolio's is one sentence and the button.
  assert.match(ACCOUNT, /if \(compact\) return null;/);
  assert.match(ACCOUNT, /<EmptyState icon="wallet" text=\{word\("accountGuest"\)\} action=\{<ConnectAction/);
  // The button is the app's own: the header's wallet panel, «Open in Phantom» on a phone without a wallet.
  assert.match(ACCOUNT, /import \{ ConnectWalletButton \} from "@\/app\/solana\/workspace\/wallet-gate";/);
  assert.match(HUB, /word\("watchlistGuest"\)\} action=\{<ConnectAction/);
});

test("«Access not confirmed yet» is said once over the hub's cards, not on each", () => {
  assert.match(CARD, /state === "unknown" \? null : <AccessChip/);
  assert.match(HUB, /marketAccess\(event\.venues, access\) === "unknown"\)[\s\S]{0,120}className=\{styles\.accessLine\}/);
});

test("the money form is the core's action column in the middle; the market is a terminal across the canvas", () => {
  assert.match(PORTFOLIO, /<div id="money" className=\{styles\.moneyColumn\}>/);
  assert.match(CSS, /\.moneyColumn \{\s*width: 100%;\s*max-width: var\(--ryntra-page-action, 640px\);\s*margin-inline: auto;/);
  assert.match(DETAIL, /className=\{`\$\{styles\.page\} \$\{styles\.marketPage\}`\}/);
  assert.match(CSS, /\.marketPage \{\s*max-width: none;/);
});

/* The cabinet's width law (DESIGN.md → «Page width», app/app/page-width.test.mjs), for this line's own styles: a cap of a
   desk's width says why with `width-law:`. */
function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

test("no page of the line caps itself below the canvas without saying why", () => {
  const offenders = [];
  for (const file of cssFiles("app/app/predictions")) {
    const source = read(file);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")).split("\n");
    source.split("\n").forEach((line, index) => {
      const declarations = code[index].replace(/@(media|container)[^{]*/g, "");
      for (const match of declarations.matchAll(/(?<![-\w])max-(?:width|inline-size)\s*:\s*([^;}]+)/g)) {
        const px = Math.max(0, ...[...match[1].matchAll(/([\d.]+)(px|rem|em)\b/g)].map(([, n, unit]) => Number(n) * (unit === "px" ? 1 : 16)));
        if (px >= 700 && !/width-law:\s*\S.{8,}/.test(line)) offenders.push(`${file}:${index + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});
