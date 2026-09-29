import assert from "node:assert/strict";
import test from "node:test";

import { getAddressEncoder, address as toAddress } from "@solana/kit";

import {
  ADDRESS_LOOKUP_TABLE_PROGRAM,
  cctpLookupCompressionMap,
  cctpLookupCoverage,
  cctpReceiveLookupAddresses,
  decodeLookupTable,
  LOOKUP_TABLE_HEADER_BYTES,
  readCctpLookupTable,
  resolveCctpLookupTableAddress,
  CCTP_LOOKUP_TABLE_ENV_BY_DOMAIN,
} from "./cctp-lookup-table.ts";
import {
  buildCreateLookupTableInstruction,
  buildExtendLookupTableInstruction,
  deriveLookupTableAddress,
  LOOKUP_TABLE_EXTEND_CHUNK,
} from "./cctp-lookup-table-build.ts";

/**
 * Why this module exists, in one measurement.
 *
 * The first real Base to Solana transfer compiled to 1,226 bytes of Solana's
 * 1,232-byte limit and Phantom blocked it in red. Phantom's developer
 * documentation names that case exactly. With a table covering the lane's
 * constants the same transfer compiles to 857 bytes. Six bytes of headroom is
 * also a defect without any wallet involved: a third attester signature is
 * sixty-five bytes, and the transfer would stop being constructible after the
 * money had already burned.
 */

const ADDRESS = getAddressEncoder();
const encode = (value) => Buffer.from(ADDRESS.encode(toAddress(value)));

const BASE_REMOTE_TOKEN = `${"0".repeat(24)}833589fcd6edb6e08f4c7c32d4f71b54bda02913`;
const FEE_ACCOUNT = "6zNSMmZGMhNyqZMHkx2L63DLuqh5qoqBhaQJPJD7Fvt3";
const AUTHORITY = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";

/** A lookup table account exactly as the runtime lays one out. */
function tableAccount(addresses, options = {}) {
  const raw = Buffer.alloc(LOOKUP_TABLE_HEADER_BYTES + addresses.length * 32);
  raw.writeUInt32LE(1, 0);
  raw.writeBigUInt64LE(options.deactivationSlot ?? 18_446_744_073_709_551_615n, 4);
  raw.writeBigUInt64LE(400_000_000n, 12);
  raw.writeUInt8(0, 20);
  if (options.authority === null) {
    raw.writeUInt8(0, 21);
  } else {
    raw.writeUInt8(1, 21);
    encode(options.authority ?? AUTHORITY).copy(raw, 22);
  }
  addresses.forEach((entry, index) => encode(entry).copy(raw, LOOKUP_TABLE_HEADER_BYTES + index * 32));
  return Uint8Array.from(raw);
}

function handleWith(answer) {
  return {
    endpoints: [{ role: "primary", host: "solana.example" }],
    timeoutMs: 10,
    retries: 0,
    answered: () => ({ role: "primary", host: "solana.example" }),
    rpc: {
      getAccountInfo: () => ({
        send: async () => {
          if (answer === "throw") throw new Error("endpoint down");
          return { value: answer };
        },
      }),
    },
  };
}

const asAccount = (data, owner = ADDRESS_LOOKUP_TABLE_PROGRAM) => ({
  owner,
  data: [Buffer.from(data).toString("base64"), "base64"],
});

test("the table holds the lane's constants and none of its per-transfer accounts", async function () {
  const addresses = await cctpReceiveLookupAddresses({
    sourceDomain: 6,
    remoteTokenHex: BASE_REMOTE_TOKEN,
    feeRecipientTokenAccount: FEE_ACCOUNT,
  });
  /* Both Circle programmes, the state accounts, the fee account and the two
     system programmes — every one of which is identical on every transfer. */
  for (const constant of [
    "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
    "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "11111111111111111111111111111111",
    FEE_ACCOUNT,
  ]) {
    assert.ok(addresses.includes(constant), `the table is missing ${constant}`);
  }
  assert.equal(new Set(addresses).size, addresses.length, "the table repeats an address");

  /* The replay account is derived per message and the recipient's token account
     per person. An entry for either would be dead weight in every other
     transfer, and this is the property that keeps the table a lane constant. */
  const other = await cctpReceiveLookupAddresses({
    sourceDomain: 6,
    remoteTokenHex: BASE_REMOTE_TOKEN,
    feeRecipientTokenAccount: FEE_ACCOUNT,
    sampleNonce: `0x${"ab".repeat(32)}`,
  });
  assert.deepEqual([...other], [...addresses], "the table changed with the message nonce");
});

test("a different source domain is a different table, because two PDAs follow it", async function () {
  const base = await cctpReceiveLookupAddresses({
    sourceDomain: 6,
    remoteTokenHex: BASE_REMOTE_TOKEN,
    feeRecipientTokenAccount: FEE_ACCOUNT,
  });
  const ethereum = await cctpReceiveLookupAddresses({
    sourceDomain: 0,
    remoteTokenHex: `${"0".repeat(24)}a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`,
    feeRecipientTokenAccount: FEE_ACCOUNT,
  });
  assert.notDeepEqual([...base], [...ethereum]);
});

test("the table decodes the way the runtime lays it out", function () {
  const entries = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "11111111111111111111111111111111"];
  const decoded = decodeLookupTable(tableAccount(entries));
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual([...decoded.addresses], entries);
  assert.equal(decoded.authority, AUTHORITY);
  assert.equal(decoded.deactivationSlot, 18_446_744_073_709_551_615n);

  const frozen = decodeLookupTable(tableAccount(entries, { authority: null }));
  assert.equal(frozen.ok && frozen.authority, null, "a table with no authority reads as frozen");

  assert.equal(decodeLookupTable(new Uint8Array(10)).ok, false, "a short account is not a table");
});

test("every unusable table is a state, never a thrown error and never a refusal", async function () {
  const entries = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"];
  const cases = [
    [null, "ABSENT", null],
    ["9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5", "UNUSABLE", null],
    ["9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5", "UNUSABLE", "throw"],
    [
      "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5",
      "UNUSABLE",
      asAccount(tableAccount(entries), "11111111111111111111111111111111"),
    ],
    [
      "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5",
      "UNUSABLE",
      asAccount(tableAccount(entries, { deactivationSlot: 400_000_000n })),
    ],
    ["9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5", "ACTIVE", asAccount(tableAccount(entries))],
  ];
  for (const [address, expected, answer] of cases) {
    const state = await readCctpLookupTable(handleWith(answer), address);
    assert.equal(state.state, expected, `${address ?? "no address"} → ${expected}`);
  }
});

/**
 * The one property that makes a lookup table safe to use at all.
 *
 * What travels in the message is an *index*. The builder takes that index from
 * the position of an address in the array handed to it, and the runtime resolves
 * it against the table's own storage. A filtered or reordered array would
 * therefore compress an account to an index that resolves, on chain, to a
 * different account — which on this lane means a different place for the money
 * to go.
 */
test("the compression map is the table's complete list, in the table's own order", function () {
  const entries = [
    "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "11111111111111111111111111111111",
  ];
  const table = { state: "ACTIVE", address: "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5", addresses: entries, authority: null };
  const map = cctpLookupCompressionMap({ table, derived: [entries[2]] });
  assert.deepEqual(map[table.address], entries, "the map must not be filtered down to what matched");

  /* A table that holds nothing this build needs is reported as no table rather
     than used for something it was not published for. */
  assert.deepEqual(cctpLookupCompressionMap({ table, derived: ["6zNSMmZGMhNyqZMHkx2L63DLuqh5qoqBhaQJPJD7Fvt3"] }), {});
  assert.deepEqual(cctpLookupCompressionMap({ table: { state: "ABSENT", reason: "" }, derived: entries }), {});
});

test("coverage counts what a table actually does for this build", function () {
  const entries = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "11111111111111111111111111111111"];
  const table = { state: "ACTIVE", address: "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5", addresses: entries, authority: null };
  const coverage = cctpLookupCoverage({ table, derived: [...entries, FEE_ACCOUNT] });
  assert.equal(coverage.covered, 2);
  assert.equal(coverage.total, 3);
  assert.deepEqual([...coverage.missing], [FEE_ACCOUNT]);
});

test("only a well-formed configured address is honoured", function () {
  assert.equal(resolveCctpLookupTableAddress({}), null);
  assert.equal(resolveCctpLookupTableAddress({ RYNTRA_SOLANA_CCTP_LOOKUP_TABLE: "  " }), null);
  assert.equal(resolveCctpLookupTableAddress({ RYNTRA_SOLANA_CCTP_LOOKUP_TABLE: "0xdeadbeef" }), null);
  assert.equal(
    resolveCctpLookupTableAddress({ RYNTRA_SOLANA_CCTP_LOOKUP_TABLE: "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5" }),
    "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5",
  );
});

/**
 * One table per source domain, 2026-09-05.
 *
 * A Base table holds Base's token pair and remote messenger, which compress
 * nothing on an Ethereum receive — so Ethereum's table lives under its own
 * variable, Base's variable keeps the name it has always had, and a domain
 * with no variable answers null rather than borrowing another chain's table.
 */
test("each source domain resolves its own table and never another chain's", function () {
  const both = {
    RYNTRA_SOLANA_CCTP_LOOKUP_TABLE: "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5",
    RYNTRA_SOLANA_CCTP_LOOKUP_TABLE_ETHEREUM: "7XxNTiBLVmy7KiTFWMUWHXRF7fJWZFTX8XEFiSpJvbSj",
  };
  assert.equal(resolveCctpLookupTableAddress(both, 6), "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5");
  assert.equal(resolveCctpLookupTableAddress(both, 0), "7XxNTiBLVmy7KiTFWMUWHXRF7fJWZFTX8XEFiSpJvbSj");
  /* Domain 0 is falsy; a lookup keyed with `||` would fall back to Base here. */
  assert.equal(resolveCctpLookupTableAddress({ RYNTRA_SOLANA_CCTP_LOOKUP_TABLE: both.RYNTRA_SOLANA_CCTP_LOOKUP_TABLE }, 0), null);
  assert.equal(resolveCctpLookupTableAddress(both, 3), null, "a domain this product does not know has no table");
  assert.deepEqual(CCTP_LOOKUP_TABLE_ENV_BY_DOMAIN, {
    6: "RYNTRA_SOLANA_CCTP_LOOKUP_TABLE",
    0: "RYNTRA_SOLANA_CCTP_LOOKUP_TABLE_ETHEREUM",
  });
});

test("the table's address follows the authority and the slot, and nothing else", async function () {
  const first = await deriveLookupTableAddress({ authority: AUTHORITY, recentSlot: 400_000_000n });
  const same = await deriveLookupTableAddress({ authority: AUTHORITY, recentSlot: 400_000_000n });
  const laterSlot = await deriveLookupTableAddress({ authority: AUTHORITY, recentSlot: 400_000_001n });
  assert.equal(first.address, same.address, "the derivation is not deterministic");
  assert.notEqual(first.address, laterSlot.address, "a different slot must be a different table");
  assert.match(first.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test("create and extend encode the layout the address lookup table programme reads", function () {
  const create = buildCreateLookupTableInstruction({
    table: "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5",
    authority: AUTHORITY,
    payer: AUTHORITY,
    recentSlot: 400_000_000n,
    bump: 254,
  });
  assert.equal(String(create.programAddress), ADDRESS_LOOKUP_TABLE_PROGRAM);
  const createData = Buffer.from(create.data);
  assert.equal(createData.readUInt32LE(0), 0, "create is discriminant 0");
  assert.equal(createData.readBigUInt64LE(4), 400_000_000n, "the slot travels in the data as well as the seeds");
  assert.equal(createData.readUInt8(12), 254);
  assert.equal(createData.length, 13);

  const entries = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "11111111111111111111111111111111"];
  const extend = buildExtendLookupTableInstruction({
    table: "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5",
    authority: AUTHORITY,
    payer: AUTHORITY,
    addresses: entries,
  });
  const extendData = Buffer.from(extend.data);
  assert.equal(extendData.readUInt32LE(0), 2, "extend is discriminant 2");
  assert.equal(extendData.readBigUInt64LE(4), 2n);
  assert.equal(extendData.length, 12 + entries.length * 32);
  entries.forEach((entry, index) => {
    assert.equal(
      extendData.subarray(12 + index * 32, 12 + (index + 1) * 32).toString("hex"),
      encode(entry).toString("hex"),
      `address ${index} is not where the programme reads it`,
    );
  });

  /* The authority signs and the payer pays; the table itself is written to. */
  assert.equal(String(create.accounts[0].address), "9F9ARG2M8h7DZGoGaKGTH6BUFsHAnQ9Z97afhkmdJVz5");
  assert.equal(create.accounts[1].role, 2, "the authority is a read-only signer");
  assert.equal(create.accounts[2].role, 3, "the payer is a writable signer");
});

test("an extend refuses more addresses than one can carry, rather than building a packet nobody can send", function () {
  const many = new Array(LOOKUP_TABLE_EXTEND_CHUNK + 1).fill("11111111111111111111111111111111");
  assert.throws(
    () => buildExtendLookupTableInstruction({ table: AUTHORITY, authority: AUTHORITY, payer: AUTHORITY, addresses: many }),
    /at most/,
  );
  assert.throws(
    () => buildExtendLookupTableInstruction({ table: AUTHORITY, authority: AUTHORITY, payer: AUTHORITY, addresses: [] }),
    /does nothing/,
  );
});
