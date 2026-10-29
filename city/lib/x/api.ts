import type { Authorize } from '../moments/drafts/door.ts';
import { DraftStoreUnavailable, type DraftStore } from '../moments/drafts/store.ts';
import type { XConfig } from './config.ts';
import { XLedgerUnavailable, type XLedger } from './ledger.ts';
import { DAY, dayReport } from './report.ts';
import { runSlot } from './run.ts';
import type { XPublisher } from './sender.ts';

/**
 * `/api/x`: the publisher's two routes.
 *
 *     GET /cron            Vercel's cron, `Authorization: Bearer $CRON_SECRET`   one pass (`run.ts`), then the day's report
 *     GET /report?day=     an operator signed in to the admin                    the day's report (`report.ts`)
 *
 * Without the sender connected the cron answers `not_connected` and touches neither the queue's drafts nor X.
 */

export type XApiDeps = {
  store: DraftStore;
  ledger: XLedger;
  sender: XPublisher;
  config: Pick<XConfig, 'slots' | 'dailyUsd'>;
  /** The cron's bearer, checked the way every cron of the repo is (`decideBearerAuth` with `CRON_SECRET`). */
  cronAuthorized: (req: Request) => boolean;
  /** The moments desk's door: the report is the operator's. */
  authorize: Authorize;
  now?: () => Date;
};

export type XApi = { cron(req: Request): Promise<Response>; report(req: Request): Promise<Response> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export function createXApi(deps: XApiDeps): XApi {
  const unavailable = (e: unknown) => {
    if (e instanceof DraftStoreUnavailable || e instanceof XLedgerUnavailable) return json({ ok: false, error: 'unavailable' }, 503);
    throw e;
  };

  return {
    async cron(req) {
      if (!deps.cronAuthorized(req)) return json({ ok: false }, 401);
      try {
        const outcome = await runSlot(deps);
        if (outcome.state === 'not_connected') return json({ ok: true, outcome });
        return json({ ok: true, outcome, report: await dayReport(deps) });
      } catch (e) {
        return unavailable(e);
      }
    },

    async report(req) {
      const caller = await deps.authorize(req, 'operator', false);
      if (!caller.ok) return json({ error: caller.error }, caller.status);
      const day = new URL(req.url).searchParams.get('day');
      if (day !== null && !DAY.test(day)) return json({ error: 'bad_day' }, 400);
      try {
        return json({ report: await dayReport({ ...deps, day: day ?? undefined }) });
      } catch (e) {
        return unavailable(e);
      }
    },
  };
}
