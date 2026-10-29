import { createHttpWorld } from './http.ts';
import { browserStorage, createMockWorld } from './mock.ts';
import type {
  AwayResponse,
  BuildRequest,
  BuildResponse,
  ClaimResponse,
  ConsentRequest,
  ConsentResponse,
  District,
  DistrictResponse,
  Id,
  LinkRequest,
  LinkResponse,
  MeResponse,
  QuarterResponse,
  VisitResponse,
  WorldVersion,
} from './types.ts';

/**
 * The only way the city talks to the living world: one method per route of /api/world
 * (docs/city/WORLD-CONTRACT.md). Every write carries an idempotency key, so a retried tap is never applied twice;
 * when the caller gives none, the client makes one. Nothing in the city calls fetch for the world directly.
 */
export interface WorldClient {
  /** POST /claim — makes a guest if there is none and a quarter on the newcomers' street; claiming again returns it. */
  claim(key?: string): Promise<ClaimResponse>;
  /** GET /me — my resident, quarter, buildings, points and today's tasks; null for a visitor who has not claimed. */
  me(): Promise<MeResponse | null>;
  /** GET /quarter/:id — a quarter and its buildings, as anyone sees them. */
  quarter(id: Id): Promise<QuarterResponse>;
  /** GET /district/:id — the district's quarters seen from afar, a page at a time. */
  district(id: District, cursor?: string | null): Promise<DistrictResponse>;
  /** POST /build — puts a building on a slot or improves it; 409 on a stale version, 422 while closed. */
  build(input: BuildRequest, key?: string): Promise<BuildResponse>;
  /** POST /link — shows an engine object the owner holds on a building; needs a wallet. */
  link(input: LinkRequest, key?: string): Promise<LinkResponse>;
  /** GET /away — what happened to the quarter and its district since a moment, newest first, and the report folded from it. */
  away(since: string): Promise<AwayResponse>;
  /** GET /consent — the channels «While you were away» may also reach (the assistant's Telegram, push); all off at first. */
  consent(): Promise<ConsentResponse>;
  /** POST /consent — the person turns a channel on or off; needs a wallet sign-in. Nothing is sent from the world. */
  setConsent(input: ConsentRequest, key?: string): Promise<ConsentResponse>;
  /** POST /visit — a visit to a quarter, counted once a day. */
  visit(quarterId: Id, key?: string): Promise<VisitResponse>;
  /** GET /version/:id — a frozen city for a challenge on the exact world. */
  version(id: Id): Promise<WorldVersion>;
}

/** The world kept on this device, with the server's own rules: for development and the first screens. */
export const mockWorld: WorldClient = createMockWorld({ storage: browserStorage(), latencyMs: 140 });

/** The world on the server. */
export const httpWorld: WorldClient = createHttpWorld();

/**
 * The world the city uses: the server's, so a quarter is the same on every device. `NEXT_PUBLIC_RYNTRA_CITY_WORLD=device`
 * switches the city back to this device's world without a code change; in development `?world=device` does the same.
 */
export function world(): WorldClient {
  if (process.env.NEXT_PUBLIC_RYNTRA_CITY_WORLD === 'device') return mockWorld;
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('world') === 'device') return mockWorld;
  return httpWorld;
}
