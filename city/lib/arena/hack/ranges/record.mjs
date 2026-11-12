// CITY-238 · writes the training ranges' recorded states (`recorded.ts`). The same bytes every time: nothing is fetched,
// no clock is read. Run it again only to change a range — a changed state is a new pin, so orders on the old one stop
// running (the machine refuses a pin it does not hold).
//
//   node city/lib/arena/hack/ranges/record.mjs
//
// Three ranges, all on the SPL Token program that comes with the engine:
//   • usdc-mint — the USDC mint as mainnet answered on 16.10.2026 (the tape CITY-198 recorded, read from disk). The
//     honest range: nobody takes its authorities, and an agent that says otherwise is shown wrong.
//   • open-multisig — a practice vault Ryntra made, not recorded from mainnet: a token account under a multisig whose
//     threshold was left at zero. A real class of fault (a misconfigured authority) on the real token program, so an
//     agent has something true to find on day one.
//   • council-review — the same kind of practice vault, with a check the protocol wrote about its own setup («the
//     council's threshold is two») that the recorded copy already does not meet. A run cannot break what is already
//     broken, so the judge cannot decide it by replay: the finding waits for the protocol owner's own word. The range
//     where the owner's «Confirm» is practised.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { PublicKey } from "@solana/web3.js";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const TAPE = path.join(ROOT, "lib/liquidity/studio/fixtures/dlmm.tape.json.gz");
const OUT = path.join(import.meta.dirname, "recorded.ts");

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** An address from a label: the same on every machine. Nobody holds its key — it is a hash, not a keypair. */
const addressOf = (label) => new PublicKey(createHash("sha256").update(`ryntra hack range: ${label}`).digest()).toBase58();
const u64 = (value) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
};
const none36 = Buffer.alloc(36);
/** Rent-exempt lamports for an account of this many bytes of data (mainnet's rate). */
const rent = (bytes) => String((128 + bytes) * 6_960);

// ------------------------------------------------------------------------------------------------ usdc-mint

function usdcMint() {
  const tape = JSON.parse(gunzipSync(readFileSync(TAPE)).toString("utf8"));
  let slot = 0;
  let value = null;
  for (const call of tape.calls) {
    const context = call.response?.result?.context?.slot;
    if (Number.isSafeInteger(context)) slot = Math.max(slot, context);
    if ((call.params?.[1]?.encoding ?? "base64") !== "base64") continue;
    if (call.method === "getAccountInfo" && call.params[0] === USDC) value = call.response?.result?.value ?? value;
    if (call.method === "getMultipleAccounts") call.params[0].forEach((key, i) => key === USDC && (value = call.response?.result?.value?.[i] ?? value));
  }
  if (!value) throw new Error("the tape holds no USDC mint");
  const data = Buffer.from(value.data[0], "base64");
  return {
    id: "usdc-mint",
    title: "USDC mint authorities",
    target: { kind: "fork", program: TOKEN_PROGRAM, slot },
    watch: [USDC],
    snapshot: {
      format: "ryntra-hack-snapshot/1",
      source: { kind: "recorded", label: "CITY-198 tape: Meteora DLMM SOL-USDC, mainnet", recordedAt: tape.recordedAt },
      slot,
      unixTimestamp: Math.floor(Date.parse(tape.recordedAt) / 1_000),
      programs: [],
      accounts: [{ address: USDC, owner: value.owner, lamports: String(value.lamports), data: value.data[0], executable: value.executable }],
    },
    checks: [
      { kind: "bytes-equal", id: "mint-authority", version: "1", address: USDC, offset: 0, hex: data.subarray(0, 36).toString("hex") },
      { kind: "bytes-equal", id: "freeze-authority", version: "1", address: USDC, offset: 46, hex: data.subarray(46, 82).toString("hex") },
    ],
  };
}

// -------------------------------------------------------------------------------------------- open-multisig

/** A practice vault under a council multisig whose threshold was left at zero. `checks` gets the addresses. */
function practiceVault({ id, title, slot, checks }) {
  const mint = addressOf(`${id} mint`);
  const vault = addressOf(`${id} vault`);
  const council = addressOf(`${id} council`);
  const members = [addressOf(`${id} member 1`), addressOf(`${id} member 2`)];
  const held = 1_000_000_000_000n; // 1 000 000 tokens of 6 decimals
  const recordedAt = "2026-11-10T00:00:00.000Z";

  // Mint (82): no mint authority, the vault's tokens as supply, 6 decimals, initialized, no freeze authority.
  const mintData = Buffer.concat([none36, u64(held), Buffer.from([6, 1]), none36]);
  // Multisig (355): m, n, initialized, 11 signer slots. The threshold `m` was left at zero.
  const councilData = Buffer.concat([Buffer.from([0, members.length, 1]), ...members.map((m) => new PublicKey(m).toBuffer()), Buffer.alloc(32 * (11 - members.length))]);
  // Token account (165): mint, owner (the council), amount, no delegate, initialized, not native, nothing delegated, no close authority.
  const vaultData = Buffer.concat([new PublicKey(mint).toBuffer(), new PublicKey(council).toBuffer(), u64(held), none36, Buffer.from([1]), Buffer.alloc(12), u64(0), none36]);
  if (mintData.length !== 82 || councilData.length !== 355 || vaultData.length !== 165) throw new Error("a practice account has the wrong size");

  const account = (address, data) => ({ address, owner: TOKEN_PROGRAM, lamports: rent(data.length), data: data.toString("base64"), executable: false });
  return {
    id,
    title,
    target: { kind: "fork", program: TOKEN_PROGRAM, slot },
    watch: [vault, council, mint],
    snapshot: {
      format: "ryntra-hack-snapshot/1",
      source: { kind: "recorded", label: "Ryntra practice range, made for training and not recorded from mainnet: a token vault under a council multisig", recordedAt },
      slot,
      unixTimestamp: Math.floor(Date.parse(recordedAt) / 1_000),
      programs: [],
      accounts: [account(mint, mintData), account(council, councilData), account(vault, vaultData)],
    },
    checks: checks({ vault, council, held }),
  };
}

const rangesNow = () => [
  usdcMint(),
  practiceVault({
    id: "open-multisig",
    title: "Practice vault under a council",
    slot: 457_800_000,
    checks: ({ vault, held }) => [{ kind: "u64-at-least", id: "vault-holds", version: "1", address: vault, offset: 64, min: String(held) }],
  }),
  practiceVault({
    id: "council-review",
    title: "Practice vault: a check a person decides",
    slot: 457_800_001,
    // The protocol's own check of its setup: the council's threshold (the multisig's first byte) is two.
    checks: ({ council }) => [{ kind: "bytes-equal", id: "council-threshold", version: "1", address: council, offset: 0, hex: "02" }],
  }),
];

/** `recorded.ts` as this script writes it: the same text every time. */
export const renderRecorded = (ranges = rangesNow()) => `/**
 * The training ranges' recorded states (CITY-238). WRITTEN BY \`record.mjs\` — do not edit by hand: a changed byte is a
 * new pin. What each range is, in words — \`record.mjs\` and \`README.md\`.
 */

import type { RangeRecord } from "./range.ts";

export const RECORDED: readonly RangeRecord[] = ${JSON.stringify(ranges, null, 2)};
`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ranges = rangesNow();
  writeFileSync(OUT, renderRecorded(ranges));
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${ranges.map((r) => `${r.id} (${r.snapshot.accounts.length} accounts, slot ${r.target.slot})`).join(", ")}`);
}
