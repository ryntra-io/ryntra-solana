/**
 * The companies the engine lists (`GET /api/v1/stocks/popular`, read-only): their mints join «Stocks» beside the towers
 * of Stock Avenue. The list carries no market cap and no liquidity, the two figures a tower's height and width stand on,
 * so a listed company that has no tower in the city gets none here: the Lens never draws a tower it cannot measure.
 */

export const STOCKS_URL = '/api/v1/stocks/popular?limit=24';

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The mints of the listed companies in an answer of the engine; anything out of shape is left out. */
export function stockMints(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data ?? body;
  const companies = (data as { companies?: unknown } | null)?.companies;
  if (!Array.isArray(companies)) return [];
  const mints = new Set<string>();
  for (const company of companies) {
    const mint = (company as { mint?: unknown } | null)?.mint;
    if (typeof mint === 'string' && MINT.test(mint)) mints.add(mint);
  }
  return [...mints];
}

type Answer = Readonly<{ ok: boolean; json: () => Promise<unknown> }>;

/** One read of the list; a refusal or a broken answer is an empty list, and «Stocks» keeps to the avenue. */
export async function readStockMints(fetcher: (url: string) => Promise<Answer>): Promise<string[]> {
  try {
    const answer = await fetcher(STOCKS_URL);
    return answer.ok ? stockMints(await answer.json()) : [];
  } catch {
    return [];
  }
}
