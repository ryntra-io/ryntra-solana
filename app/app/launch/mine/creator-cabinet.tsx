"use client";

import { ArrowSquareOut, CaretDown, CheckCircle, CircleNotch, Clock, ImageSquare, Plus, Receipt, Wallet, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type {
  LaunchCabinetRow,
  LaunchClaimBuildResponse,
  LaunchClaimReceipt,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchMarketResponse,
} from "@/lib/api/v1/contract";
import { launchPreset } from "@/lib/core/venues/meteora-dbc/presets";
import { signTransactions } from "@/lib/solana/wallet.client";

import { explorerUrl, formatBps, formatCountShort, formatDate, formatMoneyShort, formatRaw, fromRaw, shortAddress } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { PausedChip, PausedNote } from "../paused-note";

/**
 * «Мої лаунчі» — the creator's cabinet. Drawn for 390 px first: what the
 * wallet's launches earned it (each currency apart), then each launch — its
 * way to the DEX, its day's volume and holders, what it earned and what can be
 * claimed now, one orange «Забрати» — and the claim receipts. Every figure is
 * the chain's; a figure that could not be read is said as not read.
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
type Pair = LaunchCabinetRow["pair"];

/** An amount in its currency, short: «$12,4 тис.» in dollars, «1 234 COMM» in a community's token. */
function money(raw: string | bigint, pair: Pair, locale: WorkspaceLocale): string {
  const value = Number(fromRaw(raw, pair.decimals, 6));
  if (pair.dollar && value > 0 && value < 0.01) return locale === "uk" ? "< $0,01" : "< $0.01";
  return formatMoneyShort(value, locale, pair.dollar, pair.symbol);
}

/** An amount the person takes, to the cent: «$174,09» · «361,33 COMM». */
function exact(raw: string | bigint, pair: Pair, locale: WorkspaceLocale): string {
  const value = Number(fromRaw(raw, pair.decimals, 6));
  if (value > 0 && value < 0.01) return pair.dollar ? (locale === "uk" ? "< $0,01" : "< $0.01") : `< 0${locale === "uk" ? "," : "."}01 ${pair.symbol}`;
  const text = formatRaw(raw, pair.decimals, locale, 2);
  return pair.dollar ? `$${text}` : `${text} ${pair.symbol}`;
}

export function CreatorCabinet({ locale, network, paused = false }: { locale: WorkspaceLocale; network: "solana:devnet" | "solana:mainnet"; paused?: boolean }) {
  const word = launchWords(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const wallet = connection?.address ?? null;
  const [read, setRead] = useState<{ wallet: string; data: LaunchCreatorCabinetResponse | null; failed: boolean } | null>(null);
  const [markets, setMarkets] = useState<Record<string, LaunchMarketResponse | "unread" | undefined>>({});

  const load = useCallback(async () => {
    if (!wallet) return;
    setRead((current) => (current?.wallet === wallet ? { ...current, failed: false } : { wallet, data: null, failed: false }));
    const answer = await api<LaunchCreatorCabinetResponse>(`/api/v1/launch/creators/${wallet}`);
    setRead({ wallet, data: answer.ok ? answer.data : null, failed: !answer.ok });
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The day's volume and the holders come from each token's own market read — one at a time, after the cabinet, so a public node is not asked in a burst. */
  const tokens = useMemo(() => (read?.data?.launches ?? []).map((row) => row.token), [read?.data]);
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const token of tokens) {
        if (!live) return;
        const answer = await api<LaunchMarketResponse>(`/api/v1/launch/${token}/market`);
        if (!live) return;
        setMarkets((current) => ({ ...current, [token]: answer.ok ? answer.data : "unread" }));
      }
    })();
    return () => {
      live = false;
    };
  }, [tokens]);

  const data = read?.wallet === wallet ? read?.data : null;
  const reading = Boolean(wallet) && (!read || read.wallet !== wallet || (!read.data && !read.failed));

  return (
    <div className={styles.page}>
      {/* «Запустити токен» is the tab beside this one: no second way to the same page in the head. */}
      <header className={styles.mineHeadGrid}>
        <div className={styles.headRow}>
          <h1 className={styles.title}>{word("mineTitle")}</h1>
          {network === "solana:devnet" ? (
            <span className={styles.netChip} title={word("devnetHint")}>
              {word("devnet")}
            </span>
          ) : null}
          {paused ? <PausedChip locale={locale} /> : null}
        </div>
        <p className={styles.lede}>{word("mineLede")}</p>
        {/* Launch's stop closed: «Забрати» waits; the cabinet is read as ever. */}
        {paused ? <PausedNote locale={locale} /> : null}
      </header>

      {!wallet ? (
        <section className={`${styles.card} ${styles.mineEmpty}`}>
          <Wallet size={28} aria-hidden className={styles.mineEmptyIcon} />
          <h2 className={styles.cardTitle}>{word("mineConnectTitle")}</h2>
          <p className={styles.hint}>{word("mineConnectLine")}</p>
          <button type="button" className="rw-btn rw-btn--primary" onClick={() => reach()}>
            <Wallet size={18} aria-hidden /> {word("mineConnect")}
          </button>
        </section>
      ) : reading ? (
        <section className={`${styles.card} ${styles.mineEmpty}`} aria-busy="true">
          <CircleNotch size={22} aria-hidden className={styles.spin} />
          <p className={styles.hint}>{word("mineReading")}</p>
        </section>
      ) : !data ? (
        <section className={`${styles.card} ${styles.mineEmpty}`} role="alert">
          <p className={styles.hint}>{word("mineUnread")}</p>
          <button type="button" className="rw-btn" onClick={() => void load()}>
            {word("mineReadAgain")}
          </button>
        </section>
      ) : data.launches.length === 0 ? (
        <section className={`${styles.card} ${styles.mineEmpty}`}>
          <h2 className={styles.cardTitle}>{word("mineEmptyTitle")}</h2>
          <p className={styles.hint}>{word("mineEmptyLine")}</p>
          <Link href="/app/launch/new" className="rw-btn rw-btn--primary">
            <Plus size={18} aria-hidden /> {word("mineLaunch")}
          </Link>
        </section>
      ) : (
        /* The launches, and beside them on a wide desk the totals and the receipts; on a phone the totals come first. */
        <div className={styles.mineBoard}>
          <Summary data={data} locale={locale} />
          <ul className={styles.mineList} data-area="list">
            {data.launches.map((row) => (
              <li key={row.token}>
                <LaunchRow row={row} market={markets[row.token]} wallet={wallet} network={data.network} locale={locale} paused={paused} onClaimed={() => void load()} />
              </li>
            ))}
          </ul>
          <Receipts receipts={data.receipts} network={data.network} locale={locale} />
        </div>
      )}
    </div>
  );
}

/** What all the wallet's launches earned it, each currency apart — never a community token turned into dollars. */
function Summary({ data, locale }: { data: LaunchCreatorCabinetResponse; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const card = data.card;
  const toClaim = new Map<string, bigint>();
  for (const row of data.launches) if (row.earnings) toClaim.set(row.pair.mint, (toClaim.get(row.pair.mint) ?? 0n) + BigInt(row.earnings.mine.unclaimedRaw));
  return (
    <section className={styles.card} aria-labelledby="mine-summary" data-area="summary">
      <h2 id="mine-summary" className={styles.visuallyHidden}>
        {word("mineEarned")}
      </h2>
      <dl className={styles.mineTotals}>
        {(["earned", "toClaim", "claimed"] as const).map((metric) => (
          <div key={metric} className={styles.mineTotal} data-lead={metric === "earned" ? "" : undefined}>
            <dt>{word(metric === "earned" ? "mineEarned" : metric === "toClaim" ? "mineToClaim" : "mineClaimed")}</dt>
            {[...card.amounts].sort((a, b) => Number(b.dollar) - Number(a.dollar)).map((amount) => {
              const pair = { mint: amount.pairMint, symbol: amount.symbol, decimals: amount.decimals, dollar: amount.dollar };
              const raw = metric === "earned" ? amount.earnedRaw : metric === "claimed" ? amount.claimedRaw : (toClaim.get(amount.pairMint) ?? 0n);
              return <dd key={amount.pairMint}>{metric === "toClaim" ? exact(raw, pair, locale) : money(raw, pair, locale)}</dd>;
            })}
          </div>
        ))}
      </dl>
      <p className={styles.mineMeta}>
        <span>
          {word("mineLaunches")} <strong>{card.launches}</strong>
        </span>
        <span aria-hidden>·</span>
        <span>
          {word("mineOnDex")} <strong>{card.graduated}</strong>
        </span>
        <span aria-hidden>·</span>
        <span>{word("mineSince", { date: formatDate(card.period.from, locale) })}</span>
      </p>
      {card.unread > 0 ? <p className={styles.unread}>{word("mineSummaryUnread", { n: card.unread })}</p> : null}
    </section>
  );
}

type ClaimPhase = "idle" | "prepare" | "sign" | "send" | "done" | "error";

function LaunchRow({
  row,
  market,
  wallet,
  network,
  locale,
  paused,
  onClaimed,
}: {
  row: LaunchCabinetRow;
  market: LaunchMarketResponse | "unread" | undefined;
  wallet: string;
  network: "solana:devnet" | "solana:mainnet";
  locale: WorkspaceLocale;
  paused: boolean;
  onClaimed: () => void;
}) {
  const word = launchWords(locale);
  const { connection } = useSolanaConnection();
  const [phase, setPhase] = useState<ClaimPhase>("idle");
  /* Where a refusal came from: before anything was sent, or at the send — when the answer may be lost after the claim went out. */
  const [failure, setFailure] = useState<{ code: string; message: string; step?: "send" } | null>(null);
  const [result, setResult] = useState<LaunchClaimSubmitResponse | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const earnings = row.earnings;
  /* A wallet named in a sharing still being confirmed: nothing of it is the wallet's yet. */
  const waiting = row.role === "recipient" && row.feeSharing?.state !== "SHARED";
  const presetName = launchPreset(row.preset)?.name[locale] ?? row.preset;
  const unclaimed = earnings ? BigInt(earnings.mine.unclaimedRaw) : 0n;
  const busy = phase === "prepare" || phase === "sign" || phase === "send";
  const shared = row.feeSharing && row.feeSharing.state !== "FAILED";

  const claim = async () => {
    setFailure(null);
    setPhase("prepare");
    const base = `/api/v1/launch/${row.token}/claim`;
    const built = await api<LaunchClaimBuildResponse>(`${base}/build`, { method: "POST", body: JSON.stringify({ wallet }) });
    if (!built.ok) {
      setFailure(built);
      setPhase("error");
      return;
    }
    setCost(built.data.networkCostLamports);
    setPhase("sign");
    if (!connection || connection.address !== wallet) {
      setFailure({ code: "WALLET_CHANGED", message: "" });
      setPhase("error");
      return;
    }
    const signed = await signTransactions({ wallet: connection.wallet, address: wallet, unsignedWireBase64: [...built.data.unsignedWireBase64], chain: built.data.network });
    if (!signed.ok) {
      /* Cancelled in the wallet: nothing was sent, and the button is back. */
      setFailure({ code: "WALLET_REFUSED", message: signed.reason });
      setPhase("idle");
      return;
    }
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
    setPhase("done");
    onClaimed();
  };

  return (
    <article className={`${styles.card} ${styles.mineCard}`} aria-labelledby={`mine-${row.token}`}>
      <header className={styles.mineHead}>
        <span className={styles.minePicture}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the token's own picture, served by its immutable address */}
          {row.image ? <img src={row.image} alt="" /> : <ImageSquare size={22} aria-hidden />}
        </span>
        <div className={styles.mineTitleBlock}>
          <h2 id={`mine-${row.token}`} className={styles.mineName}>
            <Link href={`/app/launch/${row.token}`}>{row.name}</Link>
          </h2>
          <div className={styles.tokenMeta}>
            <span className={styles.tokenSymbol}>${row.symbol}</span>
            <span className={styles.chip}>{word("presetChip", { name: presetName })}</span>
            {row.role === "recipient" && earnings ? <span className={styles.chip}>{word("mineRoleShare", { pct: formatBps(earnings.mine.shareBps, locale) })}</span> : null}
          </div>
          <p className={styles.mineSub}>
            {word("mineLaunchedAt", { date: formatDate(row.launchedAt, locale) })} · <span className={styles.addr}>{shortAddress(row.token)}</span>
          </p>
        </div>
      </header>

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

      <dl className={styles.mineStats}>
        <div className={styles.stat}>
          <dt>{word("mineVolume")}</dt>
          <dd>{marketFigure(market, (data) => `${data.volume24h.complete ? "" : "≥ "}${formatMoneyShort(data.volume24h.pair, locale, data.pair.dollar, data.pair.symbol)}`, word)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{word("mineHolders")}</dt>
          <dd>{marketFigure(market, (data) => `${data.holders.atLeast ? "≥ " : ""}${formatCountShort(data.holders.count, locale)}`, word)}</dd>
        </div>
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
        <details className={styles.details}>
          <summary className={styles.summary}>
            {word("mineBreakdown")} <CaretDown size={14} aria-hidden className={styles.caret} />
          </summary>
          {shared ? <p className={styles.hint}>{word("mineBreakdownShare", { pct: formatBps(earnings.mine.shareBps, locale) })}</p> : null}
          <dl className={styles.rows}>
            {(["curve", "graduation", "lp"] as const).map((source) => {
              const part = earnings.role[source];
              /* Shared: the wallet's part of each source, so the rows add up to what it earned. */
              const earned = shared ? (BigInt(part.earnedRaw) * BigInt(earnings.mine.shareBps)) / 10_000n : BigInt(part.earnedRaw);
              const left = BigInt(part.unclaimedRaw);
              const later = source !== "curve" && !row.migrated;
              return (
                <div key={source} className={styles.row}>
                  <dt>{word(`source_${source}`)}</dt>
                  <dd>
                    {later ? (
                      <span className={styles.statUnread}>{word("sourceAfterDex")}</span>
                    ) : (
                      <>
                        {money(earned, row.pair, locale)}
                        {!shared && left > 0n && left !== earned ? <span className={styles.mineLeft}>{word("sourceLeft", { amount: exact(left, row.pair, locale) })}</span> : null}
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </details>
      ) : null}

      {row.feeSharing ? <Sharing row={row} wallet={wallet} network={network} locale={locale} /> : null}

      {phase === "done" && result ? (
        <ClaimResult result={result} row={row} network={network} locale={locale} onClose={() => setPhase("idle")} />
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
                {step === "prepare" ? word("stepPrepareClaim") : step === "sign" ? word("stepSign") : word("stepSendClaim")}
              </li>
            );
          })}
          {phase !== "prepare" ? <li className={styles.mineCost}>{cost === null ? word("claimCostUnknown") : word("claimCost", { sol: formatRaw(cost, 9, locale, 6) })}</li> : null}
        </ol>
      ) : (
        <div className={styles.mineActions}>
          {row.claimable && unclaimed > 0n && !paused ? (
            <button type="button" className={`rw-btn ${styles.cta} ${styles.claimBtn}`} onClick={() => void claim()}>
              {word("claim", { amount: exact(unclaimed, row.pair, locale) })}
            </button>
          ) : (
            <p className={styles.hint}>{waiting ? word("mineSharePending") : earnings && earnings.mine.shareBps === 0 ? word("claimNotYours") : word("claimNothing")}</p>
          )}
          <Link className={styles.markLink} href={`/app/launch/${row.token}`}>
            {word("mineOpenToken")} <ArrowSquareOut size={14} aria-hidden />
          </Link>
        </div>
      )}

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
            <p className={styles.failureText}>{claimFailureText(failure.code, failure.step === "send", word)}</p>
          </div>
        )
      ) : null}
    </article>
  );
}

function marketFigure(market: LaunchMarketResponse | "unread" | undefined, figure: (data: LaunchMarketResponse) => string, word: Word) {
  if (market === undefined) return <span className={styles.statUnread}>{word("mineMarketReading")}</span>;
  if (market === "unread") return <span className={styles.statUnread}>{word("mineNotRead")}</span>;
  return figure(market);
}

/** The title says only what is known: «nothing was claimed» where the claim was refused before or by the network, else what happened. */
function claimFailureTitle(code: string, atSend: boolean): "errClaimTitle" | "errClaimTitleUnknown" | "errClaimTitleSent" {
  if (code === "LAUNCH_BUILD_USED") return "errClaimTitleSent";
  const known = ["LAUNCH_SUBMIT_FAILED", "LAUNCH_NOTHING_TO_CLAIM", "LAUNCH_SIGNED_OTHER_BYTES", "LAUNCH_BUILD_EXPIRED", "WALLET_CHANGED", "WALLET_MISMATCH", "LAUNCH_NOT_FOUND", "LAUNCH_PAUSED"];
  return atSend && !known.includes(code) ? "errClaimTitleUnknown" : "errClaimTitle";
}

function claimFailureText(code: string, atSend: boolean, word: Word): string {
  switch (code) {
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

function ClaimResult({ result, row, network, locale, onClose }: { result: LaunchClaimSubmitResponse; row: LaunchCabinetRow; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale; onClose: () => void }) {
  const word = launchWords(locale);
  const received = result.receipts.reduce((total, receipt) => total + BigInt(receipt.receivedRaw), 0n);
  const confirmed = result.state === "CONFIRMED";
  /* A part said as a part only when something was received; a first transaction still unconfirmed is said as pending. */
  const partial = result.state === "PARTIAL" && received > 0n;
  return (
    <div className={styles.mineResult} role="status" aria-live="polite">
      <p className={styles.mineResultTitle}>
        {confirmed ? <CheckCircle size={18} weight="fill" aria-hidden className={styles.mineDone} /> : partial ? <Warning size={18} weight="fill" aria-hidden className={styles.minePartial} /> : <Clock size={18} aria-hidden />}
        {confirmed ? word("claimDone", { amount: exact(received, row.pair, locale) }) : partial ? word("claimPartial", { amount: exact(received, row.pair, locale) }) : word("claimPendingTitle")}
      </p>
      <p className={styles.hint}>{confirmed ? word("claimDoneLine") : result.state === "PARTIAL" ? word("claimPartialLine") : word("claimPendingLine")}</p>
      {[...result.receipts.map((receipt) => receipt.signature), ...result.pending].map((signature) => (
        <a key={signature} className={styles.markLink} href={explorerUrl(network, "tx", signature)} target="_blank" rel="noreferrer noopener">
          {word("viewTx")} {shortAddress(signature)} <ArrowSquareOut size={14} aria-hidden />
        </a>
      ))}
      <button type="button" className="rw-btn" onClick={onClose}>
        {word("claimAgain")}
      </button>
    </div>
  );
}

/** The claim receipts: what each program paid by its own event, and what the wallet received — each with its transaction. */
function Receipts({ receipts, network, locale }: { receipts: readonly LaunchClaimReceipt[]; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  return (
    <section className={styles.card} aria-labelledby="mine-receipts" data-area="receipts">
      <h2 id="mine-receipts" className={styles.cardTitle}>
        <Receipt size={18} aria-hidden /> {word("receiptsTitle")}
      </h2>
      {receipts.length === 0 ? (
        <p className={styles.hint}>{word("receiptsEmpty")}</p>
      ) : (
        <ul className={styles.mineReceipts}>
          {receipts.map((receipt) => {
            /* A transaction that only funded the shared vault received nothing itself: its figure is what it put in. */
            const paidIn = BigInt(receipt.paid.curve) + BigInt(receipt.paid.graduation) + BigInt(receipt.paid.lp);
            const intoVault = BigInt(receipt.receivedRaw) === 0n && paidIn > 0n;
            const shared = receipt.vaultPaidRaw !== null || intoVault;
            return (
              <li key={receipt.signature} className={styles.mineReceipt}>
                <div className={styles.mineReceiptHead}>
                  <span>
                    <strong>{receipt.name}</strong> <span className={styles.tokenSymbol}>${receipt.symbol}</span>{" "}
                    <span className={styles.hint}>
                      {receipt.at ? formatDate(receipt.at, locale) : ""} · <span className={styles.addr}>{shortAddress(receipt.token)}</span>
                    </span>
                  </span>
                  <span className={styles.mineReceiptAmount}>
                    {intoVault ? <span className={styles.optional}>{word("receiptIntoVault")} </span> : null}
                    {exact(intoVault ? paidIn : receipt.receivedRaw, receipt.pair, locale)}
                  </span>
                </div>
                <details className={styles.details}>
                  <summary className={styles.summary}>
                    {word("receiptPaid")}
                    {shared ? <span className={styles.optional}> · {word("receiptIntoVault")}</span> : null} <CaretDown size={14} aria-hidden className={styles.caret} />
                  </summary>
                  <dl className={styles.rows}>
                    {(["curve", "graduation", "lp"] as const)
                      .filter((source) => BigInt(receipt.paid[source]) > 0n)
                      .map((source) => (
                        <div key={source} className={styles.row}>
                          <dt>{word(`source_${source}`)}</dt>
                          <dd>{formatRaw(receipt.paid[source], receipt.pair.decimals, locale, 4)} {receipt.pair.symbol}</dd>
                        </div>
                      ))}
                    {shared ? (
                      <div className={styles.row}>
                        <dt>{word("receiptVaultPaid")}</dt>
                        <dd>{formatRaw(receipt.vaultPaidRaw!, receipt.pair.decimals, locale, 4)} {receipt.pair.symbol}</dd>
                      </div>
                    ) : null}
                    <div className={styles.row}>
                      <dt>{word("receiptReceived")}</dt>
                      <dd>{formatRaw(receipt.receivedRaw, receipt.pair.decimals, locale, 4)} {receipt.pair.symbol}</dd>
                    </div>
                  </dl>
                </details>
                <a className={styles.markLink} href={explorerUrl(network, "tx", receipt.signature)} target="_blank" rel="noreferrer noopener">
                  {word("viewTx")} {shortAddress(receipt.signature)} <ArrowSquareOut size={14} aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
