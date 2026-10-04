/**
 * Hard boundary for Admin analytics and default tables.
 *
 * Demand is measured through useful behaviour, not financial surveillance.
 * A generic analytics payload never carries a wallet address, a balance, an
 * amount, a hash or signature, a prompt, a secret, a Telegram identifier or a
 * device fingerprint. The strip walks nested objects *and* arrays, because a
 * forbidden key inside a list is the same leak one level down.
 */

export const FORBIDDEN_ADMIN_PROPERTIES = [
  "wallet_address",
  "walletAddress",
  "email",
  "tx_hash",
  "transactionHash",
  "token_amount",
  "tokenAmount",
  "portfolio_value",
  "portfolioValue",
  "position_size",
  "positionSize",
  "pnl",
  "p_and_l",
  "signed_payload",
  "signedPayload",
  "strategy_spec",
  "private_prompt",
  "privatePrompt",
  "feedback_body",
  "feedbackBody",
  "api_secret",
  "raw_query",
  "ip",
  // Identifiers, secrets, amounts and fingerprints.
  "telegram_id",
  "telegramId",
  "telegram_username",
  "username",
  "first_name",
  "firstName",
  "signature",
  "tx_signature",
  "txSignature",
  "transaction_signature",
  "seed",
  "seed_phrase",
  "mnemonic",
  "private_key",
  "privateKey",
  "secret",
  "access_token",
  "bearer",
  "prompt",
  "raw_prompt",
  "query_string",
  "queryString",
  "balance",
  "amount",
  "user_agent",
  "userAgent",
  "ip_address",
] as const;

const FORBIDDEN = new Set<string>(FORBIDDEN_ADMIN_PROPERTIES);
const MAX_DEPTH = 8;

export function isForbiddenAdminProperty(key: string): boolean {
  /* camelCase and kebab-case collapse onto snake_case so `txHash`, `tx-hash`
     and `tx_hash` are the same key to this check. */
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  if (FORBIDDEN.has(key) || FORBIDDEN.has(normalized)) return true;
  if (normalized.includes("wallet_address")) return true;
  if (normalized === "pnl" || normalized.endsWith("_pnl") || normalized.includes("p_and_l")) return true;
  if (normalized.includes("portfolio_value") || normalized.includes("position_size")) return true;
  if (normalized.includes("token_amount") || normalized.includes("trade_size")) return true;
  if (normalized.includes("tx_hash") || normalized.includes("transaction_hash") || normalized === "hash" || normalized.endsWith("_hash")) return true;
  if (normalized.includes("signature")) return true;
  if (normalized.includes("mnemonic") || normalized.includes("seed_phrase") || normalized.includes("private_key")) return true;
  if (normalized.includes("secret") || normalized.includes("access_token") || normalized === "bearer") return true;
  if (normalized.includes("prompt")) return true;
  if (normalized.includes("balance")) return true;
  if (normalized === "amount" || normalized.endsWith("_amount") || normalized.startsWith("amount_")) return true;
  if (normalized.includes("query_string") || normalized.includes("user_agent") || normalized.includes("ip_address")) return true;
  if (normalized.includes("telegram_id") || normalized.includes("telegram_username")) return true;
  return false;
}

function stripValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => stripValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenAdminProperty(key)) continue;
      const cleaned = stripValue(inner, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

export function stripForbiddenAdminProperties<T extends Record<string, unknown>>(
  payload: T,
): Record<string, unknown> {
  return stripValue(payload, 0) as Record<string, unknown>;
}

/**
 * True when a payload, at any depth, still carries a forbidden key. Used by
 * tests and by the event writer as a last check before a row is sent.
 */
export function carriesForbiddenAdminProperty(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.some((item) => carriesForbiddenAdminProperty(item, depth + 1));
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenAdminProperty(key)) return true;
      if (carriesForbiddenAdminProperty(inner, depth + 1)) return true;
    }
  }
  return false;
}
