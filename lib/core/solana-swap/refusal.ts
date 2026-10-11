/**
 * What a swap pipeline step stops with.
 *
 * `status`, `code` and `message` are the API contract: the route renders them
 * as `{ error: { code, message, ...extra } }` with that HTTP status, exactly
 * as it did when the steps were written inline. `beforeSubmit` marks a refusal
 * the network never saw (`submitBoundary: "NOT_CROSSED"`), so a browser that
 * wrote its attempt down may let it go.
 */
export type SwapRefusal = Readonly<{
  status: number;
  code: string;
  message: string;
  extra?: object;
  beforeSubmit?: true;
}>;

/**
 * A sentence fit for the log: the venue's own words, never a wallet's or a
 * mint's address and never a sum. An address (base58 of 32–44 characters, a
 * shortened one around «…», or 0x hex) becomes «‹address›», a hash or an id
 * of sixteen hex characters or more «‹id›»; every number but
 * the HTTP status — a fraction, an exponent, digits glued to a word — becomes
 * «‹n›»; at most 300 characters, on one line.
 */
export function sentenceForLog(text: string): string {
  return text
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, "‹address›")
    .replace(/[1-9A-HJ-NP-Za-km-z]{2,}(?:…|\.\.\.)[1-9A-HJ-NP-Za-km-z]{2,}/g, "‹address›")
    .replace(/0x[0-9a-fA-F]{8,}/g, "‹address›")
    .replace(/0x[0-9a-fA-F]+/g, "‹n›")
    .replace(/\b[0-9a-fA-F][0-9a-fA-F-]{15,}\b/g, "‹id›")
    .replace(/(?<!HTTP )(?<!\d)\.?\d+(?:[.,_]\d+)*(?:[eE][+-]?\d+)?/g, "‹n›")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * The log line of a swap order the route refused, or one the venue refused
 * and was asked again: the code, the status, the venue's own error code when
 * it named one, and the sentence — so a refusal can be read without being
 * reproduced, and without the taker or the amount.
 */
export function swapOrderLogLine(
  what: "refused" | "asked again",
  refusal: Readonly<{ code: string; status: number | null; message: string; extra?: object }>,
): string {
  const provider = (refusal.extra as { provider?: { errorCode?: unknown } } | undefined)?.provider;
  const errorCode = typeof provider?.errorCode === "string" && /^[A-Za-z0-9_:-]{1,96}$/.test(provider.errorCode) ? provider.errorCode : null;
  const sentence = sentenceForLog(refusal.message);
  return [
    `swap-order ${what}: ${refusal.code}`,
    refusal.status !== null ? ` (HTTP ${refusal.status})` : "",
    errorCode ? ` [${errorCode}]` : "",
    sentence ? ` — ${sentence}` : "",
  ].join("");
}

/**
 * A settled answer that is not an error envelope: a `202` that names the
 * state and the way to recover, or the final `200`. The route sends the body
 * as it stands.
 */
export type SwapStateAnswer = Readonly<{ status: number; body: Record<string, unknown> }>;

export type SwapSettleStop = Readonly<{ kind: "refusal"; refusal: SwapRefusal }> | Readonly<{ kind: "answer"; answer: SwapStateAnswer }>;
