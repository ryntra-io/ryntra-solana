/* Reading the two documents an MCP client fetches before it authenticates
   (RYN-RH-MCP-001).

   Both are public and unauthenticated by design: RFC 8414 authorization-server
   metadata and RFC 9728 protected-resource metadata. They name grant types, PKCE
   methods, scopes and endpoints, which is the entire OAuth lifecycle a discovery
   packet can honestly establish without an account.

   **An allowlist, never a denylist.** `RYN-BIN-AOS-003` found that a name-based
   blocklist is defeated by any name nobody thought of, and a document served by
   somebody else is precisely where an unthought-of name comes from. So the
   extractor keeps the fields the two standards define and drops everything else,
   including anything shaped like a credential.

   **Bounded, because size is a payload.** Strings are capped, arrays are capped,
   and a non-string array member is dropped rather than stringified — a record
   that turns an object into `[object Object]` has invented a scope name. */

/** The fields RFC 8414 and RFC 9728 define, plus the PKCE and PAR flags MCP cares about. */
export const OAUTH_METADATA_KEYS: readonly string[] = [
  /* RFC 8414 — authorization server metadata. */
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "registration_endpoint",
  "revocation_endpoint",
  "introspection_endpoint",
  "jwks_uri",
  "userinfo_endpoint",
  "pushed_authorization_request_endpoint",
  "require_pushed_authorization_requests",
  "scopes_supported",
  "response_types_supported",
  "response_modes_supported",
  "grant_types_supported",
  "code_challenge_methods_supported",
  "token_endpoint_auth_methods_supported",
  "revocation_endpoint_auth_methods_supported",
  "service_documentation",
  "op_policy_uri",
  "op_tos_uri",
  /* RFC 9728 — protected resource metadata. */
  "resource",
  "authorization_servers",
  "bearer_methods_supported",
  "resource_documentation",
  "resource_name",
  "resource_policy_uri",
  "resource_signing_alg_values_supported",
];

const MAX_STRING = 300;
const MAX_ARRAY = 40;

export type OAuthMetadataFacts = Record<string, string | boolean | string[]>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derived facts only. Anything the standards do not define is dropped, not
 * summarized — a discovery record that carries a field nobody can name is a
 * record nobody can check.
 */
export function extractOAuthMetadata(document: unknown): OAuthMetadataFacts {
  if (!isPlainObject(document)) return {};
  const facts: OAuthMetadataFacts = {};
  for (const key of OAUTH_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(document, key)) continue;
    const value = document[key];
    if (typeof value === "string") {
      facts[key] = value.slice(0, MAX_STRING);
    } else if (typeof value === "boolean") {
      facts[key] = value;
    } else if (Array.isArray(value)) {
      const members = value
        .filter(function (member): member is string { return typeof member === "string"; })
        .slice(0, MAX_ARRAY)
        .map(function (member) { return member.slice(0, MAX_STRING); });
      if (members.length > 0) facts[key] = members;
    }
  }
  return facts;
}
