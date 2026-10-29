import { timingSafeEqual } from 'node:crypto';

/**
 * Who may do what at the desk. Two kinds of caller, two kinds of route:
 *
 *   * `machine` — `POST /events` and `PUT /drafts/:id/clip`: what the engine, a cron or the desk itself sends in. The
 *     desk's secret (`Authorization: Bearer <RYNTRA_MOMENTS_SECRET>`, 16+ characters) opens them, and so does an
 *     operator's admin session from this origin (the desk films in the browser and turns the city's launches into drafts).
 *   * `operator` — reading the queue, a clip, the switch; approving or rejecting one draft; turning the switch off. Only
 *     an operator's admin session, from this origin when it changes things. The secret never opens these: a leaked
 *     engine key cannot approve or post.
 *   * `fresh` — approving all and turning the switch on: an operator whose second factor is fresh (`requireFreshMfa`).
 *
 * The parts are passed in, so the rule is tested without a session store; `server.ts` wires the real ones.
 */

export type DoorKind = 'machine' | 'operator' | 'fresh';

export type Caller =
  | { ok: true; by: string; actor: number | null }
  | { ok: false; status: 401 | 403 | 503; error: 'unauthorized' | 'forbidden' | 'operator_only' | 'reverify' | 'unavailable' };

export type DoorParts = {
  /** The desk's secret; empty when the variable is not set, and then no secret opens anything. */
  secret: () => string;
  /** The request comes from this origin (the cookie path's guard for a change). */
  sameOrigin: (req: Request) => boolean;
  /** The operator signed in to the admin, or null. */
  operator: () => Promise<number | null>;
  /** The operator, only with a second factor verified recently. */
  fresh: () => Promise<{ ok: true; actor: number } | { ok: false; reason: 'unauthorized' | 'reverify' }>;
};

export type Authorize = (req: Request, kind: DoorKind, mutation: boolean) => Promise<Caller>;

export const SECRET_MIN = 16;

function sameSecret(given: string, secret: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createDoor(parts: DoorParts): Authorize {
  return async (req, kind, mutation) => {
    const header = req.headers.get('authorization') ?? '';
    if (header.startsWith('Bearer ')) {
      // The secret is for machines only: never the operator's routes, whatever it says.
      if (kind !== 'machine') return { ok: false, status: 403, error: 'operator_only' };
      const secret = parts.secret();
      return secret.length >= SECRET_MIN && sameSecret(header.slice(7).trim(), secret)
        ? { ok: true, by: 'key', actor: null }
        : { ok: false, status: 401, error: 'unauthorized' };
    }
    if ((mutation || kind === 'fresh') && !parts.sameOrigin(req)) return { ok: false, status: 403, error: 'forbidden' };
    if (kind === 'fresh') {
      const gate = await parts.fresh().catch(() => ({ ok: false as const, reason: 'unauthorized' as const }));
      if (!gate.ok) return gate.reason === 'reverify' ? { ok: false, status: 403, error: 'reverify' } : { ok: false, status: 401, error: 'unauthorized' };
      return { ok: true, by: `operator:${gate.actor}`, actor: gate.actor };
    }
    const operator = await parts.operator().catch(() => null);
    return operator === null ? { ok: false, status: 401, error: 'unauthorized' } : { ok: true, by: `operator:${operator}`, actor: operator };
  };
}
