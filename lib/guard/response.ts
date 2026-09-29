import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server.js";

import { privateNoStoreHeaders } from "../http-control.ts";

/**
 * The kernel's response envelope: the caller's correlation id, or a fresh one,
 * on a private, uncached answer. The product's own read routes (`/health`)
 * answer through it, and the API wrapper beside the kernel builds on it, so a
 * correlation id reads the same wherever a request lands.
 */

const CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function correlationIdFromHeader(
  value: string | null,
  create: () => string,
): string {
  return value && CORRELATION_ID.test(value) ? value : create();
}

export function requestCorrelationId(request: Request): string {
  return correlationIdFromHeader(
    request.headers.get("x-correlation-id"),
    () => `corr_${randomUUID().replaceAll("-", "")}`,
  );
}

export function kernelResponseHeaders(correlationId: string, extra: Record<string, string> = {}) {
  return {
    ...privateNoStoreHeaders(),
    "X-Correlation-Id": correlationId,
    ...extra,
  };
}

export function publicKernelResponse(request: Request, body: unknown, status = 200): NextResponse {
  const correlationId = requestCorrelationId(request);
  return NextResponse.json(body, { status, headers: kernelResponseHeaders(correlationId) });
}
