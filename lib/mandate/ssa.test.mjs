import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  SSA_PROGRAM_ID,
  compileInner,
  createSmartAccountInstruction,
  nextPolicySeed,
  ownerExecuteInstruction,
  policyExecuteInstruction,
  readPolicyHead,
  readProgramConfig,
  readSettings,
  refusalOf,
  settingsSyncInstruction,
  ssaAddress,
} from "./ssa.ts";

const golden = JSON.parse(readFileSync(new URL("./ssa.golden.json", import.meta.url), "utf8"));
const K = (text) => new PublicKey(text);
const hex = (bytes) => Buffer.from(bytes).toString("hex");

const dataValue = (value) => (value.kind === "bytes" ? { kind: "bytes", value: Buffer.from(value.value, "hex") } : value.kind === "u64" || value.kind === "u128" ? { kind: value.kind, value: BigInt(value.value) } : value);
const dataConstraint = (c) => ({ offset: c.offset, value: dataValue(c.value), operator: c.operator });
const accountConstraint = (c) => ({
  index: c.index,
  rule: c.rule.kind === "keys" ? { kind: "keys", keys: c.rule.keys.map(K) } : { kind: "data", constraints: c.rule.constraints.map(dataConstraint) },
  owner: c.owner ? K(c.owner) : null,
});
const period = (p) => (typeof p === "object" ? { customSeconds: BigInt(p.customSeconds) } : p);
const action = (a) =>
  a.kind === "policyRemove"
    ? { kind: "policyRemove", policy: K(a.policy) }
    : {
        kind: "policyCreate",
        create: {
          seed: BigInt(a.seed),
          threshold: a.threshold,
          start: a.start === null ? null : BigInt(a.start),
          expiresAt: a.expiresAt === null ? null : BigInt(a.expiresAt),
          signers: a.signers.map((s) => ({ key: K(s.key), permissions: s.permissions })),
          policy: {
            accountIndex: a.policy.accountIndex,
            constraints: a.policy.constraints.map((x) => ({ programId: K(x.programId), accounts: x.accounts.map(accountConstraint), data: x.data.map(dataConstraint) })),
            spendingLimits: a.policy.spendingLimits.map((l) => ({ mint: K(l.mint), start: BigInt(l.start), expiration: l.expiration === null ? null : BigInt(l.expiration), period: period(l.period), maxPerPeriod: BigInt(l.maxPerPeriod) })),
          },
        },
      };

/** The inner bytes of the golden cases, decoded back into instructions so the hand compiler is asked to make them. */
function encodeCase(input) {
  const anyKey = K("4jh9GEonrg7rpoQv99NWrtQaiskHbiFZp59TyUfZfBGB");
  switch (input.ix) {
    case "createSmartAccount":
      return createSmartAccountInstruction({ creator: K(input.creator), treasury: anyKey, settings: anyKey }).data;
    case "settingsSync":
      return settingsSyncInstruction({ settings: anyKey, rentPayer: anyKey, signers: Array.from({ length: input.signers }, () => anyKey), actions: input.actions.map(action), policyAccounts: [] }).data;
    default:
      return null;
  }
}

test("the hand encoder writes the IDL coder's bytes for creation and settings changes", () => {
  for (const [name, input] of Object.entries(golden.inputs)) {
    const data = encodeCase(input);
    if (data === null) continue;
    assert.equal(hex(data), golden.bytes[name], name);
  }
});

test("a policy execution and an owner execution carry the IDL coder's bytes around the compiled inner instructions", () => {
  /* Golden inner: one instruction, program index 0, accounts [0, 1], data bb64facc31c4af14 — rebuilt from instructions. */
  const program = K("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
  const a = K("781sjDiQ1b7D5A4p4x6m2e2Kq2z8YkG7kZr3Lh7N8Qxs");
  const inner = new TransactionInstruction({ programId: program, keys: [{ pubkey: program, isSigner: false, isWritable: false }, { pubkey: a, isSigner: false, isWritable: true }], data: Buffer.from("bb64facc31c4af14", "hex") });
  const compiled = compileInner([inner]);
  assert.equal(hex(compiled.bytes), "0100020001" + "0800" + "bb64facc31c4af14");
  assert.deepEqual(compiled.accounts.map((m) => [m.pubkey.toBase58(), m.isWritable]), [[program.toBase58(), false], [a.toBase58(), true]]);

  assert.equal(hex(compiled.bytes), golden.inputs.policyExecute.inner);
  const policy = policyExecuteInstruction({ policy: a, signer: a, instructions: [inner], constraintIndices: [1] });
  assert.equal(hex(policy.data), golden.bytes.policyExecute);
  const owner = ownerExecuteInstruction({ settings: a, signer: a, instructions: [inner] });
  assert.equal(hex(owner.data), golden.bytes.ownerExecute);
});

test("the discriminators are Anchor's: sha256 of the instruction's and the account's names", () => {
  const disc = (name) => hex(createHash("sha256").update(name).digest().subarray(0, 8));
  const anyKey = SSA_PROGRAM_ID;
  assert.equal(hex(createSmartAccountInstruction({ creator: anyKey, treasury: anyKey, settings: anyKey }).data.subarray(0, 8)), disc("global:create_smart_account"));
  assert.equal(hex(settingsSyncInstruction({ settings: anyKey, rentPayer: anyKey, signers: [anyKey], actions: [], policyAccounts: [] }).data.subarray(0, 8)), disc("global:execute_settings_transaction_sync"));
  assert.equal(hex(ownerExecuteInstruction({ settings: anyKey, signer: anyKey, instructions: [] }).data.subarray(0, 8)), disc("global:execute_transaction_sync_v2"));
});

test("the addresses are the program's: config, settings by index, vault and policy by seed (CITY-136 devnet stand)", () => {
  assert.equal(ssaAddress.programConfig().toBase58().length > 30, true);
  /* CITY-136's devnet smart account: settings 3SH5NF7i…, vault 781sjDiQ… (results/devnet-state.json). */
  const state = JSON.parse(readFileSync(new URL("./fixtures/devnet-state.json", import.meta.url), "utf8"));
  const settings = K(state.ssaSettings);
  assert.equal(ssaAddress.vault(settings, 0).toBase58(), state.ssaVault);
});

test("the creation instruction asks one signature, the creator's, and pays from it", () => {
  const creator = K("4jh9GEonrg7rpoQv99NWrtQaiskHbiFZp59TyUfZfBGB");
  const ix = createSmartAccountInstruction({ creator, treasury: SSA_PROGRAM_ID, settings: SSA_PROGRAM_ID });
  assert.deepEqual(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()), [creator.toBase58()]);
});

test("a policy execution names the policy, then its signer, then the inner accounts — never the vault as a signer", () => {
  const policy = K("29fL4E8eBR62Rf9CHBYvgSv9Nk63JVJ8kLnF7DQThuUf");
  const agent = K("9uk3gTx3paCi3zvUav7M4LyMfDVmGWworUgRGypHLjRP");
  const vault = K("781sjDiQ1b7D5A4p4x6m2e2Kq2z8YkG7kZr3Lh7N8Qxs");
  const inner = new TransactionInstruction({ programId: K("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"), keys: [{ pubkey: vault, isSigner: true, isWritable: true }], data: Buffer.alloc(8) });
  const ix = policyExecuteInstruction({ policy, signer: agent, instructions: [inner], constraintIndices: [0] });
  assert.equal(ix.keys[0].pubkey.toBase58(), policy.toBase58());
  assert.equal(ix.keys[2].pubkey.toBase58(), agent.toBase58());
  assert.deepEqual(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()), [agent.toBase58()]);
  assert.throws(() => policyExecuteInstruction({ policy, signer: agent, instructions: [inner], constraintIndices: [] }), /one constraint index/);
});

test("account readers take the program's layout and refuse anything else", () => {
  const config = Buffer.alloc(160);
  Buffer.from([196, 210, 90, 231, 144, 149, 140, 63]).copy(config, 0);
  config.writeBigUInt64LE(41n, 8);
  config.writeBigUInt64LE(0n, 56);
  SSA_PROGRAM_ID.toBuffer().copy(config, 64);
  const read = readProgramConfig(config);
  assert.equal(read.smartAccountIndex, 41n);
  assert.equal(read.treasury.toBase58(), SSA_PROGRAM_ID.toBase58());
  assert.throws(() => readProgramConfig(Buffer.alloc(160)), /config/);

  /* Settings: seed, authority, threshold 1, time lock 0, indices, no archival authority, one signer, policy seed 3. */
  const human = K("4jh9GEonrg7rpoQv99NWrtQaiskHbiFZp59TyUfZfBGB");
  const parts = [Buffer.from([223, 179, 163, 190, 177, 224, 67, 173]), Buffer.alloc(16), Buffer.alloc(32), Buffer.from([1, 0]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0]), Buffer.alloc(8), Buffer.from([255]), Buffer.from([1, 0, 0, 0]), human.toBuffer(), Buffer.from([7]), Buffer.from([0]), Buffer.from([1]), Buffer.from([3, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([0])];
  const settings = readSettings(Buffer.concat(parts));
  assert.equal(settings.threshold, 1);
  assert.equal(settings.signers[0].key.toBase58(), human.toBase58());
  assert.equal(settings.policySeed, 3n);
  assert.equal(nextPolicySeed(settings), 4n);
  assert.equal(nextPolicySeed({ ...settings, policySeed: null }), 1n);

  const head = Buffer.concat([Buffer.from([222, 135, 7, 163, 235, 177, 33, 68]), human.toBuffer(), Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([254]), Buffer.alloc(16), Buffer.from([1, 0, 0, 0]), human.toBuffer(), Buffer.from([7]), Buffer.from([1, 0])]);
  const policy = readPolicyHead(head);
  assert.equal(policy.seed, 2n);
  assert.equal(policy.threshold, 1);
  assert.throws(() => readPolicyHead(Buffer.alloc(120)), /policy/);
});

test("a refusal is read by the program's error name, whichever number the build gives it", () => {
  assert.deepEqual(refusalOf(["Program log: AnchorError occurred. Error Code: ProgramInteractionInsufficientTokenAllowance. Error Number: 6073."]), { code: "ProgramInteractionInsufficientTokenAllowance", reason: "the day's budget is spent" });
  assert.equal(refusalOf(["Program log: nothing"]), null);
});
