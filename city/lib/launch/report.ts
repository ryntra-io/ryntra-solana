/**
 * «Report» on a launch's tower: into the inbox the team already reads first, as it reads security (`/api/feedback`,
 * topic `report`, MC-1), in the same words the token's own page sends, so the takedown procedure
 * (`docs/security/LAUNCH-TAKEDOWN.md`) reads both alike. What Ryntra does with a report is that procedure; a report
 * hides nothing by itself.
 */

export const REPORT_REASONS = ['scam', 'pretends', 'picture', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportAnswer = Readonly<{ ok: true; ref: string }> | Readonly<{ ok: false; reason: 'rate' | 'failed' }>;

type Fetch = (input: string, init: RequestInit) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

/** The report's body, line for line as the token's page writes it. */
export function reportBody(symbol: string, token: string, reason: ReportReason): string {
  return [`Report: $${symbol} · ${token}`, `Reason: ${reason}`, 'From: Ryntra City'].join('\n');
}

export async function sendReport(
  input: Readonly<{ token: string; symbol: string; reason: ReportReason; route: string }>,
  fetcher: Fetch = (url, init) => fetch(url, init),
): Promise<ReportAnswer> {
  try {
    const response = await fetcher('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'site', topic: 'report', body: reportBody(input.symbol, input.token, input.reason), route: input.route, locale: 'en' }),
    });
    if (response.status === 429) return { ok: false, reason: 'rate' };
    if (!response.ok) return { ok: false, reason: 'failed' };
    const json = (await response.json().catch(() => ({}))) as { ref?: unknown };
    return { ok: true, ref: typeof json.ref === 'string' ? json.ref : '' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
