import assert from "node:assert/strict";
import { test } from "node:test";

import { ASSOCIATED_TOKEN_PROGRAM_ID } from "./canary-policy.ts";
import {
  SolanaSendReceiptFactsSchema,
  encodeSendFacts,
  parseSendReceiptFacts,
} from "./send-receipt.ts";
import { TOKEN_PROGRAM_ID } from "./send-kinds.ts";

const SENDER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const RECIPIENT = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function base() {
  return {
    schema: "ryntra.solana.send-receipt",
    actionKind: "TOKEN_ATA_CREATE",
    network: "mainnet",
    mint: MINT,
    sender: SENDER,
    recipient: RECIPIENT,
    expectedDebitRaw: "-500000",
    expectedCreditRaw: "500000",
    actualDebitRaw: "-500000",
    actualCreditRaw: "500000",
    transferFeeRaw: "0",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    ataRentLamports: "2039280",
    programs: [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID],
    signature: "3".repeat(88),
    slot: "350123456",
    finality: "confirmed",
    reconciliation: "MATCHED",
  };
}

function v11() {
  return {
    ...base(),
    schemaVersion: "1.1.0",
    reviewDigest: "0x" + "a".repeat(64),
    augmentation: {
      status: "NONE",
      summary: "The signed message matched the reviewed plan without wallet augmentation.",
    },
    plannedAta: { createsRecipientAccount: true, rentLamports: "2039280" },
    observedAta: { created: true, rentLamports: "2039280" },
    plannedBaseFeeLamports: "5000",
    actualBaseFeeLamports: "5000",
    plannedPriorityFeeLamports: "0",
    actualPriorityFeeLamports: "0",
  };
}

function v12() {
  return {
    ...v11(),
    schemaVersion: "1.2.0",
    observedAta: {
      created: true,
      rentLamports: "2039280",
      owner: RECIPIENT,
      tokenProgram: TOKEN_PROGRAM_ID,
      rentPayer: SENDER,
    },
    observedPrograms: [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID],
  };
}

test("v1.0 and v1.1 receipts remain parseable after v1.2 issuance", () => {
  const legacy = {
    ...base(),
    schemaVersion: "1.0.0",
  };
  assert.equal(parseSendReceiptFacts(JSON.stringify(legacy))?.schemaVersion, "1.0.0");
  assert.equal(parseSendReceiptFacts(JSON.stringify(v11()))?.schemaVersion, "1.1.0");
});

test("v1.2 round-trips independent ATA owner, token program, rent payer and programs", () => {
  const facts = SolanaSendReceiptFactsSchema.parse(v12());
  const parsed = parseSendReceiptFacts(encodeSendFacts(facts));
  assert.ok(parsed);
  assert.equal(parsed.schemaVersion, "1.2.0");
  assert.deepEqual(parsed.observedAta, {
    created: true,
    rentLamports: "2039280",
    owner: RECIPIENT,
    tokenProgram: TOKEN_PROGRAM_ID,
    rentPayer: SENDER,
  });
  assert.deepEqual(parsed.observedPrograms, [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID]);
});

test("v1.2 cannot call an ATA created without every independent creation fact", () => {
  for (const missing of ["owner", "tokenProgram", "rentPayer"]) {
    const candidate = v12();
    candidate.observedAta = { ...candidate.observedAta, [missing]: null };
    const parsed = SolanaSendReceiptFactsSchema.safeParse(candidate);
    assert.equal(parsed.success, false, `${missing} was allowed to disappear from a created ATA fact`);
  }
  const noAtaProgram = v12();
  noAtaProgram.observedPrograms = [TOKEN_PROGRAM_ID];
  assert.equal(SolanaSendReceiptFactsSchema.safeParse(noAtaProgram).success, false);
});
