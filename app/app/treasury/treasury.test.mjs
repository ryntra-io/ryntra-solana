// Run from repo root: node --test app/app/treasury/treasury.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CHAIN_REFUSAL_CODES, treasuryNetworkFrom } from "../../../lib/solana/treasury/model.ts";
import { MENU_SECTION_IDS, TREASURY_IN_MENU, rowForPath, treasuryNamed } from "../../shell/domains.ts";
import { FAILURE_WORDS, ISSUE_WORDS, TREASURY_WORDS } from "./treasury-words.ts";

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * «Казна» (SOL-4): its page and its row of the menu live only where the deployment names the treasury's network —
 * devnet first, mainnet by the operator's canary — and both read the same one variable.
 */

test("without the treasury's network, the menu has no treasury row and its address lights none", () => {
  assert.equal(TREASURY_IN_MENU, false);
  assert.ok(!MENU_SECTION_IDS.includes("treasury"));
  assert.equal(rowForPath("/app/treasury"), null);
});

test("the rail reads the variable exactly as the treasury does", () => {
  for (const value of [undefined, "", "devnet", " MAINNET ", "mainnet-beta", "testnet", "dev"]) {
    assert.equal(treasuryNamed(value), treasuryNetworkFrom(value) !== null, String(value));
  }
});

test("with the treasury's network named, «Казна» is the core's group with one row, after Гроші", () => {
  const script = `
    const { menuNavigation, rowForPath } = await import("./app/shell/domains.ts");
    const { PRODUCT_ROUTES } = await import("./app/shell/product-routes.ts");
    const uk = menuNavigation(PRODUCT_ROUTES, "uk");
    const en = menuNavigation(PRODUCT_ROUTES, "en");
    console.log(JSON.stringify({ uk: uk.groups.map((g) => [g.id, g.label, g.rows.map((r) => [r.label, r.href])]), en: en.groups.map((g) => g.label), row: rowForPath("/app/treasury") }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "devnet" }, encoding: "utf8" }));
  assert.deepEqual(out.uk.at(-1), ["treasury", "Казна", [["Огляд казни", "/app/treasury"]]]);
  assert.equal(out.uk.at(-2)[0], "money");
  assert.deepEqual(out.en.at(-1), "Treasury");
  assert.equal(out.row, "treasury");
});

test("on mainnet the row and the page say «Beta» and the network; on devnet the chip says devnet (SOL-C2, UX-003, UX-703)", () => {
  const tags = (network) =>
    JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", `const { MENU_TAGS, TREASURY_ON_MAINNET } = await import("./app/shell/domains.ts"); console.log(JSON.stringify({ tags: MENU_TAGS, mainnet: TREASURY_ON_MAINNET }));`], {
        env: { ...process.env, NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: network },
        encoding: "utf8",
      }),
    );
  assert.deepEqual(tags("mainnet").tags.treasury, { en: "Beta", uk: "Beta" });
  assert.equal(tags("mainnet-beta").mainnet, true);
  assert.equal(tags("devnet").tags.treasury, undefined);
  assert.equal(tags("devnet").mainnet, false);
  const surface = code("./treasury-surface.tsx");
  assert.match(surface, /network === "solana:devnet" \? \([\s\S]*?word\("devnet"\)[\s\S]*?\) : \([\s\S]*?word\("mainnet"\)/);
  assert.equal(TREASURY_WORDS.mainnet.uk, "Solana Mainnet · Beta");
  assert.match(code("../frame.css"), /\.ryntra-menu__group\[data-group="treasury"\] > \.ryntra-menu__head::after \{\s*order: 1;\s*content: var\(--sol-menu-tag-treasury, none\);/);
});

test("a page outside every row lights none: the frame hands the core null, no row stands in for it (A14, SOL-C11)", () => {
  const frame = code("../product-shell.tsx");
  assert.match(frame, /section=\{row\}/);
  assert.doesNotMatch(frame, /NO_ROW/);
});

test("the page and the routes are not served without the network, and the page signs nothing itself", () => {
  const page = code("./page.tsx");
  assert.match(page, /if \(!network\) notFound\(\);/);
  for (const route of ["route.ts", "state/[address]/route.ts", "build/route.ts", "submit/route.ts"]) {
    assert.match(code(`../../api/solana/treasury/${route}`), /if \(!deps\) return treasuryFailure\("TREASURY_UNAVAILABLE"/, route);
  }
  const flow = code("./treasury-flow.tsx");
  /* Signing is the wallet's, through the one signer of the workspace; the page never sends a transaction itself. */
  assert.match(flow, /signTransactions\(/);
  assert.doesNotMatch(flow, /sendRawTransaction|sendTransaction|signAndSend/);
});

test("every word has both languages; every rule a form can break has its line", () => {
  for (const [key, value] of Object.entries(TREASURY_WORDS)) {
    assert.ok(value.en.trim() && value.uk.trim(), key);
  }
  for (const [code, value] of Object.entries(ISSUE_WORDS)) assert.ok(value.en && value.uk, code);
  /* The mandate's trap is said in words: an empty list of recipients would mean anywhere. */
  assert.match(ISSUE_WORDS.LIMIT_DESTINATIONS_EMPTY.uk, /будь-куди/);
});

test("no name of a network in the product's words beyond the devnet chip; no forbidden promise", () => {
  const all = Object.values(TREASURY_WORDS).flatMap((value) => [value.en, value.uk]).join("\n");
  assert.doesNotMatch(all, /guaranteed|гарантован|risk-free|без ризику|passive income|пасивний дохід/i);
});

test("every refusal the server can answer has its words in both languages; the network's own text is never the line", () => {
  /* The codes as the server's code writes them — a new refusal without words fails here, not on a person's screen. */
  const sources = [
    "../../../lib/solana/treasury/service.server.ts",
    "../../../lib/solana/treasury/squads.server.ts",
    "../../api/solana/treasury/route.ts",
    "../../api/solana/treasury/build/route.ts",
    "../../api/solana/treasury/submit/route.ts",
    "../../api/solana/treasury/state/[address]/route.ts",
  ].map(code);
  const answered = new Set([...CHAIN_REFUSAL_CODES, "VALIDATION_ERROR", "RATE_LIMITED", "UNAVAILABLE"]);
  for (const source of sources) {
    for (const match of source.matchAll(/(?:fail|TreasuryRefusal|treasuryFailure)\(\s*"([A-Z_]+)"/g)) answered.add(match[1]);
    for (const match of source.matchAll(/"(TREASURY_NOT_SENT_[A-Z_]+)"/g)) answered.add(match[1]);
  }
  /* And the page's own: a wallet changed, figures moved on a rebuild, an answer that did not come back. */
  for (const own of ["WALLET_CHANGED", "REVIEW_CHANGED", "TREASURY_SUBMIT_UNKNOWN", "TREASURY_BUILD_EXPIRED"]) answered.add(own);
  assert.ok(answered.size > 30, `read ${answered.size} codes`);
  for (const code of answered) assert.ok(FAILURE_WORDS[code]?.en && FAILURE_WORDS[code]?.uk, code);
  const flow = code("./treasury-flow.tsx");
  /* A known code is said in words, an unknown one as «not done»; the raw text only behind «Details». */
  assert.match(flow, /known \? word\("failed", \{ reason: known \}\) : word\("failedUnknown"\)/);
  assert.match(flow, /<RawText text=\{failure\.message\}/);
  assert.match(flow, /<details className=\{styles\.raw\}>/);
});

test("a Review the network would refuse for want of money keeps its action grey, and says why", () => {
  const flow = code("./treasury-flow.tsx");
  assert.match(flow, /ready=\{action\.phase === "review" && !blocked\}/);
  assert.match(flow, /review\.blockedBy === "wallet" \? word\("blockedWallet"\)/);
  /* Rent is said by where it stays, never promised back. */
  assert.doesNotMatch(Object.values(TREASURY_WORDS).map((value) => value.uk).join("\n"), /повертається при закритті/);
});

test("what the person typed survives a cancelled Review or a refusal; a sent action starts the forms over", () => {
  const surface = code("./treasury-surface.tsx");
  assert.match(surface, /<div key=\{round\} className=\{styles\.surface\} hidden=\{reviewing \|\| action\.phase === "done"\}>/);
  assert.match(surface, /setRound\(\(current\) => current \+ 1\)/);
  assert.match(code("./treasury.module.css"), /\.surface\[hidden\] \{\s*display: none;/);
});

test("an answer that did not come back is never told as «nothing was sent»: the forms start over and the chain is read again", () => {
  const flow = code("./treasury-flow.tsx");
  /* Only the answers that say the network was never reached, or refused the first part, are «not sent». */
  assert.match(flow, /const unknown = !NOT_SENT_CODES\.has\(sent\.code\);/);
  assert.match(flow, /setFailure\(unknown \? \{ code: "TREASURY_SUBMIT_UNKNOWN", message: sent\.message \} : sent\);/);
  assert.doesNotMatch(flow.slice(flow.indexOf("const NOT_SENT_CODES"), flow.indexOf("]);", flow.indexOf("const NOT_SENT_CODES"))), /"UNAVAILABLE"|"TREASURY_BUILD_USED"/);
  const surface = code("./treasury-surface.tsx");
  assert.match(surface, /const action = useTreasuryAction\(onDone, onUnknown\);/);
  /* Bytes built again whose figures moved are shown, not signed. */
  assert.match(flow, /return \{ ok: false as const, code: "REVIEW_CHANGED", message: "" \}/);
  assert.ok(FAILURE_WORDS.TREASURY_SUBMIT_UNKNOWN.uk.includes("могла потрапити"));
});

test("an outcome not known is said without «not done», and a vote's Review carries what it authorises", () => {
  const flow = code("./treasury-flow.tsx");
  assert.match(flow, /unknownOutcome && known \? known/);
  assert.match(flow, /role=\{unknownOutcome \? "status" : "alert"\}/);
  /* A «for» on payouts says what leaves the vault once they run; recipients and changes are in the Review. */
  assert.match(flow, /word\("payAfterVote", \{ sum: outflow \}\)/);
  assert.match(flow, /review\.changes\.map\(\(change\) => changeWhat\(change, locale\)\)/);
  assert.match(flow, /request\.kind === "spend" && review\.to\[0\] \? \[\{ label: word\("to"\), value: review\.to\[0\] \}\]/);
  /* A limit is said whole: who spends, where it pays, an empty list as «anywhere». */
  assert.match(TREASURY_WORDS.what_addLimitFull.uk, /витрачає: \{spenders\} · куди: \{destinations\}/);
});
