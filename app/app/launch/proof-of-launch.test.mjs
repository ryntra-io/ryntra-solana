// SOL-L3 «Proof-of-Launch»: on a token's page every statement about the token — supply, distribution, the LP lock, the
// mint and freeze rights, the creator's activity, the fees, the move to the DEX — comes with its link to the chain; no
// badge says «Safe» and no line promises an absence of risk; the survival of Ryntra's markets at 7, 30 and 90 days is
// public; the metadata and the picture name their immutable IPFS address.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LAUNCH_WORDS } from "./launch-words.ts";
import { PROOF_CODES, PROOF_EVIDENCE_KINDS, PROOF_TOPICS } from "../../../lib/core/launch/proof.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const PAGE = read("app/app/launch/[mint]/page.tsx");
const ROWS = read("app/app/launch/[mint]/proof-rows.tsx");
const TOKEN = read("app/app/launch/[mint]/token-market.tsx");
const HEALTH = read("app/app/launch/[mint]/market-health.tsx");
const BOARD = read("app/app/launch/markets/markets-board.tsx");
const SURVIVAL = read("app/app/launch/markets/survival-block.tsx");

test("«Доказ запуску» states the rest of the token beside the program rules, each with its link", () => {
  assert.match(PAGE, /<ProofRows\n\s+network=\{token\.network\}/, "the proof's rows live in the marks' block");
  assert.match(PAGE, /receipt=\{proofReceipt\(receipt, partners\)\}/, "from the receipt the server read, its positions by whose share");
  assert.match(ROWS, /proofOfLaunch\(\{/);
  assert.match(ROWS, /useLaunchRead\(\)/, "from the market and the health the page read");
  assert.match(ROWS, /href=\{explorerUrl\(network, link\.kind, link\.id\)\}/, "every statement's links");
  assert.match(ROWS, /section\.claims\.length === 0 \? <span className=\{styles\.cellUnread\}> · \{word\("proofTopicUnread"\)\}/, "a topic not read says so");
  assert.match(ROWS, /section\.claims\.length && section\.unread \? <p className=\{styles\.unread\}>\{word\("proofTopicPartial"\)\}/, "a topic read in part says the rest is not read");
  assert.match(ROWS, /if \(shown\.every\(\(section\) => section\.claims\.length === 0\)\) return <p className=\{styles\.unread\}>\{word\("proofAllUnread"\)\}/, "nothing read: one sentence");
  assert.match(TOKEN, /<LaunchReadContext\.Provider value=\{proofRead\}>/, "the token's market hands its read to the server's slots");
  assert.equal((TOKEN.match(/return provide\(/g) ?? []).length, 3, "the market, its skeleton and the market not read: each hands the read down");
});

test("every topic, statement and link of the proof has its words in both languages", () => {
  for (const topic of PROOF_TOPICS.filter((entry) => entry !== "rights" && entry !== "liquidity")) {
    assert.ok(LAUNCH_WORDS[`proofTopic_${topic}`], topic);
  }
  for (const code of PROOF_CODES) {
    /* The program rules and the creator's lock are said by the marks above the rows; the rule program's governance by «Правила ринку» (SOL-L8). */
    if (["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK", "TRANSFER_FEE_UNTIL_DEX", "CURVE_RULES_UNTIL_DEX", "CURVE_RULES_PROGRAM_GOVERNED", "CURVE_HOLDS_FUNDS", "LP_LOCKED", "CREATOR_LOCK"].includes(code)) continue;
    assert.ok(LAUNCH_WORDS[`proof_${code}`], code);
  }
  for (const what of PROOF_EVIDENCE_KINDS) assert.ok(LAUNCH_WORDS[`proofWhat_${what}`], what);
});

test("a fact of «Risk» or a tile of «Здоров'я ринку» about the token carries its link", () => {
  assert.match(TOKEN, /const source = fact\.source \?\? riskFactEvidence\(fact\.code/, "a count over many holders links the mint");
  assert.match(HEALTH, /<ChainLink network=\{health\.network\} kind="account" id=\{health\.creator\.address\}/, "the creator's tile, at their account");
  assert.equal((HEALTH.match(/<ChainLink network=\{health\.network\} kind="account" id=\{health\.token\}/g) ?? []).length, 2, "the holders' and the concentration's tiles, at the mint");
});

test("no badge says «Safe» and no line promises the absence of risk", () => {
  const verdict = /\bsafe\b|\bsafety\b|безпечн|risk[- ]free|no risk|без ризику|ризику немає|надійн|\bverified\b/i;
  for (const [key, value] of Object.entries(LAUNCH_WORDS)) {
    for (const text of [value.en, value.uk]) assert.doesNotMatch(text, verdict, `${key}: ${text}`);
  }
  for (const source of [PAGE, ROWS, TOKEN, HEALTH, BOARD, SURVIVAL]) assert.doesNotMatch(source, /["'>]\s*(Safe|SAFE|Безпечно)\s*["'<]/);
  assert.match(LAUNCH_WORDS.proofLede.uk, /не оцінка ризику/);
});

test("the survival at 7, 30 and 90 days is on the public board, by its definition, with each market's proof", () => {
  assert.match(BOARD, /<SurvivalBlock locale=\{locale\} network=\{network\} \/>/, "drawn whatever the board shows");
  assert.match(SURVIVAL, /fetch\("\/api\/v1\/launch\/survival"/);
  assert.match(SURVIVAL, /survival\.markets\.filter\(\(market\) => !market\.own\)/, "people's markets only on the public board (B15)");
  assert.match(SURVIVAL, /explorerUrl\(network, "tx", outcome\.proof\.signature\)/, "each market that lived, with its trade");
  assert.match(SURVIVAL, /word\("survDef"\)/, "the definition beside the figures");
  assert.match(LAUNCH_WORDS.survDef.uk, /ніколи не рахуємо тишею/);
  assert.match(read("app/api/v1/launch/survival/route.ts"), /readLaunchSurvival\(deps\)/);
});

test("the metadata and the picture name their IPFS address and their pinned copy", () => {
  assert.match(PAGE, /<Row label=\{word\("receiptMetadata"\)\} value=\{<Stored file=\{token\.storage\.metadata\}/);
  assert.match(PAGE, /file\.ipfs \? \(/, "the IPFS copy once pinned");
  assert.match(PAGE, /word\("storageNotPinned"\)/, "said when it is not pinned yet");
  assert.match(read("lib/launch/view.server.ts"), /storage,\n\s+observedAt/);
});
