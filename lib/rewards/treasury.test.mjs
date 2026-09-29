import assert from "node:assert/strict";
import test from "node:test";

import { TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

import { loadTreasurySigner, payRewardClaim as payRewardClaimDirect, rewardsTreasuryConfig } from "./treasury.server.ts";
import { associatedTokenAccount } from "../solana/token-account.ts";
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "../solana/types.ts";

/** USDC on Solana mainnet, and the program that actually owns it. */
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LEGACY = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/* A throwaway key, as 32 private bytes — the shape several wallets export.
   It holds nothing on any chain and nothing here is ever broadcast. */
const SECRET = JSON.stringify(Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 251));
/** The address that key signs for, derived rather than typed. */
const TREASURY = "BXq9CTas4DpibqUMCSbMHD5Q3rrNTx3JXekqC4GrKKHb";
const RECIPIENT = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";

const payRewardClaim = args => payRewardClaimDirect({ ...args,
  beforeSubmit: async () => true,
  deps: { ...args.deps, submit: async () => { throw new Error("Synthetic RPC timeout; no network request"); } },
});
const envFor = (mint = USDC) => ({
  RYNTRA_REWARDS_TREASURY_SOLANA: TREASURY,
  RYNTRA_REWARDS_TREASURY_SECRET: SECRET,
  RYNTRA_REWARDS_PAYOUT_MINT: mint,
});

test("the package constant named after Token-2022 is in fact the legacy program", () => {
  /*
   * Pinned by value, not trusted by name.
   *
   * `TOKEN_PROGRAM_ADDRESS` is exported by `@solana-program/token-2022`, which
   * reads as though it must be `TokenzQd…`. It is not: it is the legacy
   * `Tokenkeg…`, which is the correct program for USDC. That is a fact about a
   * dependency rather than about our code, so it is asserted here — if a future
   * version of the package ever changed it, every associated-account derivation
   * downstream would silently move.
   */
  assert.equal(String(TOKEN_PROGRAM_ADDRESS), LEGACY);
  assert.equal(String(TOKEN_2022_PROGRAM_ADDRESS), TOKEN_2022);
  assert.equal(SPL_TOKEN_PROGRAM_ID, LEGACY);
  assert.equal(TOKEN_2022_PROGRAM_ID, TOKEN_2022);
});

test("choosing the wrong program derives a different account, so it is never harmless", async () => {
  const owner = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
  const underLegacy = await associatedTokenAccount({ owner, mint: USDC, tokenProgram: LEGACY });
  const underToken2022 = await associatedTokenAccount({ owner, mint: USDC, tokenProgram: TOKEN_2022 });
  /* The whole reason the program must be read rather than assumed: the two
     derivations are different addresses, so paying under the wrong one does not
     fail loudly at derivation — it produces a plausible account that is not the
     mint's associated account. */
  assert.notEqual(underLegacy, underToken2022);
});

/**
 * A Solana RPC handle that answers exactly what the payout builder asks.
 *
 * `mintOwner` is the whole point: it is what a real chain would report for the
 * configured payout mint, and the builder must take its program from here
 * rather than from a constant.
 */
function stubHandle({ mintOwner, decimals = 6, onSend }) {
  /* A minimal classic mint account: 82 bytes with decimals at offset 44. */
  const data = new Uint8Array(82);
  data[44] = decimals;
  /* `isInitialized` at offset 45, so the decoder accepts it. */
  data[45] = 1;
  const dataBase64 = Buffer.from(data).toString("base64");
  return {
    network: "mainnet",
    endpoint: "https://stub",
    endpoints: [{ role: "primary", url: "https://stub", host: "stub", fromEnv: false }],
    timeoutMs: 5_000,
    /* `withRpcDiscipline` reads `retries` to size its budget and its error;
       leaving it out produced "failed after NaN attempts" and hid the real
       answer behind an arithmetic accident. */
    retries: 0,
    host: () => "stub",
    source: () => ({ ref: "stub", label: "stub" }),
    rpc: {
      getAccountInfo: () => ({
        send: async () => ({ context: { slot: 1n }, value: { owner: mintOwner, data: [dataBase64, "base64"] } }),
      }),
      getLatestBlockhash: () => ({
        send: async () => ({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100n } }),
      }),
    },
    onSend,
  };
}

test("a 32-byte private key is accepted, not silently reported as no key", async () => {
  /* `solana-keygen` writes 64 bytes and several wallets export 32. Both must
     work: the second used to throw inside and report that this deployment held
     no payout key at all, which is a true sentence about a false situation. */
  const signer = await loadTreasurySigner({ RYNTRA_REWARDS_TREASURY_SECRET: SECRET });
  assert.ok(signer, "a 32-byte private key must produce a signer");
  assert.equal(String(signer.address), TREASURY);
});

test("the payout builds, and its destination proves the program came from the mint", async () => {
  /*
   * The real build check the owner asked for, and the assertion that answers
   * his actual question.
   *
   * The stub reports the mint as owned by the legacy program, and the
   * destination the builder derived must therefore be the legacy associated
   * account. Nothing is broadcast: the stub endpoint refuses, which surfaces as
   * SUBMIT_UNKNOWN **with a signature** — and a signature exists only if the
   * message was assembled and signed, so its presence is the build succeeding.
   */
  const result = await payRewardClaim({
    wallet: RECIPIENT,
    usdMicros: 2_520_000n,
    deps: { env: envFor(), handle: stubHandle({ mintOwner: LEGACY }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SUBMIT_UNKNOWN", `built and signed, then failed to send; got ${result.code}: ${result.reason ?? ""}`);
  assert.ok(result.signature, "a signature means the transaction was actually built and signed");
  assert.equal(result.destination, await associatedTokenAccount({ owner: RECIPIENT, mint: USDC, tokenProgram: LEGACY }));
});

test("a Token-2022 mint moves the payout to that program's accounts, not the legacy ones", async () => {
  /* The same call with only the chain's answer changed. If the program were a
     constant rather than a read, this destination would not move — and that is
     precisely the defect the owner asked to be checked for. */
  const result = await payRewardClaim({
    wallet: RECIPIENT,
    usdMicros: 2_520_000n,
    deps: { env: envFor(), handle: stubHandle({ mintOwner: TOKEN_2022 }) },
  });
  assert.equal(result.code, "SUBMIT_UNKNOWN", `expected a built transaction; got ${result.code}: ${result.reason ?? ""}`);
  assert.equal(result.destination, await associatedTokenAccount({ owner: RECIPIENT, mint: USDC, tokenProgram: TOKEN_2022 }));
  /* And it is genuinely a different account from the legacy derivation. */
  assert.notEqual(result.destination, await associatedTokenAccount({ owner: RECIPIENT, mint: USDC, tokenProgram: LEGACY }));
});

test("a mint whose decimals disagree with the ledger refuses before anything is built", async () => {
  const result = await payRewardClaim({
    wallet: RECIPIENT,
    usdMicros: 1_000_000n,
    deps: { env: envFor(), handle: stubHandle({ mintOwner: LEGACY, decimals: 9 }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BUILD_FAILED");
  assert.match(result.reason, /9 decimals/);
  assert.equal("signature" in result, false, "nothing may be signed when the mint is refused");
});

test("an address that is not a mint at all cannot be paid with", async () => {
  const result = await payRewardClaim({
    wallet: RECIPIENT,
    usdMicros: 1_000_000n,
    /* Owned by the system program: not a token mint under either program. */
    deps: { env: envFor(), handle: stubHandle({ mintOwner: "11111111111111111111111111111111" }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BUILD_FAILED");
  assert.match(result.reason, /neither token program|could not be read/i);
});

test("a key that signs for a different account never pays from it", async () => {
  const result = await payRewardClaim({
    wallet: RECIPIENT,
    usdMicros: 1_000_000n,
    deps: {
      env: { ...envFor(), RYNTRA_REWARDS_TREASURY_SOLANA: RECIPIENT },
      handle: stubHandle({ mintOwner: LEGACY }),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "WRONG_KEY");
  /* The addresses are public and naming them is how an operator fixes it; the
     key itself must appear nowhere. */
  assert.match(result.reason, new RegExp(TREASURY));
  assert.equal(result.reason.includes(SECRET), false);
});

test("an unconfigured or half-configured treasury pays nobody", async () => {
  assert.equal(rewardsTreasuryConfig({}).configured, false);
  assert.equal(rewardsTreasuryConfig({ RYNTRA_REWARDS_TREASURY_SOLANA: "not-an-address" }).configured, false);
  /* An address with no key can read a reserve and can never sign. */
  const readOnly = rewardsTreasuryConfig({ RYNTRA_REWARDS_TREASURY_SOLANA: USDC });
  assert.equal(readOnly.configured, true);
  assert.equal(readOnly.canSign, false);
  assert.equal(await loadTreasurySigner({}), null);
  assert.equal(await loadTreasurySigner({ RYNTRA_REWARDS_TREASURY_SECRET: "nonsense" }), null);
});

test("the default payout mint is mainnet USDC", () => {
  const config = rewardsTreasuryConfig({ RYNTRA_REWARDS_TREASURY_SOLANA: USDC });
  assert.equal(config.mint, USDC);
});

test("a payout cannot reach the network without a successful durable arm", async () => {
 let sends=0;
 const result=await payRewardClaimDirect({wallet:RECIPIENT,usdMicros:1000000n,beforeSubmit:async()=>false,
  deps:{env:envFor(),handle:stubHandle({mintOwner:LEGACY}),submit:async()=>{sends++;return "unexpected"}}});
 assert.equal(result.code,"NOT_ARMED");assert.equal(sends,0);
 assert.equal((await payRewardClaimDirect({wallet:RECIPIENT,usdMicros:1000000n,deps:{env:envFor()}})).code,"NOT_ARMED");
});
test("the exact signature and lifetime are persisted before the synthetic broadcast", async () => {
 let prepared=null;
 const result=await payRewardClaimDirect({wallet:RECIPIENT,usdMicros:1000000n,beforeSubmit:async facts=>{prepared=facts;return true},
  deps:{env:envFor(),handle:stubHandle({mintOwner:LEGACY}),submit:async()=>{assert.ok(prepared?.signature);assert.equal(prepared.lastValidBlockHeight,"100");return prepared.signature}}});
 assert.equal(result.ok,true);assert.equal(result.signature,prepared.signature);
});
