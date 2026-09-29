export const AGENT_CONTROL_REDACTION_MARKER = "[REDACTED]" as const;

const SENSITIVE_FIELD_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "apikey",
  "xapikey",
  "clientsecret",
  "entitysecret",
  "privatekey",
  "seedphrase",
  "mnemonic",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "csrftoken",
  "xauthtoken",
  "xagenttoken",
  "cookie",
  "setcookie",
]);

const SENSITIVE_QUERY_NAMES = new Set([
  ...SENSITIVE_FIELD_NAMES,
  "auth",
  "bearer",
  "key",
  "sig",
  "signature",
]);

const SENSITIVE_HEADER_NAMES = new Set([
  ...SENSITIVE_FIELD_NAMES,
  "xsignature",
]);

function normalizedName(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    // An invalid escape is still compared in its original form and never
    // causes the logging/redaction path itself to throw.
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveField(name: string): boolean {
  const normalized = normalizedName(name);
  return SENSITIVE_FIELD_NAMES.has(normalized) || normalized.endsWith("signature");
}

function redactQueryValues(value: string): string {
  return value.replace(
    /(^|[?&])([^=?&#\s]+)=([^&#\s]*)/g,
    (match, prefix: string, rawName: string) =>
      SENSITIVE_QUERY_NAMES.has(normalizedName(rawName))
        ? `${prefix}${rawName}=${AGENT_CONTROL_REDACTION_MARKER}`
        : match,
  );
}

function redactHeaderLines(value: string): string {
  return value.replace(
    /(^|\r?\n)([A-Za-z0-9_-]+)(\s*:\s*)[^\r\n]*/g,
    (match, prefix: string, rawName: string, separator: string) =>
      SENSITIVE_HEADER_NAMES.has(normalizedName(rawName))
        ? `${prefix}${rawName}${separator}${AGENT_CONTROL_REDACTION_MARKER}`
        : match,
  );
}

/**
 * Produce a non-mutating, JSON-shaped value safe for Agent Control logs.
 *
 * The pass redacts secret-bearing fields at any depth, sensitive values in
 * header maps or raw header blocks, and credential-like URL/query parameters.
 * Business identifiers and hash references remain inspectable; raw signatures,
 * bearer material, cookies and tokens do not.
 */
export function redactAgentControlLog(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactAgentControlLog(entry, parentKey));
  }
  if (typeof value === "string") {
    const querySafe = redactQueryValues(value);
    return normalizedName(parentKey).endsWith("headers")
      ? redactHeaderLines(querySafe)
      : querySafe;
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSensitiveField(key)
        ? AGENT_CONTROL_REDACTION_MARKER
        : redactAgentControlLog(entry, key),
    ]),
  );
}
