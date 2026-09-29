/**
 * Ryntra Agent Control Developer Kit v0.1.
 *
 * These exported types describe the versioned HTTP contract at compile time.
 * Every operation also validates its complete bounded response projection at
 * runtime before returning data; envelope-valid schema drift fails closed as
 * `INVALID_RESPONSE`.
 */

export type AgentControlJsonPrimitive = null | boolean | number | string;
export type AgentControlJsonValue =
  | AgentControlJsonPrimitive
  | AgentControlJsonValue[]
  | { [key: string]: AgentControlJsonValue };
export type AgentControlJsonObject = { [key: string]: AgentControlJsonValue };

export type AgentControlRequestOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type RyntraAgentControlClientOptions = Readonly<{
  baseUrl: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}>;

export type AgentControlSuccessEnvelope<T> = Readonly<{ data: T }>;

export type AgentControlApiErrorCode =
  | "BODY_REQUIRED"
  | "BODY_TOO_LARGE"
  | "INVALID_BODY_STREAM"
  | "INVALID_CONTENT_LENGTH"
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "JSON_REQUIRED"
  | "PREFLIGHT_REJECTED"
  | "RATE_LIMITED"
  | "REQUEST_ABORTED"
  | "UPSTREAM_FAILURE"
  | "VALIDATION_ERROR"
  | "UNKNOWN_API_ERROR";

export type AgentControlClientErrorCode =
  | "CALLER_ABORTED"
  | "INVALID_CONTENT_LENGTH"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_JSON"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "REQUEST_SERIALIZATION_FAILED"
  | "REQUEST_TIMEOUT"
  | "RESPONSE_TOO_LARGE";

export type AgentControlErrorEnvelope = Readonly<{
  error: Readonly<{
    code: AgentControlApiErrorCode;
    message: string;
  }>;
}>;

export class RyntraAgentControlError extends Error {
  readonly code: AgentControlApiErrorCode | AgentControlClientErrorCode;
  readonly status: number;
  readonly source: "API" | "CLIENT";

  constructor(
    message: string,
    options: Readonly<{
      code: AgentControlApiErrorCode | AgentControlClientErrorCode;
      status?: number;
      source: "API" | "CLIENT";
      cause?: unknown;
    }>,
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RyntraAgentControlError";
    this.code = options.code;
    this.status = options.status ?? 0;
    this.source = options.source;
  }
}

export type AgentActionKind =
  | "CREATE_JOB_DRAFT"
  | "FUND_JOB"
  | "SUBMIT_WORK"
  | "SETTLE_JOB"
  | "TRANSFER";

export type AgentActionIntent = Readonly<{
  schemaVersion: "1.0.0";
  id: string;
  source: Readonly<{
    kind: "ASI_ONE" | "AGENTVERSE" | "MCP" | "API" | "DEMO";
    agentId: string;
    agentName: string | null;
    requestId: string;
  }>;
  subjectRef: string;
  requestText: string;
  action: Readonly<{
    kind: AgentActionKind;
    provider: "BNB_APEX" | "AGENT_LAUNCH" | "DEMO";
    chainRef: string;
    jobType: string;
    deliverable: string;
    budget: Readonly<{ amount: string; assetRef: string }> | null;
    providerRef: string | null;
    evaluatorRef: string | null;
    deadline: string;
    expectedEffects: readonly string[];
  }>;
  policyRef: Readonly<{ id: string; version: number }>;
  evidenceRequirements: readonly string[];
  humanAuthorizationRequired: true;
  createdAt: string;
  expiresAt: string;
  revision: number;
  idempotencyKey: string;
}>;

export type AgentControlPolicy = Readonly<{
  schemaVersion: "1.0.0";
  id: string;
  version: number;
  publishedAt: string;
  immutable: true;
  allowedChains: readonly string[];
  allowedActions: readonly AgentActionKind[];
  maxBudget: Readonly<{ amount: string; assetRef: string }> | null;
  evidenceMaxAgeSeconds: number;
  requireHumanAuthorization: true;
  executionEnabled: false;
}>;

export type AgentControlEvidenceItem = Readonly<{
  schemaVersion: "1.0.0";
  id: string;
  provider: string;
  sourceRef: string;
  adapter: string;
  adapterVersion: string;
  sourceType: string;
  observedAt: string;
  receivedAt: string;
  validUntil: string;
  confidence: string;
  coverage: Readonly<{
    subjectRefs: readonly string[];
    fields: readonly string[];
    limitations: readonly string[];
  }>;
  availability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNSUPPORTED";
  verificationStatus:
    | "PROVIDER_REPORTED"
    | "DETERMINISTICALLY_DERIVED"
    | "ONCHAIN_VERIFIED"
    | "NOT_VERIFIED"
    | "CONFLICTING";
  chainRef: string | null;
  blockRef: string | null;
  transactionRef: string | null;
  status: "VALID" | "STALE" | "MISSING" | "CONFLICTING" | "UNAVAILABLE" | "UNSUPPORTED";
  requestHash: string;
  responseHash: string;
  responseDigest: string;
  reason: string | null;
  transformationVersion: string;
  fallbackUsed: boolean;
  facts: Readonly<Record<string, AgentControlJsonValue>>;
}>;

export type AgentControlPolicyResult = Readonly<{
  schemaVersion: "1.0.0";
  id: string;
  intentId: string;
  intentRevision: number;
  policyRef: Readonly<{ id: string; version: number }>;
  policyVersion: number;
  policyDigest: string;
  evidenceRoot: string;
  evidenceRefs: readonly string[];
  decision:
    | "ALLOWED_BY_POLICY"
    | "REVIEW_REQUIRED"
    | "BLOCKED_BY_RULE"
    | "INSUFFICIENT_EVIDENCE"
    | "UNSUPPORTED"
    | "EXPIRED";
  status: "PASS" | "WARN" | "BLOCK" | "NOT_EVALUATED";
  blockers: readonly string[];
  warnings: readonly string[];
  evaluatedAt: string;
}>;

export type AgentControlPreflightResult = Readonly<{
  intent: AgentActionIntent;
  evidence: readonly AgentControlEvidenceItem[];
  evidenceRoot: string;
  policy: AgentControlPolicy;
  policyResult: AgentControlPolicyResult;
}>;

export type ActionPassportPreview = Readonly<{
  schemaVersion: "1.0.0";
  kind: "ACTION_PASSPORT_PREVIEW";
  id: string;
  createdAt: string;
  maturity: "SOURCE_PREVIEW";
  intent: AgentActionIntent;
  intentHash: string;
  evidence: Readonly<{
    items: readonly AgentControlEvidenceItem[];
    root: string;
  }>;
  policy: Readonly<{
    definition: AgentControlPolicy;
    result: AgentControlPolicyResult;
  }>;
  authorization: Readonly<{
    status: "NOT_RECORDED" | "RECORDED_DEMO_ONLY";
    demoOnly: true;
    subjectRef: string | null;
    method: "LOCAL_DEMO_ACK" | null;
    intentHash: string | null;
    evidenceRoot: string | null;
    policyDigest: string | null;
    recordedAt: string | null;
  }>;
  execution: Readonly<{
    status: "UNAVAILABLE";
    reasonCode:
      | "SOURCE_PREVIEW_ONLY"
      | "NO_PROVIDER_SIGNER"
      | "NO_WALLET_AUTHORIZATION"
      | "EXTERNAL_CONTRACT_UNVERIFIED";
    jobId: null;
    transactionHash: null;
  }>;
  outcome: Readonly<{
    status: "OUTCOME_NOT_OBSERVED";
    observedEffects: readonly [];
    sourceRefs: readonly [];
  }>;
  limitations: readonly [string, string, string, string];
  passportHash: string;
  integrity: Readonly<{ algorithm: "SHA-256"; hash: string }>;
}>;

/**
 * What the unified Artifact Verifier returns.
 *
 * There is no top-level `valid`, deliberately: every merge of the three proof
 * axes destroys a distinction a reader needs. A valid unsigned artifact and a
 * tampered signed one would both read as false, and a signed artifact nobody
 * authorized would read the same as an authorized one.
 */
export type ArtifactVerification = Readonly<{
  recognised: boolean;
  generation: "v2" | "legacy-1.0.0" | null;
  kind: string | null;
  schemaVersion: string | null;
  integrity: Readonly<{ valid: boolean; issues: readonly string[] }>;
  issuer: Readonly<{
    verdict: "SIGNATURE_VALID" | "SIGNATURE_INVALID" | "UNSIGNED" | "UNTRUSTED_KEY";
    keyId: string | null;
    detail: string;
  }>;
  authorization: Readonly<{
    verdict: "AUTHORIZED" | "NOT_AUTHORIZED" | "DEMO_ACKNOWLEDGEMENT_ONLY" | "NOT_APPLICABLE";
    detail: string;
  }>;
  observation: Readonly<{
    verdict: "OBSERVED" | "NOT_OBSERVED" | "NOT_APPLICABLE";
    detail: string;
  }>;
}>;

export type AgentControlDemoSource = Readonly<{
  id: "erc-8183" | "bnb-apex" | "agent-launch" | "agentverse";
  label: string;
  url: string;
  status: "DRAFT_STANDARD_REFERENCE" | "PROVIDER_SOURCE_REFERENCE";
  limitation: string;
}>;

export type AgentControlDemoResult = Readonly<{
  mode: "SAMPLE_NOT_ONCHAIN";
  externalState: Readonly<{
    agentverseRegistration: "NOT_VERIFIED";
    agentLaunchTokenRead: "NOT_INCLUDED";
    bnbApexJob: "NOT_OBSERVED";
  }>;
  sources: readonly AgentControlDemoSource[];
  preflight: AgentControlPreflightResult;
  passport: ActionPassportPreview;
}>;

export type AgentControlPreflightRequest = Readonly<{
  intent: AgentActionIntent;
  recordDemoDecision?: boolean;
}>;

export type ArtifactVerificationRequest = Readonly<{
  artifact: unknown;
}>;

export type AgentPassportSourceAvailability =
  | "AVAILABLE"
  | "PARTIAL"
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "SCHEMA_DRIFT"
  | "NOT_REQUESTED";

export type AgentPassportSourceMember = Readonly<{
  id: string;
  url: string;
  observedAt: string;
  availability: "AVAILABLE" | "NOT_FOUND" | "UNAVAILABLE" | "SCHEMA_DRIFT";
  httpStatus: number | null;
  payloadDigest: string | null;
  reasonCode:
    | "NOT_FOUND"
    | "HTTP_ERROR"
    | "TIMEOUT"
    | "NETWORK_ERROR"
    | "RESPONSE_TOO_LARGE"
    | "INVALID_JSON"
    | "SCHEMA_DRIFT"
    | null;
  schemaDrift: readonly string[];
}>;

export type AgentPassportSource = Readonly<{
  id: "agentverse-registry" | "agentverse-search" | "agentverse-manifests";
  provider: "AGENTVERSE";
  kind: "REGISTRY" | "SEARCH" | "MANIFESTS";
  providerScope: "PROVIDER_GLOBAL";
  observedAt: string;
  availability: AgentPassportSourceAvailability;
  members: readonly AgentPassportSourceMember[];
  payloadDigest: string | null;
  reasonCode:
    | "PARTIAL_FAILURE"
    | "NO_PROTOCOL_DIGESTS"
    | "NOT_FOUND"
    | "HTTP_ERROR"
    | "TIMEOUT"
    | "NETWORK_ERROR"
    | "RESPONSE_TOO_LARGE"
    | "INVALID_JSON"
    | "SCHEMA_DRIFT"
    | null;
  schemaDrift: readonly string[];
}>;

export type AgentPassportFactField =
  | "address"
  | "name"
  | "description"
  | "readme"
  | "avatar_url"
  | "banner_url"
  | "status"
  | "agent_type"
  | "domain_name"
  | "expiry"
  | "prefix"
  | "handle"
  | "domain"
  | "category"
  | "created_at"
  | "last_updated"
  | "unresponsive"
  | "featured"
  | "metadata"
  | "system_wide_tags"
  | "geo_location"
  | "owner"
  | "starter_prompts"
  | "endpoints"
  | "protocols"
  | "total_interactions"
  | "recent_interactions"
  | "rating"
  | "recent_success_rate"
  | "recent_eval_success_rate"
  | "recent_verified_interactions"
  | "recent_success_verified_interactions"
  | "protocol_manifest_name"
  | "protocol_manifest_version"
  | "protocol_manifest_digest"
  | "protocol_manifest_description"
  | "protocol_manifest_models";

export type AgentPassportFact = Readonly<{
  id: string;
  field: AgentPassportFactField;
  value: string | number | boolean | readonly string[];
  sourceIds: readonly AgentPassportSource["id"][];
  declaration: "PROVIDER_DECLARED" | "PROVIDER_REPORTED_METRIC";
  limitation: string;
}>;

export type AgentPassportObservation = Readonly<{
  id: string;
  kind:
    | "SOURCE_AVAILABILITY"
    | "ADDRESS_MATCH"
    | "PROVIDER_SCOPE"
    | "DECLARED_ENDPOINT_FETCH"
    | "PROVIDER_METRIC_AUTHORITY"
    | "LIVENESS";
  sourceIds: readonly AgentPassportSource["id"][];
  value: string | boolean | number;
  detail: string;
}>;

export type AgentPassportConflict = Readonly<{
  id: string;
  field: AgentPassportFactField | "request_address";
  sourceIds: readonly AgentPassportSource["id"][];
  values: readonly string[];
  reason: string;
}>;

export type AgentPassportUnknown = Readonly<{
  id: string;
  field: string;
  sourceIds: readonly AgentPassportSource["id"][];
  reasonCode:
    | "SOURCE_NOT_FOUND"
    | "SOURCE_UNAVAILABLE"
    | "SOURCE_SCHEMA_DRIFT"
    | "FIELD_NOT_DECLARED"
    | "CONFLICTING_CLAIMS"
    | "PROVIDER_SCOPE_UNAVAILABLE";
  detail: string;
}>;

export type AgentPassport = Readonly<{
  schemaVersion: "1.0.0";
  kind: "AGENT_PASSPORT";
  id: string;
  createdAt: string;
  maturity: "SOURCE_PREVIEW";
  request: Readonly<{
    schemaVersion: "1.0.0";
    provider: "AGENTVERSE";
    address: string;
  }>;
  sources: readonly AgentPassportSource[];
  providerClaims: readonly AgentPassportFact[];
  ryntraObservations: readonly AgentPassportObservation[];
  conflicts: readonly AgentPassportConflict[];
  unknowns: readonly AgentPassportUnknown[];
  limitations: readonly [string, string, string, string];
  passportHash: string;
  integrity: Readonly<{ algorithm: "SHA-256"; hash: string }>;
}>;

export type AgentLaunchFieldConflict = Readonly<{
  field: "symbol" | "agentId";
  aliases: readonly string[];
  values: readonly string[];
}>;

export type AgentLaunchToken = Readonly<{
  address: string;
  name: string | null;
  symbol: string | null;
  agentId: string | null;
  payloadChainId: 97 | null;
  decimals: number | null;
  listed: boolean | null;
  status: boolean | string | null;
  schemaDrift: readonly string[];
  conflicts: readonly AgentLaunchFieldConflict[];
  raw: AgentControlJsonObject;
}>;

export type AgentLaunchTokenListResult = Readonly<{
  provider: "AGENT_LAUNCH";
  access: "PUBLIC_READ_ONLY_GET";
  endpoint: "TOKENS";
  chainId: 97;
  providerUrl: string;
  observedAt: string;
  controllerVariant:
    | "SUCCESS_DATA_ARRAY"
    | "SUCCESS_DATA_TOKENS"
    | "LEGACY_TOKENS_ROOT"
    | "RAW_ARRAY";
  state: "AVAILABLE" | "ZERO_STATE";
  tokens: readonly AgentLaunchToken[];
  schemaDrift: readonly string[];
  raw: AgentControlJsonValue;
}>;

export type AgentLaunchTokenDetailResult = Readonly<{
  provider: "AGENT_LAUNCH";
  access: "PUBLIC_READ_ONLY_GET";
  endpoint: "TOKEN_DETAIL";
  chainId: 97;
  providerUrl: string;
  observedAt: string;
  controllerVariant: "SUCCESS_DATA_RECORD" | "LEGACY_DATA_RECORD" | "RAW_RECORD";
  state: "AVAILABLE" | "NOT_FOUND";
  token: AgentLaunchToken | null;
  schemaDrift: readonly string[];
  raw: AgentControlJsonValue;
}>;

export type BnbApexCommerceJobEventName =
  | "BudgetSet"
  | "JobCompleted"
  | "JobCreated"
  | "JobExpired"
  | "JobFunded"
  | "JobRejected"
  | "JobSubmitted"
  | "PaymentReleased"
  | "ProviderSet"
  | "Refunded";

export type BnbApexRpcEvidence = Readonly<{
  method: "eth_chainId" | "eth_getCode" | "eth_call" | "eth_getTransactionReceipt";
  params: readonly AgentControlJsonValue[];
  response: AgentControlJsonObject;
}>;

export type BnbApexKnownJob = Readonly<{
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budgetBaseUnits: string;
  expiredAtUnix: string;
  statusCode: number;
  hook: string;
  submittedAtUnix: string;
  deliverable: string;
}>;

export type BnbApexObservationRequest = Readonly<{
  jobId: string;
  txHash: string;
}>;

export type BnbApexObservationResult = Readonly<{
  provider: "BNB_APEX";
  access: "KNOWN_TX_AND_JOB_READ_ONLY";
  chainId: 97;
  rpcUrl: string;
  observedAt: string;
  jobId: string;
  txHash: string;
  state: "NOT_FOUND" | "FAILED_TRANSACTION" | "OBSERVED";
  transaction: Readonly<{
    to: string;
    blockNumber: string;
    success: boolean;
    matchingCommerceEvents: readonly BnbApexCommerceJobEventName[];
  }> | null;
  job: BnbApexKnownJob | null;
  rpcEvidence: readonly BnbApexRpcEvidence[];
}>;

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 30_000;
const AGENT_CONTROL_REQUEST_MAX_DEPTH = 32;
const AGENT_CONTROL_REQUEST_MAX_NODES = 10_000;
const AGENT_CONTROL_REQUEST_MAX_STRING_LENGTH = 80_000;
const AGENT_CONTROL_REQUEST_MAX_KEY_LENGTH = 128;
const AGENT_CONTROL_REQUEST_MAX_BODY_BYTES = 96 * 1_024;
const BNB_APEX_REQUEST_MAX_BODY_BYTES = 1_024;
/**
 * The server-side Agent Launch adapter accepts at most 1 MiB from the provider,
 * then intentionally returns both the source payload and per-token normalized
 * raw records. A 3 MiB client boundary admits that bounded duplication plus the
 * success envelope while remaining a fixed, fail-closed transport limit.
 */
export const AGENT_CONTROL_SDK_MAX_RESPONSE_BYTES = 3_145_728 as const;
const AGENTVERSE_ADDRESS_SHAPE = /^agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$/;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT256_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const UINT256_MAX = (1n << 256n) - 1n;
const BNB_APEX_COMMERCE_ADDRESS = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const BNB_APEX_JOB_TARGETS: ReadonlySet<string> = new Set([
  BNB_APEX_COMMERCE_ADDRESS,
  "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
  "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
]);
const BNB_APEX_JOB_EVENT_BY_TOPIC: Readonly<Record<string, BnbApexCommerceJobEventName>> = {
  "0x869e2577b006bf47ee981cf6fec2e25583548081c14b98deab587f77b5068038": "BudgetSet",
  "0x0fd54bd364fa9e67f17b091aefe930932c09fe7651cf5ad02c71a418f3341444": "JobCompleted",
  "0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9": "JobCreated",
  "0x97237956f8810192811e2c3f273fd02c5d6295206fdd9c62e6fe2bfc19ba9232": "JobExpired",
  "0xbdb056de345bfeadca7c9fd7df6430bdb83c677c8eefbb601dff56f34d3dac52": "JobFunded",
  "0xae7362b1af91f4492868987b9c73990d780060811551b58728fbe96fd1bab275": "JobRejected",
  "0x80c17db79857f338a6a6df68a6883ecc0ce78e2202fe61ed979733573f40538e": "JobSubmitted",
  "0x21d71db5be59bb9fa133895586b7404307dd33fb93b16db09dc6f1d9d7d231b0": "PaymentReleased",
  "0x9a87df076ea1725aba8ba29d32517ce37c9597d88cbf16ec6707892cc330ab69": "ProviderSet",
  "0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4": "Refunded",
};

const API_ERROR_CODES: ReadonlySet<string> = new Set<AgentControlApiErrorCode>([
  "BODY_REQUIRED",
  "BODY_TOO_LARGE",
  "INVALID_BODY_STREAM",
  "INVALID_CONTENT_LENGTH",
  "INVALID_JSON",
  "INVALID_REQUEST",
  "JSON_REQUIRED",
  "PREFLIGHT_REJECTED",
  "RATE_LIMITED",
  "REQUEST_ABORTED",
  "UPSTREAM_FAILURE",
  "VALIDATION_ERROR",
]);

function clientError(
  code: AgentControlClientErrorCode,
  message: string,
  cause?: unknown,
): RyntraAgentControlError {
  return new RyntraAgentControlError(message, { code, source: "CLIENT", cause });
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Agent Control baseUrl must be an absolute URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new TypeError("Agent Control baseUrl must use HTTPS outside localhost.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new TypeError("Agent Control baseUrl must be a credential-free origin without a path, query, or fragment.");
  }
  return url.origin;
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`Agent Control timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
  }
  return timeoutMs;
}

export function isAgentverseAddress(value: unknown): value is string {
  if (typeof value !== "string" || !AGENTVERSE_ADDRESS_SHAPE.test(value)) return false;
  const separator = value.lastIndexOf("1");
  const hrp = value.slice(0, separator);
  const data = [...value.slice(separator + 1)].map((character) => BECH32_CHARSET.indexOf(character));
  if (separator < 1 || data.length < 6 || data.some((entry) => entry < 0)) return false;
  let checksum = 1;
  const values = [
    ...[...hrp].map((character) => character.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((character) => character.charCodeAt(0) & 31),
    ...data,
  ];
  for (const entry of values) {
    const high = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ entry;
    for (let index = 0; index < BECH32_GENERATORS.length; index += 1) {
      if ((high >>> index) & 1) checksum ^= BECH32_GENERATORS[index] as number;
    }
    checksum >>>= 0;
  }
  return checksum === 1;
}

function exactAgentverseAddress(value: string): string {
  if (!isAgentverseAddress(value)) {
    throw new TypeError("Agentverse address must have the exact Agentverse Bech32 shape and checksum.");
  }
  return value;
}

function exactEvmAddress(value: string): string {
  if (typeof value !== "string" || !EVM_ADDRESS.test(value)) {
    throw new TypeError("Agent Launch token address must be an exact EVM address.");
  }
  return value.toLowerCase();
}

function exactApexReference(value: BnbApexObservationRequest): BnbApexObservationRequest {
  if (
    !hasExactKeys(value, ["jobId", "txHash"])
    || typeof value.jobId !== "string"
    || value.jobId.length > 78
    || !UINT256_DECIMAL.test(value.jobId)
  ) {
    throw new TypeError("BNB APEX jobId must be a canonical unsigned decimal string.");
  }
  if (BigInt(value.jobId) > UINT256_MAX) throw new TypeError("BNB APEX jobId exceeds uint256.");
  if (typeof value.txHash !== "string" || !TRANSACTION_HASH.test(value.txHash)) {
    throw new TypeError("BNB APEX txHash must be an exact 32-byte hexadecimal transaction hash.");
  }
  return { jobId: value.jobId, txHash: value.txHash.toLowerCase() };
}

type PreparedRequestJson = Readonly<{ serialized: string; value: unknown }>;

function requestInputError(): RyntraAgentControlError {
  return clientError(
    "REQUEST_SERIALIZATION_FAILED",
    "Agent Control request input is outside the bounded operation contract.",
  );
}

function prototypeChainHasToJson(prototype: object | null): boolean {
  let current = prototype;
  while (current !== null) {
    if (Object.getOwnPropertyDescriptor(current, "toJSON") !== undefined) return true;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

function prepareBoundedRequestJson(value: unknown, maxBytes: number): PreparedRequestJson {
  try {
    let nodes = 0;

    const normalize = (entry: unknown, depth: number): AgentControlJsonValue => {
      nodes += 1;
      if (nodes > AGENT_CONTROL_REQUEST_MAX_NODES || depth > AGENT_CONTROL_REQUEST_MAX_DEPTH) {
        throw requestInputError();
      }
      if (entry === null || typeof entry === "boolean") return entry;
      if (typeof entry === "string") {
        if (entry.length > AGENT_CONTROL_REQUEST_MAX_STRING_LENGTH) throw requestInputError();
        return entry;
      }
      if (typeof entry === "number") {
        if (!Number.isFinite(entry)) throw requestInputError();
        return entry;
      }
      if (Array.isArray(entry)) {
        const prototype = Object.getPrototypeOf(entry) as object | null;
        if (prototype !== Array.prototype || prototypeChainHasToJson(prototype)) throw requestInputError();
        const lengthDescriptor = Object.getOwnPropertyDescriptor(entry, "length");
        if (
          !lengthDescriptor
          || !("value" in lengthDescriptor)
          || !Number.isInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0
        ) throw requestInputError();
        const length = lengthDescriptor.value as number;
        const ownKeys = Reflect.ownKeys(entry);
        if (
          ownKeys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))
          || ownKeys.length !== length + 1
        ) {
          throw requestInputError();
        }
        const normalized: AgentControlJsonValue[] = new Array(length);
        Object.defineProperty(normalized, "toJSON", { value: undefined });
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw requestInputError();
          normalized[index] = normalize(descriptor.value, depth + 1);
        }
        return normalized;
      }
      if (typeof entry !== "object") throw requestInputError();
      const prototype = Object.getPrototypeOf(entry) as object | null;
      if (
        (prototype !== Object.prototype && prototype !== null)
        || prototypeChainHasToJson(prototype)
      ) throw requestInputError();
      const normalized = Object.create(null) as AgentControlJsonObject;
      for (const key of Reflect.ownKeys(entry)) {
        if (typeof key !== "string" || key.length > AGENT_CONTROL_REQUEST_MAX_KEY_LENGTH) {
          throw requestInputError();
        }
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw requestInputError();
        normalized[key] = normalize(descriptor.value, depth + 1);
      }
      return normalized;
    };

    const normalized = normalize(value, 0);
    const serialized = JSON.stringify(normalized);
    if (serialized === undefined) throw new TypeError("JSON.stringify returned undefined.");
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) throw requestInputError();
    return { serialized, value: JSON.parse(serialized) as unknown };
  } catch (error) {
    if (error instanceof RyntraAgentControlError) throw error;
    throw clientError(
      "REQUEST_SERIALIZATION_FAILED",
      "Agent Control request input is outside the bounded operation contract.",
    );
  }
}

function exactPreflightBody(input: AgentControlPreflightRequest): Readonly<{
  body: string;
  input: AgentControlPreflightRequest;
}> {
  const prepared = prepareBoundedRequestJson(input, AGENT_CONTROL_REQUEST_MAX_BODY_BYTES);
  const value = prepared.value;
  const validKeys = hasExactKeys(value, ["intent"])
    || hasExactKeys(value, ["intent", "recordDemoDecision"]);
  if (
    !validKeys
    || !isAgentActionIntent(value.intent)
    || (Object.hasOwn(value, "recordDemoDecision") && typeof value.recordDemoDecision !== "boolean")
  ) {
    throw requestInputError();
  }
  const normalized: AgentControlPreflightRequest = {
    intent: value.intent,
    ...(Object.hasOwn(value, "recordDemoDecision")
      ? { recordDemoDecision: value.recordDemoDecision as boolean }
      : {}),
  };
  return {
    body: prepareBoundedRequestJson(normalized, AGENT_CONTROL_REQUEST_MAX_BODY_BYTES).serialized,
    input: normalized,
  };
}

function exactArtifactVerificationBody(artifact: unknown): string {
  const prepared = prepareBoundedRequestJson(
    { artifact } satisfies ArtifactVerificationRequest,
    AGENT_CONTROL_REQUEST_MAX_BODY_BYTES,
  );
  if (!hasExactKeys(prepared.value, ["artifact"])) throw requestInputError();
  return prepareBoundedRequestJson(
    { artifact: prepared.value.artifact } satisfies ArtifactVerificationRequest,
    AGENT_CONTROL_REQUEST_MAX_BODY_BYTES,
  ).serialized;
}

function exactBnbApexBody(reference: BnbApexObservationRequest): Readonly<{
  body: string;
  reference: BnbApexObservationRequest;
}> {
  const prepared = prepareBoundedRequestJson(reference, BNB_APEX_REQUEST_MAX_BODY_BYTES);
  const normalized = exactApexReference(prepared.value as BnbApexObservationRequest);
  return {
    body: prepareBoundedRequestJson(normalized, BNB_APEX_REQUEST_MAX_BODY_BYTES).serialized,
    reference: normalized,
  };
}

async function cancelUnreadBody(response: Response): Promise<void> {
  if (response.body === null) return;
  await response.body.cancel().catch(() => undefined);
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared)) {
      await cancelUnreadBody(response);
      throw clientError("INVALID_CONTENT_LENGTH", "Agent Control returned an invalid Content-Length.");
    }
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      await cancelUnreadBody(response);
      throw clientError("INVALID_CONTENT_LENGTH", "Agent Control returned an invalid Content-Length.");
    }
    if (length > AGENT_CONTROL_SDK_MAX_RESPONSE_BYTES) {
      await cancelUnreadBody(response);
      throw clientError("RESPONSE_TOO_LARGE", "Agent Control response exceeds the byte limit.");
    }
  }
  if (response.body === null) return "";

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    throw clientError("NETWORK_ERROR", "Agent Control response body could not be read.", error);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AGENT_CONTROL_SDK_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw clientError("RESPONSE_TOO_LARGE", "Agent Control response exceeds the byte limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RyntraAgentControlError) throw error;
    throw clientError("NETWORK_ERROR", "Agent Control response body could not be read.", error);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw clientError("INVALID_JSON", "Agent Control returned invalid UTF-8 JSON bytes.");
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw clientError("INVALID_JSON", "Agent Control returned invalid JSON.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readErrorEnvelope(value: unknown): AgentControlErrorEnvelope | null {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !isPlainObject(value.error)) return null;
  if (
    Object.keys(value.error).some((key) => key !== "code" && key !== "message")
    || typeof value.error.code !== "string"
    || typeof value.error.message !== "string"
  ) {
    return null;
  }
  if (
    value.error.code.length < 1
    || value.error.code.length > 64
    || !/^[A-Z][A-Z0-9_]*$/.test(value.error.code)
    || value.error.message.length < 1
    || value.error.message.length > 512
  ) {
    return null;
  }
  const known = API_ERROR_CODES.has(value.error.code);
  const code: AgentControlApiErrorCode = known
    ? value.error.code as AgentControlApiErrorCode
    : "UNKNOWN_API_ERROR";
  return {
    error: {
      code,
      message: known ? value.error.message : "Agent Control request failed.",
    },
  };
}

type RuntimeValidator<T> = (value: unknown) => value is T;

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isBoundedString(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= max;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > AGENT_CONTROL_REQUEST_MAX_STRING_LENGTH) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

function isHexHash(value: unknown): value is string {
  return typeof value === "string" && TRANSACTION_HASH.test(value);
}

function isNullableBoundedString(value: unknown, min: number, max: number): value is string | null {
  return value === null || isBoundedString(value, min, max);
}

function isArrayOf<T>(
  value: unknown,
  predicate: (entry: unknown) => entry is T,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): value is T[] {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= max
    && value.every((entry) => predicate(entry));
}

function isStringArray(value: unknown, min: number, max: number, stringMax: number): value is string[] {
  return isArrayOf(value, (entry): entry is string => isBoundedString(entry, 1, stringMax), min, max);
}

function isAgentControlJsonValue(value: unknown): value is AgentControlJsonValue {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > 100_000 || current.depth > 64) return false;
    const entry = current.value;
    if (entry === null || typeof entry === "boolean" || typeof entry === "string") continue;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) return false;
      continue;
    }
    if (Array.isArray(entry)) {
      for (const child of entry) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!isPlainObject(entry)) return false;
    for (const [key, child] of Object.entries(entry)) {
      if (key.length > 1_024) return false;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function isAgentControlJsonObject(value: unknown): value is AgentControlJsonObject {
  return isPlainObject(value) && isAgentControlJsonValue(value);
}

function sameJsonProjection(left: unknown, right: unknown): boolean {
  const stack: Array<readonly [unknown, unknown]> = [[left, right]];
  let nodes = 0;
  while (stack.length > 0) {
    const pair = stack.pop();
    if (!pair) break;
    nodes += 1;
    if (nodes > AGENT_CONTROL_REQUEST_MAX_NODES) return false;
    const [leftValue, rightValue] = pair;
    if (leftValue === rightValue) continue;
    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      if (!Array.isArray(leftValue) || !Array.isArray(rightValue) || leftValue.length !== rightValue.length) {
        return false;
      }
      for (let index = 0; index < leftValue.length; index += 1) {
        stack.push([leftValue[index], rightValue[index]]);
      }
      continue;
    }
    if (!isPlainObject(leftValue) || !isPlainObject(rightValue)) return false;
    const leftKeys = Object.keys(leftValue).sort();
    const rightKeys = Object.keys(rightValue).sort();
    if (
      leftKeys.length !== rightKeys.length
      || leftKeys.some((key, index) => key !== rightKeys[index])
    ) return false;
    for (const key of leftKeys) stack.push([leftValue[key], rightValue[key]]);
  }
  return true;
}

const ACTION_KINDS = [
  "CREATE_JOB_DRAFT",
  "FUND_JOB",
  "SUBMIT_WORK",
  "SETTLE_JOB",
  "TRANSFER",
] as const;
const SOURCE_KINDS = ["ASI_ONE", "AGENTVERSE", "MCP", "API", "DEMO"] as const;
const ACTION_PROVIDERS = ["BNB_APEX", "AGENT_LAUNCH", "DEMO"] as const;
const POLICY_DECISIONS = [
  "ALLOWED_BY_POLICY",
  "REVIEW_REQUIRED",
  "BLOCKED_BY_RULE",
  "INSUFFICIENT_EVIDENCE",
  "UNSUPPORTED",
  "EXPIRED",
] as const;
const POLICY_STATUSES = ["PASS", "WARN", "BLOCK", "NOT_EVALUATED"] as const;
const CAIP2 = /^[a-z0-9-]+:[A-Za-z0-9-]+$/;
const DECIMAL_STRING = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function isBudget(value: unknown): value is Readonly<{ amount: string; assetRef: string }> {
  return hasExactKeys(value, ["amount", "assetRef"])
    && isBoundedString(value.amount, 1, 128)
    && DECIMAL_STRING.test(value.amount)
    && isBoundedString(value.assetRef, 3, 256);
}

function isPolicyRef(value: unknown): value is Readonly<{ id: string; version: number }> {
  return hasExactKeys(value, ["id", "version"])
    && isBoundedString(value.id, 1, 128)
    && isPositiveInteger(value.version);
}

function isAgentActionIntent(value: unknown): value is AgentActionIntent {
  if (!hasExactKeys(value, [
    "schemaVersion",
    "id",
    "source",
    "subjectRef",
    "requestText",
    "action",
    "policyRef",
    "evidenceRequirements",
    "humanAuthorizationRequired",
    "createdAt",
    "expiresAt",
    "revision",
    "idempotencyKey",
  ])) return false;
  if (!hasExactKeys(value.source, ["kind", "agentId", "agentName", "requestId"])) return false;
  if (!hasExactKeys(value.action, [
    "kind",
    "provider",
    "chainRef",
    "jobType",
    "deliverable",
    "budget",
    "providerRef",
    "evaluatorRef",
    "deadline",
    "expectedEffects",
  ])) return false;
  const source = value.source;
  const action = value.action;
  if (
    value.schemaVersion !== "1.0.0"
    || !isBoundedString(value.id, 3, 128)
    || !isOneOf(source.kind, SOURCE_KINDS)
    || !isBoundedString(source.agentId, 1, 256)
    || !isNullableBoundedString(source.agentName, 1, 128)
    || !isBoundedString(source.requestId, 1, 256)
    || !isBoundedString(value.subjectRef, 1, 256)
    || !isBoundedString(value.requestText, 1, 2_000)
    || !isOneOf(action.kind, ACTION_KINDS)
    || !isOneOf(action.provider, ACTION_PROVIDERS)
    || !isBoundedString(action.chainRef, 1, 128)
    || !CAIP2.test(action.chainRef)
    || !isBoundedString(action.jobType, 1, 128)
    || !isBoundedString(action.deliverable, 1, 1_000)
    || (action.budget !== null && !isBudget(action.budget))
    || !isNullableBoundedString(action.providerRef, 1, 256)
    || !isNullableBoundedString(action.evaluatorRef, 1, 256)
    || !isTimestamp(action.deadline)
    || !isStringArray(action.expectedEffects, 1, 32, 512)
    || !isPolicyRef(value.policyRef)
    || !isStringArray(value.evidenceRequirements, 1, 32, 128)
    || value.humanAuthorizationRequired !== true
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.expiresAt)
    || !isPositiveInteger(value.revision)
    || !isBoundedString(value.idempotencyKey, 8, 256)
  ) return false;
  if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) return false;
  if (Date.parse(action.deadline) <= Date.parse(value.createdAt)) return false;
  if (Date.parse(action.deadline) > Date.parse(value.expiresAt)) return false;
  if (action.kind === "CREATE_JOB_DRAFT" && action.budget !== null) return false;
  if (action.kind === "FUND_JOB" && action.budget === null) return false;
  return true;
}

function isAgentControlPolicy(value: unknown): value is AgentControlPolicy {
  return hasExactKeys(value, [
    "schemaVersion",
    "id",
    "version",
    "publishedAt",
    "immutable",
    "allowedChains",
    "allowedActions",
    "maxBudget",
    "evidenceMaxAgeSeconds",
    "requireHumanAuthorization",
    "executionEnabled",
  ])
    && value.schemaVersion === "1.0.0"
    && isBoundedString(value.id, 1, 128)
    && isPositiveInteger(value.version)
    && isTimestamp(value.publishedAt)
    && value.immutable === true
    && isArrayOf(value.allowedChains, (entry): entry is string => (
      isBoundedString(entry, 1, 128) && CAIP2.test(entry)
    ), 1, 16)
    && isArrayOf(value.allowedActions, (entry): entry is AgentActionKind => isOneOf(entry, ACTION_KINDS), 1, 16)
    && (value.maxBudget === null || isBudget(value.maxBudget))
    && isPositiveInteger(value.evidenceMaxAgeSeconds, 86_400)
    && value.requireHumanAuthorization === true
    && value.executionEnabled === false;
}

function isEvidenceFactScalar(value: unknown): value is AgentControlJsonPrimitive {
  return value === null
    || typeof value === "boolean"
    || isFiniteNumber(value)
    || isBoundedString(value, 0, 4_096);
}

function isEvidenceFactObject(value: unknown): value is Record<string, AgentControlJsonPrimitive> {
  return isPlainObject(value) && Object.entries(value).every(([key, entry]) => (
    isBoundedString(key, 1, 128) && isEvidenceFactScalar(entry)
  ));
}

function isEvidenceFactValue(value: unknown): boolean {
  return isEvidenceFactScalar(value)
    || isEvidenceFactObject(value)
    || (Array.isArray(value)
      && value.length <= 128
      && value.every((entry) => isEvidenceFactScalar(entry) || isEvidenceFactObject(entry)));
}

function isEvidenceItem(value: unknown): value is AgentControlEvidenceItem {
  if (!hasExactKeys(value, [
    "schemaVersion",
    "id",
    "provider",
    "sourceRef",
    "adapter",
    "adapterVersion",
    "sourceType",
    "observedAt",
    "receivedAt",
    "validUntil",
    "confidence",
    "coverage",
    "availability",
    "verificationStatus",
    "chainRef",
    "blockRef",
    "transactionRef",
    "status",
    "requestHash",
    "responseHash",
    "responseDigest",
    "reason",
    "transformationVersion",
    "fallbackUsed",
    "facts",
  ])) return false;
  if (!hasExactKeys(value.coverage, ["subjectRefs", "fields", "limitations"])) return false;
  return value.schemaVersion === "1.0.0"
    && isBoundedString(value.id, 3, 128)
    && isBoundedString(value.provider, 1, 128)
    && isBoundedString(value.sourceRef, 1, 512)
    && isBoundedString(value.adapter, 1, 128)
    && isBoundedString(value.adapterVersion, 1, 128)
    && isBoundedString(value.sourceType, 1, 128)
    && isTimestamp(value.observedAt)
    && isTimestamp(value.receivedAt)
    && isTimestamp(value.validUntil)
    && isBoundedString(value.confidence, 1, 128)
    && isStringArray(value.coverage.subjectRefs, 1, 64, 256)
    && isStringArray(value.coverage.fields, 1, 128, 128)
    && isStringArray(value.coverage.limitations, 0, 64, 256)
    && isOneOf(value.availability, ["AVAILABLE", "PARTIAL", "UNAVAILABLE", "UNSUPPORTED"] as const)
    && isOneOf(value.verificationStatus, [
      "PROVIDER_REPORTED",
      "DETERMINISTICALLY_DERIVED",
      "ONCHAIN_VERIFIED",
      "NOT_VERIFIED",
      "CONFLICTING",
    ] as const)
    && (value.chainRef === null || (isBoundedString(value.chainRef, 1, 128) && CAIP2.test(value.chainRef)))
    && isNullableBoundedString(value.blockRef, 1, 256)
    && isNullableBoundedString(value.transactionRef, 1, 256)
    && isOneOf(value.status, ["VALID", "STALE", "MISSING", "CONFLICTING", "UNAVAILABLE", "UNSUPPORTED"] as const)
    && isHexHash(value.requestHash)
    && isHexHash(value.responseHash)
    && isHexHash(value.responseDigest)
    && isNullableBoundedString(value.reason, 1, 512)
    && isBoundedString(value.transformationVersion, 1, 128)
    && typeof value.fallbackUsed === "boolean"
    && isPlainObject(value.facts)
    && Object.entries(value.facts).every(([key, entry]) => (
      isBoundedString(key, 1, 128) && isEvidenceFactValue(entry)
    ));
}

function isAgentControlPolicyResult(value: unknown): value is AgentControlPolicyResult {
  return hasExactKeys(value, [
    "schemaVersion",
    "id",
    "intentId",
    "intentRevision",
    "policyRef",
    "policyVersion",
    "policyDigest",
    "evidenceRoot",
    "evidenceRefs",
    "decision",
    "status",
    "blockers",
    "warnings",
    "evaluatedAt",
  ])
    && value.schemaVersion === "1.0.0"
    && isBoundedString(value.id, 3, 128)
    && isBoundedString(value.intentId, 3, 128)
    && isPositiveInteger(value.intentRevision)
    && isPolicyRef(value.policyRef)
    && isPositiveInteger(value.policyVersion)
    && value.policyRef.version === value.policyVersion
    && isHexHash(value.policyDigest)
    && isHexHash(value.evidenceRoot)
    && isStringArray(value.evidenceRefs, 0, 256, 128)
    && isOneOf(value.decision, POLICY_DECISIONS)
    && isOneOf(value.status, POLICY_STATUSES)
    && isStringArray(value.blockers, 0, 128, 256)
    && isStringArray(value.warnings, 0, 128, 256)
    && isTimestamp(value.evaluatedAt);
}

function isAgentControlPreflightResult(value: unknown): value is AgentControlPreflightResult {
  if (
    !hasExactKeys(value, ["intent", "evidence", "evidenceRoot", "policy", "policyResult"])
    || !isAgentActionIntent(value.intent)
    || !isArrayOf(value.evidence, isEvidenceItem, 1, 16)
    || !isHexHash(value.evidenceRoot)
    || !isAgentControlPolicy(value.policy)
    || !isAgentControlPolicyResult(value.policyResult)
  ) return false;
  return value.policy.id === value.intent.policyRef.id
    && value.policy.version === value.intent.policyRef.version
    && value.policyResult.intentId === value.intent.id
    && value.policyResult.intentRevision === value.intent.revision
    && value.policyResult.policyRef.id === value.policy.id
    && value.policyResult.policyRef.version === value.policy.version
    && value.policyResult.policyDigest.length > 0
    && value.policyResult.evidenceRoot === value.evidenceRoot
    && sameJsonProjection(
      value.policyResult.evidenceRefs,
      value.evidence.map((item) => item.id),
    );
}

function isActionPassportPreview(value: unknown): value is ActionPassportPreview {
  if (!hasExactKeys(value, [
    "schemaVersion",
    "kind",
    "id",
    "createdAt",
    "maturity",
    "intent",
    "intentHash",
    "evidence",
    "policy",
    "authorization",
    "execution",
    "outcome",
    "limitations",
    "passportHash",
    "integrity",
  ])) return false;
  if (
    !hasExactKeys(value.evidence, ["items", "root"])
    || !hasExactKeys(value.policy, ["definition", "result"])
    || !hasExactKeys(value.authorization, [
      "status",
      "demoOnly",
      "subjectRef",
      "method",
      "intentHash",
      "evidenceRoot",
      "policyDigest",
      "recordedAt",
    ])
    || !hasExactKeys(value.execution, ["status", "reasonCode", "jobId", "transactionHash"])
    || !hasExactKeys(value.outcome, ["status", "observedEffects", "sourceRefs"])
    || !hasExactKeys(value.integrity, ["algorithm", "hash"])
  ) return false;
  const authorization = value.authorization;
  if (!(value.schemaVersion === "1.0.0"
    && value.kind === "ACTION_PASSPORT_PREVIEW"
    && isBoundedString(value.id, 3, 128)
    && isTimestamp(value.createdAt)
    && value.maturity === "SOURCE_PREVIEW"
    && isAgentActionIntent(value.intent)
    && isHexHash(value.intentHash)
    && isArrayOf(value.evidence.items, isEvidenceItem, 1, 16)
    && isHexHash(value.evidence.root)
    && isAgentControlPolicy(value.policy.definition)
    && isAgentControlPolicyResult(value.policy.result)
    && isOneOf(authorization.status, ["NOT_RECORDED", "RECORDED_DEMO_ONLY"] as const)
    && authorization.demoOnly === true
    && isNullableBoundedString(authorization.subjectRef, 1, 256)
    && (authorization.method === null || authorization.method === "LOCAL_DEMO_ACK")
    && (authorization.intentHash === null || isHexHash(authorization.intentHash))
    && (authorization.evidenceRoot === null || isHexHash(authorization.evidenceRoot))
    && (authorization.policyDigest === null || isHexHash(authorization.policyDigest))
    && (authorization.recordedAt === null || isTimestamp(authorization.recordedAt))
    && value.execution.status === "UNAVAILABLE"
    && isOneOf(value.execution.reasonCode, [
      "SOURCE_PREVIEW_ONLY",
      "NO_PROVIDER_SIGNER",
      "NO_WALLET_AUTHORIZATION",
      "EXTERNAL_CONTRACT_UNVERIFIED",
    ] as const)
    && value.execution.jobId === null
    && value.execution.transactionHash === null
    && value.outcome.status === "OUTCOME_NOT_OBSERVED"
    && Array.isArray(value.outcome.observedEffects)
    && value.outcome.observedEffects.length === 0
    && Array.isArray(value.outcome.sourceRefs)
    && value.outcome.sourceRefs.length === 0
    && isStringArray(value.limitations, 4, 4, 1_000)
    && isHexHash(value.passportHash)
    && value.integrity.algorithm === "SHA-256"
    && isHexHash(value.integrity.hash))) return false;
  const intent = value.intent;
  const policy = value.policy.definition;
  const result = value.policy.result;
  const evidenceIds = value.evidence.items.map((item) => item.id);
  if (
    result.intentId !== intent.id
    || result.intentRevision !== intent.revision
    || policy.id !== intent.policyRef.id
    || policy.version !== intent.policyRef.version
    || result.policyRef.id !== policy.id
    || result.policyRef.version !== policy.version
    || result.evidenceRoot !== value.evidence.root
    || !sameJsonProjection(result.evidenceRefs, evidenceIds)
  ) return false;
  if (authorization.status === "NOT_RECORDED") {
    return authorization.subjectRef === null
      && authorization.method === null
      && authorization.intentHash === null
      && authorization.evidenceRoot === null
      && authorization.policyDigest === null
      && authorization.recordedAt === null;
  }
  return authorization.subjectRef !== null
    && authorization.method === "LOCAL_DEMO_ACK"
    && authorization.intentHash === value.intentHash
    && authorization.evidenceRoot === value.evidence.root
    && authorization.policyDigest === result.policyDigest
    && authorization.recordedAt !== null;
}

function isAgentControlDemoSource(value: unknown): value is AgentControlDemoSource {
  return hasExactKeys(value, ["id", "label", "url", "status", "limitation"])
    && isOneOf(value.id, ["erc-8183", "bnb-apex", "agent-launch", "agentverse"] as const)
    && isBoundedString(value.label, 1, 128)
    && isBoundedString(value.url, 1, 512)
    && isOneOf(value.status, ["DRAFT_STANDARD_REFERENCE", "PROVIDER_SOURCE_REFERENCE"] as const)
    && isBoundedString(value.limitation, 1, 1_000);
}

function isAgentControlDemoResult(value: unknown): value is AgentControlDemoResult {
  if (!hasExactKeys(value, ["mode", "externalState", "sources", "preflight", "passport"])) return false;
  if (!hasExactKeys(value.externalState, [
    "agentverseRegistration",
    "agentLaunchTokenRead",
    "bnbApexJob",
  ])) return false;
  if (!(value.mode === "SAMPLE_NOT_ONCHAIN"
    && value.externalState.agentverseRegistration === "NOT_VERIFIED"
    && value.externalState.agentLaunchTokenRead === "NOT_INCLUDED"
    && value.externalState.bnbApexJob === "NOT_OBSERVED"
    && isArrayOf(value.sources, isAgentControlDemoSource, 1, 8)
    && isAgentControlPreflightResult(value.preflight)
    && isActionPassportPreview(value.passport))) return false;
  return sameJsonProjection(value.preflight.intent, value.passport.intent)
    && sameJsonProjection(value.preflight.evidence, value.passport.evidence.items)
    && value.preflight.evidenceRoot === value.passport.evidence.root
    && sameJsonProjection(value.preflight.policy, value.passport.policy.definition)
    && sameJsonProjection(value.preflight.policyResult, value.passport.policy.result);
}

const AGENT_PASSPORT_SOURCE_IDS = [
  "agentverse-registry",
  "agentverse-search",
  "agentverse-manifests",
] as const;
const AGENT_PASSPORT_FACT_FIELDS = [
  "address",
  "name",
  "description",
  "readme",
  "avatar_url",
  "banner_url",
  "status",
  "agent_type",
  "domain_name",
  "expiry",
  "prefix",
  "handle",
  "domain",
  "category",
  "created_at",
  "last_updated",
  "unresponsive",
  "featured",
  "metadata",
  "system_wide_tags",
  "geo_location",
  "owner",
  "starter_prompts",
  "endpoints",
  "protocols",
  "total_interactions",
  "recent_interactions",
  "rating",
  "recent_success_rate",
  "recent_eval_success_rate",
  "recent_verified_interactions",
  "recent_success_verified_interactions",
  "protocol_manifest_name",
  "protocol_manifest_version",
  "protocol_manifest_digest",
  "protocol_manifest_description",
  "protocol_manifest_models",
] as const;

function isAgentPassportSourceMember(value: unknown): value is AgentPassportSourceMember {
  return hasExactKeys(value, [
    "id",
    "url",
    "observedAt",
    "availability",
    "httpStatus",
    "payloadDigest",
    "reasonCode",
    "schemaDrift",
  ])
    && isBoundedString(value.id, 3, 96)
    && isBoundedString(value.url, 1, 512)
    && isTimestamp(value.observedAt)
    && isOneOf(value.availability, ["AVAILABLE", "NOT_FOUND", "UNAVAILABLE", "SCHEMA_DRIFT"] as const)
    && (value.httpStatus === null || (Number.isInteger(value.httpStatus) && (value.httpStatus as number) >= 100 && (value.httpStatus as number) <= 599))
    && (value.payloadDigest === null || isHexHash(value.payloadDigest))
    && (value.reasonCode === null || isOneOf(value.reasonCode, [
      "NOT_FOUND",
      "HTTP_ERROR",
      "TIMEOUT",
      "NETWORK_ERROR",
      "RESPONSE_TOO_LARGE",
      "INVALID_JSON",
      "SCHEMA_DRIFT",
    ] as const))
    && isStringArray(value.schemaDrift, 0, 16, 512);
}

function isAgentPassportSource(value: unknown): value is AgentPassportSource {
  return hasExactKeys(value, [
    "id",
    "provider",
    "kind",
    "providerScope",
    "observedAt",
    "availability",
    "members",
    "payloadDigest",
    "reasonCode",
    "schemaDrift",
  ])
    && isOneOf(value.id, AGENT_PASSPORT_SOURCE_IDS)
    && value.provider === "AGENTVERSE"
    && isOneOf(value.kind, ["REGISTRY", "SEARCH", "MANIFESTS"] as const)
    && value.providerScope === "PROVIDER_GLOBAL"
    && isTimestamp(value.observedAt)
    && isOneOf(value.availability, [
      "AVAILABLE",
      "PARTIAL",
      "NOT_FOUND",
      "UNAVAILABLE",
      "SCHEMA_DRIFT",
      "NOT_REQUESTED",
    ] as const)
    && isArrayOf(value.members, isAgentPassportSourceMember, 0, 6)
    && (value.payloadDigest === null || isHexHash(value.payloadDigest))
    && (value.reasonCode === null || isOneOf(value.reasonCode, [
      "PARTIAL_FAILURE",
      "NO_PROTOCOL_DIGESTS",
      "NOT_FOUND",
      "HTTP_ERROR",
      "TIMEOUT",
      "NETWORK_ERROR",
      "RESPONSE_TOO_LARGE",
      "INVALID_JSON",
      "SCHEMA_DRIFT",
    ] as const))
    && isStringArray(value.schemaDrift, 0, 48, 512);
}

function hasAgentverseSourceProvenance(
  source: AgentPassportSource,
  requestAddress: string,
): boolean {
  const expected = {
    REGISTRY: { id: "agentverse-registry", memberId: "registry" },
    SEARCH: { id: "agentverse-search", memberId: "search" },
    MANIFESTS: { id: "agentverse-manifests", memberId: null },
  } as const;
  const contract = expected[source.kind];
  if (source.id !== contract.id) return false;
  if (source.kind === "REGISTRY" || source.kind === "SEARCH") {
    if (source.members.length !== 1) return false;
  }
  if (new Set(source.members.map((member) => member.id)).size !== source.members.length) return false;
  return source.members.every((member) => {
    let url: URL;
    try {
      url = new URL(member.url);
    } catch {
      return false;
    }
    if (
      url.origin !== "https://agentverse.ai"
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return false;
    if (source.kind === "REGISTRY") {
      return member.id === contract.memberId
        && url.pathname === `/v2/almanac/resolve/${requestAddress}`;
    }
    if (source.kind === "SEARCH") {
      return member.id === contract.memberId
        && url.pathname === `/v1/search/agents/${requestAddress}`;
    }
    const match = /^\/v2\/almanac\/manifest\/([0-9a-f]{64})$/.exec(url.pathname);
    return match !== null && member.id === `manifest-${match[1]?.slice(0, 16)}`;
  });
}

function isAgentPassportFact(value: unknown): value is AgentPassportFact {
  return hasExactKeys(value, ["id", "field", "value", "sourceIds", "declaration", "limitation"])
    && isBoundedString(value.id, 3, 160)
    && isOneOf(value.field, AGENT_PASSPORT_FACT_FIELDS)
    && (
      isBoundedString(value.value, 0, 80_000)
      || isFiniteNumber(value.value)
      || typeof value.value === "boolean"
      || isArrayOf(value.value, (entry): entry is string => isBoundedString(entry, 0, 4_096), 0, 64)
    )
    && isArrayOf(value.sourceIds, (entry): entry is AgentPassportSource["id"] => isOneOf(entry, AGENT_PASSPORT_SOURCE_IDS), 1, 3)
    && isOneOf(value.declaration, ["PROVIDER_DECLARED", "PROVIDER_REPORTED_METRIC"] as const)
    && isBoundedString(value.limitation, 1, 512);
}

function isAgentPassportObservation(value: unknown): value is AgentPassportObservation {
  return hasExactKeys(value, ["id", "kind", "sourceIds", "value", "detail"])
    && isBoundedString(value.id, 3, 160)
    && isOneOf(value.kind, [
      "SOURCE_AVAILABILITY",
      "ADDRESS_MATCH",
      "PROVIDER_SCOPE",
      "DECLARED_ENDPOINT_FETCH",
      "PROVIDER_METRIC_AUTHORITY",
      "LIVENESS",
    ] as const)
    && isArrayOf(value.sourceIds, (entry): entry is AgentPassportSource["id"] => isOneOf(entry, AGENT_PASSPORT_SOURCE_IDS), 0, 3)
    && (isBoundedString(value.value, 0, 512) || typeof value.value === "boolean" || isFiniteNumber(value.value))
    && isBoundedString(value.detail, 1, 1_000);
}

function isAgentPassportConflict(value: unknown): value is AgentPassportConflict {
  return hasExactKeys(value, ["id", "field", "sourceIds", "values", "reason"])
    && isBoundedString(value.id, 3, 160)
    && (value.field === "request_address" || isOneOf(value.field, AGENT_PASSPORT_FACT_FIELDS))
    && isArrayOf(value.sourceIds, (entry): entry is AgentPassportSource["id"] => isOneOf(entry, AGENT_PASSPORT_SOURCE_IDS), 1, 3)
    && isStringArray(value.values, 2, 4, 600)
    && isBoundedString(value.reason, 1, 1_000);
}

function isAgentPassportUnknown(value: unknown): value is AgentPassportUnknown {
  return hasExactKeys(value, ["id", "field", "sourceIds", "reasonCode", "detail"])
    && isBoundedString(value.id, 3, 160)
    && isBoundedString(value.field, 1, 128)
    && isArrayOf(value.sourceIds, (entry): entry is AgentPassportSource["id"] => isOneOf(entry, AGENT_PASSPORT_SOURCE_IDS), 0, 3)
    && isOneOf(value.reasonCode, [
      "SOURCE_NOT_FOUND",
      "SOURCE_UNAVAILABLE",
      "SOURCE_SCHEMA_DRIFT",
      "FIELD_NOT_DECLARED",
      "CONFLICTING_CLAIMS",
      "PROVIDER_SCOPE_UNAVAILABLE",
    ] as const)
    && isBoundedString(value.detail, 1, 1_000);
}

/**
 * Browser-safe runtime guard for a stored Agent Passport document.
 *
 * The client already uses this exact guard at the API boundary. Exporting it
 * lets first-party surfaces re-validate tab-local JSON instead of growing a
 * second, weaker shape check. Cryptographic recomputation remains the
 * verifier's separate job; this guard proves the bounded document contract.
 */
export function isAgentPassport(value: unknown): value is AgentPassport {
  if (!hasExactKeys(value, [
    "schemaVersion",
    "kind",
    "id",
    "createdAt",
    "maturity",
    "request",
    "sources",
    "providerClaims",
    "ryntraObservations",
    "conflicts",
    "unknowns",
    "limitations",
    "passportHash",
    "integrity",
  ])) return false;
  if (!hasExactKeys(value.request, ["schemaVersion", "provider", "address"])) return false;
  if (!hasExactKeys(value.integrity, ["algorithm", "hash"])) return false;
  if (!(value.schemaVersion === "1.0.0"
    && value.kind === "AGENT_PASSPORT"
    && /^agent-passport_[0-9a-f]{16}$/.test(String(value.id))
    && isTimestamp(value.createdAt)
    && value.maturity === "SOURCE_PREVIEW"
    && value.request.schemaVersion === "1.0.0"
    && value.request.provider === "AGENTVERSE"
    && isAgentverseAddress(value.request.address)
    && isArrayOf(value.sources, isAgentPassportSource, 3, 3)
    && new Set(value.sources.map((source) => source.id)).size === 3
    && isArrayOf(value.providerClaims, isAgentPassportFact, 0, 128)
    && isArrayOf(value.ryntraObservations, isAgentPassportObservation, 1, 32)
    && isArrayOf(value.conflicts, isAgentPassportConflict, 0, 32)
    && isArrayOf(value.unknowns, isAgentPassportUnknown, 0, 32)
    && isStringArray(value.limitations, 4, 4, 1_000)
    && isHexHash(value.passportHash)
    && value.integrity.algorithm === "SHA-256"
    && isHexHash(value.integrity.hash))) return false;
  const requestAddress = (value.request as AgentPassport["request"]).address;
  return value.sources.every((source) => hasAgentverseSourceProvenance(source, requestAddress));
}

function isAgentPassportForAddress(value: unknown, address: string): value is AgentPassport {
  return isAgentPassport(value) && value.request.address === address;
}

function isAgentLaunchFieldConflict(value: unknown): value is AgentLaunchFieldConflict {
  return hasExactKeys(value, ["field", "aliases", "values"])
    && isOneOf(value.field, ["symbol", "agentId"] as const)
    && isStringArray(value.aliases, 1, 16, 128)
    && isStringArray(value.values, 1, 16, 512);
}

function isAgentLaunchToken(value: unknown): value is AgentLaunchToken {
  return hasExactKeys(value, [
    "address",
    "name",
    "symbol",
    "agentId",
    "payloadChainId",
    "decimals",
    "listed",
    "status",
    "schemaDrift",
    "conflicts",
    "raw",
  ])
    && typeof value.address === "string"
    && EVM_ADDRESS.test(value.address)
    && isNullableBoundedString(value.name, 0, 512)
    && isNullableBoundedString(value.symbol, 0, 128)
    && isNullableBoundedString(value.agentId, 0, 512)
    && (value.payloadChainId === 97 || value.payloadChainId === null)
    && (value.decimals === null || (Number.isInteger(value.decimals) && (value.decimals as number) >= 0 && (value.decimals as number) <= 255))
    && (value.listed === null || typeof value.listed === "boolean")
    && (value.status === null || typeof value.status === "boolean" || isBoundedString(value.status, 0, 512))
    && isStringArray(value.schemaDrift, 0, 128, 512)
    && isArrayOf(value.conflicts, isAgentLaunchFieldConflict, 0, 16)
    && isAgentControlJsonObject(value.raw);
}

function isAgentLaunchProviderUrl(value: unknown, endpoint: "TOKENS" | "TOKEN_DETAIL"): value is string {
  if (typeof value !== "string" || value.length > 1_024) return false;
  try {
    const url = new URL(value);
    if (
      url.origin !== "https://agent-launch.ai"
      || url.username
      || url.password
      || url.searchParams.get("chainId") !== "97"
    ) return false;
    if ([...url.searchParams.keys()].some((key) => key !== "chainId") || url.hash) return false;
    return endpoint === "TOKENS"
      ? url.pathname === "/api/agents/tokens"
      : /^\/api\/agents\/token\/0x[0-9a-fA-F]{40}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isAgentLaunchTokenListResult(value: unknown): value is AgentLaunchTokenListResult {
  return hasExactKeys(value, [
    "provider",
    "access",
    "endpoint",
    "chainId",
    "providerUrl",
    "observedAt",
    "controllerVariant",
    "state",
    "tokens",
    "schemaDrift",
    "raw",
  ])
    && value.provider === "AGENT_LAUNCH"
    && value.access === "PUBLIC_READ_ONLY_GET"
    && value.endpoint === "TOKENS"
    && value.chainId === 97
    && isAgentLaunchProviderUrl(value.providerUrl, "TOKENS")
    && isTimestamp(value.observedAt)
    && isOneOf(value.controllerVariant, [
      "SUCCESS_DATA_ARRAY",
      "SUCCESS_DATA_TOKENS",
      "LEGACY_TOKENS_ROOT",
      "RAW_ARRAY",
    ] as const)
    && isOneOf(value.state, ["AVAILABLE", "ZERO_STATE"] as const)
    && isArrayOf(value.tokens, isAgentLaunchToken, 0, 10_000)
    && ((value.state === "ZERO_STATE") === (value.tokens.length === 0))
    && isStringArray(value.schemaDrift, 0, 128, 512)
    && isAgentControlJsonValue(value.raw);
}

function isAgentLaunchTokenDetailResult(value: unknown): value is AgentLaunchTokenDetailResult {
  return hasExactKeys(value, [
    "provider",
    "access",
    "endpoint",
    "chainId",
    "providerUrl",
    "observedAt",
    "controllerVariant",
    "state",
    "token",
    "schemaDrift",
    "raw",
  ])
    && value.provider === "AGENT_LAUNCH"
    && value.access === "PUBLIC_READ_ONLY_GET"
    && value.endpoint === "TOKEN_DETAIL"
    && value.chainId === 97
    && isAgentLaunchProviderUrl(value.providerUrl, "TOKEN_DETAIL")
    && isTimestamp(value.observedAt)
    && isOneOf(value.controllerVariant, ["SUCCESS_DATA_RECORD", "LEGACY_DATA_RECORD", "RAW_RECORD"] as const)
    && isOneOf(value.state, ["AVAILABLE", "NOT_FOUND"] as const)
    && (value.token === null || isAgentLaunchToken(value.token))
    && (value.state === "NOT_FOUND" ? value.token === null : value.token !== null)
    && isStringArray(value.schemaDrift, 0, 128, 512)
    && isAgentControlJsonValue(value.raw);
}

function isAgentLaunchTokenDetailForAddress(
  value: unknown,
  address: string,
): value is AgentLaunchTokenDetailResult {
  if (!isAgentLaunchTokenDetailResult(value)) return false;
  let providerAddress: string;
  try {
    providerAddress = new URL(value.providerUrl).pathname.split("/").at(-1) ?? "";
  } catch {
    return false;
  }
  return providerAddress.toLowerCase() === address
    && (value.token === null || value.token.address.toLowerCase() === address);
}

function isBnbApexRpcEvidence(value: unknown): value is BnbApexRpcEvidence {
  return hasExactKeys(value, ["method", "params", "response"])
    && isOneOf(value.method, ["eth_chainId", "eth_getCode", "eth_call", "eth_getTransactionReceipt"] as const)
    && Array.isArray(value.params)
    && value.params.every(isAgentControlJsonValue)
    && isAgentControlJsonObject(value.response);
}

function isBnbApexKnownJob(value: unknown): value is BnbApexKnownJob {
  return hasExactKeys(value, [
    "id",
    "client",
    "provider",
    "evaluator",
    "description",
    "budgetBaseUnits",
    "expiredAtUnix",
    "statusCode",
    "hook",
    "submittedAtUnix",
    "deliverable",
  ])
    && isBoundedString(value.id, 1, 78)
    && UINT256_DECIMAL.test(value.id)
    && BigInt(value.id) <= UINT256_MAX
    && typeof value.client === "string"
    && EVM_ADDRESS.test(value.client)
    && typeof value.provider === "string"
    && EVM_ADDRESS.test(value.provider)
    && typeof value.evaluator === "string"
    && EVM_ADDRESS.test(value.evaluator)
    && isBoundedString(value.description, 1, 8_192)
    && value.description === value.description.trim()
    && isBoundedString(value.budgetBaseUnits, 1, 128)
    && UINT256_DECIMAL.test(value.budgetBaseUnits)
    && isBoundedString(value.expiredAtUnix, 1, 128)
    && UINT256_DECIMAL.test(value.expiredAtUnix)
    && Number.isInteger(value.statusCode)
    && (value.statusCode as number) >= 0
    && (value.statusCode as number) <= 255
    && typeof value.hook === "string"
    && EVM_ADDRESS.test(value.hook)
    && isBoundedString(value.submittedAtUnix, 1, 128)
    && UINT256_DECIMAL.test(value.submittedAtUnix)
    && isHexHash(value.deliverable);
}

function isBnbApexRpcUrl(value: unknown): value is string {
  return isOneOf(value, [
    "https://bsc-testnet-dataseed.bnbchain.org",
    "https://bsc-testnet.bnbchain.org",
    "https://bsc-prebsc-dataseed.bnbchain.org",
  ] as const);
}

function parseHexQuantity(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isRpcSuccessEvidence(
  value: BnbApexRpcEvidence,
  method: BnbApexRpcEvidence["method"],
  id: number,
): boolean {
  return value.method === method
    && value.response.jsonrpc === "2.0"
    && value.response.id === id
    && Object.hasOwn(value.response, "result")
    && !Object.hasOwn(value.response, "error");
}

function boundCommerceEvents(
  receipt: Record<string, unknown>,
  jobId: string,
): BnbApexCommerceJobEventName[] | null {
  if (!Array.isArray(receipt.logs)) return null;
  const expectedJobId = BigInt(jobId);
  const events: BnbApexCommerceJobEventName[] = [];
  for (const entry of receipt.logs) {
    if (!isPlainObject(entry) || typeof entry.address !== "string") continue;
    if (entry.address.toLowerCase() !== BNB_APEX_COMMERCE_ADDRESS) continue;
    if (!Array.isArray(entry.topics) || entry.topics.length < 2) continue;
    const [topic0, topic1] = entry.topics;
    if (!isHexHash(topic0) || !isHexHash(topic1)) continue;
    try {
      if (BigInt(topic1) !== expectedJobId) continue;
    } catch {
      continue;
    }
    const eventName = BNB_APEX_JOB_EVENT_BY_TOPIC[topic0.toLowerCase()];
    if (eventName) events.push(eventName);
  }
  return [...new Set(events)];
}

function readAbiWord(data: string, byteOffset: number): string | null {
  const start = 2 + byteOffset * 2;
  const word = data.slice(start, start + 64);
  return word.length === 64 ? word.toLowerCase() : null;
}

function readAbiUint(data: string, byteOffset: number): bigint | null {
  const word = readAbiWord(data, byteOffset);
  if (word === null) return null;
  try {
    return BigInt(`0x${word}`);
  } catch {
    return null;
  }
}

function readAbiAddress(data: string, byteOffset: number): string | null {
  const word = readAbiWord(data, byteOffset);
  if (word === null || !/^0{24}[0-9a-f]{40}$/.test(word)) return null;
  return `0x${word.slice(24)}`;
}

function decodeApexJobResult(value: unknown): BnbApexKnownJob | null {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) return null;
  const tupleOffset = readAbiUint(value, 0);
  if (tupleOffset !== 32n) return null;
  const tupleStart = Number(tupleOffset);
  const descriptionOffset = readAbiUint(value, tupleStart + 4 * 32);
  if (descriptionOffset !== 11n * 32n) return null;
  const descriptionStart = tupleStart + Number(descriptionOffset);
  const descriptionLength = readAbiUint(value, descriptionStart);
  if (descriptionLength === null || descriptionLength > 8_192n * 4n) return null;
  const descriptionBytes = Number(descriptionLength);
  const descriptionDataStart = 2 + (descriptionStart + 32) * 2;
  const paddedDescriptionBytes = Math.ceil(descriptionBytes / 32) * 32;
  if (value.length !== descriptionDataStart + paddedDescriptionBytes * 2) return null;
  const descriptionHex = value.slice(descriptionDataStart, descriptionDataStart + descriptionBytes * 2);
  const paddingHex = value.slice(descriptionDataStart + descriptionBytes * 2);
  if (!/^0*$/.test(paddingHex)) return null;
  let description: string;
  try {
    const bytes = new Uint8Array(descriptionBytes);
    for (let index = 0; index < descriptionBytes; index += 1) {
      bytes[index] = Number.parseInt(descriptionHex.slice(index * 2, index * 2 + 2), 16);
    }
    description = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    return null;
  }
  if (description.length < 1 || description.length > 8_192) return null;
  const id = readAbiUint(value, tupleStart);
  const client = readAbiAddress(value, tupleStart + 32);
  const provider = readAbiAddress(value, tupleStart + 2 * 32);
  const evaluator = readAbiAddress(value, tupleStart + 3 * 32);
  const budget = readAbiUint(value, tupleStart + 5 * 32);
  const expiredAt = readAbiUint(value, tupleStart + 6 * 32);
  const status = readAbiUint(value, tupleStart + 7 * 32);
  const hook = readAbiAddress(value, tupleStart + 8 * 32);
  const submittedAt = readAbiUint(value, tupleStart + 9 * 32);
  const deliverable = readAbiWord(value, tupleStart + 10 * 32);
  if (
    id === null
    || client === null
    || provider === null
    || evaluator === null
    || budget === null
    || expiredAt === null
    || status === null
    || status > 255n
    || hook === null
    || submittedAt === null
    || deliverable === null
  ) return null;
  return {
    id: id.toString(),
    client,
    provider,
    evaluator,
    description,
    budgetBaseUnits: budget.toString(),
    expiredAtUnix: expiredAt.toString(),
    statusCode: Number(status),
    hook,
    submittedAtUnix: submittedAt.toString(),
    deliverable: `0x${deliverable}`,
  };
}

function sameApexJob(left: BnbApexKnownJob | null, right: BnbApexKnownJob | null): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id
    && left.client.toLowerCase() === right.client.toLowerCase()
    && left.provider.toLowerCase() === right.provider.toLowerCase()
    && left.evaluator.toLowerCase() === right.evaluator.toLowerCase()
    && left.description === right.description
    && left.budgetBaseUnits === right.budgetBaseUnits
    && left.expiredAtUnix === right.expiredAtUnix
    && left.statusCode === right.statusCode
    && left.hook.toLowerCase() === right.hook.toLowerCase()
    && left.submittedAtUnix === right.submittedAtUnix
    && left.deliverable.toLowerCase() === right.deliverable.toLowerCase();
}

function isAuthoritativeBnbEvidence(
  evidence: readonly BnbApexRpcEvidence[],
  input: Readonly<{
    jobId: string;
    txHash: string;
    state: BnbApexObservationResult["state"];
    transaction: BnbApexObservationResult["transaction"];
    job: BnbApexObservationResult["job"];
  }>,
): boolean {
  const expectedLength = input.state === "OBSERVED" ? 3 : 2;
  if (evidence.length !== expectedLength) return false;
  const [chain, receipt, jobCall] = evidence;
  if (
    !chain
    || !receipt
    || !isRpcSuccessEvidence(chain, "eth_chainId", 1)
    || chain.params.length !== 0
    || parseHexQuantity(chain.response.result) !== 97n
    || !isRpcSuccessEvidence(receipt, "eth_getTransactionReceipt", 2)
    || !sameJsonProjection(receipt.params, [input.txHash])
  ) return false;

  const rawReceipt = receipt.response.result;
  if (input.state === "NOT_FOUND") return rawReceipt === null;
  if (input.transaction === null || !isPlainObject(rawReceipt)) return false;
  const receiptHash = rawReceipt.transactionHash;
  const receiptTo = rawReceipt.to;
  const receiptBlock = parseHexQuantity(rawReceipt.blockNumber);
  const receiptStatus = parseHexQuantity(rawReceipt.status);
  if (
    typeof receiptHash !== "string"
    || receiptHash.toLowerCase() !== input.txHash
    || typeof receiptTo !== "string"
    || receiptTo.toLowerCase() !== input.transaction.to.toLowerCase()
    || receiptBlock === null
    || receiptBlock.toString() !== input.transaction.blockNumber
    || receiptStatus === null
    || (receiptStatus === 1n) !== input.transaction.success
  ) return false;
  if (input.state === "FAILED_TRANSACTION") {
    return receiptStatus === 0n
      && jobCall === undefined
      && sameJsonProjection(
        boundCommerceEvents(rawReceipt, input.jobId),
        input.transaction.matchingCommerceEvents,
      );
  }

  if (
    receiptStatus !== 1n
    || !sameJsonProjection(
      boundCommerceEvents(rawReceipt, input.jobId),
      input.transaction.matchingCommerceEvents,
    )
    || !jobCall
    || !isRpcSuccessEvidence(jobCall, "eth_call", 3)
    || jobCall.params.length !== 2
    || jobCall.params[1] !== "latest"
    || !isPlainObject(jobCall.params[0])
    || !hasExactKeys(jobCall.params[0], ["to", "data"])
    || typeof jobCall.params[0].to !== "string"
    || jobCall.params[0].to.toLowerCase() !== BNB_APEX_COMMERCE_ADDRESS
    || typeof jobCall.params[0].data !== "string"
    || jobCall.params[0].data.toLowerCase() !== `0xbf22c457${BigInt(input.jobId).toString(16).padStart(64, "0")}`
    || !sameApexJob(decodeApexJobResult(jobCall.response.result), input.job)
  ) return false;
  return true;
}

function isBnbApexObservationResult(value: unknown): value is BnbApexObservationResult {
  if (!hasExactKeys(value, [
    "provider",
    "access",
    "chainId",
    "rpcUrl",
    "observedAt",
    "jobId",
    "txHash",
    "state",
    "transaction",
    "job",
    "rpcEvidence",
  ])) return false;
  const transactionValid = value.transaction === null || (
    hasExactKeys(value.transaction, ["to", "blockNumber", "success", "matchingCommerceEvents"])
    && typeof value.transaction.to === "string"
    && EVM_ADDRESS.test(value.transaction.to)
    && BNB_APEX_JOB_TARGETS.has(value.transaction.to.toLowerCase())
    && isBoundedString(value.transaction.blockNumber, 1, 128)
    && UINT256_DECIMAL.test(value.transaction.blockNumber)
    && typeof value.transaction.success === "boolean"
    && isArrayOf(value.transaction.matchingCommerceEvents, (entry): entry is BnbApexCommerceJobEventName => isOneOf(entry, [
      "BudgetSet",
      "JobCompleted",
      "JobCreated",
      "JobExpired",
      "JobFunded",
      "JobRejected",
      "JobSubmitted",
      "PaymentReleased",
      "ProviderSet",
      "Refunded",
    ] as const), 0, 64)
    && new Set(value.transaction.matchingCommerceEvents).size === value.transaction.matchingCommerceEvents.length
  );
  if (!(value.provider === "BNB_APEX"
    && value.access === "KNOWN_TX_AND_JOB_READ_ONLY"
    && value.chainId === 97
    && isBnbApexRpcUrl(value.rpcUrl)
    && isTimestamp(value.observedAt)
    && typeof value.jobId === "string"
    && value.jobId.length <= 78
    && UINT256_DECIMAL.test(value.jobId)
    && BigInt(value.jobId) <= UINT256_MAX
    && isHexHash(value.txHash)
    && isOneOf(value.state, ["NOT_FOUND", "FAILED_TRANSACTION", "OBSERVED"] as const)
    && transactionValid
    && (value.job === null || isBnbApexKnownJob(value.job))
    && isArrayOf(value.rpcEvidence, isBnbApexRpcEvidence, 2, 3))) return false;
  const transaction = value.transaction as BnbApexObservationResult["transaction"];
  const job = value.job as BnbApexObservationResult["job"];
  if (value.state === "NOT_FOUND") {
    if (transaction !== null || job !== null) return false;
  } else if (value.state === "FAILED_TRANSACTION") {
    if (transaction === null || transaction.success || job !== null) return false;
  } else if (
    transaction === null
    || !transaction.success
    || transaction.matchingCommerceEvents.length === 0
    || job === null
    || job.id !== value.jobId
  ) return false;
  return isAuthoritativeBnbEvidence(value.rpcEvidence, {
    jobId: value.jobId,
    txHash: value.txHash.toLowerCase(),
    state: value.state,
    transaction,
    job,
  });
}

function isBnbApexObservationForReference(
  value: unknown,
  reference: BnbApexObservationRequest,
): value is BnbApexObservationResult {
  return isBnbApexObservationResult(value)
    && value.jobId === reference.jobId
    && value.txHash.toLowerCase() === reference.txHash;
}

function isVerificationAxis(value: unknown, verdicts: readonly string[]): boolean {
  return isPlainObject(value)
    && typeof value.verdict === "string"
    && verdicts.includes(value.verdict)
    && typeof value.detail === "string"
    && value.detail.length > 0
    && value.detail.length <= 1_000;
}

function isArtifactVerification(value: unknown): value is ArtifactVerification {
  return hasExactKeys(value, [
    "recognised", "generation", "kind", "schemaVersion",
    "integrity", "issuer", "authorization", "observation",
  ])
    && typeof value.recognised === "boolean"
    && (value.generation === null || value.generation === "v2" || value.generation === "legacy-1.0.0")
    && (value.kind === null || typeof value.kind === "string")
    && (value.schemaVersion === null || typeof value.schemaVersion === "string")
    && isPlainObject(value.integrity)
    && typeof value.integrity.valid === "boolean"
    && isStringArray(value.integrity.issues, 0, 256, 1_000)
    && isPlainObject(value.issuer)
    && (value.issuer.keyId === null || typeof value.issuer.keyId === "string")
    && isVerificationAxis(value.issuer, ["SIGNATURE_VALID", "SIGNATURE_INVALID", "UNSIGNED", "UNTRUSTED_KEY"])
    && isVerificationAxis(value.authorization, ["AUTHORIZED", "NOT_AUTHORIZED", "DEMO_ACKNOWLEDGEMENT_ONLY", "NOT_APPLICABLE"])
    && isVerificationAxis(value.observation, ["OBSERVED", "NOT_OBSERVED", "NOT_APPLICABLE"]);
}

function readSuccessEnvelope<T>(
  value: unknown,
  validate: RuntimeValidator<T>,
): AgentControlSuccessEnvelope<T> {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !("data" in value)) {
    throw clientError("INVALID_RESPONSE", "Agent Control returned an invalid success envelope.");
  }
  if (!validate(value.data)) {
    throw clientError("INVALID_RESPONSE", "Agent Control returned data outside the operation contract.");
  }
  return { data: value.data };
}

export class RyntraAgentControlClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: RyntraAgentControlClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new TypeError("Agent Control requires a fetch implementation.");
    }
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
  }

  private async request<T>(
    path: string,
    validate: RuntimeValidator<T>,
    init: Readonly<{
      method?: "GET" | "POST";
      body?: string;
      options?: AgentControlRequestOptions;
    }> = {},
  ): Promise<T> {
    const callerSignal = init.options?.signal;
    if (callerSignal?.aborted) {
      throw clientError("CALLER_ABORTED", "Agent Control request was cancelled by the caller.");
    }

    const controller = new AbortController();
    let abortKind: "CALLER" | "TIMEOUT" | null = null;
    let rejectBoundary: ((error: RyntraAgentControlError) => void) | undefined;
    const boundary = new Promise<never>((_resolve, reject) => {
      rejectBoundary = reject;
    });
    const abort = (kind: "CALLER" | "TIMEOUT") => {
      if (abortKind !== null) return;
      abortKind = kind;
      rejectBoundary?.(
        kind === "CALLER"
          ? clientError("CALLER_ABORTED", "Agent Control request was cancelled by the caller.")
          : clientError("REQUEST_TIMEOUT", "Agent Control request exceeded its bounded timeout."),
      );
      controller.abort();
    };
    const onCallerAbort = () => abort("CALLER");
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => abort("TIMEOUT"), this.timeoutMs);

    const operation = async (): Promise<T> => {
      const method = init.method ?? "GET";
      const headers: Record<string, string> = {
        accept: "application/json",
      };
      if (method === "POST") headers["content-type"] = "application/json";

      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: init.body,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof RyntraAgentControlError) throw error;
        if (abortKind === "CALLER") {
          throw clientError("CALLER_ABORTED", "Agent Control request was cancelled by the caller.", error);
        }
        if (abortKind === "TIMEOUT") {
          throw clientError("REQUEST_TIMEOUT", "Agent Control request exceeded its bounded timeout.", error);
        }
        throw clientError("NETWORK_ERROR", "Agent Control request failed within its network boundary.", error);
      }

      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
        await cancelUnreadBody(response);
        throw clientError("INVALID_CONTENT_TYPE", "Agent Control response must use a JSON content type.");
      }
      const payload = parseJson(await readBoundedResponse(response));
      if (!response.ok) {
        const envelope = readErrorEnvelope(payload);
        if (envelope === null) {
          throw clientError("INVALID_RESPONSE", "Agent Control returned an invalid error envelope.");
        }
        throw new RyntraAgentControlError(envelope.error.message, {
          code: envelope.error.code,
          status: response.status,
          source: "API",
        });
      }
      if (response.status !== 200) {
        throw clientError("INVALID_RESPONSE", "Agent Control success responses must use HTTP 200.");
      }
      return readSuccessEnvelope(payload, validate).data;
    };

    try {
      return await Promise.race([operation(), boundary]);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  readonly demo = (options?: AgentControlRequestOptions): Promise<AgentControlDemoResult> =>
    this.request<AgentControlDemoResult>("/api/agents/demo", isAgentControlDemoResult, { options });

  readonly agentPassport = (
    address: string,
    options?: AgentControlRequestOptions,
  ): Promise<AgentPassport> => {
    const requestedAddress = exactAgentverseAddress(address);
    const search = new URLSearchParams({ address: requestedAddress });
    return this.request<AgentPassport>(
      `/api/agents/passport?${search}`,
      (value): value is AgentPassport => isAgentPassportForAddress(value, requestedAddress),
      { options },
    );
  };

  readonly preflight = (
    input: AgentControlPreflightRequest,
    options?: AgentControlRequestOptions,
  ): Promise<AgentControlDemoResult> => {
    const prepared = exactPreflightBody(input);
    return this.request<AgentControlDemoResult>("/api/agents/preflight", (value): value is AgentControlDemoResult => (
      isAgentControlDemoResult(value)
      && sameJsonProjection(value.preflight.intent, prepared.input.intent)
      && sameJsonProjection(value.passport.intent, prepared.input.intent)
      && value.passport.authorization.status === (
        prepared.input.recordDemoDecision === true ? "RECORDED_DEMO_ONLY" : "NOT_RECORDED"
      )
    ), {
      method: "POST",
      body: prepared.body,
      options,
    });
  };

  readonly verifyArtifact = (
    artifact: unknown,
    options?: AgentControlRequestOptions,
  ): Promise<ArtifactVerification> =>
    this.request<ArtifactVerification>("/api/agents/verify", isArtifactVerification, {
      method: "POST",
      body: exactArtifactVerificationBody(artifact),
      options,
    });

  readonly agentLaunchTokens = (
    options?: AgentControlRequestOptions,
  ): Promise<AgentLaunchTokenListResult> =>
    this.request<AgentLaunchTokenListResult>(
      "/api/agents/agent-launch/tokens",
      isAgentLaunchTokenListResult,
      { options },
    );

  readonly agentLaunchToken = (
    address: string,
    options?: AgentControlRequestOptions,
  ): Promise<AgentLaunchTokenDetailResult> => {
    const requestedAddress = exactEvmAddress(address);
    return this.request<AgentLaunchTokenDetailResult>(
      `/api/agents/agent-launch/tokens/${encodeURIComponent(requestedAddress)}`,
      (value): value is AgentLaunchTokenDetailResult => (
        isAgentLaunchTokenDetailForAddress(value, requestedAddress)
      ),
      { options },
    );
  };

  readonly observeBnbApex = (
    reference: BnbApexObservationRequest,
    options?: AgentControlRequestOptions,
  ): Promise<BnbApexObservationResult> => {
    const prepared = exactBnbApexBody(reference);
    return this.request<BnbApexObservationResult>("/api/agents/bnb-apex/observe", (value): value is BnbApexObservationResult => (
      isBnbApexObservationForReference(value, prepared.reference)
    ), {
      method: "POST",
      body: prepared.body,
      options,
    });
  };
}
