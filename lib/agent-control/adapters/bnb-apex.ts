import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

const APEX_MAX_RPC_RESPONSE_BYTES = 1_048_576;
const APEX_DEFAULT_TIMEOUT_MS = 10_000;
const APEX_MAX_TIMEOUT_MS = 20_000;
const APEX_MAX_JSON_DEPTH = 32;
const APEX_MAX_JSON_NODES = 20_000;

export const BNB_APEX_BSC_TESTNET_CHAIN_ID = 97 as const;
export const BNB_APEX_BSC_TESTNET_CHAIN_ID_HEX = "0x61" as const;

export const BNB_APEX_OFFICIAL_RPC_URLS = [
  "https://bsc-testnet-dataseed.bnbchain.org",
  "https://bsc-testnet.bnbchain.org",
  "https://bsc-prebsc-dataseed.bnbchain.org",
] as const;

export const BNB_APEX_OFFICIAL_SOURCES = {
  repository: "https://github.com/bnb-chain/apex-contracts",
  addressRegistry:
    "https://raw.githubusercontent.com/bnb-chain/apex-contracts/main/scripts/addresses.ts",
  readme: "https://github.com/bnb-chain/apex-contracts#deployments",
  commerceAbi:
    "https://raw.githubusercontent.com/bnb-chain/apex-contracts/main/abis/AgenticCommerceUpgradeable.json",
  routerAbi:
    "https://raw.githubusercontent.com/bnb-chain/apex-contracts/main/abis/EvaluatorRouterUpgradeable.json",
  policyAbi:
    "https://raw.githubusercontent.com/bnb-chain/apex-contracts/main/abis/OptimisticPolicy.json",
} as const;

/** `scripts/addresses.ts` is authoritative when its README mirror drifts. */
export const BNB_APEX_BSC_TESTNET_DEPLOYMENT = {
  paymentToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
  commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
  router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
  policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
} as const;

/** Kept only to surface provider-controlled documentation drift, never as an allowlist entry. */
export const BNB_APEX_README_MIRROR = {
  paymentAssetLabel: "USDC on testnet",
  paymentAssetSymbol: "USDC",
  policy: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6",
} as const;

export const BNB_APEX_REGISTRY_PAYMENT_ASSET_LABEL = "e.g. U on BSC Testnet" as const;

export const BNB_APEX_READ_RPC_METHODS = [
  "eth_chainId",
  "eth_getCode",
  "eth_call",
  "eth_getTransactionReceipt",
] as const;

type ApexReadRpcMethod = (typeof BNB_APEX_READ_RPC_METHODS)[number];

export type ApexJsonValue =
  | null
  | boolean
  | number
  | string
  | ApexJsonValue[]
  | { [key: string]: ApexJsonValue };

type ApexJsonObject = { [key: string]: ApexJsonValue };

export const BNB_APEX_READ_ABIS = {
  commerce: [
    {
      type: "function",
      name: "paymentToken",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "address" }],
    },
    {
      type: "function",
      name: "getJob",
      stateMutability: "view",
      inputs: [{ name: "jobId", type: "uint256" }],
      outputs: [
        {
          name: "",
          type: "tuple",
          components: [
            { name: "id", type: "uint256" },
            { name: "client", type: "address" },
            { name: "provider", type: "address" },
            { name: "evaluator", type: "address" },
            { name: "description", type: "string" },
            { name: "budget", type: "uint256" },
            { name: "expiredAt", type: "uint256" },
            { name: "status", type: "uint8" },
            { name: "hook", type: "address" },
            { name: "submittedAt", type: "uint256" },
            { name: "deliverable", type: "bytes32" },
          ],
        },
      ],
    },
  ],
  router: [
    {
      type: "function",
      name: "commerce",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "address" }],
    },
  ],
  erc20Metadata: [
    {
      type: "function",
      name: "name",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "string" }],
    },
    {
      type: "function",
      name: "symbol",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "string" }],
    },
    {
      type: "function",
      name: "decimals",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint8" }],
    },
  ],
} as const;

const COMMERCE_JOB_EVENT_SIGNATURES = {
  BudgetSet: "BudgetSet(uint256,uint256)",
  JobCompleted: "JobCompleted(uint256,address,bytes32)",
  JobCreated: "JobCreated(uint256,address,address,address,uint256,address)",
  JobExpired: "JobExpired(uint256)",
  JobFunded: "JobFunded(uint256,address,address,uint256)",
  JobRejected: "JobRejected(uint256,address,bytes32)",
  JobSubmitted: "JobSubmitted(uint256,address,bytes32)",
  PaymentReleased: "PaymentReleased(uint256,address,uint256)",
  ProviderSet: "ProviderSet(uint256,address)",
  Refunded: "Refunded(uint256,address,uint256)",
} as const;

export type ApexCommerceJobEventName = keyof typeof COMMERCE_JOB_EVENT_SIGNATURES;

export const BNB_APEX_COMMERCE_JOB_EVENT_TOPICS = Object.freeze(
  Object.fromEntries(
    Object.entries(COMMERCE_JOB_EVENT_SIGNATURES).map(([name, signature]) => [
      keccak256(stringToHex(signature)),
      name,
    ]),
  ) as Record<Hex, ApexCommerceJobEventName>,
);

const ALLOWLISTED_ADDRESSES = new Set(
  Object.values(BNB_APEX_BSC_TESTNET_DEPLOYMENT).map((address) => address.toLowerCase()),
);

const ALLOWLISTED_JOB_TRANSACTION_TARGETS = new Set(
  [
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.router,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.policy,
  ].map((address) => address.toLowerCase()),
);

export type ApexRpcEvidence = {
  method: ApexReadRpcMethod;
  params: ApexJsonValue[];
  response: ApexJsonObject;
};

export type ApexProviderDrift =
  | {
      kind: "README_POLICY_MIRROR_MISMATCH";
      authoritativeValue: string;
      mirrorValue: string;
      authoritativeSourceUrl: string;
      mirrorSourceUrl: string;
    }
  | {
      kind: "README_PAYMENT_ASSET_LABEL_CONFLICT";
      providerValue: string;
      onchainValue: string;
      field: "symbol";
      sourceUrl: string;
    };

export type ApexDeploymentNormalizationInput = {
  chainId: unknown;
  codeByAddress: Readonly<Record<string, unknown>>;
  commercePaymentToken: unknown;
  routerCommerce: unknown;
  paymentAssetMetadata: {
    name: unknown;
    symbol: unknown;
    decimals: unknown;
  };
};

export type ApexDeploymentNormalization = {
  state: "OBSERVED" | "OBSERVED_WITH_PROVIDER_DRIFT";
  chainId: 97;
  addresses: typeof BNB_APEX_BSC_TESTNET_DEPLOYMENT;
  contractCodePresent: {
    paymentToken: true;
    commerce: true;
    router: true;
    policy: true;
  };
  links: {
    commercePaymentToken: string;
    routerCommerce: string;
  };
  paymentAsset: {
    address: string;
    onchain: { name: string; symbol: string; decimals: number };
    registryLabel: typeof BNB_APEX_REGISTRY_PAYMENT_ASSET_LABEL;
    readmeLabel: typeof BNB_APEX_README_MIRROR.paymentAssetLabel;
  };
  providerDrift: ApexProviderDrift[];
};

export type ApexDeploymentObservation = ApexDeploymentNormalization & {
  provider: "BNB_APEX";
  access: "PUBLIC_READ_ONLY_RPC";
  rpcUrl: string;
  observedAt: string;
  sourceUrls: typeof BNB_APEX_OFFICIAL_SOURCES;
  rpcEvidence: ApexRpcEvidence[];
};

export type NormalizedApexJob = {
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
};

export type ApexKnownJobObservation = {
  provider: "BNB_APEX";
  access: "KNOWN_TX_AND_JOB_READ_ONLY";
  chainId: 97;
  rpcUrl: string;
  observedAt: string;
  jobId: string;
  txHash: string;
  state: "NOT_FOUND" | "FAILED_TRANSACTION" | "OBSERVED";
  transaction: null | {
    to: string;
    blockNumber: string;
    success: boolean;
    matchingCommerceEvents: ApexCommerceJobEventName[];
  };
  job: NormalizedApexJob | null;
  rpcEvidence: ApexRpcEvidence[];
};

export type ApexKnownJobReference = {
  jobId: bigint | number | string;
  txHash: string;
};

export type BnbApexReadDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  rpcUrl?: string;
  timeoutMs?: number;
};

export class BnbApexAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BnbApexAdapterError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BnbApexAdapterError(code, message);
}

function hasOwn(record: ApexJsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertJsonValue(value: unknown): asserts value is ApexJsonValue {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > APEX_MAX_JSON_NODES) fail("APEX_JSON_TOO_LARGE", "APEX JSON exceeds its node limit.");
    if (depth > APEX_MAX_JSON_DEPTH) fail("APEX_JSON_TOO_DEEP", "APEX JSON exceeds its depth limit.");
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) fail("APEX_JSON_INVALID", "APEX JSON contains a non-finite number.");
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (typeof candidate === "object") {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        fail("APEX_JSON_INVALID", "APEX payload must contain plain JSON objects.");
      }
      for (const item of Object.values(candidate)) visit(item, depth + 1);
      return;
    }
    fail("APEX_JSON_INVALID", "APEX response is not JSON-compatible.");
  };
  visit(value, 0);
}

function asObject(value: ApexJsonValue, context: string): ApexJsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return fail("APEX_SCHEMA_INVALID", `${context} must be a JSON object.`);
  }
  return value;
}

function normalizeAddress(value: unknown, context: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return fail("APEX_ADDRESS_INVALID", `${context} must be a 20-byte EVM address.`);
  }
  try {
    return getAddress(value);
  } catch (error) {
    throw new BnbApexAdapterError("APEX_ADDRESS_INVALID", `${context} has an invalid checksum.`, {
      cause: error,
    });
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function normalizeHexData(value: unknown, context: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    return fail("APEX_HEX_INVALID", `${context} must be even-length hex data.`);
  }
  return value as Hex;
}

function normalizeHash(value: unknown, context: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return fail("APEX_HASH_INVALID", `${context} must be a 32-byte hash.`);
  }
  return value.toLowerCase() as Hex;
}

function normalizeQuantity(value: unknown, context: string): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    return fail("APEX_QUANTITY_INVALID", `${context} must be canonical hex quantity data.`);
  }
  return BigInt(value);
}

function normalizeJobId(value: bigint | number | string): bigint {
  let jobId: bigint;
  if (typeof value === "bigint") {
    jobId = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return fail("APEX_JOB_ID_INVALID", "APEX jobId number is not safe.");
    jobId = BigInt(value);
  } else if (/^(0|[1-9][0-9]*)$/.test(value)) {
    jobId = BigInt(value);
  } else {
    return fail("APEX_JOB_ID_INVALID", "APEX jobId must be a non-negative decimal integer.");
  }
  if (jobId < 0n || jobId >= 2n ** 256n) {
    fail("APEX_JOB_ID_INVALID", "APEX jobId is outside uint256 range.");
  }
  return jobId;
}

function readTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? APEX_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > APEX_MAX_TIMEOUT_MS) {
    fail("APEX_TIMEOUT_INVALID", `APEX timeout must be between 1 and ${APEX_MAX_TIMEOUT_MS} milliseconds.`);
  }
  return timeoutMs;
}

function readRpcUrl(value: string | undefined): string {
  const rpcUrl = value ?? BNB_APEX_OFFICIAL_RPC_URLS[0];
  if (!(BNB_APEX_OFFICIAL_RPC_URLS as readonly string[]).includes(rpcUrl)) {
    fail("APEX_RPC_URL_REJECTED", "APEX RPC URL is not in the official BSC testnet allowlist.");
  }
  return rpcUrl;
}

function readObservedAt(now: (() => Date) | undefined): string {
  const date = (now ?? (() => new Date()))();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    fail("APEX_CLOCK_INVALID", "APEX observation clock returned an invalid date.");
  }
  return date.toISOString();
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null || response.body.locked) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best-effort; the bounded adapter error remains authoritative.
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      await cancelResponseBody(response);
      fail("APEX_RPC_HTTP_INVALID", "APEX RPC returned an invalid Content-Length.");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      await cancelResponseBody(response);
      fail("APEX_RPC_HTTP_INVALID", "APEX RPC returned an invalid Content-Length.");
    }
    if (declaredBytes > APEX_MAX_RPC_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      fail("APEX_RPC_RESPONSE_TOO_LARGE", "APEX RPC response exceeds the byte limit.");
    }
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let result = "";
  let cancelled = false;
  const cancelReader = async (): Promise<void> => {
    if (cancelled) return;
    cancelled = true;
    try {
      await reader.cancel();
    } catch {
      // Cancellation is best-effort; the bounded adapter error remains authoritative.
    }
  };

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > APEX_MAX_RPC_RESPONSE_BYTES) {
        await cancelReader();
        fail("APEX_RPC_RESPONSE_TOO_LARGE", "APEX RPC response exceeds the byte limit.");
      }
      result += decoder.decode(next.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } catch (error) {
    await cancelReader();
    if (error instanceof BnbApexAdapterError) throw error;
    throw new BnbApexAdapterError("APEX_RPC_JSON_INVALID", "APEX RPC returned invalid JSON.", {
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }
}

class ReadOnlyRpcSession {
  readonly evidence: ApexRpcEvidence[] = [];
  readonly rpcUrl: string;
  readonly #fetchImpl: typeof fetch;
  readonly #deadline: number;
  #nextId = 1;

  constructor(dependencies: BnbApexReadDependencies) {
    this.rpcUrl = readRpcUrl(dependencies.rpcUrl);
    this.#fetchImpl = dependencies.fetchImpl ?? fetch;
    this.#deadline = Date.now() + readTimeoutMs(dependencies.timeoutMs);
  }

  async request(method: ApexReadRpcMethod, params: ApexJsonValue[]): Promise<ApexJsonValue> {
    if (!(BNB_APEX_READ_RPC_METHODS as readonly string[]).includes(method)) {
      return fail("APEX_RPC_METHOD_REJECTED", "APEX RPC method is not read-only allowlisted.");
    }
    assertJsonValue(params);
    const id = this.#nextId;
    this.#nextId += 1;
    const remainingMs = this.#deadline - Date.now();
    if (remainingMs <= 0) fail("APEX_TIMEOUT", "APEX observation exceeded its bounded timeout.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new BnbApexAdapterError("APEX_TIMEOUT", "APEX observation exceeded its bounded timeout."));
      }, remainingMs);
    });

    const operation = async (): Promise<ApexJsonObject> => {
      const response = await this.#fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      if (!response.ok) {
        await cancelResponseBody(response);
        fail("APEX_RPC_HTTP_ERROR", `APEX RPC returned HTTP ${response.status}.`);
      }
      const text = await readBoundedResponseText(response);
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new BnbApexAdapterError("APEX_RPC_JSON_INVALID", "APEX RPC returned invalid JSON.", {
          cause: error,
        });
      }
      assertJsonValue(payload);
      return asObject(payload, "APEX RPC response");
    };

    let response: ApexJsonObject;
    try {
      response = await Promise.race([operation(), timeout]);
    } catch (error) {
      if (error instanceof BnbApexAdapterError) throw error;
      throw new BnbApexAdapterError("APEX_RPC_NETWORK_ERROR", "APEX RPC read failed.", {
        cause: error,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (response.jsonrpc !== "2.0" || response.id !== id) {
      fail("APEX_RPC_ENVELOPE_INVALID", "APEX RPC response envelope does not match the request.");
    }
    if (hasOwn(response, "error")) {
      fail("APEX_RPC_PROVIDER_ERROR", "APEX RPC returned an error response.");
    }
    if (!hasOwn(response, "result")) {
      fail("APEX_RPC_RESULT_MISSING", "APEX RPC response is missing result.");
    }
    this.evidence.push({ method, params, response });
    return response.result;
  }
}

function requireDeployedCode(value: unknown, context: string): Hex {
  const code = normalizeHexData(value, context);
  if (code === "0x" || /^0x0+$/.test(code)) {
    fail("APEX_CODE_MISSING", `${context} has no deployed bytecode.`);
  }
  return code;
}

function readBoundedString(value: unknown, context: string, maxLength = 256): string {
  if (typeof value !== "string") fail("APEX_SCHEMA_INVALID", `${context} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    fail("APEX_SCHEMA_INVALID", `${context} has an invalid length.`);
  }
  return trimmed;
}

function readDecimals(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) {
    fail("APEX_METADATA_INVALID", "APEX payment asset decimals must be uint8.");
  }
  return value as number;
}

function readCodeByAddress(
  codeByAddress: Readonly<Record<string, unknown>>,
  address: string,
  label: string,
): Hex {
  const entry = Object.entries(codeByAddress).find(([candidate]) => sameAddress(candidate, address));
  if (!entry) fail("APEX_CODE_EVIDENCE_MISSING", `APEX ${label} code evidence is missing.`);
  return requireDeployedCode(entry[1], `APEX ${label}`);
}

export function normalizeBnbApexDeploymentSnapshot(
  input: ApexDeploymentNormalizationInput,
): ApexDeploymentNormalization {
  const chainId =
    typeof input.chainId === "number"
      ? input.chainId
      : typeof input.chainId === "bigint"
        ? Number(input.chainId)
        : typeof input.chainId === "string" && /^0x/.test(input.chainId)
          ? Number(normalizeQuantity(input.chainId, "APEX chainId"))
          : Number.NaN;
  if (chainId !== BNB_APEX_BSC_TESTNET_CHAIN_ID) {
    fail("APEX_CHAIN_MISMATCH", "APEX observation is not from BSC testnet chainId 97.");
  }

  readCodeByAddress(input.codeByAddress, BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken, "payment token");
  readCodeByAddress(input.codeByAddress, BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce, "commerce");
  readCodeByAddress(input.codeByAddress, BNB_APEX_BSC_TESTNET_DEPLOYMENT.router, "router");
  readCodeByAddress(input.codeByAddress, BNB_APEX_BSC_TESTNET_DEPLOYMENT.policy, "policy");

  const commercePaymentToken = normalizeAddress(input.commercePaymentToken, "APEX commerce paymentToken");
  if (!sameAddress(commercePaymentToken, BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken)) {
    fail("APEX_PAYMENT_TOKEN_NOT_ALLOWLISTED", "APEX commerce points to a non-allowlisted payment token.");
  }
  const routerCommerce = normalizeAddress(input.routerCommerce, "APEX router commerce");
  if (!sameAddress(routerCommerce, BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce)) {
    fail("APEX_ROUTER_LINK_MISMATCH", "APEX router does not point to the allowlisted commerce proxy.");
  }

  const name = readBoundedString(input.paymentAssetMetadata.name, "APEX payment asset name");
  const symbol = readBoundedString(input.paymentAssetMetadata.symbol, "APEX payment asset symbol", 32);
  const decimals = readDecimals(input.paymentAssetMetadata.decimals);
  const providerDrift: ApexProviderDrift[] = [
    {
      kind: "README_POLICY_MIRROR_MISMATCH",
      authoritativeValue: BNB_APEX_BSC_TESTNET_DEPLOYMENT.policy,
      mirrorValue: BNB_APEX_README_MIRROR.policy,
      authoritativeSourceUrl: BNB_APEX_OFFICIAL_SOURCES.addressRegistry,
      mirrorSourceUrl: BNB_APEX_OFFICIAL_SOURCES.readme,
    },
  ];
  if (symbol !== BNB_APEX_README_MIRROR.paymentAssetSymbol) {
    providerDrift.push({
      kind: "README_PAYMENT_ASSET_LABEL_CONFLICT",
      providerValue: BNB_APEX_README_MIRROR.paymentAssetSymbol,
      onchainValue: symbol,
      field: "symbol",
      sourceUrl: BNB_APEX_OFFICIAL_SOURCES.readme,
    });
  }

  return {
    state: providerDrift.length === 0 ? "OBSERVED" : "OBSERVED_WITH_PROVIDER_DRIFT",
    chainId: BNB_APEX_BSC_TESTNET_CHAIN_ID,
    addresses: BNB_APEX_BSC_TESTNET_DEPLOYMENT,
    contractCodePresent: {
      paymentToken: true,
      commerce: true,
      router: true,
      policy: true,
    },
    links: {
      commercePaymentToken,
      routerCommerce,
    },
    paymentAsset: {
      address: commercePaymentToken,
      onchain: { name, symbol, decimals },
      registryLabel: BNB_APEX_REGISTRY_PAYMENT_ASSET_LABEL,
      readmeLabel: BNB_APEX_README_MIRROR.paymentAssetLabel,
    },
    providerDrift,
  };
}

async function readCall(
  session: ReadOnlyRpcSession,
  address: string,
  data: Hex,
): Promise<Hex> {
  if (!ALLOWLISTED_ADDRESSES.has(address.toLowerCase())) {
    return fail("APEX_CALL_TARGET_REJECTED", "APEX call target is not allowlisted.");
  }
  return normalizeHexData(
    await session.request("eth_call", [{ to: address, data }, "latest"]),
    "APEX eth_call result",
  );
}

function decodeReadResult<T>(operation: () => T, context: string): T {
  try {
    return operation();
  } catch (error) {
    throw new BnbApexAdapterError("APEX_ABI_DECODE_FAILED", `${context} ABI decode failed.`, {
      cause: error,
    });
  }
}

export async function observeBnbApexTestnetDeployment(
  dependencies: BnbApexReadDependencies = {},
): Promise<ApexDeploymentObservation> {
  const session = new ReadOnlyRpcSession(dependencies);
  const chainIdHex = await session.request("eth_chainId", []);
  const chainId = normalizeQuantity(chainIdHex, "APEX chainId");
  if (chainId !== BigInt(BNB_APEX_BSC_TESTNET_CHAIN_ID)) {
    fail("APEX_CHAIN_MISMATCH", "APEX RPC is not BSC testnet chainId 97.");
  }

  const codeByAddress: Record<string, ApexJsonValue> = {};
  for (const [label, address] of Object.entries(BNB_APEX_BSC_TESTNET_DEPLOYMENT)) {
    codeByAddress[address] = await session.request("eth_getCode", [address, "latest"]);
    requireDeployedCode(codeByAddress[address], `APEX ${label}`);
  }

  const paymentTokenData = await readCall(
    session,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
    encodeFunctionData({ abi: BNB_APEX_READ_ABIS.commerce, functionName: "paymentToken" }),
  );
  const commercePaymentToken = decodeReadResult(
    () =>
      decodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.commerce,
        functionName: "paymentToken",
        data: paymentTokenData,
      }),
    "APEX commerce paymentToken",
  );
  const normalizedPaymentToken = normalizeAddress(
    commercePaymentToken,
    "APEX commerce paymentToken",
  );
  if (!sameAddress(normalizedPaymentToken, BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken)) {
    fail("APEX_PAYMENT_TOKEN_NOT_ALLOWLISTED", "APEX commerce points to a non-allowlisted payment token.");
  }

  const routerCommerceData = await readCall(
    session,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.router,
    encodeFunctionData({ abi: BNB_APEX_READ_ABIS.router, functionName: "commerce" }),
  );
  const routerCommerce = decodeReadResult(
    () =>
      decodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.router,
        functionName: "commerce",
        data: routerCommerceData,
      }),
    "APEX router commerce",
  );

  const nameData = await readCall(
    session,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken,
    encodeFunctionData({ abi: BNB_APEX_READ_ABIS.erc20Metadata, functionName: "name" }),
  );
  const symbolData = await readCall(
    session,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken,
    encodeFunctionData({ abi: BNB_APEX_READ_ABIS.erc20Metadata, functionName: "symbol" }),
  );
  const decimalsData = await readCall(
    session,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken,
    encodeFunctionData({ abi: BNB_APEX_READ_ABIS.erc20Metadata, functionName: "decimals" }),
  );

  const normalized = normalizeBnbApexDeploymentSnapshot({
    chainId,
    codeByAddress,
    commercePaymentToken: normalizedPaymentToken,
    routerCommerce,
    paymentAssetMetadata: {
      name: decodeReadResult(
        () =>
          decodeFunctionResult({
            abi: BNB_APEX_READ_ABIS.erc20Metadata,
            functionName: "name",
            data: nameData,
          }),
        "APEX payment asset name",
      ),
      symbol: decodeReadResult(
        () =>
          decodeFunctionResult({
            abi: BNB_APEX_READ_ABIS.erc20Metadata,
            functionName: "symbol",
            data: symbolData,
          }),
        "APEX payment asset symbol",
      ),
      decimals: decodeReadResult(
        () =>
          decodeFunctionResult({
            abi: BNB_APEX_READ_ABIS.erc20Metadata,
            functionName: "decimals",
            data: decimalsData,
          }),
        "APEX payment asset decimals",
      ),
    },
  });

  return {
    provider: "BNB_APEX",
    access: "PUBLIC_READ_ONLY_RPC",
    rpcUrl: session.rpcUrl,
    observedAt: readObservedAt(dependencies.now),
    sourceUrls: BNB_APEX_OFFICIAL_SOURCES,
    rpcEvidence: session.evidence,
    ...normalized,
  };
}

type RawApexReceipt = {
  transactionHash: Hex;
  to: string;
  blockNumber: string;
  success: boolean;
  matchingCommerceEvents: ApexCommerceJobEventName[];
};

function normalizeReceipt(
  value: ApexJsonValue,
  expectedTxHash: Hex,
  expectedJobId: bigint,
): RawApexReceipt {
  const receipt = asObject(value, "APEX transaction receipt");
  const transactionHash = normalizeHash(receipt.transactionHash, "APEX receipt transactionHash");
  if (transactionHash !== expectedTxHash) {
    fail("APEX_TX_HASH_MISMATCH", "APEX receipt transaction hash does not match the requested hash.");
  }
  const to = normalizeAddress(receipt.to, "APEX receipt to");
  if (!ALLOWLISTED_JOB_TRANSACTION_TARGETS.has(to.toLowerCase())) {
    fail("APEX_TX_TARGET_REJECTED", "APEX transaction target is not allowlisted.");
  }
  const blockNumber = normalizeQuantity(receipt.blockNumber, "APEX receipt blockNumber").toString();
  const status = normalizeQuantity(receipt.status, "APEX receipt status");
  if (status !== 0n && status !== 1n) {
    fail("APEX_TX_STATUS_INVALID", "APEX receipt status must be 0 or 1.");
  }
  if (!Array.isArray(receipt.logs)) {
    fail("APEX_RECEIPT_LOGS_INVALID", "APEX receipt logs must be an array.");
  }

  const matchingCommerceEvents: ApexCommerceJobEventName[] = [];
  for (const rawLog of receipt.logs) {
    const log = asObject(rawLog, "APEX receipt log");
    const emitter = normalizeAddress(log.address, "APEX receipt log address");
    if (!sameAddress(emitter, BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce)) continue;
    if (!Array.isArray(log.topics) || log.topics.length < 2) continue;
    const topic0 = normalizeHash(log.topics[0], "APEX receipt event topic0");
    const eventName = BNB_APEX_COMMERCE_JOB_EVENT_TOPICS[topic0];
    if (!eventName) continue;
    const jobTopic = normalizeHash(log.topics[1], "APEX receipt event jobId topic");
    if (BigInt(jobTopic) === expectedJobId) matchingCommerceEvents.push(eventName);
  }

  if (status === 1n && matchingCommerceEvents.length === 0) {
    fail(
      "APEX_JOB_TX_BINDING_MISSING",
      "APEX successful transaction has no allowlisted Commerce event for the requested jobId.",
    );
  }

  return {
    transactionHash,
    to,
    blockNumber,
    success: status === 1n,
    matchingCommerceEvents: [...new Set(matchingCommerceEvents)],
  };
}

type DecodedJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Address;
  submittedAt: bigint;
  deliverable: Hex;
};

export function normalizeBnbApexJob(value: unknown, expectedJobId: bigint): NormalizedApexJob {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("APEX_JOB_SCHEMA_INVALID", "APEX decoded job must be an object tuple.");
  }
  const job = value as Partial<DecodedJob>;
  if (typeof job.id !== "bigint" || job.id !== expectedJobId) {
    fail("APEX_JOB_ID_MISMATCH", "APEX getJob result does not match the requested jobId.");
  }
  if (
    typeof job.budget !== "bigint" ||
    typeof job.expiredAt !== "bigint" ||
    typeof job.submittedAt !== "bigint" ||
    typeof job.status !== "number" ||
    !Number.isInteger(job.status) ||
    job.status < 0 ||
    job.status > 255
  ) {
    fail("APEX_JOB_SCHEMA_INVALID", "APEX getJob numeric fields are invalid.");
  }

  return {
    id: job.id.toString(),
    client: normalizeAddress(job.client, "APEX job client"),
    provider: normalizeAddress(job.provider, "APEX job provider"),
    evaluator: normalizeAddress(job.evaluator, "APEX job evaluator"),
    description: readBoundedString(job.description, "APEX job description", 8_192),
    budgetBaseUnits: job.budget.toString(),
    expiredAtUnix: job.expiredAt.toString(),
    statusCode: job.status,
    hook: normalizeAddress(job.hook, "APEX job hook"),
    submittedAtUnix: job.submittedAt.toString(),
    deliverable: normalizeHash(job.deliverable, "APEX job deliverable"),
  };
}

export async function observeBnbApexKnownJobTransaction(
  reference: ApexKnownJobReference,
  dependencies: BnbApexReadDependencies = {},
): Promise<ApexKnownJobObservation> {
  const jobId = normalizeJobId(reference.jobId);
  const txHash = normalizeHash(reference.txHash, "APEX transaction hash");
  const session = new ReadOnlyRpcSession(dependencies);
  const chainId = normalizeQuantity(await session.request("eth_chainId", []), "APEX chainId");
  if (chainId !== BigInt(BNB_APEX_BSC_TESTNET_CHAIN_ID)) {
    fail("APEX_CHAIN_MISMATCH", "APEX RPC is not BSC testnet chainId 97.");
  }

  const rawReceipt = await session.request("eth_getTransactionReceipt", [txHash]);
  const base = {
    provider: "BNB_APEX" as const,
    access: "KNOWN_TX_AND_JOB_READ_ONLY" as const,
    chainId: BNB_APEX_BSC_TESTNET_CHAIN_ID,
    rpcUrl: session.rpcUrl,
    observedAt: readObservedAt(dependencies.now),
    jobId: jobId.toString(),
    txHash,
  };
  if (rawReceipt === null) {
    return {
      ...base,
      state: "NOT_FOUND",
      transaction: null,
      job: null,
      rpcEvidence: session.evidence,
    };
  }

  const receipt = normalizeReceipt(rawReceipt, txHash, jobId);
  if (!receipt.success) {
    return {
      ...base,
      state: "FAILED_TRANSACTION",
      transaction: {
        to: receipt.to,
        blockNumber: receipt.blockNumber,
        success: false,
        matchingCommerceEvents: receipt.matchingCommerceEvents,
      },
      job: null,
      rpcEvidence: session.evidence,
    };
  }

  const jobData = await readCall(
    session,
    BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
    encodeFunctionData({
      abi: BNB_APEX_READ_ABIS.commerce,
      functionName: "getJob",
      args: [jobId],
    }),
  );
  const decodedJob = decodeReadResult(
    () =>
      decodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.commerce,
        functionName: "getJob",
        data: jobData,
      }),
    "APEX commerce getJob",
  );
  const job = normalizeBnbApexJob(decodedJob, jobId);

  return {
    ...base,
    state: "OBSERVED",
    transaction: {
      to: receipt.to,
      blockNumber: receipt.blockNumber,
      success: true,
      matchingCommerceEvents: receipt.matchingCommerceEvents,
    },
    job,
    rpcEvidence: session.evidence,
  };
}
