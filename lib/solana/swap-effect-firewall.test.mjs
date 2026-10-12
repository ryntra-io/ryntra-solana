import { test } from "node:test";
import assert from "node:assert/strict";

import { SwapExecutionSimulationSchema } from "./swap-execution-review.ts";

const TAKER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OTHER = "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const THIRD_MINT = "Es9vMFrzaCERmJfrF4H2FYDGEZr1mkMeG4Gr6kH6hS7";
const OWNER_TOKEN_ACCOUNT = "5XmJVGx1jLPPZd95WjtSni8fjQ6QKgmmZikAumxmwxXD";
const POOL_TOKEN_ACCOUNT = "2Y7HATmn9aJBcxCskE5V2U2epmjvkZmB51zTJBbhj4cU";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const STATIC_ACCOUNTS = [
  TAKER,
  OWNER_TOKEN_ACCOUNT,
  POOL_TOKEN_ACCOUNT,
  "11111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "ComputeBudget111111111111111111111111111111",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
];

async function assess(args) {
  const implementation = await import("./swap-effect-firewall.ts").catch(() => null);
  assert.ok(
    implementation?.assessSwapSimulationEffects,
    "the simulation owner-effect firewall must exist before an order can reach the wallet",
  );
  return implementation.assessSwapSimulationEffects({
    ...args,
    staticAccounts: args.staticAccounts ?? STATIC_ACCOUNTS.slice(0, args.staticAccountCount),
    topLevelPrograms: args.topLevelPrograms ?? [MEMO_PROGRAM],
  });
}

function order(overrides = {}) {
  return {
    taker: TAKER,
    inputMint: USDC,
    outputMint: WSOL,
    inAmountRaw: "3000000",
    outAmountRaw: "28000000",
    minReceivedRaw: "28000000",
    signatureFeeLamports: "5000",
    signatureFeePayer: TAKER,
    priorityFeeLamports: "100000",
    priorityFeePayer: TAKER,
    rentFeeLamports: "0",
    rentFeePayer: null,
    gasless: false,
    ...overrides,
  };
}

function token(accountIndex, mint, owner, amount) {
  return { accountIndex, mint, owner, uiTokenAmount: { amount, decimals: 6 } };
}

function simulation(overrides = {}) {
  return {
    fee: 105000n,
    loadedAddresses: { writable: [], readonly: [] },
    preBalances: [1_000_000_000n, 2_039_280n, 1n],
    postBalances: [1_027_895_000n, 2_039_280n, 1n],
    preTokenBalances: [token(1, USDC, TAKER, "5000000")],
    postTokenBalances: [token(1, USDC, TAKER, "2000000")],
    innerInstructions: [],
    ...overrides,
  };
}

test("owner-effect firewall: USDC input and native SOL output must match the exact reviewed amounts", async () => {
  const result = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.proof.method, "SIMULATION_OWNER_DELTAS_V1");
  assert.equal(result.proof.tokenInstructionAudit, "NO_UNSAFE_MUTATIONS");
  assert.equal(result.proof.inputRepresentation, "TOKEN");
  assert.equal(result.proof.outputRepresentation, "NATIVE_SOL");
  assert.equal(result.proof.feeLamports, "105000");
  assert.equal(result.proof.takerLamportDelta, "27895000");
  assert.deepEqual(result.proof.ownerTokenDeltas, [{ mint: USDC, rawDelta: "-3000000" }]);
});

test("owner-effect firewall: native SOL input and USDC output must match the exact reviewed amounts", async () => {
  const result = await assess({
    order: order({
      inputMint: WSOL,
      outputMint: USDC,
      inAmountRaw: "28000000",
      outAmountRaw: "2900000",
      minReceivedRaw: "2890000",
    }),
    staticAccountCount: 3,
    simulation: simulation({
      preBalances: [1_000_000_000n, 2_039_280n, 1n],
      postBalances: [971_895_000n, 2_039_280n, 1n],
      preTokenBalances: [token(1, USDC, TAKER, "2000000")],
      postTokenBalances: [token(1, USDC, TAKER, "4900000")],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.proof.inputRepresentation, "NATIVE_SOL");
  assert.equal(result.proof.outputRepresentation, "TOKEN");
  assert.deepEqual(result.proof.ownerTokenDeltas, [{ mint: USDC, rawDelta: "2900000" }]);
});

test("owner-effect firewall: temporary wSOL rent is allowed only as a proven same-transaction round trip", async () => {
  const result = await assess({
    order: order({
      inputMint: WSOL,
      outputMint: USDC,
      inAmountRaw: "28000000",
      outAmountRaw: "2900000",
      minReceivedRaw: "2890000",
      rentFeeLamports: "2039280",
      rentFeePayer: TAKER,
    }),
    staticAccountCount: 3,
    simulation: simulation({
      preBalances: [1_000_000_000n, 2_039_280n, 0n],
      postBalances: [971_895_000n, 2_039_280n, 0n],
      preTokenBalances: [token(1, USDC, TAKER, "2000000")],
      postTokenBalances: [token(1, USDC, TAKER, "4900000")],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              program: "system",
              programId: "11111111111111111111111111111111",
              parsed: {
                type: "createAccount",
                info: {
                  lamports: "2039280",
                  newAccount: "2TH1jDxy2tv8HwXdMMXwWaw4sT9VYCDLWHKGqDgjrdiv",
                  owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                  source: TAKER,
                  space: "165",
                },
              },
            },
            {
              program: "spl-associated-token-account",
              programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
              parsed: {
                type: "create",
                info: {
                  account: "2TH1jDxy2tv8HwXdMMXwWaw4sT9VYCDLWHKGqDgjrdiv",
                  mint: WSOL,
                  source: TAKER,
                  wallet: TAKER,
                  systemProgram: "11111111111111111111111111111111",
                  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                },
              },
            },
            {
              program: "spl-token",
              programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              parsed: {
                type: "initializeAccount3",
                info: {
                  account: "2TH1jDxy2tv8HwXdMMXwWaw4sT9VYCDLWHKGqDgjrdiv",
                  mint: WSOL,
                  owner: TAKER,
                },
              },
            },
            {
              program: "spl-token",
              programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              parsed: {
                type: "syncNative",
                info: { account: "2TH1jDxy2tv8HwXdMMXwWaw4sT9VYCDLWHKGqDgjrdiv" },
              },
            },
            {
              program: "spl-token",
              programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              parsed: {
                type: "closeAccount",
                info: {
                  account: "2TH1jDxy2tv8HwXdMMXwWaw4sT9VYCDLWHKGqDgjrdiv",
                  destination: TAKER,
                  owner: TAKER,
                },
              },
            },
          ],
        },
      ],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.proof.nativeWrapRoundTrip, true);
});

test("owner-effect proof binds every resolved top-level and CPI program and refuses an unresolved one", async () => {
  const resolved = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      innerInstructions: [{ index: 0, instructions: [{ programId: OTHER, accounts: [], data: "2" }] }],
    }),
  });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.proof.programs, [MEMO_PROGRAM, OTHER].sort());

  const unresolved = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      innerInstructions: [{ index: 0, instructions: [{ accounts: [], data: "2" }] }],
    }),
  });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.code, "UNRESOLVED_INNER_PROGRAM");
});

test("owner-effect firewall: any third owner token movement is refused", async () => {
  const result = await assess({
    order: order(),
    staticAccountCount: 4,
    simulation: simulation({
      preBalances: [1_000_000_000n, 2_039_280n, 2_039_280n, 1n],
      postBalances: [1_027_895_000n, 2_039_280n, 2_039_280n, 1n],
      preTokenBalances: [
        token(1, USDC, TAKER, "5000000"),
        token(2, THIRD_MINT, TAKER, "900"),
      ],
      postTokenBalances: [
        token(1, USDC, TAKER, "2000000"),
        token(2, THIRD_MINT, TAKER, "899"),
      ],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNRELATED_TOKEN_DELTA");
});

test("owner-effect firewall: a zero-delta token approval or authority mutation is refused", async () => {
  const result = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              program: "spl-token",
              programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              parsed: { type: "approve", info: { source: OWNER_TOKEN_ACCOUNT, delegate: OTHER } },
            },
          ],
        },
      ],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNSAFE_TOKEN_MUTATION");

  const unparsed = await assess({
    order: order(),
    staticAccountCount: 8,
    tokenProgramIndices: [7],
    simulation: simulation({
      preBalances: [1_000_000_000n, 2_039_280n, 1n, 1n, 1n, 1n, 1n, 1n],
      postBalances: [1_027_895_000n, 2_039_280n, 1n, 1n, 1n, 1n, 1n, 1n],
      innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 7, accounts: [1], data: "5" }] }],
    }),
  });
  assert.equal(unparsed.ok, false);
  assert.equal(unparsed.code, "UNSAFE_TOKEN_MUTATION");
});

test("owner-effect firewall: router mint/burn state on a proven non-taker pool account is not misclassified as owner risk", async () => {
  const result = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      preTokenBalances: [
        token(1, USDC, TAKER, "5000000"),
        token(2, THIRD_MINT, OTHER, "100"),
      ],
      postTokenBalances: [
        token(1, USDC, TAKER, "2000000"),
        token(2, THIRD_MINT, OTHER, "101"),
      ],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              program: "spl-token",
              programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              parsed: { type: "mintTo", info: { account: POOL_TOKEN_ACCOUNT, mint: THIRD_MINT, amount: "1" } },
            },
          ],
        },
      ],
    }),
  });
  assert.equal(result.ok, true);
});

test("owner-effect firewall: inner System authority mutation and ALT-loaded Token approval are refused", async () => {
  const systemAssign = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      innerInstructions: [{
        index: 0,
        instructions: [{
          program: "system",
          programId: "11111111111111111111111111111111",
          parsed: { type: "assign", info: { account: TAKER, owner: OTHER } },
        }],
      }],
    }),
  });
  assert.equal(systemAssign.ok, false);
  assert.equal(systemAssign.code, "UNSAFE_ACCOUNT_MUTATION");

  const loadedTokenApprove = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      loadedAddresses: {
        writable: [],
        readonly: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
      },
      preBalances: [1_000_000_000n, 2_039_280n, 1n, 1n],
      postBalances: [1_027_895_000n, 2_039_280n, 1n, 1n],
      innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 3, accounts: [1], data: "5" }] }],
    }),
  });
  assert.equal(loadedTokenApprove.ok, false);
  assert.equal(loadedTokenApprove.code, "UNSAFE_TOKEN_MUTATION");
});

test("owner-effect firewall: SyncNative cannot turn old lamports in a pre-existing owner account into fake swap output", async () => {
  const result = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      preBalances: [1_000_000_000n, 2_039_280n, 28_000_000n],
      postBalances: [999_895_000n, 2_039_280n, 28_000_000n],
      preTokenBalances: [
        token(1, USDC, TAKER, "5000000"),
        token(2, WSOL, TAKER, "0"),
      ],
      postTokenBalances: [
        token(1, USDC, TAKER, "2000000"),
        token(2, WSOL, TAKER, "28000000"),
      ],
      innerInstructions: [{
        index: 0,
        instructions: [{
          program: "spl-token",
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          parsed: { type: "syncNative", info: { account: POOL_TOKEN_ACCOUNT } },
        }],
      }],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNSAFE_TOKEN_MUTATION");

  const topLevelCandidateOnly = await assess({
    order: order(),
    staticAccountCount: 3,
    nativeWrapCandidate: {
      accountIndex: 2,
      account: POOL_TOKEN_ACCOUNT,
      fundedLamportsRaw: "0",
    },
    simulation: simulation({
      preBalances: [1_000_000_000n, 2_039_280n, 28_000_000n],
      postBalances: [999_895_000n, 2_039_280n, 28_000_000n],
      preTokenBalances: [token(1, USDC, TAKER, "5000000"), token(2, WSOL, TAKER, "0")],
      postTokenBalances: [token(1, USDC, TAKER, "2000000"), token(2, WSOL, TAKER, "28000000")],
      innerInstructions: [],
    }),
  });
  assert.equal(topLevelCandidateOnly.ok, false);
  assert.equal(topLevelCandidateOnly.code, "RENT_UNSUPPORTED");
});

test("owner-effect firewall: extra input debit and output sent to another owner are refused", async (context) => {
  await context.test("extra input debit", async () => {
    const result = await assess({
      order: order(),
      staticAccountCount: 3,
      simulation: simulation({
        preTokenBalances: [token(1, USDC, TAKER, "5000000")],
        postTokenBalances: [token(1, USDC, TAKER, "1999999")],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INPUT_DELTA_MISMATCH");
  });

  await context.test("output destination is not the taker", async () => {
    const result = await assess({
      order: order({
        inputMint: WSOL,
        outputMint: USDC,
        inAmountRaw: "28000000",
        outAmountRaw: "2900000",
        minReceivedRaw: "2890000",
      }),
      staticAccountCount: 3,
      simulation: simulation({
        preBalances: [1_000_000_000n, 2_039_280n, 1n],
        postBalances: [971_895_000n, 2_039_280n, 1n],
        preTokenBalances: [token(1, USDC, OTHER, "2000000")],
        postTokenBalances: [token(1, USDC, OTHER, "4900000")],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "OUTPUT_DELTA_MISMATCH");
  });

  await context.test("output above the quote but at or over the minimum is accepted", async () => {
    /* An AMM price moves between the quote and the simulation. Landing a few
       raw units ABOVE the quoted figure is the taker receiving more than
       promised, not an attack — exact equality refused a live canary over ten
       raw units in the taker's own favour. The floor is minReceivedRaw. */
    const result = await assess({
      order: order({
        inputMint: WSOL,
        outputMint: USDC,
        inAmountRaw: "28000000",
        outAmountRaw: "2900000",
        minReceivedRaw: "2890000",
      }),
      staticAccountCount: 3,
      simulation: simulation({
        preBalances: [1_000_000_000n, 2_039_280n, 1n],
        postBalances: [971_895_000n, 2_039_280n, 1n],
        preTokenBalances: [token(1, USDC, TAKER, "2000000")],
        /* 2,900,010 received against a 2,900,000 quote: ten units to the good. */
        postTokenBalances: [token(1, USDC, TAKER, "4900010")],
      }),
    });
    assert.equal(result.ok, true);
  });

  await context.test("output below the stated minimum is still refused", async () => {
    /* The boundary that was moved, held where it matters: receiving LESS than
       the provider's own stated minimum stays a refusal. */
    const result = await assess({
      order: order({
        inputMint: WSOL,
        outputMint: USDC,
        inAmountRaw: "28000000",
        outAmountRaw: "2900000",
        minReceivedRaw: "2890000",
      }),
      staticAccountCount: 3,
      simulation: simulation({
        preBalances: [1_000_000_000n, 2_039_280n, 1n],
        postBalances: [971_895_000n, 2_039_280n, 1n],
        preTokenBalances: [token(1, USDC, TAKER, "2000000")],
        /* 2,889,999 received against a 2,890,000 minimum: one unit short. */
        postTokenBalances: [token(1, USDC, TAKER, "4889999")],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "OUTPUT_DELTA_MISMATCH");
  });
});

test("owner-effect firewall: an extra native SOL debit cannot hide behind a successful simulation", async () => {
  const result = await assess({
    order: order(),
    staticAccountCount: 3,
    simulation: simulation({
      postBalances: [1_027_894_999n, 2_039_280n, 1n],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "NATIVE_DELTA_MISMATCH");
});

test("owner-effect firewall: missing ownership or incomplete simulation metadata fails closed", async (context) => {
  await context.test("a changed token balance without an owner", async () => {
    const result = await assess({
      order: order(),
      staticAccountCount: 3,
      simulation: simulation({
        preTokenBalances: [token(1, USDC, undefined, "5000000")],
        postTokenBalances: [token(1, USDC, undefined, "2000000")],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "TOKEN_OWNER_UNRESOLVED");
  });

  await context.test("one side of a changed token balance cannot omit its owner", async () => {
    const result = await assess({
      order: order(),
      staticAccountCount: 3,
      simulation: simulation({
        preTokenBalances: [token(1, USDC, undefined, "5000000")],
        postTokenBalances: [token(1, USDC, TAKER, "2000000")],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "TOKEN_OWNER_UNRESOLVED");
  });

  await context.test("account vectors do not cover every loaded account", async () => {
    const result = await assess({
      order: order(),
      staticAccountCount: 3,
      simulation: simulation({ loadedAddresses: { writable: [OTHER], readonly: [] } }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "ACCOUNT_VECTOR_MISMATCH");
  });

  await context.test("token balance metadata is absent", async () => {
    const result = await assess({
      order: order(),
      staticAccountCount: 3,
      simulation: simulation({ preTokenBalances: null, postTokenBalances: null }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "TOKEN_METADATA_UNAVAILABLE");
  });

  await context.test("inner-instruction metadata is absent", async () => {
    const result = await assess({
      order: order(),
      staticAccountCount: 3,
      simulation: simulation({ innerInstructions: null }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SIMULATION_METADATA_UNAVAILABLE");
  });
});

test("owner-effect firewall: fee mismatch and any rent spend are refused", async (context) => {
  await context.test("provider fee fields do not equal the simulated fee", async () => {
    const result = await assess({
      order: order({ priorityFeeLamports: "99999" }),
      staticAccountCount: 3,
      simulation: simulation(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "FEE_MISMATCH");
  });

  await context.test("M2 cannot label an arbitrary debit as rent without a structural round trip", async () => {
    const result = await assess({
      order: order({ rentFeeLamports: "2039280", rentFeePayer: TAKER }),
      staticAccountCount: 3,
      simulation: simulation(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "RENT_UNSUPPORTED");
  });
});

test("execution bundle schema: an OK simulation without a verified owner-effect proof is invalid", () => {
  const withoutEffects = SwapExecutionSimulationSchema.safeParse({
    status: "OK",
    unitsConsumed: "140000",
    error: null,
    sourceHost: "stub.rpc",
    observedAt: "2026-08-30T12:00:00.000Z",
  });
  assert.equal(withoutEffects.success, false);
});

/*
 * Buying an asset you do not hold yet.
 *
 * Two things the bounded canary refused and a product cannot: a pair with no
 * SOL leg at all, and the rent that opens the destination account. The rent is
 * accounted here rather than waved through — it is measured from the
 * simulation's own balance vectors, and only for accounts the transaction
 * proved the taker both pays for and owns.
 */
const NEW_DESTINATION_ATA = "2TH1jDxy2tv8HwXdMMXwWaw4sT9VYCDLWHKGqDgjrdiv";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const RENT = 2_039_280n;

function ataCreation({ wallet = TAKER, source = TAKER, mint = THIRD_MINT, owner = TAKER, tokenProgram = TOKEN_PROGRAM } = {}) {
  return [
    {
      index: 0,
      instructions: [
        {
          program: "spl-associated-token-account",
          programId: ATA_PROGRAM,
          parsed: {
            type: "createIdempotent",
            info: {
              account: NEW_DESTINATION_ATA,
              mint,
              source,
              wallet,
              systemProgram: "11111111111111111111111111111111",
              tokenProgram,
            },
          },
        },
        {
          program: tokenProgram === TOKEN_PROGRAM ? "spl-token" : "spl-token-2022",
          programId: tokenProgram,
          parsed: {
            type: "initializeAccount3",
            info: { account: NEW_DESTINATION_ATA, mint, owner },
          },
        },
      ],
    },
  ];
}

test("owner-effect firewall: a Token-2022 destination opened for the taker is the taker's own account", async () => {
  /* Every tokenized stock on the Spot page — xStocks, PreStocks, the Backpack
     tokens — is a Token-2022 mint, and buying one for the first time opens a
     Token-2022 account. With the program id mistyped, the account was never
     recognised as opened for the taker and the Review was refused as
     RENT_UNSUPPORTED (NVDAx, 2026-09-12). */
  const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const result = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation({ innerInstructions: ataCreation({ tokenProgram: TOKEN_2022 }) }),
  });
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  assert.equal(result.proof.takerLamportDelta, (-105_000n - RENT).toString());

  /* The mistyped id is exactly what used to be here; an account under an
     unknown program is still nobody's, so the same order is still refused. */
  const mistyped = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation({ innerInstructions: ataCreation({ tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHn5qbeANZtY2g" }) }),
  });
  assert.equal(mistyped.ok, false);
  assert.equal(mistyped.code, "RENT_UNSUPPORTED");
});

function tokenToTokenSimulation(overrides = {}) {
  return {
    fee: 105000n,
    loadedAddresses: { writable: [], readonly: [] },
    preBalances: [1_000_000_000n, 2_039_280n, 0n],
    postBalances: [1_000_000_000n - 105_000n - RENT, 2_039_280n, RENT],
    preTokenBalances: [token(1, USDC, TAKER, "5000000")],
    postTokenBalances: [token(1, USDC, TAKER, "2000000"), token(2, THIRD_MINT, TAKER, "1000000")],
    innerInstructions: ataCreation(),
    ...overrides,
  };
}

function tokenToTokenOrder(overrides = {}) {
  return order({
    inputMint: USDC,
    outputMint: THIRD_MINT,
    inAmountRaw: "3000000",
    outAmountRaw: "1000000",
    minReceivedRaw: "990000",
    rentFeeLamports: RENT.toString(),
    rentFeePayer: TAKER,
    ...overrides,
  });
}

test("owner-effect firewall: a token-to-token swap with no SOL leg reconciles", async () => {
  const result = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation(),
  });

  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  assert.equal(result.proof.inputRepresentation, "TOKEN");
  assert.equal(result.proof.outputRepresentation, "TOKEN");
  assert.equal(result.proof.nativeWrapRoundTrip, false);
  assert.equal(result.proof.takerLamportDelta, (-105_000n - RENT).toString());
  assert.deepEqual(result.proof.ownerTokenDeltas.map((row) => row.mint).sort(), [USDC, THIRD_MINT].sort());
});

test("owner-effect firewall: a fill above the quote is good news, a fill below the minimum is not", async () => {
  const better = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation({
      postTokenBalances: [token(1, USDC, TAKER, "2000000"), token(2, THIRD_MINT, TAKER, "1000010")],
    }),
  });
  assert.equal(better.ok, true, better.ok ? "" : `${better.code}: ${better.reason}`);

  const worse = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation({
      postTokenBalances: [token(1, USDC, TAKER, "2000000"), token(2, THIRD_MINT, TAKER, "989999")],
    }),
  });
  assert.equal(worse.ok, false);
  assert.equal(worse.code, "OUTPUT_DELTA_MISMATCH");
});

test("owner-effect firewall: rent is refused unless the account it opens is proven the taker's own", async () => {
  await (async () => {
    const foreignWallet = await assess({
      order: tokenToTokenOrder(),
      staticAccountCount: 3,
      staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
      topLevelPrograms: [MEMO_PROGRAM],
      simulation: tokenToTokenSimulation({ innerInstructions: ataCreation({ wallet: OTHER, owner: OTHER }) }),
    });
    assert.equal(foreignWallet.ok, false);
    assert.equal(foreignWallet.code, "RENT_UNSUPPORTED");
  })();

  /* An account opened for a mint outside the two reviewed legs is not part of
     this swap, whoever ends up owning it. */
  const strayMint = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation({ innerInstructions: ataCreation({ mint: WSOL }) }),
  });
  assert.equal(strayMint.ok, false);
  assert.equal(strayMint.code, "RENT_UNSUPPORTED");

  /* Opening an account while quoting no rent at all is equally unexplained. */
  const unquoted = await assess({
    order: tokenToTokenOrder({ rentFeeLamports: "0", rentFeePayer: null }),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation(),
  });
  assert.equal(unquoted.ok, false);
  assert.equal(unquoted.code, "RENT_UNSUPPORTED");
});

test("owner-effect firewall: rent cannot cover a lamport debit larger than the account it opened", async () => {
  const drained = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation({
      /* One extra lamport leaves the taker and lands nowhere the review named. */
      postBalances: [1_000_000_000n - 105_000n - RENT - 1n, 2_039_280n, RENT],
    }),
  });
  assert.equal(drained.ok, false);
  assert.equal(drained.code, "NATIVE_DELTA_MISMATCH");
});

test("owner-effect firewall: rent relief is capped at the rent the review disclosed", async () => {
  /*
   * The hole this closes was shipped and reproduced: measuring rent from the
   * balance vectors is right, but using that measurement to lower the lamport
   * floor without bounding it let the same lamports do both jobs. A provider
   * transaction that pushed 4 SOL into an account it opened for the taker
   * raised the rent term to 4 SOL, lowered the floor by 4 SOL, and was
   * VERIFIED while the card printed 0.002 SOL of rent.
   */
  const drained = 4_000_000_000n;
  const result = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation({
      preBalances: [10_000_000_000n, 2_039_280n, 0n],
      postBalances: [10_000_000_000n - 105_000n - drained, 2_039_280n, drained],
    }),
  });
  assert.equal(result.ok, false, "a 4 SOL debit disclosed as 0.002 SOL of rent must never verify");
  assert.equal(result.code, "RENT_UNSUPPORTED");
  assert.match(result.reason, /4000000000/);
  assert.match(result.reason, /2039280/);
});

/*
 * Rent from the chain, not from the venue's estimate.
 *
 * Reproduced on 2026-09-14 for a first purchase of NVDAx: Jupiter's
 * `rentFeeLamports` was 1,488,440 — the rent-exempt minimum of a plain
 * 165-byte token account under the live parameters (5,080 lamports per
 * byte-year, threshold 1) — while the simulation opened the taker a 179-byte
 * Token-2022 account (ImmutableOwner, TransferHook, Pausable — what every
 * xStock mint requires) holding 1,559,560. Held to the estimate, the Review
 * was refused as RENT_UNSUPPORTED for every tokenized stock a wallet did not
 * already hold. With the simulation's own account state and the Rent
 * parameters, the account is proved to hold exactly its minimum instead.
 */
const LIVE_RENT = { lamportsPerByteYear: 5080n, exemptionThreshold: 1, burnPercent: 50 };
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const XSTOCK_ACCOUNT_BYTES = 179;
const XSTOCK_RENT = 1_559_560n;
const VENUE_ESTIMATE = 1_488_440n;

function xstockSimulation(overrides = {}) {
  return tokenToTokenSimulation({
    preBalances: [1_000_000_000n, 2_039_280n, 0n],
    postBalances: [1_000_000_000n - 105_000n - XSTOCK_RENT, 2_039_280n, XSTOCK_RENT],
    innerInstructions: ataCreation({ tokenProgram: TOKEN_2022_PROGRAM }),
    ...overrides,
  });
}

test("owner-effect firewall: an opened account proved to hold exactly its rent-exempt minimum verifies above the venue's estimate", async () => {
  const proven = await assess({
    order: tokenToTokenOrder({ rentFeeLamports: VENUE_ESTIMATE.toString() }),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: xstockSimulation(),
    accountStates: new Map([[NEW_DESTINATION_ATA, { lamports: XSTOCK_RENT, space: XSTOCK_ACCOUNT_BYTES, owner: TOKEN_2022_PROGRAM }]]),
    rent: LIVE_RENT,
  });
  assert.equal(proven.ok, true, proven.ok ? "" : `${proven.code}: ${proven.reason}`);
  assert.equal(proven.proof.durableRentLamports, XSTOCK_RENT.toString());
  assert.equal(proven.proof.rentProof, "EXACT_MINIMUM");
  assert.equal(proven.proof.takerLamportDelta, (-105_000n - XSTOCK_RENT).toString());

  /* Without the account's state the estimate is still the ceiling — the
     stricter path, never a guess. */
  const unproven = await assess({
    order: tokenToTokenOrder({ rentFeeLamports: VENUE_ESTIMATE.toString() }),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: xstockSimulation(),
  });
  assert.equal(unproven.ok, false);
  assert.equal(unproven.code, "RENT_UNSUPPORTED");
  assert.match(unproven.reason, /1559560/);
  assert.match(unproven.reason, /1488440/);

  /* A state that names the venue's own figure verifies under the ceiling and
     says how it was proved. */
  const plain = await assess({
    order: tokenToTokenOrder(),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: tokenToTokenSimulation(),
  });
  assert.equal(plain.ok, true, plain.ok ? "" : `${plain.code}: ${plain.reason}`);
  assert.equal(plain.proof.durableRentLamports, RENT.toString());
  assert.equal(plain.proof.rentProof, "REVIEWED_CEILING");
});

test("owner-effect firewall: the chain's minimum is an equality — an over-funded account is refused with the state in hand", async () => {
  const drained = 4_000_000_000n;
  const overFunded = await assess({
    order: tokenToTokenOrder({ rentFeeLamports: VENUE_ESTIMATE.toString() }),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: xstockSimulation({
      preBalances: [10_000_000_000n, 2_039_280n, 0n],
      postBalances: [10_000_000_000n - 105_000n - drained, 2_039_280n, drained],
    }),
    accountStates: new Map([[NEW_DESTINATION_ATA, { lamports: drained, space: XSTOCK_ACCOUNT_BYTES, owner: TOKEN_2022_PROGRAM }]]),
    rent: LIVE_RENT,
  });
  assert.equal(overFunded.ok, false, "4 SOL is not the rent-exempt minimum of any token account");
  assert.equal(overFunded.code, "RENT_UNSUPPORTED");
  assert.match(overFunded.reason, /4000000000/);
  assert.match(overFunded.reason, /1559560/);

  /* A state that disagrees with the balance vector is metadata nobody can
     reason from. */
  const disagreeing = await assess({
    order: tokenToTokenOrder({ rentFeeLamports: VENUE_ESTIMATE.toString() }),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: xstockSimulation(),
    accountStates: new Map([[NEW_DESTINATION_ATA, { lamports: XSTOCK_RENT + 1n, space: XSTOCK_ACCOUNT_BYTES, owner: TOKEN_2022_PROGRAM }]]),
    rent: LIVE_RENT,
  });
  assert.equal(disagreeing.ok, false);
  assert.equal(disagreeing.code, "SIMULATION_METADATA_UNAVAILABLE");
});

test("owner-effect firewall: an account the venue quoted no rent for is accepted only when the chain proves it holds exactly its minimum", async () => {
  const proven = await assess({
    order: tokenToTokenOrder({ rentFeeLamports: "0", rentFeePayer: null }),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: xstockSimulation(),
    accountStates: new Map([[NEW_DESTINATION_ATA, { lamports: XSTOCK_RENT, space: XSTOCK_ACCOUNT_BYTES, owner: TOKEN_2022_PROGRAM }]]),
    rent: LIVE_RENT,
  });
  assert.equal(proven.ok, true, proven.ok ? "" : `${proven.code}: ${proven.reason}`);
  assert.equal(proven.proof.rentProof, "EXACT_MINIMUM");
  assert.equal(proven.proof.durableRentLamports, XSTOCK_RENT.toString());

  const unproven = await assess({
    order: tokenToTokenOrder({ rentFeeLamports: "0", rentFeePayer: null }),
    staticAccountCount: 3,
    staticAccounts: [TAKER, OWNER_TOKEN_ACCOUNT, NEW_DESTINATION_ATA],
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: xstockSimulation(),
  });
  assert.equal(unproven.ok, false);
  assert.equal(unproven.code, "RENT_UNSUPPORTED");
});

test("the two token programs are named by the kernel's own ids, never by a retyped literal", async () => {
  /* The Token-2022 id was mistyped in this file and in the signed-bytes check
     (`…PHn5qbeANZtY2g` for `…PHnBqCXEpPxuEb`), so no Token-2022 account ever
     counted as opened for the taker and every tokenized-stock purchase was
     refused as RENT_UNSUPPORTED the day the ticket first offered one. */
  const { readFileSync } = await import("node:fs");
  const { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = await import("./send-kinds.ts");
  assert.equal(TOKEN_2022_PROGRAM_ID, "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  assert.equal(TOKEN_PROGRAM_ID, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  for (const file of ["lib/solana/swap-effect-firewall.ts", "lib/solana/swap-transaction-check.ts", "app/solana/workspace/spot/market-header.tsx", "app/solana/workspace/trade/swap-card.tsx"]) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /"Tokenz[1-9A-HJ-NP-Za-km-z]{30,}"/, `${file} must not retype the Token-2022 program id`);
    assert.match(source, /TOKEN_2022_PROGRAM_ID/, `${file} must name Token-2022 through the kernel's constant`);
  }
});

/*
 * A route through a Token-2022 hop (SPCXx, 2026-09-24).
 *
 * Every route the venue offered for $10 of the SpaceX xStock passed through
 * Backpack's SPCX: USDC → SPCX on one pool, SPCX → SPCXx on another. The venue
 * carries the hop through the signer's OWN account for SPCX — a 179-byte
 * Token-2022 account it opens, fills, empties and leaves open — and the
 * firewall, accepting rent only for the two reviewed legs, refused every one
 * of those Reviews as RENT_UNSUPPORTED while the destination account already
 * existed. The hop account is accepted as a corridor: named by the reviewed
 * route, empty at the end, holding exactly its rent-exempt minimum.
 */
const HOP_MINT = "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb";
const XSTOCK_MINT = "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8";
const HOP_ACCOUNT = "81B7svrW7gKCSHgogdWyPHXj2tMbxdDt3pQ9MJKmvSat";
const XSTOCK_ACCOUNT = "5ckRDppBm5JPfUCeYV75HQ3dBsNMX8XhDzW5CeEYx9Se";
const HOP_ROUTE = [
  { inputMint: USDC, outputMint: HOP_MINT },
  { inputMint: HOP_MINT, outputMint: XSTOCK_MINT },
];

function hopOpening({ account = HOP_ACCOUNT, mint = HOP_MINT, owner = TAKER, tokenProgram = TOKEN_2022_PROGRAM, index = 0 } = {}) {
  const tokenLabel = tokenProgram === TOKEN_PROGRAM ? "spl-token" : "spl-token-2022";
  return {
    index,
    instructions: [
      {
        program: tokenLabel,
        programId: tokenProgram,
        parsed: { type: "getAccountDataSize", info: { mint, extensionTypes: ["immutableOwner"] } },
      },
      {
        program: "system",
        programId: "11111111111111111111111111111111",
        parsed: {
          type: "createAccount",
          info: { lamports: String(XSTOCK_RENT), newAccount: account, owner: tokenProgram, source: TAKER, space: String(XSTOCK_ACCOUNT_BYTES) },
        },
      },
      { program: tokenLabel, programId: tokenProgram, parsed: { type: "initializeImmutableOwner", info: { account } } },
      { program: tokenLabel, programId: tokenProgram, parsed: { type: "initializeAccount3", info: { account, mint, owner } } },
    ],
  };
}

function hopOrder(overrides = {}) {
  return order({
    inputMint: USDC,
    outputMint: XSTOCK_MINT,
    inAmountRaw: "10000000",
    outAmountRaw: "6740640",
    minReceivedRaw: "6673153",
    rentFeeLamports: VENUE_ESTIMATE.toString(),
    rentFeePayer: TAKER,
    route: HOP_ROUTE,
    ...overrides,
  });
}

/* Static keys: the taker, its USDC account, its existing xStock account, the
   hop account the transaction opens, a pool account. */
const HOP_STATIC = [TAKER, OWNER_TOKEN_ACCOUNT, XSTOCK_ACCOUNT, HOP_ACCOUNT, POOL_TOKEN_ACCOUNT];

function hopSimulation(overrides = {}) {
  return {
    fee: 105000n,
    loadedAddresses: { writable: [], readonly: [] },
    preBalances: [1_000_000_000n, 2_039_280n, 2_039_280n, 0n, 1n],
    postBalances: [1_000_000_000n - 105_000n - XSTOCK_RENT, 2_039_280n, 2_039_280n, XSTOCK_RENT, 1n],
    preTokenBalances: [token(1, USDC, TAKER, "24621745"), token(2, XSTOCK_MINT, TAKER, "0")],
    postTokenBalances: [
      token(1, USDC, TAKER, "14621745"),
      token(2, XSTOCK_MINT, TAKER, "6740740"),
      token(3, HOP_MINT, TAKER, "0"),
    ],
    innerInstructions: [hopOpening()],
    ...overrides,
  };
}

function hopStates(lamports = XSTOCK_RENT) {
  return new Map([[HOP_ACCOUNT, { lamports, space: XSTOCK_ACCOUNT_BYTES, owner: TOKEN_2022_PROGRAM }]]);
}

async function assessHop({ orderOverrides = {}, simulationOverrides = {}, accountStates = hopStates(), rent = LIVE_RENT } = {}) {
  return assess({
    order: hopOrder(orderOverrides),
    staticAccountCount: HOP_STATIC.length,
    staticAccounts: HOP_STATIC,
    topLevelPrograms: [MEMO_PROGRAM],
    simulation: hopSimulation(simulationOverrides),
    accountStates,
    rent,
  });
}

test("owner-effect firewall: an account a hop of the reviewed route passes through verifies when it ends empty and holds exactly its rent", async () => {
  const result = await assessHop();
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  assert.equal(result.proof.rentProof, "EXACT_MINIMUM");
  assert.equal(result.proof.durableRentLamports, XSTOCK_RENT.toString());
  assert.equal(result.proof.takerLamportDelta, (-105_000n - XSTOCK_RENT).toString());
  /* The hop leaves no trace in what the signer gained or lost. */
  assert.deepEqual(result.proof.ownerTokenDeltas.map((row) => row.mint).sort(), [USDC, XSTOCK_MINT].sort());

  /* The same bytes with no route named are what production refused: an
     account for a third mint, and nothing reviewed that explains it. */
  const unnamed = await assessHop({ orderOverrides: { route: undefined } });
  assert.equal(unnamed.ok, false);
  assert.equal(unnamed.code, "RENT_UNSUPPORTED");

  /* A route that passes through some other token does not vouch for this one. */
  const elsewhere = await assessHop({
    orderOverrides: { route: [{ inputMint: USDC, outputMint: THIRD_MINT }, { inputMint: THIRD_MINT, outputMint: XSTOCK_MINT }] },
  });
  assert.equal(elsewhere.ok, false);
  assert.equal(elsewhere.code, "RENT_UNSUPPORTED");
});

test("owner-effect firewall: a hop account is accepted only on the chain's own rent figure", async () => {
  /* No simulated state: the venue's estimate is no ceiling for a corridor. */
  const unproven = await assessHop({ accountStates: null });
  assert.equal(unproven.ok, false);
  assert.equal(unproven.code, "RENT_UNSUPPORTED");
  assert.match(unproven.reason, new RegExp(HOP_MINT));

  const noRentParameters = await assessHop({ rent: null });
  assert.equal(noRentParameters.ok, false);
  assert.equal(noRentParameters.code, "RENT_UNSUPPORTED");

  /* One lamport above the minimum is a debit nobody approved. */
  const overFunded = await assessHop({
    simulationOverrides: {
      postBalances: [1_000_000_000n - 105_000n - XSTOCK_RENT - 1n, 2_039_280n, 2_039_280n, XSTOCK_RENT + 1n, 1n],
    },
    accountStates: hopStates(XSTOCK_RENT + 1n),
  });
  assert.equal(overFunded.ok, false);
  assert.equal(overFunded.code, "RENT_UNSUPPORTED");
  assert.match(overFunded.reason, /1559561/);
});

test("owner-effect firewall: a hop account that keeps anything is refused", async () => {
  /* The hop mint left behind in the corridor is a third asset nobody
     reviewed, refused by whichever check meets it first. */
  const kept = await assessHop({
    simulationOverrides: {
      postTokenBalances: [
        token(1, USDC, TAKER, "14621745"),
        token(2, XSTOCK_MINT, TAKER, "6740740"),
        token(3, HOP_MINT, TAKER, "12"),
      ],
    },
  });
  assert.equal(kept.ok, false);
  assert.equal(kept.code, "UNRELATED_TOKEN_DELTA");

  /* Tokens moved into the corridor from an account the signer already held
     net to zero across the mint and are still refused: the corridor must end
     empty, not merely balanced. */
  const moved = await assessHop({
    simulationOverrides: {
      preBalances: [1_000_000_000n, 2_039_280n, 2_039_280n, 0n, 2_039_280n],
      postBalances: [1_000_000_000n - 105_000n - XSTOCK_RENT, 2_039_280n, 2_039_280n, XSTOCK_RENT, 2_039_280n],
      preTokenBalances: [token(1, USDC, TAKER, "24621745"), token(2, XSTOCK_MINT, TAKER, "0"), token(4, HOP_MINT, TAKER, "50")],
      postTokenBalances: [
        token(1, USDC, TAKER, "14621745"),
        token(2, XSTOCK_MINT, TAKER, "6740740"),
        token(3, HOP_MINT, TAKER, "50"),
        token(4, HOP_MINT, TAKER, "0"),
      ],
    },
  });
  assert.equal(moved.ok, false);
  assert.equal(moved.code, "UNRELATED_TOKEN_DELTA");
  assert.match(moved.reason, /must end empty/);

  /* A corridor whose closing balance the simulation does not state is not
     proven empty. */
  const unstated = await assessHop({
    simulationOverrides: {
      postTokenBalances: [token(1, USDC, TAKER, "14621745"), token(2, XSTOCK_MINT, TAKER, "6740740")],
    },
  });
  assert.equal(unstated.ok, false);
  assert.equal(unstated.code, "TOKEN_METADATA_UNAVAILABLE");
});

test("owner-effect firewall: a hop account must be the signer's own", async () => {
  const foreign = await assessHop({
    simulationOverrides: { innerInstructions: [hopOpening({ owner: OTHER })] },
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, "RENT_UNSUPPORTED");
});

test("owner-effect firewall: a size query names only the legs and the reviewed route", async () => {
  /* The Associated Token program asks the token program the size of the
     account it opens. For a mint the reviewed route never names, the query
     itself is refused: the corridor above is no licence for any other mint. */
  const stray = await assessHop({
    simulationOverrides: {
      innerInstructions: [
        hopOpening(),
        {
          index: 1,
          instructions: [
            { program: "spl-token-2022", programId: TOKEN_2022_PROGRAM, parsed: { type: "getAccountDataSize", info: { mint: THIRD_MINT } } },
          ],
        },
      ],
    },
  });
  assert.equal(stray.ok, false);
  assert.equal(stray.code, "UNSAFE_TOKEN_MUTATION");
});

test("owner-effect firewall: a wSOL hop the message closes and a Token-2022 hop kept open reconcile together", async () => {
  /* The other route the venue offered for the same $10 (2026-09-24): USDC →
     SOL on one pool, SOL → SPCX on a second, SPCX → SPCXx on a third. The
     signer's wSOL account carries the SOL hop and the message closes it
     straight back; the SPCX account stays open, empty, with exactly its
     rent. The venue quoted two plain 165-byte accounts. */
  const WSOL_HOP_ACCOUNT = "4FY738TgimHs2ct5K2gFij63UBiJpAWzjv2DrSm5SV1u";
  const staticAccounts = [TAKER, OWNER_TOKEN_ACCOUNT, WSOL_HOP_ACCOUNT, XSTOCK_ACCOUNT, HOP_ACCOUNT, POOL_TOKEN_ACCOUNT];
  const result = await assess({
    order: hopOrder({
      rentFeeLamports: (VENUE_ESTIMATE * 2n).toString(),
      route: [
        { inputMint: USDC, outputMint: WSOL },
        { inputMint: WSOL, outputMint: HOP_MINT },
        { inputMint: HOP_MINT, outputMint: XSTOCK_MINT },
      ],
    }),
    staticAccountCount: staticAccounts.length,
    staticAccounts,
    topLevelPrograms: [MEMO_PROGRAM],
    nativeWrapRoundTrip: { accountIndex: 2, account: WSOL_HOP_ACCOUNT, fundedLamportsRaw: "0", closesToTaker: true },
    simulation: {
      fee: 105000n,
      loadedAddresses: { writable: [], readonly: [] },
      preBalances: [1_000_000_000n, 2_039_280n, 0n, 2_039_280n, 0n, 1n],
      postBalances: [1_000_000_000n - 105_000n - XSTOCK_RENT, 2_039_280n, 0n, 2_039_280n, XSTOCK_RENT, 1n],
      preTokenBalances: [token(1, USDC, TAKER, "24621745"), token(3, XSTOCK_MINT, TAKER, "0")],
      postTokenBalances: [
        token(1, USDC, TAKER, "14621745"),
        token(3, XSTOCK_MINT, TAKER, "6740740"),
        token(4, HOP_MINT, TAKER, "0"),
      ],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "getAccountDataSize", info: { mint: WSOL } } },
            {
              program: "system",
              programId: "11111111111111111111111111111111",
              parsed: {
                type: "createAccount",
                info: { lamports: String(VENUE_ESTIMATE), newAccount: WSOL_HOP_ACCOUNT, owner: TOKEN_PROGRAM, source: TAKER, space: "165" },
              },
            },
            { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "initializeAccount3", info: { account: WSOL_HOP_ACCOUNT, mint: WSOL, owner: TAKER } } },
          ],
        },
        hopOpening({ index: 1 }),
      ],
    },
    accountStates: new Map([[HOP_ACCOUNT, { lamports: XSTOCK_RENT, space: XSTOCK_ACCOUNT_BYTES, owner: TOKEN_2022_PROGRAM }]]),
    rent: LIVE_RENT,
  });
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.reason}`);
  assert.equal(result.proof.nativeWrapRoundTrip, true);
  assert.equal(result.proof.rentProof, "EXACT_MINIMUM");
  /* Only the account that stays open is rent; the wSOL corridor came back. */
  assert.equal(result.proof.durableRentLamports, XSTOCK_RENT.toString());
});
