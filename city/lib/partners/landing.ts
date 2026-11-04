/**
 * The friend's landing (CITY-126): somebody opened a partner's link. The address layer has already turned `?ref=` into
 * the counted `/r/<code>`, which keeps the code in this browser (first touch) — so the city asks the engine what this
 * browser carries (`GET /api/rewards/referral`) and, when it carries an invitation not bound yet, greets the friend
 * with who invited them and the friend's offer. Binding is the engine's: the proven wallet's own read binds it.
 */

export type Invitation = Readonly<{ code: string; inviter: string }>;

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The carried invitation from the engine's answer; null when there is none, it is bound already, or it is unreadable. */
export function invitationOf(body: unknown): Invitation | null {
  const answer = record(body);
  if (answer.ok !== true || answer.confirmed) return null;
  const pending = record(answer.pending);
  if (typeof pending.code !== 'string' || typeof pending.inviterMasked !== 'string') return null;
  if (!/^[0-9A-Z]{6,24}$/.test(pending.code) || !/^[1-9A-HJ-NP-Za-km-z]{2,8}…[1-9A-HJ-NP-Za-km-z]{2,8}$/.test(pending.inviterMasked)) return null;
  return { code: pending.code, inviter: pending.inviterMasked };
}

/** The demo invitation for the eyes in development (`?partners=landing`), always under the «ДЕМО» mark. */
export const DEMO_INVITATION: Invitation = { code: 'K7Q2M9XW4HPT', inviter: '4EeX…KPGW' };

/** What `?partners=` asks of the window in development: a tab, the district, the landing, the demo figures. */
export type DevAsk = Readonly<{ open: 'referrer' | 'creator' | 'guild' | 'district' | 'landing' | null; demo: boolean }>;

export function devAskOf(search: string): DevAsk {
  const raw = new URLSearchParams(search).get('partners');
  if (!raw) return { open: null, demo: false };
  const parts = raw.split(',');
  const open = (['referrer', 'creator', 'guild', 'district', 'landing'] as const).find((p) => parts.includes(p)) ?? null;
  return { open: open ?? (parts.includes('demo') ? 'district' : 'referrer'), demo: parts.includes('demo') || open === 'landing' };
}
