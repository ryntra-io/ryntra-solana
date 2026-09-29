import { address, getAddressEncoder } from "@solana/kit";
import type { SolanaWalletAction } from "./action-ledger.ts";
import type { CctpBurnClaimRecord } from "./cctp-burn-claim.ts";
import type { CctpAttestationLookup } from "./cctp-attestation.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY, solanaCctpLane } from "./cctp-registry.ts";
import type { TransferObservation } from "./observe.ts";

/** Read projection only. It cannot alter the claim or authorize a transfer. */
export function projectBridgeDetails(action: SolanaWalletAction, claim: CctpBurnClaimRecord, lookup: CctpAttestationLookup | null): SolanaWalletAction {
  if (action.lane !== "BRIDGE" || action.network !== claim.network || action.actionId !== claim.intentDigest) return action;
  const toSolana = claim.direction === "BASE_TO_SOLANA" || claim.direction === "ETHEREUM_TO_SOLANA";
  if (toSolana && claim.destinationWallet && claim.destinationWallet !== action.wallet) return action;
  /* The History row's word for where the money went, read from the claim's
     own direction: a projection that wrote "BASE" for every outbound lane
     would file an Ethereum arrival under the wrong chain. */
  const destination = toSolana ? "SOLANA" : claim.direction === "SOLANA_TO_ETHEREUM" ? "ETHEREUM" : "BASE";
  if (action.destination !== null && action.destination !== destination) return action;
  const signature = toSolana ? claim.mintTransactionHash : claim.burnSignature;
  let result = { ...action, destination, signature: action.signature ?? (signature && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature) ? signature : null) } as SolanaWalletAction;
  if (!lookup || lookup.state !== "ATTESTED" || lookup.messagesReturned !== 1 || lookup.transactionHash !== claim.burnSignature || !claim.messageNonce || lookup.attested?.nonce !== claim.messageNonce) return result;
  const lane = solanaCctpLane(claim.direction);
  const { header, burn } = lookup.attested.decoded;
  const token = lane.source.addressFormat === "EVM_HEX"
    ? `0x${lane.source.asset.address.slice(2).toLowerCase().padStart(64, "0")}`
    : `0x${Buffer.from(getAddressEncoder().encode(address(lane.source.asset.address))).toString("hex")}`;
  if (!burn || header.sourceDomain !== lane.source.domain || header.destinationDomain !== lane.destination.domain || burn.burnToken.toLowerCase() !== token) return result;
  if (claim.sourceAccount && burn.messageSender.toLowerCase() !== `0x${claim.sourceAccount.slice(2).toLowerCase().padStart(64, "0")}`) return result;
  const raw = toSolana ? BigInt(burn.amountRaw) - BigInt(burn.feeExecutedRaw) : BigInt(burn.amountRaw);
  if (raw < 0n) return result;
  const movement = { mint: null, amountRaw: raw.toString(), decimals: 6, symbol: "USDC" };
  // Incoming value is shown only after the lane already recorded its arrival.
  if (toSolana && action.outcome === "DONE") result = { ...result, in: action.in ?? movement };
  if (!toSolana) result = { ...result, out: action.out ?? movement };
  return result;
}

/**
 * Recover a historical reverse-bridge amount from the destination transaction.
 *
 * Older terminal rows retained the intent, wallet and mint transaction but not
 * the amount. The transaction itself is the narrowest trustworthy source: it
 * names the exact USDC account delta caused by that mint. Every binding below
 * must agree before the display gains a number.
 */
export function projectReverseBridgeArrival(
  action: SolanaWalletAction,
  claim: CctpBurnClaimRecord,
  observed: TransferObservation | null,
): SolanaWalletAction {
  if (
    observed === null ||
    action.lane !== "BRIDGE" ||
    action.network !== "mainnet" ||
    action.network !== claim.network ||
    action.actionId !== claim.intentDigest ||
    action.wallet !== claim.destinationWallet ||
    action.outcome !== "DONE" ||
    (claim.direction !== "BASE_TO_SOLANA" && claim.direction !== "ETHEREUM_TO_SOLANA") ||
    claim.state !== "RECEIPTED" ||
    claim.mintTransactionHash === null ||
    observed.observation.network !== action.network ||
    observed.observation.signature !== claim.mintTransactionHash ||
    (action.signature !== null && action.signature !== claim.mintTransactionHash) ||
    (action.destination !== null && action.destination !== "SOLANA") ||
    !observed.transactionSucceeded
  ) return action;

  const solana = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana;
  const requiredPrograms = solana.components.map((component) => component.address);
  if (!requiredPrograms.every((program) => observed.invokedPrograms.includes(program))) return action;

  const credits = observed.observation.balanceDeltas.flatMap((delta) => {
    if (delta.mint !== solana.asset.address || BigInt(delta.rawDelta) <= 0n) return [];
    const account = observed.postTokenAccounts.find((candidate) => candidate.account === delta.account);
    if (
      !account ||
      account.owner !== action.wallet ||
      account.mint !== solana.asset.address ||
      account.decimals !== solana.asset.decimals
    ) return [];
    return [delta];
  });
  if (credits.length !== 1) return action;

  return {
    ...action,
    destination: "SOLANA",
    signature: action.signature ?? claim.mintTransactionHash,
    in: action.in ?? {
      mint: null,
      amountRaw: credits[0].rawDelta,
      decimals: solana.asset.decimals,
      symbol: solana.asset.symbol,
    },
  };
}
