import { CONNECTOR_CATALOG_MCP_PATH, CONNECTOR_MCP_PATH } from '../../../lib/connector/metadata.ts';

/**
 * «AI chats» behind «Technical details» (CITY-170): where a chat connects to Ryntra, as the connector serves it today
 * (`lib/connector/**`, CITY-154). Addresses and commands are code, the same in every language; what each row is comes
 * from the window's words (`CONNECTOR.row…`). The page names no chat's own site: a person adds Ryntra from inside
 * their chat, and nothing here links out to one.
 *
 * No React here: the tests check every address against the connector's own paths.
 */

export const SITE = 'https://ryntra.io';

/** The address a person adds by hand: the full connector. */
export const CONNECTOR_URL = `${SITE}${CONNECTOR_MCP_PATH}`;
/** The read-only address a connector directory lists. */
export const CATALOG_URL = `${SITE}${CONNECTOR_CATALOG_MCP_PATH}`;

export type ConnectorRowKey = 'rowAddress' | 'rowDirectory' | 'rowClaude' | 'rowClaudeCode' | 'rowChatGpt' | 'rowAny';

/** One row: what it is (a key of the window's words) and its value, as code or as a short path through a chat's menus. */
export type ConnectorRow = Readonly<{ what: ConnectorRowKey; value: string }>;

export const CONNECTOR_ROWS: readonly ConnectorRow[] = [
  { what: 'rowAddress', value: CONNECTOR_URL },
  { what: 'rowDirectory', value: CATALOG_URL },
  { what: 'rowClaude', value: 'Settings → Connectors → Add custom connector' },
  { what: 'rowClaudeCode', value: `claude mcp add --transport http ryntra ${CONNECTOR_URL}` },
  { what: 'rowChatGpt', value: 'Developer mode → New connector → OAuth' },
  { what: 'rowAny', value: 'MCP · Streamable HTTP · OAuth 2.1 + PKCE' },
];

/** The wallet's tool calls a minute (`lib/connector/ledger.ts`), as the limits line says it. */
export const CALLS_A_MINUTE = 60;
