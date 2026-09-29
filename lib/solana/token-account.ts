import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
} from "@solana-program/token-2022";
import type { Address } from "@solana/kit";

/**
 * Token-account addressing, on its own.
 *
 * It used to live in `transaction.ts`, which meant that anything needing to
 * know where a token lands also had to import the whole transaction builder.
 * The recipient resolver needs exactly this one derivation and nothing else,
 * and importing the builder for it closed a cycle: builder → resolver →
 * builder. A cycle that ESM happens to tolerate today is still a cycle, so the
 * shared half moved here rather than being worked around.
 */

/** Derive the associated token account for one owner on one mint. */
export async function associatedTokenAccount(args: {
  owner: string;
  mint: string;
  tokenProgram: string;
}): Promise<string> {
  const [pda] = await findAssociatedTokenPda(
    {
      owner: args.owner as Address,
      mint: args.mint as Address,
      tokenProgram: args.tokenProgram as Address,
    },
    { programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS },
  );
  return String(pda);
}
