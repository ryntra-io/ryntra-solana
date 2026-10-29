/**
 * How long a cabinet page's metadata may wait for a read (B15). Metadata is sent in the `<head>` for everyone
 * (`htmlLimitedBots` in `next.config.ts`), so `generateMetadata` holds the first byte — and with it the page's own
 * skeleton: a pool's title read from Meteora (up to 6 s) or a launch's from the chain left the screen blank. A read
 * that answers within the budget names the page; one that does not leaves the section's own title, and the page,
 * which reads the same thing in its own time, still says everything.
 */
export const METADATA_BUDGET_MS = 400;

export function withinMetadataBudget<T>(read: Promise<T>, fallback: T, ms: number = METADATA_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([read.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}
