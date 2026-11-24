/* The paper week's card: what it shows, how it says a refusal, «Paper» on its head and its figures, one amber
   action, and «Start with money» as the mandate's own signature of the same plan and budget. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { feesOf, issueOf, lineOf, liveOpen, paperOpen, shownOf, signedSol, SIGN_ISSUES, toneOf } from "./model.ts";
import { asksProof, provenStart } from "./start.ts";
import { PAPER } from "./words.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const view = (overrides = {}) => ({
  paper: true,
  status: "working",
  pausedBy: null,
  doneBy: null,
  plan: "steady",
  coin: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  symbol: "JUP",
  perDayRaw: "100000000",
  perTradeRaw: "20000000",
  days: 30,
  startedAt: 0,
  endsAt: 7 * 86_400_000,
  bornAt: null,
  day: 2,
  weekDays: 7,
  trades: 6,
  spentRaw: "120000000",
  heldRaw: "60000000",
  worthRaw: "121000000",
  worthAt: 1,
  buyFeesRaw: "120000",
  networkRaw: "630000",
  net: { trades: 6, spentRaw: "120000000", netRaw: "-250000", holdRaw: "400000", feesRaw: "751000" },
  last: [],
  liveAt: null,
  updatedAt: 1,
  ...overrides,
});

test("the switch: the card opens only where the deployment says open", () => {
  assert.equal(paperOpen("open"), true);
  assert.equal(paperOpen(" OPEN "), true);
  for (const flag of [undefined, "", "on", "mainnet", "1"]) assert.equal(paperOpen(flag), false, String(flag));
});

test("which weeks the card shows, and when «Start with money» stays its action", () => {
  for (const status of ["working", "paused", "done"]) assert.equal(shownOf(view({ status })), true, status);
  for (const status of ["ended", "live"]) assert.equal(shownOf(view({ status })), false, status);
  assert.equal(shownOf(null), false);
  assert.equal(shownOf({ ...view(), paper: false }), false, "only a paper figure is shown as paper");
  assert.equal(liveOpen(view({ status: "done" })), true, "after the week, the action stays");
  assert.equal(liveOpen(view({ status: "paused" })), true, "and any time before");
  assert.equal(liveOpen(view({ status: "live" })), false);
});

test("signed SOL from lamports: the sign, the cut, a dash for a figure not read, colour only for a move", () => {
  assert.equal(signedSol("1200000", "en"), "+0.0012");
  assert.equal(signedSol("-4000000", "en"), "−0.0040");
  assert.equal(signedSol("-4000000", "uk"), "−0,0040");
  assert.equal(signedSol("0", "en"), "0");
  assert.equal(signedSol(null, "en"), "—");
  assert.equal(signedSol("nope", "en"), "—");
  assert.equal(toneOf("5"), "up");
  assert.equal(toneOf("-5"), "down");
  assert.equal(toneOf("0"), undefined);
  assert.equal(toneOf(null), undefined);
  assert.equal(feesOf(view()), "871000", "Ryntra's buy fees plus the sale's fee and the network");
  assert.equal(feesOf(view({ net: { ...view().net, feesRaw: null } })), null);
});

test("the line under the result names what holds the paper agent, in the person's words", () => {
  assert.equal(lineOf(view({ trades: 0 })), "first");
  assert.equal(lineOf(view()), null);
  assert.equal(lineOf(view({ status: "paused", pausedBy: "stop" })), "pausedStop");
  assert.equal(lineOf(view({ status: "paused", pausedBy: "mismatch" })), "paused");
  assert.equal(lineOf(view({ status: "done", doneBy: "week" })), "doneWeek");
  assert.equal(lineOf(view({ status: "done", doneBy: "spent" })), "doneSpent");
  for (const lang of ["en", "uk"]) for (const key of ["first", "paused", "pausedLoss", "pausedLosses", "pausedStop", "pausedTake", "pausedLate", "pausedUnread", "pausedFailing", "doneWeek", "doneSpent"]) assert.equal(typeof PAPER[lang][key], "string", key);
});

test("a refusal of the route is one plain line: the wallet's limit and the one signature said as such", () => {
  assert.equal(issueOf(429, "PAPER_LIMITED"), "limited", "this wallet started too often lately — not «paper is full»");
  assert.equal(issueOf(429, "RATE_LIMITED"), "limited", "a flood from one network: the same honest line");
  assert.equal(issueOf(503, "PAPER_BUSY"), "full", "paper's share of quotes spent now: try a bit later");
  assert.equal(issueOf(404, "PAPER_CLOSED"), "closed");
  assert.equal(issueOf(503, "PAPER_NO_STORE"), "closed", "before its store, paper is simply not open yet");
  assert.equal(issueOf(422, "PAPER_NO_PRICE"), "price");
  assert.equal(issueOf(422, "PAPER_PAIR"), "pair");
  assert.equal(issueOf(503, "PAPER_FULL"), "full");
  assert.equal(issueOf(401, "UNAUTHORIZED"), "proof", "no proof the server took");
  assert.equal(issueOf(403, "WALLET_MISMATCH"), "proof");
  assert.equal(issueOf(403, "FORBIDDEN_ORIGIN"), "network");
  assert.equal(issueOf(500, null), "network");
  for (const issue of ["wallet", "declined", "proof"]) assert.equal(SIGN_ISSUES.has(issue), true, issue);
  for (const issue of ["closed", "price", "pair", "full", "limited", "network"]) assert.equal(SIGN_ISSUES.has(issue), false, issue);
});

/* ---------------------------------------------------------------- the one signature before a start */

/** The proof and the route as a test's: what the wallet answers, what the door answers each time; every call written down. */
function startWorld({ proven = false, proofs = [{ ok: true }], answers = [{ status: 201 }] } = {}) {
  const calls = [];
  let sent = 0;
  let signed = 0;
  return {
    calls,
    deps: {
      proven: () => proven,
      proving: () => calls.push("proving"),
      prove: async (fresh) => (calls.push(fresh ? "prove:fresh" : "prove"), proofs[Math.min(signed++, proofs.length - 1)]),
      post: async () => {
        calls.push("post");
        const answer = answers[Math.min(sent++, answers.length - 1)];
        return { status: answer.status, json: async () => answer.body ?? null };
      },
    },
  };
}

test("a wallet not proven yet signs one message, then paper is asked; a proven one is asked nothing", async () => {
  const fresh = startWorld();
  const started = await provenStart(fresh.deps);
  assert.equal(started.kind, "answer");
  assert.equal(started.answer.status, 201);
  assert.deepEqual(fresh.calls, ["proving", "prove", "post"], "the line first, then the one signature, then the start");
  const known = startWorld({ proven: true });
  assert.equal((await provenStart(known.deps)).kind, "answer");
  assert.deepEqual(known.calls, ["post"], "no second signature for a wallet already proven");
});

test("a signature said no to asks paper nothing; a wallet that could not sign is said as such", async () => {
  const no = startWorld({ proofs: [{ ok: false, state: "declined" }] });
  assert.deepEqual(await provenStart(no.deps), { kind: "declined" });
  assert.deepEqual(no.calls, ["proving", "prove"]);
  const broken = startWorld({ proofs: [{ ok: false, state: "failed" }] });
  assert.deepEqual(await provenStart(broken.deps), { kind: "proof" });
  assert.equal(broken.calls.includes("post"), false);
});

test("a proof the server no longer takes is asked once more, fresh — never a third time", async () => {
  const lapsed = startWorld({ proven: true, answers: [{ status: 401 }, { status: 201 }] });
  const started = await provenStart(lapsed.deps);
  assert.equal(started.kind, "answer");
  assert.equal(started.answer.status, 201);
  assert.deepEqual(lapsed.calls, ["post", "proving", "prove:fresh", "post"]);
  /* The wallet app switched accounts since it signed: another wallet's proof — one fresh signature for this one. */
  const switched = startWorld({ proven: true, answers: [{ status: 403, body: { error: { code: "WALLET_MISMATCH" } } }, { status: 201 }] });
  assert.equal((await provenStart(switched.deps)).kind, "answer");
  assert.deepEqual(switched.calls, ["post", "proving", "prove:fresh", "post"]);
  /* Still no proof after the second signature: said, and nothing more is asked. */
  const stuck = startWorld({ answers: [{ status: 401 }] });
  assert.deepEqual(await provenStart(stuck.deps), { kind: "proof" });
  assert.deepEqual(stuck.calls, ["proving", "prove", "post", "proving", "prove:fresh", "post"]);
  /* Any other refusal is the door's answer, not a reason to sign again. */
  for (const answer of [{ status: 429, body: { error: { code: "PAPER_LIMITED", reason: "wallet" } } }, { status: 403, body: { error: { code: "FORBIDDEN_ORIGIN" } } }, { status: 503 }]) {
    const other = startWorld({ proven: true, answers: [answer] });
    const said = await provenStart(other.deps);
    assert.equal(said.kind, "answer");
    assert.equal(said.answer.status, answer.status);
    assert.deepEqual(other.calls, ["post"]);
    assert.equal(await asksProof(said.answer), false);
  }
});

test("the start's words: one line each, EN and UK, the why behind the «i», nothing technical", () => {
  for (const lang of ["en", "uk"]) {
    const w = PAPER[lang];
    for (const key of ["signing", "wallet", "declined", "proof", "limited"]) {
      assert.equal(typeof w[key], "string", `${lang}.${key}`);
      assert.ok(w[key].length <= 52, `${lang}.${key} is one short line: «${w[key]}»`);
      assert.doesNotMatch(w[key], /[.!]$|nonce|session|proof|доказ|сесі|API|SIWS/iu, `${lang}.${key}`);
    }
    assert.match(w.signing, lang === "en" ? /one signature.*no transaction/iu : /один підпис.*без транзакції/iu);
    assert.match(w.signWhy, lang === "en" ? /no transaction/iu : /без транзакції/iu, "the «i» says what the signature is not");
    assert.doesNotMatch(w.howSafe, lang === "en" ? /no wallet/iu : /без гаманця/iu, "the «i» of the week no longer says no wallet is asked");
  }
  const card = read("./PaperWeek.tsx");
  assert.match(card, /\{sign \? <Info label=\{w\.signLabel\}>\{w\.signWhy\}<\/Info> : null\}/, "why — behind the «i», beside the line");
  const store = read("./store.ts");
  assert.match(store, /owner: connection\.address/, "the start names the connected wallet, which the door compares with the proof");
  assert.match(store, /proveWallet\(connection\)/, "the one signature is Ryntra's own sign-in, shared with every page");
  assert.match(store, /keepKey\(connection\.address, answer\.key\)/, "the week's key is the one the door answered, kept under its own wallet");
  assert.match(store, /JSON\.stringify\(\{ owner: connection\.address, action \}\)/, "the end names the wallet, which the door proves — never a key");
  assert.doesNotMatch(store, /getRandomValues|newKey/u, "the browser no longer makes a key of its own");
  assert.doesNotMatch(store, /signTransaction|sendTransaction/u);
});

test("«Paper» stands on the card's head and on every paper figure, in both languages", () => {
  for (const lang of ["en", "uk"]) {
    const w = PAPER[lang];
    const word = lang === "en" ? /paper/i : /папір|папері/i;
    for (const said of [w.kick, w.mark, w.result, w.agent, w.trades("3"), w.dayOf("2", "7"), w.first]) assert.match(said, word, `${lang}: «${said}»`);
    assert.doesNotMatch(w.live("0.71"), word, "the action is money, and says so");
    for (const said of Object.values(w).map((value) => (typeof value === "function" ? value("1", "2") : value))) assert.doesNotMatch(said, /x\d|\d+x\b|profit guaranteed|прибуток гарант|!/u, `${lang}: «${said}»`);
  }
});

test("the card: one amber action, «Start with money» through the mandate's own signature, nothing of paper mixed into money", () => {
  const card = read("./PaperWeek.tsx");
  const store = read("./store.ts");
  /* Two <Action>s, never both: the wallet's door while none is connected, «Start with money» once it is. */
  assert.equal((card.match(/<Action\b/g) ?? []).length, 2);
  assert.match(card, /connection \? \(\s*<Action/);
  assert.match(card, /<Panel tone="hi"/);
  assert.equal((card.match(/<Panel\b/g) ?? []).length, 1, "one panel, the one the card acts in");
  assert.match(card, /<Chip dot>\{w\.mark\}<\/Chip>/, "the paper mark on the head");
  /* The signature is the mandate's (`signTrade`), with the paper's own plan, coin and budget; the paper hears of it after. */
  assert.match(store, /import \{ planShown, signTrade, useAutopilot \} from '@\/city\/lib\/autopilot\/store'/);
  assert.match(store, /const record = await signTrade\(who, \{ exit: options\.exit === true \}\);\s*if \(record\) await close\('live', fetcher\);/);
  assert.match(store, /setBudget\(budgetOfView\(view\)\)/);
  assert.match(store, /useAutopilot\.setState\(\{ plan \}\)/);
  assert.match(store, /setCoin\(\{ mint: view\.coin/);
  /* No paper figure goes into the agent's book, its store or the old practice. */
  for (const source of [card, store]) {
    assert.doesNotMatch(source, /setPaper|paperRun|keep\(|\/api\/bots\/mandate\/agent/);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(/i, "colours only by tokens");
  }
});

test("the mount: the practice's button starts a paper week where it is open, the card shows the week, the rest stays", () => {
  const screen = read("../NewAgent.tsx");
  // With a wallet: the week where it is open, the browser's paper otherwise — and the funnel's moment first.
  assert.match(screen, /funnelSay\('agent_practice'\);\n\s*if \(PAPER_OPEN\) void startPaperWeek\(\{ connect \}\);\n\s*else startPaper\(\);/);
  assert.match(screen, /const week = usePaperWeekShown\(\);/);
  assert.match(screen, /if \(week && mounted\) return <PaperWeek note=\{note\} onAct=\{onAct\} \/>;\n\s*return paper && mounted \? <TraderPaper/);
  assert.match(read("./store.ts"), /export const PAPER_OPEN = paperOpen\(process\.env\.NEXT_PUBLIC_RYNTRA_AGENT_PAPER\);/);
});

test("the exit's line stands above «Start with money», and the sale is signed only when that line was shown", () => {
  const card = read("./PaperWeek.tsx");
  const store = read("./store.ts");
  /* One figure decides both: the line on the card and the signature's exit. */
  assert.match(card, /import \{ ExitLine, sellsOnItsOwn \} from '\.\.\/Exit';/);
  assert.match(card, /const sells = liveOpen\(view\) && sellsOnItsOwn\(view\.coin\);/);
  /* The rules of the very plan the paper traded — a grid's stop alone, or the Trader's. */
  assert.match(card, /\{sells \? <ExitLine rules=\{exitRulesOf\(planOfText\(view\.plan\)\)\} \/> : null\}/);
  assert.match(card, /goLiveFromPaper\(\{ wallet: connection\.wallet, owner: connection\.address \}, \{ exit: sells \}\)/);
  /* The line comes before the action that signs. */
  assert.ok(card.indexOf("<ExitLine ") < card.indexOf("data-paper-live"), "the exit is read before the signature");
  /* The store passes on exactly what the card said — never a sale by default. */
  assert.match(store, /options: Readonly<\{ exit\?: boolean \}> = \{\}/);
  assert.doesNotMatch(store, /exit: true/);
});
