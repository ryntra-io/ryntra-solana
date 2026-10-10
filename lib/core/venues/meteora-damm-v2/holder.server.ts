/**
 * A holder's position in a graduated launch's DAMM v2 pool — the venue half:
 * the entry through Meteora's Zap, the permission Ryntra's collector asks for,
 * «Відкликати», the collector's claim, and the position read from the chain.
 *
 * **The entry** is one transaction the wallet signs: its token accounts, Ryntra's
 * share at entry (when it is charged here — a transfer into Ryntra's fee wallet,
 * shown before the signature), a new position (its NFT's key is the server's,
 * a fresh one, and signs only the creation), Zap's own ledger and `zap_in_damm_v2`
 * — the program swaps what it must of the one coin and adds both sides to the
 * position — and, where the network has a collector, the permission: an SPL
 * Approve of 0 on the position NFT's account and `update_delegate_permission`
 * with Ryntra's two bits (`HOLDER_GRANT_BITMASK`). Devnet's Zap program is older
 * than its SDK (its ledger instructions are unknown to it, 07.10), so the stand
 * enters with the same pieces built directly: a DAMM v2 swap of the share Zap
 * would swap, then `add_liquidity` — `zap: false`.
 *
 * **The permission** pays only the owner. The program checks every claim by a
 * delegate against the owner's own associated token accounts; an approval of 0
 * lets the delegate sign for the position but never move the NFT; closing,
 * splitting, removing liquidity, locking and changing the permission stay the
 * owner's alone (damm-v2 0.2.4, proven on devnet 07.10 — `scripts/launch-qa/holder-permission-proof.mjs`).
 *
 * Nothing here sends; the wallet and the collector sign.
 */

import { CpAmm, derivePositionAddress, derivePositionNftAccount, getTokenProgram, getUnClaimLpFee, SwapMode, type PoolState } from "@meteora-ag/cp-amm-sdk";
import { Zap } from "@meteora-ag/zap-sdk";
import {
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createRevokeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { HOLDER_GRANT_BITMASK, holderEntryFeeRaw, zapPriceMoveBps } from "../../launch/holder.ts";
import { dammPrice } from "../meteora-dbc/market.server.ts";

export type HolderInputSide = "pair" | "token";

/** A graduated launch's pool as a holder's entry reads it. */
export type HolderPool = Readonly<{
  address: string;
  token: string;
  pairMint: string;
  tokenIsA: boolean;
  tokenDecimals: number;
  pairDecimals: number;
  /** The token's price in the pair currency now. */
  price: number;
  /** The program's fee mode: 2 — compounding, where part of every LP fee goes back into the pool itself. */
  collectFeeMode: number;
  /** In a compounding pool, the share of the LP fee that compounds, basis points; the rest is claimable. */
  compoundingBps: number;
  state: PoolState;
}>;

export type HolderRefusalCode = "NO_POOL" | "AMOUNT_ZERO" | "BALANCE_LOW" | "NOT_OWNER" | "MOVED" | "NO_COLLECTOR";

export class HolderRefusal extends Error {
  readonly code: HolderRefusalCode;

  constructor(code: HolderRefusalCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** The entry's figures — what the wallet spends, Ryntra's share, what Zap swaps and what the position holds after it. */
export type HolderEntryQuote = Readonly<{
  input: HolderInputSide;
  /** What the wallet spends of the input coin, raw — Ryntra's share included. */
  amountRaw: string;
  /** Ryntra's share at entry, in the input coin, raw; "0" where it is not charged. */
  feeRaw: string;
  feeBps: number;
  /** What goes into Zap, raw. */
  depositRaw: string;
  /** Of it, what is swapped into the other coin (≈ — the program counts it exactly). */
  swappedRaw: string;
  /** ≈ what the position holds after the entry. */
  positionTokenRaw: string;
  positionPairRaw: string;
  /** What the wallet spends, Ryntra's share included, in the pair currency at the price now. */
  valuePairRaw: string;
  /** ≈ what the position is worth right after the entry, at the price now: the swap's pool fee and price move are not in it. */
  positionValuePairRaw: string;
  /** ≈ the position's share of the pool after the entry, basis points. */
  shareBps: number;
  /** How far the swap moves the price, basis points. */
  priceImpactBps: number;
}>;

export type HolderVenue = ReturnType<typeof createHolderVenue>;

/** What the venue needs: the connection, whether this network's Zap is current, the collector and Ryntra's share at entry. */
export type HolderVenueConfig = Readonly<{
  connection: Connection;
  zap: boolean;
  collector: string | null;
  /** Ryntra's share at entry: its rate and wallet where it is charged here, else null. */
  fee: Readonly<{ wallet: string; bps: number }> | null;
}>;

/** A full-range constant-product pool: the part of a one-coin deposit to swap so both sides go in at the pool's ratio. */
export function swapShareRaw(depositRaw: bigint, reserveInRaw: bigint): bigint {
  if (depositRaw <= 0n || reserveInRaw <= 0n) return 0n;
  /* (x − s)·R = s·(R + s) → s = √(R² + xR) − R */
  const root = sqrtBig(reserveInRaw * reserveInRaw + depositRaw * reserveInRaw);
  const share = root - reserveInRaw;
  return share > 0n ? (share < depositRaw ? share : depositRaw) : 0n;
}

function sqrtBig(value: bigint): bigint {
  if (value < 2n) return value;
  let x = BigInt(Math.floor(Math.sqrt(Number(value))));
  for (let i = 0; i < 64; i += 1) {
    const next = (x + value / x) / 2n;
    if (next === x || next === x + 1n || next + 1n === x) {
      x = next;
      break;
    }
    x = next;
  }
  while (x * x > value) x -= 1n;
  while ((x + 1n) * (x + 1n) <= value) x += 1n;
  return x;
}

/** A Token-2022 or token account as the program sees it: its owner, its amount, its delegate. */
function tokenAccountOf(address: PublicKey, info: Parameters<typeof unpackAccount>[1] | null, programId: PublicKey) {
  if (!info) return null;
  try {
    return unpackAccount(address, info, programId);
  } catch {
    return null;
  }
}

const U64_MAX = new BN("18446744073709551615");
const COMPUTE_UNITS = 700_000;

export function createHolderVenue(config: HolderVenueConfig) {
  const { connection } = config;
  const cpAmm = new CpAmm(connection);
  const program = cpAmm._program;
  const poolAuthority = (cpAmm as unknown as { poolAuthority: PublicKey }).poolAuthority;

  async function pool(address: string, token: string): Promise<HolderPool> {
    let state: PoolState;
    try {
      state = await cpAmm.fetchPoolState(new PublicKey(address));
    } catch {
      throw new HolderRefusal("NO_POOL", "No DAMM v2 pool at this address.");
    }
    const tokenIsA = state.tokenAMint.toBase58() === token;
    if (!tokenIsA && state.tokenBMint.toBase58() !== token) throw new HolderRefusal("NO_POOL", "The pool does not hold this token.");
    const pairMint = (tokenIsA ? state.tokenBMint : state.tokenAMint).toBase58();
    const [tokenMint, pairMintInfo] = await connection.getMultipleAccountsInfo([new PublicKey(token), new PublicKey(pairMint)], "confirmed");
    const tokenDecimals = tokenMint?.data[44] ?? 6;
    const pairDecimals = pairMintInfo?.data[44] ?? 6;
    return {
      address,
      token,
      pairMint,
      tokenIsA,
      tokenDecimals,
      pairDecimals,
      price: dammPrice(state.sqrtPrice.toString(), tokenIsA, tokenDecimals, pairDecimals),
      collectFeeMode: state.collectFeeMode,
      compoundingBps: Number((state.poolFees as unknown as { compoundingFeeBps?: number }).compoundingFeeBps ?? 0),
      state,
    };
  }

  const programs = (p: HolderPool) => ({ a: getTokenProgram(p.state.tokenAFlag), b: getTokenProgram(p.state.tokenBFlag) });
  const ata = (owner: PublicKey, mint: PublicKey, programId: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, programId);

  /** The entry's figures now, from the pool's reserves: the split, Ryntra's share, the position after it. */
  async function quote(p: HolderPool, input: HolderInputSide, amountRaw: bigint): Promise<HolderEntryQuote & Readonly<{ swapMinOutRaw: bigint }>> {
    if (amountRaw <= 0n) throw new HolderRefusal("AMOUNT_ZERO", "amountRaw: more than zero");
    const inIsA = input === "token" ? p.tokenIsA : !p.tokenIsA;
    const reserveIn = BigInt((inIsA ? p.state.tokenAAmount : p.state.tokenBAmount).toString());
    const reserveOut = BigInt((inIsA ? p.state.tokenBAmount : p.state.tokenAAmount).toString());
    /* Ryntra's share is the policy's rate on the swapped part, which depends on the deposit after the share: counted
       on the whole amount's split first, then the split of what is left — the difference is below a raw unit's worth. */
    const firstSplit = swapShareRaw(amountRaw, reserveIn);
    const feeRaw = config.fee ? holderEntryFeeRaw(firstSplit, config.fee.bps) : 0n;
    const depositRaw = amountRaw - feeRaw;
    const swappedRaw = swapShareRaw(depositRaw, reserveIn);
    const slot = await connection.getSlot("confirmed");
    const time = Math.floor(Date.now() / 1000);
    const swap = swappedRaw > 0n
      ? cpAmm.getQuote({
          inAmount: new BN(swappedRaw.toString()),
          inputTokenMint: inIsA ? p.state.tokenAMint : p.state.tokenBMint,
          slippage: 1,
          poolState: p.state,
          currentTime: time,
          currentSlot: slot,
          tokenADecimal: p.tokenIsA ? p.tokenDecimals : p.pairDecimals,
          tokenBDecimal: p.tokenIsA ? p.pairDecimals : p.tokenDecimals,
        })
      : null;
    const outRaw = swap ? BigInt(swap.swapOutAmount.toString()) : 0n;
    const minOutRaw = swap ? BigInt(swap.minSwapOutAmount.toString()) : 0n;
    const keptRaw = depositRaw - swappedRaw;
    const positionTokenRaw = input === "token" ? keptRaw : outRaw;
    const positionPairRaw = input === "token" ? outRaw : keptRaw;
    const toPair = (tokenRaw: bigint) => BigInt(Math.floor((Number(tokenRaw) / 10 ** p.tokenDecimals) * p.price * 10 ** p.pairDecimals));
    const valuePairRaw = input === "pair" ? amountRaw : toPair(amountRaw);
    /* The position at the price now: the tokens the swap bought are worth less than they cost — the pool's fee and the price move. */
    const positionValuePairRaw = positionPairRaw + toPair(positionTokenRaw);
    const poolValuePair = BigInt((p.tokenIsA ? p.state.tokenBAmount : p.state.tokenAAmount).toString()) + toPair(BigInt((p.tokenIsA ? p.state.tokenAAmount : p.state.tokenBAmount).toString()));
    const shareBps = poolValuePair + positionValuePairRaw > 0n ? Number((positionValuePairRaw * 10_000n) / (poolValuePair + positionValuePairRaw)) : 0;
    const priceImpactBps = swap ? Math.round(Number(swap.priceImpact.toString()) * 100) : 0;
    void reserveOut;
    return {
      input,
      amountRaw: amountRaw.toString(),
      feeRaw: feeRaw.toString(),
      feeBps: config.fee?.bps ?? 0,
      depositRaw: depositRaw.toString(),
      swappedRaw: swappedRaw.toString(),
      positionTokenRaw: positionTokenRaw.toString(),
      positionPairRaw: positionPairRaw.toString(),
      valuePairRaw: valuePairRaw.toString(),
      positionValuePairRaw: positionValuePairRaw.toString(),
      shareBps,
      priceImpactBps: Number.isFinite(priceImpactBps) ? priceImpactBps : 0,
      swapMinOutRaw: minOutRaw,
    };
  }

  /**
   * How far the entry's own swap moves the pool's square-root price, basis points: the entry simulated against the pool
   * as it stands — the wallet's signature not checked, nothing sent — and the pool read after it. Refused when the
   * simulation fails: an entry the network would refuse is never handed to the wallet.
   */
  async function ownSqrtMoveBps(ixs: readonly TransactionInstruction[], owner: PublicKey, nft: Keypair, poolAddress: string, before: BN): Promise<number> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = owner;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.partialSign(nft);
    const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const rpc = connection as unknown as { _rpcRequest(method: string, args: unknown[]): Promise<{ result?: { value?: { err: unknown; accounts?: Array<{ data: [string, string] } | null> } }; error?: { message?: string } }> };
    const answer = await rpc._rpcRequest("simulateTransaction", [
      wire,
      { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: [poolAddress] } },
    ]);
    const value = answer.result?.value;
    if (!value || answer.error) throw new Error(`The entry could not be simulated: ${answer.error?.message ?? "no answer"}`);
    /* Said as it is — the network's own reason — never as a wallet's mismatch. */
    if (value.err) throw new Error(`The network would refuse this entry now (${JSON.stringify(value.err).slice(0, 120)}); nothing was built. Try again.`);
    const after = value.accounts?.[0];
    if (!after) throw new Error("The pool was not read after the simulated entry.");
    const state = program.coder.accounts.decode("pool", Buffer.from(after.data[0], "base64")) as PoolState;
    /* The price the simulated build read just before it — not the request's first read, so others' trades in between are not counted as the entry's. */
    if (before.isZero()) throw new Error("The pool has no price.");
    const moved = state.sqrtPrice.sub(before).abs().muln(10_000);
    /* Up to the next basis point: the entry's own move always fits. */
    return moved.add(before.subn(1)).div(before).toNumber();
  }

  /** Ryntra's permission on a position: an Approve of 0 names the collector, the bitmask says what it may sign. */
  async function grantInstructions(owner: PublicKey, position: PublicKey, nftAccount: PublicKey): Promise<TransactionInstruction[]> {
    if (!config.collector) throw new HolderRefusal("NO_COLLECTOR", "This network has no collector yet.");
    return [
      createApproveInstruction(nftAccount, new PublicKey(config.collector), owner, 0, [], TOKEN_2022_PROGRAM_ID),
      await program.methods.updateDelegatePermission(HOLDER_GRANT_BITMASK).accountsPartial({ position, positionNftAccount: nftAccount, owner }).instruction(),
    ];
  }

  /**
   * The entry the wallet signs: one transaction, the new position's NFT key signing beside it. The wallet must hold the
   * amount. The collector's permission goes in the same signature where the network has a collector.
   */
  async function buildEntry(args: Readonly<{ pool: HolderPool; wallet: string; input: HolderInputSide; amountRaw: bigint; slippageBps: number }>) {
    const p = args.pool;
    const owner = new PublicKey(args.wallet);
    const figures = await quote(p, args.input, args.amountRaw);
    const inIsA = args.input === "token" ? p.tokenIsA : !p.tokenIsA;
    const inMint = inIsA ? p.state.tokenAMint : p.state.tokenBMint;
    const { a: tokenAProgram, b: tokenBProgram } = programs(p);
    const inProgram = inIsA ? tokenAProgram : tokenBProgram;
    const held = await balanceOf(owner, inMint, inProgram);
    if (held < args.amountRaw) throw new HolderRefusal("BALANCE_LOW", "The wallet does not hold that much.");

    const nft = Keypair.generate();
    const position = derivePositionAddress(nft.publicKey);
    const nftAccount = derivePositionNftAccount(nft.publicKey);
    const userA = ata(owner, p.state.tokenAMint, tokenAProgram);
    const userB = ata(owner, p.state.tokenBMint, tokenBProgram);
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
      createAssociatedTokenAccountIdempotentInstruction(owner, userA, owner, p.state.tokenAMint, tokenAProgram),
      createAssociatedTokenAccountIdempotentInstruction(owner, userB, owner, p.state.tokenBMint, tokenBProgram),
    ];
    const feeRaw = BigInt(figures.feeRaw);
    if (config.fee && feeRaw > 0n) {
      const feeOwner = new PublicKey(config.fee.wallet);
      const feeAccount = ata(feeOwner, inMint, inProgram);
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(owner, feeAccount, feeOwner, inMint, inProgram),
        createTransferCheckedInstruction(inIsA ? userA : userB, inMint, feeAccount, owner, feeRaw, args.input === "token" ? p.tokenDecimals : p.pairDecimals, [], inProgram),
      );
    }
    ixs.push(...(await cpAmm.createPosition({ owner, payer: owner, pool: new PublicKey(p.address), positionNft: nft.publicKey })).instructions);

    const depositRaw = BigInt(figures.depositRaw);
    const common = {
      pool: new PublicKey(p.address),
      position,
      positionNftAccount: nftAccount,
      tokenAMint: p.state.tokenAMint,
      tokenBMint: p.state.tokenBMint,
      tokenAVault: p.state.tokenAVault,
      tokenBVault: p.state.tokenBVault,
      tokenAProgram,
      tokenBProgram,
    };
    if (config.zap) {
      /* Zap's own path: its ledger holds the deposit, `zap_in_damm_v2` swaps what it must in this pool and adds both sides. */
      const zap = new Zap(connection);
      const swapped = new BN(figures.swappedRaw);
      const time = Math.floor(Date.now() / 1000);
      const slot = await connection.getSlot("confirmed");
      const dammQuote = cpAmm.getQuote({
        inAmount: swapped.isZero() ? new BN(1) : swapped,
        inputTokenMint: inMint,
        slippage: args.slippageBps / 100,
        poolState: p.state,
        currentTime: time,
        currentSlot: slot,
        tokenADecimal: p.tokenIsA ? p.tokenDecimals : p.pairDecimals,
        tokenBDecimal: p.tokenIsA ? p.pairDecimals : p.tokenDecimals,
      });
      const zapIxs = async (maxSqrtPriceChangeBps: number): Promise<Readonly<{ ixs: TransactionInstruction[]; pre: BN }>> => {
        const params = await zap.getZapInDammV2DirectPoolParams({
          user: owner,
          inputTokenMint: inMint,
          amountIn: new BN(depositRaw.toString()),
          pool: new PublicKey(p.address),
          positionNftMint: nft.publicKey,
          maxSqrtPriceChangeBps,
          maxTransferAmountExtendPercentage: 0,
          maxAccounts: 30,
          slippageBps: args.slippageBps,
          dammV2Quote: {
            swapInAmount: swapped,
            consumedInAmount: swapped,
            swapOutAmount: dammQuote.swapOutAmount,
            minSwapOutAmount: dammQuote.minSwapOutAmount,
            totalFee: dammQuote.totalFee,
            priceImpact: dammQuote.priceImpact,
          },
          jupiterQuote: null,
        });
        const built = await zap.buildZapInDammV2Transaction(params);
        /* The token accounts are created above; Zap's own setup would create them again. */
        return { ixs: [...built.ledgerTransaction.instructions, ...built.zapInTransaction.instructions, ...built.cleanUpTransaction.instructions], pre: params.preSqrtPrice };
      };
      /*
       * Zap's guard is the only bound on the price in this route, and the program picks its own swap's size: the entry
       * is simulated against the pool as it stands with the whole range allowed, the pool's square-root price read after
       * it, and the guard set to that move plus half the slippage — others may move the price by the slippage, never more.
       * The slippage alone refused every entry into a small pool, where half a few dollars moves it (10.10, $STAIR).
       */
      const probe = await zapIxs(10_000);
      const own = await ownSqrtMoveBps([...ixs, ...probe.ixs], owner, nft, p.address, probe.pre);
      ixs.push(...(await zapIxs(zapPriceMoveBps(own, args.slippageBps))).ixs);
    } else {
      /* The stand's devnet: the share Zap would swap, swapped in this pool, then both sides added. */
      const swapTx = await cpAmm.swap2({
        payer: owner,
        pool: new PublicKey(p.address),
        inputTokenMint: inMint,
        outputTokenMint: inIsA ? p.state.tokenBMint : p.state.tokenAMint,
        tokenAMint: p.state.tokenAMint,
        tokenBMint: p.state.tokenBMint,
        tokenAVault: p.state.tokenAVault,
        tokenBVault: p.state.tokenBVault,
        tokenAProgram,
        tokenBProgram,
        referralTokenAccount: null,
        swapMode: SwapMode.ExactIn,
        amountIn: new BN(figures.swappedRaw),
        minimumAmountOut: new BN(figures.swapMinOutRaw.toString()),
      });
      ixs.push(...swapTx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)));
      const otherMin = figures.swapMinOutRaw;
      const keptRaw = depositRaw - BigInt(figures.swappedRaw);
      const deposit = cpAmm.getDepositQuote({
        inAmount: new BN(otherMin.toString()),
        isTokenA: !inIsA,
        minSqrtPrice: p.state.sqrtMinPrice,
        maxSqrtPrice: p.state.sqrtMaxPrice,
        sqrtPrice: p.state.sqrtPrice,
        collectFeeMode: p.state.collectFeeMode,
        tokenAAmount: p.state.tokenAAmount,
        tokenBAmount: p.state.tokenBAmount,
        liquidity: p.state.liquidity,
      });
      /* The price moved by the swap; 97 % of the liquidity both sides cover at the old price stays inside what the wallet holds. */
      const liquidityDelta = deposit.liquidityDelta.muln(97).divn(100);
      const maxA = new BN((inIsA ? keptRaw : otherMin).toString());
      const maxB = new BN((inIsA ? otherMin : keptRaw).toString());
      ixs.push(
        await program.methods
          .addLiquidity({ liquidityDelta, tokenAAmountThreshold: maxA, tokenBAmountThreshold: maxB })
          .accountsPartial({ ...common, signer: owner, tokenAAccount: userA, tokenBAccount: userB })
          .instruction(),
      );
      void U64_MAX;
    }
    if (config.collector) ixs.push(...(await grantInstructions(owner, position, nftAccount)));
    const tx = new Transaction().add(...ixs);
    const sealed = await seal(tx, owner, [nft]);
    return { ...sealed, position: position.toBase58(), nftMint: nft.publicKey.toBase58(), nftAccount: nftAccount.toBase58(), granted: Boolean(config.collector), quote: figures };
  }

  /** «Увімкнути» on a position that has none of it: the same two bits, signed by the owner. */
  async function buildGrant(args: Readonly<{ wallet: string; position: string; nftMint: string }>) {
    const owner = new PublicKey(args.wallet);
    const nftAccount = derivePositionNftAccount(new PublicKey(args.nftMint));
    await assertOwner(owner, nftAccount);
    const tx = new Transaction().add(...(await grantInstructions(owner, new PublicKey(args.position), nftAccount)));
    return seal(tx, owner, []);
  }

  /** «Відкликати» — the bitmask to 0 and the SPL delegate revoked, in one signature: afterwards the collector can sign nothing. */
  async function buildRevoke(args: Readonly<{ wallet: string; position: string; nftMint: string }>) {
    const owner = new PublicKey(args.wallet);
    const nftAccount = derivePositionNftAccount(new PublicKey(args.nftMint));
    await assertOwner(owner, nftAccount);
    const tx = new Transaction().add(
      await program.methods.updateDelegatePermission(0).accountsPartial({ position: new PublicKey(args.position), positionNftAccount: nftAccount, owner }).instruction(),
      createRevokeInstruction(nftAccount, owner, [], TOKEN_2022_PROGRAM_ID),
    );
    return seal(tx, owner, []);
  }

  async function assertOwner(owner: PublicKey, nftAccount: PublicKey): Promise<void> {
    const info = await connection.getAccountInfo(nftAccount, "confirmed");
    const account = tokenAccountOf(nftAccount, info, TOKEN_2022_PROGRAM_ID);
    if (!account || account.amount !== 1n) throw new HolderRefusal("MOVED", "The position's NFT is no longer in its account.");
    if (!account.owner.equals(owner)) throw new HolderRefusal("NOT_OWNER", "This wallet does not own the position.");
  }

  /**
   * A position as the chain holds it now: whose it is, what it is worth at the pool's price, the fees waiting and
   * claimed, and its permission. The NFT's own account is read: once the NFT left it, the position is said as moved.
   */
  async function readPosition(p: HolderPool, args: Readonly<{ position: string; nftMint: string }>) {
    const nftAccount = derivePositionNftAccount(new PublicKey(args.nftMint));
    const [positionInfo, nftInfo] = await connection.getMultipleAccountsInfo([new PublicKey(args.position), nftAccount], "confirmed");
    if (!positionInfo) return { position: args.position, nftMint: args.nftMint, nftAccount: nftAccount.toBase58(), closed: true as const };
    const state = await cpAmm.fetchPositionState(new PublicKey(args.position));
    const account = tokenAccountOf(nftAccount, nftInfo, TOKEN_2022_PROGRAM_ID);
    const held = account && account.amount === 1n;
    const liquidity = state.unlockedLiquidity.add(state.vestedLiquidity).add(state.permanentLockedLiquidity);
    const value = liquidity.isZero()
      ? { outAmountA: new BN(0), outAmountB: new BN(0) }
      : cpAmm.getWithdrawQuote({
          liquidityDelta: liquidity,
          minSqrtPrice: p.state.sqrtMinPrice,
          maxSqrtPrice: p.state.sqrtMaxPrice,
          sqrtPrice: p.state.sqrtPrice,
          collectFeeMode: p.state.collectFeeMode,
          tokenAAmount: p.state.tokenAAmount,
          tokenBAmount: p.state.tokenBAmount,
          liquidity: p.state.liquidity,
        });
    const unclaimed = getUnClaimLpFee(p.state, state);
    const tokenOf = (a: BN, b: BN) => (p.tokenIsA ? a : b).toString();
    const pairOf = (a: BN, b: BN) => (p.tokenIsA ? b : a).toString();
    return {
      position: args.position,
      nftMint: args.nftMint,
      nftAccount: nftAccount.toBase58(),
      closed: false as const,
      owner: held ? account.owner.toBase58() : null,
      delegate: held && account.delegate ? account.delegate.toBase58() : null,
      delegatedAmount: held ? account.delegatedAmount.toString() : "0",
      bitmask: Number((state as unknown as { delegatePermission?: number }).delegatePermission ?? 0),
      liquidity: liquidity.toString(),
      tokenRaw: tokenOf(value.outAmountA, value.outAmountB),
      pairRaw: pairOf(value.outAmountA, value.outAmountB),
      unclaimedTokenRaw: tokenOf(unclaimed.feeTokenA, unclaimed.feeTokenB),
      unclaimedPairRaw: pairOf(unclaimed.feeTokenA, unclaimed.feeTokenB),
      claimedTokenRaw: tokenOf(state.metrics.totalClaimedAFee, state.metrics.totalClaimedBFee),
      claimedPairRaw: pairOf(state.metrics.totalClaimedAFee, state.metrics.totalClaimedBFee),
    };
  }

  /**
   * The collector's claim on a position: the fees paid to the owner's own associated token accounts — the only
   * destination the program accepts from a delegate holding Ryntra's bits. The accounts are made if missing, paid by the
   * collector; the owner's balance is never touched otherwise.
   */
  async function buildCollectorClaim(p: HolderPool, args: Readonly<{ collector: string; owner: string; position: string; nftMint: string }>): Promise<Transaction | null> {
    const owner = new PublicKey(args.owner);
    const { a: tokenAProgram, b: tokenBProgram } = programs(p);
    const ownerA = ata(owner, p.state.tokenAMint, tokenAProgram);
    const ownerB = ata(owner, p.state.tokenBMint, tokenBProgram);
    /* The program pays only into the owner's own accounts and needs both. One the owner closed is not reopened at the
       collector's cost every day: the claim waits, and the owner can claim themselves. */
    const [infoA, infoB] = await connection.getMultipleAccountsInfo([ownerA, ownerB], "confirmed");
    if (!infoA || !infoB) return null;
    return new Transaction().add(
      await program.methods
        .claimPositionFee()
        .accountsPartial({
          poolAuthority,
          signer: new PublicKey(args.collector),
          pool: new PublicKey(p.address),
          position: new PublicKey(args.position),
          positionNftAccount: derivePositionNftAccount(new PublicKey(args.nftMint)),
          tokenAAccount: ownerA,
          tokenBAccount: ownerB,
          tokenAVault: p.state.tokenAVault,
          tokenBVault: p.state.tokenBVault,
          tokenAMint: p.state.tokenAMint,
          tokenBMint: p.state.tokenBMint,
          tokenAProgram,
          tokenBProgram,
        })
        .instruction(),
    );
  }

  async function balanceOf(owner: PublicKey, mint: PublicKey, programId: PublicKey): Promise<bigint> {
    const address = ata(owner, mint, programId);
    const info = await connection.getAccountInfo(address, "confirmed");
    const account = tokenAccountOf(address, info, programId);
    return account ? account.amount : 0n;
  }

  async function seal(tx: Transaction, payer: PublicKey, signers: readonly Keypair[]): Promise<Readonly<{ wireBase64: string; validUntil: string }>> {
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = payer;
    tx.recentBlockhash = latest.blockhash;
    if (signers.length) tx.partialSign(...signers);
    return { wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), validUntil: String(latest.lastValidBlockHeight) };
  }

  return { pool, quote, buildEntry, buildGrant, buildRevoke, readPosition, buildCollectorClaim };
}

export type HolderPositionRead = Awaited<ReturnType<HolderVenue["readPosition"]>>;
