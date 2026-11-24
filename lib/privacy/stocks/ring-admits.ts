/**
 * Why a stock token does not sit in the private balance — read from the token itself, never assumed.
 *
 * The ring's program makes a coin's vault only when every Token-2022 extension of its mint is on its allowed list
 * (`helius-labs/privacy-rings`, `programs/shielded-pool/src/instructions/create_spl_interface/validate.rs`). The list,
 * as the research of 18–19.11 read it (`docs/research/private-payments-2026-11-19/SOLANA.md`, 1.6 and 3.6):
 * - in the program's main branch: interest-bearing, metadata pointer and metadata, the group extensions, scaled amount,
 *   the three confidential extensions, transfer fee, permanent delegate, mint close authority, transfer hook;
 * - on mainnet the last three are not live yet;
 * - never: default account state, pausable, non-transferable — and every tokenized stock carries the first two
 *   (SPCX by Backpack via Sunrise, SPYx and NVDAx by xStocks, read from mainnet 18.11).
 *
 * The vault is one for every ring, so a custom ring does not change this. Only Helius can widen the list; until then the
 * stock a person buys from the private balance lands on their own wallet (`plan.ts`). Pure.
 */

/** Extension names as Solana's parsed account data spells them (`jsonParsed`). */
export type ExtensionName = string;

/** On the ring program's allowed list in its main branch. */
export const RING_ALLOWED_MAIN: readonly ExtensionName[] = Object.freeze([
  'interestBearingConfig',
  'metadataPointer',
  'tokenMetadata',
  'groupPointer',
  'tokenGroup',
  'groupMemberPointer',
  'tokenGroupMember',
  'scaledUiAmountConfig',
  'confidentialTransferMint',
  'confidentialTransferFeeConfig',
  'confidentialMintBurn',
  'transferFeeConfig',
  'permanentDelegate',
  'mintCloseAuthority',
  'transferHook',
]);

/** Allowed in main but not yet live on mainnet. */
export const RING_NOT_YET_LIVE: readonly ExtensionName[] = Object.freeze(['permanentDelegate', 'mintCloseAuthority', 'transferHook']);

/** What the ring refuses even in main — every tokenized stock carries the first two. */
export const RING_NEVER: readonly ExtensionName[] = Object.freeze(['defaultAccountState', 'pausableConfig', 'nonTransferable']);

/** A tokenized stock's mint as read from mainnet (SPCX, SPYx, NVDAx — the same eight). */
export const STOCK_EXTENSIONS: readonly ExtensionName[] = Object.freeze([
  'metadataPointer',
  'permanentDelegate',
  'defaultAccountState',
  'pausableConfig',
  'confidentialTransferMint',
  'transferHook',
  'scaledUiAmountConfig',
  'tokenMetadata',
]);

/** Which program's list: the main branch, or the program live on the main network today. */
export type RingProgram = 'main' | 'live';

export type Admission = Readonly<{
  admitted: boolean;
  /** The mint's extensions the ring refuses, in the mint's order. */
  refused: readonly ExtensionName[];
}>;

/** Whether the ring takes a coin with these extensions (a classic token or SOL has none: admitted). */
export function ringAdmits(extensions: readonly ExtensionName[], program: RingProgram = 'main'): Admission {
  const allowed = new Set(program === 'main' ? RING_ALLOWED_MAIN : RING_ALLOWED_MAIN.filter((name) => !RING_NOT_YET_LIVE.includes(name)));
  const refused = extensions.filter((name) => !allowed.has(name));
  return { admitted: refused.length === 0, refused };
}

/**
 * The one change that would let a stock sit in the private balance: the extensions the ring refuses in main, of the
 * ones a stock has. Today — default account state and pausable, exactly the sentence of the letter to Helius.
 */
export function stockAsk(extensions: readonly ExtensionName[] = STOCK_EXTENSIONS): readonly ExtensionName[] {
  return ringAdmits(extensions, 'main').refused;
}
