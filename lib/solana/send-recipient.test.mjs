import assert from "node:assert/strict";
import test from "node:test";

import { createSolanaRpcHandle } from "./rpc.ts";
import { resolveNativeRecipient, resolveTokenRecipient } from "./send-recipient.ts";
import { SYSTEM_PROGRAM_ADDRESS } from "./native-sol.ts";
import { associatedTokenAccount } from "./transaction.ts";
import {
  SOLANA_MAINNET_USDC_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./send-kinds.ts";

/**
 * Who may receive, decided before anything is built.
 *
 * The two mistakes this module exists to refuse are not typos. Sending native
 * SOL to a program-owned address can lock the lamports where nobody can reach
 * them, and sending a token to a token account of the wrong mint is a transfer
 * the chain will happily refuse *after* the wallet has already been asked to
 * sign. Both are cheap to detect from one account read and expensive to
 * discover later.
 */

/* On the ed25519 curve, so a key can exist for it. Chosen deliberately:
   `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`, this repository's older
   recipient fixture, is off-curve and would be refused here — which is the
   point of the module and a poor stand-in for a person's wallet. */
const WALLET = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const OTHER_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TOKEN_ACCOUNT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function handle() {
  return createSolanaRpcHandle({ network: "mainnet" });
}

/** One `getAccountInfo` answer per address; anything else reads as absent. */
function stubAccounts(accounts) {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const reply = (result) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (body.method !== "getAccountInfo") return reply(null);
    const [address] = body.params;
    return reply({ context: { slot: 1 }, value: accounts[address] ?? null });
  };
  return () => {
    globalThis.fetch = original;
  };
}

function systemWallet() {
  return { lamports: 1_000_000, owner: SYSTEM_PROGRAM_ADDRESS, executable: false, data: ["", "base64"] };
}

function tokenAccount({ mint, owner = WALLET, program = TOKEN_PROGRAM_ID, state = "initialized" }) {
  return {
    lamports: 2_039_280,
    owner: program,
    executable: false,
    data: { program: "spl-token", parsed: { type: "account", info: { mint, owner, state } } },
  };
}

function mintAccount(program = TOKEN_PROGRAM_ID) {
  return {
    lamports: 1_461_600,
    owner: program,
    executable: false,
    data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6 } } },
  };
}

test("an existing System wallet is a safe native recipient", async () => {
  const restore = stubAccounts({ [WALLET]: systemWallet() });
  try {
    const resolved = await resolveNativeRecipient(handle(), WALLET);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.kind, "WALLET_OWNER");
    assert.equal(resolved.owner, WALLET);
    assert.equal(resolved.destinationTokenAccount, null);
    assert.equal(resolved.createsAccount, false);
  } finally {
    restore();
  }
});

test("an unfunded on-curve address is a safe native recipient the transfer creates", async () => {
  const restore = stubAccounts({});
  try {
    const resolved = await resolveNativeRecipient(handle(), WALLET);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.createsAccount, true);
  } finally {
    restore();
  }
});

test("a mint is never a native recipient", async () => {
  const restore = stubAccounts({ [SOLANA_MAINNET_USDC_MINT]: mintAccount() });
  try {
    const resolved = await resolveNativeRecipient(handle(), SOLANA_MAINNET_USDC_MINT);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "UNSAFE_SOL_RECIPIENT");
    assert.match(resolved.reason, /program/i);
  } finally {
    restore();
  }
});

test("an unfunded program-derived address is never a native recipient", async () => {
  const pda = await associatedTokenAccount({
    owner: WALLET,
    mint: SOLANA_MAINNET_USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const restore = stubAccounts({});
  try {
    /* The account does not exist, so nothing on chain says "do not send here".
       Only the address itself does: it is off the ed25519 curve, so no key can
       ever sign for it and the lamports would stay where they landed. */
    const resolved = await resolveNativeRecipient(handle(), pda);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "UNSAFE_SOL_RECIPIENT");
  } finally {
    restore();
  }
});

test("a token recipient with no account yet resolves to the derived ATA and creates it", async () => {
  const ata = await associatedTokenAccount({
    owner: WALLET,
    mint: SOLANA_MAINNET_USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const restore = stubAccounts({ [WALLET]: systemWallet() });
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: WALLET,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.kind, "WALLET_OWNER");
    assert.equal(resolved.destinationTokenAccount, ata);
    assert.equal(resolved.createsAccount, true);
  } finally {
    restore();
  }
});

test("a token recipient whose ATA already exists creates nothing", async () => {
  const ata = await associatedTokenAccount({
    owner: WALLET,
    mint: SOLANA_MAINNET_USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const restore = stubAccounts({
    [WALLET]: systemWallet(),
    [ata]: tokenAccount({ mint: SOLANA_MAINNET_USDC_MINT }),
  });
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: WALLET,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.createsAccount, false);
    assert.equal(resolved.destinationTokenAccount, ata);
  } finally {
    restore();
  }
});

test("an entered token account of the right mint is accepted as it is", async () => {
  const restore = stubAccounts({
    [TOKEN_ACCOUNT]: tokenAccount({ mint: SOLANA_MAINNET_USDC_MINT }),
  });
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: TOKEN_ACCOUNT,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.kind, "EXISTING_TOKEN_ACCOUNT");
    assert.equal(resolved.destinationTokenAccount, TOKEN_ACCOUNT);
    assert.equal(resolved.owner, WALLET);
    assert.equal(resolved.createsAccount, false);
  } finally {
    restore();
  }
});

test("an entered token account of another mint is refused, not silently redirected", async () => {
  const restore = stubAccounts({ [TOKEN_ACCOUNT]: tokenAccount({ mint: OTHER_MINT }) });
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: TOKEN_ACCOUNT,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "RECIPIENT_MINT_MISMATCH");
  } finally {
    restore();
  }
});

test("an entered token account under the other token program is refused", async () => {
  const restore = stubAccounts({
    [TOKEN_ACCOUNT]: tokenAccount({ mint: SOLANA_MAINNET_USDC_MINT, program: TOKEN_2022_PROGRAM_ID }),
  });
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: TOKEN_ACCOUNT,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "RECIPIENT_PROGRAM_MISMATCH");
  } finally {
    restore();
  }
});

test("a mint entered as a token recipient is malformed, not a destination", async () => {
  const restore = stubAccounts({ [SOLANA_MAINNET_USDC_MINT]: mintAccount() });
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: SOLANA_MAINNET_USDC_MINT,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "RECIPIENT_ACCOUNT_MALFORMED");
  } finally {
    restore();
  }
});

test("an unfunded off-curve address cannot own a token account either", async () => {
  const pda = await associatedTokenAccount({
    owner: WALLET,
    mint: OTHER_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const restore = stubAccounts({});
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: pda,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "OFF_CURVE_OWNER_UNSUPPORTED");
  } finally {
    restore();
  }
});

test("a frozen destination token account is refused before the wallet is opened", async () => {
  const restore = stubAccounts({
    [TOKEN_ACCOUNT]: tokenAccount({ mint: SOLANA_MAINNET_USDC_MINT, state: "frozen" }),
  });
  try {
    const resolved = await resolveTokenRecipient({
      handle: handle(),
      address: TOKEN_ACCOUNT,
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "RECIPIENT_FROZEN");
    assert.match(resolved.reason, /frozen/i);
  } finally {
    restore();
  }
});

test("a malformed address is refused without any network read", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("no read should happen for an address that is not one");
  };
  try {
    const resolved = await resolveNativeRecipient(handle(), "claude-not-an-address");
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "RECIPIENT_ACCOUNT_MALFORMED");
  } finally {
    globalThis.fetch = original;
  }
});
