/**
 * The v1 routes' shared HTTP surface — the one error shape, the version
 * headers, the body reader with a ceiling, the contract-major check.
 *
 * Server only (the routes import it); nothing here reads a store.
 */

import { NextResponse } from "next/server";
import type { z } from "zod";

import { privateNoStoreHeaders } from "../../http-control.ts";
import { API_CONTRACT_VERSION, API_HEADER, API_MAJOR, API_VERSION_HEADER, ERROR_STATUS, requestedMajor, type ApiErrorCode, type PlanIssueCode } from "./contract.ts";

export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...privateNoStoreHeaders(), [API_VERSION_HEADER]: API_CONTRACT_VERSION, ...extra };
}

export function apiJson<T>(body: T, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: apiHeaders(extra) });
}

export function apiFailure(
  code: ApiErrorCode,
  message: string,
  extra: Readonly<{ minimumAppVersion?: string; issues?: readonly Readonly<{ path: string; message: string; code?: PlanIssueCode }>[]; headers?: Record<string, string> }> = {},
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(extra.minimumAppVersion ? { minimumAppVersion: extra.minimumAppVersion } : {}),
        /* Only `PLAN_INVALID` carries issues, and only a non-empty list is one — the contract refuses an empty list. 1.7.0: the stable code travels with the message where the rule has one. */
        ...(extra.issues && extra.issues.length > 0 ? { issues: extra.issues.slice(0, 32).map((issue) => ({ path: issue.path, message: issue.message, ...(issue.code ? { code: issue.code } : {}) })) } : {}),
      },
    },
    { status: ERROR_STATUS[code], headers: apiHeaders(extra.headers ?? {}) },
  );
}

/**
 * The contract major a request names must be one this server serves.
 *
 * Absent is allowed — the routes are the contract — but a named major that is
 * not served is refused, because answering it with this major's shapes would
 * be the misread this header exists to prevent.
 */
export function apiMajorRefusal(headers: Headers): NextResponse | null {
  const major = requestedMajor(headers.get(API_HEADER));
  if (major === null || major === API_MAJOR) return null;
  return apiFailure("UNSUPPORTED_API", `This server serves ${API_HEADER}: ${API_MAJOR}; the request named ${Number.isNaN(major) ? "an unreadable major" : major}.`);
}

export type BodyRead<T> = Readonly<{ ok: true; body: T }> | Readonly<{ ok: false; response: NextResponse }>;

/** A JSON body under a byte ceiling, parsed against the contract's schema. */
export async function readApiBody<S extends z.ZodTypeAny>(request: Request, schema: S, maxBytes = 16_384): Promise<BodyRead<z.output<S>>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: apiFailure("VALIDATION_ERROR", "The body could not be read.") };
  }
  if (raw.length > maxBytes) return { ok: false, response: apiFailure("VALIDATION_ERROR", `The body is over ${maxBytes} bytes.`) };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, response: apiFailure("VALIDATION_ERROR", "The body is not JSON.") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "body";
    return { ok: false, response: apiFailure("VALIDATION_ERROR", `${path}: ${issue?.message ?? "did not match the contract"}`) };
  }
  return { ok: true, body: parsed.data };
}
