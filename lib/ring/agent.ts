/**
 * What an agent is (CITY-50, decision 72): a body, a brain and a script, in one garage slot of its owner's quarter.
 * The rules every route checks before the store is asked anything.
 *
 * Pure: no store, no clock, no network.
 */

import { FORMATS, SCENARIO_MAX, isArchetype, type Archetype, type RingFormat } from "./contract.ts";

/**
 * What the published harness of a format asks of a brain (CITY-51 owns the harness; this is what the Ring checks now,
 * so the picker can say which formats a model can play): Duo Crack is plain text; Code calls tools that run the open
 * tests; a Market Replay move is a strict JSON order.
 */
export const FORMAT_NEEDS: Readonly<Record<RingFormat, Readonly<{ tools?: boolean; structuredOutputs?: boolean }>>> = {
  "duo-crack": {},
  code: { tools: true },
  "market-replay": { structuredOutputs: true },
};

/** The formats a brain can play, from what its pinned endpoints can do. */
export function formatsOf(can: Readonly<{ tools: boolean; structuredOutputs: boolean }>): RingFormat[] {
  return FORMATS.filter((format) => {
    const needs = FORMAT_NEEDS[format];
    return (!needs.tools || can.tools) && (!needs.structuredOutputs || can.structuredOutputs);
  });
}

const BODY_NAMES: Readonly<Record<Archetype, string>> = {
  guardian: "Guardian",
  fighter: "Fighter",
  tactician: "Tactician",
  scout: "Scout",
  engineer: "Engineer",
  host: "Host",
};

/** An agent's name: its body and four characters of its id. No free text anyone else reads, so nothing to moderate. */
export function agentName(archetype: Archetype, id: string): string {
  const tag = id.replace(/[^0-9a-z]/gi, "").slice(0, 4).toUpperCase() || "0000";
  return `${BODY_NAMES[archetype]} ${tag}`;
}

export type ScenarioCheck = { ok: true; text: string } | { ok: false; code: "TOO_LONG" | "BAD_REQUEST" };

/**
 * A script as it is kept: NFC, line ends as `\n`, no control characters but line breaks and tabs, no trailing space.
 * Empty is allowed — the agent then plays the harness's own way. Longer than `SCENARIO_MAX` code points is refused,
 * never cut.
 */
export function checkScenario(raw: unknown): ScenarioCheck {
  if (typeof raw !== "string") return { ok: false, code: "BAD_REQUEST" };
  const text = scenarioText(raw);
  if ([...text].length > SCENARIO_MAX) return { ok: false, code: "TOO_LONG" };
  return { ok: true, text };
}

/**
 * A script as the server keeps it — the client counts the same text. Zero-width space, direction marks and embeddings,
 * isolates and the BOM go; the zero-width joiner and non-joiner stay (emoji sequences and scripts that need them).
 */
export function scenarioText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​‎‏‪-‮⁦-⁩﻿]/g, "")
    .trimEnd();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A quarter's id as the world gives it. */
const QUARTER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The model's id as OpenRouter lists it; the gateway checks it in full. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;

export const isAgentId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export const isQuarterId = (value: unknown): value is string => typeof value === "string" && QUARTER_ID.test(value);
export const isSlot = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 63;
export const isModelId = (value: unknown): value is string => typeof value === "string" && MODEL_ID.test(value);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000;

/** The body, brain and script a create or a change asks for. */
export type AgentDraft = { archetype: Archetype; model: string; scenario: string };

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: "BAD_REQUEST" | "TOO_LONG"; message: string };

function draftOf(body: Record<string, unknown>): Parsed<AgentDraft> {
  if (!isArchetype(body.archetype)) return { ok: false, code: "BAD_REQUEST", message: "archetype is one of the six bodies." };
  if (!isModelId(body.model)) return { ok: false, code: "BAD_REQUEST", message: "model is an OpenRouter model id." };
  const scenario = checkScenario(body.scenario ?? "");
  if (!scenario.ok) return scenario.code === "TOO_LONG" ? { ok: false, code: "TOO_LONG", message: `A script is ${SCENARIO_MAX.toLocaleString("en-US")} characters at most.` } : { ok: false, code: "BAD_REQUEST", message: "scenario is text." };
  return { ok: true, value: { archetype: body.archetype, model: body.model, scenario: scenario.text } };
}

export function parseCreate(body: Record<string, unknown>): Parsed<AgentDraft & { quarterId: string; slot: number }> {
  if (!isQuarterId(body.quarter) || !isSlot(body.slot)) return { ok: false, code: "BAD_REQUEST", message: "quarter and slot name a garage of your quarter." };
  const draft = draftOf(body);
  return draft.ok ? { ok: true, value: { ...draft.value, quarterId: body.quarter, slot: body.slot } } : draft;
}

export function parseChange(body: Record<string, unknown>): Parsed<AgentDraft & { id: string; version: number }> {
  if (!isAgentId(body.agent) || !isVersion(body.version)) return { ok: false, code: "BAD_REQUEST", message: "agent and version name the agent as you saw it." };
  const draft = draftOf(body);
  return draft.ok ? { ok: true, value: { ...draft.value, id: body.agent, version: body.version } } : draft;
}

export function parseOff(body: Record<string, unknown>): Parsed<{ id: string; version: number }> {
  if (!isAgentId(body.agent) || !isVersion(body.version)) return { ok: false, code: "BAD_REQUEST", message: "agent and version name the agent as you saw it." };
  return { ok: true, value: { id: body.agent, version: body.version } };
}
