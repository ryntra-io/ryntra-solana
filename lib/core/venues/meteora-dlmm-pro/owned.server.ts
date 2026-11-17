/**
 * Which DLMM Pro positions and limit orders a wallet holds, and which a pool has.
 *
 * The program keeps no index by owner: a position and a limit order are each a Token-2022 NFT in the owner's wallet
 * and a program account at an address derived from the NFT's mint. So a wallet's are found from its Token-2022
 * associated accounts that hold exactly one of something — each such mint is a position if the program owns the
 * account at `position(mint)`, an order if it owns the one at `limit_order(mint)`. An NFT kept in any other token
 * account of the wallet is left out: the program, and so every build here, acts on the associated account alone. A
 * wallet that is only a delegate holds no NFT and is not found this way.
 *
 * A pool's are found by `getProgramAccounts`: the account's discriminator, the pool at byte 8, and only the NFT's mint
 * (byte 40) sliced out.
 *
 * A collector's are found the same way: the orders whose permission bit is set — and, where asked, that
 * name a given referral — then the one Token-2022 account that holds each one's NFT, which says the holder and the
 * delegate.
 *
 * All three reads are indexed requests: a public node may refuse them, and a refusal throws — it is never read as
 * «holds nothing».
 */

import { LimitOrderDelegatePermission, deriveLimitOrder, derivePosition, findNftAccount } from "@meteora-ag/dlmm-pro-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import type { Address } from "../../contracts.ts";
import { TOKEN_ACCOUNT_BYTES, TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET, TOKEN_ACCOUNT_DELEGATE_OFFSET, type DlmmProContext } from "./pools.server.ts";
import { accountDiscriminator, refusing } from "./sdk.server.ts";
import { keyOf } from "./tx.server.ts";

export type DlmmProHoldings = Readonly<{
  /** The NFT mints of the positions and of the limit orders, with the pool each belongs to. */
  positions: readonly Readonly<{ nftMint: Address; pool: Address }>[];
  orders: readonly Readonly<{ nftMint: Address; pool: Address }>[];
}>;

const base58 = getBase58Decoder();
/** A limit order's account: its discriminator, the pool, the NFT's mint, the referral wallet, the delegate's permissions. */
const ORDER_REFERRAL_OFFSET = 72;
const ORDER_PERMISSION_OFFSET = 104;

export function createDlmmProHoldings(context: DlmmProContext) {
  const { connection, client } = context;
  const programId = client.program.programId;

  /** Of `mints`, those with a program account at the derived address — and the pool that account names (its first field). */
  async function existing(mints: readonly PublicKey[], derive: (mint: PublicKey) => PublicKey): Promise<readonly Readonly<{ nftMint: Address; pool: Address }>[]> {
    const found: { nftMint: Address; pool: Address }[] = [];
    for (let start = 0; start < mints.length; start += 100) {
      const chunk = mints.slice(start, start + 100);
      const infos = await connection.getMultipleAccountsInfo(chunk.map(derive), "confirmed");
      infos.forEach((info, index) => {
        if (!info || !info.owner.equals(programId) || info.data.length < 40) return;
        found.push({ nftMint: chunk[index]!.toBase58(), pool: new PublicKey(Buffer.from(info.data).subarray(8, 40)).toBase58() });
      });
    }
    return found;
  }

  /** The positions and the limit orders `wallet` holds, on every DLMM Pro pool. */
  async function ofWallet(wallet: Address): Promise<DlmmProHoldings> {
    return refusing(async () => {
      const owner = keyOf(wallet, "The wallet");
      const { value } = await connection.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed");
      const mints: PublicKey[] = [];
      for (const entry of value) {
        const data = Buffer.from(entry.account.data);
        /* An NFT is held as exactly one; anything else is a coin. */
        if (data.length < 72 || data.readBigUInt64LE(64) !== 1n) continue;
        const mint = new PublicKey(data.subarray(0, 32));
        if (!entry.pubkey.equals(findNftAccount(mint, owner))) continue;
        mints.push(mint);
      }
      const [positions, orders] = await Promise.all([existing(mints, (mint) => derivePosition(mint, programId)), existing(mints, (mint) => deriveLimitOrder(mint, programId))]);
      return { positions, orders };
    });
  }

  /** The NFT mints of every position and every limit order of a pool. */
  async function ofPool(pool: Address): Promise<Readonly<{ positions: readonly Address[]; orders: readonly Address[] }>> {
    return refusing(async () => {
      const poolKey = keyOf(pool, "The pool");
      const mintsOf = async (account: "PositionArray" | "LimitOrder"): Promise<readonly Address[]> => {
        const discriminator = base58.decode(accountDiscriminator(account));
        const accounts = await connection.getProgramAccounts(programId, {
          commitment: "confirmed",
          filters: [{ memcmp: { offset: 0, bytes: discriminator } }, { memcmp: { offset: 8, bytes: poolKey.toBase58() } }],
          dataSlice: { offset: 40, length: 32 },
        });
        return accounts.map((entry) => new PublicKey(Buffer.from(entry.account.data)).toBase58());
      };
      const [positions, orders] = await Promise.all([mintsOf("PositionArray"), mintsOf("LimitOrder")]);
      return { positions, orders };
    });
  }

  /**
   * The limit orders `collector` may collect: every order whose holder gave a delegate the one permission there is,
   * and whose NFT account names `collector` as that delegate with nothing delegated — as the program asks. `referral`
   * narrows it to the orders that name that wallet as their referral: the ones placed through this venue.
   *
   * An order's account does not say who holds it, and an NFT's account is derived from its holder: so the holder is
   * read from the one Token-2022 account that holds the NFT. At most `limit` orders are told, in the node's own order.
   */
  async function ofCollector(collector: Address, options: Readonly<{ referral?: Address | null; limit?: number }> = {}): Promise<readonly Readonly<{ nftMint: Address; pool: Address; owner: Address }>[]> {
    return refusing(async () => {
      const found: { nftMint: Address; pool: Address; owner: Address }[] = [];
      for (const order of (await delegatedOrders({ referral: options.referral ?? null })).slice(0, Math.max(0, options.limit ?? 100))) {
        const owner = await holderFor(order.nftMint, collector);
        if (owner) found.push({ ...order, owner });
      }
      return found;
    });
  }

  /**
   * Every limit order whose holder let a delegate collect — the permission bit set — and, where asked, that names a
   * given referral: one indexed read that slices out only the pool and the NFT's mint. Who holds each one and whom it
   * lets in is `holderFor`'s, asked only for the orders a caller goes on with.
   */
  async function delegatedOrders(options: Readonly<{ referral?: Address | null }> = {}): Promise<readonly Readonly<{ nftMint: Address; pool: Address }>[]> {
    return refusing(async () => {
      const referral = options.referral ? keyOf(options.referral, "The referral wallet") : null;
      const permitted = base58.decode(Uint8Array.from([1 << LimitOrderDelegatePermission.CancelLimitOrder, 0, 0, 0]));
      const accounts = await connection.getProgramAccounts(programId, {
        commitment: "confirmed",
        filters: [
          { memcmp: { offset: 0, bytes: base58.decode(accountDiscriminator("LimitOrder")) } },
          ...(referral ? [{ memcmp: { offset: ORDER_REFERRAL_OFFSET, bytes: referral.toBase58() } }] : []),
          { memcmp: { offset: ORDER_PERMISSION_OFFSET, bytes: permitted } },
        ],
        dataSlice: { offset: 8, length: 64 },
      });
      return accounts.map((entry) => {
        const data = Buffer.from(entry.account.data);
        return { pool: new PublicKey(data.subarray(0, 32)).toBase58(), nftMint: new PublicKey(data.subarray(32, 64)).toBase58() };
      });
    });
  }

  /**
   * The holder of an order's NFT, where it lets `collector` collect: its NFT account names the collector as the
   * delegate with nothing delegated, as the program asks. Null — nobody holds it so, or it lets someone else in.
   */
  async function holderFor(nftMint: Address, collector: Address): Promise<Address | null> {
    return refusing(async () => {
      const mint = keyOf(nftMint, "The order's NFT");
      const agent = keyOf(collector, "The collector");
      const holders = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] });
      for (const holder of holders) {
        const account = Buffer.from(holder.account.data);
        if (account.length < TOKEN_ACCOUNT_BYTES || account.readBigUInt64LE(64) !== 1n) continue;
        const owner = new PublicKey(account.subarray(32, 64));
        /* The program acts on the holder's NFT account alone, and on a delegate with nothing delegated. */
        if (!holder.pubkey.equals(findNftAccount(mint, owner))) continue;
        if (account.readUInt32LE(TOKEN_ACCOUNT_DELEGATE_OFFSET) !== 1 || !new PublicKey(account.subarray(TOKEN_ACCOUNT_DELEGATE_OFFSET + 4, TOKEN_ACCOUNT_DELEGATE_OFFSET + 36)).equals(agent)) continue;
        if (account.readBigUInt64LE(TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET) !== 0n) continue;
        return owner.toBase58();
      }
      return null;
    });
  }

  return { ofWallet, ofPool, ofCollector, delegatedOrders, holderFor };
}

export type DlmmProHoldingsReader = ReturnType<typeof createDlmmProHoldings>;
