import "server-only";

/**
 * The server entry point for public site truth.
 *
 * The resolution logic lives in `truth-core.ts` so it can be exercised directly
 * by `node --test`; this file adds the guard that keeps it — and the 36 kB
 * capability registry behind it — out of any browser bundle. A client component
 * that needs a state receives the resolved shape as a prop.
 */
export { getSiteTruth } from "./truth-core";
