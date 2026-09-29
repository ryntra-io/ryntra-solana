/* The Guard service's test fixtures: one intent, its quote and its policy on the
   testnet chain the service was proven on. Shared by the kernel's own test
   (`service.test.mjs`) and by the test of the separate project's wallet verifier
   through it. Moved unchanged from `service.test.mjs`. */

export const NOW = "2026-08-06T12:00:00.000Z";
export const WALLET = "0x1111111111111111111111111111111111111111";
export const USDC = "eip155:5042002/erc20:0x3600000000000000000000000000000000000000";
export const EURC = "eip155:5042002/erc20:0x89b50855aa3be2f677cd6303cec089b5f319d72a";
export const TX_HASH = `0x${"de".repeat(32)}`;

export const intent = {
  schemaVersion: "1.0.0",
  id: "int_arc_demo_001",
  tenantId: "tenant_demo",
  applicationId: "partner_arc_app",
  externalPartnerId: "partner-order-001",
  subjectRef: "subject:demo",
  walletAddress: WALLET,
  walletType: "EOA",
  chainRef: "eip155:5042002",
  environment: "ARC_TESTNET",
  actionType: "SWAP",
  instrumentRef: "arc-testnet:stablecoin-fx:usdc-eurc",
  sellAssetRef: USDC,
  buyAssetRef: EURC,
  amount: "10.00",
  amountType: "EXACT_INPUT",
  recipient: WALLET,
  venueRef: "circle-app-kit",
  routeRef: "circle-app-kit:swap",
  quoteRef: "quote_arc_001",
  target: "0x2222222222222222222222222222222222222222",
  calldataHash: `0x${"ab".repeat(32)}`,
  nativeValue: "0",
  portfolioSnapshotRef: null,
  policyRef: { id: "demo-stablecoin-policy", version: 1 },
  createdAt: "2026-08-06T11:59:00.000Z",
  expiresAt: "2026-08-06T12:02:00.000Z",
  revision: 1,
  idempotencyKey: "idem-intent-001",
};

export const quote = {
  schemaVersion: "1.0.0",
  id: "ev_quote_001",
  provider: "Circle App Kit",
  sourceRef: "circle-app-kit:estimateSwap",
  adapter: "circle-app-kit",
  adapterVersion: "current-official-contract",
  sourceType: "SWAP_QUOTE",
  observedAt: "2026-08-06T11:59:30.000Z",
  receivedAt: "2026-08-06T11:59:31.000Z",
  validUntil: "2026-08-06T12:01:30.000Z",
  confidence: "PROVIDER_REPORTED",
  coverage: {
    subjectRefs: ["eip155:5042002", USDC, EURC],
    fields: ["amountIn", "expectedAmountOut", "minimumAmountOut", "fees"],
    limitations: ["UNDERLYING_ROUTE_UNAVAILABLE"],
  },
  availability: "AVAILABLE",
  verificationStatus: "PROVIDER_REPORTED",
  chainRef: "eip155:5042002",
  blockRef: null,
  transactionRef: null,
  status: "VALID",
  requestHash: `0x${"01".repeat(32)}`,
  responseHash: `0x${"02".repeat(32)}`,
  responseDigest: `0x${"02".repeat(32)}`,
  reason: null,
  transformationVersion: "arc-swap-quote-v1",
  fallbackUsed: false,
  facts: {
    quoteRef: "quote_arc_001",
    providerRef: "circle-app-kit",
    venueRef: "circle-app-kit",
    routeRef: "circle-app-kit:swap",
    sellAssetRef: USDC,
    buyAssetRef: EURC,
    amountIn: "10.00",
    recipientAddress: WALLET,
    leverage: null,
    expectedAmountOut: "9.96",
    minimumAmountOut: "9.94",
    feeAmount: "0.02",
    feeAssetRef: USDC,
    totalDebit: "10.02",
    slippageBps: "20",
  },
};

export const policy = {
  schemaVersion: "1.0.0",
  id: "demo-stablecoin-policy",
  version: 1,
  publishedAt: "2026-08-06T00:00:00.000Z",
  immutable: true,
  rules: [
    { id: "allowed-chain", type: "ALLOWED_CHAIN", value: "eip155:5042002", onViolation: "BLOCK" },
    { id: "allowed-pair", type: "ALLOWED_PAIR", value: [USDC, EURC], onViolation: "BLOCK" },
    { id: "max-total-debit", type: "MAX_TOTAL_DEBIT", value: "100.00", currencyAssetRef: USDC, onViolation: "BLOCK" },
    { id: "max-quote-age", type: "MAX_QUOTE_AGE_SECONDS", value: 120, onViolation: "INSUFFICIENT_EVIDENCE" },
    { id: "max-slippage", type: "MAX_SLIPPAGE_BPS", value: "25", onViolation: "REVIEW" },
    { id: "human-auth", type: "HUMAN_AUTHORIZATION_REQUIRED", value: true, onViolation: "REQUIRE_AUTHORIZATION" },
  ],
};
