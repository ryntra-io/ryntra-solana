// Run from repo root: node --test app/app/allowances/allowances.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import { ALLOWANCE_STATUSES, allowanceNetworkFrom } from "../../../lib/solana/allowances/model.ts";
import { ALLOWANCES_IN_MENU, MENU_SECTION_IDS, rowForPath, treasuryNamed } from "../../shell/domains.ts";
import { FOLLOW_EVERY_MS, SUBMIT_FINAL, followSent, followsAfter, submitFailure } from "./allowances-send.ts";
import { ALLOWANCE_WORDS, FAILURE_WORDS, ISSUE_WORDS } from "./allowances-words.ts";

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/* The routes are read as Next reads them: `@/` from the root, a bare `next/server` as its file. */
const ROOT = new URL("../../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), ROOT).href;
      return nextResolve(/\.[cm]?[jt]sx?$/.test(base) ? base : `${base}.ts`, context);
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

/**
 * «Ліміти витрат» (SOL-7): the page and its row of the menu live only where the deployment names the limits' network —
 * devnet first, mainnet by the operator's canary — and both read the same one variable.
 */

test("without the limits' network, the menu has no row for them and their address lights none", () => {
  assert.equal(ALLOWANCES_IN_MENU, false);
  assert.ok(!MENU_SECTION_IDS.includes("policies"));
  assert.equal(rowForPath("/app/allowances"), null);
});

test("the rail reads the variable exactly as the limits do", () => {
  for (const value of [undefined, "", "devnet", " MAINNET ", "mainnet-beta", "testnet", "dev"]) {
    assert.equal(treasuryNamed(value), allowanceNetworkFrom(value) !== null, String(value));
  }
});

test("with the network named, the limits are the core's row «Правила» of «Казна»; with the treasury too, after it", () => {
  const script = `
    const { menuNavigation, rowForPath } = await import("./app/shell/domains.ts");
    const { PRODUCT_ROUTES } = await import("./app/shell/product-routes.ts");
    const uk = menuNavigation(PRODUCT_ROUTES, "uk");
    const en = menuNavigation(PRODUCT_ROUTES, "en");
    console.log(JSON.stringify({ uk: uk.groups.map((g) => [g.id, g.label, g.rows.map((r) => [r.label, r.href])]), en: en.groups.at(-1).rows.map((r) => r.label), row: rowForPath("/app/allowances") }));
  `;
  const run = (env) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "", ...env }, encoding: "utf8" }));
  const alone = run({ NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK: "devnet" });
  assert.deepEqual(alone.uk.at(-1), ["treasury", "Казна", [["Правила", "/app/allowances"]]]);
  assert.deepEqual(alone.en, ["Rules"]);
  assert.equal(alone.row, "policies");
  const both = run({ NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK: "devnet", NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "devnet" });
  assert.deepEqual(both.uk.at(-1)[2].map((row) => row[1]), ["/app/treasury", "/app/allowances"]);
});

test("without the network every route of the limits answers 404, whatever is asked; the page is not found", async () => {
  assert.equal(process.env.NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK ?? "", "");
  assert.match(code("./page.tsx"), /if \(!network\) notFound\(\);/);
  const api = "http://localhost/api/solana/allowances";
  const wallet = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
  const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const info = await import("../../api/solana/allowances/route.ts");
  const state = await import("../../api/solana/allowances/state/[wallet]/route.ts");
  const build = await import("../../api/solana/allowances/build/route.ts");
  const submit = await import("../../api/solana/allowances/submit/route.ts");
  const answers = [
    await info.GET(new Request(api)),
    await state.GET(new Request(`${api}/state/${wallet}`), { params: Promise.resolve({ wallet }) }),
    await build.POST(new Request(`${api}/build`, post({ kind: "stopAll", wallet }))),
    await submit.POST(new Request(`${api}/submit`, post({ buildId: "0".repeat(32), wallet, signedWireBase64: ["AA=="] }))),
    await submit.GET(new Request(`${api}/submit?build=${"0".repeat(32)}&wallet=${wallet}`)),
  ];
  for (const answer of answers) {
    assert.equal(answer.status, 404);
    assert.equal((await answer.json()).error.code, "ALLOWANCES_UNAVAILABLE");
  }
  const flow = code("./allowances-flow.tsx");
  /* Signing is the wallet's, through the one signer of the workspace; the page never sends a transaction itself. */
  assert.match(flow, /signTransactions\(/);
  assert.doesNotMatch(flow, /sendRawTransaction|sendTransaction|signAndSend/);
  /* The page reads the program's types and rules, never its SDK: the SDK stays on the server. */
  for (const file of ["./allowances-surface.tsx", "./allowances-flow.tsx", "./allowances-forms.tsx"]) {
    assert.doesNotMatch(code(file), /@solana\/subscriptions|service\.server|program\.server/, file);
  }
});

test("every word has both languages; every status, refusal and rule has its line", () => {
  for (const [key, value] of Object.entries(ALLOWANCE_WORDS)) assert.ok(value.en.trim() && value.uk.trim(), key);
  for (const [key, value] of Object.entries(FAILURE_WORDS)) assert.ok(value.en.trim() && value.uk.trim(), key);
  for (const [key, value] of Object.entries(ISSUE_WORDS)) assert.ok(value.en.trim() && value.uk.trim(), key);
  for (const status of ALLOWANCE_STATUSES) assert.ok(ALLOWANCE_WORDS[`status_${status}`], status);
  /* «Unknown» is said as not read — never as a zero or as fine. */
  assert.match(ALLOWANCE_WORDS.status_unknown.uk, /Невідомо/);
  assert.match(ALLOWANCE_WORDS.givenUnread.uk, /не прочитано/);
});

test("no forbidden promise in the page's words", () => {
  const all = Object.values(ALLOWANCE_WORDS).flatMap((value) => [value.en, value.uk]).join("\n");
  assert.doesNotMatch(all, /guaranteed|гарантован|risk-free|без ризику|passive income|пасивний дохід/i);
});

test("after the signature a lost answer is «not known whether sent», never «nothing was sent»; only a final refusal stays", () => {
  /* The fetch failed, the page was not JSON, the server could not answer, the route ran out of time. */
  for (const code of ["UNAVAILABLE", "ALLOWANCE_SEND_UNKNOWN", "INTERNAL", "SOMETHING_NEW"]) {
    assert.equal(submitFailure({ code, message: "" }).code, "ALLOWANCE_SEND_UNKNOWN", code);
  }
  for (const code of SUBMIT_FINAL) assert.equal(submitFailure({ code, message: "m" }).code, code);
  assert.ok(!SUBMIT_FINAL.has("UNAVAILABLE"));
  for (const locale of ["en", "uk"]) {
    const unknown = FAILURE_WORDS.ALLOWANCE_SEND_UNKNOWN[locale];
    assert.doesNotMatch(unknown, /nothing was sent|нічого не надіслано/i);
    assert.match(unknown, locale === "uk" ? /Невідомо, чи надіслано/ : /Not known whether it was sent/);
  }
  /* A refusal that says nothing was sent is one the server gives before it sends, or a build that failed. */
  for (const [code, words] of Object.entries(FAILURE_WORDS)) {
    if (/nothing was sent/.test(words.en)) assert.ok(["UNAVAILABLE", "ALLOWANCE_SIGNED_OTHER_BYTES"].includes(code), code);
  }
});

test("a PENDING receipt names no result; the chain is read again until final, within its bound", async () => {
  for (const locale of ["en", "uk"]) {
    assert.doesNotMatch(ALLOWANCE_WORDS.receiptTitle_pending[locale], /given|stopped|done|дано|зупинено|готово/i);
    assert.match(ALLOWANCE_WORDS.receiptTitle_pending[locale], locale === "uk" ? /Надіслано, ще не підтверджено/ : /not confirmed/);
  }
  const flow = code("./allowances-flow.tsx");
  assert.match(flow, /title=\{pending \? word\("receiptTitle_pending"\)/);
  assert.match(flow, /if \(sent\.data\.state === "PENDING"\) void followUp\(where\)/);
  assert.match(flow, /if \(followsAfter\(said\.code\)\)/);
  assert.ok(followsAfter("ALLOWANCE_SEND_UNKNOWN") && followsAfter("ALLOWANCE_BUILD_USED") && !followsAfter("ALLOWANCE_SUBMIT_FAILED"));
  /* A revoke, a new Review or a reset never stops the read of what was sent: only a newer send does. */
  const prepare = flow.slice(flow.indexOf("const prepare = useCallback"), flow.indexOf("const confirm = useCallback"));
  const reset = flow.slice(flow.indexOf("const reset = useCallback"), flow.indexOf("return { phase"));
  for (const body of [prepare, reset]) {
    assert.doesNotMatch(body, /ticket\.current/);
    assert.match(body, /setFollow\(\(now\) => \(now === "watching" \? now : "none"\)\)/);
  }
  assert.match(code("./allowances-surface.tsx"), /<FollowLine follow=\{action\.follow\} locale=\{locale\} \/>/);

  const where = { build: "a".repeat(32), wallet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" };
  let clock = 0;
  const wait = async (ms) => void (clock += ms);
  const now = () => clock;
  const script = (answers) => {
    const asked = [];
    return { asked, read: async (path) => (asked.push(path), answers.shift() ?? { ok: true, data: { state: "PENDING" } }) };
  };
  /* Lost reads and PENDING are read again; the first final word ends it. */
  const landed = script([{ ok: false, code: "UNAVAILABLE", message: "" }, { ok: true, data: { state: "PENDING" } }, { ok: true, data: { state: "CONFIRMED", signature: "s" } }]);
  assert.equal((await followSent(where, { read: landed.read, wait, now })).state, "CONFIRMED");
  assert.equal(landed.asked.length, 3);
  assert.match(landed.asked[0], /^\/api\/solana\/allowances\/submit\?build=a{32}&wallet=/);
  for (const state of ["FAILED", "NOT_LANDED"]) assert.equal((await followSent(where, { read: script([{ ok: true, data: { state } }]).read, wait, now })).state, state);
  /* No final word within the bound: null, said as «not known yet» — never as done or as nothing sent. */
  clock = 0;
  const forever = script([]);
  assert.equal(await followSent(where, { read: forever.read, wait, now, boundMs: 60_000 }), null);
  assert.equal(forever.asked.length, 60_000 / FOLLOW_EVERY_MS);
  /* Stopped by a new action: nothing more is read. */
  const stopped = script([]);
  assert.equal(await followSent(where, { read: stopped.read, wait, now, stopped: () => true }), null);
  assert.equal(stopped.asked.length, 0);
});

test("the Review says the whole addresses, a first approval without a cap, a plan without an end, and an end that may move", () => {
  const flow = code("./allowances-flow.tsx");
  assert.match(flow, /\{review\.counterparty\}/);
  assert.match(flow, /\{review\.to\}/);
  assert.match(flow, /word\("rowEndDrift"/);
  assert.match(flow, /review\.endsAt === "0" \? word\("riskSubscribeNoEnd"\)/);
  assert.match(ALLOWANCE_WORDS.rowApprovesFirst.en, /no amount cap/);
  assert.match(ALLOWANCE_WORDS.rowApprovesFirst.uk, /без обмеження суми/);
  assert.match(ALLOWANCE_WORDS.rowPlanToFixed.en, /cannot change/);
  /* The program's own word on a plan: its pullers and its end may change, never its price, period or destinations. */
  assert.match(ALLOWANCE_WORDS.rowPullersMay.en, /change who collects and end the plan sooner/);
});

