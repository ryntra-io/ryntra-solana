import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { GuardStore, GuardVersionedCollection } from "../guard/store.ts";

/**
 * Tenancy and API keys — the layer that replaces "whoever reaches the route".
 *
 * Until this module existed every Agent Control caller was the same anonymous
 * principal, and the only control over them was a per-process fixed window that
 * two warm instances doubled and a cold start reset. This file answers *who*;
 * `./quota.ts` answers *how much*, durably; and neither of them answers *what
 * may be done* by more than naming a scope, because that is the boundary the
 * whole packet exists to keep narrow.
 *
 * **The scope vocabulary is closed and carries no authority.** `013` made a
 * generic signer unrepresentable by giving the write-effect union exactly one
 * member; this is the same move one layer out. There is no scope value that
 * could mean *sign*, *authorize*, *execute* or *move value*, so a token cannot
 * be minted with one — not because a list forbids it, but because the type has
 * nothing to put there. `RYN-BIN-AOS-003` is the reason the distinction
 * matters: a name on a blocklist is defeated by any caller that can reach a
 * generic execute path, and the answer is to have no such value at all.
 *
 * **The secret is never stored.** A key is presentable exactly once, at issue.
 * What persists is the key id and a SHA-256 of the secret, so a dump of the
 * store is not a set of working credentials. Verification compares digests in
 * constant time: comparing the secrets themselves with `===` would leak their
 * prefix through timing, and this is the one comparison in the product where
 * that is worth paying for.
 *
 * The `ryn_ac_` prefix is an internal credential format, not a product name —
 * No published package or public surface takes a name from this constant.
 */

/** The complete set of things a key can be granted. Deliberately three. */
export const AGENT_CONTROL_SCOPES = [
  /** The read and preview tools: passports, previews, artifact verification. */
  "evidence:read",
  /** The `013` write tools, every one of which produces a proposal at `PROPOSE`. */
  "proposal:write",
  /** The request counters. Never business data. */
  "metrics:read",
] as const;

export type AgentControlScope = (typeof AGENT_CONTROL_SCOPES)[number];

export function isAgentControlScope(value: string): value is AgentControlScope {
  return (AGENT_CONTROL_SCOPES as readonly string[]).includes(value);
}

/** Every way authentication can fail, each with exactly one meaning. */
export const AGENT_KEY_REFUSALS = [
  "MALFORMED_KEY",
  "UNKNOWN_KEY",
  "SECRET_MISMATCH",
  "KEY_REVOKED",
  "KEY_EXPIRED",
  "TENANT_UNKNOWN",
  "TENANT_SUSPENDED",
  "SCOPE_NOT_GRANTED",
] as const;

export type AgentKeyRefusal = (typeof AGENT_KEY_REFUSALS)[number];

export const AGENT_TENANCY_ERRORS = [
  "TENANT_UNKNOWN",
  "TENANT_EXISTS",
  "KEY_UNKNOWN",
  "SCOPE_NOT_DECLARED",
  "SCOPES_REQUIRED",
  "STORE_CONTENDED",
] as const;

export type AgentTenancyErrorCode = (typeof AGENT_TENANCY_ERRORS)[number];

export class AgentTenancyError extends Error {
  readonly reasonCode: AgentTenancyErrorCode;

  constructor(reasonCode: AgentTenancyErrorCode, message: string) {
    super(message);
    this.name = "AgentTenancyError";
    this.reasonCode = reasonCode;
  }
}

const timestamp = z.string().datetime({ offset: true });

export const AgentTenantRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    tenantId: z.string().regex(/^ten_[0-9a-f]{16}$/),
    displayName: z.string().min(1).max(120),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export type AgentTenantRecord = z.output<typeof AgentTenantRecordSchema>;

export const AgentApiKeyRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    keyId: z.string().regex(/^[0-9a-f]{24}$/),
    tenantId: z.string().regex(/^ten_[0-9a-f]{16}$/),
    label: z.string().min(1).max(120),
    /** SHA-256 of the presented secret. The secret itself is never persisted. */
    secretHash: z.string().regex(/^[0-9a-f]{64}$/),
    scopes: z.array(z.enum(AGENT_CONTROL_SCOPES)).min(1).max(AGENT_CONTROL_SCOPES.length),
    createdAt: timestamp,
    expiresAt: timestamp.nullable(),
    revokedAt: timestamp.nullable(),
  })
  .strict();

export type AgentApiKeyRecord = z.output<typeof AgentApiKeyRecordSchema>;

export type AgentPrincipal = Readonly<{
  tenantId: string;
  keyId: string;
  displayName: string;
  scopes: readonly AgentControlScope[];
}>;

export type AgentKeyDecision =
  | Readonly<{ accepted: true; principal: AgentPrincipal }>
  | Readonly<{ accepted: false; reasonCode: AgentKeyRefusal }>;

const KEY_PREFIX = "ryn_ac_";
const KEY_ID_BYTES = 12;
const SECRET_BYTES = 32;
/** base64url of 32 bytes is 43 characters with no padding. */
const KEY_PATTERN = /^ryn_ac_([0-9a-f]{24})_([A-Za-z0-9_-]{43})$/;

export function parseAgentKey(presented: string): Readonly<{ keyId: string; secret: string }> | null {
  if (typeof presented !== "string") return null;
  const match = KEY_PATTERN.exec(presented);
  if (!match) return null;
  return { keyId: match[1], secret: match[2] };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Constant-time digest comparison.
 *
 * Both operands are fixed-length hex digests, so the lengths always match and
 * `timingSafeEqual` never throws on a length mismatch — which would itself be
 * a timing signal.
 */
function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export type IssuedAgentKey = Readonly<{
  /** The full presentable credential. Returned once and never stored. */
  key: string;
  keyId: string;
  secret: string;
  tenantId: string;
  scopes: readonly AgentControlScope[];
}>;

export type AgentTenancy = Readonly<{
  createTenant(input: { displayName: string; createdAtMs: number }): Promise<AgentTenantRecord>;
  readTenant(tenantId: string): Promise<AgentTenantRecord | undefined>;
  suspendTenant(tenantId: string, options: { atMs: number }): Promise<AgentTenantRecord>;
  issueKey(input: {
    tenantId: string;
    label: string;
    scopes: readonly string[];
    createdAtMs: number;
    expiresAtMs?: number | null;
  }): Promise<IssuedAgentKey>;
  readKey(keyId: string): Promise<AgentApiKeyRecord>;
  revokeKey(keyId: string, options: { revokedAtMs: number }): Promise<AgentApiKeyRecord>;
  listKeys(tenantId: string): Promise<readonly AgentApiKeyRecord[]>;
}>;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function createAgentTenancy(store: GuardStore): AgentTenancy {
  const tenants: GuardVersionedCollection<AgentTenantRecord> =
    store.versioned<AgentTenantRecord>("agentTenants");
  const keys: GuardVersionedCollection<AgentApiKeyRecord> =
    store.versioned<AgentApiKeyRecord>("agentApiKeys");

  async function requireTenant(tenantId: string): Promise<AgentTenantRecord> {
    const record = await tenants.get(tenantId);
    if (!record) {
      throw new AgentTenancyError("TENANT_UNKNOWN", `No tenant ${tenantId} exists.`);
    }
    return record;
  }

  return {
    async createTenant({ displayName, createdAtMs }) {
      const tenantId = `ten_${randomBytes(8).toString("hex")}`;
      const record = AgentTenantRecordSchema.parse({
        version: 0,
        tenantId,
        displayName,
        status: "ACTIVE",
        createdAt: iso(createdAtMs),
        updatedAt: iso(createdAtMs),
      });
      if (!(await tenants.insertIfAbsent(tenantId, record))) {
        throw new AgentTenancyError("TENANT_EXISTS", `Tenant ${tenantId} already exists.`);
      }
      return record;
    },

    readTenant(tenantId) {
      return tenants.get(tenantId);
    },

    async suspendTenant(tenantId, { atMs }) {
      const current = await requireTenant(tenantId);
      if (current.status === "SUSPENDED") return current;
      const next = AgentTenantRecordSchema.parse({
        ...current,
        version: current.version + 1,
        status: "SUSPENDED",
        updatedAt: iso(atMs),
      });
      if (!(await tenants.compareAndSet(tenantId, current.version, next))) {
        throw new AgentTenancyError("STORE_CONTENDED", `Tenant ${tenantId} changed concurrently.`);
      }
      return next;
    },

    async issueKey({ tenantId, label, scopes, createdAtMs, expiresAtMs = null }) {
      await requireTenant(tenantId);
      if (scopes.length === 0) {
        throw new AgentTenancyError("SCOPES_REQUIRED", "A key with no scope can do nothing; state one.");
      }
      for (const scope of scopes) {
        if (!isAgentControlScope(scope)) {
          throw new AgentTenancyError(
            "SCOPE_NOT_DECLARED",
            `${scope} is not one of the declared Agent Control scopes.`,
          );
        }
      }
      const keyId = randomBytes(KEY_ID_BYTES).toString("hex");
      const secret = randomBytes(SECRET_BYTES).toString("base64url");
      const record = AgentApiKeyRecordSchema.parse({
        version: 0,
        keyId,
        tenantId,
        label,
        secretHash: sha256Hex(secret),
        scopes: [...scopes],
        createdAt: iso(createdAtMs),
        expiresAt: expiresAtMs === null || expiresAtMs === undefined ? null : iso(expiresAtMs),
        revokedAt: null,
      });
      if (!(await keys.insertIfAbsent(`${tenantId}:${keyId}`, record))) {
        throw new AgentTenancyError("STORE_CONTENDED", "The generated key id was already claimed.");
      }
      /* A second row keyed by id alone: authentication has a key id and no
         tenant, and scanning every tenant to find one would make the tenant
         prefix a lookup path rather than a boundary. */
      await keys.insertIfAbsent(`byId:${keyId}`, record);
      return {
        key: `${KEY_PREFIX}${keyId}_${secret}`,
        keyId,
        secret,
        tenantId,
        scopes: record.scopes,
      };
    },

    async readKey(keyId) {
      const record = await keys.get(`byId:${keyId}`);
      if (!record) throw new AgentTenancyError("KEY_UNKNOWN", `No key ${keyId} exists.`);
      return record;
    },

    async revokeKey(keyId, { revokedAtMs }) {
      const current = await keys.get(`byId:${keyId}`);
      if (!current) throw new AgentTenancyError("KEY_UNKNOWN", `No key ${keyId} exists.`);
      /* Revoking an already revoked key keeps the first moment. The second call
         is not an error — a caller who revokes twice wanted it revoked — but the
         recorded time is when it actually stopped working. */
      if (current.revokedAt !== null) return current;
      const next = AgentApiKeyRecordSchema.parse({
        ...current,
        version: current.version + 1,
        revokedAt: iso(revokedAtMs),
      });
      const wonById = await keys.compareAndSet(`byId:${keyId}`, current.version, next);
      if (!wonById) {
        throw new AgentTenancyError("STORE_CONTENDED", `Key ${keyId} changed concurrently.`);
      }
      const mirror = await keys.get(`${current.tenantId}:${keyId}`);
      if (mirror) {
        await keys.compareAndSet(`${current.tenantId}:${keyId}`, mirror.version, next);
      }
      return next;
    },

    async listKeys(tenantId) {
      return keys.valuesWithPrefix(`${tenantId}:`);
    },
  };
}

export type AuthenticateOptions = Readonly<{
  nowMs: number;
  requiredScopes?: readonly AgentControlScope[];
}>;

/**
 * Verify a presented key and, when asked, that it carries the scopes a caller
 * needs.
 *
 * The order is deliberate and is the same precedence `013` recorded for the
 * registry: *nobody can* outranks *you may not*. A malformed key never reaches
 * the store, an unknown key is refused before any digest work, a revoked key is
 * refused before expiry is read, and scope — the only refusal that says
 * something about what this caller is allowed to do — is answered last, because
 * saying "you lack that scope" about a credential that does not exist tells a
 * caller the credential exists.
 */
export async function authenticateAgentKey(
  tenancy: AgentTenancy,
  presented: string | null | undefined,
  { nowMs, requiredScopes = [] }: AuthenticateOptions,
): Promise<AgentKeyDecision> {
  const parsed = presented ? parseAgentKey(presented) : null;
  if (!parsed) return { accepted: false, reasonCode: "MALFORMED_KEY" };

  let record: AgentApiKeyRecord;
  try {
    record = await tenancy.readKey(parsed.keyId);
  } catch {
    return { accepted: false, reasonCode: "UNKNOWN_KEY" };
  }

  if (!digestsMatch(record.secretHash, sha256Hex(parsed.secret))) {
    return { accepted: false, reasonCode: "SECRET_MISMATCH" };
  }
  if (record.revokedAt !== null) return { accepted: false, reasonCode: "KEY_REVOKED" };
  if (record.expiresAt !== null && Date.parse(record.expiresAt) <= nowMs) {
    return { accepted: false, reasonCode: "KEY_EXPIRED" };
  }

  const tenant = await tenancy.readTenant(record.tenantId);
  if (!tenant) return { accepted: false, reasonCode: "TENANT_UNKNOWN" };
  if (tenant.status !== "ACTIVE") return { accepted: false, reasonCode: "TENANT_SUSPENDED" };

  for (const scope of requiredScopes) {
    if (!record.scopes.includes(scope)) {
      return { accepted: false, reasonCode: "SCOPE_NOT_GRANTED" };
    }
  }

  return {
    accepted: true,
    principal: {
      tenantId: record.tenantId,
      keyId: record.keyId,
      displayName: tenant.displayName,
      scopes: record.scopes,
    },
  };
}
