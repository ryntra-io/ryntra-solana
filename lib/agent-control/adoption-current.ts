import { AGENT_QUOTA_POLICIES } from "./quota.ts";
import {
  HOSTED_MCP_TOOLS,
  WITHHELD_UPSTREAM_READ_TOOLS,
  admitHostedToolCall,
  hostedToolsFor,
  localMcpToolNames,
} from "./mcp/hosted.ts";
import {
  AGENT_CONTROL_SCOPES,
  AGENT_KEY_REFUSALS,
  type AgentControlScope,
} from "./tenancy.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./oauth/server.ts";
import {
  AGENT_MCP_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_REVOKE_PATH,
  OAUTH_TOKEN_PATH,
} from "./oauth/metadata.ts";

/**
 * What the adoption surface draws, computed from the modules that decide it.
 *
 * Not one hand-written status. The scope matrix comes from calling the real
 * admission gate; the inventory comes from the real catalogue; the quota
 * numbers come from the real policy constants. A page that restated any of
 * these in its own words would be a second copy that has to be kept true, and
 * this repository has a long record of what happens to those.
 */

export type ScopeProjection = Readonly<{
  scope: AgentControlScope;
  kind: "READ" | "WRITE" | "OBSERVE";
  /** Tool names this scope alone unlocks. Empty is a real and useful answer. */
  tools: readonly string[];
  what: string;
}>;

export type ToolCell = Readonly<{
  tool: string;
  scope: AgentControlScope;
  /** What the gate actually answers for a token holding only this column's scope. */
  verdict: "ADMITTED" | "SCOPE_NOT_GRANTED";
}>;

export type QuotaRow = Readonly<{
  principal: "Anonymous" | "Identified tenant";
  limit: number;
  windowSeconds: number;
  durable: boolean;
  note: string;
}>;

export type WithheldTool = Readonly<{ name: string; reason: string }>;

export type EndpointRow = Readonly<{
  path: string;
  rfc: string;
  what: string;
  authenticated: boolean;
}>;

export type AdoptionSurface = Readonly<{
  scopes: readonly ScopeProjection[];
  matrix: readonly ToolCell[];
  hostedNames: readonly string[];
  localNames: readonly string[];
  withheld: readonly WithheldTool[];
  quotas: readonly QuotaRow[];
  refusals: readonly string[];
  endpoints: readonly EndpointRow[];
  lifetimes: readonly Readonly<{ label: string; seconds: number; why: string }>[];
  blockers: readonly string[];
}>;

const SCOPE_COPY: Readonly<Record<AgentControlScope, { kind: ScopeProjection["kind"]; what: string }>> = {
  "evidence:read": {
    kind: "READ",
    what: "Local drafting, preflight and artifact verification. Computes inside this process and reaches no provider.",
  },
  "proposal:write": {
    kind: "WRITE",
    what: "Records a proposal at PROPOSE. Shares one effect value with every other write, so a signer is unrepresentable.",
  },
  "metrics:read": {
    kind: "OBSERVE",
    what: "Reads request counters for one warm instance. Deliberately unlocks no tool at all.",
  },
};

export function buildAdoptionSurface(): AdoptionSurface {
  const scopes: readonly ScopeProjection[] = AGENT_CONTROL_SCOPES.map((scope) =>
    Object.freeze({
      scope,
      kind: SCOPE_COPY[scope].kind,
      what: SCOPE_COPY[scope].what,
      tools: hostedToolsFor([scope]).map((tool) => tool.name),
    }),
  );

  /* Every (tool, scope) pair answered by the gate itself. A hand-drawn matrix
     could disagree with the gate; this one cannot, because it is the gate. */
  const matrix: readonly ToolCell[] = HOSTED_MCP_TOOLS.flatMap((tool) =>
    AGENT_CONTROL_SCOPES.map((scope) =>
      Object.freeze({
        tool: tool.name,
        scope,
        verdict: admitHostedToolCall(tool.name, [scope]).admitted
          ? ("ADMITTED" as const)
          : ("SCOPE_NOT_GRANTED" as const),
      }),
    ),
  );

  return Object.freeze({
    scopes,
    matrix,
    hostedNames: HOSTED_MCP_TOOLS.map((tool) => tool.name),
    localNames: localMcpToolNames(),
    withheld: WITHHELD_UPSTREAM_READ_TOOLS,
    quotas: Object.freeze([
      Object.freeze({
        principal: "Anonymous" as const,
        limit: AGENT_QUOTA_POLICIES.ANONYMOUS.limit,
        windowSeconds: AGENT_QUOTA_POLICIES.ANONYMOUS.windowSeconds,
        durable: true,
        note: "The same number the edge firewall enforces, so the advertised headers, the durable counter and the two firewall rules tell one story.",
      }),
      Object.freeze({
        principal: "Identified tenant" as const,
        limit: AGENT_QUOTA_POLICIES.TENANT.limit,
        windowSeconds: AGENT_QUOTA_POLICIES.TENANT.windowSeconds,
        durable: true,
        note: "Ten times the anonymous allowance, because Ryntra knows who to talk to when they are wrong. That is the whole commercial content of identity.",
      }),
    ]),
    refusals: AGENT_KEY_REFUSALS,
    endpoints: Object.freeze([
      Object.freeze({
        path: OAUTH_REGISTER_PATH,
        rfc: "RFC 7591",
        what: "Registers a public PKCE client. Issues a name and no secret, and grants nothing.",
        authenticated: false,
      }),
      Object.freeze({
        path: OAUTH_AUTHORIZE_PATH,
        rfc: "OAuth 2.1",
        what: "The approval screen. A person presents a Ryntra key, and that key is the ceiling on what can be granted.",
        authenticated: true,
      }),
      Object.freeze({
        path: OAUTH_TOKEN_PATH,
        rfc: "RFC 6749 · 7636",
        what: "Exchanges a code for a token, proving possession with S256. There is no client secret to present.",
        authenticated: false,
      }),
      Object.freeze({
        path: OAUTH_REVOKE_PATH,
        rfc: "RFC 7009",
        what: "Revokes durably. An unknown token answers 200 so the endpoint cannot be used to guess one.",
        authenticated: false,
      }),
      Object.freeze({
        path: AGENT_MCP_PATH,
        rfc: "MCP 2026-07-28",
        what: "The hosted endpoint. Bearer-gated, audience-checked, scope-enforced at call time, and every call leaves a receipt.",
        authenticated: true,
      }),
    ]),
    lifetimes: Object.freeze([
      Object.freeze({
        label: "Authorization code",
        seconds: AUTHORIZATION_CODE_TTL_SECONDS,
        why: "Long enough for one redirect. A replay revokes the session it opened rather than merely being refused.",
      }),
      Object.freeze({
        label: "Access token",
        seconds: ACCESS_TOKEN_TTL_SECONDS,
        why: "Short, because revocation is checked on every call and an hour bounds the window where a leaked token is useful.",
      }),
      Object.freeze({
        label: "Refresh token",
        seconds: REFRESH_TOKEN_TTL_SECONDS,
        why: "Rotates on use, and dies with the key that approved it — revoking a key ends the sessions it opened.",
      }),
    ]),
    blockers: Object.freeze([
      "A proposal made through the hosted endpoint lives in the instance that accepted it. The durable record of the call is its receipt; the proposal itself is not yet durable across instances.",
      "Counters are per warm instance and reset on a cold start. No fleet total is computed, because nobody measured one.",
      "No tenant or key can be created from any screen. Issuing one is a deliberate act with no self-service path, and there is no billing, plan or invoice behind a quota.",
      "The published developer kit is unchanged. The hosted endpoint runs from this repository and is not extractable from the sixteen-file public subset.",
    ]),
  });
}
