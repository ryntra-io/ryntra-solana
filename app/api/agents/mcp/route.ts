import { createMcpHandler } from "@modelcontextprotocol/server";
import { randomBytes } from "node:crypto";

import {
  digestArguments,
  recordHostedCallReceipt,
  type HostedMcpTool,
} from "../../../../lib/agent-control/mcp/hosted.ts";
import { hostedMcpTool } from "../../../../lib/agent-control/mcp/hosted.ts";
import { createHostedAgentControlServer } from "../../../../lib/agent-control/mcp/hosted-server.ts";
import {
  mcpResourceIdentifier,
  protectedResourceMetadataUrl,
} from "../../../../lib/agent-control/oauth/metadata.ts";
import { AgentOAuthError, createAgentOAuthServer } from "../../../../lib/agent-control/oauth/server.ts";
import { getAgentControlObserver } from "../../../../lib/agent-control/observability.ts";
import { QuotaUnavailableError, createAgentQuotaMeter, quotaPolicyFor } from "../../../../lib/agent-control/quota.ts";
import { getAgentControlRuntime } from "../../../../lib/agent-control/runtime.ts";
import { consumeAgentControlRequest } from "../../../../lib/agent-control/http.ts";
import { privateNoStoreHeaders } from "../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The hosted MCP endpoint — the first Agent Control surface a stranger can
 * reach without a person handing them anything.
 *
 * It exists only because identity does. Before this packet there was no way to
 * say who a caller was, so a hosted endpoint could only have been anonymous,
 * and an anonymous write endpoint is a queue anybody can fill. The order in
 * this file is the order of that argument: authenticate, meter, then serve.
 *
 * **The challenge is the specification's, not an invention.** An
 * unauthenticated call answers `401` with `WWW-Authenticate: Bearer` naming the
 * RFC 9728 protected-resource metadata URL, which is how an MCP client
 * discovers the authorization server with nothing configured by hand.
 *
 * **The token names this resource.** Audience is checked on every call, so a
 * token minted for another deployment — a preview, somebody else's fork — is
 * `invalid_token` here rather than a working credential.
 *
 * **Every call leaves a receipt**, admitted or refused, carrying the tool, the
 * scope, the outcome, the exact reason and a digest of the arguments. A log of
 * only the calls that worked answers what a tenant did and not what a tenant
 * tried, and the second question is the one asked after something goes wrong.
 */

function challenge(request: Request, code: string, description: string, status = 401): Response {
  const metadata = protectedResourceMetadataUrl(request);
  return Response.json(
    { error: code, error_description: description },
    {
      status,
      headers: {
        ...privateNoStoreHeaders(),
        "WWW-Authenticate": `Bearer realm="ryntra-agent-control", error="${code}", resource_metadata="${metadata}"`,
      },
    },
  );
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

async function serve(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const observer = getAgentControlObserver();
  const base = {
    route: "/api/agents/mcp",
    method: request.method,
    requestUrl: request.url,
    headers: {
      authorization: request.headers.get("authorization") ?? "",
      "user-agent": request.headers.get("user-agent") ?? "",
      "mcp-protocol-version": request.headers.get("mcp-protocol-version") ?? "",
    },
  };
  const record = (status: number, outcome: string, tenantId: string | null, detail?: unknown) => {
    observer.record({
      ...base,
      status,
      outcome,
      principal: tenantId
        ? { tenantId, keyId: "-", displayName: "", scopes: [] }
        : null,
      durationMs: Date.now() - startedAt,
      detail,
    });
  };

  /* The per-instance floor, ahead of any store work. */
  const local = consumeAgentControlRequest(request.headers);
  if (!local.allowed) {
    record(429, "RATE_LIMITED_LOCAL", null);
    return Response.json(
      { error: "rate_limited", error_description: "Too many requests from this address." },
      {
        status: 429,
        headers: { ...privateNoStoreHeaders(), "Retry-After": String(local.retryAfterSeconds) },
      },
    );
  }

  const presented = bearer(request);
  if (presented === null) {
    record(401, "CREDENTIAL_REQUIRED", null);
    return challenge(request, "invalid_token", "This endpoint requires an OAuth 2.1 access token.");
  }

  const store = getAgentControlRuntime().guardStore;
  const oauth = createAgentOAuthServer(store);

  let verified;
  try {
    verified = await oauth.verifyAccessToken({
      token: presented,
      resource: mcpResourceIdentifier(request),
      nowMs: Date.now(),
    });
  } catch (error) {
    const code = error instanceof AgentOAuthError ? error.code : "invalid_token";
    record(401, code, null);
    return challenge(
      request,
      "invalid_token",
      error instanceof AgentOAuthError ? error.message : "The access token was refused.",
    );
  }

  let quota;
  try {
    quota = await createAgentQuotaMeter(store).consume({
      principal: `tenant:${verified.tenantId}`,
      policy: quotaPolicyFor({
        tenantId: verified.tenantId,
        keyId: verified.keyId,
        displayName: "",
        scopes: verified.scopes,
      }),
      nowMs: Date.now(),
    });
  } catch (error) {
    const reasonCode = error instanceof QuotaUnavailableError ? error.reasonCode : "QUOTA_UNAVAILABLE";
    record(503, reasonCode, verified.tenantId);
    return Response.json(
      { error: "temporarily_unavailable", error_description: "The durable quota could not be evaluated." },
      { status: 503, headers: { ...privateNoStoreHeaders(), "Retry-After": "2" } },
    );
  }

  if (!quota.allowed) {
    record(429, "QUOTA_EXCEEDED", verified.tenantId);
    return Response.json(
      { error: "rate_limited", error_description: "The quota for this tenant is spent." },
      {
        status: 429,
        headers: { ...privateNoStoreHeaders(), "Retry-After": String(quota.retryAfterSeconds) },
      },
    );
  }

  /* Receipts are collected during the exchange and written after it: the MCP
     handler owns the response stream, and awaiting a store write inside a tool
     callback would put a database round trip on the protocol's critical path.
     A crash between the two loses a receipt for a call whose response also
     never arrived. */
  const pending: {
    tool: HostedMcpTool | null;
    toolName: string;
    admitted: boolean;
    reasonCode: string | null;
    args: unknown;
  }[] = [];

  const handler = createMcpHandler(() =>
    createHostedAgentControlServer({
      scopes: verified.scopes,
      onCall: (outcome) => {
        pending.push({
          tool: hostedMcpTool(outcome.toolName),
          toolName: outcome.toolName,
          admitted: outcome.admitted,
          reasonCode: outcome.reasonCode,
          args: outcome.args,
        });
      },
    }),
  );

  const response = await handler.fetch(request);

  for (const call of pending) {
    await recordHostedCallReceipt(store, {
      receiptId: `rcp_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`,
      tenantId: verified.tenantId,
      clientId: verified.clientId,
      grantId: verified.grantId,
      toolName: call.toolName,
      /* A refused call names the scope its tool would have needed, so the audit
         row says what was being reached for. A name that is hosted nowhere has
         no scope, and `evidence:read` is the narrowest thing to record. */
      scope: call.tool?.scope ?? "evidence:read",
      outcome: call.admitted && call.reasonCode === null ? "ACCEPTED" : "REFUSED",
      reasonCode: call.reasonCode,
      args: call.args,
      atMs: Date.now(),
    });
  }

  record(response.status, pending.length === 0 ? "OK" : (pending[0].reasonCode ?? "OK"), verified.tenantId, {
    calls: pending.map((call) => ({
      tool: call.toolName,
      admitted: call.admitted,
      reasonCode: call.reasonCode,
      argumentsDigest: digestArguments(call.args),
    })),
  });

  const headers = new Headers(response.headers);
  headers.set("RateLimit-Limit", String(quota.limit));
  headers.set("RateLimit-Remaining", String(quota.remaining));
  headers.set("Cache-Control", "private, no-store, max-age=0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
