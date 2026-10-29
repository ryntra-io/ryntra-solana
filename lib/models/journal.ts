/**
 * The journal of model calls (CITY-45): one record per call — who it was
 * for, which model was asked for and which answered, the tokens, the cost in
 * micro-dollars and the outcome. The default writes one line to the runtime
 * log, the way the assistant's `[assistant.cost]` line does; a game hands its
 * own journal to keep the records in its store. A record never carries the
 * prompt, the reply, the reasoning or a key.
 */

import type { ModelCallRecord, ModelJournal } from "./types.ts";

export function journalLine(record: ModelCallRecord): string {
  return `[models.call] ${JSON.stringify({
    subject: record.subject ? `${record.subject.kind}:${record.subject.id}` : null,
    model: record.requested.model,
    providers: record.requested.providers,
    answeredModel: record.answered?.model ?? null,
    answeredProvider: record.answered?.provider ?? null,
    pinned: record.answered?.pinned ?? null,
    generation: record.generationId,
    key: record.key,
    input: record.usage?.input ?? null,
    cached: record.usage?.cached ?? null,
    output: record.usage?.output ?? null,
    reasoning: record.usage?.reasoning ?? null,
    costMicroUsd: record.costMicroUsd,
    latencyMs: record.latencyMs,
    outcome: record.outcome,
    finish: record.finishReason,
  })}`;
}

export const consoleJournal: ModelJournal = (record) => {
  console.info(journalLine(record));
};
