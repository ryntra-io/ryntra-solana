import { clientIp, privateNoStoreHeaders, type RateLimitDecision } from "../http-control.ts";
import { consumeAgentControlRequest } from "./http.ts";
import { getAgentControlObserver } from "./observability.ts";
import {
  QuotaUnavailableError,
  quotaPolicyFor,
  quotaPrincipal,
  createAgentQuotaMeter,
  type AgentQuotaDecision,
} from "./quota.ts";
import { getAgentControlRuntime } from "./runtime.ts";
import {
  authenticateAgentKey,
  createAgentTenancy,
  type AgentControlScope,
  type AgentPrincipal,
} from "./tenancy.ts";

/**
 * One gate in front of every Agent Control route.
 *
 * Before this existed each route opened with `consumeAgentControlRequest`, and
 * that was the whole of its access control: an anonymous caller, a per-process
 * window, and no record afterwards of who had been refused or why. Three things
 * are added here and nothing about the routes' own behaviour changes.
 *
 * **Identity is optional and consequential.** A caller may still arrive with no
 * credential — the published developer kit and the public verifier depend on
 * it, and removing that would break a contract this repository already shipped.
 * What changes is that presenting a key is now worth something: a tenant is
 * counted against a tenant quota, ten times the anonymous one, because Ryntra
 * knows who to talk to when they are wrong.
 *
 * **A malformed or refused credential is a refusal, not a downgrade.** A caller
 * who presents a revoked key does not silently become anonymous and get served
 * at the anonymous rate: that would make revocation look like it had worked
 * while the caller kept reading. Presenting nothing is anonymous; presenting
 * something wrong is `401`.
 *
 * **The order is cheap-first, and it is not arbitrary.** The in-process limiter
 * stays and runs first — it costs no round trip and it is the floor that stops
 * one hot loop from hammering the store on its way to being refused. The
 * durable quota is the authority, and it runs after authentication because who
 * you are decides which quota you get.
 */

export type AgentRouteRefusal = Readonly<{
  status: number;
  code: string;
  message: string;
}>;

export type GuardedAgentRoute =
  | Readonly<{
      admitted: false;
      response: Response;
      /** Already emitted by the gate; a route must not record a second time. */
      recorded: true;
    }>
  | Readonly<{
      admitted: true;
      principal: AgentPrincipal | null;
      quota: AgentQuotaDecision;
      headers: Record<string, string>;
      /** Emit the one structured record for this request. Call exactly once. */
      complete(status: number, outcome: string, detail?: unknown): void;
      /** Build a refusal response and record it in one step. */
      refuse(refusal: AgentRouteRefusal): Response;
    }>;

export type AgentRouteOptions = Readonly<{
  route: string;
  requiredScopes?: readonly AgentControlScope[];
  /** When false a credential is mandatory. The hosted MCP endpoint sets this. */
  allowAnonymous?: boolean;
  nowMs?: number;
}>;

function quotaHeaders(quota: AgentQuotaDecision): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(quota.limit),
    "RateLimit-Remaining": String(quota.remaining),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((quota.resetAtMs - Date.now()) / 1_000))),
  };
  if (!quota.allowed) headers["Retry-After"] = String(quota.retryAfterSeconds);
  return headers;
}

function bearerCredential(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

/**
 * The header names copied into the structured record.
 *
 * An allowlist rather than the whole header map: redaction classifies by name,
 * so a header nobody has heard of would be printed in full, and a request
 * carrying a proxy-added credential in a bespoke header is exactly the case
 * that matters. `authorization` and `cookie` are copied deliberately — they are
 * redacted to a marker, and their *presence* is the operationally useful fact.
 */
const LOGGED_HEADERS = [
  "authorization",
  "cookie",
  "user-agent",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
] as const;

function loggedHeaders(headers: Headers): Record<string, string> {
  const copied: Record<string, string> = {};
  for (const name of LOGGED_HEADERS) {
    const value = headers.get(name);
    if (value !== null) copied[name] = value;
  }
  return copied;
}

export async function guardAgentRoute(
  request: Request,
  options: AgentRouteOptions,
): Promise<GuardedAgentRoute> {
  const startedAt = Date.now();
  const nowMs = options.nowMs ?? startedAt;
  const observer = getAgentControlObserver();
  const method = request.method;
  const base = {
    route: options.route,
    method,
    requestUrl: request.url,
    headers: loggedHeaders(request.headers),
  };

  const record = (
    status: number,
    outcome: string,
    principal: AgentPrincipal | null,
    quota?: AgentQuotaDecision,
    detail?: unknown,
  ) => {
    observer.record({
      ...base,
      status,
      outcome,
      principal,
      durationMs: Date.now() - startedAt,
      quota: quota ? { limit: quota.limit, remaining: quota.remaining } : undefined,
      detail,
    });
  };

  const refusalResponse = (
    status: number,
    code: string,
    message: string,
    extraHeaders: Record<string, string> = {},
  ) =>
    Response.json(
      { error: { code, message } },
      { status, headers: { ...privateNoStoreHeaders(), ...extraHeaders } },
    );

  /* The floor. Cheap, per instance, and honest about being best effort. */
  const local: RateLimitDecision = consumeAgentControlRequest(request.headers);
  if (!local.allowed) {
    record(429, "RATE_LIMITED_LOCAL", null);
    return {
      admitted: false,
      recorded: true,
      response: refusalResponse(429, "RATE_LIMITED", "Too many requests from this address.", {
        "RateLimit-Limit": String(local.limit),
        "RateLimit-Remaining": String(local.remaining),
        "RateLimit-Reset": String(local.resetAfterSeconds),
        "Retry-After": String(local.retryAfterSeconds),
      }),
    };
  }

  const runtime = getAgentControlRuntime();
  const tenancy = createAgentTenancy(runtime.guardStore);
  const presented = bearerCredential(request.headers);

  let principal: AgentPrincipal | null = null;
  if (presented !== null) {
    const decision = await authenticateAgentKey(tenancy, presented, {
      nowMs,
      requiredScopes: options.requiredScopes ?? [],
    });
    if (!decision.accepted) {
      record(decision.reasonCode === "SCOPE_NOT_GRANTED" ? 403 : 401, decision.reasonCode, null);
      return {
        admitted: false,
        recorded: true,
        response: refusalResponse(
          decision.reasonCode === "SCOPE_NOT_GRANTED" ? 403 : 401,
          decision.reasonCode,
          "The presented credential was refused.",
          { "WWW-Authenticate": 'Bearer realm="ryntra-agent-control"' },
        ),
      };
    }
    principal = decision.principal;
  } else if (options.allowAnonymous === false) {
    record(401, "CREDENTIAL_REQUIRED", null);
    return {
      admitted: false,
      recorded: true,
      response: refusalResponse(401, "CREDENTIAL_REQUIRED", "This endpoint requires a credential.", {
        "WWW-Authenticate": 'Bearer realm="ryntra-agent-control"',
      }),
    };
  }

  let quota: AgentQuotaDecision;
  try {
    quota = await createAgentQuotaMeter(runtime.guardStore).consume({
      principal: quotaPrincipal(principal, clientIp(request.headers)),
      policy: quotaPolicyFor(principal),
      nowMs,
    });
  } catch (error) {
    const reasonCode = error instanceof QuotaUnavailableError ? error.reasonCode : "QUOTA_UNAVAILABLE";
    record(503, reasonCode, principal);
    return {
      admitted: false,
      recorded: true,
      response: refusalResponse(503, reasonCode, "The durable quota could not be evaluated.", {
        "Retry-After": "2",
      }),
    };
  }

  if (!quota.allowed) {
    record(429, "QUOTA_EXCEEDED", principal, quota);
    return {
      admitted: false,
      recorded: true,
      response: refusalResponse(429, "RATE_LIMITED", "The quota for this principal is spent.", {
        ...quotaHeaders(quota),
      }),
    };
  }

  return {
    admitted: true,
    principal,
    quota,
    headers: { ...privateNoStoreHeaders(), ...quotaHeaders(quota) },
    complete(status, outcome, detail) {
      record(status, outcome, principal, quota, detail);
    },
    refuse(refusal) {
      record(refusal.status, refusal.code, principal, quota);
      return Response.json(
        { error: { code: refusal.code, message: refusal.message } },
        {
          status: refusal.status,
          headers: { ...privateNoStoreHeaders(), ...quotaHeaders(quota) },
        },
      );
    },
  };
}

export type AdmittedAgentRoute = Extract<GuardedAgentRoute, { admitted: true }>;

/**
 * Wrap one route handler in the gate.
 *
 * The handlers themselves are untouched, and that is deliberate: each already
 * owns its validation, its own refusal codes and a test suite that injects the
 * in-process limiter. Re-plumbing them to be quota-aware would rewrite tested
 * behaviour to add a concern that belongs in front of them. So the wrapper
 * authenticates, meters and records, then hands the request on.
 *
 * The durable decision wins on the way out. A handler still advertises the
 * in-process limiter's numbers; those are replaced here, because two different
 * `RateLimit-Limit` values on one response is the drift this repository keeps
 * paying for, and the durable one is the one that actually decides.
 */
export function withAgentControlRoute<C>(
  options: AgentRouteOptions,
  handler: (request: Request, context: C, gate: AdmittedAgentRoute) => Promise<Response>,
): (request: Request, context: C) => Promise<Response> {
  return async function guarded(request: Request, context: C): Promise<Response> {
    const gate = await guardAgentRoute(request, options);
    if (!gate.admitted) return gate.response;

    let response: Response;
    try {
      response = await handler(request, context, gate);
    } catch (error) {
      gate.complete(500, "HANDLER_THREW", {
        name: error instanceof Error ? error.name : "unknown",
      });
      return Response.json(
        { error: { code: "UPSTREAM_FAILURE", message: "The request could not be completed." } },
        { status: 500, headers: gate.headers },
      );
    }

    const merged = new Headers(response.headers);
    for (const [name, value] of Object.entries(gate.headers)) merged.set(name, value);

    let outcome = "OK";
    if (response.status >= 400) {
      outcome = await readErrorCode(response.clone());
    }
    gate.complete(response.status, outcome);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: merged,
    });
  };
}

/**
 * The refusal code a handler already put in its own envelope.
 *
 * Reading it back rather than inventing one keeps the log and the caller's
 * error agreeing about what happened. A body that is not the expected envelope
 * is recorded as `HTTP_4xx` instead of guessed at.
 */
async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    if (typeof code === "string" && code.length > 0 && code.length <= 64) return code;
  } catch {
    /* Not a JSON envelope. The status class is still worth recording. */
  }
  return `HTTP_${Math.floor(response.status / 100)}xx`;
}
