/**
 * The features of a Token-2022 mint, by the program's own numbers, and the two lists the agent's rule reads
 * them by (`./token-2022.ts`). Pure numbers and nothing else, so a form can read the lists without the chain's library.
 */

/** Token-2022's extension numbers, as the program writes them. */
export const EXTENSION = Object.freeze({
  TransferFeeConfig: 1,
  MintCloseAuthority: 3,
  ConfidentialTransferMint: 4,
  ConfidentialTransferAccount: 5,
  DefaultAccountState: 6,
  NonTransferable: 9,
  InterestBearingConfig: 10,
  PermanentDelegate: 12,
  TransferHook: 14,
  ConfidentialTransferFeeConfig: 16,
  MetadataPointer: 18,
  TokenMetadata: 19,
  GroupPointer: 20,
  TokenGroup: 21,
  GroupMemberPointer: 22,
  TokenGroupMember: 23,
  ConfidentialMintBurn: 24,
  ScaledUiAmountConfig: 25,
  PausableConfig: 26,
});

/**
 * Every mint feature the agent trades a coin with. Names and pictures, groups — nothing that moves or holds a coin;
 * the transfer fee, under the rule of `./token-2022.ts`.
 */
export const ALLOWED_MINT_EXTENSIONS: readonly number[] = Object.freeze([
  EXTENSION.MetadataPointer,
  EXTENSION.TokenMetadata,
  EXTENSION.GroupPointer,
  EXTENSION.TokenGroup,
  EXTENSION.GroupMemberPointer,
  EXTENSION.TokenGroupMember,
  EXTENSION.TransferFeeConfig,
]);

/**
 * The features of a tokenized stock's mint — taken for a stock of the shelf and for no other coin.
 *
 * A stock's issuer keeps a regulated instrument's rights over its token: it can take the token out of any wallet, pause
 * every transfer, freeze one wallet, name a program that checks transfers, let amounts be hidden, and scale the shown
 * amount for a split or a dividend. On a coin anyone can mint, each of these is a trap, and the list above refuses them
 * all. They are never added to that list: it would open them to every coin. The agent takes them only on a mint its
 * caller found, by its address, on the shelf of verified companies (`../stocks/shelf.ts`, read by `./stocks.server.ts`),
 * and only while the mint's own bytes, read at that moment, say (`./token-2022.ts` `readCoin` with `stock`):
 * - the transfer hook names no program — nothing of the issuer's runs on a transfer;
 * - the token is not paused now;
 * - a new wallet of it does not start frozen;
 * and her own account of it is not frozen and takes plain amounts (`stockAccountRefusal`): hidden amounts never stand
 * between a buy and her. The issuer's rights themselves stay, and the person is told of them before she signs.
 */
export const STOCK_MINT_EXTENSIONS: readonly number[] = Object.freeze([
  EXTENSION.PermanentDelegate,
  EXTENSION.PausableConfig,
  EXTENSION.TransferHook,
  EXTENSION.ConfidentialTransferMint,
  EXTENSION.ScaledUiAmountConfig,
  EXTENSION.DefaultAccountState,
]);
