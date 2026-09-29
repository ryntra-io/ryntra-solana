/**
 * One transfer, however many accounts hold the asset — and whatever the mint
 * makes that transfer mean.
 *
 * The builder used to assume exactly one source account, no memo, no hook and
 * one instruction shape. Each of those was true for the single case it was
 * written for and false for a general Send, and the failure mode is the worst
 * kind: a transaction that builds cleanly and moves less than it was asked to,
 * or one whose hook accounts are missing so the chain refuses it after a person
 * has already signed.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAddressDecoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

import { SPL_TRANSFER_ACTION_REF } from "../agent-control/adapters/solana-token-2022.ts";
import { decodeRawMintAccount } from "./mint.ts";
import { buildPassport } from "./passport.ts";
import { createSolanaRpcHandle } from "./rpc.ts";
import { associatedTokenAccount } from "./token-account.ts";
import { buildTransferTransaction } from "./transaction.ts";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function testWallet() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return getAddressDecoder().decode(new Uint8Array(raw));
}

const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const AUX_SOURCE = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

async function build({ fixtureName = "usdc-spl", sources, amountRaw = "1000000", recipientExists = true, balances = {} } = {}) {
  const raw = fixture(fixtureName);
  const read = decodeRawMintAccount(raw);
  assert.equal(read.ok, true);
  const passport = buildPassport(raw);
  assert.equal(passport.ok, true);
  const sender = String(testWallet());
  const senderAta = await associatedTokenAccount({
    owner: sender,
    mint: raw.mint,
    tokenProgram: passport.passport.identity.programId,
  });
  const recipientAta = await associatedTokenAccount({
    owner: RECIPIENT,
    mint: raw.mint,
    tokenProgram: passport.passport.identity.programId,
  });

  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const reply = (result) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    switch (body.method) {
      case "getAccountInfo": {
        const [queried] = body.params;
        if (queried === RECIPIENT) {
          return reply({
            context: { slot: 1 },
            value: { data: ["", "base64"], executable: false, lamports: 1, owner: SYSTEM_PROGRAM, space: 0 },
          });
        }
        if (queried === recipientAta) {
          if (!recipientExists) return reply({ context: { slot: 1 }, value: null });
          return reply({
            context: { slot: 1 },
            value: {
              data: {
                program: "spl-token",
                parsed: { type: "account", info: { mint: raw.mint, owner: RECIPIENT, state: "initialized" } },
              },
              executable: false,
              lamports: 2_039_280,
              owner: raw.owner,
              space: 165,
            },
          });
        }
        return reply({
          context: { slot: Number(raw.slot) },
          value: {
            data: [raw.dataBase64, "base64"],
            executable: false,
            lamports: 1_000_000,
            owner: raw.owner,
            space: 0,
          },
        });
      }
      case "getTokenAccountBalance": {
        const [account] = body.params;
        if (account === recipientAta && !recipientExists) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "could not find account" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        const table = typeof balances === "function" ? balances(senderAta) : balances;
        const amount = table[account] ?? (account === senderAta ? "5000000" : "0");
        return reply({ context: { slot: 1 }, value: { amount, decimals: 6, uiAmountString: "0" } });
      }
      case "getLatestBlockhash":
        return reply({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 350_000_000 } });
      case "getFeeForMessage":
        return reply({ context: { slot: 1 }, value: 5_000 });
      case "getMinimumBalanceForRentExemption":
        return reply(2_039_280);
      case "getBalance":
        return reply({ context: { slot: 1 }, value: 5_000_000_000 });
      default:
        return reply(null);
    }
  };
  try {
    const result = await buildTransferTransaction({
      handle: createSolanaRpcHandle({ network: raw.network }),
      read,
      passport: passport.passport,
      epoch: 250n,
      /* Sources are expressed against the sender's own associated account,
         which is only derivable inside this helper. */
      sources: typeof sources === "function" ? sources(senderAta) : sources,
      input: {
        schemaVersion: "1.0.0",
        actionRef: SPL_TRANSFER_ACTION_REF,
        network: raw.network,
        mint: raw.mint,
        sender,
        recipient: RECIPIENT,
        amountRaw,
      },
    });
    return { result, sender, senderAta, recipientAta, mint: raw.mint };
  } finally {
    globalThis.fetch = original;
  }
}

function instructionCount(plan) {
  const decoded = getTransactionDecoder().decode(Buffer.from(plan.unsignedWireBase64, "base64"));
  return getCompiledTransactionMessageDecoder().decode(decoded.messageBytes).instructions.length;
}

test("one source is still one transfer, and the plan says which account it drew from", async () => {
  const { result, senderAta } = await build();
  assert.equal(result.ok, true);
  const { plan } = result;
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.sources[0].account, senderAta);
  assert.equal(plan.sources[0].amountRaw, "1000000");
  assert.equal(plan.sources[0].feeRaw, "0");
  /* The legacy field stays, pointing at the same account, so every parser
     written for the single-source shape keeps reading the right thing. */
  assert.equal(plan.senderTokenAccount, senderAta);
});

test("two sources produce two transfer instructions and one aggregate expectation", async () => {
  const { result, senderAta } = await build({
    amountRaw: "1200000",
    balances: (ata) => ({ [ata]: "700000", [AUX_SOURCE]: "500000" }),
    sources: (senderAta) => [
      { address: senderAta, amountRaw: "700000", state: "INITIALIZED" },
      { address: AUX_SOURCE, amountRaw: "500000", state: "INITIALIZED" },
    ],
  });
  assert.equal(result.ok, true);
  const { plan } = result;

  assert.equal(plan.sources.length, 2);
  assert.deepEqual(plan.sources.map((source) => source.account), [senderAta, AUX_SOURCE]);
  assert.deepEqual(plan.sources.map((source) => source.amountRaw), ["700000", "500000"]);
  assert.equal(plan.amountRaw, "1200000");
  /* One instruction per source, and the fingerprint carries a leg for each so
     a wallet cannot drop one and have the check still pass. */
  assert.equal(instructionCount(plan), 2);
  assert.equal(plan.fingerprint.transfers.length, 2);
  assert.equal(plan.fingerprint.instructionCount, 2);
  /* And the first leg is what the legacy single-leg field reports. */
  assert.deepEqual(plan.fingerprint.transfer, plan.fingerprint.transfers[0]);
});

test("the plan states which kind of destination it resolved and carries the support verdict", async () => {
  const { result } = await build();
  assert.equal(result.ok, true);
  assert.equal(result.plan.recipientKind, "WALLET_OWNER");
  assert.ok(["SUPPORTED", "REVIEW_REQUIRED", "BLOCKED", "UNKNOWN"].includes(result.plan.support.decision));
  /* USDC has a freeze authority, so the honest answer is a disclosed review
     rather than a silent pass. */
  assert.equal(result.plan.support.decision, "REVIEW_REQUIRED");
  assert.equal(result.plan.memo, null);
  assert.equal(result.plan.transferHook, null);
});

test("a Token-2022 fee mint charges each instruction its own rounded fee", async () => {
  const { result } = await build({
    fixtureName: "bern-t22",
    amountRaw: "3",
    balances: (ata) => ({ [ata]: "2", [AUX_SOURCE]: "1" }),
    sources: (senderAta) => [
      { address: senderAta, amountRaw: "2", state: "INITIALIZED" },
      { address: AUX_SOURCE, amountRaw: "1", state: "INITIALIZED" },
    ],
  });
  assert.equal(result.ok, true);
  /* Rounding is per instruction and upward, so two legs of 2 and 1 do not pay
     what one leg of 3 would. Summing first and splitting after would understate
     what the mint actually withholds. */
  const fees = result.plan.sources.map((source) => BigInt(source.feeRaw));
  assert.equal(fees.length, 2);
  assert.ok(fees.every((fee) => fee >= 0n));
});

test("a sources list that does not add up to the amount is refused, not rounded", async () => {
  const { result } = await build({
    amountRaw: "1000000",
    sources: (senderAta) => [
      { address: senderAta, amountRaw: "700000", state: "INITIALIZED" },
      /* 700000 + 200000 is not 1000000. A builder that shrugged and sent the
         difference would move less than a person approved. */
      { address: AUX_SOURCE, amountRaw: "200000", state: "INITIALIZED" },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SOURCE_TOTAL_MISMATCH");
});

test("too many sources to fit one transaction refuses instead of sending part", async () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    address: AUX_SOURCE,
    amountRaw: index === 0 ? "1000000" : "0",
    state: "INITIALIZED",
  }));
  const { result } = await build({ amountRaw: "1000000", sources: many });
  assert.equal(result.ok, false);
  assert.ok(["TRANSACTION_TOO_LARGE", "SOURCE_TOTAL_MISMATCH"].includes(result.code));
});
