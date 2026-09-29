/** The exact owner-signed M2 action; no second swap is inferred or authorized. */
export const SOLANA_M2_RECORDED_RUN = Object.freeze({
  taskId: "RYN-SOL-M2",
  network: "mainnet",
  pair: "USDC→SOL",
  signature:
    "4NAKLXGnECdnrgJTv7CBtMjpYSDgcZuKaBfc1SKSHTLfhhrYkTTyGSsjM3LpRGQHKWR34dociwkhRrG9U8R41Cgr",
  explorerUrl:
    "https://explorer.solana.com/tx/4NAKLXGnECdnrgJTv7CBtMjpYSDgcZuKaBfc1SKSHTLfhhrYkTTyGSsjM3LpRGQHKWR34dociwkhRrG9U8R41Cgr",
  slot: "443417261",
  blockTime: "2026-09-01T11:55:19.000Z",
  finality: "finalized",
  inputRaw: "2622093",
  inputDisplay: "2.622093 USDC",
  quotedOutputRaw: "25600656",
  minimumOutputRaw: "25562255",
  actualOutputRaw: "25621005",
  outputDisplay: "0.025621005 SOL",
  routeGrossOutputRaw: "25626130",
  platformFeeRaw: "5125",
  networkFeeLamports: "19530",
  receipt: Object.freeze({
    id: "swap:01a05cd2-c4aa-751d-a82e-1d741cb8c23b",
    contentHash: "0xbd3b32c44b63916efe5c8374fc78eb93fcd0400b405c4c8590787feb008b5b26",
    integrityHash: "0x4fbbe93d502062057b9555d2df049b28d9f0f50e238880ce74700b3719c7720c",
    issuerKeyId: "ryntra-issuer-f66fe59b067210c6",
    reconciliation: "DEVIATION_RECORDED",
    downloadPath: "/api/solana/receipts/m2",
    correctionPath: "/api/solana/receipts/m2/correction",
    correctionHash: "0xc5501bf63228d0dc042d36cfa169f7779c79fb574c98ad04617512a805a26140",
    correctionCodes: [
      "LEGACY_SUBMISSION_LIMITATION_INACCURATE",
      "LEGACY_ACTION_PATH_REF_INACCURATE",
    ] as const,
  }),
  boundary: Object.freeze({
    submissionLane: "ADOPTED_RPC",
    providerReport: null,
    secondSwapExists: false,
    generalExecutionGuaranteed: false,
  }),
});
