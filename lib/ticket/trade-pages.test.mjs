// Run from repo root: node --test lib/ticket/trade-pages.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/* Every Solana trade form is the core's ticket (`@ryntra/core/ui` `TradeTicket`), and every button on a page of trades
   is the core's `Button`: a «Купити» or «Продати» drawn by a page itself is a second ticket nobody keeps the same.
   The spot terminal's own form (`app/solana/workspace/spot/**`) moves with the terminal onto the core's `Terminal`. */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

/* The pages of trades, and every component they draw a buy or a sale with. */
const TRADE_DIRS = ["app/app/stocks/[ticker]", "app/app/launch/[mint]", "app/app/invest", "app/solana/workspace/trade"];
const TRADE_FILES = ["app/solana/workspace/holdings/holdings-card.tsx", "app/solana/workspace/swap/page.tsx"];

function filesIn(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return filesIn(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
const PAGES = [...TRADE_DIRS.flatMap(filesIn), ...TRADE_FILES].map((path) => relative(ROOT, join(ROOT, path)).replace(/\\/g, "/"));

/* A word of a buy or a sale, as a page writes it: its own key, the words themselves, the rule's purchase. */
const TRADE_WORD = /word\(\s*["'][^"']*(?:[bB]uy|[sS]ell|[sS]wap|[pP]urchase|[sS]ale)[^"']*["']|text\("(?:Buy|Sell|Swap|Review swap|Confirm in wallet)"\)|buyByRuleWord|sellForWord|swapWord|sellWord|Купити|Продати|\bBuy\b|\bSell\b/;

/**
 * Every element a page draws as its own button. A link is a way to another page — Markets, Spot's terminal — and
 * stays a link; an action on the page itself is a button, and a button is the core's.
 */
function ownButtons(source) {
  return [...source.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((match) => match[0]);
}

/* A label the guard cannot read: a value with no call in it — `{cta.label}`, `{labels[kind]}`, `{busy ? x : label}`,
   `{label ?? ""}` — rather than a word, a figure or a call, when it is all the button says beside its icons. The five
   forms themselves draw no button of their own at all (the test below). */
const INDIRECT_LABEL = /^\{[^(){}<>`]*\}$/;
/** What a button says, its elements and their ends taken out: `{cta.label ?? ""} <Icon />` says `{cta.label ?? ""}`. */
const labelOf = (element) => children(element).replace(/<el>|<\/[A-Za-z][\w.]*>/g, "").trim();

/** Where the JSX tag starting at `from` ends: the first `>` outside braces and quotes. */
function tagEnd(source, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return i;
  }
  return source.length;
}

/** A button's children with every element inside it cut down to its name: an icon's `size={18}` is not a label. */
function children(element) {
  let rest = element.slice(tagEnd(element, 0) + 1, element.lastIndexOf("</button>"));
  let out = "";
  for (let at = rest.search(/<[A-Za-z]/); at !== -1; at = rest.search(/<[A-Za-z]/)) {
    out += `${rest.slice(0, at)}<el>`;
    rest = rest.slice(tagEnd(rest, at) + 1);
  }
  return out + rest;
}

/* Own buttons whose bare label is known to be no trade: each with why. */
const READ_LABELS = [
  /* A rule's weekday chip: its label is the day's own short name. */
  /^<button key=\{day\} type="button" className=\{company\.dayChip\}/,
  /* A rule's asset to pick: its icon and its name. */
  /^<button type="button" className=\{block\.pick\} onClick=\{\(\) => onPick\(pick\)\}>/,
];

/** What a page's own button must not be: a trade word, a label the guard cannot read, or the old kit's button. */
function offence(element) {
  if (TRADE_WORD.test(element)) return "a trade word";
  if (INDIRECT_LABEL.test(labelOf(element)) &&!READ_LABELS.some((known) => known.test(element))) return "a label read elsewhere";
  if (/className=(?:"|\{`)[^"`]*\brw-btn\b/.test(element)) return "the old kit's button";
  return null;
}

test("no page of trades draws its own «Купити» or «Продати»: every one is the core's", () => {
  assert.ok(PAGES.length > 20, "the pages of trades are read");
  const offenders = [];
  for (const path of PAGES) {
    const source = read(path);
    for (const element of ownButtons(source)) {
      const why = offence(element);
      if (why) offenders.push(`${path} (${why}): ${element.replace(/\s+/g, " ").slice(0, 140)}`);
    }
    /* Nothing else plays a button: an action is a button, and a button is the core's. */
    if (/\brole="button"/.test(source)) offenders.push(`${path}: role="button"`);
  }
  assert.deepEqual(offenders, [], `A buy or a sale drawn outside the core:\n${offenders.join("\n")}`);
});

test("every Solana trade form is the core's ticket over its own execution", () => {
  const forms = {
    "app/app/stocks/[ticker]/buy-sheet.tsx": /useSpotTicket\(\{/,
    "app/app/stocks/[ticker]/sell-sheet.tsx": /useSpotTicket\(\{/,
    "app/app/stocks/[ticker]/convert-sheet.tsx": /useSpotTicket\(\{/,
    "app/app/launch/[mint]/trade-panel.tsx": /`\$\{base\}\/trade\/build`/,
    "app/solana/workspace/trade/swap-card.tsx": /"\/api\/solana\/swap\/order"/,
  };
  for (const [path, engine] of Object.entries(forms)) {
    const source = read(path);
    assert.match(source, /import \{[^}]*\bTradeTicket\b[^}]*\} from "@ryntra\/core\/ui"/, `${path}: the core's ticket`);
    assert.match(source, /<TradeTicket\b/, `${path}: drawn`);
    assert.match(source, engine, `${path}: on the execution it always had`);
    /* No button of its own at all: the form's every control is the ticket's or the core's Button. */
    assert.doesNotMatch(source, /<button\b/, `${path}: a button of its own`);
    assert.doesNotMatch(source, /"rw-btn|`rw-btn/, `${path}: a button of the old kit`);
  }
});

test("a sheet's action waits while the sheet works: one press asks once", () => {
  const buy = read("app/app/stocks/[ticker]/buy-sheet.tsx");
  /* A second tap or Enter while the limit is proven or written, or the Review prepared, writes no second plan. */
  assert.match(buy, /if \(pressing\.current \|\| busy \|\| wantReview\) return;/);
  assert.match(buy, /action: \(\s*<Button variant="primary" block disabled/);
  for (const path of ["app/app/stocks/[ticker]/sell-sheet.tsx", "app/app/stocks/[ticker]/convert-sheet.tsx"]) {
    const source = read(path);
    assert.match(source, /if \(working\) return;\s*if \(ticket\.lockedReview\) void ticket\.cancelReview\(true\);/, `${path}: one order asked at a time`);
    assert.match(source, /phase === "PREPARING" \|\| holdings\.status !== "ready"/, `${path}: the action waits in its own words`);
  }
});

test("a launch's Review speaks for the amount it agreed to, whatever a dollar price does", () => {
  const panel = read("app/app/launch/[mint]/trade-panel.tsx");
  assert.match(panel, /const reviewData = stage === "review" \? \(reviewedQuote \?\? result\?\.quote \?\? null\)/);
  assert.match(panel, /setReviewed\(snapshot\);\s*setReviewedQuote\(shown\);/);
  assert.match(panel, /setReviewed\(freshSnapshot\);\s*setReviewedQuote\(shown\);/);
  assert.equal((panel.match(/setReviewed\(null\);\s*setReviewedQuote\(null\);/g) ?? []).length, (panel.match(/setReviewed\(null\);/g) ?? []).length, "let go together");
});

test("the guard sees a page's own button, and lets the core's pass", () => {
  assert.equal(ownButtons('<button type="button" onClick={go}>{word("buy")}</button>').some((element) => TRADE_WORD.test(element)), true);
  assert.equal(ownButtons('<button className="rw-btn" type="button">Продати</button>').some((element) => TRADE_WORD.test(element)), true);
  assert.equal(ownButtons('<Link className="rw-btn" href="/app/markets">{word("buy")}</Link>').length, 0, "a link to another page stays a link");
  assert.equal(ownButtons('<Button variant="primary" onClick={go}>{word("buy")}</Button>').length, 0);
  assert.equal(ownButtons('<button type="button" role="tab">{word(RANGE_WORD[entry])}</button>').some((element) => offence(element) !== null), false);
  assert.equal(offence('<button type="button" onClick={buy}>{label}</button>'), "a label read elsewhere");
  assert.equal(offence('<button type="button" className={styles.cta} onClick={go}>{cta.label}</button>'), "a label read elsewhere");
  assert.equal(offence('<button type="button" onClick={onClose}>{word("buyAtMarket")}</button>'), "a trade word");
  assert.equal(offence('<button type="button" onClick={go}>{word("reviewSale")}</button>'), "a trade word");
  assert.equal(offence('<button type="button" onClick={go}>{word("reviewSwap")}</button>'), "a trade word");
  assert.equal(offence('<button type="button" onClick={go}>{labels[kind]}</button>'), "a label read elsewhere");
  assert.equal(offence('<button type="button" onClick={go}>{busy ? waitWord : cta.label}</button>'), "a label read elsewhere");
  assert.equal(offence('<button type="button" onClick={() => go(1)}>{cta.label ?? ""} <Icon /></button>'), "a label read elsewhere");
  assert.equal(offence('<button type="button" className="rw-btn" onClick={onClose}>{word("done")}</button>'), "the old kit's button");
  assert.equal(offence('<button type="button" className={`rw-btn ${styles.action}`} onClick={go}>{word("pause")}</button>'), "the old kit's button");
  assert.equal(offence('<button type="button" className={company.chip} onClick={pick}>{pctWord(pct, lang)}</button>'), null);
});
