"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel } from "@/app/shell/panel";
import { StatusChip } from "@/app/shell/status-chip";
import { connectEvmWallet, EVM_WALLET_CHAINS, sendEvmTransaction } from "@/lib/base/wallet.client";
import { displayAmount, parseHumanAmount } from "@/lib/solana/amounts";
import { clearBridgeRun, readBridgeRun, saveBridgeRun } from "@/lib/solana/bridge-run.client";
import { addEphemeralSignature, createEphemeralMessageAccount } from "@/lib/solana/cctp-ephemeral.client";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { downloadReceipt, storeSolanaReceipt } from "@/lib/solana/send-receipt-vault.client";
import { signTransaction } from "@/lib/solana/wallet.client";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletConnectRow } from "../wallet-connect.tsx";
import { MoneyContext } from "../money/money-context.tsx";
import {
  bridgeAttestationCopy,
  bridgeBurnFailureCopy,
  bridgeNetworkReasonCopy,
  bridgeObservationCopy,
  bridgePlanFailureCopy,
  bridgeRecoveryCopy,
  bridgeWalletFailureCopy,
  type BridgeChainLabel,
} from "./bridge-copy.ts";

import styles from "./bridge.module.css";

/**
 * One transfer between two chains, in either direction, on one card.
 *
 * The card used to be a Solana-shaped form with Base written on the far side of
 * it: the amount came from a Solana wallet, the recipient box only accepted a
 * `0x` address, and the progress line said *Leaves Solana* whatever happened.
 * Making it bidirectional is not a matter of swapping two labels — the two
 * chains genuinely differ, and the card is where that has to become legible
 * rather than confusing.
 *
 * ## What actually differs, and how the card says so
 *
 * **Which wallet sends.** Solana → Base sends from the Solana wallet this
 * workspace is already connected to. Base → Solana sends from an Ethereum
 * wallet, and the Solana wallet becomes the one that *receives*. Both are
 * asked for at the moment they are needed and never before.
 *
 * **How many prompts.** A Solana burn is one wallet prompt plus a signature
 * made in this tab. A Base burn is one prompt, or two when Circle does not yet
 * have permission to move that much USDC. The number is derived from the live
 * allowance and printed before the first prompt opens, because an unannounced
 * second wallet window is indistinguishable from something going wrong.
 *
 * **What the money lands in.** On Base it lands at the address. On Solana it
 * lands in the USDC account that address owns — which may not exist yet, and is
 * then created in the same transaction that receives the transfer. The card
 * says so rather than surprising somebody with a deposit they did not expect.
 */

/**
 * USDC has six decimals on both chains CCTP moves it between. It is the one
 * number here that is a fact about the asset rather than a decision about the
 * product, which is why it survived the amount becoming something a person
 * types.
 */
const USDC_DECIMALS = 6;

/**
 * How long the card keeps one built Review before replacing it, measured from
 * the moment the browser received it.
 *
 * `builtAt` is stamped at the top of the server build, before the balance
 * reads, the Circle fee read, the simulation and the issuer signature. By the
 * time the Review is on screen a large part of its declared life is already
 * spent, so a countdown anchored to `builtAt` opened at eight seconds and a
 * signing margin subtracted from it left nothing: the founder watched the
 * number fall to zero, the card rebuilt, and pressing never reached the wallet.
 * That was measured on production, not reasoned about.
 *
 * The clock is therefore the browser's own. A rebuild lands a fresh blockhash
 * every half minute while the Review is read, which keeps what is on screen
 * signable for the whole time it is on screen, and removes the age refusal from
 * the press entirely. The burn route still refuses a plan whose blockhash has
 * actually died, which is the backstop that matters and the only one that can
 * see the chain.
 */
const REVIEW_REFRESH_MS = 30_000;

/**
 * How often the card asks Circle whether it has signed yet.
 *
 * A read, and only a read. Nothing financial is ever retried on a timer — the
 * burn and the destination step each happen once, from a press, and there is no
 * path here that repeats either. What this replaces is a person pressing a
 * button every minute for the fifteen to nineteen minutes a Standard transfer
 * takes, which is not a next action, it is waiting dressed up as one.
 *
 * Twenty seconds rather than Circle's five-second floor: this route shares a
 * request budget with everything else the page does, and polling at the floor
 * would spend all of it on a question whose answer changes once.
 */
const ATTESTATION_POLL_MS = 20_000;

/** How often the card re-reads the permission after an approval is sent. */
const ALLOWANCE_POLL_MS = 4_000;
const ALLOWANCE_POLL_ATTEMPTS = 30;

type Direction = "SOLANA_TO_BASE" | "BASE_TO_SOLANA" | "SOLANA_TO_ETHEREUM" | "ETHEREUM_TO_SOLANA";

/** The EVM end of the lane, chosen by name on the card. */
type EvmNetwork = "base" | "ethereum";
type Chain = "solana" | EvmNetwork;

/** The two lane names each EVM network takes part in. The direction module's
    own pairing, restated here so the card never derives a lane from a label. */
const DIRECTIONS: Readonly<Record<EvmNetwork, Readonly<{ fromSolana: Direction; toSolana: Direction }>>> = {
  base: { fromSolana: "SOLANA_TO_BASE", toSolana: "BASE_TO_SOLANA" },
  ethereum: { fromSolana: "SOLANA_TO_ETHEREUM", toSolana: "ETHEREUM_TO_SOLANA" },
};

const networkOf = (direction: Direction): EvmNetwork =>
  direction === "SOLANA_TO_BASE" || direction === "BASE_TO_SOLANA" ? "base" : "ethereum";
const leavesSolana = (direction: Direction): boolean =>
  direction === "SOLANA_TO_BASE" || direction === "SOLANA_TO_ETHEREUM";

/** One row of the deployment's route matrix, as the card reads it. */
type RouteNetwork = Readonly<{
  id: EvmNetwork | "robinhood-chain";
  label: string;
  state: "AVAILABLE" | "NOT_OPEN" | "UNAVAILABLE";
  reason: string | null;
}>;

type Stage =
  | "CONNECT"
  | "COMPOSE"
  | "PREPARING"
  | "REVIEW"
  | "APPROVING"
  | "SIGNING"
  | "SENDING"
  | "ATTESTING"
  | "MINTING"
  | "OBSERVING"
  | "DONE";

type SpeedTier = Readonly<{ mode: "FAST" | "STANDARD"; finalityThreshold: number; minimumFeeBps: string }>;

type ProviderView = Readonly<{
  health: string;
  fees: { state: "AVAILABLE"; observedAt: string; tiers: readonly SpeedTier[] } | { state: string };
  allowance: { state: "AVAILABLE"; allowance: { allowanceUsdc: string; allowanceRaw: string } } | { state: string };
}>;

/** Whatever the source chain produced, read through the fields both plans share. */
type PlanView = Readonly<{
  direction: Direction;
  owner: string;
  destinationRecipient: string;
  destinationOwner?: string;
  mintRecipientHex: string;
  amountRaw: string;
  protocolFeeRaw: string;
  expectedReceiveRaw: string;
  minimumFeeBps: string;
  speed: string;
  intentDigest: string;
  builtAt: string;
  sourceDomain: number;
  destinationDomain: number;
  programs?: readonly string[];
  /* Solana-source only. */
  ownerTokenAccount?: string;
  unsignedWireBase64?: string;
  balances?: { usdcRaw: string; lamports: string; lamportsAfterBurn: string };
  costs?: { baseFeeLamports: string; messageSentRentLamports: string; totalLamports: string };
  fingerprint?: { messageHash: string; signers: readonly string[] };
  /* Base-source only. */
  allowance?: { currentRaw: string; requiredRaw: string; sufficient: boolean; approveAmountRaw: string | null };
  calls?: readonly { purpose: "APPROVE" | "BURN"; to: string; data: string; gasEstimate: string | null; maximumCostWei: string | null; unpricedReason: string | null }[];
  walletPrompts?: number;
  totalMaximumCostWei?: string | null;
  gasPriceWei?: string | null;
  destinationAccountExists?: boolean;
  tokenMessenger?: string;
}>;

type PlanResponse = Readonly<{
  direction: Direction;
  plan: PlanView;
  provider: ProviderView;
  rpc: { role: string; host: string };
  simulation: { status: string; succeeded: boolean; error: string | null; unitsConsumed: string | null };
  canaryIntent: unknown;
  canaryVerdict: { decision: string };
  reviewProof: { status: string; digest: string };
  safety: { decision: string; blockedReason: string | null; findings: readonly { code: string; outcome: string; detail: string }[] };
}>;

type BalancesResponse = Readonly<{
  direction: Direction;
  source: { chain: Chain; wallet: string | null; usdcRaw: string | null; nativeRaw: string | null; allowanceRaw: string | null; reason: string | null };
  destination: { chain: Chain; wallet: string | null; tokenAccount: string | null; accountExists: boolean | null };
  limits: { minimumRaw: string | null; minimumReason: string; maximumRaw: string | null; maximumReason: string; fastAllowanceRaw: string | null };
}>;

const short = (value: string, head = 6, tail = 4) =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

function lamportsToSol(...values: (string | null | undefined)[]): string {
  const total = values.reduce((sum, value) => sum + BigInt(value ?? "0"), 0n);
  return (Number(total) / 1_000_000_000).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
}

function weiToEth(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(Number(BigInt(value)) / 1e18).toFixed(8).replace(/0+$/, "").replace(/\.$/, "") || "0"} ETH`;
}

const usdc = (raw: string | null | undefined) => (raw === null || raw === undefined ? "—" : `${displayAmount(raw, 6)} USDC`);

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { data?: T; error?: { code?: string; message?: string } };
    if (!response.ok || payload.error) {
      return {
        ok: false,
        code: payload.error?.code ?? String(response.status),
        message: payload.error?.message ?? "",
      };
    }
    return { ok: true, data: payload.data as T };
  } catch {
    return { ok: false, code: "NETWORK", message: "" };
  }
}

/**
 * The unified Swap surface (Unified Swap V1) owns the networks, the
 * asset and the amount for every class of action and hands this engine the
 * CCTP direction it resolved. Embedded, the card keeps the accepted path whole —
 * balances, Review, approvals, burn, attestation, mint, recovery, receipt — and
 * drops only what the surface already shows: the network chooser, the amount
 * field, the direction flip and the panel frame.
 */
export type BridgeCardEmbedded = Readonly<{ direction: Direction; amount: string }>;

export type BridgeCardFacts = Readonly<{
  expectedReceiveRaw: string | null;
  protocolFeeRaw: string | null;
  minimumFeeBps: string | null;
  speed: string | null;
  walletPrompts: number;
  sourceChain: Chain;
  destinationChain: Chain;
  stage: Stage;
  sourceBalanceRaw: string | null;
}>;

export function BridgeCard({ embedded, onFacts }: { embedded?: BridgeCardEmbedded; onFacts?: (facts: BridgeCardFacts) => void } = {}) {
  const { text } = useSolanaI18n();
  /* The connection failure is no longer read here: `WalletConnectRow` prints
     it beside the control that caused it, the same way on all three cards. */
  const { wallets, connection, connecting, connect } = useSolanaConnection();

  const [direction, setDirection] = useState<Direction>("SOLANA_TO_BASE");
  /* The deployment's own route matrix. Null until read, and null again if the
     read fails — the chooser then shows Base alone, which is the one network
     whose state every earlier version of this card assumed. */
  const [routes, setRoutes] = useState<readonly RouteNetwork[] | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const embeddedDirection = embedded?.direction;
  const embeddedAmount = embedded?.amount;
  useEffect(() => {
    if (embeddedDirection === undefined || embeddedAmount === undefined) return;
    setDirection((current) => (current !== embeddedDirection ? embeddedDirection : current));
    setAmount((current) => (current !== embeddedAmount ? embeddedAmount : current));
  }, [embeddedDirection, embeddedAmount]);
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [planReceivedAt, setPlanReceivedAt] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("CONNECT");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [burnSignature, setBurnSignature] = useState<string | null>(null);
  const [attestState, setAttestState] = useState<string | null>(null);
  const [attested, setAttested] = useState<{ messageHex: string; attestationHex: string; nonce: string } | null>(null);
  const [mintHash, setMintHash] = useState<string | null>(null);
  const [usdcBefore, setUsdcBefore] = useState<string | null>(null);
  const [arrived, setArrived] = useState<{ mintedRaw: string; verdict: string } | null>(null);
  const [receipt, setReceipt] = useState<unknown | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [recovered, setRecovered] = useState(false);

  /* The EVM end of the lane is a value the direction carries, never a guess
     from an address. Base or Ethereum; Solana is always the other end. */
  const network = networkOf(direction);
  const sourceChain: Chain = leavesSolana(direction) ? "solana" : network;
  const destinationChain: Chain = leavesSolana(direction) ? network : "solana";
  const chainLabel = (chain: Chain): BridgeChainLabel => (chain === "solana" ? "Solana" : chain === "base" ? "Base" : "Ethereum");
  const sourceLabel = chainLabel(sourceChain);
  const destinationLabel = chainLabel(destinationChain);
  const laneLabels = { source: sourceLabel, destination: destinationLabel } as const;
  /* Sentences that name the EVM chain exist once per chain, as literals, so
     the Ukrainian catalogue holds a real translation of each rather than a
     chain name glued into a template. */
  const onBase = network === "base";
  /* The chooser's rows, from the deployment's matrix. Before it answers, and if
     it never does, Base alone — the one network this card has always offered. */
  const networkRows: readonly RouteNetwork[] = routes ?? [{ id: "base", label: "Base", state: "AVAILABLE", reason: null }];
  const chosenRoute = networkRows.find((row) => row.id === network) ?? null;
  const chosenNetworkOpen = chosenRoute?.state === "AVAILABLE";

  /* Which wallet has to be attached before anything can be composed. It is the
     sending side's, and only the sending side's: a Base transfer needs no
     Solana connection to be planned, only an address to arrive at. */
  const sourceWallet = sourceChain === "solana" ? (connection?.address ?? null) : evmAddress;

  /* A transfer already in flight is not a connect problem. Once a burn exists
     the next action is reading the chains, not signing in again, so the stage
     the resume read established survives a missing wallet. */
  const currentStage: Stage =
    sourceWallet || burnSignature ? (stage === "CONNECT" ? "COMPOSE" : stage) : "CONNECT";

  const recipientValid =
    destinationChain === "base"
      ? /^0x[0-9a-fA-F]{40}$/.test(recipient.trim())
      : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient.trim());
  /* Parsed rather than validated: `parseHumanAmount` refuses more precision
     than USDC can hold instead of rounding it, and rounding here would move
     somebody's money by an amount they did not type. */
  const parsedAmount = amount.trim() === "" ? null : parseHumanAmount(amount, USDC_DECIMALS);
  const amountRaw = parsedAmount?.ok ? parsedAmount.raw : null;
  const amountError = parsedAmount && !parsedAmount.ok ? parsedAmount.reason : null;
  const sourceBalanceRaw = balances?.source.usdcRaw ?? null;
  const overBalance = amountRaw !== null && sourceBalanceRaw !== null && BigInt(amountRaw) > BigInt(sourceBalanceRaw);
  const composable = recipientValid && amountRaw !== null && !overBalance;

  /* On the reverse lane the money is coming to this workspace's own wallet, so
     that is the sensible default recipient — and it is still an editable field,
     because somebody may be sending to a wallet they are not signed into. */
  useEffect(() => {
    if (destinationChain !== "solana") return;
    if (recipient.trim() !== "") return;
    if (connection?.address) setRecipient(connection.address);
  }, [connection?.address, destinationChain, recipient]);

  /* What the sending side holds, and what the provider currently allows. Read
     whenever the direction or either wallet changes, so MAX and the limits are
     never a stale answer about a different chain. */
  useEffect(() => {
    if (plan) return;
    let live = true;
    void (async () => {
      const read = await postJson<BalancesResponse>("/api/solana/bridge/balances", {
        direction,
        solanaWallet: connection?.address ?? null,
        baseWallet: evmAddress,
      });
      if (live) setBalances(read.ok ? read.data : null);
    })();
    return () => {
      live = false;
    };
  }, [connection?.address, direction, evmAddress, plan]);

  /* The deployment's own answer to which networks are offered, read once. A
     read on the read budget, with nothing to send; a network a provider lists
     never appears here on its own. */
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/solana/bridge/routes", { cache: "no-store" });
        const payload = (await response.json()) as { data?: { networks?: readonly RouteNetwork[] } };
        if (live && response.ok && Array.isArray(payload.data?.networks)) setRoutes(payload.data.networks);
      } catch {
        /* Unread is not unavailable: the chooser falls back to Base alone. */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  /* Whole sentences, chosen by direction, rather than a fragment with a chain
     name glued on. Ukrainian inflects around the noun, so "To your" + "Base" +
     "address" reads there as three unrelated words — and a card that is only
     grammatical in English is a card only half this product's readers can use. */
  const steps = useMemo(
    () => [
      { key: "review", label: text("Review") },
      {
        key: "leave",
        label:
          sourceChain === "solana" ? text("Leaves Solana") : sourceChain === "base" ? text("Leaves Base") : text("Leaves Ethereum"),
      },
      { key: "sign", label: text("Circle signs") },
      {
        key: "arrive",
        label:
          destinationChain === "base"
            ? text("Arrives on Base")
            : destinationChain === "ethereum"
              ? text("Arrives on Ethereum")
              : text("Arrives on Solana"),
      },
      { key: "checked", label: text("Checked both sides") },
    ],
    [destinationChain, sourceChain, text],
  );

  const stepIndex =
    currentStage === "DONE"
      ? 4
      : currentStage === "OBSERVING" || currentStage === "MINTING"
        ? 3
        : currentStage === "ATTESTING"
          ? 2
          : currentStage === "SENDING" || currentStage === "SIGNING" || currentStage === "APPROVING"
            ? 1
            : 0;

  const connectSource = useCallback(async () => {
    if (sourceChain === "solana") {
      connect(wallets[0]?.name);
      return;
    }
    setFailure(null);
    const wallet = await connectEvmWallet();
    if (!wallet.ok) {
      setFailure(bridgeWalletFailureCopy(wallet.reason, text));
      return;
    }
    setEvmAddress(wallet.address);
  }, [connect, sourceChain, text, wallets]);

  const swapDirection = useCallback(() => {
    setDirection((current) => {
      const pair = DIRECTIONS[networkOf(current)];
      return current === pair.fromSolana ? pair.toSolana : pair.fromSolana;
    });
    /* Everything on the card describes the old lane, so none of it survives the
       swap. Keeping the amount would be harmless and keeping the recipient
       would not: an address for the chain you just turned away from is the one
       mistake this control could cause. */
    setRecipient("");
    setPlan(null);
    setBalances(null);
    setFailure(null);
    setStage("CONNECT");
  }, []);

  /**
   * Choose the EVM network, keeping which way the money goes.
   *
   * The same clearing as turning the transfer round, for the same reason: a
   * Base address typed for a transfer that now ends on Ethereum is still a
   * valid-looking `0x` string and the one mistake this control could cause.
   */
  const chooseNetwork = useCallback((next: EvmNetwork) => {
    setDirection((current) => (leavesSolana(current) ? DIRECTIONS[next].fromSolana : DIRECTIONS[next].toSolana));
    setRecipient("");
    setPlan(null);
    setBalances(null);
    setFailure(null);
    setStage("CONNECT");
  }, []);

  const prepare = useCallback(async () => {
    if (!sourceWallet || amountRaw === null) return;
    setFailure(null);
    setStage("PREPARING");
    const request =
      leavesSolana(direction)
        ? await (async () => {
            const account = await createEphemeralMessageAccount();
            (window as unknown as { __ryntraBridgeEphemeral?: unknown }).__ryntraBridgeEphemeral = account;
            return {
              direction,
              owner: sourceWallet,
              destinationRecipient: recipient.trim(),
              messageSentAccount: account.address,
              amountRaw,
              recipientConfirmed: true,
            };
          })()
        : {
            direction,
            owner: sourceWallet,
            destinationRecipient: recipient.trim(),
            amountRaw,
            recipientConfirmed: true,
          };
    const result = await postJson<PlanResponse>("/api/solana/bridge/plan", request);
    if (!result.ok) {
      setFailure(bridgePlanFailureCopy(result.code, text, destinationLabel));
      setStage("COMPOSE");
      return;
    }
    setPlan(result.data);
    setPlanReceivedAt(Date.now());
    setStage("REVIEW");
    return result.data;
  }, [amountRaw, destinationLabel, direction, recipient, sourceWallet, text]);

  /**
   * The permission, on the one lane that has one.
   *
   * Sending this moves no money — it only lets Circle's contract move exactly
   * this amount when the transfer itself is sent — so it needs no duplicate
   * boundary and is deliberately outside one. The card then waits for the chain
   * to agree rather than assuming the approval took.
   */
  const awaitAllowance = useCallback(async (): Promise<boolean> => {
    if (amountRaw === null || !evmAddress) return false;
    for (let attempt = 0; attempt < ALLOWANCE_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, ALLOWANCE_POLL_MS));
      const read = await postJson<BalancesResponse>("/api/solana/bridge/balances", {
        direction,
        solanaWallet: connection?.address ?? null,
        baseWallet: evmAddress,
      });
      const allowance = read.ok ? read.data.source.allowanceRaw : null;
      if (allowance !== null && BigInt(allowance) >= BigInt(amountRaw)) return true;
    }
    return false;
  }, [amountRaw, connection?.address, direction, evmAddress]);

  const approve = useCallback(async () => {
    if (!plan || !evmAddress) return;
    const call = plan.plan.calls?.find((entry) => entry.purpose === "APPROVE");
    if (!call) return;
    setFailure(null);
    setStage("APPROVING");
    const sent = await sendEvmTransaction({ chain: EVM_WALLET_CHAINS[network], from: evmAddress, to: call.to, data: call.data });
    if (!sent.ok) {
      setFailure(bridgeWalletFailureCopy(sent.reason, text));
      setStage("REVIEW");
      return;
    }
    /* The chain is asked whether the permission is really there, rather than
       the card assuming the wallet's answer meant it landed. The waiting is a
       separate function on purpose: nothing that repeats on a clock is allowed
       to sit in the same place as something that moves money. */
    if (await awaitAllowance()) {
      await prepare();
      return;
    }
    setFailure(
      onBase
        ? text("The permission has not appeared on Base yet. Nothing was sent — check your wallet and try the review again.")
        : text("The permission has not appeared on Ethereum yet. Nothing was sent — check your wallet and try the review again."),
    );
    setStage("REVIEW");
  }, [awaitAllowance, evmAddress, network, onBase, plan, prepare, text]);

  /** The Solana-source burn: sign in the wallet, add the one-time signature, submit once. */
  const sendFromSolana = useCallback(async () => {
    if (!plan || !connection) return;
    setFailure(null);
    setRefreshed(false);
    setStage("SIGNING");
    const account = (window as unknown as { __ryntraBridgeEphemeral?: Awaited<ReturnType<typeof createEphemeralMessageAccount>> })
      .__ryntraBridgeEphemeral;
    if (!account) {
      setFailure(text("This transfer could not be prepared. Nothing was sent."));
      setStage("COMPOSE");
      return;
    }

    const signed = await signTransaction({
      wallet: connection.wallet,
      address: connection.address,
      unsignedWireBase64: plan.plan.unsignedWireBase64 as string,
      chain: "solana:mainnet",
    });
    if (!signed.ok) {
      setFailure(bridgeWalletFailureCopy(signed.reason, text));
      setStage("REVIEW");
      return;
    }

    const completed = await addEphemeralSignature({
      plan: plan.plan as never,
      signedWireBase64: signed.signedWireBase64,
      account,
    });
    if (!completed.ok) {
      /*
       * Say which field moved, not that something did.
       *
       * This branch used to map the code through the copy table and throw the
       * comparator's own sentence away — so a refusal that knew exactly what
       * the wallet had changed rendered as "your wallet returned a different
       * transaction", twice, to a person who could do nothing with it. The
       * comparator speaks plain English; it is the one thing worth showing.
       */
      setFailure(completed.reason);
      try {
        window.localStorage.setItem(
          "ryntra.solana.bridge-last-refusal.v1",
          JSON.stringify({ code: completed.code, reason: completed.reason, at: new Date().toISOString() }),
        );
      } catch {
        /* A refusal that cannot be written down is still a refusal. */
      }
      setStage("REVIEW");
      return;
    }
    account.discard();

    setStage("SENDING");
    const bundle = {
      plan: plan.plan,
      provider: plan.provider,
      rpc: plan.rpc,
      simulation: plan.simulation,
      canaryIntent: plan.canaryIntent,
      canaryVerdict: plan.canaryVerdict,
    };
    const sent = await postJson<{ signature: string }>("/api/solana/bridge/burn", {
      bundle,
      reviewProof: plan.reviewProof,
      signedTransactionBase64: completed.signedWireBase64,
      recipientConfirmed: true,
    });
    if (!sent.ok) {
      setFailure(bridgeBurnFailureCopy(sent.code, text));
      setStage("REVIEW");
      return;
    }
    setBurnSignature(sent.data.signature);
    /* From here the money is in flight and this tab is no longer the only
       thing that knows about it — but it is the only thing holding the signed
       Review the receipt has to be bound to. */
    saveBridgeRun(window.localStorage, {
      intentDigest: plan.plan.intentDigest,
      direction,
      bundle,
      reviewProof: plan.reviewProof,
      burnSignature: sent.data.signature,
      mintTransactionHash: null,
      usdcBeforeRaw: null,
    });
    setStage("ATTESTING");
  }, [connection, direction, plan, text]);

  /**
   * The Base-source burn: arm the boundary, then open the wallet.
   *
   * The order is the opposite of Solana's and it has to be. An EVM wallet signs
   * and broadcasts in one call, so there is no moment after the person approves
   * and before the money leaves for a server to claim the transfer in. Arming
   * first means a declined wallet leaves a claim to release — which the server
   * does only when Base says the account has sent nothing — and that is the
   * safe way round.
   */
  const sendFromEvm = useCallback(async () => {
    if (!plan || !evmAddress) return;
    setFailure(null);
    setRefreshed(false);
    setStage("SIGNING");
    const bundle = {
      plan: plan.plan,
      provider: plan.provider,
      rpc: plan.rpc,
      simulation: plan.simulation,
      canaryIntent: plan.canaryIntent,
      canaryVerdict: plan.canaryVerdict,
    };
    const armed = await postJson<{ intentDigest: string; call: { to: string; data: string; from: string } }>(
      "/api/solana/bridge/base-burn",
      { phase: "ARM", bundle, reviewProof: plan.reviewProof, recipientConfirmed: true },
    );
    if (!armed.ok) {
      setFailure(bridgeBurnFailureCopy(armed.code, text));
      setStage("REVIEW");
      return;
    }

    saveBridgeRun(window.localStorage, {
      intentDigest: plan.plan.intentDigest,
      direction,
      bundle,
      reviewProof: plan.reviewProof,
      burnSignature: null,
      mintTransactionHash: null,
      usdcBeforeRaw: null,
    });

    const sent = await sendEvmTransaction({
      chain: EVM_WALLET_CHAINS[network],
      from: armed.data.call.from,
      to: armed.data.call.to,
      data: armed.data.call.data,
    });
    if (!sent.ok) {
      /* A declined wallet sent nothing, and Base can say so. The server checks
         that for itself; this only asks it to look. */
      const released = await postJson<{ released: boolean; reason?: string }>("/api/solana/bridge/base-burn", {
        phase: "ABANDON",
        intentDigest: plan.plan.intentDigest,
      });
      clearBridgeRun(window.localStorage);
      setFailure(
        released.ok && released.data.released
          ? bridgeWalletFailureCopy(sent.reason, text)
          : onBase
            ? text(
                "Your wallet did not complete this transfer, and Base shows activity on the account since it was prepared — so it is being read rather than sent again. Open Evidence and recovery below.",
              )
            : text(
                "Your wallet did not complete this transfer, and Ethereum shows activity on the account since it was prepared — so it is being read rather than sent again. Open Evidence and recovery below.",
              ),
      );
      setStage(released.ok && released.data.released ? "REVIEW" : "ATTESTING");
      return;
    }

    setBurnSignature(sent.transactionHash);
    saveBridgeRun(window.localStorage, {
      intentDigest: plan.plan.intentDigest,
      direction,
      bundle,
      reviewProof: plan.reviewProof,
      burnSignature: sent.transactionHash,
      mintTransactionHash: null,
      usdcBeforeRaw: null,
    });
    setStage("SENDING");
    const recorded = await postJson<{ confirmation: string; landedError: string | null }>(
      "/api/solana/bridge/base-burn",
      { phase: "RECORD", intentDigest: plan.plan.intentDigest, transactionHash: sent.transactionHash },
    );
    if (recorded.ok && recorded.data.landedError) {
      setFailure(
        onBase
          ? text("The transfer did not go through on Base and nothing left your wallet. You can prepare it again.")
          : text("The transfer did not go through on Ethereum and nothing left your wallet. You can prepare it again."),
      );
      setStage("REVIEW");
      return;
    }
    setStage("ATTESTING");
  }, [direction, evmAddress, network, onBase, plan, text]);

  const checkAttestation = useCallback(async () => {
    if (!plan || !burnSignature) return;
    const result = await postJson<{
      attestation: { state: string; attested: { messageHex: string; attestationHex: string; nonce: string } | null };
    }>("/api/solana/bridge/attestation", {
      intentDigest: plan.plan.intentDigest,
      burnSignature,
      expect: {
        destinationDomain: plan.plan.destinationDomain,
        mintRecipient: plan.plan.mintRecipientHex,
        amountRaw: plan.plan.amountRaw,
      },
    });
    if (!result.ok) {
      setAttestState("UNAVAILABLE");
      return;
    }
    setAttestState(result.data.attestation.state);
    if (result.data.attestation.attested) {
      setAttested(result.data.attestation.attested);
      setStage("MINTING");
    }
  }, [burnSignature, plan]);

  /** The destination step, on whichever chain the money is arriving on. */
  const receiveOnDestination = useCallback(async () => {
    if (!plan || !attested) return;
    setFailure(null);

    if (destinationChain !== "solana") {
      const wallet = await connectEvmWallet();
      if (!wallet.ok) {
        setFailure(bridgeWalletFailureCopy(wallet.reason, text));
        return;
      }
      const built = await postJson<{ plan: { state: string; to: string; data: string | null; reason: string | null; usdcBeforeRaw: string | null } }>(
        "/api/solana/bridge/mint",
        {
          intentDigest: plan.plan.intentDigest,
          from: wallet.address,
          messageHex: attested.messageHex,
          attestationHex: attested.attestationHex,
        },
      );
      if (!built.ok || !built.data.plan.data) {
        setFailure(text("The last step could not be prepared just now. Your money is safe and this can be retried."));
        return;
      }
      setUsdcBefore(built.data.plan.usdcBeforeRaw);
      if (built.data.plan.state === "ALREADY_MINTED") {
        setStage("OBSERVING");
        return;
      }
      const sent = await sendEvmTransaction({
        chain: EVM_WALLET_CHAINS[network],
        from: wallet.address,
        to: built.data.plan.to,
        data: built.data.plan.data,
      });
      if (!sent.ok) {
        setFailure(bridgeWalletFailureCopy(sent.reason, text));
        return;
      }
      setMintHash(sent.transactionHash);
      setStage("OBSERVING");
      return;
    }

    /* Solana destination. The wallet that receives is this workspace's own, and
       the transaction it signs may also create the USDC account the transfer
       lands in — one prompt either way. */
    if (!connection) {
      setFailure(text("Connect your Solana wallet to receive this transfer."));
      return;
    }
    const recipientOwner = plan.plan.destinationOwner ?? recipient.trim() ?? connection.address;
    const built = await postJson<{
      plan: {
        state: string;
        reason: string | null;
        unsignedWireBase64: string | null;
        recipientUsdcBeforeRaw: string | null;
        createsRecipientAccount: boolean;
      };
    }>("/api/solana/bridge/mint", {
      intentDigest: plan.plan.intentDigest,
      from: connection.address,
      messageHex: attested.messageHex,
      attestationHex: attested.attestationHex,
      recipientOwner,
    });
    if (!built.ok) {
      setFailure(text("The last step could not be prepared just now. Your money is safe and this can be retried."));
      return;
    }
    setUsdcBefore(built.data.plan.recipientUsdcBeforeRaw);
    if (built.data.plan.state === "ALREADY_RECEIVED") {
      setStage("OBSERVING");
      return;
    }
    if (built.data.plan.state !== "READY" || !built.data.plan.unsignedWireBase64) {
      setFailure(built.data.plan.reason ?? text("The last step is not ready yet. Your money is safe and this can be retried."));
      return;
    }
    const signed = await signTransaction({
      wallet: connection.wallet,
      address: connection.address,
      unsignedWireBase64: built.data.plan.unsignedWireBase64,
      chain: "solana:mainnet",
    });
    if (!signed.ok) {
      setFailure(bridgeWalletFailureCopy(signed.reason, text));
      return;
    }
    const submitted = await postJson<{ signature: string }>("/api/solana/bridge/receive", {
      intentDigest: plan.plan.intentDigest,
      payer: connection.address,
      recipientOwner,
      signedTransactionBase64: signed.signedWireBase64,
    });
    if (!submitted.ok) {
      setFailure(bridgeBurnFailureCopy(submitted.code, text));
      return;
    }
    setMintHash(submitted.data.signature);
    setStage("OBSERVING");
  }, [attested, connection, destinationChain, network, plan, recipient, text]);

  const checkArrival = useCallback(async () => {
    if (!plan) return;
    const destinationWallet =
      destinationChain !== "solana" ? plan.plan.destinationRecipient : (plan.plan.destinationOwner ?? recipient.trim());
    const result = await postJson<{
      observation: { state: string; facts: { mintedRaw: string } | null };
      reconciliation: { verdict: string };
    }>("/api/solana/bridge/observe", {
      intentDigest: plan.plan.intentDigest,
      recipient: destinationWallet,
      expectedReceivedRaw: plan.plan.expectedReceiveRaw,
    });
    if (!result.ok) {
      setFailure(bridgeObservationCopy("UNAVAILABLE", text, destinationLabel));
      return;
    }
    /* Every answer gets a sentence, about the chain that was actually read.
       This used to handle MINTED and return in silence for the rest, which left
       the last button doing nothing at the one moment the money has already
       left the source chain. CONSUMED_UNSEEN in particular means it arrived. */
    setFailure(
      result.data.observation.state === "MINTED"
        ? null
        : bridgeObservationCopy(result.data.observation.state, text, destinationLabel),
    );
    if (result.data.observation.state === "MINTED" && result.data.observation.facts) {
      setArrived({
        mintedRaw: result.data.observation.facts.mintedRaw,
        verdict: result.data.reconciliation.verdict,
      });
      /* The receipt is a separate statement, made from facts read at the
         moment of issuing rather than carried forward from this read. */
      const issued = await postJson<{
        receipt: unknown;
        verification: { recognised: boolean; schemaValid: boolean; integrityValid: boolean; issuer: string; binding: string };
      }>("/api/solana/bridge/receipt", {
        bundle: {
          plan: plan.plan,
          provider: plan.provider,
          rpc: plan.rpc,
          simulation: plan.simulation,
          canaryIntent: plan.canaryIntent,
          canaryVerdict: plan.canaryVerdict,
        },
        reviewProof: plan.reviewProof,
        mintTransactionHash: mintHash,
        usdcBeforeRaw: usdcBefore,
      });
      if (issued.ok) {
        setReceipt(issued.data.receipt);
        clearBridgeRun(window.localStorage);
        /* Into the same browser-local vault Send and Swap write to, so the
           Receipts page finds it and a refresh does not lose it. Storage can
           be blocked; the helper swallows that and the receipt is still
           downloadable from this card. */
        if (connection) storeSolanaReceipt(window.localStorage, connection.address, issued.data.receipt);
        const check = issued.data.verification;
        setVerified(
          check.recognised && check.schemaValid && check.integrityValid && check.issuer === "SIGNATURE_VALID",
        );
      }
      setStage("DONE");
    }
  }, [connection, destinationChain, destinationLabel, mintHash, plan, recipient, text, usdcBefore]);

  /*
   * Pick a transfer back up after a closed tab.
   *
   * The claim on the server knows where the money is; this reads it and puts
   * the card back on the same step rather than showing a blank form to
   * somebody whose money is mid-flight between two chains.
   */
  useEffect(() => {
    /* Deliberately not gated on a wallet. A reload during the fifteen to
       nineteen minutes the money spends between two chains usually drops the
       connection, and this read used to wait for it — so the card fell back to
       the connect step and the evidence panel stated, as a fact, that nothing
       had been sent. That sentence is false while a burn is in flight, and it
       is the sentence a person reads when they come back to check. The intent
       digest is in local storage and /recover needs nothing else, so the truth
       is available without asking anyone to connect anything. */
    if (plan) return;
    const saved = readBridgeRun(window.localStorage);
    if (!saved) return;
    let live = true;
    void (async () => {
      const found = await postJson<{
        claim: { direction: Direction; state: string; messageNonce: string | null; mintTransactionHash: string | null };
      }>("/api/solana/bridge/recover", { intentDigest: saved.intentDigest });
      if (!live || !found.ok) return;
      const state = found.data.claim.state;
      /* A transfer that provably never left is not a transfer to resume, and
         this is decided before anything is restored. On the reverse lane the run
         is written before the wallet opens — it has to be, because an EVM wallet
         sends the moment it signs — so a declined prompt leaves a remembered run
         whose claim the server has since released. Restoring it would put the
         card into a waiting state for money still sitting in the person's own
         wallet, which is the same false sentence the resume path exists to
         remove, said the other way round. */
      if (state === "EXPIRED_BEFORE_BURN" || state === "RESERVED" || state === "BURN_REVERTED") {
        clearBridgeRun(window.localStorage);
        return;
      }
      /* The saved bundle is what the issuer signed. `safety` is not part of
         it and is not restored: the card is past the point where a safety
         verdict decides anything, and inventing one here would be the card
         asserting a judgement no server made. */
      const bundle = saved.bundle as Omit<PlanResponse, "reviewProof" | "safety" | "direction">;
      const resumedDirection = found.data.claim.direction ?? saved.direction ?? "SOLANA_TO_BASE";
      setDirection(resumedDirection);
      setPlan({
        ...bundle,
        direction: resumedDirection,
        reviewProof: saved.reviewProof as PlanResponse["reviewProof"],
        safety: { decision: "ALLOW", blockedReason: null, findings: [] },
      });
      setBurnSignature(saved.burnSignature);
      setMintHash(saved.mintTransactionHash);
      setUsdcBefore(saved.usdcBeforeRaw);
      setStage(
        state === "RECEIPTED" || state === "MINT_OBSERVED"
          ? "OBSERVING"
          : state === "ATTESTED"
            ? "MINTING"
            : "ATTESTING",
      );
      setRecovered(true);
    })();
    return () => {
      live = false;
    };
  }, [plan]);

  /* Keep the Review on screen inside its own life.
     The person reads at their own pace; the blockhash does not wait for them.
     Rebuilding here rather than at the press is what makes the button honest:
     whatever is being read is signable, so pressing opens the wallet instead of
     replacing the page with a fresher copy of itself. The transfer is identical
     across a rebuild — same amount, same recipient, same transfer reference — so
     the banner says the review was refreshed rather than pretending nothing
     happened. */
  useEffect(() => {
    if (currentStage !== "REVIEW" || !plan || planReceivedAt === null) return;
    let live = true;
    const timer = window.setInterval(() => {
      if (!live) return;
      setNowMs(Date.now());
      if (Date.now() - planReceivedAt < REVIEW_REFRESH_MS) return;
      window.clearInterval(timer);
      void prepare().then((fresh) => {
        if (live && fresh) setRefreshed(true);
      });
    }, 1_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [currentStage, plan, planReceivedAt, prepare]);

  /** Seconds until the card replaces this Review with a freshly built one. */
  const reviewSecondsLeft =
    plan && planReceivedAt !== null ? Math.max(0, Math.ceil((planReceivedAt + REVIEW_REFRESH_MS - nowMs) / 1000)) : 0;

  /* While Circle is signing, ask on a timer instead of asking the person to.
     The effect is bound to the stage, so leaving it stops the polling, and it
     reaches exactly one read-only route. */
  useEffect(() => {
    if (currentStage !== "ATTESTING") return;
    let live = true;
    const tick = () => {
      if (live) void checkAttestation();
    };
    tick();
    const timer = window.setInterval(tick, ATTESTATION_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [checkAttestation, currentStage]);

  /** True when the reverse lane still needs Circle's permission before it can send. */
  const needsApproval =
    sourceChain !== "solana" && plan?.plan.allowance !== undefined && !plan.plan.allowance.sufficient;

  /** How many wallet prompts the next press will produce, before the first one. */
  const walletPrompts =
    sourceChain !== "solana" ? (plan?.plan.walletPrompts ?? (needsApproval ? 2 : 1)) : 1;

  /* The unified surface states the Simple facts for every class in one place;
     these are this card's own numbers, keyed by value so a parent that stores
     them does not re-render this card into calling it again unchanged. */
  const surfaceFactsKey = JSON.stringify({
    expectedReceiveRaw: plan?.plan.expectedReceiveRaw ?? null,
    protocolFeeRaw: plan?.plan.protocolFeeRaw ?? null,
    minimumFeeBps: plan?.plan.minimumFeeBps ?? null,
    speed: plan?.plan.speed ?? null,
    walletPrompts,
    sourceChain,
    destinationChain,
    stage: currentStage,
    sourceBalanceRaw,
  } satisfies BridgeCardFacts);
  useEffect(() => {
    if (!onFacts) return;
    onFacts(JSON.parse(surfaceFactsKey) as BridgeCardFacts);
  }, [surfaceFactsKey, onFacts]);

  const cta = useMemo(() => {
    switch (currentStage) {
      case "CONNECT":
        /* `connect()` returns silently when the registry is empty, because
           there is nothing to open. Left enabled, that is a button that does
           nothing and explains nothing — the founder read it as the bridge
           being broken, which is a fair reading of a dead primary control. */
        /* A network that is not open has no wallet to connect to: the button
           says so instead of opening a wallet for a transfer that cannot be
           composed. */
        if (!chosenNetworkOpen) {
          return { label: text("Not open yet"), action: () => {}, disabled: true };
        }
        return {
          label:
            sourceChain === "solana"
              ? connecting
                ? text("Opening your wallet…")
                : text("Connect wallet")
              : onBase
                ? text("Connect your Base wallet")
                : text("Connect your Ethereum wallet"),
          action: connectSource,
          disabled: sourceChain === "solana" && connecting,
        };
      case "COMPOSE":
        return {
          label: composable
            ? text("Review transfer")
            : amountRaw === null
              ? text("Enter an amount")
              : overBalance
                ? text("More than you hold")
                : destinationChain === "base"
                  ? text("Enter your Base address")
                  : destinationChain === "ethereum"
                    ? text("Enter your Ethereum address")
                    : text("Enter your Solana address"),
          action: prepare,
          disabled: !composable,
        };
      case "PREPARING":
        return { label: text("Preparing…"), action: () => {}, disabled: true };
      case "REVIEW":
        if (!plan || plan.safety.decision !== "ALLOW") {
          /* A short allowance is a REVIEW rather than a block, and the next
             action is the approval — so the button offers that instead of
             going quiet at the only moment it has something to do. */
          if (needsApproval && plan) {
            return {
              label: `${text("Allow Circle to move")} ${displayAmount(plan.plan.amountRaw, USDC_DECIMALS)} USDC`,
              action: approve,
              disabled: false,
            };
          }
          return { label: text("Not available"), action: () => {}, disabled: true };
        }
        return {
          label: `${text("Send")} ${displayAmount(plan.plan.amountRaw, USDC_DECIMALS)} USDC ${
            destinationChain === "base" ? text("to Base") : destinationChain === "ethereum" ? text("to Ethereum") : text("to Solana")
          }`,
          action: sourceChain === "solana" ? sendFromSolana : sendFromEvm,
          disabled: false,
        };
      case "APPROVING":
        return { label: text("Waiting for the permission to appear…"), action: () => {}, disabled: true };
      case "SIGNING":
        return { label: text("Waiting for your wallet…"), action: () => {}, disabled: true };
      case "SENDING":
        return { label: text("Sending…"), action: () => {}, disabled: true };
      case "ATTESTING":
        return { label: text("Waiting for Circle…"), action: checkAttestation, disabled: false };
      case "MINTING":
        return {
          label:
            destinationChain === "base"
              ? text("Receive on Base")
              : destinationChain === "ethereum"
                ? text("Receive on Ethereum")
                : text("Receive on Solana"),
          action: receiveOnDestination,
          disabled: false,
        };
      case "OBSERVING":
        return { label: text("Check both sides"), action: checkArrival, disabled: false };
      case "DONE":
        return { label: text("Finished"), action: () => {}, disabled: true };
    }
  }, [
    amountRaw,
    approve,
    checkArrival,
    checkAttestation,
    chosenNetworkOpen,
    composable,
    connectSource,
    connecting,
    currentStage,
    destinationChain,
    needsApproval,
    onBase,
    overBalance,
    plan,
    prepare,
    receiveOnDestination,
    sendFromEvm,
    sendFromSolana,
    sourceChain,
    text,
  ]);

  const blockedReason =
    plan && plan.safety.decision !== "ALLOW" && !needsApproval ? plan.safety.blockedReason : null;

  /*
   * Where the money is, said honestly at every stage.
   *
   * This line used to be two constants — "nothing has been sent yet" until the
   * very end. During the fifteen minutes between the burn and the arrival that
   * sentence is false, and a false sentence on the evidence panel is worse than
   * no panel: it is the product telling someone their money has not moved while
   * it is in flight between two chains.
   */
  const recoveryAction =
    currentStage === "DONE"
      ? "NONE_REQUIRED"
      : currentStage === "OBSERVING"
        ? "DESTINATION_SENT_READING_BOTH_CHAINS"
        : currentStage === "MINTING"
          ? "COMPLETE_THE_DESTINATION_MINT_WITH_THE_EXISTING_ATTESTATION"
          : currentStage === "ATTESTING"
            ? "ASK_CIRCLE_FOR_THE_MESSAGE_AND_ATTESTATION"
            : currentStage === "SENDING"
              ? `READ_THE_BURN_SIGNATURE_ON_${sourceChain.toUpperCase()}`
              : "CONTINUE_TO_REVIEW";

  /**
   * How many grid rows the transfer panel takes, counted from what it renders.
   *
   * `panel.css` is explicit that height comes from the grid and that an action
   * panel takes a taller span rather than hiding a critical control. Seven rows
   * was six pixels short of the plain Review at 1920 — the send button was
   * already sitting on the clip — and every conditional notice above it pushed
   * the button out of the panel entirely. That is what the founder photographed:
   * their wallet added a Lighthouse assertion notice, and the one control that
   * moves the money was cut in half by the panel beneath it.
   *
   * So the notices are counted instead of hoped over. The direction control and
   * the balance line add one row each over what Send needs, and any banner —
   * a refusal, a policy line, a resumed transfer — takes the panel to the
   * tallest span the grid offers rather than letting the button slide under it.
   */
  /* One more row than before: the network chooser sits above the two legs and
     is counted, not hoped over. The grid's tallest span is sixteen, so a Review
     takes it whether or not a banner is showing. */
  const transferRows = plan ? 16 : 8;

  /** Both tiers Circle published for this lane, Standard first so the chosen one leads. */
  const speedTiers =
    plan && plan.provider.fees.state === "AVAILABLE"
      ? [...(plan.provider.fees as { tiers: readonly SpeedTier[] }).tiers].sort((a, b) =>
          a.mode === "STANDARD" ? -1 : b.mode === "STANDARD" ? 1 : 0,
        )
      : [];

  /** What Circle will still sign early for, which is what makes Fast refusable. */
  const fastAllowanceUsdc =
    plan && plan.provider.allowance.state === "AVAILABLE"
      ? (plan.provider.allowance as { allowance: { allowanceUsdc: string } }).allowance.allowanceUsdc
      : null;

  const sourceCostLine =
    sourceChain === "solana"
      ? `${lamportsToSol(plan?.plan.costs?.baseFeeLamports)} SOL`
      : weiToEth(plan?.plan.totalMaximumCostWei ?? null);

  return (
    <>
      <Panel
        bare={Boolean(embedded)}
        id="bridge-transfer"
        title={text("Bridge")}
        w={4}
        h={transferRows}
        essential
        badge={`${sourceLabel} → ${destinationLabel}`}
        tone={currentStage === "DONE" ? "verified" : "evidence"}
      >
        <div className={styles.card}>
          <ol className={styles.progress} aria-label={text("Where this transfer is")}>
            {steps.map((step, index) => (
              <li key={step.key} data-state={index < stepIndex ? "done" : index === stepIndex ? "now" : "next"}>
                {step.label}
              </li>
            ))}
          </ol>

          {/* The EVM end of the lane, chosen by name. Every network the route
              research looked at is a row: the one that is open is a button, the
              ones that are not are named with their reason, so nobody hunts for
              Ethereum or Robinhood Chain under a different control. */}
          {embedded ? null : (
          <div className={styles.networks} role="group" aria-labelledby="bridge-network-label">
            <span className={styles.networksLabel} id="bridge-network-label">
              {text("Network")}
            </span>
            <ul className={styles.networkRow}>
              {networkRows.map((row) =>
                row.state === "AVAILABLE" && row.id !== "robinhood-chain" ? (
                  <li key={row.id}>
                    <button
                      className={styles.network}
                      type="button"
                      aria-pressed={row.id === network}
                      onClick={() => chooseNetwork(row.id as EvmNetwork)}
                      disabled={currentStage !== "COMPOSE" && currentStage !== "CONNECT"}
                    >
                      <span translate="no">{row.label}</span>
                    </button>
                  </li>
                ) : (
                  <li key={row.id}>
                    <span className={styles.networkOff} aria-disabled="true" translate="no">
                      {row.label} <small>{row.state === "NOT_OPEN" ? text("Not open yet") : text("No route")}</small>
                    </span>
                  </li>
                ),
              )}
            </ul>
            {/* One sentence per distinct reason: a paused lane closes every
                network for the same reason, and saying it twice reads as two
                problems. */}
            {[
              ...new Set(
                networkRows
                  .filter((row) => row.state !== "AVAILABLE")
                  .map((row) => bridgeNetworkReasonCopy(row.reason, text, row.id))
                  .filter((sentence): sentence is string => sentence !== null),
              ),
            ].map((sentence) => (
              <p className={styles.networksNote} key={sentence}>
                {sentence}
              </p>
            ))}
            <p className={styles.networksNote}>
              {text("USDC only. ETH and SOL would change asset on the way — that is a swap, not offered yet.")}
            </p>
          </div>
          )}

          <div className={styles.legs}>
            <div className={styles.leg}>
              <span className={styles.legLabel}>
                {sourceChain === "solana"
                  ? text("You send from Solana")
                  : sourceChain === "base"
                    ? text("You send from Base")
                    : text("You send from Ethereum")}
              </span>
              {embedded ? null : (
              <div className={styles.amountRow}>
                <input
                  className={styles.addressInput}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="decimal"
                  translate="no"
                  disabled={currentStage !== "COMPOSE" && currentStage !== "CONNECT"}
                  aria-label={text("Amount in USDC")}
                  aria-invalid={amountError !== null || overBalance ? true : undefined}
                  aria-describedby={amountError !== null || overBalance ? "bridge-amount-error" : undefined}
                />
                <button
                  className={styles.maxButton}
                  type="button"
                  onClick={() => {
                    if (sourceBalanceRaw) setAmount(displayAmount(sourceBalanceRaw, USDC_DECIMALS));
                  }}
                  disabled={
                    !sourceBalanceRaw ||
                    sourceBalanceRaw === "0" ||
                    (currentStage !== "COMPOSE" && currentStage !== "CONNECT")
                  }
                >
                  {text("MAX")}
                </button>
              </div>
              )}
              {amountError !== null ? (
                <small className={styles.fieldError} id="bridge-amount-error">
                  {amountError}
                </small>
              ) : overBalance ? (
                <small className={styles.fieldError} id="bridge-amount-error">
                  {sourceChain === "solana"
                    ? text("That is more USDC than this wallet holds on Solana.")
                    : sourceChain === "base"
                      ? text("That is more USDC than this wallet holds on Base.")
                      : text("That is more USDC than this wallet holds on Ethereum.")}
                </small>
              ) : null}
              <span className={styles.legNote} translate="no">
                {sourceBalanceRaw === null
                  ? text("Connect the sending wallet to see what you hold.")
                  : `${text("You hold")} ${usdc(sourceBalanceRaw)}`}
              </span>
            </div>

            {embedded ? null : (
            <button
              className={styles.swap}
              type="button"
              onClick={swapDirection}
              disabled={currentStage !== "COMPOSE" && currentStage !== "CONNECT"}
              aria-label={text("Change direction")}
              title={text("Change direction")}
            >
              <span aria-hidden="true">⇅</span>
              <small>{text("Change direction")}</small>
            </button>
            )}

            <div className={styles.leg}>
              <span className={styles.legLabel}>
                {destinationChain === "base"
                  ? text("To your Base address")
                  : destinationChain === "ethereum"
                    ? text("To your Ethereum address")
                    : text("To your Solana address")}
              </span>
              <input
                className={styles.addressInput}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder={
                  destinationChain === "base"
                    ? text("Base address")
                    : destinationChain === "ethereum"
                      ? text("Ethereum address")
                      : text("Solana address")
                }
                spellCheck={false}
                autoComplete="off"
                inputMode="text"
                disabled={currentStage !== "COMPOSE" && currentStage !== "CONNECT"}
                aria-invalid={recipient.length > 0 && !recipientValid ? true : undefined}
                aria-describedby={recipient.length > 0 && !recipientValid ? "bridge-recipient-error" : undefined}
              />
              {recipient.length > 0 && !recipientValid ? (
                <small className={styles.fieldError} id="bridge-recipient-error">
                  {destinationChain === "base"
                    ? text("That is not a Base address. A Solana address here would send the money nowhere.")
                    : destinationChain === "ethereum"
                      ? text("That is not an Ethereum address. A Solana address here would send the money nowhere.")
                      : sourceChain === "base"
                        ? text("That is not a Solana address. A Base address here would send the money nowhere.")
                        : text("That is not a Solana address. An Ethereum address here would send the money nowhere.")}
                </small>
              ) : null}
              {destinationChain === "solana" && balances?.destination.accountExists === false ? (
                <small className={styles.legNote}>
                  {text("This wallet has no USDC account yet. One is created in the same step that receives your transfer, and its small deposit is shown before you sign.")}
                </small>
              ) : null}
            </div>
          </div>

          {/* The provider's own current limits, read on every request rather
              than compiled in. The minimum is arithmetic — an amount at or below
              Circle's fee arrives as nothing — and the maximum is the balance. */}
          {balances && currentStage === "COMPOSE" ? (
            <p className={styles.limits}>
              {text("Smallest")} <b translate="no">{usdc(balances.limits.minimumRaw)}</b>
              {" · "}
              {text("Largest")} <b translate="no">{usdc(balances.limits.maximumRaw)}</b>
              {balances.limits.fastAllowanceRaw ? (
                <>
                  {" · "}
                  {text("Fast allowance at Circle")}{" "}
                  <b translate="no">{usdc(balances.limits.fastAllowanceRaw)}</b>
                </>
              ) : null}
            </p>
          ) : null}

          {recovered ? (
            <div className={styles.errorRow}>
              {text("This transfer was already under way when you came back. Nothing was started again — the card picked it up where it stood.")}
            </div>
          ) : null}
          {refreshed ? (
            <div className={styles.errorRow}>
              {text("A minute passed, so this review was rebuilt against the current network. The transfer is the same — check it once more and confirm.")}
            </div>
          ) : null}
          {failure ? <div className={styles.errorRow}>{failure}</div> : null}
          {/* Through `text()` like every other sentence on this card. The
              refusal is written on the server, so without this it arrives in
              English and lands in the middle of a Ukrainian page — seen in
              production on 2026-09-04. `text()` falls back to its own key, so
              a sentence with no pair still reads correctly. */}
          {blockedReason ? <div className={styles.errorRow}>{text(blockedReason)}</div> : null}

          {plan && currentStage === "REVIEW" ? (
            <section className={styles.exactReview} aria-label={text("Ready to sign")}>
              {/* A deadline nobody can see is a trap, not a safeguard. The
                  blockhash under this Review expires; saying so lets the reader
                  decide whether to check one more field or press now. */}
              <p className={styles.reviewClock} aria-live="off">
                {text("Take your time. This review refreshes itself in")}{" "}
                <b translate="no">{reviewSecondsLeft}s</b>
                {reviewSecondsLeft === 0 ? ` — ${text("rebuilding")}…` : null}
              </p>
              <div className={styles.exactReviewGrid}>
                <span>
                  {text("You send")}
                  <b translate="no">{usdc(plan.plan.amountRaw)}</b>
                </span>
                <span>
                  {text("You receive")}
                  <b translate="no">{usdc(plan.plan.expectedReceiveRaw)}</b>
                </span>
                <span>
                  {text("To")}
                  <b translate="no">{short(plan.plan.destinationOwner ?? plan.plan.destinationRecipient, 8, 6)}</b>
                </span>
                <span>
                  {text("From")}
                  <b translate="no">{short(plan.plan.owner)}</b>
                </span>
                <span>
                  {text("Transfer fee")}
                  <b translate="no">{usdc(plan.plan.protocolFeeRaw)}</b>
                </span>
                {/* Zero, and said out loud rather than left out.
                    The direct Circle CCTP lane has
                    no integrator fee mechanism at all — `depositForBurn` takes seven
                    arguments and none of them is one, and `maxFee` is Circle's own
                    charge. Ryntra could only take a cut here by adding a transfer or
                    a contract of its own, which the Owner decision forbids. A row
                    that simply disappeared would leave a person to guess, and on the
                    other two engines the same row is not zero. */}
                <span>
                  {text("Ryntra service fee")}
                  <b translate="no">0.00%</b>
                </span>
                <span>
                  {text("Network fee estimate")}
                  <b translate="no">{sourceCostLine}</b>
                </span>
                {sourceChain === "solana" ? (
                  <span>
                    {text("Refundable deposit")}
                    <b translate="no">{lamportsToSol(plan.plan.costs?.messageSentRentLamports)} SOL</b>
                  </span>
                ) : (
                  <span>
                    {text("Circle's permission")}
                    <b translate="no">{usdc(plan.plan.allowance?.currentRaw)}</b>
                  </span>
                )}
                <span>
                  {text("Wallet approvals")}
                  <b translate="no">{walletPrompts}</b>
                </span>
              </div>

              {/* Canon §25.5 asks for Standard versus Fast and every fee before
                  the Review, with the speed claim held to what Circle actually
                  does and no further — the word this file is forbidden to print
                  is the one that promise would use. */}
              <dl className={styles.speedChoice} aria-label={text("Speed and fees")}>
                {speedTiers.length > 0 ? (
                  speedTiers.map((tier) => (
                    <div key={tier.mode} data-chosen={tier.mode === (plan.plan.speed === "FAST" ? "FAST" : "STANDARD") ? "true" : "false"}>
                      <dt>
                        {tier.mode === "FAST" ? text("Fast") : text("Standard")}
                        {tier.mode === (plan.plan.speed === "FAST" ? "FAST" : "STANDARD")
                          ? ` — ${text("chosen")}`
                          : ` — ${text("not used for this transfer")}`}
                      </dt>
                      <dd>
                        <span translate="no">{tier.minimumFeeBps} bps</span>{" "}
                        {tier.mode === "FAST"
                          ? text("and Circle signs before the sending chain finalises, so it arrives sooner. It still takes minutes, and Circle can refuse it once the allowance is spent.")
                          : text("and Circle signs once the sending chain finalises.")}
                      </dd>
                    </div>
                  ))
                ) : (
                  <div data-chosen="false">
                    <dt>{text("Speed and fees")}</dt>
                    <dd>{text("Circle did not answer for its fee tiers, so only the chosen speed above is known.")}</dd>
                  </div>
                )}
                {fastAllowanceUsdc ? (
                  <div data-chosen="false">
                    <dt>{text("Fast allowance left at Circle")}</dt>
                    <dd translate="no">{fastAllowanceUsdc} USDC</dd>
                  </div>
                ) : null}
                <div data-chosen="false">
                  <dt>
                    {destinationChain === "base"
                      ? text("Cost on Base")
                      : destinationChain === "ethereum"
                        ? text("Cost on Ethereum")
                        : text("Cost on Solana")}
                  </dt>
                  <dd>
                    {destinationChain === "base"
                      ? text(
                          "Receiving is a second transaction you send on Base and pay for in ETH. Its gas is read at that step, so it is not part of the total above.",
                        )
                      : destinationChain === "ethereum"
                        ? text(
                            "Receiving is a second transaction you send on Ethereum and pay for in ETH. Its gas is read at that step, so it is not part of the total above.",
                          )
                        : text(
                            "Receiving is a second transaction you send on Solana and pay for in SOL, including a small deposit for the record that stops it being received twice. Its cost is read and shown at that step.",
                          )}
                  </dd>
                </div>
              </dl>
              <ul className={styles.reviewNotes} aria-label={text("Read before confirming")}>
                {sourceChain === "solana" ? (
                  <>
                    <li>
                      {text("Signing opens your wallet once. A second signature happens here in this tab, from a one-time key made for this transfer — it can create the message account and can never move money.")}
                    </li>
                    <li>{text("The deposit comes back to you, and not before five days.")}</li>
                  </>
                ) : (
                  <>
                    <li>
                      {needsApproval
                        ? text("This will open your wallet twice: once to let Circle move exactly this amount, and once to send it. The permission is for this amount only, never for your whole balance.")
                        : text("This will open your wallet once. Circle already has permission to move this much USDC from this wallet.")}
                    </li>
                    <li>
                      {text("Your USDC lands in the USDC account your Solana wallet owns. If it does not have one yet, it is created in the same step that receives the transfer.")}
                    </li>
                  </>
                )}
                <li>
                  {destinationChain === "base"
                    ? text("Standard speed settles when the sending chain does. Receiving on Base is a second, separate step you take yourself.")
                    : destinationChain === "ethereum"
                      ? text("Standard speed settles when the sending chain does. Receiving on Ethereum is a second, separate step you take yourself.")
                      : text("Standard speed settles when the sending chain does. Receiving on Solana is a second, separate step you take yourself.")}
                </li>
              </ul>
            </section>
          ) : null}

          {currentStage === "ATTESTING" ? (
            <div className={styles.waitRow}>
              <StatusChip family="risk" tone="caution">
                {text("On its way")}
              </StatusChip>
              <span>{bridgeAttestationCopy(attestState ?? "PENDING_INDEXING", text, laneLabels)}</span>
            </div>
          ) : null}

          {currentStage === "MINTING" ? (
            <div className={styles.waitRow}>
              <StatusChip family="risk" tone="caution">
                {text("Ready to receive")}
              </StatusChip>
              <span>
                {destinationChain === "base"
                  ? text("Your wallet will open on Base for the last step. Anyone holding this transfer's message can complete it, which is why it is not stuck if you stop here.")
                  : destinationChain === "ethereum"
                    ? text("Your wallet will open on Ethereum for the last step. Anyone holding this transfer's message can complete it, which is why it is not stuck if you stop here.")
                    : text("Your wallet will open on Solana for the last step. Anyone holding this transfer's message can complete it, which is why it is not stuck if you stop here.")}
              </span>
            </div>
          ) : null}

          {currentStage === "DONE" && arrived ? (
            <div className={styles.waitRow} data-tone="verified">
              <StatusChip family="risk" tone="verified">
                {text("Arrived")}
              </StatusChip>
              <span translate="no">{usdc(arrived.mintedRaw)}</span>
              {burnSignature && sourceChain === "solana" ? (
                <a className="rw-btn" href={explorerTxUrl("mainnet", burnSignature)} target="_blank" rel="noreferrer">
                  {text("Explorer")}
                </a>
              ) : null}
              {receipt ? (
                <>
                  <button className="rw-btn" type="button" onClick={() => downloadReceipt(receipt as never)}>
                    {text("Receipt")}
                  </button>
                  <Link className="rw-btn" href="/app/receipts">
                    {text("Open receipt")}
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          {/* Bridge was the only card that already named a failure and said
              why it could not connect. It now shares the component the other
              two adopted, so the three cannot drift apart again. On the reverse
              lane the sending wallet is an Ethereum one, which that component
              knows nothing about, so the button below is the whole control. */}
          {currentStage === "CONNECT" && sourceChain === "solana" ? (
            <WalletConnectRow hintClassName={styles.hint} errorClassName={styles.errorRow} />
          ) : null}

          {currentStage === "CONNECT" && sourceChain === "solana" && wallets.length > 1 ? null : (
            <button className={styles.cta} type="button" onClick={cta.action} disabled={cta.disabled}>
              {cta.label}
            </button>
          )}
        </div>
      </Panel>

      {/* The domain around the job, placed before the evidence disclosure so the
          eight columns beside the ticket are filled by it rather than left as
          canvas. The bridge's own recovery record keeps the last word below. */}
      {embedded ? null : <MoneyContext span={transferRows} />}

      {/* Where the money is, shown inside Swap too.

          It was `!embedded`, which was right while a transfer had a page of
          its own to be read on. The owner's instruction of 2026-09-08 removes
          that page — the cross-chain swap replaces it — and this panel is the
          one place that says which side the money is on, both hashes and how
          to pick a stalled transfer back up. Hiding it here would leave a
          person whose USDC is already burned with a stage strip and nothing
          else. The condition below still gates it on a transfer existing, so
          a fresh Swap form carries no extra panel. */}
      {plan || burnSignature ? <Panel
        id="bridge-evidence"
        title={text("Details")}
        w={12}
        /* Rows follow the state, never the other way round: before a transfer
           exists this panel holds one line, and reserving a screenful for it
           reads as a broken page rather than a quiet one. */
        h={plan ? (burnSignature ? 5 : 4) : 2}
        advanced
        scroll
        tone="muted"
        badge={text("Details")}
      >
        <div className={styles.evidenceGrid}>
          <span>
            {text("Where this transfer is")}
            <b>{bridgeRecoveryCopy(recoveryAction, text, laneLabels)}</b>
          </span>
          {plan ? (
            <>
              <span>
                {text("Direction")}
                <b translate="no">
                  {sourceLabel} → {destinationLabel}
                </b>
              </span>
              <span>
                {sourceChain === "solana" ? text("Solana wallet") : sourceChain === "base" ? text("Base wallet") : text("Ethereum wallet")}
                <b translate="no">{plan.plan.owner}</b>
              </span>
              <span>
                {destinationChain === "base"
                  ? text("Base address")
                  : destinationChain === "ethereum"
                    ? text("Ethereum address")
                    : text("Solana address")}
                <b translate="no">{plan.plan.destinationOwner ?? plan.plan.destinationRecipient}</b>
              </span>
              {destinationChain === "solana" ? (
                <span>
                  {text("Receiving USDC account")}
                  <b translate="no">{plan.plan.destinationRecipient}</b>
                </span>
              ) : null}
              <span>
                {text("Provider fee")}
                <b translate="no">{plan.plan.minimumFeeBps} bps</b>
              </span>
            </>
          ) : null}
          {burnSignature ? (
            <span>
              {sourceChain === "solana"
                ? text("Solana transaction")
                : sourceChain === "base"
                  ? text("Base transaction")
                  : text("Ethereum transaction")}
              <b translate="no">{short(burnSignature, 10, 8)}</b>
            </span>
          ) : null}
          {mintHash ? (
            <span>
              {destinationChain === "base"
                ? text("Base transaction")
                : destinationChain === "ethereum"
                  ? text("Ethereum transaction")
                  : text("Solana transaction")}
              <b translate="no">{short(mintHash, 10, 8)}</b>
            </span>
          ) : null}
          {verified !== null ? (
            <span>
              {text("Receipt checked")}
              <b>{verified ? text("Yes") : text("A difference was recorded")}</b>
            </span>
          ) : null}
          {arrived ? (
            <span>
              {text("Both sides agree")}
              <b>{arrived.verdict === "MATCHED" ? text("Yes") : text("A difference was recorded")}</b>
            </span>
          ) : null}
        </div>
      </Panel> : null}

    </>
  );
}
