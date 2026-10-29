import type { Building, LinkRefusal, LockReason, Quarter, WorldErrorCode } from '../../../lib/world/contract.ts';

/**
 * The living world's shapes come from the world server's own contract (lib/world/contract.ts, which
 * docs/city/WORLD-CONTRACT.md describes), so the city and /api/world can never drift apart. The world never
 * counts or moves money: a building keeps only a link to an engine object.
 */
export type {
  AwayAbout,
  AwayBeat,
  AwayConsent,
  AwayReport,
  AwayResponse,
  Building,
  BuildingKind,
  BuildRequest,
  BuildResponse,
  ChainLink,
  ClaimResponse,
  ConsentRequest,
  ConsentResponse,
  DailyTask,
  Day,
  District,
  DistrictResponse,
  Id,
  LinkKind,
  LinkRefusal,
  LinkRequest,
  LinkResponse,
  LockReason,
  MeResponse,
  PointsEntry,
  PublicBuilding,
  Quarter,
  QuarterResponse,
  QuarterSketch,
  Resident,
  Visit,
  VisitResponse,
  WorldErrorCode,
  WorldEvent,
  WorldVersion,
} from '../../../lib/world/contract.ts';

/** The cell of a quarter in its district. */
export type Cell = Quarter['cell'];

/** Two refusals the client makes itself: the world was out of reach, or it answered something else. */
export type ClientErrorCode = WorldErrorCode | 'OFFLINE' | 'BAD_ANSWER';

/**
 * A request the world refused, or could not answer. A version conflict carries the quarter as it is now; a closed
 * slot, building or module carries the reason and the quarter level that opens it.
 */
export class WorldError extends Error {
  /** The HTTP status; 0 when the world could not be reached. */
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly reason: LockReason | LinkRefusal | null;
  readonly need: { quarterLevel?: number } | null;
  readonly current: { quarter: Quarter; buildings: Building[] } | null;

  constructor(
    status: number,
    code: ClientErrorCode,
    more: { reason?: LockReason | LinkRefusal | null; need?: { quarterLevel?: number } | null; current?: { quarter: Quarter; buildings: Building[] } | null } = {},
  ) {
    super(`world ${status} ${code}${more.reason ? ` (${more.reason})` : ''}`);
    this.name = 'WorldError';
    this.status = status;
    this.code = code;
    this.reason = more.reason ?? null;
    this.need = more.need ?? null;
    this.current = more.current ?? null;
  }
}

export const isWorldError = (e: unknown): e is WorldError => e instanceof WorldError;
