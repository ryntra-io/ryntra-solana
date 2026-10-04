/**
 * What a model sees when it words a Brief or a Critic.
 *
 * The same discipline as the conversation's packet (`model.ts`): facts,
 * notes and citations — never a key, never another wallet, never the raw
 * tool input, never the person's session. The one addition is the
 * deterministic composition itself, because a model here **rewords**; it
 * does not decide what the finding is. The ids, kinds, figures and
 * citations the person sees are the server's whatever the model returns
 * (`verifyCritic`), so the worst a bad answer can do is read worse than the
 * deterministic one.
 *
 * This module exists to keep `model.ts` and `lens/service.ts` from
 * importing each other.
 */

import type { AgentBrief, AgentContext, AgentCritic } from "../../api/v1/contract.ts";
import type { CitationBook, Locale } from "../provenance.ts";
import type { LensReads } from "./reads.ts";

export type LensFormat = "brief" | "critic";

export type LensPacket = Readonly<{
  format: LensFormat;
  subject: AgentContext;
  locale: Locale;
  reads: LensReads;
  citations: CitationBook;
  /** The deterministic composition the model is rewording; null for the format not asked for. */
  brief: AgentBrief | null;
  critic: AgentCritic | null;
}>;

/** The packet as the model receives it — bounded, flat, and free of anything the person did not already see. */
export function lensModelInput(packet: LensPacket): Record<string, unknown> {
  return {
    locale: packet.locale,
    format: packet.format,
    subject: packet.subject.kind,
    citations: packet.citations.list().map((cite) => ({ id: cite.id, source: cite.source, observedAt: cite.observedAt, state: cite.state })),
    facts: packet.reads.runs.flatMap((run) => run.facts.map((fact) => ({ cite: fact.cite, label: fact.label, value: fact.value, unit: fact.unit, state: fact.state }))).slice(0, 120),
    notes: packet.reads.runs.flatMap((run) => run.notes.map((note) => ({ section: note.section, text: note.text, cites: note.cites }))).slice(0, 60),
    tools: packet.reads.runs.map((run) => ({ tool: run.tool, outcome: run.outcome, state: run.state })),
    draft: packet.format === "brief" ? packet.brief : packet.critic,
  };
}
