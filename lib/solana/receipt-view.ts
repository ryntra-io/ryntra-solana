import type { SolanaWalletAction } from "./action-ledger.ts";
import { explorerTxUrl } from "./explorer.ts";
import { SOLANA_CAIP2 } from "../agent-control/adapters/solana-token-2022.ts";
import { EVM_EXPLORER_TX, SWAP_NETWORK_META } from "../swap/catalog.ts";

type ReceiptRecord = Readonly<Record<string, unknown>>;
export type StoredReceiptView = Readonly<{
  wallet: string;
  storedAt: string;
  receipt: ReceiptRecord;
}>;

export type ReceiptExplorerLink = Readonly<{
  leg: "transaction" | "source" | "destination";
  /** The chain's own name, from the swap catalogue. Seven of them and counting. */
  chain: string;
  hash: string;
  href: string;
}>;

/** Where a bridge delivered. The History row's vocabulary, one word per chain. */
/* Robinhood Chain is reachable by cross-chain swap only — never by the USDC
   bridge, which has no Circle domain there. It appears here because History
   and receipts name where value went, whichever lane took it. */
export type BridgeDestination = "BASE" | "SOLANA" | "ETHEREUM" | "ROBINHOOD";

type BridgeDirection = "SOLANA_TO_BASE" | "BASE_TO_SOLANA" | "SOLANA_TO_ETHEREUM" | "ETHEREUM_TO_SOLANA";

const BRIDGE_DIRECTIONS: readonly BridgeDirection[] = ["SOLANA_TO_BASE", "BASE_TO_SOLANA", "SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"];

/** The chain a lane arrives on, in the History row's words. Never guessed from an address. */
export function bridgeDestinationOf(direction: BridgeDirection): BridgeDestination {
  switch (direction) {
    case "SOLANA_TO_BASE":
      return "BASE";
    case "SOLANA_TO_ETHEREUM":
      return "ETHEREUM";
    default:
      return "SOLANA";
  }
}

type ReceiptBinding = Readonly<{
  lane: "SEND" | "SWAP" | "BRIDGE" | "CROSS_SWAP";
  actionId: string;
  signature: string | null;
  wallet: string | null;
  network: "mainnet" | "devnet";
  destination: BridgeDestination | null;
}>;

const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function outcomeOf(receipt: ReceiptRecord): Record<string, unknown> | null {
  return object(receipt.outcome);
}

function effectsOf(receipt: ReceiptRecord) {
  const outcome = outcomeOf(receipt);
  if (!Array.isArray(outcome?.observedEffects)) return [];
  return outcome.observedEffects.flatMap((value) => {
    const effect = object(value);
    return effect &&
      typeof effect.description === "string" &&
      typeof effect.sourceRef === "string" &&
      typeof effect.observedAt === "string"
      ? [{ description: effect.description, sourceRef: effect.sourceRef, observedAt: effect.observedAt }]
      : [];
  });
}

function chunkedFacts(receipt: ReceiptRecord, prefix: string): Record<string, unknown> | null {
  const chunks: { index: number; total: number; body: string }[] = [];
  for (const effect of effectsOf(receipt)) {
    if (!effect.sourceRef.startsWith(prefix)) continue;
    const position = /#(\d+)\/(\d+)$/.exec(effect.sourceRef);
    if (!position) continue;
    chunks.push({ index: Number(position[1]), total: Number(position[2]), body: effect.description });
  }
  if (chunks.length === 0) return null;
  chunks.sort((left, right) => left.index - right.index);
  const total = chunks[0].total;
  if (total !== chunks.length || chunks.some((chunk, index) => chunk.total !== total || chunk.index !== index + 1)) return null;
  try {
    return object(JSON.parse(chunks.map((chunk) => chunk.body).join("")));
  } catch {
    return null;
  }
}

type SendFacts = Readonly<{ network: "mainnet" | "devnet"; sender: string; signature: string }>;
function sendFacts(receipt: ReceiptRecord): SendFacts | null {
  const facts = chunkedFacts(receipt, "ryntra.solana.send-receipt.facts@1:");
  if (!facts || facts.schema !== "ryntra.solana.send-receipt") return null;
  if (facts.network !== "mainnet" && facts.network !== "devnet") return null;
  if (typeof facts.sender !== "string" || typeof facts.signature !== "string") return null;
  return { network: facts.network, sender: facts.sender, signature: facts.signature };
}

type SwapFacts = Readonly<{ signature: string }>;
function swapFacts(receipt: ReceiptRecord): SwapFacts | null {
  const facts = chunkedFacts(receipt, "ryntra.solana.swap-receipt.facts@1:");
  if (!facts || facts.schema !== "ryntra.solana.swap-receipt-facts") return null;
  const observation = object(facts.independentObservation);
  return typeof observation?.signature === "string" ? { signature: observation.signature } : null;
}

type BridgeFacts = Readonly<{
  direction: BridgeDirection;
  intentDigest: string;
  source: Readonly<{ chainRef: string; wallet: string; burnSignature: string }>;
  destination: Readonly<{ chainRef: string; recipient: string; mintTransactionHash: string | null }>;
  amounts: Readonly<{ burnedRaw: string; mintedRaw: string | null }>;
}>;
function bridgeFacts(receipt: ReceiptRecord): BridgeFacts | null {
  const facts = chunkedFacts(receipt, "ryntra.solana.bridge-receipt.facts@2:");
  if (!facts || facts.schema !== "ryntra.solana.bridge-receipt.facts@2") return null;
  const claimed = facts.direction ?? "SOLANA_TO_BASE";
  const source = object(facts.source);
  const destination = object(facts.destination);
  const amounts = object(facts.amounts);
  if (typeof claimed !== "string" || !(BRIDGE_DIRECTIONS as readonly string[]).includes(claimed)) return null;
  const direction = claimed as BridgeDirection;
  if (
    typeof facts.intentDigest !== "string" ||
    typeof source?.chainRef !== "string" ||
    typeof source.wallet !== "string" ||
    typeof source.burnSignature !== "string" ||
    typeof destination?.chainRef !== "string" ||
    typeof destination.recipient !== "string" ||
    (destination.mintTransactionHash !== null && typeof destination.mintTransactionHash !== "string") ||
    typeof amounts?.burnedRaw !== "string" ||
    (amounts.mintedRaw !== null && typeof amounts.mintedRaw !== "string")
  ) return null;
  return {
    direction,
    intentDigest: facts.intentDigest,
    source: { chainRef: source.chainRef, wallet: source.wallet, burnSignature: source.burnSignature },
    destination: {
      chainRef: destination.chainRef,
      recipient: destination.recipient,
      mintTransactionHash: destination.mintTransactionHash,
    },
    amounts: { burnedRaw: amounts.burnedRaw, mintedRaw: amounts.mintedRaw },
  };
}

type CrossSwapSide = Readonly<{
  network: string;
  chainRef: string;
  wallet: string;
  symbol: string | null;
  decimals: number | null;
  txHash: string | null;
}>;

type CrossSwapFacts = Readonly<{
  intentDigest: string;
  source: CrossSwapSide;
  destination: CrossSwapSide;
  amounts: Readonly<{ sentRaw: string; receivedRaw: string | null }>;
  fee: Readonly<{ collected: boolean; paidAmountRaw: string | null; symbol: string | null; decimals: number | null; paidUsd: number | null }>;
}>;

/**
 * The signed facts of a cross-chain receipt.
 *
 * Read defensively, exactly like the bridge facts above: a receipt this does
 * not recognise yields null and every caller falls back to what it showed
 * before, because a receipts page that throws is worse than one that is terse.
 */
function crossSwapFacts(receipt: ReceiptRecord): CrossSwapFacts | null {
  const facts = chunkedFacts(receipt, "ryntra.solana.cross-swap-receipt.facts@1:");
  if (!facts || facts.schema !== "ryntra.solana.cross-swap-receipt.facts@1") return null;
  const source = object(facts.source);
  const destination = object(facts.destination);
  const amounts = object(facts.amounts);
  const fee = object(facts.fee);
  if (
    typeof facts.intentDigest !== "string" ||
    typeof source?.network !== "string" ||
    typeof source.chainRef !== "string" ||
    typeof source.wallet !== "string" ||
    typeof destination?.network !== "string" ||
    typeof destination.chainRef !== "string" ||
    typeof destination.wallet !== "string" ||
    typeof amounts?.sentRaw !== "string"
  ) return null;
  const hash = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const scale = (value: unknown): number | null => (typeof value === "number" ? value : null);
  const side = (raw: Record<string, unknown>): CrossSwapSide => ({
    network: raw.network as string,
    chainRef: raw.chainRef as string,
    wallet: raw.wallet as string,
    symbol: hash(raw.symbol),
    decimals: scale(raw.decimals),
    txHash: hash(raw.txHash),
  });
  return {
    intentDigest: facts.intentDigest,
    source: side(source),
    destination: side(destination),
    amounts: { sentRaw: amounts.sentRaw, receivedRaw: hash(amounts.receivedRaw) },
    fee: {
      collected: fee?.collected === true,
      paidAmountRaw: hash(fee?.paidAmountRaw),
      symbol: hash(fee?.symbol),
      decimals: scale(fee?.decimals),
      paidUsd: scale(fee?.paidUsd),
    },
  };
}

/**
 * What a cross-chain receipt says, in the fields a card renders.
 *
 * Exported so the receipts page reads the signed facts rather than the
 * receipt's own id — canon `§0.5`. `outcome_solana_cross_swap_9f2c…` above a
 * status word tells a person with three bridges nothing about which is which,
 * and it is internal text on a customer screen besides.
 */
export function crossSwapReceiptSummary(receipt: ReceiptRecord): Readonly<{
  sent: Readonly<{ amountRaw: string; symbol: string | null; decimals: number | null }>;
  received: Readonly<{ amountRaw: string; symbol: string | null; decimals: number | null }> | null;
  from: string;
  to: string;
  fee: CrossSwapFacts["fee"];
}> | null {
  const facts = crossSwapFacts(receipt);
  if (!facts) return null;
  const label = (network: string): string =>
    network in SWAP_NETWORK_META ? SWAP_NETWORK_META[network as keyof typeof SWAP_NETWORK_META].label : network;
  return {
    sent: { amountRaw: facts.amounts.sentRaw, symbol: facts.source.symbol, decimals: facts.source.decimals },
    received:
      facts.amounts.receivedRaw === null
        ? null
        : { amountRaw: facts.amounts.receivedRaw, symbol: facts.destination.symbol, decimals: facts.destination.decimals },
    from: label(facts.source.network),
    to: label(facts.destination.network),
    fee: facts.fee,
  };
}

function outcomeStatus(receipt: ReceiptRecord): string | null {
  const status = outcomeOf(receipt)?.status;
  return typeof status === "string" ? status : null;
}

function transactionHash(receipt: ReceiptRecord): string | null {
  const hash = outcomeOf(receipt)?.transactionHash;
  return typeof hash === "string" ? hash : null;
}

function chainRef(receipt: ReceiptRecord): string | null {
  const ref = outcomeOf(receipt)?.chainRef;
  return typeof ref === "string" ? ref : null;
}

/**
 * Every chain a receipt in this product can name, keyed by its own reference.
 *
 * Built from the swap catalogue rather than written out again. The four
 * networks `RYN-SWAP-BRIDGE-SPLIT-001` added — Arbitrum, Optimism, Polygon and
 * BNB Chain — are chains a cross-chain receipt can legitimately be about, and a
 * hand-written ladder of three `if`s would have silently offered no link for
 * any of them. The compiler now names a new network in `EVM_EXPLORER_TX` or the
 * file does not build.
 */
const EXPLORER_BY_CHAIN_REF: Readonly<Record<string, { chain: string; tx: (hash: string) => string }>> = Object.freeze(
  Object.fromEntries([
    ...(Object.keys(EVM_EXPLORER_TX) as (keyof typeof EVM_EXPLORER_TX)[]).map((network) => [
      SWAP_NETWORK_META[network].chainRef,
      { chain: SWAP_NETWORK_META[network].label, tx: (hash: string) => `${EVM_EXPLORER_TX[network]}${hash}` },
    ]),
    [SOLANA_CAIP2.mainnet, { chain: "Solana", tx: (hash: string) => explorerTxUrl("mainnet", hash) }],
    [SOLANA_CAIP2.devnet, { chain: "Solana", tx: (hash: string) => explorerTxUrl("devnet", hash) }],
  ]),
);

function explorerLink(ref: string, hash: string, leg: ReceiptExplorerLink["leg"]): ReceiptExplorerLink | null {
  const entry = EXPLORER_BY_CHAIN_REF[ref];
  if (!entry) return null;
  const shaped = ref.startsWith("solana:") ? SOLANA_SIGNATURE.test(hash) : /^0x[0-9a-fA-F]{64}$/.test(hash);
  if (!shaped) return null;
  return { leg, chain: entry.chain, hash, href: entry.tx(hash) };
}

/** Explorer destinations come from the observation that named each hash. */
export function receiptExplorerLinks(receipt: ReceiptRecord): readonly ReceiptExplorerLink[] {
  const cross = crossSwapFacts(receipt);
  if (cross) {
    const source = cross.source.txHash ? explorerLink(cross.source.chainRef, cross.source.txHash, "source") : null;
    const destination = cross.destination.txHash
      ? explorerLink(cross.destination.chainRef, cross.destination.txHash, "destination")
      : null;
    return [source, destination].filter((value): value is ReceiptExplorerLink => value !== null);
  }
  const bridge = bridgeFacts(receipt);
  if (bridge) {
    const source = explorerLink(bridge.source.chainRef, bridge.source.burnSignature, "source");
    const destination = bridge.destination.mintTransactionHash
      ? explorerLink(bridge.destination.chainRef, bridge.destination.mintTransactionHash, "destination")
      : null;
    return [source, destination].filter((value): value is ReceiptExplorerLink => value !== null);
  }
  const ref = chainRef(receipt);
  const hash = transactionHash(receipt);
  const link = ref && hash ? explorerLink(ref, hash, "transaction") : null;
  return link ? [link] : [];
}

/** A strict binding extracted only from structured, signed-receipt facts. */
export function receiptBinding(receipt: ReceiptRecord): ReceiptBinding | null {
  const outcomeHash = transactionHash(receipt);
  const outcomeRef = chainRef(receipt);

  const send = sendFacts(receipt);
  if (send && outcomeHash === send.signature) {
    const expectedRef = send.network === "mainnet" ? SOLANA_CAIP2.mainnet : SOLANA_CAIP2.devnet;
    if (outcomeRef !== expectedRef) return null;
    return {
      lane: "SEND",
      actionId: send.signature,
      signature: send.signature,
      wallet: send.sender,
      network: send.network,
      destination: null,
    };
  }

  const swap = swapFacts(receipt);
  if (swap && outcomeHash === swap.signature && outcomeRef === SOLANA_CAIP2.mainnet) {
    return {
      lane: "SWAP",
      actionId: swap.signature,
      signature: swap.signature,
      wallet: null,
      network: "mainnet",
      destination: null,
    };
  }

  /*
   * A cross-chain operation, bound to the intent the server planned.
   *
   * Its outcome hash is the source transaction where there is one and the
   * intent digest where there is not — the same rule the minter applies — and
   * both are checked here rather than one, so a receipt whose anchor does not
   * match its own facts binds to nothing.
   *
   * `destination` is deliberately null. The History row's own destination field
   * holds four words and this lane reaches seven chains, so comparing them
   * would refuse a correct receipt for an Arbitrum leg. The receipt names the
   * real chain; the row names what its schema can.
   */
  const cross = crossSwapFacts(receipt);
  if (cross && outcomeRef === cross.source.chainRef && outcomeHash === (cross.source.txHash ?? cross.intentDigest)) {
    const solanaWallet =
      cross.source.network === "solana"
        ? cross.source.wallet
        : cross.destination.network === "solana"
          ? cross.destination.wallet
          : null;
    return {
      lane: "CROSS_SWAP",
      actionId: cross.intentDigest,
      /* Only the source signature, because that is the one the row's own
         base58 `signature` field can ever hold for this lane. */
      signature: cross.source.txHash && SOLANA_SIGNATURE.test(cross.source.txHash) ? cross.source.txHash : null,
      wallet: solanaWallet,
      network: "mainnet",
      destination: null,
    };
  }

  const bridge = bridgeFacts(receipt);
  if (bridge && outcomeHash === bridge.source.burnSignature && outcomeRef === bridge.source.chainRef) {
    const destination = bridgeDestinationOf(bridge.direction);
    const toSolana = destination === "SOLANA";
    const solanaSignature = toSolana ? bridge.destination.mintTransactionHash : bridge.source.burnSignature;
    const wallet = toSolana ? bridge.destination.recipient : bridge.source.wallet;
    return {
      lane: "BRIDGE",
      actionId: bridge.intentDigest,
      signature: solanaSignature && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(solanaSignature) ? solanaSignature : null,
      wallet,
      network: "mainnet",
      destination,
    };
  }

  return null;
}

export function receiptMatchesAction(row: StoredReceiptView, action: SolanaWalletAction): boolean {
  if (row.wallet !== action.wallet) return false;
  const binding = receiptBinding(row.receipt);
  if (!binding) return false;
  return binding.lane === action.lane &&
    binding.actionId === action.actionId &&
    binding.network === action.network &&
    (binding.wallet === null || binding.wallet === action.wallet) &&
    (binding.signature === null || action.signature === null || binding.signature === action.signature) &&
    (binding.destination === null || action.destination === null || binding.destination === action.destination);
}

/**
 * A receipt may advance a stale row only after the existing verifier accepted
 * both its bytes and issuer. Matching local-storage keys alone is never enough.
 */
export function projectVerifiedReceiptOutcome(
  action: SolanaWalletAction,
  row: StoredReceiptView | null,
  verified: boolean,
): SolanaWalletAction {
  if (!row || !verified || !receiptMatchesAction(row, action)) return action;
  const status = outcomeStatus(row.receipt);
  if (status !== "MATCHED" && status !== "DEVIATION_RECORDED" && status !== "FAILED") return action;
  const outcome = status === "FAILED" ? "FAILED" : "DONE";
  return action.outcome === outcome ? action : { ...action, outcome };
}

export function receiptMatchesFilter(
  row: StoredReceiptView,
  filter: string,
  actions: readonly SolanaWalletAction[],
): boolean {
  const needle = filter.trim();
  if (!needle) return true;
  const binding = receiptBinding(row.receipt);
  if (binding && (binding.actionId === needle || binding.signature === needle)) return true;
  if (transactionHash(row.receipt) === needle) return true;
  return actions.some(
    (action) =>
      receiptMatchesAction(row, action) &&
      (action.actionId === needle || action.signature === needle),
  );
}

export function findReceiptForAction(
  rows: readonly StoredReceiptView[],
  action: SolanaWalletAction,
): StoredReceiptView | null {
  return rows.find((row) => receiptMatchesAction(row, action)) ?? null;
}

export function receiptKind(receipt: ReceiptRecord): "SEND" | "SWAP" | "BRIDGE" | "CROSS_SWAP" | "RECEIPT" {
  const binding = receiptBinding(receipt);
  if (binding) return binding.lane;
  if (crossSwapFacts(receipt) !== null) return "CROSS_SWAP";
  const refs = Array.isArray(object(receipt.registry)?.refs)
    ? (object(receipt.registry)?.refs as unknown[]).map(object)
    : [];
  const joined = refs.map((entry) => String(entry?.ref ?? "")).join(" ").toLowerCase();
  if (joined.includes("swap")) return "SWAP";
  if (joined.includes("bridge") || String(receipt.id ?? "").startsWith("outcome_solana_bridge_")) return "BRIDGE";
  if (joined.includes("transfer")) return "SEND";
  return "RECEIPT";
}

export function bridgeReceiptAmount(receipt: ReceiptRecord): Readonly<{
  amountRaw: string;
  decimals: 6;
  symbol: "USDC";
  direction: BridgeDestination;
}> | null {
  const facts = bridgeFacts(receipt);
  if (!facts) return null;
  const amountRaw = facts.amounts.mintedRaw ?? facts.amounts.burnedRaw;
  return {
    amountRaw,
    decimals: 6,
    symbol: "USDC",
    direction: bridgeDestinationOf(facts.direction),
  };
}
