import { requireFreshMfa } from '@/lib/admin/auth';
import { appendAdminAudit } from '@/lib/admin/store';
import { mutationOriginAllowed } from '@/lib/security';
import { getAdminSession } from '@/lib/session';
import { rpcResult } from '@/lib/supabase-rpc';
import { createMomentsApi, type MomentsApi, type MomentsAudit } from './api';
import { createDoor } from './door';
import { xSender } from '@/city/lib/x/connect';
import { MemoryDraftStore, type DraftStore } from './store';
import { SupabaseDraftStore } from './supabase-store';

/**
 * The queue as the deployed server runs it: the database through its secret-gated `moments_*` functions, the desk's
 * door (`door.ts`: the desk's secret for the machine routes alone, an operator's admin session for everything a person
 * decides, a fresh second factor to approve all or turn the switch on), the admin's audit trail, and `x-sender`
 * (`city/lib/x`), not connected until the owner sets its switch and keys. Server only: nothing in the browser imports
 * this file.
 */

let store: DraftStore | null = null;
let api: MomentsApi | null = null;

/**
 * A development server can keep the queue in memory (`RYNTRA_MOMENTS_STORE=memory`); production never does. Each route
 * is its own bundle there, so the one queue hangs on the process.
 */
export function draftStore(): DraftStore {
  if (process.env.NODE_ENV !== 'production' && process.env.RYNTRA_MOMENTS_STORE === 'memory') {
    const shared = globalThis as typeof globalThis & { __ryntraMomentsDrafts?: DraftStore };
    shared.__ryntraMomentsDrafts ??= new MemoryDraftStore();
    return shared.__ryntraMomentsDrafts;
  }
  store ??= new SupabaseDraftStore((fn, args) => rpcResult('moments', fn, args));
  return store;
}

/** `Authorization: Bearer <RYNTRA_MOMENTS_SECRET>` opens only `POST /events` and `PUT /drafts/:id/clip`. */
export const authorize = createDoor({
  secret: () => process.env.RYNTRA_MOMENTS_SECRET ?? '',
  sameOrigin: (req) => mutationOriginAllowed(req.url, req.headers.get('origin'), req.headers.get('sec-fetch-site')),
  operator: () => getAdminSession(),
  fresh: async () => {
    const gate = await requireFreshMfa();
    return gate.ok ? { ok: true, actor: gate.admin.telegramId } : { ok: false, reason: gate.reason };
  },
});

/**
 * Each decision goes on the admin's durable trail. The three `moments_*` actions are not yet in the trail's TypeScript
 * list (`DurableAuditAction`, `lib/admin/store.ts`, outside this line's paths); the database takes any action name.
 */
async function audit(entry: MomentsAudit): Promise<unknown> {
  if (entry.actor === null) return false;
  return appendAdminAudit({
    actorTelegramId: entry.actor,
    action: entry.action,
    outcome: entry.outcome,
    reason: typeof entry.payload.reason === 'string' ? entry.payload.reason : null,
    payload: entry.payload,
  });
}

export function momentsApi(): MomentsApi {
  api ??= createMomentsApi({ store: draftStore(), authorize, audit, sender: xSender() });
  return api;
}
