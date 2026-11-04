// Run from repo root: node --test lib/bots/ladder/no-signing.test.mjs
//
// «Жоден шлях не підписує за людину» — no path of the ladder composer signs for the person.
//
// 1. The server's paths (the engine's builder and relay, the routes) hold nothing that could sign: no keypair, no
//    secret, no signing call, and of the mainnet lane's modules they import only the readers and the cancel builder.
// 2. The relay forwards only what already carries the person's own real signature, every one of a bundle checked
//    before the first is sent, and sends the bytes it was given — unchanged.
// 3. The pure modules the window and the server share never touch a key.
// The browser's part — its order accounts' keys never leaving it, the wallet asked once — is `city/lib/bots/ladder.test.mjs`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { DLMM_DISCRIMINATOR } from "../../solana/limits/dlmm-tx.ts";
import { DLMM_PROGRAM } from "../../solana/limits/model.ts";
import { DEVNET_GENESIS } from "./connection.server.ts";
import { checkLadderBundle, relayLadder } from "./relay.server.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const walk = (dir) =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const file = path.posix.join(dir, name);
    return statSync(path.join(ROOT, file)).isDirectory() ? walk(file) : [file];
  });

const SERVER = [...walk("lib/bots/ladder").filter((file) => /\.server\.ts$/.test(file)), ...walk("app/api/bots/ladder").filter((file) => file.endsWith("route.ts"))];
const SHARED = walk("lib/bots/ladder").filter((file) => file.endsWith(".ts") && !file.endsWith(".server.ts"));

/** Code without its comments: the rules are about what runs, not what the prose says. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the server's ladder paths exist where this test looks", () => {
  assert.ok(SERVER.includes("lib/bots/ladder/build.server.ts"));
  assert.ok(SERVER.includes("lib/bots/ladder/relay.server.ts"));
  assert.ok(SERVER.includes("app/api/bots/ladder/submit/route.ts"));
  assert.ok(SERVER.length >= 8, SERVER.join(", "));
});

test("no server path of the ladder can sign: no keypair, no secret, no signing call", () => {
  const forbidden = [
    [/\.sign\s*\(/, "a .sign( call"],
    [/partialSign/, "partialSign"],
    [/signTransaction|signAllTransactions|signMessage/, "a wallet signing call"],
    [/\bKeypair\b/, "a Keypair"],
    [/fromSecretKey|fromSeed|secretKey/, "a secret key"],
    [/process\.env\s*\[\s*[^\]]*(SECRET|PRIVATE|KEY)/i, "a secret from the environment"],
    [/BETA_TOKEN_SECRET|ORDER_KEY_ENV|cosignDlmmPlace|withDlmmOrderKey|dlmmOrderKey/, "the limits lane's order-key cosigner"],
    [/launch\/config\.server|executor|kms/i, "an executor or KMS key"],
  ];
  for (const file of SERVER) {
    const text = code(read(file));
    for (const [pattern, what] of forbidden) assert.doesNotMatch(text, pattern, `${file} holds ${what}`);
  }
});

test("of the mainnet lane's modules the server takes only readers and the cancel builder", () => {
  const allowed = {
    "../../solana/limits/dlmm-tx.ts": ["inspectDlmmTransaction", "signedByAll"],
    "../../solana/limits/dlmm.server.ts": ["buildDlmmCancel"],
    "../../solana/limits/model.ts": ["DLMM_PROGRAM", "DLMM_LIMIT_MAX_BINS", "dlmmIsAskSide"],
  };
  for (const file of [...SERVER, ...SHARED]) {
    const text = read(file);
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
      const [, names, from] = match;
      if (!from.includes("solana/limits/")) continue;
      const list = allowed[from];
      assert.ok(list, `${file} imports ${from}`);
      for (const name of names.split(",").map((item) => item.trim().replace(/^type\s+/, "")).filter(Boolean)) {
        assert.ok(list.includes(name), `${file} takes ${name} from ${from}`);
      }
    }
    assert.doesNotMatch(text, /from\s+"[^"]*solana\/limits\/(trigger|submit|review|chain)\.server/, `${file} reaches the mainnet lane's live paths`);
  }
});

test("the network is devnet by construction: the server never opens a mainnet connection", () => {
  for (const file of SERVER) {
    const text = code(read(file));
    assert.doesNotMatch(text, /resolveEndpoint\(\s*"mainnet"|limitsConnection|mainnet-beta|api\.mainnet/, `${file} reaches mainnet`);
  }
  assert.match(read("lib/bots/ladder/connection.server.ts"), /resolveEndpoint\("devnet"\)/);
});

test("the pure modules the window and the server share never touch a key", () => {
  for (const file of SHARED) {
    const text = code(read(file));
    assert.doesNotMatch(text, /\.sign\s*\(|partialSign|Keypair|secretKey|fromSeed/, `${file} touches a key`);
  }
});

/* ------------------------------------------------------------------ relay */

const owner = Keypair.generate();
const stranger = Keypair.generate();
const POOL = Keypair.generate().publicKey;
const OTHER_POOL = Keypair.generate().publicKey;
const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const SOL = new PublicKey("So11111111111111111111111111111111111111112");
const { createProgram } = createRequire(import.meta.url)("@meteora-ag/dlmm");
const anchor = createProgram(new Connection("http://127.0.0.1:1"), { cluster: "devnet" });
const blockhash = () => Keypair.generate().publicKey.toBase58();

async function placeTx({ order, pool = POOL, payer = owner.publicKey, bins = [{ id: -10, amount: new BN(5_000_000) }, { id: -30, amount: new BN(5_000_000) }] }) {
  const ix = await anchor.methods
    .placeLimitOrder({ isAskSide: false, relativeBin: null, bins, padding: new Array(16).fill(0) }, { slices: [] })
    .accountsPartial({
      lbPair: pool,
      binArrayBitmapExtension: anchor.programId,
      reserve: Keypair.generate().publicKey,
      tokenMint: USDC,
      tokenProgram: TOKEN_PROGRAM_ID,
      limitOrder: order.publicKey,
      userToken: getAssociatedTokenAddressSync(USDC, owner.publicKey),
      sender: owner.publicKey,
      payer: owner.publicKey,
      owner: owner.publicKey,
    })
    .instruction();
  const tx = new Transaction({ feePayer: payer, blockhash: blockhash(), lastValidBlockHeight: 1 }).add(ix);
  return tx;
}

/** The person's wallet signs the exact message; then the order account, as the browser does. */
function signWith(tx, signers) {
  const exact = VersionedTransaction.deserialize(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  exact.sign(signers);
  return Buffer.from(exact.serialize()).toString("base64");
}

function cancelTx(order) {
  const ata = (mint) => getAssociatedTokenAddressSync(mint, owner.publicKey, true, TOKEN_PROGRAM_ID);
  const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const program = new PublicKey(DLMM_PROGRAM);
  const cancel = new TransactionInstruction({
    programId: program,
    keys: [meta(POOL, false, true), meta(program), meta(Keypair.generate().publicKey), meta(Keypair.generate().publicKey), meta(SOL), meta(USDC), meta(order, false, true), meta(ata(SOL), false, true), meta(ata(USDC), false, true), meta(owner.publicKey, true), meta(TOKEN_PROGRAM_ID), meta(TOKEN_PROGRAM_ID)],
    data: Buffer.concat([Buffer.from(DLMM_DISCRIMINATOR.cancel, "hex"), Buffer.alloc(8)]),
  });
  const close = new TransactionInstruction({ programId: program, keys: [meta(order, false, true), meta(owner.publicKey, true), meta(owner.publicKey, false, true)], data: Buffer.from(DLMM_DISCRIMINATOR.close, "hex") });
  return new Transaction({ feePayer: owner.publicKey, blockhash: blockhash(), lastValidBlockHeight: 1 }).add(cancel, close);
}

const pools = [POOL.toBase58()];
const check = (kind, items) => checkLadderBundle({ owner: owner.publicKey.toBase58(), kind, items, pools });

test("the relay passes a placement the wallet and its order account both signed", async () => {
  const order = Keypair.generate();
  const wire = signWith(await placeTx({ order }), [owner, order]);
  assert.deepEqual(check("place", [{ wireBase64: wire, limitOrder: order.publicKey.toBase58() }]), { ok: true });
});

test("the relay refuses what the person did not sign", async () => {
  const order = Keypair.generate();
  const tx = await placeTx({ order });
  const onlyOrder = check("place", [{ wireBase64: signWith(tx, [order]), limitOrder: order.publicKey.toBase58() }]);
  assert.equal(onlyOrder.ok, false);
  assert.equal(onlyOrder.code, "NOT_SIGNED", "the order account alone is not the person");
  const onlyWallet = check("place", [{ wireBase64: signWith(tx, [owner]), limitOrder: order.publicKey.toBase58() }]);
  assert.equal(onlyWallet.code, "NOT_SIGNED", "a missing order signature is never filled in by the relay");
  const unsigned = check("place", [{ wireBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), limitOrder: order.publicKey.toBase58() }]);
  assert.equal(unsigned.ok, false);
  /* A signature that is not over this message is no signature. */
  const forged = VersionedTransaction.deserialize(Buffer.from(signWith(tx, [owner, order]), "base64"));
  forged.signatures[0] = Uint8Array.from(forged.signatures[0]).fill(7);
  assert.equal(check("place", [{ wireBase64: Buffer.from(forged.serialize()).toString("base64"), limitOrder: order.publicKey.toBase58() }]).code, "NOT_SIGNED");
});

test("the relay refuses someone else paying, an unlisted pool, an order that is not the wallet's own", async () => {
  const order = Keypair.generate();
  const paidByStranger = check("place", [{ wireBase64: signWith(await placeTx({ order, payer: stranger.publicKey }), [stranger, owner, order]), limitOrder: order.publicKey.toBase58() }]);
  assert.equal(paidByStranger.ok, false);
  const elsewhere = check("place", [{ wireBase64: signWith(await placeTx({ order, pool: OTHER_POOL }), [owner, order]), limitOrder: order.publicKey.toBase58() }]);
  assert.equal(elsewhere.code, "POOL_NOT_LISTED");
  const other = Keypair.generate();
  const named = check("place", [{ wireBase64: signWith(await placeTx({ order }), [owner, order]), limitOrder: other.publicKey.toBase58() }]);
  assert.equal(named.ok, false, "the order account must be the one the transaction opens");
});

test("a cancellation passes on the wallet's signature alone and returns the money to the wallet", () => {
  const order = Keypair.generate().publicKey;
  const wire = signWith(cancelTx(order), [owner]);
  assert.deepEqual(check("cancel", [{ wireBase64: wire, limitOrder: order.toBase58() }]), { ok: true });
  assert.equal(check("cancel", [{ wireBase64: cancelTx(order).serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), limitOrder: order.toBase58() }]).ok, false);
});

/** A devnet connection that records what it was asked and offers nothing else. */
function fakeConnection() {
  const sent = [];
  return {
    sent,
    connection: {
      getGenesisHash: async () => DEVNET_GENESIS,
      sendRawTransaction: async (bytes) => {
        sent.push(Buffer.from(bytes).toString("base64"));
        return `sig${sent.length}`;
      },
      getSignatureStatuses: async (signatures) => ({ value: signatures.map(() => ({ err: null, confirmationStatus: "confirmed" })) }),
    },
  };
}

test("a bundle with one bad transaction sends nothing; a good one is forwarded byte for byte", async () => {
  const good = Keypair.generate();
  const bad = Keypair.generate();
  const goodWire = signWith(await placeTx({ order: good }), [owner, good]);
  const badWire = signWith(await placeTx({ order: bad }), [bad]);
  const refused = fakeConnection();
  const answer = await relayLadder(
    { owner: owner.publicKey.toBase58(), kind: "place", items: [{ wireBase64: goodWire, limitOrder: good.publicKey.toBase58() }, { wireBase64: badWire, limitOrder: bad.publicKey.toBase58() }], pools },
    { connection: refused.connection, sleep: async () => {} },
  );
  assert.equal(answer.ok, false);
  assert.equal(answer.index, 1);
  assert.equal(refused.sent.length, 0, "nothing of a refused bundle reaches devnet");
  const passed = fakeConnection();
  const forwarded = await relayLadder({ owner: owner.publicKey.toBase58(), kind: "place", items: [{ wireBase64: goodWire, limitOrder: good.publicKey.toBase58() }], pools }, { connection: passed.connection, sleep: async () => {} });
  assert.equal(forwarded.ok, true);
  assert.deepEqual(forwarded.legs.map((leg) => leg.state), ["confirmed"]);
  assert.deepEqual(passed.sent, [goodWire], "the relay sends exactly the signed bytes: it adds no signature");
});

test("a leg devnet refuses comes back failed, so the window can say «not finished»", async () => {
  const one = Keypair.generate();
  const two = Keypair.generate();
  const items = [
    { wireBase64: signWith(await placeTx({ order: one }), [owner, one]), limitOrder: one.publicKey.toBase58() },
    { wireBase64: signWith(await placeTx({ order: two, bins: [{ id: -200, amount: new BN(1) }] }), [owner, two]), limitOrder: two.publicKey.toBase58() },
  ];
  let calls = 0;
  const connection = {
    getGenesisHash: async () => DEVNET_GENESIS,
    sendRawTransaction: async () => {
      calls += 1;
      if (calls === 2) throw new Error("Blockhash not found");
      return "sig1";
    },
    getSignatureStatuses: async (signatures) => ({ value: signatures.map(() => ({ err: null, confirmationStatus: "confirmed" })) }),
  };
  const answer = await relayLadder({ owner: owner.publicKey.toBase58(), kind: "place", items, pools }, { connection, sleep: async () => {} });
  assert.deepEqual(answer.legs.map((leg) => leg.state), ["confirmed", "failed"]);
});

test("an endpoint that is not devnet never receives the person's transactions", async () => {
  const order = Keypair.generate();
  const items = [{ wireBase64: signWith(await placeTx({ order }), [owner, order]), limitOrder: order.publicKey.toBase58() }];
  const sent = [];
  const mainnet = {
    getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    sendRawTransaction: async (bytes) => sent.push(bytes),
    getSignatureStatuses: async () => ({ value: [] }),
  };
  const answer = await relayLadder({ owner: owner.publicKey.toBase58(), kind: "place", items, pools }, { connection: mainnet, sleep: async () => {} });
  assert.deepEqual([answer.ok, answer.code], [false, "NOT_DEVNET"]);
  assert.equal(sent.length, 0);
  const silent = { ...mainnet, getGenesisHash: async () => { throw new Error("down"); } };
  assert.equal((await relayLadder({ owner: owner.publicKey.toBase58(), kind: "place", items, pools }, { connection: silent, sleep: async () => {} })).code, "NOT_DEVNET", "no answer is not devnet");
});
