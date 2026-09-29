import { clientIp, FixedWindowLimiter } from "../http-control.ts";

export const STRATEGY_FORMALIZE_MAX_BODY_BYTES = 16_384;
export const STRATEGY_REVIEW_MAX_BODY_BYTES = 49_152;
export const STRATEGY_COMPILE_MAX_BODY_BYTES = 65_536;
export const STRATEGY_IMPORT_MAX_BODY_BYTES = 2_500_000;

const preSessionLimiter = new FixedWindowLimiter({
  limit: 60,
  windowMs: 10 * 60_000,
  maxKeys: 5_000,
});

export function consumeStrategyLabPreSession(headers: Headers) {
  return preSessionLimiter.consume(clientIp(headers));
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 }> {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, status: 415 };

  const declaredLengthHeader = request.headers.get("content-length");
  if (declaredLengthHeader !== null) {
    const declaredLength = Number(declaredLengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) return { ok: false, status: 400 };
    if (declaredLength > maxBytes) return { ok: false, status: 413 };
  }

  const body = request.body;
  if (!body) return { ok: false, status: 400 };

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        try {
          await reader.cancel("request too large");
        } catch {
          // Returning 413 is still the fail-closed outcome if cancellation races.
        }
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel("invalid request body");
    } catch {
      // The original stream failure is mapped to a private 400 response.
    }
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 400 };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
