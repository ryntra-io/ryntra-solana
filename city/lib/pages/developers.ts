/**
 * «Developers» behind «Technical details» (CITY-157): where an agent connects to Ryntra's engine, as the engine serves
 * it today — the versioned API (`lib/api/v1/contract.ts`, `openapi/ryntra-api-v1.yaml`), Sign In With Solana into a
 * bearer session, the public reads. Addresses and headers are code, the same in every language; what each row is comes
 * from the window's words (`DEVS.row…`). Not served yet, so not listed: project keys (the DEV-2 console waits for its
 * migration and `RYNTRA_DEV_CONSOLE=open`) and pay-per-call (x402) — the window says «soon». The AI-chat connector (MCP,
 * CITY-154) is live and has its own page, «AI chats» (`connector.ts`, CITY-170).
 *
 * No React here: the tests check every address against the routes that answer it.
 */

export const API_BASE = 'https://ryntra.io/api/v1';

export type DevRowKey = 'rowBase' | 'rowVersion' | 'rowCapabilities' | 'rowSignIn' | 'rowModels' | 'rowSecurity';

/** One row: what it is (a key of the window's words) and its value, as code. */
export type DevRow = Readonly<{ what: DevRowKey; value: string }>;

export const DEV_ROWS: readonly DevRow[] = [
  { what: 'rowBase', value: API_BASE },
  { what: 'rowVersion', value: 'X-Ryntra-API: 1' },
  { what: 'rowCapabilities', value: 'GET /api/v1/capabilities' },
  { what: 'rowSignIn', value: 'POST /api/v1/auth/challenge → POST /api/v1/auth/verify' },
  { what: 'rowModels', value: '/llms.txt' },
  { what: 'rowSecurity', value: '/.well-known/security.txt' },
];
