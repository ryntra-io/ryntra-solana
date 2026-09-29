/**
 * The evidence envelope, reused — not copied.
 *
 * The envelope in `lib/evidence/envelope.ts` is chain-neutral: a value arrives
 * with its provenance or with the reason it could not. Copying it here would
 * create the second copy that drifts, so Solana imports the one implementation.
 */
export {
  EVIDENCE_STATES,
  isResolved,
  resolved,
  unavailable,
  unknown,
  conflicting,
  mapEvidence,
  toEnvelope,
} from "../evidence/envelope.ts";
export type {
  Evidence,
  EvidenceSource,
  EvidenceSources,
  EvidenceState,
  ResolvedEvidence,
  UnresolvedEvidence,
} from "../evidence/envelope.ts";
