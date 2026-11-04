#!/usr/bin/env node
// The Stock Pier on devnet (CITY-98): the exact build, door and engine path the city uses, run against devnet with a
// devnet test key — never mainnet. The key signs only devnet bytes, here in this process; it never enters a page.
//
//   RYNTRA_STOCK_PIER_QA_KEY=~/keys/devnet-owner.json node city/lib/earn/stock-pier-devnet.mjs --step all
//   … --step guard   — a Token-2022 «stock» with Scaled UI Amount and a dividend step scheduled in 6 h: the door holds
//                      new liquidity (STOCK_PIER_DIVIDEND) and the venue check says its badge is needed
//   … --step build   — a stand-in stock (a plain token: devnet has no xStock with a badge) priced at 2 SOL: the door
//                      prices it, the engine's Review builds the DAMM v2 pier with the first position, the key signs, the
//                      engine's relay sends it once; the pool is read back through the engine's own DAMM v2 adapter
//   … --step moor    — a second, smaller add on the standing pier: the venue hands it to the engine's own add
//   … --step exit    — every position of the key in that pier: the engine's Review takes it out and closes it
//
// Common: `--rpc <devnet endpoint>` (or RYNTRA_SOLANA_RPC_DEVNET; default the public one) · `--out docs/shots/city-98/devnet`
// · `--stock <mint>` (a stand-in made by an earlier `build`, for `moor` and `exit`). The endpoint must answer with
// devnet's genesis hash, or nothing runs. Only addresses, signatures and figures are printed and kept in the journal.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeScaledUiAmountConfigInstruction,
  createMint,
  getMint,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  getScaledUiAmountConfig,
  mintTo,
  updateMultiplier,
  NATIVE_MINT,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";

import { reviewLiquidityAction, submitLiquidityAction } from "../../../lib/liquidity/studio/actions.ts";
import { createDammV2Venue } from "../../../lib/liquidity/studio/damm-v2.ts";
import { reviewStockBuild } from "./stock-pier-door.ts";
import { dividendGuard, stepOf } from "./stock-pier-hours.ts";
import { venueAccepts } from "./stock-pier.ts";
import { createStockPierVenue, stockPierAddress } from "./stock-pier-venue.ts";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "../../..");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] === undefined || all[index + 1].startsWith("--") ? "" : all[index + 1]]);
    return pairs;
  }, []),
);
const STEP = args.step || "all";
const RPC = args.rpc || process.env.RYNTRA_SOLANA_RPC_DEVNET || "https://api.devnet.solana.com";
const OUT = resolve(ROOT, args.out || "docs/shots/city-98/devnet");
const KEY_FILE = (process.env.RYNTRA_STOCK_PIER_QA_KEY || "").replace(/^~(?=\/)/, homedir());
if (!KEY_FILE || !existsSync(KEY_FILE)) throw new Error("RYNTRA_STOCK_PIER_QA_KEY names a devnet key file (a JSON array of 64 numbers), outside the repository.");
if (resolve(KEY_FILE).startsWith(ROOT)) throw new Error("The key file must live outside the repository.");

const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_FILE, "utf8"))));
const OWNER = key.publicKey.toBase58();
const connection = new Connection(RPC, "confirmed");
const journal = { task: "CITY-98", network: "devnet", owner: OWNER, steps: [] };
const say = (line) => console.log(`· ${line}`);
const keep = (step, facts) => {
  journal.steps.push({ step, at: new Date().toISOString(), ...facts });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
};

/* The engine's own Review and relay, wired for devnet: its gate open for this run only, a ticket key made now. */
const ENV = {
  RYNTRA_LIQUIDITY_ACTIONS: "OPEN",
  BETA_TOKEN_SECRET: randomBytes(24).toString("hex"),
  NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER: "open",
};
const fresh = new Map();
const newKeypair = () => {
  const k = Keypair.generate();
  fresh.set(k.publicKey.toBase58(), k);
  return k;
};
function engineDeps(plan, prices) {
  const base = createDammV2Venue({ connection, newKeypair, actionsOpen: true });
  return {
    env: ENV,
    connections: [connection],
    venuesFor: () => ({
      "meteora-damm2": plan ? createStockPierVenue({ connection, base, plan, newKeypair }) : base,
      "meteora-dlmm": base,
    }),
    pricesOf: async () => prices,
    forget: () => {},
    takeFreshKey: (publicKey) => {
      const k = fresh.get(publicKey) ?? null;
      fresh.delete(publicKey);
      return k;
    },
  };
}

/** The key signs the Review's bytes — devnet only — and the engine's relay sends them once. */
async function signAndRelay(review, deps) {
  const signed = review.transactions.map((tx) => {
    const bytes = VersionedTransaction.deserialize(Buffer.from(tx.wireBase64, "base64"));
    bytes.sign([key]);
    return Buffer.from(bytes.serialize()).toString("base64");
  });
  const relayed = await submitLiquidityAction({ ticket: review.ticket, signed }, deps);
  if (!relayed.ok) throw new Error(`relay refused: ${relayed.code} ${relayed.reason}`);
  return relayed.value;
}

async function standInStock() {
  if (args.stock) return new PublicKey(args.stock);
  const mint = await createMint(connection, key, key.publicKey, null, 8);
  const account = await getOrCreateAssociatedTokenAccount(connection, key, mint, key.publicKey);
  await mintTo(connection, key, mint, account.address, key, 1_000n * 10n ** 8n);
  say(`stand-in stock ${mint.toBase58()} — 1,000 minted to the key`);
  return mint;
}

/** A verified pair as the door sees it, for a stand-in priced at 2 SOL — built from the chain's own state of its pier. */
async function pairFor(mint, step = null) {
  const pool = stockPierAddress(mint.toBase58(), NATIVE_MINT.toBase58());
  const built = (await connection.getAccountInfo(new PublicKey(pool))) !== null;
  const usdc = stockPierAddress(mint.toBase58(), "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  return {
    mint: mint.toBase58(),
    symbol: "TESTx",
    name: "Devnet stand-in",
    decimals: 8,
    program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    priceUsd: 300,
    multiplier: 1,
    volume7dUsd: 1_000_000,
    session: null,
    step,
    issuerMoves: false,
    piers: {
      sol: {
        address: pool,
        built,
        stockIsA: true,
        feeBps: null,
        depthUsd: null,
      },
      usdc: {
        address: usdc,
        built: false,
        stockIsA: true,
        feeBps: null,
        depthUsd: null,
      },
    },
  };
}

async function doorBuild(mint, amountA, amountB, step = null) {
  const pair = await pairFor(mint, step);
  let deps = null;
  const answer = await reviewStockBuild(
    {
      action: "build",
      stock: mint.toBase58(),
      quote: "sol",
      owner: OWNER,
      amountA: String(amountA),
      amountB: String(amountB),
    },
    {
      env: ENV,
      pairOf: async (asked) => (asked === pair.mint ? pair : null),
      quoteUsd: async () => 150,
      now: Date.now,
      review: (body, plan) => {
        deps = engineDeps(plan, {
          x: 300,
          y: 150,
          xMint: plan.stock,
          yMint: plan.quote,
        });
        return reviewLiquidityAction(body, deps);
      },
    },
  );
  return { answer, deps, pair };
}

async function guard() {
  const mint = Keypair.generate();
  const space = getMintLen([ExtensionType.ScaledUiAmountConfig]);
  const rent = await connection.getMinimumBalanceForRentExemption(space);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: key.publicKey,
      newAccountPubkey: mint.publicKey,
      space,
      lamports: rent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeScaledUiAmountConfigInstruction(mint.publicKey, key.publicKey, 1, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, 8, key.publicKey, null, TOKEN_2022_PROGRAM_ID),
  );
  const created = await sendAndConfirmTransaction(connection, tx, [key, mint]);
  const at = BigInt(Math.floor(Date.now() / 1000) + 6 * 3600);
  const scheduled = await updateMultiplier(connection, key, mint.publicKey, key, 1.004, at, [], undefined, TOKEN_2022_PROGRAM_ID);
  const read = await getMint(connection, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  const config = getScaledUiAmountConfig(read);
  const step = stepOf({
    multiplier: config.multiplier,
    newMultiplier: config.newMultiplier,
    newMultiplierEffectiveAt: new Date(Number(config.newMultiplierEffectiveTimestamp) * 1000).toISOString(),
  });
  const verdict = dividendGuard(step, Date.now());
  const badge = (await connection.getAccountInfo(new PublicKey(stockPierBadge(mint.publicKey)))) !== null;
  const accepts = venueAccepts(
    {
      program: "TOKEN_2022",
      extensions: ["ScaledUiAmountConfig"],
      scaled: true,
      paused: false,
      startsFrozen: false,
    },
    badge,
  );
  const { answer } = await doorBuild(mint.publicKey, 1_000_000n, 50_000_000n, step);
  say(
    `Scaled UI «stock» ${mint.publicKey.toBase58()}: step ${config.multiplier} → ${config.newMultiplier} at ${step?.at}; guard ${verdict.kind}; door ${answer.ok ? "built?!" : answer.code}; venue takes it without a badge: ${accepts}`,
  );
  if (answer.ok || answer.code !== "STOCK_PIER_DIVIDEND" || verdict.kind !== "hold") throw new Error("the dividend guard did not hold");
  keep("guard", {
    mint: mint.publicKey.toBase58(),
    signatures: [created, scheduled],
    step,
    guard: verdict.kind,
    door: answer.code,
    badgeStands: badge,
    venueTakesWithoutBadge: accepts,
  });
}

function stockPierBadge(mint) {
  return PublicKey.findProgramAddressSync([Buffer.from("token_badge"), mint.toBuffer()], new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"))[0].toBase58();
}

async function build() {
  const mint = await standInStock();
  // 0.5 SOL and 0.25 of the stand-in at 2 SOL: one SOL of worth.
  const { answer, deps } = await doorBuild(mint, 25_000_000n, 500_000_000n);
  if (!answer.ok) throw new Error(`door refused: ${answer.code} ${answer.reason}`);
  if (!answer.builds) throw new Error("the pier already stands — pass a fresh stock or run `moor`");
  const preview = answer.value.preview;
  say(
    `Review: builds ${answer.pool}; in ${preview.deposit.x.units} + ${preview.deposit.y.units}; rent ${preview.rent.map((r) => `${r.what}=${r.lamports}${r.refundable ? " back" : ""}`).join(", ")}; network ${answer.value.networkFeeLamports}`,
  );
  const relay = await signAndRelay(answer.value, deps);
  say(`relay: ${relay.results.map((r) => `${r.signature} ${r.state}`).join(" · ")}`);
  if (!relay.settled) throw new Error("the build did not land");
  const base = createDammV2Venue({ connection });
  const pool = await base.pool(answer.pool);
  const positions = await base.positions(OWNER, { pool: answer.pool });
  say(`read back: price ${pool.price}, base fee ${pool.fees.baseBps} bps, volatility fee now ${pool.fees.currentBps ?? "—"} bps; positions ${positions.length}`);
  keep("build", {
    stock: mint.toBase58(),
    pool: answer.pool,
    signatures: relay.results.map((r) => r.signature),
    deposit: preview.deposit,
    rent: preview.rent,
    readBack: {
      price: pool.price,
      baseBps: pool.fees.baseBps,
      currentBps: pool.fees.currentBps,
      positions: positions.length,
    },
  });
  return mint;
}

async function moor(mint) {
  const { answer, deps } = await doorBuild(mint, 5_000_000n, 100_000_000n);
  if (!answer.ok) throw new Error(`door refused: ${answer.code} ${answer.reason}`);
  if (answer.builds) throw new Error("expected a standing pier");
  const relay = await signAndRelay(answer.value, deps);
  if (!relay.settled) throw new Error("the mooring did not land");
  const positions = await createDammV2Venue({ connection }).positions(OWNER, {
    pool: answer.pool,
  });
  say(`moored: ${relay.results.map((r) => r.signature).join(" · ")}; positions ${positions.length}`);
  keep("moor", {
    stock: mint.toBase58(),
    pool: answer.pool,
    signatures: relay.results.map((r) => r.signature),
    positions: positions.length,
  });
}

async function exit(mint) {
  const pool = stockPierAddress(mint.toBase58(), NATIVE_MINT.toBase58());
  const base = createDammV2Venue({ connection });
  const positions = await base.positions(OWNER, { pool });
  const signatures = [];
  for (const position of positions) {
    const deps = engineDeps(null, {
      x: null,
      y: null,
      xMint: null,
      yMint: null,
    });
    const reviewed = await reviewLiquidityAction(
      {
        action: "remove",
        venue: "meteora-damm2",
        request: {
          position: position.address,
          owner: OWNER,
          shareBps: 10_000,
          close: true,
          slippageBps: 100,
        },
      },
      deps,
    );
    if (!reviewed.ok) throw new Error(`exit refused: ${reviewed.code} ${reviewed.reason}`);
    const relay = await signAndRelay(reviewed.value, deps);
    if (!relay.settled) throw new Error("the exit did not land");
    signatures.push(...relay.results.map((r) => r.signature));
  }
  const left = await base.positions(OWNER, { pool });
  say(`left: ${signatures.join(" · ")}; positions now ${left.length}`);
  keep("exit", {
    stock: mint.toBase58(),
    pool,
    signatures,
    positionsLeft: left.length,
  });
}

const genesis = await connection.getGenesisHash();
if (genesis !== DEVNET_GENESIS) throw new Error("This endpoint is not devnet. Nothing ran.");
say(`devnet · key ${OWNER} · ${(await connection.getBalance(key.publicKey)) / 1e9} SOL`);
if (STEP === "guard" || STEP === "all") await guard();
let stock = args.stock ? new PublicKey(args.stock) : null;
if (STEP === "build" || STEP === "all") stock = await build();
if (!stock) throw new Error("--stock names the stand-in an earlier build made.");
if (STEP === "moor" || STEP === "all") await moor(stock);
if (STEP === "exit" || STEP === "all") await exit(stock);
say(`journal → ${join(OUT, "journal.json")}`);
