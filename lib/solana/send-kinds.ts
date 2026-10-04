/**
 * Four Send action types, and one successful case never claims the others.
 *
 * Native SOL is not a mint. Classic SPL `transferChecked` is not Token-2022.
 * Creating the recipient's associated account is not the same transfer as
 * sending into an account that already exists. Folding any of those into a
 * boolean on a shared plan is how a USDC+ATA proof would be read as a native
 * SOL proof.
 */

export const SEND_ACTION_KINDS = [
  "NATIVE_SOL",
  "SPL_TRANSFER_CHECKED",
  "TOKEN_2022",
  "TOKEN_ATA_CREATE",
] as const;

export type SendActionKind = (typeof SEND_ACTION_KINDS)[number];

export { NATIVE_SOL_TRANSFER_ACTION_REF } from "../agent-control/adapters/solana-token-2022.ts";

/** Decimals of native SOL. A fact of the chain, not a mint read. */
export const NATIVE_SOL_DECIMALS = 9;

/**
 * Wrapped-SOL mint, used only to ask Jupiter for a USD price of native SOL.
 * It is not the asset being sent: a native transfer is System Program
 * lamports, not an SPL movement of this mint.
 */
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Circle-issued classic USDC on Solana Mainnet. Client-safe identity only. */
export const SOLANA_MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * The System Program, as a plain string.
 *
 * `native-sol.ts` re-exports it as a typed `Address` and owns the transfer
 * instruction. It lives here as well so modules that only need to *recognize*
 * a System-owned account — the recipient resolver, for one — can do so without
 * importing the transaction builder and closing an import cycle around it.
 */
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/**
 * The other program identities a Send message may invoke.
 *
 * They are declared here, beside the token programs, because they are plain
 * base58 strings that both the server and the browser need to *recognize*.
 * Each used to live next to the machinery that emits it — the ATA id in the
 * canary policy, the memo id in the transaction builder, the guard ids in the
 * wallet-modification checker — and a client component that needed one of them
 * pulled `node:crypto` into the browser bundle through that module, which fails
 * at build time and is invisible to every server-side test.
 */
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** SPL Memo v3. What a required-memo destination expects to have run. */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/**
 * Classify a token transfer after it is built. Native SOL never enters here.
 *
 * **The token program decides the family; creating the recipient's account is
 * an effect, not a family.** This used to be the other way round — ATA-create
 * outranked the program kind — on the reasoning that claiming an account-
 * creating transfer as a proven existing-account transfer would be an overlap.
 * The reasoning was right and the encoding was wrong, and the Token-2022 canary
 * is where that cost something: a Token-2022 transfer into a recipient with no
 * account classified as `TOKEN_ATA_CREATE`, which carries M1B's classic-USDC
 * envelope — a 0.5 USD cap and a mint allowlist holding classic USDC alone. A
 * Token-2022 canary would have been decided by the policy written for a
 * different mint on a different program, and the answer would have been a
 * permanent `BLOCK` that read as a refusal rather than as a misfiling.
 *
 * The overlap the old shape guarded against is preserved where it belongs.
 * `createsRecipientAccount` travels on the plan beside this verdict, the
 * transaction still emits the create instruction, the rent is still stated
 * before Review and recorded in the Receipt, and no receipt may claim an
 * existing-account transfer when an account was created. What changes is only
 * which owner envelope decides the action — and that must follow the economic
 * action and its token program.
 *
 * `TOKEN_ATA_CREATE` therefore keeps exactly its original meaning: the classic
 * SPL account-creation case the M1B canary proved. Nothing about that row moves.
 */
export function classifyTokenTransfer(args: {
  tokenProgram: string;
  createsRecipientAccount: boolean;
}): SendActionKind {
  if (args.tokenProgram === TOKEN_2022_PROGRAM_ID) return "TOKEN_2022";
  if (args.createsRecipientAccount) return "TOKEN_ATA_CREATE";
  return "SPL_TRANSFER_CHECKED";
}

export function sendActionKindLabel(kind: SendActionKind): string {
  switch (kind) {
    case "NATIVE_SOL":
      return "Native SOL";
    case "SPL_TRANSFER_CHECKED":
      return "SPL transfer";
    case "TOKEN_2022":
      return "Token Extensions";
    case "TOKEN_ATA_CREATE":
      return "Token account will be created";
  }
}
