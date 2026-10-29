/**
 * The core chart's indicators, counted off the page's main thread — a worker from this site's own file, as the spot
 * page gives its chart (`app/solana/workspace/spot/indicator-worker.ts`), so no page policy on blob workers matters.
 */
import { startIndicatorWorker } from '@ryntra/core/chart';

startIndicatorWorker(self as unknown as Parameters<typeof startIndicatorWorker>[0]);
