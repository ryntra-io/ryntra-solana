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
 * Both reads are indexed requests: a public node may refuse them, and a refusal throws — it is never read as «holds
 * nothing».
 */

import { deriveLimitOrder, derivePosition, findNftAccount } from "@meteora-ag/dlmm-pro-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import type { Address } from "../../contracts.ts";
import type { DlmmProContext } from "./pools.server.ts";
import { accountDiscriminator, refusing } from "./sdk.server.ts";
import { keyOf } from "./tx.server.ts";

export type DlmmProHoldings = Readonly<{
  /** The NFT mints of the positions and of the limit orders, with the pool each belongs to. */
  positions: readonly Readonly<{ nftMint: Address; pool: Address }>[];
  orders: readonly Readonly<{ nftMint: Address; pool: Address }>[];
}>;

const base58 = getBase58Decoder();

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

  return { ofWallet, ofPool };
}

export type DlmmProHoldingsReader = ReturnType<typeof createDlmmProHoldings>;
