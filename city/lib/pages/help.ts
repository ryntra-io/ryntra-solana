/**
 * Help's one form (CITY-157): Support and Feedback were two old pages; in the city they are one form on the engine's
 * own inbox, `POST /api/feedback` (`app/api/feedback/route.ts`, unchanged). A question, a problem, an idea or a
 * security report — the inbox reads security first. The engine answers with a public reference (`RYN-FB-…`), which
 * the window shows so the person can name it in a letter.
 *
 * No React here: the tests run the rules and the send in Node with a fake fetch.
 */

/** The topics the engine knows (`lib/admin/feedback-context.ts`), in the form's order. */
export const HELP_TOPICS = ['question', 'bug', 'idea', 'security'] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

/** The engine's bounds on a message (`sanitizeFeedbackBody`) and on a contact (`sanitizeFeedbackContact`). */
export const HELP_MIN = 10;
export const HELP_MAX = 4000;
export const CONTACT_MAX = 120;

export type HelpDraft = Readonly<{ topic: HelpTopic; body: string; contact: string }>;

/** True when the engine will take the message as it stands. */
export function helpReady(draft: HelpDraft): boolean {
  const body = draft.body.trim();
  return body.length >= HELP_MIN && body.length <= HELP_MAX && draft.contact.trim().length <= CONTACT_MAX;
}

/** What the form sends: the topic, the words, a contact only when typed, where it was written and in which language. */
export function helpPayload(draft: HelpDraft, where: Readonly<{ source: 'site' | 'app'; route: string; locale: string }>): Record<string, string> {
  const contact = draft.contact.replace(/\s+/g, ' ').trim();
  return {
    source: where.source,
    topic: draft.topic,
    body: draft.body.trim(),
    route: where.route,
    locale: where.locale.slice(0, 8),
    ...(contact.length >= 2 ? { contact } : {}),
  };
}

export type HelpOutcome =
  | Readonly<{ kind: 'sent'; ref: string }>
  /** Too many messages from this address in ten minutes. */
  | Readonly<{ kind: 'busy' }>
  /** The inbox is not reachable: the letter is the way. */
  | Readonly<{ kind: 'offline' }>
  | Readonly<{ kind: 'failed' }>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type HelpFetch = (url: string, init: Readonly<{ method: 'POST'; headers: Record<string, string>; body: string }>) => Promise<Answer>;

const REF = /^RYN-FB-[0-9A-F]{8}$/;

/** Sends the form once and says how it went; never throws. */
export async function sendHelp(payload: Record<string, string>, fetcher: HelpFetch): Promise<HelpOutcome> {
  try {
    const answer = await fetcher('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (answer.status === 429) return { kind: 'busy' };
    if (answer.status === 503) return { kind: 'offline' };
    if (!answer.ok) return { kind: 'failed' };
    const json = (await answer.json()) as { ref?: unknown };
    return typeof json?.ref === 'string' && REF.test(json.ref) ? { kind: 'sent', ref: json.ref } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
