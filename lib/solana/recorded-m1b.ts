/**
 * The first owner-signed Solana Mainnet lifecycle Ryntra actually observed.
 *
 * This record is deliberately facts-only. The signed receipt and the two-RPC
 * read-back live in the development repository's evidence archive; regression
 * tests require this projection to agree with both rather than letting product
 * copy become a second history. The two wallets and their token accounts stay
 * in that evidence: the product reads none of them, and the explorer link
 * names them.
 */
export const SOLANA_M1B_RECORDED_RUN = Object.freeze({
  taskId: "RYN-SOL-M1B",
  actionRef: "action:solana-token-2022/spl-transfer@1",
  network: "mainnet",
  signature:
    "Z2Doz7D3Q9cU8ePzcT7dAfu4aCo8aQUvc5enioyYP8yZYoNeT9yAzYdWWm7CKRxCFGuhSHD5ZT3k8GLBCqF3bZK",
  explorerUrl:
    "https://explorer.solana.com/tx/Z2Doz7D3Q9cU8ePzcT7dAfu4aCo8aQUvc5enioyYP8yZYoNeT9yAzYdWWm7CKRxCFGuhSHD5ZT3k8GLBCqF3bZK",
  slot: "442567050",
  blockTime: "2026-08-29T08:59:23.000Z",
  finality: "finalized",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amountRaw: "500000",
  networkFeeLamports: "80000",
  ataRentLamports: "2039280",
  receipt: Object.freeze({
    id: "outcome_solana_mainnet_Z2Doz7D3Q9cU8ePz",
    actionPassportHash: "0x5a562e9c0671688678e079802d2e4108a577042402099da066b6d1ed17819d80",
    contentHash: "0xdd3594da9b4e5740a7be080f8ae0146980b92e9306f1a316bcf388e5ff73c78c",
    integrityHash: "0x84f8e24169ec1e27d4f5844b0f94773a54cf0b4ed94cf734a4d141ec671e2aaf",
    issuerKeyId: "ryntra-issuer-f66fe59b067210c6",
    issuerVerdict: "SIGNATURE_VALID",
    integrityValid: true,
    reconciliation: "DEVIATION_RECORDED",
    downloadPath: "/api/solana/receipts/m1b",
  }),
  deviationCause: Object.freeze([
    "The issued receipt omitted the already reviewed Phantom augmentation when splitting the confirmed 80000-lamport fee.",
    "The receipt expectation omitted the deterministic System Program CPI used by ATA creation.",
  ]),
});
