/**
 * The core chart's indicators, counted off the page's main thread. The page's policy lets a worker come from this
 * site's own files (`script-src 'self'`), not from a blob, so the chart is given this file (`indicatorWorker`) in place
 * of the one it makes itself.
 */
import { startIndicatorWorker } from "@ryntra/core/chart";

startIndicatorWorker(self as unknown as Parameters<typeof startIndicatorWorker>[0]);
