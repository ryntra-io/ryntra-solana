import { createNextLineage, createRootLineage } from '../../../lib/strategy-lab/lineage.ts';
import { changedFields, type BotDraft } from './draft.ts';
import { latest, type Strategy } from './strategies.ts';

/**
 * Saving, versioning and forking a strategy on Strategy Lab's lineage. Its own module, loaded when a strategy is saved:
 * the lineage's schemas stay out of the city's first frame.
 */

/** A new strategy from a draft: version 1, a root of its own family. */
export function saveStrategy(input: Readonly<{ id: string; versionId: string; name: string; draft: BotDraft; now: number }>): Strategy {
  return {
    id: input.id,
    name: input.name.trim().slice(0, 48) || 'Strategy',
    owner: 'me',
    author: null,
    createdAt: input.now,
    closedAt: null,
    versions: [{ id: input.versionId, at: input.now, draft: input.draft, lineage: createRootLineage(), note: '' }],
    forkOf: null,
    record: null,
    twinFrom: input.now,
  };
}

/** A new version, when the draft really changed: the child names the version before it and what changed. */
export function addVersion(strategy: Strategy, input: Readonly<{ versionId: string; draft: BotDraft; note: string; now: number }>): Strategy {
  const parent = latest(strategy);
  const changed = changedFields(parent.draft, input.draft);
  if (!changed.length || strategy.owner !== 'me') return strategy;
  const lineage = createNextLineage({
    parentRunId: parent.id,
    parentIteration: parent.lineage.iterationNumber,
    hypothesis: input.note.trim().slice(0, 500) || changed.join(', '),
    changedFields: changed,
    parentTestWindowStatus: 'sealed',
  });
  return { ...strategy, versions: [...strategy.versions, { id: input.versionId, at: input.now, draft: input.draft, lineage, note: input.note.trim().slice(0, 500) }] };
}

/** A fork: a strategy of your own that starts from another's version, keeping where it came from. */
export function forkStrategy(source: Strategy, input: Readonly<{ id: string; versionId: string; now: number; name?: string }>): Strategy {
  const from = latest(source);
  return {
    id: input.id,
    name: (input.name ?? source.name).trim().slice(0, 48),
    owner: 'me',
    author: null,
    createdAt: input.now,
    closedAt: null,
    versions: [{ id: input.versionId, at: input.now, draft: { ...from.draft, copiedFrom: { strategyId: source.id, versionId: from.id } }, lineage: createRootLineage(), note: '' }],
    forkOf: { strategyId: source.id, versionId: from.id, name: source.name },
    record: null,
    twinFrom: input.now,
  };
}
