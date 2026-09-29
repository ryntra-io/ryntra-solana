/**
 * What the Team surface draws, computed from the modules that decide it.
 *
 * "Team" is the Pro depth's answer to a question the Guided depth never asks:
 * *who else can reach this, holding what, and how much of it?* Founder decision
 * A retail Consumer Pro tier is out of scope — Ryntra Home is the
 * surface for a person and Agent Control is the surface for a team — so this
 * page is about shared access, never about a plan or a price.
 *
 * **It reads and issues nothing.** `RYN-AGENT-CONTROL-008` shipped real tenancy:
 * tenants, keys, scopes, durable quotas and a revocation that is checked before
 * expiry. Issuing a key is deliberately not self-service, so there is no button
 * here and no mutation path for one to call. The surface says that in its own
 * words rather than showing a disabled control, because a disabled control is a
 * promise with a tooltip.
 *
 * **No secret reaches this module.** A key's secret is never persisted — only
 * its SHA-256 — and the projection below deals in field *names* and lifecycle
 * states, never in a stored value. The field list is derived from the real
 * schema so a new field cannot appear on the record without appearing here.
 */

import { AGENT_QUOTA_POLICIES } from "./quota.ts";
import { admitHostedToolCall, hostedToolsFor } from "./mcp/hosted.ts";
import {
  AGENT_CONTROL_SCOPES,
  AGENT_KEY_REFUSALS,
  AgentApiKeyRecordSchema,
  AgentTenantRecordSchema,
  type AgentControlScope,
} from "./tenancy.ts";
import { mainnetPerimeter } from "./mainnet-promotion.ts";

/** Fields whose value is a credential or derived from one. Names only, ever. */
const SECRET_DERIVED_FIELDS = Object.freeze(["secretHash"]);

export type RecordField = Readonly<{
  name: string;
  /** True when the value is a credential or derived from one and is never rendered. */
  secretDerived: boolean;
}>;

export type ScopeRow = Readonly<{
  scope: AgentControlScope;
  kind: "READ" | "WRITE" | "OBSERVE";
  tools: number;
  what: string;
}>;

export type LifecycleStep = Readonly<{
  step: string;
  who: "OWNER" | "RYNTRA" | "AGENT";
  what: string;
  selfService: boolean;
}>;

export type TeamSurface = Readonly<{
  scopes: readonly ScopeRow[];
  tenantFields: readonly RecordField[];
  keyFields: readonly RecordField[];
  refusals: readonly string[];
  lifecycle: readonly LifecycleStep[];
  quotas: readonly Readonly<{ principal: string; limit: number; windowSeconds: number; durable: boolean }>[];
  perimeter: ReturnType<typeof mainnetPerimeter>;
  blockers: readonly string[];
}>;

const SCOPE_COPY: Readonly<Record<AgentControlScope, { kind: ScopeRow["kind"]; what: string }>> = {
  "evidence:read": {
    kind: "READ",
    what: "Drafting, preflight and artifact verification. Computes in this process and reaches no provider.",
  },
  "proposal:write": {
    kind: "WRITE",
    what: "Records a proposal at PROPOSE. Shares one effect value with every other write, so a signer is unrepresentable.",
  },
  "metrics:read": {
    kind: "OBSERVE",
    what: "Reads request counters for one warm instance. Unlocks no tool at all, so it never has to be bundled.",
  },
};

/** Field names straight off the schema, so a new one cannot be added unseen. */
function fieldsOf(shape: Readonly<Record<string, unknown>>): readonly RecordField[] {
  return Object.freeze(
    Object.keys(shape).map((name) =>
      Object.freeze({ name, secretDerived: SECRET_DERIVED_FIELDS.includes(name) }),
    ),
  );
}

export function buildTeamSurface(asOf: string): TeamSurface {
  const scopes: readonly ScopeRow[] = Object.freeze(
    AGENT_CONTROL_SCOPES.map((scope) =>
      Object.freeze({
        scope,
        kind: SCOPE_COPY[scope].kind,
        what: SCOPE_COPY[scope].what,
        /* The real gate, asked at render time. A hand-written number here could
           disagree with the server; this one is the server's own answer. */
        tools: hostedToolsFor([scope]).filter((tool) => admitHostedToolCall(tool.name, [scope]).admitted).length,
      }),
    ),
  );

  return Object.freeze({
    scopes,
    tenantFields: fieldsOf(AgentTenantRecordSchema.shape),
    keyFields: fieldsOf(AgentApiKeyRecordSchema.shape),
    refusals: Object.freeze([...AGENT_KEY_REFUSALS]),
    lifecycle: Object.freeze([
      Object.freeze({
        step: "A tenant exists",
        who: "RYNTRA" as const,
        what: "Created deliberately, with a display name and an ACTIVE or SUSPENDED status. There is no sign-up path.",
        selfService: false,
      }),
      Object.freeze({
        step: "A key is issued to that tenant",
        who: "RYNTRA" as const,
        what: "The secret is returned once and never stored; only its SHA-256 is kept. No screen in this product issues one.",
        selfService: false,
      }),
      Object.freeze({
        step: "The key names its scopes",
        who: "OWNER" as const,
        what: "At least one, at most all three. The scopes a key holds are the ceiling on anything it can later authorize.",
        selfService: false,
      }),
      Object.freeze({
        step: "An agent presents the key",
        who: "AGENT" as const,
        what: "Authentication is checked before anything else, and a refusal names exactly one of eight reasons.",
        selfService: true,
      }),
      Object.freeze({
        step: "A token is minted from that key",
        who: "AGENT" as const,
        what: "The approving key is the ceiling: a token can never carry a scope the key did not hold.",
        selfService: true,
      }),
      Object.freeze({
        step: "The key is revoked",
        who: "OWNER" as const,
        what: "Revocation is read before expiry, so the very next call is refused rather than the next token cycle.",
        selfService: false,
      }),
    ]),
    quotas: Object.freeze(
      Object.entries(AGENT_QUOTA_POLICIES).map(([principal, policy]) =>
        Object.freeze({
          principal,
          limit: policy.limit,
          windowSeconds: policy.windowSeconds,
          /* Durability is a property of the configured store rather than of the
             policy. The meter fails closed when the store is unreachable, which
             is why this reads as a property of the window and not a promise. */
          durable: true,
        }),
      ),
    ),
    perimeter: mainnetPerimeter({ asOf }),
    blockers: Object.freeze([
      "No key can be created, rotated or revoked from this or any other screen: issuing one is a deliberate act with no self-service path.",
      "There is no billing, plan, invoice or price behind a quota.",
      "There is no per-member identity: a key names a tenant, not a person, so this surface cannot show who inside a team did what.",
      "Counters are per warm instance and no fleet total is computed, so a team's usage across instances is not visible here.",
    ]),
  });
}
