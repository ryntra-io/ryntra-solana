import { isAgentPassport as isSdkAgentPassport } from "../../packages/agent-control-sdk/src/index.ts";
import type { AgentPassport } from "./agent-passport.ts";
import { canonicalJson, compareCanonicalStrings } from "../guard/canonical-json.ts";

const HASH_DOMAINS = {
  identity: "ryntra.agent-control.agent-passport.identity.v1",
  passport: "ryntra.agent-control.agent-passport.v1",
  integrity: "ryntra.agent-control.agent-passport.integrity.v1",
} as const;

const SOURCE_ORDER = new Map([
  ["agentverse-registry", 0],
  ["agentverse-search", 1],
  ["agentverse-manifests", 2],
] as const);

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashAgentPassportPayload(domain: string, value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto is unavailable, so Agent Passport integrity cannot be recomputed.");
  }
  const bytes = new TextEncoder().encode(`${domain}\n${canonicalJson(value)}`);
  return `0x${hex(await subtle.digest("SHA-256", bytes))}`;
}

function byId<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

function withOrderedSourceIds<T extends { sourceIds: readonly string[] }>(value: T): T {
  return { ...value, sourceIds: [...value.sourceIds].sort(compareCanonicalStrings) };
}

function canonicalSources(passport: AgentPassport): AgentPassport["sources"] {
  return [...passport.sources]
    .map((source) => ({
      ...source,
      members: [...source.members]
        .map((member) => ({
          ...member,
          schemaDrift: [...member.schemaDrift].sort(compareCanonicalStrings),
        }))
        .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
      schemaDrift: [...source.schemaDrift].sort(compareCanonicalStrings),
    }))
    .sort((left, right) =>
      (SOURCE_ORDER.get(left.id) ?? 99) - (SOURCE_ORDER.get(right.id) ?? 99));
}

function hasCanonicalCollections(passport: AgentPassport): boolean {
  const expectedClaims = byId(passport.providerClaims.map((claim) => ({
    ...withOrderedSourceIds(claim),
    value: Array.isArray(claim.value)
      ? [...claim.value].sort(compareCanonicalStrings)
      : claim.value,
  })));
  const expectedObservations = byId(passport.ryntraObservations.map(withOrderedSourceIds));
  const expectedConflicts = byId(passport.conflicts.map((conflict) => ({
    ...withOrderedSourceIds(conflict),
    values: [...conflict.values].sort(compareCanonicalStrings),
  })));
  const expectedUnknowns = byId(passport.unknowns.map(withOrderedSourceIds));

  return canonicalJson(passport.sources) === canonicalJson(canonicalSources(passport))
    && canonicalJson(passport.providerClaims) === canonicalJson(expectedClaims)
    && canonicalJson(passport.ryntraObservations) === canonicalJson(expectedObservations)
    && canonicalJson(passport.conflicts) === canonicalJson(expectedConflicts)
    && canonicalJson(passport.unknowns) === canonicalJson(expectedUnknowns);
}

/**
 * Recompute the complete Agent Passport envelope where the tab-local document
 * is consumed. The SDK guard proves the bounded shape and official-source URL
 * contract first; Web Crypto then proves canonical order, identity, passport
 * content and the outer integrity hash without sending the document anywhere.
 */
export async function verifyBrowserAgentPassport(value: unknown): Promise<boolean> {
  if (!isSdkAgentPassport(value)) return false;
  const passport = value as AgentPassport;
  if (!hasCanonicalCollections(passport)) return false;

  const identityHash = await hashAgentPassportPayload(HASH_DOMAINS.identity, {
    request: passport.request,
    sources: passport.sources.map(({ id, payloadDigest, availability }) => ({
      id,
      payloadDigest,
      availability,
    })),
    createdAt: passport.createdAt,
  });
  if (passport.id !== `agent-passport_${identityHash.slice(2, 18)}`) return false;

  const { passportHash: _passportHash, integrity: _integrity, ...core } = passport;
  const expectedPassportHash = await hashAgentPassportPayload(HASH_DOMAINS.passport, core);
  if (passport.passportHash !== expectedPassportHash) return false;

  const { integrity: _discarded, ...withoutIntegrity } = passport;
  const expectedIntegrityHash = await hashAgentPassportPayload(HASH_DOMAINS.integrity, withoutIntegrity);
  return passport.integrity.hash === expectedIntegrityHash;
}
