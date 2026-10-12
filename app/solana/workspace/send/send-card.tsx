"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "@/app/shell/panel";
import { StatusChip } from "@/app/shell/status-chip";
import { RecipientCheck } from "@/app/solana/workspace/evidence/recipient-check";
import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SPL_TRANSFER_ACTION_REF,
  type NativeSolTransferInput,
  type SplTransferInput,
} from "@/lib/agent-control/adapters/solana-token-2022";
import { parseSolanaAddress } from "@/lib/solana/address";
import { displayAmount, parseHumanAmount } from "@/lib/solana/amounts";
import type { SolanaCanaryIntent, SolanaCanaryVerdict } from "@/lib/solana/canary-policy";
import type { SolanaPolicyVerdict, SplTransferPreflight } from "@/lib/solana/contracts";
import {
  checkEnvironmentLock,
  type SolanaEnvironmentContext,
} from "@/lib/solana/environment";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { checkReturnedBytes } from "@/lib/solana/fingerprint.client";
import { acceptLatestSolanaResult, createLatestSolanaRequestGate } from "@/lib/solana/latest-request";
import { canSubmitSendAction, type SendSafetyVerdict } from "@/lib/solana/send-safety";
import type { SendSupportVerdict } from "@/lib/solana/send-support";
import {
  preferredSendAsset,
  rememberSendAsset,
} from "@/lib/solana/send-asset-preference.client";
import { matchesSendAssetQuery } from "@/lib/solana/send-assets";
import {
  downloadReceipt,
  storeSendReceipt,
} from "@/lib/solana/send-receipt-vault.client";
import {
  blocksNewSend,
  decideResume,
  forgetPendingSend,
  readLatestPendingSend,
  readPendingSend,
  rememberPendingSend,
} from "@/lib/solana/send-pending.client";
import { assessSendReadiness } from "@/lib/solana/send-readiness";
import type { TransferPlan } from "@/lib/solana/transaction";
import type { SolanaAssetPassport } from "@/lib/solana/types";
import { signTransaction } from "@/lib/solana/wallet.client";
import { FEATURED_MINTS } from "../assets/featured.ts";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletConnectRow } from "../wallet-connect.tsx";
import { MoneyContext } from "../money/money-context.tsx";
import {
  nothingMoved,
  sendFailureCopy,
  sendOutcomeCopy,
  sendReadinessCopy,
  sendWarningCopy,
  walletFailureCopy,
} from "./send-copy.ts";

import styles from "./send.module.css";

/**
 * One transfer, on one card.
 *
 * What stood here was a desk: a compose panel beside a scrolling Review rail,
 * seven tiles printing simulation status, base fee, priority fee, policy and
 * support, two lists of raw rule identifiers, and a paragraph under the button
 * explaining what the button already said. Every one of those was written to
 * be complete, and together they made the screen unreadable — the failure the
 * Swap card was rebuilt to fix, on the surface that moves money without even a
 * price to justify the complexity.
 *
 * This is the Swap card's shape: what leaves, where it goes, one honest review
 * of the exact transaction, one button whose label is the whole message. The
 * exactness did not move — the same server safety verdict, the same issuer
 * signed Review, the same returned-bytes check, the same single submit. What
 * moved is who the screen is written for.
 */

const NETWORK = "mainnet" as const;
const NATIVE_ASSET_ID = "native:sol";

type CatalogBits = Readonly<{
  symbol: string | null;
  name: string | null;
  isVerified: boolean | null;
  isSuspicious: boolean;
  usdPrice: string | null;
}>;

type HoldingSourceAccount = Readonly<{
  address: string;
  amountRaw: string;
  state: "INITIALIZED" | "FROZEN" | "UNKNOWN";
}>;

type Holding = Readonly<{
  kind: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  /** Every unit held, across every account — what the row displays. */
  amountRaw: string;
  /** What a transfer may actually draw on. Frozen accounts are excluded. */
  spendableRaw: string;
  decimals: number;
  tokenProgram: string | null;
  canonicalAta: string | null;
  sourceAccounts: readonly HoldingSourceAccount[];
  programKind: string | null;
  extensions: readonly string[];
  name: string | null;
  symbol: string | null;
  nameAuthority: string | null;
  catalog: CatalogBits | null;
}>;

type PlanResponse = Readonly<{
  passport: SolanaAssetPassport | null;
  preflight: SplTransferPreflight;
  verdict: SolanaPolicyVerdict;
  plan: TransferPlan;
  provider: Readonly<{ role: "primary" | "fallback"; host: string }>;
  support: SendSupportVerdict;
  safety: SendSafetyVerdict;
  canaryIntent: SolanaCanaryIntent;
  canaryVerdict: SolanaCanaryVerdict;
  reviewProof: Readonly<{ status: "SIGNED" | "UNSIGNED"; reasonCode?: string }>;
}>;

type SettleResponse = Readonly<{
  state: string;
  signature: string;
  observation?: { slot: string; feeLamports: string };
  reconciliation?: { status: string };
  receipt: unknown | null;
}>;

type Failure = Readonly<{ code: string | null }>;

type Phase = "IDLE" | "READING" | "REVIEWING" | "SIGNING" | "SENDING";

/**
 * A transfer this device signed whose outcome this tab never saw.
 *
 * Rebuilt from storage on mount rather than from React state, because the
 * whole point is that React state did not survive.
 */
type Resumed = Readonly<{
  signature: string;
  state: "CHECKING" | "LANDED" | "FAILED" | "UNKNOWN";
}>;

type RecoverResponse = Readonly<{
  signature: string;
  attempt: Readonly<{ state: string; receiptHash: string | null }> | null;
  primary: Readonly<{ state: string; status: Readonly<{ seen: boolean; err: string | null; confirmationStatus: string | null }> }>;
}>;

/* The same bounds the Swap card recovers under, for the same reason: a
   signature whose blockhash is still alive is genuinely unresolved, and making
   a person press a button to hear "not yet" for the minute that lasts is the
   product refusing to wait on their behalf. */
const RESUME_DEADLINE_MS = 150_000;
const RESUME_INTERVAL_MS = 3_000;

const FEATURED = new Set(FEATURED_MINTS.map((entry) => entry.mint));

function short(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function lamportsToSol(...values: readonly (string | null | undefined)[]): string {
  const total = values.reduce((sum, value) => {
    if (value === null || value === undefined || !/^\d+$/.test(value)) return sum;
    return sum + BigInt(value);
  }, 0n);
  return (Number(total) / 1e9).toFixed(6);
}

function assetId(holding: Holding): string {
  return holding.kind === "NATIVE_SOL" ? NATIVE_ASSET_ID : (holding.mint as string);
}

function tickerOf(holding: Holding): string {
  if (holding.kind === "NATIVE_SOL") return "SOL";
  return (
    holding.catalog?.symbol ||
    holding.symbol ||
    FEATURED_MINTS.find((entry) => entry.mint === holding.mint)?.code ||
    short(holding.mint ?? "")
  );
}

function nameOf(holding: Holding): string | null {
  if (holding.kind === "NATIVE_SOL") return "Solana";
  return (
    holding.catalog?.name ||
    holding.name ||
    FEATURED_MINTS.find((entry) => entry.mint === holding.mint)?.note.split(" — ")[0] ||
    null
  );
}

function isKnown(holding: Holding): boolean {
  if (holding.kind === "NATIVE_SOL") return true;
  if (holding.mint && FEATURED.has(holding.mint)) return true;
  return holding.catalog?.isVerified === true;
}

function usdLabel(raw: string, decimals: number, usdPrice: string | null): string {
  if (!usdPrice) return "";
  const usd = (Number(raw) / 10 ** decimals) * Number(usdPrice);
  if (!Number.isFinite(usd) || usd === 0) return "";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The exact amount, ungrouped, so it can be read back into the field. */
function plainAmount(raw: string, decimals: number): string {
  return displayAmount(raw, decimals).replace(/,/g, "");
}

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Readonly<{ ok: true; data: T }> | Readonly<{ ok: false; code: string | null; signature: string | null }>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const payload = (await response.json()) as {
      data?: T;
      error?: { code: string; message: string; signature?: string | null };
    };
    if (!response.ok || !payload.data) {
      return {
        ok: false,
        code: payload.error?.code ?? `HTTP_${response.status}`,
        signature: payload.error?.signature ?? null,
      };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, code: "REQUEST_FAILED", signature: null };
  }
}

export function SendCard() {
  const { text, locale } = useSolanaI18n();
  const { wallets, connection, connecting, connect } = useSolanaConnection();

  const [holdings, setHoldings] = useState<readonly Holding[] | null>(null);
  /* Whether both token programs answered. Seen on production on 2026-09-11:
     one program read failed, the route answered `PARTIAL` with SOL and six
     Token-2022 rows, and this picker listed exactly those seven as if they
     were the wallet — with 6.78 USDC and sixty other classic-token holdings
     missing and nothing on screen saying so. A partial list must say it is
     partial, and offer the read again. */
  const [tokenRead, setTokenRead] = useState<"COMPLETE" | "PARTIAL" | "UNAVAILABLE">("COMPLETE");
  const [asset, setAsset] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [settled, setSettled] = useState<SettleResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [resumed, setResumed] = useState<Resumed | null>(null);
  /* Bumped whenever a settle finishes, so the resume path re-reads storage
     without waiting for a reconnect. A settle that failed holding a signature
     leaves exactly the state the resume path exists for, and before this it
     was reachable only by reloading the page. */
  const [resumeNonce, setResumeNonce] = useState(0);

  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const reviewRevision = useRef(0);
  const authorized = useRef<SolanaEnvironmentContext | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const sendInFlight = useRef(false);
  const holdingsRequests = useRef<ReturnType<typeof createLatestSolanaRequestGate> | null>(null);
  const signingRequests = useRef<ReturnType<typeof createLatestSolanaRequestGate> | null>(null);
  if (!holdingsRequests.current) holdingsRequests.current = createLatestSolanaRequestGate();
  if (!signingRequests.current) signingRequests.current = createLatestSolanaRequestGate();

  const busy = phase === "READING" || phase === "REVIEWING" || phase === "SIGNING" || phase === "SENDING";

  const invalidateReview = useCallback(() => {
    reviewRevision.current += 1;
    signingRequests.current?.cancel();
    authorized.current = null;
    setPlan(null);
    setFailure(null);
  }, []);

  const loadHoldings = useCallback(
    async (owner: string) => {
      const ticket = holdingsRequests.current?.begin(owner);
      if (!ticket) return;
      setPhase("READING");
      const result = await post<{ holdings: readonly Holding[]; tokenRead?: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" }>(
        "/api/solana/holdings",
        { owner, network: NETWORK },
        ticket.signal,
      );
      if (!holdingsRequests.current?.accepts(ticket, owner)) return;
      setPhase("IDLE");
      if (!result.ok) {
        setHoldings(null);
        setAsset("");
        setFailure({ code: result.code });
        return;
      }
      setHoldings(result.data.holdings);
      setTokenRead(result.data.tokenRead ?? "COMPLETE");
      const available = result.data.holdings.map(assetId);
      setAsset(
        typeof window === "undefined"
          ? ""
          : preferredSendAsset(window.sessionStorage, owner, available),
      );
      setPicking(false);
      setQuery("");
    },
    [],
  );

  useEffect(() => {
    invalidateReview();
    setSettled(null);
    if (!connection) {
      holdingsRequests.current?.cancel();
      setHoldings(null);
      setAsset("");
      return;
    }
    /* A choice belongs to one wallet. Blank the old owner's asset while the
       new owner's holdings and remembered choice are read. */
    setAsset("");
    void loadHoldings(connection.address);
    return () => holdingsRequests.current?.cancel();
  }, [connection, invalidateReview, loadHoldings]);

  /**
   * Pick up a transfer this device signed and never saw the end of.
   *
   * The record is written before `../settle` is called, so it exists for
   * exactly the window that used to be unrecoverable: signed, possibly
   * submitted, outcome unknown. Reading it is the only thing done with it —
   * nothing here re-signs, re-submits or re-plans, and the recovery route
   * itself accepts no transaction bytes.
   */
  useEffect(() => {
    if (typeof window === "undefined") {
      setResumed(null);
      return;
    }
    /*
     * Deliberately not gated on a connected wallet.
     *
     * Reloading the page drops the connection — the card comes back showing its
     * connect tiles — and reloading is precisely the event this whole mechanism
     * exists for. The first version asked what *the connected wallet* had left
     * unfinished, which is a question with no answer at the only moment it
     * matters, and a real reload after a real signature showed nothing at all.
     *
     * So: the connected wallet's record when there is one, and otherwise the
     * newest on this device. Resolving needs no owner either — the recovery
     * route is addressed by signature.
     */
    const pending = connection
      ? readPendingSend(window.localStorage, connection.address)
      : readLatestPendingSend(window.localStorage);
    if (!pending || pending.network !== NETWORK) {
      setResumed(null);
      return;
    }
    /* The wallet that signed it, which is not necessarily one connected now. */
    const owner = pending.wallet;
    let live = true;
    setResumed({ signature: pending.signature, state: "CHECKING" });
    void (async () => {
      const deadline = Date.now() + RESUME_DEADLINE_MS;
      for (;;) {
        const result = await post<RecoverResponse>("/api/solana/transfer/recover", {
          network: pending.network,
          signature: pending.signature,
        });
        if (!live) return;

        /* Every branch of this decision is tested in `send-pending.client.ts`.
           The card supplies the answer and the age and does what it is told. */
        const decision = decideResume({
          read: result.ok
            ? {
                seen: result.data.primary.status.seen,
                err: result.data.primary.status.err,
                hasAttempt: result.data.attempt !== null,
              }
            : null,
          ageMs: Date.now() - Date.parse(pending.signedAt),
        });

        setResumed(
          decision.show === null ? null : { signature: pending.signature, state: decision.show },
        );
        if (decision.forget) forgetPendingSend(window.localStorage, owner);
        if (!decision.keepPolling) return;

        if (Date.now() >= deadline) return;
        await new Promise((resolve) => window.setTimeout(resolve, RESUME_INTERVAL_MS));
        if (!live) return;
      }
    })();
    return () => {
      live = false;
    };
  }, [connection, resumeNonce]);

  const chosen = holdings?.find((holding) => assetId(holding) === asset) ?? null;
  const ticker = chosen ? tickerOf(chosen) : "";

  const rows = useMemo(() => {
    const list = holdings ?? [];
    const held = [...list].sort((left, right) => {
      if (left.kind === "NATIVE_SOL") return -1;
      if (right.kind === "NATIVE_SOL") return 1;
      const known = Number(isKnown(right)) - Number(isKnown(left));
      return known;
    });
    return held;
  }, [holdings]);

  const visible = useMemo(
    () =>
      rows.filter((holding) =>
        matchesSendAssetQuery(
          { ticker: tickerOf(holding), name: nameOf(holding), mint: holding.mint },
          query,
        ),
      ),
    [query, rows],
  );

  useEffect(() => {
    if (!picking) return;
    setActiveIndex((current) => (visible.length === 0 ? 0 : Math.min(current, visible.length - 1)));
  }, [picking, visible.length]);

  const closePicker = useCallback(() => {
    setPicking(false);
    setQuery("");
    requestAnimationFrame(() => pillRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!picking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePicker();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePicker, picking]);

  const pick = (id: string) => {
    invalidateReview();
    setAsset(id);
    if (connection && typeof window !== "undefined") {
      rememberSendAsset(window.sessionStorage, connection.address, id);
    }
    setAmount("");
    closePicker();
  };

  const fillShare = (numerator: bigint, denominator: bigint) => {
    if (!chosen) return;
    invalidateReview();
    /* Spendable, not held. Offering the aggregate would put a number in the
       field that no transaction can satisfy while an account is frozen. */
    const share = (BigInt(chosen.spendableRaw) * numerator) / denominator;
    setAmount(plainAmount(share.toString(), chosen.decimals));
  };

  const parsedRecipient = recipient.trim() === "" ? null : parseSolanaAddress(recipient, "recipient address");
  const recipientOk = parsedRecipient?.ok === true;
  const sendingToSelf = recipientOk && connection?.address === (parsedRecipient as { address: string }).address;
  const parsedAmount = !chosen || amount.trim() === "" ? null : parseHumanAmount(amount, chosen.decimals);
  const amountOk = parsedAmount?.ok === true;
  const overBalance =
    amountOk && chosen ? BigInt((parsedAmount as { raw: string }).raw) > BigInt(chosen.spendableRaw) : false;

  const currentInput = useCallback(():
    | Readonly<{ ok: true; input: SplTransferInput | NativeSolTransferInput }>
    | Readonly<{ ok: false }> => {
    if (!connection || !chosen) return { ok: false };
    const address = parseSolanaAddress(recipient, "recipient address");
    if (!address.ok) return { ok: false };
    const value = parseHumanAmount(amount, chosen.decimals);
    if (!value.ok) return { ok: false };
    return {
      ok: true,
      input:
        chosen.kind === "NATIVE_SOL"
          ? {
              schemaVersion: "1.0.0",
              actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
              network: NETWORK,
              sender: connection.address,
              recipient: address.address,
              amountRaw: value.raw,
            }
          : {
              schemaVersion: "1.0.0",
              actionRef: SPL_TRANSFER_ACTION_REF,
              network: NETWORK,
              mint: chosen.mint as string,
              sender: connection.address,
              recipient: address.address,
              amountRaw: value.raw,
            },
    };
  }, [amount, chosen, connection, recipient]);

  const environmentOf = useCallback(
    (bundle: PlanResponse): SolanaEnvironmentContext => ({
      network: NETWORK,
      wallet: bundle.plan.sender,
      provider: `${bundle.provider.role} · ${bundle.provider.host}`,
      amount: {
        raw: bundle.plan.amountRaw,
        display: `${displayAmount(bundle.plan.amountRaw, bundle.plan.decimals)} ${ticker}`,
      },
      mint: bundle.plan.mint ?? null,
      bound: { recipient: bundle.plan.recipient },
    }),
    [ticker],
  );

  const requestReview = useCallback(async () => {
    const prepared = currentInput();
    if (!prepared.ok) return;
    invalidateReview();
    setSettled(null);
    const revision = reviewRevision.current;

    setPhase("REVIEWING");
    const result = await post<PlanResponse>("/api/solana/transfer/plan", { input: prepared.input });
    if (reviewRevision.current !== revision) return;
    setPhase("IDLE");
    if (!result.ok) {
      setFailure({ code: result.code });
      return;
    }
    setPlan(result.data);
    authorized.current = environmentOf(result.data);
  }, [currentInput, environmentOf, invalidateReview]);

  const signAndSend = useCallback(async () => {
    if (sendInFlight.current || !connection) return;
    const prepared = currentInput();
    if (!prepared.ok) return;
    const authorizedContext = authorized.current;
    if (!authorizedContext) return;

    sendInFlight.current = true;
    const revision = reviewRevision.current;

    try {
      /* A recent blockhash is deliberately short-lived, so the complete Review
         is rebuilt at the moment the person starts the final action and the
         wallet confirmation authorizes one immediate submit after the lock,
         readiness and byte gates. There is no second button it can age in. */
      setPhase("REVIEWING");
      const refreshed = await post<PlanResponse>("/api/solana/transfer/plan", { input: prepared.input });
      if (reviewRevision.current !== revision) return;
      if (!refreshed.ok) {
        setPhase("IDLE");
        setFailure({ code: refreshed.code });
        return;
      }

      const fresh = refreshed.data;
      setPlan(fresh);

      /* The authorization was given over one exact world; if the wallet,
         network, amount, mint, provider or recipient is not that world any
         more, the action returns to Review instead of to a wallet. */
      const lock = checkEnvironmentLock({
        authorized: authorizedContext,
        current: environmentOf(fresh),
      });
      if (lock.verdict !== "LOCKED") {
        setPhase("IDLE");
        authorized.current = null;
        setPlan(null);
        setFailure({ code: "REVIEW_CHANGED" });
        return;
      }

      const open = canSubmitSendAction({ network: NETWORK, safety: fresh.safety });
      const readiness = assessSendReadiness({
        plan: fresh.plan,
        preflight: fresh.preflight,
        verdict: fresh.verdict,
        support: fresh.support,
        reviewProof: fresh.reviewProof,
        requireReviewProof: open,
      });
      if (!open || !readiness.ready) {
        setPhase("IDLE");
        return;
      }

      const planHash = fresh.plan.fingerprint.messageHash;
      const ticket = signingRequests.current?.begin(planHash);
      if (!ticket) return;
      setPhase("SIGNING");
      const signed = await signTransaction({
        wallet: connection.wallet,
        address: connection.address,
        unsignedWireBase64: fresh.plan.unsignedWireBase64,
        chain: `solana:${NETWORK}`,
      });
      if (!signingRequests.current?.accepts(ticket, planHash)) return;
      if (!signed.ok) {
        setPhase("IDLE");
        setFailure({ code: `WALLET:${signed.reason}` });
        return;
      }

      const checked = await acceptLatestSolanaResult({
        gate: signingRequests.current,
        ticket,
        identity: planHash,
        produce: () =>
          checkReturnedBytes({ plan: fresh.plan, signedWireBase64: signed.signedWireBase64 }),
      });
      if (!checked.accepted) return;

      let bundle = fresh;
      let check = checked.value;
      if (check.verdict === "BYTES_FEE_ADDED") {
        setPhase("SENDING");
        const adopted = await post<PlanResponse>("/api/solana/transfer/adopt", {
          plan: fresh.plan,
          preflight: fresh.preflight,
          verdict: fresh.verdict,
          provider: fresh.provider,
          canaryIntent: fresh.canaryIntent,
          canaryVerdict: fresh.canaryVerdict,
          reviewProof: fresh.reviewProof,
          signedWireBase64: signed.signedWireBase64,
        });
        if (!signingRequests.current?.accepts(ticket, planHash)) return;
        if (!adopted.ok) {
          setPhase("IDLE");
          setFailure({ code: adopted.code });
          return;
        }
        bundle = adopted.data;
        check = await checkReturnedBytes({
          plan: bundle.plan,
          signedWireBase64: signed.signedWireBase64,
        });
      }

      if (check.verdict !== "BYTES_MATCH") {
        setPhase("IDLE");
        setPlan(null);
        authorized.current = null;
        setFailure({ code: "SIGNED_BYTES_REJECTED" });
        return;
      }
      setPlan(bundle);

      /* Written before the request, not after the answer. Everything after
         this line may be lost — the tab, the connection, the process — and the
         one fact that must not be lost is that these bytes are signed. */
      if (check.signature && typeof window !== "undefined") {
        rememberPendingSend(window.localStorage, {
          wallet: connection.address,
          signature: check.signature,
          network: NETWORK,
          signedAt: new Date().toISOString(),
        });
        setResumed(null);
      }

      setPhase("SENDING");
      const result = await post<SettleResponse>("/api/solana/transfer/settle", {
        plan: bundle.plan,
        preflight: bundle.preflight,
        verdict: bundle.verdict,
        provider: bundle.provider,
        canaryIntent: bundle.canaryIntent,
        canaryVerdict: bundle.canaryVerdict,
        reviewProof: bundle.reviewProof,
        signedWireBase64: signed.signedWireBase64,
      });
      setPhase("IDLE");
      if (!result.ok) {
        if (result.signature) {
          setSettled({ state: "UNRESOLVED", signature: result.signature, receipt: null });
        }
        setPlan(null);
        authorized.current = null;
        setFailure({ code: result.code });
        /* The stored record is still there — nothing terminal happened — so the
           resume path picks it up, warns, blocks a second signature and waits
           for an answer. One mechanism for an unresolved transfer, whether it
           was lost to a reload or to a settle that did not answer. */
        setResumeNonce((value) => value + 1);
        return;
      }
      setSettled(result.data);
      setPlan(null);
      authorized.current = null;
      setFailure(null);
      /* Kept the moment it exists, so a person who closes the tab still has
         their record. This browser only — the download is the copy that
         survives clearing site data. */
      if (result.data.receipt) {
        storeSendReceipt(window.localStorage, connection.address, result.data.receipt);
      }
      /* The server established an outcome for these bytes, which is the only
         thing that closes the window this record exists to cover. */
      forgetPendingSend(window.localStorage, connection.address);
      /*
       * The money left, so the balance on screen is now wrong.
       *
       * Observed on two real mainnet transfers from two different accounts: the
       * card kept showing the pre-send balance, and kept the amount that had
       * just been sent sitting in the field beside it. Those two together are an
       * invitation to send it again — the figure looks affordable because the
       * balance it is measured against is stale. The amount is cleared for the
       * same reason; the recipient is not, because sending twice to one person
       * is ordinary and sending the same amount twice by accident is not.
       */
      setAmount("");
      void loadHoldings(connection.address);
    } finally {
      sendInFlight.current = false;
      if (reviewRevision.current === revision) setPhase("IDLE");
    }
  }, [connection, currentInput, environmentOf, loadHoldings]);

  const signingOpen = plan ? canSubmitSendAction({ network: NETWORK, safety: plan.safety }) : false;
  const readiness = plan
    ? assessSendReadiness({
        plan: plan.plan,
        preflight: plan.preflight,
        verdict: plan.verdict,
        support: plan.support,
        reviewProof: plan.reviewProof,
        requireReviewProof: signingOpen,
      })
    : null;
  const readyToSign = Boolean(plan && signingOpen && readiness?.ready);

  /* Both halves, because the decision comes from both: the capability verdict
     names what a person has to weigh, and the safety verdict is what opens or
     closes the wallet. Listing only one produced a screen seen in testing —
     a refusal above a note about something that was not the reason. */
  const warnings = useMemo(() => {
    if (!plan) return [] as readonly Readonly<{ line: string; stops: boolean }>[];
    const seen = new Set<string>();
    const lines: Readonly<{ line: string; stops: boolean }>[] = [];
    for (const finding of [...plan.safety.findings, ...plan.support.findings]) {
      if (finding.outcome === "PASS") continue;
      if (seen.has(finding.code)) continue;
      seen.add(finding.code);
      const line = sendWarningCopy(finding.code, text);
      /* A reason the transfer cannot happen and a risk a person may accept are
         not the same sentence, and printing them in one tint made a refusal
         look like advice sitting beside it. */
      if (line) lines.push({ line, stops: finding.outcome !== "REVIEW" });
    }
    if (!signingOpen && lines.length === 0) {
      lines.push({ line: text("This transfer cannot be sent."), stops: true });
    }
    return lines;
  }, [plan, signingOpen, text]);

  const blockedReason =
    plan && !readyToSign
      ? signingOpen
        ? sendReadinessCopy(readiness?.code ?? "", text)
        : null
      : null;

  const failureLine = failure
    ? failure.code === "REVIEW_CHANGED"
      ? text("Something changed since you reviewed this transfer. Review it again.")
      : failure.code?.startsWith("WALLET:")
        ? walletFailureCopy(failure.code.slice(7), text)
        : sendFailureCopy(failure.code, text)
    : null;

  /*
   * What the wallet actually said, when what it said was not "no".
   *
   * `walletFailureCopy` maps every non-cancellation to one sentence — *Your
   * wallet did not approve this transfer* — and that sentence is a dead end for
   * everybody. It cost a real session: a transfer refused on mainnet, and
   * neither the sender nor anyone reading over their shoulder could tell
   * whether the wallet was busy, on the wrong account, or simply unable to sign
   * without sending. This module already writes an exact reason for each of
   * those and then threw it away one line before the screen.
   *
   * A cancellation needs no detail — the person just cancelled, and they know.
   * Everything else does, because everything else is a thing they might fix.
   */
  const walletDetail =
    failure?.code?.startsWith("WALLET:") && !/reject|denie|cancel|declin/i.test(failure.code)
      ? failure.code.slice(7)
      : null;

  /* An earlier transfer whose outcome is still open. LANDED and FAILED are
     answers and do not hold anything back; CHECKING and UNKNOWN are the states
     where a second signature must not be built. */
  const resumeBlocks = blocksNewSend(resumed?.state ?? null);

  let ctaLabel = text("Send");
  let ctaDisabled = true;
  if (!connection) {
    /* Same rule as Swap: one wallet connects from here, several are chosen
       from the tiles above and this button is not rendered at all. */
    ctaLabel = text("Connect wallet");
    ctaDisabled = connecting;
  } else if (phase === "READING") {
    ctaLabel = text("Reading your balances…");
  } else if (phase === "REVIEWING") {
    ctaLabel = text("Preparing transfer…");
  } else if (phase === "SIGNING") {
    ctaLabel = text("Waiting for the wallet…");
  } else if (phase === "SENDING") {
    ctaLabel = text("Sending…");
  } else if (resumeBlocks) {
    /* The card was already saying *do not send it again* while leaving the
       button live, which is advice the product itself did not follow. Worse,
       a new signature replaces the stored record for this wallet, so signing
       here would have dropped the unresolved one — the card would have
       forgotten the transfer it was warning about. */
    ctaLabel = text("Waiting for an earlier transfer");
  } else if (!chosen) {
    ctaLabel = text("Choose an asset");
  } else if (recipient.trim() === "") {
    ctaLabel = text("Enter a recipient");
  } else if (!recipientOk) {
    ctaLabel = text("Check the recipient address");
  } else if (sendingToSelf) {
    ctaLabel = text("Enter a different recipient");
  } else if (amount.trim() === "" || !amountOk) {
    ctaLabel = text("Enter an amount");
  } else if (overBalance) {
    ctaLabel = `${text("Not enough")} ${ticker}`;
  } else if (plan && !readyToSign) {
    ctaLabel = text("Cannot be sent");
  } else if (readyToSign) {
    ctaLabel = text("Confirm in wallet");
    ctaDisabled = false;
  } else {
    ctaLabel = text("Review transfer");
    ctaDisabled = false;
  }

  const onCta = () => {
    if (!connection) {
      void connect(wallets[0]?.name);
      return;
    }
    /* Not only the label. A disabled button is a rendering decision, and this
       is the one action where a stale render must not be able to authorize a
       second transfer. */
    if (resumeBlocks) return;
    if (readyToSign) {
      void signAndSend();
      return;
    }
    void requestReview();
  };

  /* An independent read of the chain is what says the money moved. A receipt
     is the record of that read, and it can still be minting while the transfer
     is already final — so the chip follows the observation, not the paperwork. */
  /* The same three-way tone the settled row uses, so an older transfer and a
     current one do not describe the same outcome in two visual languages. */
  const resumedTone: "verified" | "high" | "caution" =
    resumed?.state === "LANDED" ? "verified" : resumed?.state === "FAILED" ? "high" : "caution";
  const settledTone = settled
    ? settled.observation
      ? "verified"
      : nothingMoved(settled.state)
        ? "high"
        : "caution"
    : "caution";

  const sentAmount = plan
    ? `${displayAmount(plan.plan.amountRaw, plan.plan.decimals)} ${ticker}`
    : "";
  const receivesLess =
    plan !== null && plan.preflight.estimatedReceivedRaw !== plan.plan.amountRaw;
  const accountReserve = plan?.plan.ataRentLamports ?? null;
  /* What the mint's own transfer-fee extension withholds, when it withholds
     anything. Native SOL and classic SPL have no such configuration and answer
     "0", which renders nothing. */
  const issuerFee =
    plan && plan.preflight.transferFee.feeRaw !== "0" ? plan.preflight.transferFee.feeRaw : null;

  /* The ticket is one column of the domain now, not the whole page. The panels
     beside it read the same wallet-scoped endpoints Home does. */
  const transferRows = plan ? (warnings.length >= 3 ? 7 : 6) : settled ? 6 : 5;

  return (
    <>
      <Panel
        id="send-transfer"
        title={text("Send")}
        w={4}
        /* Panel height comes from a row span, never from content, so the span
           has to follow the state the card is actually in. These three are
           measured, not guessed: `scripts/solana-send-review-audit.mjs` fails
           when the reserved body runs more than 120px past the card. */
        h={transferRows}
        essential
        badge={text("Solana mainnet")}
        tone={settled?.observation ? "verified" : "evidence"}
      >
        <div className={styles.card}>
          <div className={styles.legs}>
            <div className={styles.leg}>
              <div className={styles.legHead}>
                <span className={styles.legLabel}>{text("Send")}</span>
                {chosen ? (
                  <span className={styles.balance}>
                {/* `Available`, not `Balance`. The figure beneath this word is
                    `spendableRaw` — the balance with the network-fee reserve
                    already withheld — so a wallet holding 0.06046201 SOL read
                    `Balance 0.05996201 SOL` here and matched nothing the person
                    could see in their own wallet. The person needs the
                    *available* balance, which is exactly what this is. */}
                    <span className={styles.balanceLabel}>{text("Available")}</span>
                    <button
                      className={styles.balanceValue}
                      type="button"
                      onClick={() => fillShare(1n, 1n)}
                      disabled={busy}
                      translate="no"
                    >
                      {displayAmount(chosen.spendableRaw, chosen.decimals)} {ticker}
                    </button>
                    <span className={styles.shareGroup}>
                      <button
                        className={styles.shareButton}
                        type="button"
                        onClick={() => fillShare(1n, 4n)}
                        disabled={busy}
                      >
                        25%
                      </button>
                      <button
                        className={styles.shareButton}
                        type="button"
                        onClick={() => fillShare(1n, 2n)}
                        disabled={busy}
                      >
                        50%
                      </button>
                      <button
                        className={styles.shareButton}
                        type="button"
                        onClick={() => fillShare(3n, 4n)}
                        disabled={busy}
                      >
                        75%
                      </button>
                      <button
                        className={styles.shareButton}
                        type="button"
                        onClick={() => fillShare(1n, 1n)}
                        disabled={busy}
                      >
                        {text("MAX")}
                      </button>
                    </span>
                  </span>
                ) : null}
              </div>
              <div className={styles.legBody}>
                <input
                  className={styles.amountInput}
                  value={amount}
                  inputMode="decimal"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={text("Amount to send")}
                  placeholder="0.0"
                  disabled={busy || !chosen}
                  onChange={(event) => {
                    invalidateReview();
                    setAmount(event.target.value);
                  }}
                />
                <button
                  ref={pillRef}
                  className={styles.tokenPill}
                  type="button"
                  aria-label={
                    chosen
                      ? `${text("Asset")}: ${ticker}. ${text("Choose an asset")}`
                      : text("Choose an asset")
                  }
                  onClick={() => {
                    setQuery("");
                    setActiveIndex(Math.max(0, visible.findIndex((row) => assetId(row) === asset)));
                    setPicking(true);
                  }}
                  disabled={busy || holdings === null}
                >
                  <span className={styles.tokenGlyph} aria-hidden>
                    {chosen ? ticker.slice(0, 1) : "?"}
                  </span>
                  <span translate="no">{chosen ? ticker : text("Asset")}</span>
                  <span className={styles.tokenCaret} aria-hidden>
                    ▾
                  </span>
                </button>
              </div>
              <span className={styles.usdLine} translate="no">
                {chosen && amountOk
                  ? usdLabel(
                      (parsedAmount as { raw: string }).raw,
                      chosen.decimals,
                      chosen.catalog?.usdPrice ?? null,
                    )
                  : ""}
              </span>
            </div>

            <div className={styles.leg}>
              <div className={styles.legHead}>
                <span className={styles.legLabel}>{text("To")}</span>
              </div>
              <div className={styles.legBody}>
                <input
                  className={styles.addressInput}
                  value={recipient}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={text("Recipient address")}
                  placeholder={text("Solana address")}
                  disabled={busy}
                  onChange={(event) => {
                    invalidateReview();
                    setRecipient(event.target.value);
                  }}
                />
              </div>
              <span className={styles.usdLine} translate="no">
                {recipientOk && !sendingToSelf ? short((parsedRecipient as { address: string }).address) : ""}
              </span>
            </div>
          </div>

          {/* The recipient check: once the address is a real one and the person has stopped typing, what an external security source knows about it — one line, the details a press away, never a block. Not asked for the person's own wallet. */}
          {recipientOk && !sendingToSelf ? <RecipientCheck address={(parsedRecipient as { address: string }).address} locale={locale} /> : null}

          {/* Only the case that costs money. A recipient who is already able to
              receive the token is the ordinary case, and the absence of a setup
              cost in the Review below is how the card says so — a line stating
              that nothing is wrong is the prose people stop reading. */}
          {plan?.plan.createsRecipientAccount ? (
            <div className={styles.factRow}>
              <span>
                {text("This address has no account for this token yet — you pay a one-time setup cost.")}
              </span>
            </div>
          ) : null}

          {failureLine ? <div className={styles.errorRow}>{failureLine}</div> : null}
          {walletDetail ? (
            /* The wallet's own words, not a Ryntra code. Untranslated on
               purpose: it is the wallet speaking to its own user, and
               rewriting it would be inventing a message nobody sent. */
            <div className={styles.walletHint}>{walletDetail}</div>
          ) : null}
          {blockedReason ? <div className={styles.errorRow}>{blockedReason}</div> : null}

          {plan ? (
            <section className={styles.exactReview} aria-label={text("Ready to sign")}>
              <div className={styles.exactReviewHead}>
                <span className={styles.legLabel}>{text("Ready to sign")}</span>
              </div>
              <div className={styles.exactReviewGrid}>
                <span>
                  {text("You send")}
                  <b translate="no">{sentAmount}</b>
                </span>
                {issuerFee ? (
                  /* The net figure below answers "what arrives". This answers
                     "where the rest went", which is a different question and
                     the one a person asks when the two numbers differ. The
                     warning list says the issuer takes a fee; only this says
                     how much. */
                  <span>
                    {text("Transfer fee")}
                    <b translate="no">
                      {displayAmount(issuerFee, plan.plan.decimals)} {ticker}
                    </b>
                  </span>
                ) : null}
                {receivesLess ? (
                  <span>
                    {text("Recipient gets")}
                    <b translate="no">
                      {displayAmount(plan.preflight.estimatedReceivedRaw, plan.plan.decimals)} {ticker}
                    </b>
                  </span>
                ) : null}
                <span>
                  {text("To")}
                  <b translate="no">{short(plan.plan.recipient)}</b>
                </span>
                <span>
                  {text("From")}
                  <b translate="no">{short(plan.plan.sender)}</b>
                </span>
                <span>
                  {text("Network fee estimate")}
                  <b translate="no">
                    {lamportsToSol(plan.plan.baseFeeLamports, plan.plan.priorityFeeLamports)} SOL
                  </b>
                </span>
                {accountReserve && accountReserve !== "0" ? (
                  <span>
                    {text("Account setup")}
                    <b translate="no">{lamportsToSol(accountReserve)} SOL</b>
                  </span>
                ) : null}
              </div>
              {warnings.length > 0 ? (
                <ul className={styles.reviewWarnings} aria-label={text("Read before confirming")}>
                  {warnings.map((warning) => (
                    <li key={warning.line} data-tone={warning.stops ? "stop" : "weigh"}>
                      {warning.line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* A transfer this device signed and this tab never saw the end of.
              It appears above the outcome of the current one because it is
              older money and the more urgent question: the instruction that
              matters is never to send it again, and before this existed a
              reload was enough to lose it. */}
          {resumed ? (
            <div className={styles.riskRow} data-tone={resumedTone}>
              <StatusChip family="risk" tone={resumedTone}>
                {resumed.state === "LANDED"
                  ? text("Sent")
                  : resumed.state === "FAILED"
                    ? text("Not sent")
                    : text("Not confirmed")}
              </StatusChip>
              <span>
                {resumed.state === "CHECKING"
                  ? text("Checking an earlier transfer…")
                  : resumed.state === "FAILED"
                    ? sendOutcomeCopy("LANDED_FAILED", text)
                    : resumed.state === "UNKNOWN"
                      ? text("An earlier transfer is still being confirmed. Do not send it again.")
                      : null}
              </span>
              <span translate="no">{short(resumed.signature)}</span>
              <a
                className="rw-btn"
                href={explorerTxUrl(NETWORK, resumed.signature)}
                target="_blank"
                rel="noreferrer"
              >
                {text("Explorer")}
              </a>
            </div>
          ) : null}

          {/* A transfer that landed says so. Whether the ledger reconciled every
              expectation is the receipt's word; the person's question is
              whether their money moved, and an independent read of the chain is
              what answers it. */}
          {settled ? (
            <div className={styles.riskRow} data-tone={settledTone}>
              <StatusChip family="risk" tone={settledTone}>
                {settled.observation
                  ? text("Sent")
                  : nothingMoved(settled.state)
                    ? text("Not sent")
                    : text("Not confirmed")}
              </StatusChip>
              {settled.observation ? null : <span>{sendOutcomeCopy(settled.state, text)}</span>}
              <span translate="no">{short(settled.signature)}</span>
              <a
                className="rw-btn"
                href={explorerTxUrl(NETWORK, settled.signature)}
                target="_blank"
                rel="noreferrer"
              >
                {text("Explorer")}
              </a>
              {settled.receipt ? (
                <>
                  <button
                    className="rw-btn"
                    type="button"
                    onClick={() => downloadReceipt(settled.receipt)}
                  >
                    {text("Receipt")}
                  </button>
                  <Link className="rw-btn" href="/app/receipts">
                    {text("Open receipt")}
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          {/* Same component, same behaviour, as Swap and Bridge. */}
          <WalletConnectRow hintClassName={styles.walletHint} errorClassName={styles.errorRow} />

          {!connection && wallets.length > 1 ? null : (
            <button className={styles.cta} type="button" onClick={onCta} disabled={ctaDisabled}>
              {ctaLabel}
            </button>
          )}
        </div>
      </Panel>

      <MoneyContext span={transferRows} holdings={holdings} />

      {picking && connection ? (
        <div
          className={styles.pickerBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePicker();
          }}
        >
          <div className={styles.picker} role="dialog" aria-modal="true" aria-label={text("Choose an asset")}>
            <div className={styles.pickerHead}>
              <span>{text("Your assets")}</span>
              <button className={styles.pickerClose} type="button" onClick={closePicker}>
                {text("Close")}
              </button>
            </div>
            {tokenRead !== "COMPLETE" && connection ? (
              <p className={styles.pickerPartial} role="status">
                {text("Some balances could not be read, so this list may be incomplete.")}{" "}
                <button type="button" className={styles.pickerRetry} onClick={() => void loadHoldings(connection.address)}>
                  {text("Read again")}
                </button>
              </p>
            ) : null}
            <input
              className={styles.pickerSearch}
              value={query}
              autoFocus
              spellCheck={false}
              aria-label={text("Search by name, ticker or mint address")}
              placeholder={text("Search by name, ticker or mint address")}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) => (visible.length === 0 ? 0 : (current + 1) % visible.length));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    visible.length === 0 ? 0 : (current - 1 + visible.length) % visible.length,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const holding = visible[activeIndex];
                  if (holding) pick(assetId(holding));
                }
              }}
            />
            <ul className={styles.pickerList}>
              {visible.map((holding, index) => {
                const id = assetId(holding);
                const code = tickerOf(holding);
                const label = nameOf(holding);
                return (
                  <li key={id}>
                    <button
                      className={styles.pickerItem}
                      type="button"
                      data-selected={id === asset ? "true" : "false"}
                      data-active={index === activeIndex ? "true" : "false"}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => pick(id)}
                    >
                      <span className={styles.tokenGlyph} aria-hidden>
                        {code.slice(0, 1)}
                      </span>
                      <span className={styles.pickerMeta}>
                        <span className={styles.pickerCode} translate="no">
                          {code}
                        </span>
                        {label && label !== code ? (
                          <span className={styles.pickerNote} translate="no">
                            {label}
                          </span>
                        ) : null}
                      </span>
                      <span className={styles.pickerBalance} translate="no">
                        {displayAmount(holding.spendableRaw, holding.decimals)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {visible.length === 0 ? (
              <p className={styles.pickerEmpty}>{text("No asset in your wallet matched that search.")}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
