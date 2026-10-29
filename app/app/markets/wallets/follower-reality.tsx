"use client";

import { Block, Button, EmptyState, HeroNumber, Table, type TableColumn } from "@ryntra/core/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { FEE_POLICY_V2 } from "@/lib/core/fee-policy";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { shortAddress } from "@/lib/wallet-watch/notes";
import type { PaperFill, PaperSummary } from "@/lib/wallet-watch/paper";
import {
  COPY_ASSUMPTIONS,
  COPY_DELAYS,
  COPY_SIZES,
  COPY_SLIPPAGES,
  DEFAULT_COPY_SETTINGS,
  followerReality,
  type CopySettings,
  type PricePath,
  type RealityStep,
  type TokenNow,
  type TokenReality,
  type UnmeasuredReason,
} from "@/lib/wallet-watch/reality";
import type { WalletTrade } from "@/lib/wallet-watch/trades";

import { realityWords, type RealityWord } from "./reality-words";
import { solText } from "./sol-text";
import styles from "./wallet-watch.module.css";

/**
 * «Якби ти копіював цей гаманець» (SOL-R3): before any copying, what a person would have kept of a wallet's trades —
 * after their delay, the pool's depth, slippage, fees and failed transactions — next to what the wallet made, and
 * where the difference went. Size, delay and tolerance are the person's to pick; the figure follows at once from
 * the bars the server read (`/api/wallet-watch/reality`). Then copying on paper, filled by the cron at the price of
 * the moment Ryntra sees each trade. Live copying is a locked line: it opens after a legal review, within the spending
 * limits a person sets — not here, not yet.
 *
 * Nothing here signs, sends or trades.
 */

type RealityRead = Readonly<{
  trades: readonly WalletTrade[];
  paths: Readonly<Record<string, PricePath>>;
  now: Readonly<Record<string, TokenNow>>;
  symbols: Readonly<Record<string, string | null>>;
  solUsd: number | null;
  unmeasured: readonly Readonly<{ mint: string; reason: UnmeasuredReason }>[];
  asOf: number;
}>;
type PaperCopyView = Readonly<{ leader: string; sizeSol: number; slippagePct: number; since: string; summary: PaperSummary; fills: readonly PaperFill[] }>;
type Load = { state: "loading" } | { state: "ready"; data: RealityRead } | { state: "failed" };

const API_HEADERS = { "content-type": "application/json" } as const;
const STEP_WORD: Readonly<Record<RealityStep, RealityWord>> = { delay: "stepDelay", liquidity: "stepLiquidity", slippage: "stepSlippage", fees: "stepFees", failures: "stepFailures" };

const sol = solText;

function percent(value: number | null, locale: string): string {
  if (value === null) return "—";
  const abs = Math.abs(value);
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: abs >= 10 ? 0 : 1 }).format(abs);
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text}${locale.startsWith("uk") ? " %" : "%"}`;
}

function tone(value: number | null): "up" | "down" | undefined {
  return value === null || Math.abs(value) < 1e-9 ? undefined : value > 0 ? "up" : "down";
}

function Choice<T extends number>({ label, values, value, text, onPick, hint }: { label: string; values: readonly T[]; value: T; text: (value: T) => string; onPick: (value: T) => void; hint?: string }) {
  return (
    <div className={styles.choice} role="group" aria-label={label} title={hint}>
      <span className={styles.choiceLabel}>{label}</span>
      <span className={styles.chips}>
        {values.map((option) => (
          <button key={option} type="button" className={styles.chip} aria-pressed={option === value} onClick={() => onPick(option)}>
            {text(option)}
          </button>
        ))}
      </span>
    </div>
  );
}

export function FollowerReality({ wallet, locale, owner, proven, proving, ensureProof }: { wallet: string; locale: WorkspaceLocale; owner: string | null; proven: boolean; proving: boolean; ensureProof: () => Promise<boolean> }) {
  const word = realityWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [settings, setSettings] = useState<CopySettings>(DEFAULT_COPY_SETTINGS);
  /* null — not read yet; "failed" — not read, so «Start» is not offered over a copy that may exist. */
  const [papers, setPapers] = useState<readonly PaperCopyView[] | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchReality = useCallback(
    async (signal?: AbortSignal) => {
      setLoad({ state: "loading" });
      const response = await fetch(`/api/wallet-watch/reality?wallet=${wallet}`, { credentials: "same-origin", signal }).catch(() => null);
      const body = response?.ok ? ((await response.json().catch(() => null)) as RealityRead | null) : null;
      /* Another wallet opened meanwhile: this answer is not its. */
      if (signal?.aborted) return;
      setLoad(body ? { state: "ready", data: body } : { state: "failed" });
    },
    [wallet],
  );

  /* One read in flight per wallet: a new wallet, or «Try again», cancels the one before — its answer is not drawn. */
  const inFlight = useRef<AbortController | null>(null);
  const readReality = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    void fetchReality(controller.signal);
  }, [fetchReality]);

  useEffect(() => {
    readReality();
    return () => inFlight.current?.abort();
  }, [readReality]);

  const loadPapers = useCallback(async () => {
    if (!owner || !proven) {
      setPapers(null);
      return;
    }
    const response = await fetch(`/api/wallet-watch/paper?address=${owner}`, { credentials: "same-origin" }).catch(() => null);
    const body = response?.ok ? ((await response.json().catch(() => null)) as { copies?: PaperCopyView[] } | null) : null;
    setPapers(body?.copies ?? "failed");
  }, [owner, proven]);

  useEffect(() => {
    void loadPapers();
  }, [loadPapers]);

  const reality = useMemo(() => {
    if (load.state !== "ready") return null;
    const data = load.data;
    return followerReality({ trades: data.trades, paths: new Map(Object.entries(data.paths)), now: new Map(Object.entries(data.now)), solUsd: data.solUsd, unmeasured: data.unmeasured, asOf: data.asOf }, settings);
  }, [load, settings]);

  const paper = Array.isArray(papers) ? (papers.find((copy) => copy.leader === wallet) ?? null) : null;

  const changePaper = async (method: "POST" | "DELETE") => {
    if (!owner || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (!(await ensureProof())) return;
      const response =
        method === "POST"
          ? await fetch("/api/wallet-watch/paper", { method, headers: API_HEADERS, credentials: "same-origin", body: JSON.stringify({ address: owner, leader: wallet, sizeSol: settings.sizeSol, slippagePct: settings.slippagePct }) })
          : await fetch(`/api/wallet-watch/paper?address=${owner}&leader=${wallet}`, { method, credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as { copies?: PaperCopyView[]; code?: string } | null;
      if (response.ok && body?.copies) setPapers(body.copies);
      else setNotice(body?.code === "LIMIT" ? word("paperLimit") : word("paperFailed"));
    } catch {
      setNotice(word("paperFailed"));
    } finally {
      setBusy(false);
    }
  };

  const symbolOf = (mint: string) => (load.state === "ready" ? load.data.symbols[mint] : null) ?? shortAddress(mint);
  /* Under two minutes in seconds («96 с»), longer in whole minutes — never «1.73 хв». */
  const delayText = (seconds: number) => (seconds >= 120 || (seconds >= 60 && seconds % 60 === 0) ? word("minutes", { n: Math.round(seconds / 60) }) : word("seconds", { n: Math.round(seconds) }));
  const widths = load.state === "ready" ? [...new Set(Object.values(load.data.paths).map((path) => path.barSeconds))].sort((a, b) => a - b) : [];

  const controls = (
    <div className={styles.choices}>
      <Choice label={word("size")} values={COPY_SIZES} value={settings.sizeSol as (typeof COPY_SIZES)[number]} text={(value) => `${new Intl.NumberFormat(numberLocale).format(value)} SOL`} onPick={(sizeSol) => setSettings((current) => ({ ...current, sizeSol }))} />
      <Choice label={word("delay")} values={COPY_DELAYS} value={settings.delaySeconds as (typeof COPY_DELAYS)[number]} text={delayText} onPick={(delaySeconds) => setSettings((current) => ({ ...current, delaySeconds }))} hint={word("delayHint")} />
      <Choice label={word("slippage")} values={COPY_SLIPPAGES} value={settings.slippagePct as (typeof COPY_SLIPPAGES)[number]} text={(value) => `${value}${lang === "uk" ? " %" : "%"}`} onPick={(slippagePct) => setSettings((current) => ({ ...current, slippagePct }))} />
    </div>
  );

  const tokenColumns: TableColumn<TokenReality>[] = [
    { key: "token", label: word("colToken"), render: (row) => <span className={styles.symbol} translate="no">{symbolOf(row.mint)}</span> },
    { key: "wallet", label: word("colWallet"), numeric: true, render: (row) => <span className={styles.num} data-tone={tone(row.leader.pct)}>{percent(row.leader.pct, numberLocale)}</span> },
    {
      key: "you",
      label: word("colYou"),
      numeric: true,
      render: (row) => (row.follower.copiedBuys === 0 ? <span className={styles.muted}>—</span> : <span className={styles.num} data-tone={tone(row.follower.pct)}>{percent(row.follower.pct, numberLocale)}</span>),
    },
  ];

  return (
    <Block title={word("title")} titleAs="h3" icon="sliders-horizontal" lang={lang} className={styles.reality} data-follower-reality="">
      <p className={styles.realityIntro}>{word("intro")}</p>
      {controls}
      {load.state === "loading" ? (
        <div className={styles.skeleton} aria-label={word("reading")} role="status" />
      ) : load.state === "failed" ? (
        <EmptyState icon="circle-x" role="status" text={word("failed")} action={<Button variant="secondary" onClick={readReality} lang={lang}>{word("retry")}</Button>} />
      ) : !reality || reality.tokens.length === 0 ? (
        <EmptyState icon="circle-help" role="status" text={word("noneMeasured")} />
      ) : (
        <>
          <div className={styles.compare}>
            <div className={styles.compareSide}>
              <span className={styles.choiceLabel}>{word("walletMade")}</span>
              <span className={styles.compareValue} data-tone={tone(reality.ideal.pct)}>{percent(reality.ideal.pct, numberLocale)}</span>
              <span className={styles.sources}>{word("walletOwn", { pct: percent(reality.leader.pct, numberLocale), spent: sol(reality.leader.spentSol, numberLocale) })}</span>
            </div>
            <HeroNumber
              label={word("youKept")}
              value={reality.follower.pct === null ? word("noneCopied") : percent(reality.follower.pct, numberLocale)}
              note={[word("onSize", { spent: sol(reality.follower.spentSol, numberLocale), result: sol(reality.follower.resultSol, numberLocale, true) }), reality.leftOut.tokens > 0 ? word("leftOut", { count: reality.leftOut.tokens, sol: sol(reality.leftOut.buySol, numberLocale) }) : null].filter(Boolean).join(" · ")}
              lang={lang}
            />
          </div>

          <div className={styles.breakdown}>
            <h4 className={styles.breakdownTitle}>{word("breakdown")}</h4>
            <dl className={styles.steps}>
              <div className={styles.step}>
                <dt>{word("stepIdeal")}</dt>
                <dd className={styles.num} data-tone={tone(reality.ideal.resultSol)}>{sol(reality.ideal.resultSol, numberLocale, true)} SOL</dd>
              </div>
              {(Object.keys(STEP_WORD) as RealityStep[]).map((step) => (
                <div key={step} className={styles.step} data-step={step}>
                  <dt>{word(STEP_WORD[step])}</dt>
                  <dd className={styles.num} data-tone={tone(reality.steps[step])}>{Math.abs(reality.steps[step]) < 5e-7 ? "0" : sol(reality.steps[step], numberLocale, true)} SOL</dd>
                </div>
              ))}
              <div className={styles.step} data-total="">
                <dt>{word("stepResult")}</dt>
                <dd className={styles.num} data-tone={tone(reality.follower.resultSol)}>{sol(reality.follower.resultSol, numberLocale, true)} SOL</dd>
              </div>
            </dl>
            <p className={styles.sources}>
              {[
                word("copied", { copied: reality.copiedBuys, buys: reality.buys }),
                reality.missedSlippage > 0 ? word("missedSlippage", { count: reality.missedSlippage, pct: settings.slippagePct }) : null,
                reality.stuckSales > 0 ? word("stuck", { count: reality.stuckSales }) : null,
                reality.fresh > 0 ? word("fresh", { count: reality.fresh }) : null,
                reality.liquidityUnknown > 0 ? word("liquidityUnknown", { count: reality.liquidityUnknown }) : null,
                reality.capped > 0 ? word("capped", { count: reality.capped, size: new Intl.NumberFormat(numberLocale).format(settings.sizeSol) }) : null,
                reality.noPriceNow > 0 ? word("noPriceNow", { count: reality.noPriceNow }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <Table id="reality-tokens" className={styles.table} caption={word("title")} columns={tokenColumns} rows={reality.tokens} rowKey={(row) => row.mint} lang={lang} />
        </>
      )}

      {reality && reality.unmeasured.length > 0 ? (
        <p className={styles.sources}>
          {word("notMeasured")}: {reality.unmeasured.map((row) => `${symbolOf(row.mint)} — ${word(row.reason)}`).join("; ")}
        </p>
      ) : null}
      {reality && reality.tokens.length > 0 ? (
        <p className={styles.sources}>
          {[
            word("assumptions", {
              width: widths.map((seconds) => delayText(seconds)).join(" / ") || delayText(60),
              fee: new Intl.NumberFormat(numberLocale).format(FEE_POLICY_V2.MEME.bps / 100),
              network: new Intl.NumberFormat(numberLocale, { maximumSignificantDigits: 2 }).format(COPY_ASSUMPTIONS.networkFeeSol),
              priority: new Intl.NumberFormat(numberLocale, { maximumSignificantDigits: 2 }).format(COPY_ASSUMPTIONS.priorityFeeSol),
              fail: Math.round(1 / COPY_ASSUMPTIONS.failRate),
              retry: COPY_ASSUMPTIONS.retrySeconds,
            }),
            reality.approx ? word("approx") : null,
            word("estimate"),
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}

      <div className={styles.paper} data-paper="">
        <div className={styles.paperHead}>
          <h4 className={styles.breakdownTitle}>{word("paperTitle")}</h4>
          {paper ? (
            <span className={styles.paperActions}>
              {paper.sizeSol !== settings.sizeSol || paper.slippagePct !== settings.slippagePct ? <Button variant="secondary" onClick={() => void changePaper("POST")} disabled={busy} lang={lang}>{word("paperSave")}</Button> : null}
              <Button variant="ghost" onClick={() => void changePaper("DELETE")} disabled={busy} lang={lang}>{word("paperStop")}</Button>
            </span>
          ) : null}
        </div>
        {!owner ? (
          <EmptyState icon="wallet" text={word("paperConnect")} action={<ConnectWalletButton variant="secondary" />} />
        ) : proven && papers === null ? (
          <div className={styles.skeleton} />
        ) : papers === "failed" ? (
          <EmptyState icon="circle-x" role="status" text={word("paperUnread")} action={<Button variant="secondary" onClick={() => void loadPapers()} lang={lang}>{word("retry")}</Button>} />
        ) : paper ? (
          <PaperView paper={paper} word={word} numberLocale={numberLocale} symbolOf={symbolOf} delayText={delayText} />
        ) : (
          <div className={styles.paperStart}>
            <p className={styles.realityIntro}>{word("paperNote")}</p>
            {/* Not confirmed yet: the press asks the wallet to confirm first, then starts. */}
            <Button variant="primary" onClick={() => void changePaper("POST")} loading={busy || proving} lang={lang} title={proven ? undefined : word("paperProve")}>{word("paperStart")}</Button>
          </div>
        )}
        {notice ? <p className={styles.hint} role="status" data-error="">{notice}</p> : null}
      </div>

      <div className={styles.live} data-live-copy="locked">
        <span className={styles.liveTitle}>{word("liveTitle")}</span>
        <p className={styles.realityIntro}>{word("liveLocked")}</p>
      </div>
    </Block>
  );
}

function PaperView({ paper, word, numberLocale, symbolOf, delayText }: { paper: PaperCopyView; word: ReturnType<typeof realityWords>; numberLocale: string; symbolOf: (mint: string) => string; delayText: (seconds: number) => string }) {
  const summary = paper.summary;
  const since = new Date(paper.since).toLocaleDateString(numberLocale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const late = (fill: PaperFill) => delayText(Math.max(0, fill.at - fill.leaderAt));
  return (
    <div className={styles.paperBody}>
      <p className={styles.sources}>{word("paperSince", { date: since, size: new Intl.NumberFormat(numberLocale).format(paper.sizeSol), pct: paper.slippagePct })}</p>
      {paper.fills.length === 0 ? (
        <p className={styles.realityIntro}>{word("paperEmpty")}</p>
      ) : (
        <>
          <div className={styles.compareSide}>
            <span className={styles.choiceLabel}>{word("paperResult")}</span>
            <span className={styles.compareValue} data-tone={tone(summary.resultSol)}>
              {summary.resultSol === null ? "—" : `${sol(summary.resultSol, numberLocale, true)} SOL`}
              {summary.pct !== null ? <span className={styles.muted}> · {percent(summary.pct, numberLocale)}</span> : null}
            </span>
            <span className={styles.sources}>
              {word("paperIn", { spent: sol(summary.spentSol, numberLocale), fees: sol(summary.feesSol, numberLocale), filled: summary.filled, missed: summary.missed })}
              {summary.heldSol === null ? ` · ${word("paperNoSol")}` : summary.unpriced > 0 ? ` · ${word("paperNoPrice", { count: summary.unpriced })}` : ""}
            </span>
          </div>
          <ul className={styles.fills}>
            {paper.fills.map((fill) => (
              <li key={fill.key} className={styles.fill}>
                <span className={styles.side} data-side={fill.missed ? undefined : fill.side}>
                  {fill.missed ? word(`missed_${fill.missed}` as RealityWord) : word(fill.side === "buy" ? "paperBought" : "paperSold", { symbol: fill.symbol ?? symbolOf(fill.mint) })}
                </span>
                <span className={styles.muted}>{fill.missed ? (fill.symbol ?? symbolOf(fill.mint)) : word("paperLate", { delay: late(fill) })}</span>
                <span className={styles.num}>{fill.missed ? "—" : `${fill.side === "buy" ? "−" : "+"}${sol(fill.sol, numberLocale)} SOL`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
