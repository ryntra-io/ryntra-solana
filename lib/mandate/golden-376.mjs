/* The mandates that live today, as bytes: every shape the engine writes (a buy of any coin, a regular buy, a
   coin she sells, a coin the agent keeps — on Jupiter and on devnet's pool, under Token and Token-2022), its policies,
   its enable, stop and withdraw transactions. Written once from `master` before the copy's rule (`fixtures/
   policies-golden-376.json`); `golden-376.test.mjs` proves the copy's rule changed none of them by a byte. No network. */
import { createHash } from "node:crypto";

import { Keypair, PublicKey } from "@solana/web3.js";

import { planEnable, planStop, planStopAndWithdraw, planWithdraw, planWithdrawHeld, unsignedTransaction } from "./human.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, settingsSyncInstruction, ssaAddress } from "./ssa.ts";
import { mandatePolicy, salePolicyOf } from "./terms.ts";
import { TOKEN_2022_PROGRAM_ID, USDC_MINTS } from "./token-2022.ts";

const key = (name) => Keypair.fromSeed(createHash("sha256").update(`city-376 golden ${name}`).digest()).publicKey;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BLOCKHASH = "11111111111111111111111111111111";
const NOW = 1_762_000_000n;
const HUMAN = key("human");
const AGENT = key("agent");
const COIN = key("coin");
const COIN22 = key("coin-2022");
const POOL = key("pool");
const USDC = USDC_MINTS[0];
const CONFIG = { smartAccountIndex: 41n, creationFee: 0n, treasury: key("treasury") };
const SETTINGS = ssaAddress.settings(9n);
const PRESENT = { kind: "present", settings: SETTINGS, state: { signers: [{ key: HUMAN, permissions: 7 }], threshold: 1, timeLock: 0, policySeed: 4n } };

const base = (extra = {}) => ({ human: HUMAN, agent: AGENT, budgetMint: NATIVE_MINT, perTrade: 20_000_000n, perDay: 100_000_000n, slippageBps: 100, expiresAt: NOW + 7n * 86_400n, venue: { kind: "jupiter" }, ...extra });
const dlmm = { kind: "dlmm", pool: POOL };

/** Every shape the engine writes today, by name. */
export const SHAPES = Object.freeze({
  "jupiter buy SOL": { terms: base(), receive: [COIN] },
  "jupiter buy USDC": { terms: base({ budgetMint: USDC, perTrade: 10_000_000n, perDay: 50_000_000n }), receive: [COIN] },
  "jupiter buy Token-2022 coin": { terms: base(), receive: [{ mint: COIN22, program: TOKEN_2022_PROGRAM_ID }] },
  "jupiter regular buy": { terms: base({ fixedBuy: { amountIn: 20_000_000n, outputMint: COIN, minOut: 1_000n } }), receive: [] },
  "jupiter regular buy Token-2022": { terms: base({ fixedBuy: { amountIn: 20_000_000n, outputMint: COIN22, minOut: 1_000n, outputProgram: TOKEN_2022_PROGRAM_ID } }), receive: [] },
  "jupiter sale of her coin": { terms: base({ budgetMint: COIN22, budgetCoin: { program: TOKEN_2022_PROGRAM_ID, decimals: 6, transferFee: true }, perTrade: 5_000_000n, perDay: 20_000_000n, fixedBuy: { amountIn: 5_000_000n, outputMint: NATIVE_MINT, minOut: 10_000n } }), receive: [] },
  "jupiter agent keeps a coin": { terms: base({ heldCoin: { mint: COIN, program: TOKEN_PROGRAM_ID, dailyMax: 777_000n } }), receive: [COIN] },
  "jupiter agent keeps a Token-2022 coin": { terms: base({ heldCoin: { mint: COIN22, program: TOKEN_2022_PROGRAM_ID, dailyMax: 999_000n } }), receive: [{ mint: COIN22, program: TOKEN_2022_PROGRAM_ID }] },
  "devnet buy": { terms: base({ venue: dlmm }), receive: [COIN] },
  "devnet regular buy": { terms: base({ venue: dlmm, fixedBuy: { amountIn: 20_000_000n, outputMint: COIN, minOut: 1_000n } }), receive: [] },
  "devnet sale of her coin": { terms: base({ venue: dlmm, budgetMint: COIN, budgetCoin: { program: TOKEN_PROGRAM_ID, decimals: 6 }, perTrade: 5_000_000n, perDay: 20_000_000n, fixedBuy: { amountIn: 5_000_000n, outputMint: NATIVE_MINT, minOut: 10_000n } }), receive: [] },
  "devnet agent keeps a coin": { terms: base({ venue: dlmm, heldCoin: { mint: COIN, program: TOKEN_PROGRAM_ID, dailyMax: 555_000n } }), receive: [COIN] },
});

const policyBytes = (seed, policy) =>
  sha(settingsSyncInstruction({ settings: SETTINGS, rentPayer: HUMAN, signers: [HUMAN], policyAccounts: [ssaAddress.policy(SETTINGS, seed)], actions: [{ kind: "policyCreate", create: { seed, policy, signers: [{ key: AGENT, permissions: 7 }], threshold: 1, start: null, expiresAt: NOW + 7n * 86_400n } }] }).data);

const txs = (payer, groups) => groups.map((instructions) => sha(unsignedTransaction(payer, instructions, BLOCKHASH).message.serialize()));

/** The bytes of one shape: its policies, its enables (a new account, an account she has), its stop and withdraws. */
export function shapeBytes(shape) {
  const out = {};
  for (const [name, account] of [["new", { kind: "absent", config: CONFIG }], ["present", PRESENT]]) {
    const plan = planEnable({ cluster: shape.terms.venue.kind === "jupiter" ? "mainnet" : "devnet", terms: shape.terms, account, fund: 100_000_000n, nowSeconds: NOW, receiveMints: shape.receive, agentFeeLamports: 5_000_000n });
    const accounts = { vault: plan.mandate.vault, budgetAccount: plan.mandate.budgetAccount };
    out[`${name}:mandate`] = sha(Buffer.from(JSON.stringify({ ...plan.mandate, terms: null }, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof PublicKey ? v.toBase58() : v))));
    out[`${name}:buy policy`] = policyBytes(plan.mandate.policySeed, mandatePolicy(shape.terms, accounts));
    if (shape.terms.heldCoin) out[`${name}:sale policy`] = policyBytes(plan.mandate.policySeed + 1n, salePolicyOf(shape.terms, accounts));
    out[`${name}:enable`] = txs(HUMAN, plan.transactions);
    out[`${name}:stop`] = txs(HUMAN, [planStop(plan.mandate)]);
    out[`${name}:stop and withdraw`] = txs(HUMAN, [planStopAndWithdraw(plan.mandate, 12_345n)]);
    out[`${name}:withdraw kept open`] = txs(HUMAN, [planWithdraw(plan.mandate, 12_345n, { keepOpen: true })].filter((ixs) => ixs.length));
    if (shape.terms.heldCoin) out[`${name}:withdraw held`] = txs(HUMAN, [planWithdrawHeld(plan.mandate, { ...shape.terms.heldCoin, decimals: 6, balance: 4_321n, transferFee: shape.terms.heldCoin.program.equals(TOKEN_2022_PROGRAM_ID) })]);
  }
  return out;
}

export const goldenOf = () => Object.fromEntries(Object.entries(SHAPES).map(([name, shape]) => [name, shapeBytes(shape)]));

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()) && process.argv.includes("--write")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL("./fixtures/policies-golden-376.json", import.meta.url), `${JSON.stringify(goldenOf(), null, 1)}\n`);
  console.log("written");
}
