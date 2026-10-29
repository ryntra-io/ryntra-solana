// Run from repo root: node --test app/app/ryn/assistant-panel.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { asksByItself, closeAssistant, openAssistant, readAssistantPanel, toggleAssistant } from "./assistant-open.ts";

/**
 * AI-06a — the assistant opens from the header of every page of Ryntra on
 * Solana as a side panel of the conversation, and from «Пояснити рух» on a
 * token's page and over its chart, with the question asked. The panel is the
 * full page's own conversation; no tool of it signs, sends or trades.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const SHELL = read("../product-shell.tsx");
const PANEL = read("./assistant-panel.tsx");
const SURFACE = read("./ryn-surface.tsx");
const MOVE = read("./explain-move.tsx");
const SPOT = read("../../solana/workspace/spot/market-header.tsx");
const LAUNCH = read("../launch/[mint]/token-market.tsx");

test("the header's button opens the side panel about the screen, beside the page — not a trip to /app/ryn", () => {
  assert.equal((SHELL.match(/<AssistantPanel\b/g) ?? []).length, 1, "the frame draws the one panel");
  assert.match(SHELL, /toggleAssistant\(screenContext\(pathname, /);
  assert.doesNotMatch(SHELL, /router\.push\(rynHref/);
  assert.match(SHELL, /assistantOpen=\{pathname === ASSISTANT\.href \|\| assistant\.open\}/);
  assert.match(SHELL, /onAssistant=\{pathname === ASSISTANT\.href \? undefined : onAssistant\}/, "the full page has no second way into itself");
});

test("the panel is the full page's conversation: the guest's and the wallet's, compact, the full page one press away", () => {
  assert.match(PANEL, /<RynSurface key=\{request\.seq\}[^>]*initialTab=\{request\.tab\} compact autoAsk=\{request\.ask !== null\}/);
  assert.match(PANEL, /rynHref\(request\.context\)/);
  assert.match(PANEL, /event\.key === "Escape"/);
  assert.match(PANEL, /role="dialog" aria-modal="false"/);
  /* AI-06: the panel and the page are one surface with the same tabs; the panel draws a tab only once it is shown. */
  assert.equal((SURFACE.match(/<BriefPanel\b/g) ?? []).length, 1, "the brief is drawn once, in its tab");
  assert.equal((SURFACE.match(/<CreditsPanel\b/g) ?? []).length, 1, "the credits are drawn once, in their tab");
  assert.match(SURFACE, /const drawn = \(id: AssistantTab\) => !compact \|\| seen\.has\(id\);/);
  assert.match(SURFACE, /newConversation/);
  /* A question asked by a press reaches the model by itself only while the free credits pay: nothing of the balance without the price shown. */
  assert.match(SURFACE, /if \(!asked\.current && asksByItself\(autoAsk, shownPrice\(phase\.budget\)\)\) \{\s*asked\.current = true;\s*void send\(initialQuestion\);\s*\} else setText\(initialQuestion\);/);
  /* One press asks once, across the guest's surface and the wallet's: the flag is the surface's, handed to the guest. */
  assert.match(SURFACE, /asked=\{asked\} wants=\{initialTab\} \/>/);
});

test("«Пояснити рух» stands in the token's strip on Spot and over the launch's chart, and asks what moved the price", () => {
  assert.match(SPOT, /<ExplainMove mint=\{mint\}/);
  assert.match(LAUNCH, /<ExplainMove mint=\{token\} symbol=\{symbol\}/);
  assert.match(MOVE, /const context = \{ kind: "asset" as const, mint/);
  assert.match(MOVE, /tab === null \? openAssistant\(context, name \? word\("explainAsk"\)/);
  /* AI-06: «Стежити» and «План» beside it open their tabs and ask nothing. */
  assert.match(MOVE, /: openAssistant\(context, null, tab\)\)/);
  assert.match(MOVE, /tab: "watch" as const, label: word\("actWatch"\)/);
  assert.match(MOVE, /tab: "plans" as const, label: word\("actPlan"\)/);
});

test("the panel's store: every opening is a new one with its own question, the header's press toggles", () => {
  const SOL = { kind: "asset", mint: "So11111111111111111111111111111111111111112", symbol: "SOL" };
  closeAssistant();
  const before = readAssistantPanel().request.seq;
  openAssistant(SOL, "Що зрушило ціну SOL?");
  assert.deepEqual(readAssistantPanel(), { open: true, request: { context: SOL, ask: "Що зрушило ціну SOL?", tab: null, seq: before + 1 } });
  /* The same press again is asked again: a new opening, not the closed panel's state. */
  openAssistant(SOL, "Що зрушило ціну SOL?");
  assert.equal(readAssistantPanel().request.seq, before + 2);
  toggleAssistant({ kind: "portfolio" });
  assert.equal(readAssistantPanel().open, false, "the header's second press closes");
  toggleAssistant({ kind: "portfolio" });
  assert.deepEqual(readAssistantPanel().request, { context: { kind: "portfolio" }, ask: null, tab: null, seq: before + 3 }, "the header's press asks nothing");
  /* AI-06: «Стежити» on a token opens «Стежу» about it and asks nothing. */
  openAssistant(SOL, null, "watch");
  assert.deepEqual(readAssistantPanel().request, { context: SOL, ask: null, tab: "watch", seq: before + 4 });
  closeAssistant();
  assert.equal(readAssistantPanel().open, false);
});

test("a pressed question asks by itself only while the line says «free»: never from the balance unasked", () => {
  assert.equal(asksByItself(true, 0), true, "the day's free credits pay");
  assert.equal(asksByItself(true, undefined), true, "no credits on this deployment");
  assert.equal(asksByItself(true, 2), false, "the balance would pay: it waits in the field under the price");
  assert.equal(asksByItself(false, 0), false, "the header's press asks nothing");
});

test("Escape is the panel's own, the phone's «На всю сторінку» keeps its name, «Пояснити рух» is expanded only for its own token", () => {
  assert.match(PANEL, /panelRef\.current\?\.contains\(target\)/);
  assert.match(PANEL, /aria-label=\{word\("panelOpenFull"\)\}/);
  assert.match(MOVE, /aria-expanded=\{aboutThis && \(request\.tab \?\? null\) === tab\}/);
  assert.match(MOVE, /now\.request\.context\.mint !== mint\) closeAssistant\(\)/);
});

test("no tool of the panel signs, sends, trades or reads a key — the words of the panel's files name none", () => {
  for (const source of [PANEL, MOVE, read("./assistant-open.ts")]) {
    assert.doesNotMatch(source, /signTransaction|sendTransaction|signMessage|privateKey|secretKey|\/api\/v1\/(spot|swap|send)/);
  }
});
