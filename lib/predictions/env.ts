/**
 * What the prediction provider needs from the server environment, read once
 * and never printed.
 *
 * - `AGG_APP_ID` — the aggregator app's public id; sent as `x-app-id` on
 *   every call. Public by nature (the browser lab sends it too), so a local
 *   stand without one falls back to the Ryntra app.
 * - `AGG_API_KEY` — the server key (`x-app-api-key`), optional: the market
 *   surfaces and the user-scoped calls answer without it, a key moves the
 *   server into its own rate-limit budget and opens the partner reads.
 * - `AGG_APP_SECRET` — the app signing secret for the Partner External ID
 *   assertion (`signExternalId`); server only. Without it the identity link
 *   stops honestly at *signing key missing* and everything else works.
 *
 * The values are set by the operator of the deployment. Nothing here logs
 * one.
 */

export const AGG_API_BASE_URL = "https://api.agg.market";
export const AGG_WS_URL = "wss://ws.agg.market";
/** The AGG app *Ryntra* (testing mode, paper) — the lab's fallback too. */
const DEFAULT_APP_ID = "cmu33lsiu01v809l9kh7ifw4p";

export type PredictionsEnv = Readonly<{
  appId: string;
  apiKey: string | null;
  appSecret: string | null;
  baseUrl: string;
  wsUrl: string;
}>;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function readPredictionsEnv(env: NodeJS.ProcessEnv = process.env): PredictionsEnv {
  return {
    appId: clean(env.AGG_APP_ID) ?? DEFAULT_APP_ID,
    apiKey: clean(env.AGG_API_KEY),
    appSecret: clean(env.AGG_APP_SECRET),
    baseUrl: clean(env.AGG_API_BASE_URL) ?? AGG_API_BASE_URL,
    wsUrl: clean(env.AGG_WS_URL) ?? AGG_WS_URL,
  };
}

/** The external id Ryntra binds an aggregator user to: the proven wallet, stable and per network. */
export function ryntraExternalId(wallet: string): string {
  return `ryntra:solana:${wallet}`;
}
