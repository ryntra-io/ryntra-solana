/* Relative and extension-explicit, like `app/developers/platform.ts`: this
   module is imported by a `node --test` suite, which does not resolve the
   `@/` alias. */
import { API_CONTRACT_VERSION, API_MAJOR, ERROR_CODES, ERROR_STATUS } from "../../../../lib/api/v1/contract.ts";
import { ERRORS, IDEMPOTENCY_HEADER, OPERATIONS, PAGINATION } from "../../../../packages/ryntra-client/src/generated/contract.ts";
import { DEV_CREDENTIAL_KINDS, DEV_PLAN_FIELDS, DEV_QUOTA_WINDOWS, DEV_SCOPES, DEV_WEBHOOK_EVENTS } from "../../../../lib/core/developer/console.ts";
import { WEBHOOK_SIGNATURE_HEADER } from "../../../../lib/developer/webhooks.ts";

/**
 * What the Developers page says about the API, counted rather than typed.
 *
 * Every figure here is read from the module that owns it — the contract for its
 * own version and error codes, the generated client surface for the reads it
 * serves — because a number typed into a page is a second copy of a fact, and
 * second copies go stale quietly. The page renders these; `api-surface.test.mjs`
 * asserts the files and routes they name actually exist.
 *
 * Only facts live here: versions, counts, paths and identifiers. Prose stays in
 * the page, as a literal argument to the translation helper, because
 * `translateSolana` throws on a key it has no Ukrainian pair for — and a
 * sentence assembled in a data module
 * is a sentence the catalogue test cannot see — which is a 500 for Ukrainian
 * readers that is invisible in English.
 *
 * The rule the whole page is written to: name only what the router serves. A
 * «coming soon» row and a documented address that 404s are the same defect.
 */

export const CONTRACT = {
  version: API_CONTRACT_VERSION,
  major: API_MAJOR,
  /** The file the routes validate with — the source of everything below. */
  source: "lib/api/v1/contract.ts",
  document: "openapi/ryntra-api-v1.yaml",
  generator: "scripts/api/build-openapi-v1.mjs",
  examples: "docs/api/examples/v1",
  reference: "docs/api/CONTRACT-v1.md",
  openapi: "3.1",
  majorHeader: "X-Ryntra-API",
  versionHeader: "X-Ryntra-API-Version",
} as const;

export const CLIENT = {
  name: "@ryntra/client",
  source: "packages/ryntra-client",
  generator: "scripts/api/build-client-v1.mjs",
  example: "examples/ryntra-client-quickstart",
  /** Every read it serves: each one a GET the document serves without a bearer. */
  reads: Object.keys(OPERATIONS).length,
  methods: ["read", "pages", "collect"],
} as const;

/** The reads grouped the way the document tags them, so the page can show the shape of the surface. */
export function readsByTag(): readonly Readonly<{ tag: string; count: number }>[] {
  const counts = new Map<string, number>();
  for (const spec of Object.values(OPERATIONS)) {
    const tag = spec.tag ?? "Other";
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export const REFUSALS = {
  codes: ERROR_CODES.length,
  retryable: Object.values(ERRORS).filter((row) => row.retryable).length,
  statuses: [...new Set(ERROR_CODES.map((code) => ERROR_STATUS[code]))].sort((a, b) => a - b),
} as const;

export const PAGING = {
  parameter: PAGINATION.parameter,
  nextField: PAGINATION.nextField,
  /** The reads that page today. Counted, not claimed. */
  reads: Object.values(OPERATIONS)
    .filter((spec) => spec.paged)
    .map((spec) => spec.operationId),
} as const;

/**
 * The idempotency key, stated as it is rather than as it will be.
 *
 * The client sends the header on everything that is not a GET, the caller may
 * fix it so a retry repeats it, and no route reads it yet — the store that
 * would remember a key belongs with the developer console's API keys. The
 * consequence is drawn rather than hidden: a write is never retried
 * automatically, because until the server remembers the key, retrying a write
 * is writing twice.
 */
export const IDEMPOTENCY = {
  header: IDEMPOTENCY_HEADER,
  honoured: false,
} as const;

/**
 * The developer console (DEV-2), counted the same way: the kinds, the scopes and the windows come from the module
 * that owns them, and the signing scheme from the module that signs. A page that typed these would be a second list.
 */
export const CONSOLE = {
  path: "/app/developers",
  keyKinds: DEV_CREDENTIAL_KINDS.map((kind) => (kind === "SECRET" ? "rsk_… server only" : "rpk_… origin bound")),
  scopes: [...DEV_SCOPES],
  windows: [...DEV_QUOTA_WINDOWS],
  events: [...DEV_WEBHOOK_EVENTS],
  signedPayload: "{id}.{timestamp}.{body}",
  signatureHeader: WEBHOOK_SIGNATURE_HEADER,
  /** Named, with nothing filling them: a tariff's figures are set outside this build. */
  pricingFields: [...DEV_PLAN_FIELDS],
} as const;
