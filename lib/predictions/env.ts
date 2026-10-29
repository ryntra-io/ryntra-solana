/**
 * What the prediction provider needs from the server environment, read once
 * and never printed.
 *
 * - `AGG_APP_ID` — the aggregator app's public id; sent as `x-app-id` on
 *   every call. There is no fallback: a deployment without one says the
 *   product is not configured, so no deployment ever trades under an app it
 *   was not given.
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
/** The socket answers on `/ws` only: the bare host closes the connection (1006) and the page falls back to polling. */
export const AGG_WS_URL = "wss://ws.agg.market/ws";

/**
 * The socket's address as the provider serves it: a value given without a path (the bare host, as an older
 * deployment may still set `AGG_WS_URL`) gets `/ws`; a value with its own path is kept as it is. Null for a value
 * that is no WebSocket address at all — the default stands then.
 */
export function aggSocketUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/ws";
  return url.toString();
}
export type PredictionsEnv = Readonly<{
  /** Null when the deployment was given no app: every provider call then answers *not configured*. */
  appId: string | null;
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
    appId: clean(env.AGG_APP_ID),
    apiKey: clean(env.AGG_API_KEY),
    appSecret: clean(env.AGG_APP_SECRET),
    baseUrl: clean(env.AGG_API_BASE_URL) ?? AGG_API_BASE_URL,
    wsUrl: aggSocketUrl(clean(env.AGG_WS_URL) ?? AGG_WS_URL) ?? AGG_WS_URL,
  };
}

/** The external id Ryntra binds an aggregator user to: the proven wallet, stable and per network. */
export function ryntraExternalId(wallet: string): string {
  return `ryntra:${walletChain(wallet)}:${wallet}`;
}

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

/**
 * The network of a proven wallet, read from the address itself: an EVM
 * address is `0x` and forty hex digits, kept in lower case by the proof; any
 * other address here is a Solana one. The two spellings cannot collide.
 */
export function walletChain(wallet: string): "solana" | "evm" {
  return EVM_ADDRESS.test(wallet) ? "evm" : "solana";
}
