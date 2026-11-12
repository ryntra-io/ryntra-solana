import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { brainLabel, brainMark, brainNamed, catalogName, listMark, twinLabels, twinMarks } from "./format.ts";

// CITY-236: a brain's name as a person reads it. The catalog's own name («Google: Gemma 4 26B A4B (free)») did not fit
// a phone's line and was cut mid-word; the screens show the model's name, and the catalog's stays behind «i».

test("the maker in front and the catalog's marks in brackets are left out", () => {
  assert.equal(brainLabel("Google: Gemma 4 26B A4B (free)"), "Gemma 4 26B A4B");
  assert.equal(brainLabel("Google: Gemma 4 26B A4B  (free)"), "Gemma 4 26B A4B", "the catalog's double space too");
  assert.equal(brainLabel("OpenAI: GPT-6 Luna (batch)"), "GPT-6 Luna");
  assert.equal(brainLabel("Cohere: Command R7B (12-2024)"), "Command R7B");
  assert.equal(brainLabel("Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)"), "Nano Banana 2");
  assert.equal(brainLabel("Mistral: Mistral Small 3.2"), "Mistral Small 3.2");
});

test("a name with no maker, or one that would be left empty, is kept", () => {
  assert.equal(brainLabel("GPT-6 Luna"), "GPT-6 Luna");
  assert.equal(brainLabel("(free)"), "(free)");
  assert.equal(brainLabel("Stand: "), "Stand:");
  assert.equal(brainLabel("  Qwen:   Qwen3 Next 80B A3B Instruct  "), "Qwen3 Next 80B A3B Instruct");
});

test("only the first «maker: » goes, and only the brackets at the end", () => {
  assert.equal(brainLabel("Meta: Llama 3.3 (70B) Instruct"), "Llama 3.3 (70B) Instruct");
  assert.equal(brainLabel("Lab: Model: Turbo (free) (batch)"), "Model: Turbo");
});

test("two brains of one name keep the catalog's mark beside it, without the brackets", () => {
  const names = ["OpenAI: GPT-4o", "OpenAI: GPT-4o (2024-11-20)", "OpenAI: GPT-4o (batch)", "Google: Gemma 4 31B (free)", "Mistral: Mistral Small 3.2"];
  assert.deepEqual([...twinLabels(names)], ["GPT-4o"], "only the name that stands twice");
  assert.equal(brainMark("OpenAI: GPT-4o (2024-11-20)"), "2024-11-20");
  assert.equal(brainMark("OpenAI: GPT-4o (batch)"), "batch");
  assert.equal(brainMark("Lab: Model: Turbo (free) (batch)"), "free · batch");
  assert.equal(brainMark("OpenAI: GPT-4o"), "", "the plain one has none");
  assert.equal(brainMark("Meta: Llama 3.3 (70B) Instruct"), "", "brackets inside a name are the name");
  const editor = readFileSync(new URL("../../components/ring/RingEditor.tsx", import.meta.url), "utf8");
  // CITY-240: the marks come from one rule for the list and for the line that names the pick (`twinMarks`).
  assert.match(editor, /mark=\{marks\.get\(m\.id\) \?\? ''\}/, "the list marks only the twins");
  assert.match(editor, /\{mark \? <i className=\{r\.modelMark\}> · \{mark\}<\/i> : null\}/);
});

/* CITY-240: two brains of one shortened name read the same once picked — «Command R (08-2024)» and «Command R» were
   both «Command R · Light · <$0.01 a match» in the line that says what is being made. */
const brain = (id, name, matchMicroUsd = 7_800) => ({ id, name, matchMicroUsd });

test("a twin keeps its mark wherever it is named: in the list and in the line that names the pick", () => {
  const list = [brain("cohere/command-r-08-2024", "Cohere: Command R (08-2024)"), brain("cohere/command-r", "Cohere: Command R"), brain("cohere/command-r-plus-08-2024", "Cohere: Command R+ (08-2024)", 130_000), brain("mistral/small", "Mistral: Mistral Small 3.2")];
  const marks = twinMarks(list);
  assert.equal(marks.get("cohere/command-r-08-2024"), "08-2024");
  assert.equal(marks.get("cohere/command-r"), "", "the undated twin is the plain name");
  assert.equal(marks.has("cohere/command-r-plus-08-2024"), false, "«Command R+» stands alone: its date is not said");
  assert.equal(marks.has("mistral/small"), false);
  assert.equal(brainNamed("Cohere: Command R (08-2024)", marks.get("cohere/command-r-08-2024")), "Command R (08-2024)");
  assert.equal(brainNamed("Cohere: Command R", marks.get("cohere/command-r")), "Command R");
  assert.equal(brainNamed("Cohere: Command R+ (08-2024)"), "Command R+", "no twin, no mark");
  // Every pair of twins reads apart on a row: by its mark, or by its price.
  const reads = (b) => `${brainNamed(b.name, marks.get(b.id) ?? "")}|${b.matchMicroUsd === 0 ? "free" : "paid"}`;
  const twins = list.filter((b) => marks.has(b.id));
  assert.equal(new Set(twins.map(reads)).size, twins.length);
});

test("the catalog of the day: every twin reads apart — a date, or the price of a free one — and never by a raw word", () => {
  // The twins of ryntra.io's list on 10.11: dated versions, and the free variants of seven brains.
  const list = [
    brain("openai/gpt-4o", "OpenAI: GPT-4o", 130_000),
    brain("openai/gpt-4o-2024-08-06", "OpenAI: GPT-4o (2024-08-06)", 130_000),
    brain("openai/gpt-4o-2024-11-20", "OpenAI: GPT-4o (2024-11-20)", 130_000),
    brain("openai/gpt-4o-2024-05-13", "OpenAI: GPT-4o (2024-05-13)", 240_000),
    brain("openai/gpt-4o-mini", "OpenAI: GPT-4o-mini"),
    brain("openai/gpt-4o-mini-2024-07-18", "OpenAI: GPT-4o-mini (2024-07-18)"),
    brain("google/gemma-4-26b-a4b-it:free", "Google: Gemma 4 26B A4B  (free)", 0),
    brain("google/gemma-4-26b-a4b-it", "Google: Gemma 4 26B A4B ", 3_280),
  ];
  const marks = twinMarks(list);
  assert.deepEqual(list.map((b) => marks.get(b.id)), ["", "2024-08-06", "2024-11-20", "2024-05-13", "", "2024-07-18", "", ""]);
  for (const mark of marks.values()) assert.doesNotMatch(mark, /free|batch/i);
  // The free twin and the paid one are told apart by the row's price: «Free a match» against a sum.
  const shown = (b) => `${brainNamed(b.name, marks.get(b.id))}|${b.matchMicroUsd === 0}`;
  assert.equal(new Set(list.map(shown)).size, list.length);
});

test("two makers' brains of one name and one price take their makers' names; one maker's stay as they are", () => {
  const marks = twinMarks([brain("a/turbo", "Acme: Turbo"), brain("b/turbo", "Bolt: Turbo"), brain("c/turbo-8b", "Core: Turbo (8B)")]);
  assert.equal(marks.get("a/turbo"), "Acme");
  assert.equal(marks.get("b/turbo"), "Bolt");
  assert.equal(marks.get("c/turbo-8b"), "8B", "it already reads apart");
  // A dated pair of two makers: the maker in front of the date.
  const dated = twinMarks([brain("a/x", "Acme: X (2025)"), brain("b/x", "Bolt: X (2025)")]);
  assert.deepEqual([dated.get("a/x"), dated.get("b/x")], ["Acme · 2025", "Bolt · 2025"]);
  // One maker, one name, one price, no mark: nothing true is left to say (the catalog's id is never shown).
  const same = twinMarks([brain("a/y", "Acme: Y"), brain("a/y-2", "Acme: Y")]);
  assert.deepEqual([same.get("a/y"), same.get("a/y-2")], ["", ""]);
  // A different price is already a different row.
  const priced = twinMarks([brain("a/z", "Acme: Z", 9_000), brain("b/z", "Bolt: Z", 90_000)]);
  assert.deepEqual([priced.get("a/z"), priced.get("b/z")], ["", ""]);
  assert.equal(twinMarks([]).size, 0);
});

// CITY-239: the list never says the catalog's raw English words. «free» is said by the row's price, in the language on
// screen; a «batch» twin is not offered at all. A date or a size is the same in any language and stays.
test("the list's mark beside a twin: a date or a size, never a raw «free» or «batch»", () => {
  assert.equal(listMark("Google: Gemma 4 26B A4B (free)"), "");
  assert.equal(listMark("OpenAI: GPT-4o (batch)"), "");
  assert.equal(listMark("Lab: Model: Turbo (Free) (BATCH)"), "", "whatever the catalog's case");
  assert.equal(listMark("OpenAI: GPT-4o (2024-11-20)"), "2024-11-20");
  assert.equal(listMark("Lab: Model (8B) (free)"), "8B", "what tells two brains apart stays, the raw word goes");
  assert.equal(listMark("OpenAI: GPT-4o"), "");
  // The catalog's own name is still what «i» shows once a brain is picked — without the raw word too (CITY-240).
  assert.equal(brainMark("Google: Gemma 4 26B A4B (free)"), "free");
  const editor = readFileSync(new URL("../../components/ring/RingEditor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /brainMark\(/, "no screen of the editor writes the raw mark");
  assert.match(editor, /\[catalogName\(brain\.name\), brain\.provider\]\.filter\(Boolean\)\.join\(' · '\)/, "the catalog's name: behind «i»");
});

test("every screen of the Ring names a brain through it, and none cuts the name mid-word", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const editor = read("../../components/ring/RingEditor.tsx");
  assert.match(editor, /<b>\s+\{brainLabel\(model\.name\)\}/, "the list of brains");
  assert.match(editor, /`\$\{brainNamed\(brain\.name, marks\.get\(editor\.model \?\? ''\) \?\? ''\)\} · \$\{WEIGHT_NAMES\[brain\.weight\]\} · \$\{perMatch\(brain\.cost\)\}`/, "the summary under the steps");
  assert.match(editor, /\[catalogName\(brain\.name\), brain\.provider\]\.filter\(Boolean\)\.join\(' · '\)/, "the catalog's name and the provider: behind «i»");
  assert.doesNotMatch(editor, /<b>\{quote\.quote\.providerName\}<\/b>/, "no provider's line on the screen");
  assert.match(read("../../components/ring/arena/AgentTab.tsx"), /\{brainLabel\(agent\.brain\.name\)\}/, "the agent's card");
  assert.match(read("../../components/ring/arena/BoardTab.tsx"), /\{brainLabel\(row\.brain\)\}/, "the board");
  assert.match(read("../../components/ring/RingGarage.tsx"), /\{brainLabel\(agent\.brain\.name\)\}/, "the garage");
  const css = read("../../components/ring/ring.module.css");
  for (const rule of [".brain", ".modelHead b", ".summaryWords span"]) {
    const body = css.slice(css.indexOf(`\n${rule} {`), css.indexOf("}", css.indexOf(`\n${rule} {`)));
    assert.ok(body.length > 0, rule);
    assert.doesNotMatch(body, /text-overflow: ellipsis|white-space: nowrap/, `${rule} wraps`);
  }
});

/* CITY-240: behind «i» on the script step a Ukrainian reader met the catalog's raw English «(free)» — «Google: Gemma 4
   26B A4B (free) · DeepInfra» under a line that already says «Безкоштовно». The name is the model's, not its price:
   one rule for both languages. */
test("behind «i»: the brain as its catalog names it, without the raw «(free)» and «(batch)»", () => {
  assert.equal(catalogName("Google: Gemma 4 26B A4B (free)"), "Google: Gemma 4 26B A4B");
  assert.equal(catalogName("Google: Gemma 4 26B A4B  (free)"), "Google: Gemma 4 26B A4B", "the catalog's double space too");
  assert.equal(catalogName("OpenAI: GPT-6 Luna (batch)"), "OpenAI: GPT-6 Luna");
  assert.equal(catalogName("Lab: Model: Turbo (Free) (BATCH)"), "Lab: Model: Turbo", "whatever the catalog's case");
  // What names the model stays: the maker, a date, a size, a second name.
  assert.equal(catalogName("Cohere: Command R (08-2024)"), "Cohere: Command R (08-2024)");
  assert.equal(catalogName("Lab: Model (8B) (free)"), "Lab: Model (8B)");
  assert.equal(catalogName("Lab: Model (free) (8B)"), "Lab: Model (8B)", "wherever the raw word stands among the marks");
  assert.equal(catalogName("Google: Nano Banana (Gemini 2.5 Flash Image)"), "Google: Nano Banana (Gemini 2.5 Flash Image)");
  assert.equal(catalogName("Meta: Llama 3.3 (70B) Instruct"), "Meta: Llama 3.3 (70B) Instruct", "brackets inside a name are the name");
  assert.equal(catalogName("Mistral: Mistral Small 3.2"), "Mistral: Mistral Small 3.2");
  // A name that would be left empty is kept as it is.
  assert.equal(catalogName("(free)"), "(free)");
  assert.equal(catalogName("  (free)  (batch) "), "(free) (batch)");
  // The line above «i» says the price in the language on screen; the editor writes the name through this rule only.
  const editor = readFileSync(new URL("../../components/ring/RingEditor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /\[brain\.name, brain\.provider\]/, "no raw catalog name on the screen");
});
