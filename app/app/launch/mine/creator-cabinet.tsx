"use client";

import { ArrowSquareOut, CaretDown, CheckCircle, CircleNotch, ImageSquare, Warning } from "@phosphor-icons/react";
import { Block, Button, Receipt as CoreReceipt, EmptyState, HeroNumber, Page } from "@ryntra/core/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type {
  LaunchCabinetRow,
  LaunchClaimBuildResponse,
  LaunchClaimReviewResponse,
  LaunchClaimReceipt,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchStatsResponse,
} from "@/lib/api/v1/contract";
import { buildMatchesReview } from "@/lib/core/launch/claim-review";
import { launchPreset } from "@/lib/core/venues/meteora-dbc/presets";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions } from "@/lib/solana/wallet.client";

import { coreLang, LinkButton, Reading, Unread } from "../launch-blocks";
import { explorerUrl, formatBps, formatDate, formatRaw, shortAddress } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { PausedChip, PausedNote } from "../paused-note";
import { CompareLaunches, EarnedBySource, LaunchDexMarket, LaunchMarketFigures, LaunchOwnTrades, LaunchSources, NotesBlock, ProfileBlock, type StatsRead } from "./cabinet-blocks";
import { exact, money } from "./cabinet-figures";
import { cabinetWords } from "./cabinet-words";
import { ClaimAllReading, ClaimAllReview } from "./claim-all-review";
import { claimAllWords } from "./claim-all-words";
import { SplitBlock } from "./split-block";
import { TransferFeeCabinet } from "./transfer-fee-actions";
import own from "./cabinet.module.css";

/**
 * «Мої лаунчі» — the creator's cabinet. Drawn for 390 px first: what the
 * wallet's launches earned it (each currency apart) by source over the day,
 * the week and all time; the launches side by side; then each launch — its
 * way to the DEX, its holders, traders and those who came back, its volume
 * and liquidity, after the DEX its market, the creator's own trades and lock,
 * what can be claimed now with one «Забрати все» — every pocket in one Review
 * before the signature (SOL-L12) — the claim receipts, the notifications and
 * the public profile (SOL-L2). Every figure is the chain's; a figure that
 * could not be read is said as not read.
 *
 * The cabinet belongs to the wallet, not to the browser: it reads by the
 * connected wallet's address and keeps nothing here.
 */

type Answer<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
const API_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

async function api<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) } });
    const body = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!response.ok) return { ok: false, code: body?.error?.code ?? "UNAVAILABLE", message: body?.error?.message ?? "" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "" };
  }
}

type Word = ReturnType<typeof launchWords>;

export function CreatorCabinet({ locale, network, paused = false }: { locale: WorkspaceLocale; network: "solana:devnet" | "solana:mainnet"; paused?: boolean }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const wallet = connection?.address ?? null;
  const [read, setRead] = useState<{ wallet: string; data: LaunchCreatorCabinetResponse | null; failed: boolean } | null>(null);
  const [stats, setStats] = useState<Record<string, StatsRead>>({});

  const load = useCallback(async () => {
    if (!wallet) return;
    setRead((current) => (current?.wallet === wallet ? { ...current, failed: false } : { wallet, data: null, failed: false }));
    const answer = await api<LaunchCreatorCabinetResponse>(`/api/v1/launch/creators/${wallet}`);
    setRead({ wallet, data: answer.ok ? answer.data : null, failed: !answer.ok });
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Each launch's figures — the day's and the week's, the market, the creator's own trades — come from its own read, one
     at a time after the cabinet, so a public node is not asked in a burst. */
  const tokens = useMemo(() => (read?.data?.launches ?? []).map((row) => row.token), [read?.data]);
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const token of tokens) {
        if (!live) return;
        const answer = await api<LaunchStatsResponse>(`/api/v1/launch/${token}/stats`);
        if (!live) return;
        setStats((current) => ({ ...current, [token]: answer.ok ? answer.data : "unread" }));
      }
    })();
    return () => {
      live = false;
    };
  }, [tokens]);

  const data = read?.wallet === wallet ? read?.data : null;
  const reading = Boolean(wallet) && (!read || read.wallet !== wallet || (!read.data && !read.failed));
  const full = Boolean(wallet && !reading && data && data.launches.length > 0);

  return (
    /* «Запустити токен» is the tab beside this one and the frame's own action: no second way to the same page in the head. */
    <Page
      kind="overview"
      className={styles.corePage}
      title={word("mineTitle")}
      lead={
        <>
          {word("mineLede")}
          {network === "solana:devnet" ? (
            <span className={styles.netChip} title={word("devnetHint")}>
              {word("devnet")}
            </span>
          ) : null}
          {paused ? <PausedChip locale={locale} /> : null}
        </>
      }
      aside={
        full && data && wallet ? (
          <>
            <Receipts receipts={data.receipts} network={data.network} locale={locale} />
            <NotesBlock locale={locale} />
            <ProfileBlock wallet={wallet} locale={locale} />
          </>
        ) : undefined
      }
    >
      {/* Launch's stop closed: «Забрати» waits; the cabinet is read as ever. */}
      {paused ? <PausedNote locale={locale} /> : null}
      {!wallet ? (
        <EmptyState
          icon="wallet"
          text={word("mineConnectLine")}
          action={
            <ConnectWalletButton />
          }
        />
      ) : reading ? (
        <Reading label={word("mineReading")} hero lines={4} />
      ) : !data ? (
        <Unread text={word("mineUnread")} again={word("mineReadAgain")} onAgain={() => void load()} lang={lang} />
      ) : data.launches.length === 0 ? (
        <EmptyState
          icon="inbox"
          text={word("mineEmptyLine")}
          action={
            <LinkButton href="/app/launch/new" variant="primary">
              {word("mineLaunch")}
            </LinkButton>
          }
        />
      ) : (
        <>
          <Summary data={data} stats={stats} locale={locale} />
          {data.launches.length > 1 ? <CompareLaunches rows={data.launches} stats={stats} locale={locale} /> : null}
          <ul className={styles.mineList}>
            {data.launches.map((row) => (
              <li key={row.token}>
                <LaunchRow row={row} stats={stats[row.token]} wallet={wallet} network={data.network} locale={locale} paused={paused} onClaimed={() => void load()} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}

/** How many launches reached a DEX: with some not read, a floor («2+») or «not read» — never a «0» for launches not read. */
function onDex(card: LaunchCreatorCabinetResponse["card"], word: ReturnType<typeof launchWords>): string {
  if (card.unread === 0) return String(card.graduated);
  return card.graduated > 0 ? `${card.graduated}+` : word("mineOnDexUnread");
}

/**
 * What all the wallet's launches earned it — the page's one number, each currency apart, never a community token
 * turned into dollars — with what can be claimed now and what was claimed beside it.
 */
function Summary({ data, stats, locale }: { data: LaunchCreatorCabinetResponse; stats: Readonly<Record<string, StatsRead>>; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const card = data.card;
  const toClaim = new Map<string, bigint>();
  for (const row of data.launches) if (row.earnings) toClaim.set(row.pair.mint, (toClaim.get(row.pair.mint) ?? 0n) + BigInt(row.earnings.mine.unclaimedRaw));
  const amounts = [...card.amounts].sort((a, b) => Number(b.dollar) - Number(a.dollar));
  const figures = (metric: "earned" | "toClaim" | "claimed") =>
    amounts.map((amount) => {
      const pair = { mint: amount.pairMint, symbol: amount.symbol, decimals: amount.decimals, dollar: amount.dollar };
      const raw = metric === "earned" ? amount.earnedRaw : metric === "claimed" ? amount.claimedRaw : (toClaim.get(amount.pairMint) ?? 0n);
      return (
        <span key={amount.pairMint} className={styles.mineFigure}>
          {metric === "toClaim" ? exact(raw, pair, locale) : money(raw, pair, locale)}
        </span>
      );
    });
  return (
    <section className={styles.mineSummary} aria-label={word("mineEarned")}>
      <HeroNumber
        label={word("mineEarned")}
        value={<span className={styles.mineFigures}>{figures("earned")}</span>}
        note={`${word("mineLaunches")} ${card.launches} · ${word("mineOnDex")} ${onDex(card, word)} · ${word("mineSince", { date: formatDate(card.period.from, locale) })}`}
        lang={lang}
      />
      <dl className={styles.mineTotals}>
        <div className={styles.mineTotal}>
          <dt>{word("mineToClaim")}</dt>
          <dd>{figures("toClaim")}</dd>
        </div>
        <div className={styles.mineTotal}>
          <dt>{word("mineClaimed")}</dt>
          <dd>{figures("claimed")}</dd>
        </div>
      </dl>
      {card.unread > 0 ? <p className={styles.unread}>{word("mineSummaryUnread", { n: card.unread })}</p> : null}
      <div className={own.summaryWide}>
        <EarnedBySource rows={data.launches} stats={stats} locale={locale} />
      </div>
    </section>
  );
}

type ClaimPhase = "idle" | "prepare" | "sign" | "send" | "done" | "error";

function LaunchRow({
  row,
  stats,
  wallet,
  network,
  locale,
  paused,
  onClaimed,
}: {
  row: LaunchCabinetRow;
  stats: StatsRead;
  wallet: string;
  network: "solana:devnet" | "solana:mainnet";
  locale: WorkspaceLocale;
  paused: boolean;
  onClaimed: () => void;
}) {
  const word = launchWords(locale);
  const cabinet = cabinetWords(locale);
  const say = claimAllWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const [phase, setPhase] = useState<ClaimPhase>("idle");
  /* «Забрати все» (SOL-L12): every pocket read and shown before a wallet is asked; the claim built after is checked against it. */
  const [review, setReview] = useState<{ state: "reading" } | { state: "shown"; data: LaunchClaimReviewResponse } | { state: "unread" } | null>(null);
  const read = stats && stats !== "unread" ? stats : null;
  /* Where a refusal came from: before anything was sent, or at the send — when the answer may be lost after the claim went out. */
  const [failure, setFailure] = useState<{ code: string; message: string; step?: "send" } | null>(null);
  const [result, setResult] = useState<LaunchClaimSubmitResponse | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  /* When the claim went out — the receipt's time, not the moment it is drawn again. */
  const [claimedAt, setClaimedAt] = useState(0);
  const earnings = row.earnings;
  /* A wallet named in a sharing still being confirmed: nothing of it is the wallet's yet. */
  const waiting = row.role === "recipient" && row.feeSharing?.state !== "SHARED";
  const presetName = launchPreset(row.preset)?.name[locale] ?? row.preset;
  const unclaimed = earnings ? BigInt(earnings.mine.unclaimedRaw) : 0n;
  const busy = phase === "prepare" || phase === "sign" || phase === "send";
  const shared = row.feeSharing && row.feeSharing.state !== "FAILED";
  /* The claim was built a second time: the first signature came back after the bytes had aged (AG-1). */
  const [again, setAgain] = useState(false);

  const openReview = async () => {
    setFailure(null);
    setReview({ state: "reading" });
    const answer = await api<LaunchClaimReviewResponse>(`/api/v1/launch/${row.token}/claim/review?wallet=${encodeURIComponent(wallet)}`);
    if (answer.ok) setReview({ state: "shown", data: answer.data });
    else if (answer.code === "WALLET_MISMATCH" || answer.code === "LAUNCH_NOT_FOUND") {
      setReview(null);
      setFailure({ code: answer.code, message: answer.message });
      setPhase("error");
    } else setReview({ state: "unread" });
  };

  const claim = async (shown: LaunchClaimReviewResponse) => {
    setReview(null);
    setFailure(null);
    setPhase("prepare");
    const base = `/api/v1/launch/${row.token}/claim`;
    if (!connection || connection.address !== wallet) {
      setFailure({ code: "WALLET_CHANGED", message: "" });
      setPhase("error");
      return;
    }
    setAgain(false);
    /* Bytes live ~30 s (`lib/solana/blockhash-life.ts`): a signature that comes back later is not sent — the claim is built again. */
    const fresh = await signFreshBytes({
      build: async () => {
        setPhase("prepare");
        const built = await api<LaunchClaimBuildResponse>(`${base}/build`, { method: "POST", body: JSON.stringify({ wallet }) });
        /* The bytes must be the claim the Review showed — as many transactions, the same pockets — or no wallet is asked. */
        if (built.ok && !buildMatchesReview(shown, built.data)) return { ok: false as const, code: CLAIM_CHANGED, message: "" };
        return built;
      },
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        setCost(data.networkCostLamports);
        setPhase("sign");
        const answer = await signTransactions({ wallet: connection.wallet, address: wallet, unsignedWireBase64: [...data.unsignedWireBase64], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
      onRebuild: (why) => setAgain(why === "late"),
    });
    if (!fresh.ok) {
      if (fresh.stage === "sign") {
        /* Cancelled in the wallet: nothing was sent, and the button is back. */
        setFailure({ code: "WALLET_REFUSED", message: fresh.reason });
        setPhase("idle");
        return;
      }
      setFailure(fresh.stage === "build" ? fresh.failure : { code: "LAUNCH_BUILD_EXPIRED", message: "" });
      setPhase("error");
      return;
    }
    const built = { data: fresh.built };
    const signed = { signedWireBase64: fresh.signed };
    setPhase("send");
    const sent = await api<LaunchClaimSubmitResponse>(`${base}/submit`, { method: "POST", body: JSON.stringify({ buildId: built.data.buildId, wallet, signedWireBase64: signed.signedWireBase64 }) });
    if (!sent.ok) {
      setFailure({ ...sent, step: "send" });
      setPhase("error");
      /* An answer lost at the send may hide a claim that went out: the cabinet is read again so its receipts say. */
      if (sent.code === "UNAVAILABLE") onClaimed();
      return;
    }
    setResult(sent.data);
    setClaimedAt(Date.now());
    setPhase("done");
    onClaimed();
  };

  return (
    <Block
      title={
        <>
          {row.name} <span className={styles.tokenSymbol}>${row.symbol}</span>
        </>
      }
      titleAs="h2"
      lang={lang}
      aria-label={`${row.name} $${row.symbol}`}
      action={
        phase === "done" || busy ? undefined : (
          <div className={styles.mineActions}>
            {row.claimable && unclaimed > 0n && !paused ? (
              <Button variant="secondary" onClick={() => void openReview()} disabled={review !== null} lang={lang}>
                {say("claimAll", { amount: exact(unclaimed, row.pair, locale) })}
              </Button>
            ) : (
              <p className={styles.hint}>
                {waiting ? word("mineSharePending") : earnings && earnings.mine.shareBps === 0 ? word("claimNotYours") : paused && unclaimed > 0n ? cabinet("claimPaused") : word("claimNothing")}
              </p>
            )}
            <LinkButton href={`/app/launch/${row.token}`} variant="ghost">
              {word("mineOpenToken")}
            </LinkButton>
          </div>
        )
      }
    >
      <div className={`${styles.blockStack} ${own.fitAll}`}>
        <div className={styles.mineHead}>
          <span className={styles.minePicture}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the token's own picture, served by its immutable address */}
            {row.image ? <img src={row.image} alt="" /> : <ImageSquare size={22} aria-hidden />}
          </span>
          <div className={styles.mineTitleBlock}>
            <div className={styles.tokenMeta}>
              <span className={styles.chip}>{word("presetChip", { name: presetName })}</span>
              {row.role === "recipient" && earnings ? <span className={styles.chip}>{word("mineRoleShare", { pct: formatBps(earnings.mine.shareBps, locale) })}</span> : null}
            </div>
            <p className={styles.mineSub}>
              {word("mineLaunchedAt", { date: formatDate(row.launchedAt, locale) })} · <span className={styles.addr}>{shortAddress(row.token)}</span>
            </p>
          </div>
        </div>

        <div className={styles.mineProgress}>
          <div className={styles.progressHead}>
            <span className={styles.hint}>{row.migrated ? word("graduated") : word("progress")}</span>
            {row.progressBps === null ? (
              <span className={styles.progressValue} data-unknown="">
                {word("progressUnknown")}
              </span>
            ) : (
              <span className={styles.progressValue}>{row.migrated ? <CheckCircle size={16} weight="fill" aria-hidden className={styles.mineDone} /> : formatBps(row.progressBps, locale)}</span>
            )}
          </div>
          {row.progressBps !== null && !row.migrated ? (
            <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progressBps / 100)} aria-label={word("progress")}>
              <span className={styles.barFill} style={{ width: `${row.progressBps / 100}%` }} />
            </div>
          ) : null}
        </div>

        <LaunchMarketFigures row={row} read={stats} locale={locale} />

        <dl className={styles.mineStats}>
          <div className={styles.stat}>
            <dt>{word("mineEarned")}</dt>
            <dd>{earnings ? money(earnings.mine.earnedRaw, row.pair, locale) : <span className={styles.statUnread}>{word(waiting ? "mineShareWaiting" : "mineNotRead")}</span>}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{word("mineToClaim")}</dt>
            <dd>{earnings ? exact(earnings.mine.unclaimedRaw, row.pair, locale) : <span className={styles.statUnread}>{word(waiting ? "mineShareWaiting" : "mineNotRead")}</span>}</dd>
          </div>
        </dl>

        {earnings ? (
          <details className={`${styles.details} ${own.fit}`}>
            <summary className={styles.summary}>
              {word("mineBreakdown")} <CaretDown size={14} aria-hidden className={styles.caret} />
            </summary>
            {shared ? <p className={styles.hint}>{word("mineBreakdownShare", { pct: formatBps(earnings.mine.shareBps, locale) })}</p> : null}
            <LaunchSources row={row} read={stats} locale={locale} />
            {row.migrated === false ? <p className={styles.hint}>{cabinet("afterDexHint")}</p> : null}
          </details>
        ) : null}

        {read?.market ? <LaunchDexMarket stats={read} pair={row.pair} locale={locale} /> : null}
        {read ? <LaunchOwnTrades stats={read} pair={row.pair} locale={locale} /> : null}

        {row.feeSharing ? <Sharing row={row} wallet={wallet} network={network} locale={locale} /> : null}
        {/* SOL-L2b: the creator divides their own share — the rule, what it owes, the steps and the rounds. */}
        {row.role === "creator" ? <SplitBlock row={row} wallet={wallet} network={network} locale={locale} paused={paused} /> : null}
        {/* SOL-L10: a «Розширений» launch may take a fee on transfers — its cycle and the creator's two steps; nothing when it takes none. */}
        {row.role === "creator" && row.preset === "advanced" ? <TransferFeeCabinet token={row.token} symbol={row.symbol} wallet={wallet} locale={locale} network={network} paused={paused} /> : null}

        {review?.state === "reading" ? <ClaimAllReading locale={locale} /> : null}
        {review?.state === "unread" ? <Unread text={say("reviewUnread")} again={say("reviewAgain")} onAgain={() => void openReview()} lang={lang} /> : null}
        {review?.state === "shown" ? (
          <ClaimAllReview review={review.data} symbol={row.symbol} wallet={wallet} locale={locale} signing={busy} onSign={() => void claim(review.data)} onCancel={() => setReview(null)} />
        ) : null}

        {phase === "done" && result ? (
          <ClaimResult result={result} at={claimedAt} row={row} network={network} locale={locale} onClose={() => setPhase("idle")} />
        ) : busy ? (
          <ol className={styles.steps} aria-live="polite">
            {(["prepare", "sign", "send"] as const).map((step) => {
              const order = ["prepare", "sign", "send"];
              const state = order.indexOf(step) < order.indexOf(phase) ? "done" : step === phase ? "active" : "next";
              return (
                <li key={step} className={styles.step} data-state={state}>
                  <span className={styles.stepIcon}>
                    {state === "done" ? <CheckCircle size={18} weight="fill" aria-hidden /> : state === "active" ? <CircleNotch size={18} aria-hidden className={styles.spin} /> : <span className={styles.stepDot} />}
                  </span>
                  {step === "prepare" ? word("stepPrepareClaim") : step === "sign" ? word(again ? "stepSignAgain" : "stepSign") : word("stepSendClaim")}
                </li>
              );
            })}
            {phase !== "prepare" ? <li className={styles.mineCost}>{cost === null ? word("claimCostUnknown") : word("claimCost", { sol: formatRaw(cost, 9, locale, 6) })}</li> : null}
          </ol>
        ) : null}

        {failure && phase !== "done" ? (
          failure.code === "WALLET_REFUSED" ? (
            <p className={styles.cancelled} role="status">
              {word("walletCancelled")}
            </p>
          ) : (
            <div className={styles.failure} role="alert">
              <p className={styles.failureTitle}>
                <Warning size={18} weight="fill" aria-hidden /> {word(claimFailureTitle(failure.code, failure.step === "send"))}
              </p>
              <p className={styles.failureText}>{claimFailureText(failure.code, failure.step === "send", word, locale)}</p>
            </div>
          )
        ) : null}
      </div>
    </Block>
  );
}

/** A client-side refusal: the claim built is not the one the Review showed; nothing was signed. */
const CLAIM_CHANGED = "LAUNCH_CLAIM_CHANGED";

/** The title says only what is known: «nothing was claimed» where the claim was refused before or by the network, else what happened. */
function claimFailureTitle(code: string, atSend: boolean): "errClaimTitle" | "errClaimTitleUnknown" | "errClaimTitleSent" {
  if (code === "LAUNCH_BUILD_USED") return "errClaimTitleSent";
  const known = [CLAIM_CHANGED, "LAUNCH_SUBMIT_FAILED", "LAUNCH_NOTHING_TO_CLAIM", "LAUNCH_SIGNED_OTHER_BYTES", "LAUNCH_BUILD_EXPIRED", "WALLET_CHANGED", "WALLET_MISMATCH", "LAUNCH_NOT_FOUND", "LAUNCH_PAUSED"];
  return atSend && !known.includes(code) ? "errClaimTitleUnknown" : "errClaimTitle";
}

function claimFailureText(code: string, atSend: boolean, word: Word, locale: WorkspaceLocale): string {
  switch (code) {
    case CLAIM_CHANGED:
      return claimAllWords(locale)("changed");
    case "LAUNCH_NOTHING_TO_CLAIM":
      return word("errClaimNothing");
    case "WALLET_MISMATCH":
      return word("errClaimMismatch");
    case "WALLET_CHANGED":
      return word("errClaimWalletChanged");
    case "LAUNCH_BUILD_EXPIRED":
      return word("errTradeExpired");
    case "LAUNCH_SIGNED_OTHER_BYTES":
      return word("errSignedOther");
    case "LAUNCH_SUBMIT_FAILED":
      return word("errClaimSubmit");
    case "LAUNCH_BUILD_USED":
      return word("errClaimUsed");
    case "LAUNCH_PAUSED":
      return word("errLaunchPaused");
    case "RATE_LIMITED":
      return word("errRateLimited");
    default:
      /* No answer at the send is not «nothing was sent»: the claim may have gone out. */
      return atSend ? word("errClaimUnknown") : word("errGeneric");
  }
}

/** The shares written for ever in the vault: who takes what of the creator's fees. */
function Sharing({ row, wallet, network, locale }: { row: LaunchCabinetRow; wallet: string; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const sharing = row.feeSharing!;
  if (sharing.state === "FAILED") return <p className={styles.unread}>{word("mineShareFailed")}</p>;
  return (
    <div className={styles.mineShares}>
      <p className={styles.mineSharesTitle}>
        {word("mineShares")}
        <a className={styles.markLink} href={explorerUrl(network, "account", sharing.vault)} target="_blank" rel="noreferrer noopener">
          {word("feeShareVault")} <ArrowSquareOut size={14} aria-hidden />
        </a>
      </p>
      <ul className={styles.mineShareList}>
        {sharing.shares.map((share) => (
          <li key={share.address}>
            <span className={styles.addr}>{share.address === wallet ? word("you") : share.address === row.creator ? `${word("label_creator")} · ${shortAddress(share.address)}` : shortAddress(share.address)}</span>
            <span className={styles.mineSharePct}>{formatBps(share.bps, locale)}</span>
          </li>
        ))}
      </ul>
      {sharing.state === "PENDING" ? <p className={styles.hint}>{word("mineSharePending")}</p> : null}
    </div>
  );
}

function ClaimResult({ result, at, row, network, locale, onClose }: { result: LaunchClaimSubmitResponse; at: number; row: LaunchCabinetRow; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale; onClose: () => void }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const received = result.receipts.reduce((total, receipt) => total + BigInt(receipt.receivedRaw), 0n);
  const confirmed = result.state === "CONFIRMED";
  /* A part said as a part only when something was received; a first transaction still unconfirmed is said as pending. */
  const partial = result.state === "PARTIAL" && received > 0n;
  const signatures = [...result.receipts.map((receipt) => receipt.signature), ...result.pending];
  return (
    <div className={styles.mineResult} role="status" aria-live="polite">
      <CoreReceipt
        variant="full"
        titleAs="h3"
        lang={lang}
        status={confirmed ? "completed" : "pending"}
        title={confirmed ? word("claimDone", { amount: exact(received, row.pair, locale) }) : partial ? word("claimPartial", { amount: exact(received, row.pair, locale) }) : word("claimPendingTitle")}
        amount={received > 0n ? `+${exact(received, row.pair, locale)}` : "—"}
        time={new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(at))}
        network={network === "solana:devnet" ? "Solana Devnet" : "Solana"}
        transaction={signatures[0] ? shortAddress(signatures[0]) : undefined}
        onVerify={signatures[0] ? () => window.open(explorerUrl(network, "tx", signatures[0]!), "_blank", "noopener,noreferrer") : undefined}
      />
      <p className={styles.hint}>{confirmed ? word("claimDoneLine") : result.state === "PARTIAL" ? word("claimPartialLine") : word("claimPendingLine")}</p>
      {/* A claim in more than one transaction: each one, where anyone can see it. */}
      {signatures.length > 1
        ? signatures.slice(1).map((signature) => (
            <a key={signature} className={styles.markLink} href={explorerUrl(network, "tx", signature)} target="_blank" rel="noreferrer noopener">
              {word("viewTx")} {shortAddress(signature)} <ArrowSquareOut size={14} aria-hidden />
            </a>
          ))
        : null}
      <Button variant="secondary" onClick={onClose} lang={lang}>
        {word("claimAgain")}
      </Button>
    </div>
  );
}

/**
 * The claim receipts, as the core's receipt: what the wallet received, «Перевірити» to its transaction — and, a press
 * deeper, what each program paid by its own event.
 */
function Receipts({ receipts, network, locale }: { receipts: readonly LaunchClaimReceipt[]; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  return (
    <Block title={word("receiptsTitle")} icon="receipt" titleAs="h2" lang={lang}>
      {receipts.length === 0 ? (
        <p className={styles.hint}>{word("receiptsEmpty")}</p>
      ) : (
        <ul className={styles.mineReceipts}>
          {receipts.map((receipt) => {
            /* A transaction that only funded the shared vault received nothing itself: its figure is what it put in. */
            const paidIn = BigInt(receipt.paid.curve) + BigInt(receipt.paid.graduation) + BigInt(receipt.paid.lp) + BigInt(receipt.paid.surplus ?? "0");
            const intoVault = BigInt(receipt.receivedRaw) === 0n && paidIn > 0n;
            const shared = receipt.vaultPaidRaw !== null || intoVault;
            return (
              <li key={receipt.signature} className={styles.mineReceipt}>
                <CoreReceipt
                  variant="compact"
                  lang={lang}
                  status="completed"
                  title={
                    <>
                      {receipt.name} <span className={styles.tokenSymbol}>${receipt.symbol}</span>
                    </>
                  }
                  amount={
                    <>
                      {intoVault ? <span className={styles.optional}>{word("receiptIntoVault")} </span> : null}
                      {exact(intoVault ? paidIn : receipt.receivedRaw, receipt.pair, locale)}
                    </>
                  }
                  time={receipt.at ? formatDate(receipt.at, locale) : shortAddress(receipt.signature)}
                  onVerify={() => window.open(explorerUrl(network, "tx", receipt.signature), "_blank", "noopener,noreferrer")}
                />
                <details className={styles.details}>
                  <summary className={styles.summary}>
                    {word("receiptPaid")}
                    {shared ? <span className={styles.optional}> · {word("receiptIntoVault")}</span> : null} <CaretDown size={14} aria-hidden className={styles.caret} />
                  </summary>
                  <dl className={styles.rows}>
                    {(["curve", "graduation", "lp", "surplus"] as const)
                      /* A receipt kept before 1.70.0 names no surplus. */
                      .filter((source) => BigInt(receipt.paid[source] ?? "0") > 0n)
                      .map((source) => (
                        <div key={source} className={styles.row}>
                          <dt>{word(`source_${source}`)}</dt>
                          <dd>
                            {formatRaw(receipt.paid[source], receipt.pair.decimals, locale, 4)} {receipt.pair.symbol}
                          </dd>
                        </div>
                      ))}
                    {shared ? (
                      <div className={styles.row}>
                        <dt>{word("receiptVaultPaid")}</dt>
                        <dd>
                          {formatRaw(receipt.vaultPaidRaw!, receipt.pair.decimals, locale, 4)} {receipt.pair.symbol}
                        </dd>
                      </div>
                    ) : null}
                    <div className={styles.row}>
                      <dt>{word("receiptReceived")}</dt>
                      <dd>
                        {formatRaw(receipt.receivedRaw, receipt.pair.decimals, locale, 4)} {receipt.pair.symbol}
                      </dd>
                    </div>
                    <div className={styles.row}>
                      <dt>{word("viewTx")}</dt>
                      <dd>
                        <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(network, "tx", receipt.signature)} target="_blank" rel="noreferrer noopener">
                          {shortAddress(receipt.signature)} <ArrowSquareOut size={12} aria-hidden />
                        </a>
                      </dd>
                    </div>
                  </dl>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}
