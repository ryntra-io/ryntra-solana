import { Chip, type ChipTone } from '@/components/chip'
import type { AgentCopy } from '@/features/agent/copy'
import type { AgentMoveMark } from '@/lib/api'

/* How sure a line is, said before it: a fact quiet, a publication's report amber, Ryntra's reading its own colour. */
const MARK_TONE: Readonly<Record<AgentMoveMark, ChipTone>> = {
  fact: 'neutral',
  unverified: 'warning',
  inference: 'evidence',
  unknown: 'neutral',
}

/** The mark of a move's row or a brief's line — Fact, Unverified, Inference, Unknown (1.44.0, 1.46.0). */
export function MarkChip({ mark, copy }: { mark: AgentMoveMark; copy: AgentCopy }) {
  return <Chip label={copy.mark[mark]} tone={MARK_TONE[mark]} caps={false} />
}
