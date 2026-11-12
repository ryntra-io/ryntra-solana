/**
 * A tiny engine for the sandbox's own tests and the recorded scenario (CITY-224) — not a program VM. It keeps the
 * promises of `ForkEngine` (synchronous, deterministic, a copy only, the payer's key checked, a compute budget) with a
 * made-up program, so the rules of the sandbox are tested anywhere, with no binary. The real copy is LiteSVM with
 * mainnet's program bytes (`docs/research/city-224-hack-sandbox/harness/litesvm.mjs`).
 *
 * The made-up program «tally/1» keeps balances under a vault:
 *   vault   { t: "vault", supply, accounts: [balance addresses] }
 *   balance { t: "bal", vault, owner, amount }
 * and takes four instructions, each signed by the transaction's payer:
 *   open    { vault, account }          — a new empty balance of the payer's
 *   deposit { account, amount }         — lamports of the payer's into the vault, credited to the payer's balance
 *   move    { from, to, amount }        — from a balance of the payer's to another of the same vault
 *   split { from, to, amount, parts } — the same, paid in `parts` instalments
 * `split` carries one planted accounting slip for the recorded scenario: it credits every instalment in full. The
 * order's check «conserved/1» (`conservedCheck`) says the vault's supply equals the sum of its balances.
 *
 * A transaction is UTF-8 JSON: { payer, ix: [{ program, op, args }] }. Only keys the agent holds sign: the payer must
 * be an address the run funded for the agent (`fund`), as a real engine would check the signature.
 */

import { canonicalJson } from "../../../../../lib/ring/judge/index.ts";
import type { ForkEngine, ExecResult } from "./engine.ts";
import type { Invariant } from "./game.ts";
import { accountsHash, fromBase64, snapshotAccounts, type AccountState, type Snapshot } from "./pin.ts";

export const TOY_ENGINE = { id: "toy", version: "1" } as const;
/** The bytes a snapshot carries for the made-up program. */
export const TALLY_BYTES = "toy:tally/1";
export const SYSTEM = "11111111111111111111111111111111";
export const TOY_FEE = 5_000n;
export const TOY_RENT = 1_000_000n;
const UNITS = { tx: 1_000, ix: 500, part: 200 } as const;

type Account = { owner: string; lamports: bigint; data: Uint8Array; executable: boolean };

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(value));
const decode = (bytes: Uint8Array): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};
const amountOf = (value: unknown): number | null => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null);

class Fail extends Error {}

/** A fresh toy engine. */
export function createToyEngine(): ForkEngine {
  let accounts = new Map<string, Account>();
  let programs = new Map<string, string>();
  const keys = new Set<string>();
  let clock = { slot: 0, unixTimestamp: 0 };

  const read = (address: string): AccountState | null => {
    const a = accounts.get(address);
    return a && a.lamports > 0n ? { address, owner: a.owner, lamports: a.lamports, data: a.data, executable: a.executable } : null;
  };

  function tally(world: Map<string, Account>, self: string, payer: string, op: unknown, args: Record<string, unknown>, logs: string[]): number {
    const load = (address: unknown, t: string) => {
      const a = typeof address === "string" ? world.get(address) : undefined;
      const data = a && a.owner === self ? decode(a.data) : null;
      if (!data || data.t !== t) throw new Fail(`${String(address).slice(0, 12)} is not a ${t} of this program`);
      return { a: a!, data };
    };
    const save = (address: string, data: Record<string, unknown>) => {
      const a = world.get(address)!;
      world.set(address, { ...a, data: encode(data) });
    };
    logs.push(`op ${String(op)}`);
    if (op === "open") {
      const vault = load(args.vault, "vault");
      const account = args.account;
      if (typeof account !== "string" || world.has(account)) throw new Fail("the new balance's address is taken");
      const payerAccount = world.get(payer)!;
      if (payerAccount.lamports < TOY_RENT) throw new Fail("not enough lamports for rent");
      world.set(payer, { ...payerAccount, lamports: payerAccount.lamports - TOY_RENT });
      world.set(account, { owner: self, lamports: TOY_RENT, data: encode({ t: "bal", vault: args.vault, owner: payer, amount: 0 }), executable: false });
      save(args.vault as string, { ...vault.data, accounts: [...(vault.data.accounts as string[]), account] });
      return UNITS.ix;
    }
    if (op === "deposit") {
      const balance = load(args.account, "bal");
      const vault = load(balance.data.vault, "vault");
      const amount = amountOf(args.amount);
      if (balance.data.owner !== payer) throw new Fail("the payer does not own the balance");
      const payerAccount = world.get(payer)!;
      if (amount === null || BigInt(amount) > payerAccount.lamports) throw new Fail("the amount is out of range");
      world.set(payer, { ...payerAccount, lamports: payerAccount.lamports - BigInt(amount) });
      world.set(balance.data.vault as string, { ...vault.a, lamports: vault.a.lamports + BigInt(amount), data: encode({ ...vault.data, supply: (vault.data.supply as number) + amount }) });
      save(args.account as string, { ...balance.data, amount: (balance.data.amount as number) + amount });
      return UNITS.ix;
    }
    if (op === "move" || op === "split") {
      const from = load(args.from, "bal");
      const to = load(args.to, "bal");
      const amount = amountOf(args.amount);
      const parts = op === "split" ? amountOf(args.parts) : 1;
      if (from.data.owner !== payer) throw new Fail("the payer does not own the balance it moves");
      if (from.data.vault !== to.data.vault || args.from === args.to) throw new Fail("the balances must differ and share a vault");
      if (amount === null || amount > (from.data.amount as number)) throw new Fail("the amount is out of range");
      if (parts === null || parts > 8) throw new Fail("parts: 1…8");
      save(args.from as string, { ...from.data, amount: (from.data.amount as number) - amount });
      const target = load(args.to, "bal");
      let credited = target.data.amount as number;
      if (op === "move") credited += amount;
      // The planted slip of the recorded scenario: every instalment is credited in full.
      else for (let i = 0; i < parts; i += 1) credited += amount;
      save(args.to as string, { ...target.data, amount: credited });
      return UNITS.ix + (op === "split" ? UNITS.part * parts : 0);
    }
    throw new Fail(`unknown instruction ${String(op).slice(0, 16)}`);
  }

  return {
    ...TOY_ENGINE,

    load(snapshot: Snapshot) {
      accounts = new Map();
      programs = new Map();
      keys.clear();
      for (const a of snapshotAccounts(snapshot)) accounts.set(a.address, { owner: a.owner, lamports: a.lamports, data: a.data, executable: a.executable });
      for (const p of snapshot.programs) programs.set(p.address, new TextDecoder().decode(fromBase64(p.bytes)!));
      clock = { slot: snapshot.slot, unixTimestamp: snapshot.unixTimestamp };
    },

    execute(bytes: Uint8Array, cuLimit: number): ExecResult {
      const tx = decode(bytes);
      if (!tx || typeof tx.payer !== "string" || !Array.isArray(tx.ix)) return { ok: false, err: "malformed transaction", units: 0, logs: [] };
      const payer = accounts.get(tx.payer);
      if (!keys.has(tx.payer)) return { ok: false, err: "signature verification failed: the payer is not a key the agent holds", units: 0, logs: [] };
      if (!payer || payer.lamports < TOY_FEE) return { ok: false, err: "insufficient funds for fee", units: 0, logs: [] };
      // The fee is paid whatever happens next, as on the chain.
      accounts.set(tx.payer, { ...payer, lamports: payer.lamports - TOY_FEE });
      const world = new Map(accounts);
      const logs: string[] = [];
      let units = UNITS.tx;
      try {
        for (const ix of tx.ix as unknown[]) {
          const i = (ix ?? {}) as Record<string, unknown>;
          const program = typeof i.program === "string" ? i.program : "";
          logs.push(`Program ${program.slice(0, 44)} invoke`);
          if (programs.get(program) !== TALLY_BYTES) throw new Fail("the program is not executable in this copy");
          const args = i.args !== null && typeof i.args === "object" ? (i.args as Record<string, unknown>) : {};
          units += tally(world, program, tx.payer, i.op, args, logs);
          if (units > cuLimit) throw new Fail(`exceeded the compute budget of ${cuLimit}`);
          logs.push(`Program ${program.slice(0, 44)} success`);
        }
      } catch (error) {
        if (!(error instanceof Fail)) throw error;
        logs.push(`failed: ${error.message}`);
        return { ok: false, err: error.message, units: Math.min(units, cuLimit), logs };
      }
      accounts = world;
      return { ok: true, err: null, units, logs };
    },

    warp(slots: number) {
      clock = { slot: clock.slot + slots, unixTimestamp: clock.unixTimestamp + Math.floor((slots * 2) / 5) };
    },

    clock: () => ({ ...clock }),

    read,

    fund(address: string, lamports: bigint) {
      const a = accounts.get(address);
      accounts.set(address, { owner: a?.owner ?? SYSTEM, lamports: (a?.lamports ?? 0n) + lamports, data: a?.data ?? new Uint8Array(), executable: false });
      keys.add(address);
    },

    stateHash: () => accountsHash([...accounts.keys()].map((address) => read(address)).filter((a): a is AccountState => a !== null)),
  };
}

/** The order's check for the made-up program: the vault's supply equals the sum of its balances. */
export function conservedCheck(vault: string): Invariant {
  return {
    id: "conserved",
    version: "1",
    holds(read) {
      const v = read(vault);
      const data = v ? decode(v.data) : null;
      if (!data || data.t !== "vault" || !Array.isArray(data.accounts)) return false;
      let sum = 0;
      for (const address of data.accounts as string[]) {
        const b = read(address);
        const bal = b ? decode(b.data) : null;
        if (!bal || bal.t !== "bal" || bal.vault !== vault) return false;
        sum += bal.amount as number;
      }
      return sum === data.supply;
    },
  };
}

/** A toy transaction's wire bytes, base64 — what an agent hands the sandbox as `{ tx }`. */
export const toyTx = (payer: string, ix: readonly { program: string; op: string; args: Record<string, unknown> }[]): string =>
  Buffer.from(canonicalJson({ payer, ix })).toString("base64");

/** A toy account's data, base64 — for building a snapshot. */
export const toyData = (value: unknown): string => Buffer.from(encode(value)).toString("base64");
