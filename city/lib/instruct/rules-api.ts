import type { Schedule } from './plan.ts';

/**
 * The city's line to the engine's regular purchases (CITY-176): the same `/api/v1/rules` routes every Ryntra client
 * calls, on the same origin, under the wallet's proof. A rule only schedules a reminder; every purchase under it is the
 * wallet's own signature on a fresh order. Writing or removing a rule takes the wallet's proof (one signed message, no
 * money) — the card asks for it first (`../trade/proof.ts`). Nothing here signs a transaction.
 */

export type RuleView = Readonly<{
  id: string;
  status: 'active' | 'paused';
  amountUsd: number;
  asset: Readonly<{ mint: string; symbol?: string }>;
  schedule: Schedule | null;
  nextDueAt: string | null;
  /** Newest first: an open reminder is `due`. */
  occurrences: readonly Readonly<{ dueAt: string; openUntil: string; state: string }>[];
}>;

export type RulesFailure = Readonly<{ code: string; status: number }>;
export type RulesResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: RulesFailure }>;

export type RuleCreateBody = Readonly<{ asset: Readonly<{ mint: string }>; amountUsd: number; kind: 'schedule'; schedule: Schedule; locale: 'en' | 'uk' }>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type RulesFetch = (url: string, init: Readonly<{ method: string; headers: Record<string, string>; body?: string; credentials: 'include'; cache: 'no-store' }>) => Promise<Answer>;

export type RulesApi = Readonly<{
  list: () => Promise<RulesResult<readonly RuleView[]>>;
  create: (body: RuleCreateBody) => Promise<RulesResult<RuleView>>;
  remove: (id: string) => Promise<RulesResult<true>>;
}>;

const HEADERS = { 'X-Ryntra-API': '1', accept: 'application/json' } as const;

async function call<T>(fetchImpl: RulesFetch, url: string, method: string, body: unknown, pick: (json: Record<string, unknown>) => T | null): Promise<RulesResult<T>> {
  let answer: Answer;
  try {
    answer = await fetchImpl(url, {
      method,
      headers: body === undefined ? { ...HEADERS } : { ...HEADERS, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, failure: { code: 'NETWORK', status: 0 } };
  }
  const json = (await answer.json().catch(() => null)) as Record<string, unknown> | null;
  if (!answer.ok) {
    const error = json && typeof json.error === 'object' && json.error ? (json.error as { code?: unknown }) : null;
    return { ok: false, failure: { code: typeof error?.code === 'string' ? error.code : 'FAILED', status: answer.status } };
  }
  const value = pick(json ?? {});
  return value === null ? { ok: false, failure: { code: 'UNREADABLE', status: answer.status } } : { ok: true, value };
}

export const isRuleView = (value: unknown): value is RuleView => {
  const v = value as Record<string, unknown> | null;
  return !!v && typeof v === 'object' && typeof v.id === 'string' && (v.status === 'active' || v.status === 'paused') && typeof v.amountUsd === 'number' && Array.isArray(v.occurrences) && !!v.asset;
};

export function createRulesApi(fetchImpl: RulesFetch = (url, init) => fetch(url, init)): RulesApi {
  return {
    list: () => call(fetchImpl, '/api/v1/rules', 'GET', undefined, (json) => (Array.isArray(json.rules) ? json.rules.filter(isRuleView) : null)),
    create: (body) => call(fetchImpl, '/api/v1/rules', 'POST', body, (json) => (isRuleView(json.rule) ? json.rule : null)),
    remove: (id) => call(fetchImpl, `/api/v1/rules/${encodeURIComponent(id)}`, 'DELETE', undefined, () => true as const),
  };
}
