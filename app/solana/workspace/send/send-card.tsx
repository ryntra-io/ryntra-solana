"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NAV_WORDS } from "@ryntra/core/nav";
import { Button } from "@ryntra/core/ui";

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
  openingSendAsset,
  preferredSendAsset,
  rememberSendAsset,
  SEND_OPENING_USDC,
} from "@/lib/solana/send-asset-preference.client";
import { matchesSendAssetQuery } from "@/lib/solana/send-assets";
import { isNewRecipient, recentSendRecipients, rememberSendRecipient } from "@/lib/solana/send-recipients.client";
import { addressGroups, lookalikeOf, skrNameOf } from "@/lib/solana/skr-name";
import { resolveSkrName, type SkrResolve } from "@/lib/solana/skr.client";
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
import { ConnectWalletButton } from "../wallet-gate.tsx";
import { useWalletReach } from "../wallet-reach.ts";
import { useSkrName } from "../skr-name.tsx";
import { AssetMark } from "../money/marks.tsx";
import { MoneyAction, MoneyCard, MoneyPage } from "../money/money-page.tsx";
import { RecentTransfers } from "../money/recent-transfers.tsx";
import { formatUsdMoney } from "../spot/spot-format.ts";
import { localFigure } from "../money/figures.ts";
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
  /** The catalogue's icon address, for a token the site carries no picture of. */
  icon?: string | null;
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

/** A `.skr` name typed in «Кому», and what the server said it points to now — or that it is still asking (SKR-4). */
type Named = SkrResolve | Readonly<{ state: "RESOLVING"; name: string }>;

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

/** The amount in dollars under the field, in the page's own number language — «≈ $120,50» in Ukrainian (B18). */
function usdLabel(raw: string, decimals: number, usdPrice: string | null, locale: string): string {
  if (!usdPrice) return "";
  const usd = (Number(raw) / 10 ** decimals) * Number(usdPrice);
  if (!Number.isFinite(usd) || usd === 0) return "";
  if (usd < 0.01) return `≈ < ${formatUsdMoney(0.01, locale)}`;
  return `≈ ${formatUsdMoney(usd, locale)}`;
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

/** A recent recipient's chip: its primary `.skr` name when it chose one, else the shortened address; the whole address on hover. */
function RecentChip({ address, onPick, disabled }: { address: string; onPick: (value: string) => void; disabled: boolean }) {
  const name = useSkrName(address);
  return (
    <button className={styles.recent} type="button" onClick={() => onPick(address)} disabled={disabled} translate="no" title={address}>
      {name ?? short(address)}
    </button>
  );
}

export function SendCard() {
  const { text, locale } = useSolanaI18n();
  const { connection, connecting } = useSolanaConnection();
  const { reach } = useWalletReach();

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
  /* The name's address, shown and never kept: «Надіслати» reads it again right before the wallet opens (SKR-4). */
  const [named, setNamed] = useState<Named | null>(null);
  /* A look-alike of a known address the person said is the one they meant — for that exact address only (SEC-2). */
  const [lookalikeAccepted, setLookalikeAccepted] = useState<string | null>(null);
  /* An address nothing was sent to yet, checked against whoever gave it — for that exact address only (SEC-2). */
  const [newAddressAccepted, setNewAddressAccepted] = useState<string | null>(null);
  /* A pasted address's primary name, checked forward when the Review was built — Review names it only then (SKR-4). */
  const [reviewChecked, setReviewChecked] = useState<Readonly<{ address: string; name: string }> | null>(null);

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
  /* The addresses this wallet sent to from this browser — chips under «Кому» (B18). */
  const [recents, setRecents] = useState<readonly string[]>([]);
  /* Whether that list has been looked at yet. Before the read, an empty list is an unknown, not an answer, and SEC-2's
     «nothing was sent to this address yet» would be said of an address this browser has paid before. */
  const [recentsRead, setRecentsRead] = useState(false);
  /* «Вставити» only where the browser lets a page read the clipboard; decided after the first paint. */
  const [canPaste, setCanPaste] = useState(false);
  useEffect(() => {
    setCanPaste(typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function");
  }, []);
  useEffect(() => {
    const read = connection && typeof window !== "undefined";
    setRecents(read ? recentSendRecipients(window.localStorage, connection.address) : []);
    /* Storage a browser refuses reads as empty — that is a looked-at list, and every address in it is then first. */
    setRecentsRead(Boolean(read));
  }, [connection]);

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
      /* The coin last sent while it is still held, else USDC, else SOL (B18: «USDC одразу, без «? Актив»»). */
      setAsset(
        typeof window === "undefined"
          ? ""
          : openingSendAsset(preferredSendAsset(window.sessionStorage, owner, available), available),
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

  /* «Кому» takes an address or a `.skr` name (SKR-4). A name counts only once the server answered where it points now. */
  const recipientName = skrNameOf(recipient);
  /* An answer about another name is no answer: while the new one is read, the line says so. */
  const nameRead: Named | null = recipientName ? (named && named.name === recipientName ? named : { state: "RESOLVING", name: recipientName }) : null;
  const parsedRecipient = recipient.trim() === "" || recipientName ? null : parseSolanaAddress(recipient, "recipient address");
  const recipientAddress: string | null = recipientName
    ? nameRead?.state === "FOUND"
      ? nameRead.address
      : null
    : parsedRecipient?.ok === true
      ? (parsedRecipient as { address: string }).address
      : null;
  const recipientOk = recipientAddress !== null;
  const sendingToSelf = recipientOk && connection?.address === recipientAddress;
  /* A pasted address that has a primary name shows it — only the one that wallet chose, never a name it was sent. */
  const typedName = useSkrName(recipientName ? null : recipientAddress);
  /* An address that copies a known one's first and last four characters (SEC-2): the recent recipients and the wallet itself. */
  const knownAddresses = useMemo(() => (connection ? [...recents, connection.address] : recents), [connection, recents]);
  const lookalike = recipientAddress && !sendingToSelf ? lookalikeOf(knownAddresses, recipientAddress) : null;
  const lookalikeHolds = lookalike !== null && lookalikeAccepted !== recipientAddress;
  /* The first transfer to this address from this browser (SEC-2) — its own check, asked and answered beside the
     look-alike one, never instead of it: a planted address is both a look-alike of a recent one and new, and the two
     say different things. An address only the chips remember is not new. */
  const newAddress = recipientAddress !== null && !sendingToSelf && recentsRead && isNewRecipient(recents, recipientAddress);
  const newAddressHolds = newAddress && newAddressAccepted !== recipientAddress;

  useEffect(() => {
    if (!recipientName) {
      setNamed(null);
      return;
    }
    const controller = new AbortController();
    setNamed({ state: "RESOLVING", name: recipientName });
    /* The person has stopped typing: one read per settled name. */
    const timer = globalThis.setTimeout(() => {
      resolveSkrName(recipientName, { signal: controller.signal }).then(
        (read) => {
          if (!controller.signal.aborted) setNamed(read);
        },
        () => undefined,
      );
    }, 350);
    return () => {
      controller.abort();
      globalThis.clearTimeout(timer);
    };
  }, [recipientName]);
  const parsedAmount = !chosen || amount.trim() === "" ? null : parseHumanAmount(amount, chosen.decimals);
  const amountOk = parsedAmount?.ok === true;
  const overBalance =
    amountOk && chosen ? BigInt((parsedAmount as { raw: string }).raw) > BigInt(chosen.spendableRaw) : false;

  const currentInput = useCallback(():
    | Readonly<{ ok: true; input: SplTransferInput | NativeSolTransferInput }>
    | Readonly<{ ok: false }> => {
    if (!connection || !chosen || !recipientAddress) return { ok: false };
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
              recipient: recipientAddress,
              amountRaw: value.raw,
            }
          : {
              schemaVersion: "1.0.0",
              actionRef: SPL_TRANSFER_ACTION_REF,
              network: NETWORK,
              mint: chosen.mint as string,
              sender: connection.address,
              recipient: recipientAddress,
              amountRaw: value.raw,
            },
    };
  }, [amount, chosen, connection, recipientAddress]);

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

  /**
   * A `.skr` name read again, never taken from the copy on screen (SKR-4): before the Review is built, before the wallet
   * opens and once more before the signed bytes leave. `null` when it still points where the transaction pays; else the
   * failure code — and the screen learns the new answer.
   */
  const recheckName = useCallback(async (name: string, expected: string): Promise<"SKR_CHANGED" | "SKR_GONE" | "SKR_UNREAD" | null> => {
    const again = await resolveSkrName(name);
    if (again.state !== "UNAVAILABLE") setNamed(again);
    if (again.state === "NOT_FOUND") return "SKR_GONE";
    if (again.state === "UNAVAILABLE") return "SKR_UNREAD";
    return again.address === expected ? null : "SKR_CHANGED";
  }, []);

  const requestReview = useCallback(async () => {
    const prepared = currentInput();
    if (!prepared.ok) return;
    invalidateReview();
    setSettled(null);
    setReviewChecked(null);
    const revision = reviewRevision.current;

    setPhase("REVIEWING");
    if (recipientName) {
      const moved = await recheckName(recipientName, prepared.input.recipient);
      if (reviewRevision.current !== revision) return;
      if (moved) {
        setPhase("IDLE");
        /* Nothing is being signed yet: an unread name here is only «could not be checked right now». */
        setFailure({ code: moved === "SKR_UNREAD" ? "SKR_UNCHECKED" : moved });
        return;
      }
    } else if (typedName) {
      /* The pasted address's name is shown in Review only if, read forward now, it is still this address's. */
      const forward = await resolveSkrName(typedName).catch(() => null);
      if (reviewRevision.current !== revision) return;
      if (forward?.state === "FOUND" && forward.address === prepared.input.recipient) setReviewChecked({ address: forward.address, name: forward.name });
    }
    const result = await post<PlanResponse>("/api/solana/transfer/plan", { input: prepared.input });
    if (reviewRevision.current !== revision) return;
    setPhase("IDLE");
    if (!result.ok) {
      setFailure({ code: result.code });
      return;
    }
    setPlan(result.data);
    authorized.current = environmentOf(result.data);
  }, [currentInput, environmentOf, invalidateReview, recheckName, recipientName, typedName]);

  const signAndSend = useCallback(async () => {
    if (sendInFlight.current || !connection) return;
    const prepared = currentInput();
    if (!prepared.ok) return;
    const authorizedContext = authorized.current;
    if (!authorizedContext) return;

    sendInFlight.current = true;
    const revision = reviewRevision.current;

    try {
      /* A `.skr` name is read again right before the wallet opens, never taken from the Review's copy (SKR-4): a name
         can change hands between the two, and the money goes to whoever owns it now. */
      if (recipientName) {
        setPhase("REVIEWING");
        const moved = await recheckName(recipientName, prepared.input.recipient);
        if (reviewRevision.current !== revision) return;
        if (moved) {
          setPhase("IDLE");
          authorized.current = null;
          setPlan(null);
          setFailure({ code: moved });
          return;
        }
      }

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

      /* The wallet may have stayed open for minutes: the name is read once more before the signed bytes leave. A
         signature over a name that moved is dropped here — it was never sent, and nothing records it. */
      if (recipientName) {
        setPhase("SENDING");
        const moved = await recheckName(recipientName, bundle.plan.recipient);
        if (!signingRequests.current?.accepts(ticket, planHash)) return;
        if (moved) {
          setPhase("IDLE");
          authorized.current = null;
          setPlan(null);
          setFailure({ code: moved });
          return;
        }
      }

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
      /* The chain was read back: this address really got the money, so it becomes a chip under «Кому» (B18). */
      if (result.data.observation && typeof window !== "undefined") {
        setRecents(rememberSendRecipient(window.localStorage, connection.address, bundle.plan.recipient));
      }
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
  }, [connection, currentInput, environmentOf, loadHoldings, recheckName, recipientName]);

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
     closes the wallet. Listing only one produced the screen the founder hit —
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
    /* A guest sees `ConnectWalletButton` in this button's place (B14). */
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
  } else if (nameRead?.state === "RESOLVING") {
    ctaLabel = text("Finding the name…");
  } else if (recipientName && !recipientOk) {
    ctaLabel = text("Check the name");
  } else if (!recipientOk) {
    ctaLabel = text("Check the recipient address");
  } else if (sendingToSelf) {
    ctaLabel = text("Enter a different recipient");
  } else if (lookalikeHolds) {
    ctaLabel = text("Check the whole address");
  } else if (newAddressHolds) {
    ctaLabel = text("Check the new address");
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
      reach();
      return;
    }
    /* Not only the label. A disabled button is a rendering decision, and this
       is the one action where a stale render must not be able to authorize a
       second transfer. */
    if (resumeBlocks || lookalikeHolds || newAddressHolds) return;
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

  const lang = locale === "uk" ? "uk" : "en";
  const reviewName = plan
    ? recipientName
      ? nameRead?.state === "FOUND" && nameRead.address === plan.plan.recipient
        ? nameRead.name
        : null
      : reviewChecked?.address === plan.plan.recipient && reviewChecked.name === typedName
        ? reviewChecked.name
        : null
    : null;
  const pillTicker = chosen ? ticker : connection ? "" : "USDC";
  const pillMint = chosen ? chosen.mint ?? "So11111111111111111111111111111111111111112" : SEND_OPENING_USDC;

  const fillRecipient = (value: string) => {
    invalidateReview();
    setRecipient(value);
  };

  const paste = async () => {
    try {
      const value = (await navigator.clipboard.readText()).trim();
      if (value) fillRecipient(value);
    } catch {
      /* The browser refused the clipboard; the field is still there to paste into by hand. */
    }
  };

  const form = (
    <MoneyCard>
      <div className={styles.legs}>
        <div className={styles.leg}>
          <div className={styles.legHead}>
            <label className={styles.legLabel} htmlFor="send-amount">{text("Amount")}</label>
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
                  {localFigure(displayAmount(chosen.spendableRaw, chosen.decimals), locale)} {ticker}
                </button>
              </span>
            ) : null}
          </div>
          <div className={styles.legBody}>
            <input
              id="send-amount"
              className={styles.amountInput}
              value={amount}
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              placeholder="0"
              /* A guest may type the amount already (B18); a wallet whose balances are still being read may not. */
              disabled={busy || (Boolean(connection) && !chosen)}
              onChange={(event) => {
                invalidateReview();
                /* A Ukrainian comma is a decimal point here, as in «Між мережами». */
                setAmount(event.target.value.replace(",", "."));
              }}
            />
            <button
              ref={pillRef}
              className={styles.tokenPill}
              type="button"
              aria-label={pillTicker ? `${text("Asset")}: ${pillTicker}. ${text("Choose an asset")}` : text("Choose an asset")}
              onClick={() => {
                setQuery("");
                setActiveIndex(Math.max(0, visible.findIndex((row) => assetId(row) === asset)));
                setPicking(true);
              }}
              disabled={busy || holdings === null}
            >
              {pillTicker ? <AssetMark symbol={pillTicker} mint={pillMint} icon={chosen?.catalog?.icon ?? null} size={24} /> : null}
              <span translate="no">{pillTicker || text("Choose an asset")}</span>
              <span className={styles.tokenCaret} aria-hidden>
                ▾
              </span>
            </button>
          </div>
          {/* Under the amount: what it is worth, and the shares of what is available — one line, so the amount stays in
              the top third of a phone's screen (B18). */}
          <div className={styles.amountFoot}>
            <span className={styles.usdLine} translate="no">
              {chosen && amountOk
                ? usdLabel((parsedAmount as { raw: string }).raw, chosen.decimals, chosen.catalog?.usdPrice ?? null, locale === "uk" ? "uk-UA" : "en-US")
                : ""}
            </span>
            {chosen ? (
              <span className={styles.shareGroup} role="group" aria-label={text("Use part of the balance")}>
                <button className={styles.shareButton} type="button" onClick={() => fillShare(1n, 4n)} disabled={busy}>
                  25%
                </button>
                <button className={styles.shareButton} type="button" onClick={() => fillShare(1n, 2n)} disabled={busy}>
                  50%
                </button>
                <button className={styles.shareButton} type="button" onClick={() => fillShare(3n, 4n)} disabled={busy}>
                  75%
                </button>
                <button className={styles.shareButton} type="button" onClick={() => fillShare(1n, 1n)} disabled={busy}>
                  {text("MAX")}
                </button>
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.leg}>
          <div className={styles.legHead}>
            <label className={styles.legLabel} htmlFor="send-recipient">{text("To")}</label>
          </div>
          <div className={styles.legBody}>
            <input
              id="send-recipient"
              className={styles.addressInput}
              value={recipient}
              spellCheck={false}
              autoComplete="off"
              placeholder={text("Solana address or .skr name")}
              disabled={busy}
              onChange={(event) => fillRecipient(event.target.value)}
            />
            {canPaste && recipient.trim() === "" ? (
              <button className={styles.pasteButton} type="button" onClick={() => void paste()} disabled={busy}>
                {text("Paste")}
              </button>
            ) : null}
          </div>
          {recents.length > 0 && recipient.trim() === "" ? (
            <div className={styles.recents} role="group" aria-label={text("Recent recipients")}>
              {recents.slice(0, 3).map((address) => (
                <RecentChip key={address} address={address} onPick={fillRecipient} disabled={busy} />
              ))}
            </div>
          ) : null}
          {/* What a name points to now, or why it points nowhere; a pasted address's own primary name (SKR-4). */}
          {recipientName ? (
            <p className={styles.nameLine} data-state={nameRead?.state ?? "RESOLVING"} aria-live="polite">
              {nameRead?.state === "FOUND" ? (
                <span translate="no" title={nameRead.address}>→ {short(nameRead.address)}</span>
              ) : nameRead?.state === "NOT_FOUND" ? (
                text("No such .skr name")
              ) : nameRead?.state === "UNAVAILABLE" ? (
                text("The name could not be checked right now.")
              ) : (
                text("Finding the name…")
              )}
            </p>
          ) : typedName ? (
            <p className={styles.nameLine} data-state="FOUND" translate="no">
              {typedName}
            </p>
          ) : null}
        </div>
      </div>

      {/* The recipient check: once the address is a real one and the person has stopped typing, what an external security source knows about it — one line, the details a press away, never a block. Not asked for the person's own wallet. */}
      {recipientOk && !sendingToSelf ? <RecipientCheck address={recipientAddress} locale={locale} /> : null}

      {/* SEC-2: an address that copies a known one's edges — the poisoning trick — holds the action until the person says it is the one they meant. */}
      {lookalike && recipientAddress ? (
        <div className={styles.lookalike} role="alert" data-held={lookalikeHolds ? "true" : undefined}>
          <span>
            {lookalike === connection?.address
              ? text("Looks like your own address, but it is another. Check the whole address.")
              : text("Looks like a recent address, but it is another. Check the whole address.")}
          </span>
          <code className={styles.fullAddress} translate="no">{addressGroups(recipientAddress).join(" ")}</code>
          {lookalikeHolds ? (
            <button className={styles.lookalikeAccept} type="button" onClick={() => setLookalikeAccepted(recipientAddress)} disabled={busy}>
              {text("It is the right address")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* SEC-2: the first transfer to this address from this browser — its own block, so a planted address that is both
          a look-alike and new is answered twice, and each answer is about the thing it names. */}
      {newAddress && recipientAddress ? (
        <div className={styles.newAddress} role="alert" data-held={newAddressHolds ? "true" : undefined}>
          <span>{text("Nothing was sent to this address yet. Match its first and last characters with whoever gave it.")}</span>
          {/* The look-alike block above prints the same address; one copy of it is what the eye checks. */}
          {lookalike ? null : (
            <code className={styles.fullAddress} translate="no">{addressGroups(recipientAddress).join(" ")}</code>
          )}
          {newAddressHolds ? (
            <button className={styles.lookalikeAccept} type="button" onClick={() => setNewAddressAccepted(recipientAddress)} disabled={busy}>
              {text("Address checked")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Only the case that costs money. A recipient who is already able to
          receive the token is the ordinary case, and the absence of a setup
          cost in the Review below is how the card says so — a line stating
          that nothing is wrong is the prose people stop reading. */}
      {plan?.plan.createsRecipientAccount ? (
        <div className={styles.factRow}>
          <span>{text("This address has no account for this token yet — you pay a one-time setup cost.")}</span>
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
            <span className={styles.reviewTitle}>{text("Ready to sign")}</span>
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
            {/* Review always shows the whole address the transaction pays, and the name beside it only when it is that address's (SKR-4). */}
            <span className={styles.reviewTo}>
              {text("To")}
              {reviewName ? <b translate="no">{reviewName}</b> : null}
              <code className={styles.fullAddress} translate="no">{addressGroups(plan.plan.recipient).join(" ")}</code>
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
          {/* SEC-2: the one standing fact of every Review — the wallet signs, and nothing here can sign for it. Not a
              warning: it is true of every transfer, and it reads where the signature is about to be given. */}
          <p className={styles.reviewKeys}>{text("Ryntra never sees your keys.")}</p>
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
          <a className="rw-btn" href={explorerTxUrl(NETWORK, resumed.signature)} target="_blank" rel="noreferrer">
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
          <a className="rw-btn" href={explorerTxUrl(NETWORK, settled.signature)} target="_blank" rel="noreferrer">
            {text("Explorer")}
          </a>
          {settled.receipt ? (
            <>
              <button className="rw-btn" type="button" onClick={() => downloadReceipt(settled.receipt)}>
                {text("Receipt")}
              </button>
              <Link className="rw-btn" href="/app/receipts">
                {text("Open receipt")}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      {/* The form's one action: in the card on a desk, pinned above the bottom bar on a phone (B18). A guest's is the
          same on every page (B14): it opens the header's wallet panel. */}
      <MoneyAction>
        {!connection ? (
          <ConnectWalletButton block />
        ) : (
          <Button variant="primary" block onClick={onCta} disabled={ctaDisabled} lang={lang}>
            {ctaLabel}
          </Button>
        )}
      </MoneyAction>
    </MoneyCard>
  );

  return (
    <>
      <MoneyPage
        id="send"
        title={NAV_WORDS[lang].items.send}
        help={text("One transfer on Solana: what leaves, where it goes and the network fee — all of it before your wallet signs.")}
        lang={lang}
        form={form}
        aside={<RecentTransfers kind="transfers" title={text("Recent transfers")} />}
      />

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
                  setActiveIndex((current) => (visible.length === 0 ? 0 : (current - 1 + visible.length) % visible.length));
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
                      <AssetMark symbol={code} mint={holding.mint ?? "So11111111111111111111111111111111111111112"} icon={holding.catalog?.icon ?? null} size={28} />
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
                        {localFigure(displayAmount(holding.spendableRaw, holding.decimals), locale)}
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
