/**
 * Deterministic fixtures, recorded from the live networks on 2026-08-13.
 *
 * Two reasons they exist rather than tests hitting the network. The obvious
 * one: a test suite that fails when an endpoint is slow is not testing our
 * code. The Stellar-specific one: **testnet is reset periodically**, so any
 * test anchored to a live testnet account is guaranteed to break on a schedule
 * nobody controls, and it will break long after the person who wrote it has
 * stopped expecting it.
 *
 * The payloads below are trimmed to the fields the adapter reads, and they are
 * shapes that actually came back — not shapes copied from documentation. Where
 * documentation and the wire disagreed, the wire won.
 */

/** Circle's USDC issuer on mainnet. Read 2026-08-13. */
export const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
export const USDC_CONTRACT = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

export const FIXTURE_RPC_GET_NETWORK = {
  passphrase: "Public Global Stellar Network ; September 2015",
  protocolVersion: 27,
} as const;

/**
 * `getHealth`, the whole 207 bytes of it.
 *
 * Recorded rather than `getLatestLedger`, whose mainnet response measured
 * 3.18 MB in the same probe — see the allowlist note in `client.ts`. The close
 * time is a string of unix seconds, which is why the parser accepts both forms.
 */
export const FIXTURE_RPC_HEALTH = {
  status: "healthy",
  latestLedger: 63925100,
  latestLedgerCloseTime: "1786936252",
  oldestLedger: 63804196,
  oldestLedgerCloseTime: "1785897403",
  ledgerRetentionWindow: 120960,
} as const;

export const FIXTURE_HORIZON_LEDGERS = {
  _embedded: {
    records: [
      {
        sequence: 63925100,
        closed_at: "2026-08-12T23:10:52Z",
        base_fee_in_stroops: 100,
        base_reserve_in_stroops: 5000000,
        protocol_version: 27,
      },
    ],
  },
} as const;

/**
 * The issuer account.
 *
 * Note `auth_revocable: true` with `auth_clawback_enabled: false` — a real
 * asset where the issuer can freeze a holding but not take it back. That
 * combination is exactly why the two flags are reported separately instead of
 * collapsed into one "issuer controls" verdict.
 */
export const FIXTURE_HORIZON_ISSUER_ACCOUNT = {
  id: USDC_ISSUER,
  account_id: USDC_ISSUER,
  home_domain: "circle.com",
  last_modified_ledger: 63923133,
  subentry_count: 3,
  flags: {
    auth_required: false,
    auth_revocable: true,
    auth_immutable: false,
    auth_clawback_enabled: false,
  },
  balances: [{ balance: "0.0000000", asset_type: "native" }],
} as const;

/** A holder account carrying a USDC trustline plus its native balance. */
export const FIXTURE_HORIZON_HOLDER_ACCOUNT = {
  id: "GBTCBCWLE6YVTR5Y5RRZC36Z37OH22G773HECWEIZTZJSN4WTG3CSOES",
  account_id: "GBTCBCWLE6YVTR5Y5RRZC36Z37OH22G773HECWEIZTZJSN4WTG3CSOES",
  subentry_count: 1,
  last_modified_ledger: 63925000,
  flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
  balances: [
    {
      balance: "1250.0000000",
      limit: "922337203685.4775807",
      is_authorized: true,
      is_authorized_to_maintain_liabilities: true,
      last_modified_ledger: 63925000,
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: USDC_ISSUER,
    },
    { balance: "63011.3462196", asset_type: "native" },
  ],
} as const;

/** An account with no USDC trustline at all. */
export const FIXTURE_HORIZON_BARE_ACCOUNT = {
  id: "GDIEKKIQWMIZ4LD3RP3ABPN7X5KEAEWYMR634BRHB7EULIMEVREWLF3G",
  account_id: "GDIEKKIQWMIZ4LD3RP3ABPN7X5KEAEWYMR634BRHB7EULIMEVREWLF3G",
  subentry_count: 0,
  flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
  balances: [{ balance: "10.0000000", asset_type: "native" }],
} as const;

export const FIXTURE_HORIZON_ASSET = {
  _embedded: {
    records: [
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        contract_id: USDC_CONTRACT,
        num_claimable_balances: 942,
        num_liquidity_pools: 883,
        num_contracts: 50049,
        accounts: { authorized: 2327568, authorized_to_maintain_liabilities: 0, unauthorized: 0 },
        claimable_balances_amount: "22150.2606838",
        liquidity_pools_amount: "2380045.8183871",
        contracts_amount: "43149589.2484762",
        balances: { authorized: "372733860.6374758", authorized_to_maintain_liabilities: "0.0000000", unauthorized: "0.0000000" },
        flags: { auth_required: false, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: false },
      },
    ],
  },
} as const;

/** The moment the fixtures describe, so freshness in tests is deterministic. */
export const FIXTURE_NOW = new Date("2026-08-12T23:11:00Z");

export type StubRoute = Readonly<{
  /** Substring match against the request URL, or an RPC method name. */
  match: string;
  status?: number;
  body?: unknown;
  /** Return a non-JSON body, to exercise the malformed-response path. */
  rawBody?: string;
  /** Never settle, to exercise the timeout path. */
  hang?: boolean;
  headers?: Record<string, string>;
}>;

/**
 * A `fetch` stand-in built from routes.
 *
 * It honours `AbortSignal`, because the timeout path is one of the behaviours
 * under test and a stub that ignores the signal would let a broken timeout pass.
 */
export function stubFetch(routes: readonly StubRoute[]): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const rpcMethod =
      typeof init?.body === "string" ? ((JSON.parse(init.body) as { method?: string }).method ?? "") : "";
    const route = routes.find((candidate) => url.includes(candidate.match) || (rpcMethod && rpcMethod === candidate.match));

    if (!route) return new Response("not stubbed", { status: 404 });

    if (route.hang) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        }
      });
    }

    const payload = route.rawBody ?? JSON.stringify(rpcMethod ? { jsonrpc: "2.0", id: 1, result: route.body } : route.body);
    return new Response(payload, {
      status: route.status ?? 200,
      headers: { "content-type": "application/json", ...(route.headers ?? {}) },
    });
  }) as typeof globalThis.fetch;
}
