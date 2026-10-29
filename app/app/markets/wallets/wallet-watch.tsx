"use client";

import { ArrowSquareOut, Copy } from "@phosphor-icons/react";
import { Block, Button, EmptyState, HeroNumber, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { TokenView, TradeView, WalletView } from "@/lib/wallet-watch/read";
import { FOLLOW_LIMIT, type AlertMode, type WalletFollow } from "@/lib/wallet-watch/store";
import { quoteText, shortAddress, tokenAmountText } from "@/lib/wallet-watch/notes";
import type { WalletLabel } from "@/lib/wallet-watch/trades";

import { HonestPnlPanel } from "@/app/shell/honest-pnl";
import { FollowerReality } from "./follower-reality";
import { walletWords, type WalletWord } from "./wallet-words";
import { solText } from "./sol-text";
import styles from "./wallet-watch.module.css";

/**
 * «Ринки» → «Гаманці» (SOL-R4, Smart Wallet Watch): paste a wallet's address — or a token's, for its creator — and see
 * the wallet's trades and what it made or lost, read from the chain, with the labels it earned (creator, sniper,
 * bundle); follow it, and Ryntra tells you of its trades through the assistant's engine — the inbox, Telegram and
 * push as Нагляд is set. On a token it holds, one press starts the assistant's «liquidity −30 %» watch.
 *
 * Read-only: nothing here buys or sells, and no follow trades — a token opens its own page, where the wallet signs
 * or nothing happens. Under the wallet, before any copying (SOL-R3): what a follower would have kept of its trades,
 * and copying it on paper (`follower-reality.tsx`).
 */

type FollowRow = WalletFollow & Readonly<{ lastTrade: Readonly<{ side: "buy" | "sell"; mint: string; symbol?: string | null; at: number | null }> | null; trades24h: number | null; readAt: string | null }>;
type Lookup = Readonly<{ token: Readonly<{ mint: string; symbol: string; creator: string | null }> | null; view: WalletView | null }>;
type Load = { state: "idle" } | { state: "loading"; q: string } | { state: "ready"; q: string; data: Lookup } | { state: "failed"; q: string; word: WalletWord };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POLL_MS = 30_000;
const LABEL_WORD: Readonly<Record<WalletLabel, WalletWord>> = { creator: "creator", sniper: "sniper", bundle: "bundle" };
const LABEL_NOTE: Readonly<Record<WalletLabel, WalletWord>> = { creator: "creatorNote", sniper: "sniperNote", bundle: "bundleNote" };
const ALERT_WORD: Readonly<Record<AlertMode, WalletWord>> = { all: "alertsAll", sells: "alertsSells", off: "alertsOff" };
const API_HEADERS = { "content-type": "application/json" } as const;
const PHONE = "(max-width: 600px)";
const ASSISTANT_HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

function explorer(kind: "tx" | "address", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}`;
}

const sol = solText;

function usd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2 }).format(value);
}

function ago(at: number | null, locale: string, nowMs: number): string {
  if (at === null) return "—";
  const seconds = Math.round(at - nowMs / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3_600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3_600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
}

/** A phone's width: the tables keep the columns that answer «what, and how much» — the rest is a desk's. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const read = () => setNarrow(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return narrow;
}

function Labels({ labels, word }: { labels: readonly WalletLabel[]; word: ReturnType<typeof walletWords> }) {
  if (labels.length === 0) return null;
  return (
    <span className={styles.labels}>
      {labels.map((label) => (
        <span key={label} className={styles.label} data-label={label} title={word(LABEL_NOTE[label])}>
          {word(LABEL_WORD[label])}
        </span>
      ))}
    </span>
  );
}

export function WalletWatch({ locale }: { locale: WorkspaceLocale }) {
  const word = walletWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const proof = useWalletProof();
  const proven = proof.state.status === "proven" && proof.state.address === owner;

  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<WalletWord | null>(null);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [follows, setFollows] = useState<readonly FollowRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const detailRef = useRef<HTMLDivElement | null>(null);

  /* The wallet the address bar names (a note's link) opens on arrival. */
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("wallet");
    if (asked && BASE58.test(asked)) {
      setInput(asked);
      void open(asked, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFollows = useCallback(async () => {
    if (!owner || !proven) {
      setFollows(null);
      return;
    }
    const response = await fetch(`/api/wallet-watch?address=${owner}`, { credentials: "same-origin" }).catch(() => null);
    const body = response?.ok ? ((await response.json()) as { wallets?: FollowRow[] }) : null;
    setFollows(body?.wallets ?? []);
  }, [owner, proven]);

  useEffect(() => {
    void loadFollows();
  }, [loadFollows]);

  const read = useCallback(async (q: string): Promise<Lookup | WalletWord> => {
    const response = await fetch(`/api/wallet-watch/wallet?q=${encodeURIComponent(q)}`, { credentials: "same-origin" }).catch(() => null);
    if (!response) return "chainDown";
    if (response.status === 429) return "rateLimited";
    if (response.status === 400) return "notAddress";
    if (!response.ok) return "chainDown";
    return (await response.json()) as Lookup;
  }, []);

  const open = useCallback(
    async (q: string, scroll = true) => {
      setInputError(null);
      setNotice(null);
      setLoad({ state: "loading", q });
      const data = await read(q);
      setLoad(typeof data === "string" ? { state: "failed", q, word: data } : { state: "ready", q, data });
      setNowMs(Date.now());
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "wallets");
      url.searchParams.set("wallet", q);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      if (scroll) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    },
    [read],
  );

  /* The open wallet, read again while the page is in view — only what is new is asked of the chain. */
  useEffect(() => {
    if (load.state !== "ready") return;
    const q = load.q;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void read(q).then((data) => {
        if (typeof data !== "string") setLoad((current) => (current.state === "ready" && current.q === q ? { state: "ready", q, data } : current));
        setNowMs(Date.now());
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, read]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = input.trim();
    if (!BASE58.test(q)) {
      setInputError("notAddress");
      return;
    }
    void open(q);
  };

  const ensureProof = async () => (proven ? true : await proof.prove());

  const change = async (method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) => {
    if (!owner || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (!(await ensureProof())) return;
      const url = method === "DELETE" ? `/api/wallet-watch?address=${owner}&wallet=${payload.wallet as string}&locale=${lang}` : "/api/wallet-watch";
      const response = await fetch(url, { method, headers: API_HEADERS, credentials: "same-origin", body: method === "DELETE" ? undefined : JSON.stringify({ address: owner, locale: lang, ...payload }) });
      const body = (await response.json().catch(() => null)) as { wallets?: FollowRow[]; code?: string; symbol?: string } | null;
      if (response.ok && body?.wallets) setFollows(body.wallets);
      else setNotice(body?.code === "LIMIT" ? word("limit") : body?.code === "NO_CREATOR" ? word("noCreator", { symbol: body.symbol ?? "" }) : word("failed"));
    } catch {
      setNotice(word("failed"));
    } finally {
      setBusy(false);
    }
  };

  const view = load.state === "ready" ? load.data.view : null;
  const token = load.state === "ready" ? load.data.token : null;
  const followed = view ? (follows?.find((row) => row.address === view.wallet) ?? null) : null;

  return (
    <section className={styles.watch} aria-label={word("title")} data-wallet-watch="">
      {/* Before the page is live a press still lands here: the browser's own submit opens `?tab=wallets&wallet=…`, which the page opens on arrival. */}
      <form className={styles.lookup} onSubmit={submit} role="search" method="get">
        <input type="hidden" name="tab" value="wallets" />
        <label className={styles.field}>
          <span className={styles.srOnly}>{word("lookup")}</span>
          <input
            name="wallet"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setInputError(null);
            }}
            placeholder={word("lookup")}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputError ? true : undefined}
            aria-describedby="wallet-lookup-hint"
            translate="no"
          />
        </label>
        <Button type="submit" variant="secondary" icon="search" lang={lang} loading={load.state === "loading"}>
          {word("show")}
        </Button>
        <p id="wallet-lookup-hint" className={styles.hint} data-error={inputError ? "" : undefined} role={inputError ? "alert" : undefined}>
          {inputError ? word(inputError) : word("lookupHint")}
        </p>
      </form>

      <div className={styles.columns}>
        <FollowList word={word} lang={lang} numberLocale={numberLocale} owner={owner} proven={proven} follows={follows} active={view?.wallet ?? null} nowMs={nowMs} onOpen={(address) => void open(address)} onProve={() => void proof.prove()} proving={proof.state.status === "signing"} />

        <div className={styles.detail} ref={detailRef}>
          {load.state === "idle" ? null : load.state === "loading" ? (
            <Block title={shortAddress(load.q)} titleAs="h2" icon="wallet" loading lang={lang}>
              <div className={styles.skeleton} />
            </Block>
          ) : load.state === "failed" ? (
            <EmptyState icon="circle-x" role="status" text={word(load.word)} action={<Button variant="secondary" onClick={() => void open(load.q, false)} lang={lang}>{word("reload")}</Button>} />
          ) : !view ? (
            <EmptyState icon="circle-help" role="status" text={token ? word("noCreator", { symbol: token.symbol }) : word("chainDown")} />
          ) : (
            <WalletDetail
              key={view.wallet}
              view={view}
              token={token}
              follow={followed}
              word={word}
              lang={lang}
              numberLocale={numberLocale}
              nowMs={nowMs}
              owner={owner}
              proven={proven}
              proving={proof.state.status === "signing"}
              busy={busy}
              notice={notice}
              onFollow={(name) => void change("POST", { target: token?.mint ?? view.wallet, name: name || null })}
              onAlerts={(alerts) => void change("PATCH", { wallet: view.wallet, alerts })}
              onRename={(name) => void change("PATCH", { wallet: view.wallet, name: name || null })}
              onUnfollow={() => void change("DELETE", { wallet: view.wallet })}
              ensureProof={ensureProof}
            />
          )}
        </div>
      </div>
      <p className={styles.readOnly}>{word("readOnly")}</p>
    </section>
  );
}

function FollowList({
  word,
  lang,
  numberLocale,
  owner,
  proven,
  follows,
  active,
  nowMs,
  onOpen,
  onProve,
  proving,
}: {
  word: ReturnType<typeof walletWords>;
  lang: "en" | "uk";
  numberLocale: string;
  owner: string | null;
  proven: boolean;
  follows: readonly FollowRow[] | null;
  active: string | null;
  nowMs: number;
  onOpen: (address: string) => void;
  onProve: () => void;
  proving: boolean;
}) {
  const count = follows?.length ?? 0;
  return (
    <Block
      title={word("following")}
      titleAs="h2"
      icon="target"
      lang={lang}
      className={styles.list}
      action={follows ? <span className={styles.count}>{word("followingCount", { count, limit: FOLLOW_LIMIT })}</span> : undefined}
    >
      {!owner ? (
        <EmptyState icon="wallet" text={word("connectToFollow")} action={<ConnectWalletButton variant="secondary" />} />
      ) : !proven ? (
        <EmptyState icon="wallet" text={word("proveToFollow")} action={<Button variant="secondary" onClick={onProve} loading={proving} lang={lang}>{word("prove")}</Button>} />
      ) : follows === null ? (
        <div className={styles.skeleton} />
      ) : follows.length === 0 ? (
        <EmptyState icon="target" role="status" text={word("emptyFollows")} />
      ) : (
        <ul className={styles.follows}>
          {follows.map((row) => (
            <li key={row.address}>
              <button type="button" className={styles.followRow} aria-current={row.address === active ? "true" : undefined} onClick={() => onOpen(row.address)}>
                <span className={styles.followName}>
                  <span className={row.name ? undefined : styles.mono} translate="no">
                    {row.name ?? shortAddress(row.address)}
                  </span>
                  {row.via ? <span className={styles.via}>{word("creatorOf", { symbol: row.via.symbol })}</span> : null}
                </span>
                <span className={styles.followMeta}>
                  {row.lastTrade ? word("lastTrade", { side: word(row.lastTrade.side === "buy" ? "buy" : "sell"), symbol: row.lastTrade.symbol ?? shortAddress(row.lastTrade.mint), ago: ago(row.lastTrade.at, numberLocale, nowMs) }) : word("noTradeYet")}
                </span>
                <span className={styles.followAlerts} data-alerts={row.alerts}>
                  {word(ALERT_WORD[row.alerts])}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function WalletDetail({
  view,
  token,
  follow,
  word,
  lang,
  numberLocale,
  nowMs,
  owner,
  proven,
  proving,
  busy,
  notice,
  onFollow,
  onAlerts,
  onRename,
  onUnfollow,
  ensureProof,
}: {
  view: WalletView;
  token: Lookup["token"];
  follow: FollowRow | null;
  word: ReturnType<typeof walletWords>;
  lang: "en" | "uk";
  numberLocale: string;
  nowMs: number;
  owner: string | null;
  proven: boolean;
  proving: boolean;
  busy: boolean;
  notice: string | null;
  onFollow: (name: string) => void;
  onAlerts: (alerts: AlertMode) => void;
  onRename: (name: string) => void;
  onUnfollow: () => void;
  ensureProof: () => Promise<boolean>;
}) {
  const [name, setName] = useState(follow?.name ?? "");
  const [copied, setCopied] = useState(false);
  const [watched, setWatched] = useState<Readonly<Record<string, "busy" | "on" | "full" | "failed">>>({});
  const narrow = useNarrow();
  useEffect(() => setName(follow?.name ?? ""), [follow?.name]);

  /* The result by the honest standard (DSC-2): after fees, what is held at its exit price — null when not known enough, never 0. */
  const whole = view.honest.pnl.whole;
  const total = whole.result;
  const assets = new Map(view.honest.pnl.assets.map((row) => [row.asset, row]));
  const badges = (Object.entries(view.badges) as [WalletLabel, number][]).filter(([, count]) => count > 0);
  const readTime = view.readAt ? new Date(view.readAt).toLocaleTimeString(numberLocale, { hour: "2-digit", minute: "2-digit" }) : null;
  const since = view.oldestAt ? new Date(view.oldestAt * 1000).toLocaleDateString(numberLocale, { day: "numeric", month: "short" }) : null;

  /* The assistant's own watch on a token this wallet holds: liquidity −30 % in an hour — its preset, its three free. */
  const watchLiquidity = async (mint: string) => {
    setWatched((current) => ({ ...current, [mint]: "busy" }));
    if (!(await ensureProof())) {
      setWatched((current) => ({ ...current, [mint]: "failed" }));
      return;
    }
    const response = await fetch(`/api/v1/assistant/watches?locale=${lang}`, { method: "POST", headers: ASSISTANT_HEADERS, credentials: "same-origin", body: JSON.stringify({ mint, preset: "liquidityDrop", locale: lang }) }).catch(() => null);
    const body = response ? ((await response.json().catch(() => null)) as { error?: { code?: string } } | null) : null;
    setWatched((current) => ({ ...current, [mint]: response?.ok ? "on" : body?.error?.code === "WATCH_LIMIT_REACHED" ? "full" : "failed" }));
  };

  /* What the wallet still holds of a token, and the assistant's liquidity watch on it — one piece, a column on a desk, a line under the token on a phone. */
  const heldOf = (row: TokenView) => {
    const state = watched[row.mint];
    /* What it holds is read from the chain; not read — a dash, never the estimate from its trades. */
    const held = row.heldNow;
    return (
      <span className={styles.heldCell}>
        <span className={styles.num}>
          {narrow ? `${word("colHeld")} ` : ""}
          {held === null ? "—" : held > 0 ? new Intl.NumberFormat(numberLocale, { notation: "compact", maximumFractionDigits: 1 }).format(held) : "0"}
        </span>
        {(held ?? row.open) > 0 && owner ? (
          state === "on" ? (
            <Link className={styles.watchOn} href="/app/ryn?watch=all" prefetch={false}>{word("watching")}</Link>
          ) : (
            <button type="button" className={styles.watchButton} title={state === "full" ? word("watchFull") : word("watchLiquidityNote")} disabled={state === "busy"} data-state={state} onClick={() => void watchLiquidity(row.mint)}>
              {state === "full" ? word("watchFull") : word(narrow ? "watchLiquidityShort" : "watchLiquidity")}
            </button>
          )
        ) : null}
      </span>
    );
  };
  const tokenColumns: TableColumn<TokenView>[] = [
    {
      key: "token",
      label: word("colToken"),
      render: (row) => (
        <span className={styles.tradeCell}>
          <Link className={styles.asset} href={`/app/spot?mint=${encodeURIComponent(row.mint)}`} prefetch={false}>
            <MarketIcon mint={row.mint} symbol={row.symbol ?? "?"} icon={row.icon} size={24} />
            <span className={styles.assetText}>
              <span className={styles.symbol} translate="no">{row.symbol ?? shortAddress(row.mint)}</span>
              <Labels labels={row.labels} word={word} />
            </span>
          </Link>
          {narrow ? heldOf(row) : null}
        </span>
      ),
    },
    ...(narrow ? [] : [{ key: "trades", label: word("colTrades"), numeric: true, render: (row: TokenView) => <span className={styles.num}>{row.buys} / {row.sells}</span> }]),
    {
      key: "result",
      label: word("colResult"),
      numeric: true,
      sortable: true,
      sortValue: (row) => assets.get(row.mint)?.result ?? Number.NEGATIVE_INFINITY,
      render: (row) => {
        /* A token's result by the standard; a part not known shows what is known, without a colour and with «*» — never a plus. */
        const honest = assets.get(row.mint);
        if (!honest) return <span className={styles.muted}>—</span>;
        if (honest.result !== null) return <span className={styles.num} data-tone={honest.result > 0 ? "up" : honest.result < 0 ? "down" : undefined}>{sol(honest.result, numberLocale, true)}</span>;
        /* Either half not known (a holding not valued, a sale of unknown cost): no figure at all — a «0» would read as a result. */
        const known = honest.realized === null || honest.unrealized === null ? null : honest.realized + honest.unrealized;
        return <span className={styles.muted} title={word("partial")}>{known === null ? "—" : `${sol(known, numberLocale, true)}*`}</span>;
      },
    },
    ...(narrow ? [] : [{ key: "held", label: word("colHeld"), numeric: true, render: heldOf }]),
  ];

  const sideWord = (row: TradeView) => word(row.side === "sell" ? "sell" : row.paidBy ? "got" : "buy");
  const txColumn: TableColumn<TradeView> = {
    key: "tx",
    label: <span className={styles.srOnly}>{word("tx")}</span>,
    render: (row) => (
      <a className={styles.txLink} href={explorer("tx", row.signature)} target="_blank" rel="noreferrer" aria-label={`${word("tx")} ${row.signature.slice(0, 8)}`}>
        <ArrowSquareOut size={15} aria-hidden="true" />
      </a>
    ),
  };
  const paidColumn: TableColumn<TradeView> = { key: "paid", label: word("colPaid"), numeric: true, render: (row) => <span className={styles.num}>{quoteText(row, lang) ?? "—"}</span> };
  /* A phone: the trade, its token and its time in one cell; what it was for; the transaction. */
  const tradeColumns: TableColumn<TradeView>[] = narrow
    ? [
        {
          key: "trade",
          label: word("colSide"),
          render: (row) => (
            <span className={styles.tradeCell}>
              <span className={styles.assetText}>
                <span className={styles.side} data-side={row.side}>{sideWord(row)}</span>
                <span className={styles.symbol} translate="no">{row.symbol ?? shortAddress(row.mint)}</span>
                <Labels labels={row.labels} word={word} />
              </span>
              <span className={styles.muted}>{ago(row.at, numberLocale, nowMs)} · {tokenAmountText(row, lang)}</span>
            </span>
          ),
        },
        paidColumn,
        txColumn,
      ]
    : [
        { key: "time", label: word("colTime"), render: (row) => <span className={styles.muted}>{ago(row.at, numberLocale, nowMs)}</span> },
        {
          key: "side",
          label: word("colSide"),
          render: (row) => (
            <span className={styles.side} data-side={row.side}>
              {sideWord(row)}
              {row.paidBy ? <span className={styles.muted}> · {word("paidBy", { who: shortAddress(row.paidBy) })}</span> : null}
            </span>
          ),
        },
        {
          key: "token",
          label: word("colToken"),
          render: (row) => (
            <span className={styles.assetText}>
              <span className={styles.symbol} translate="no">{row.symbol ?? shortAddress(row.mint)}</span>
              <Labels labels={row.labels} word={word} />
            </span>
          ),
        },
        { key: "amount", label: word("colAmount"), numeric: true, render: (row) => <span className={styles.num}>{tokenAmountText(row, lang)}</span> },
        paidColumn,
        txColumn,
      ];

  const resultValue = total === null ? (whole.verdict === "EMPTY" ? word("noResult") : word("unknownResult")) : `${sol(total, numberLocale, true)}`;
  const resultUsd = total !== null && view.solUsd ? usd(total * view.solUsd, numberLocale) : null;

  return (
    <div className={styles.detailInner}>
      <Block
        title={
          <span className={styles.walletTitle}>
            <span className={follow?.name ? undefined : styles.mono} translate="no">{follow?.name ?? shortAddress(view.wallet)}</span>
            {token ? <span className={styles.via}>{word("creatorOf", { symbol: token.symbol })}</span> : null}
          </span>
        }
        titleAs="h2"
        icon="wallet"
        lang={lang}
      >
        <div className={styles.summary}>
          <HeroNumber
            label={word("result")}
            value={resultValue}
            currency={total === null ? undefined : "SOL"}
            change={total === null || total === 0 || !resultUsd ? undefined : { value: `≈ ${resultUsd}`, direction: total > 0 ? "up" : "down" }}
            note={whole.completenessPct !== null ? word("afterFees", { pct: new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(whole.completenessPct) }) : undefined}
            lang={lang}
          />
          <div className={styles.summarySide}>
            {badges.length > 0 ? (
              <div className={styles.badges}>
                {badges.map(([label, count]) => (
                  <span key={label} className={styles.label} data-label={label} title={word(LABEL_NOTE[label])}>
                    {word(LABEL_WORD[label])} ×{count}
                  </span>
                ))}
              </div>
            ) : null}
            <span className={styles.titleActions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={copied ? word("copied") : word("copy")}
                title={copied ? word("copied") : word("copy")}
                onClick={() => {
                  void navigator.clipboard?.writeText(view.wallet).then(() => setCopied(true)).catch(() => undefined);
                }}
              >
                <Copy size={16} aria-hidden="true" />
              </button>
              <a className={styles.iconButton} href={explorer("address", view.wallet)} target="_blank" rel="noreferrer" aria-label={word("explorer")} title={word("explorer")}>
                <ArrowSquareOut size={16} aria-hidden="true" />
              </a>
            </span>
          </div>
        </div>

        <div className={styles.followBar}>
          {follow ? (
            <>
              <label className={styles.select}>
                <span>{word("alerts")}</span>
                <select value={follow.alerts} disabled={busy} onChange={(event) => onAlerts(event.target.value as AlertMode)}>
                  {(["all", "sells", "off"] as const).map((mode) => (
                    <option key={mode} value={mode}>{word(ALERT_WORD[mode])}</option>
                  ))}
                </select>
              </label>
              <form
                className={styles.rename}
                onSubmit={(event) => {
                  event.preventDefault();
                  onRename(name.trim());
                }}
              >
                <label className={styles.field}>
                  <span className={styles.srOnly}>{word("name")}</span>
                  <input value={name} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder={word("namePlaceholder")} />
                </label>
                {name.trim() !== (follow.name ?? "") ? <Button type="submit" variant="secondary" disabled={busy} lang={lang}>{word("save")}</Button> : null}
              </form>
              <Button variant="ghost" onClick={onUnfollow} disabled={busy} lang={lang}>{word("unfollow")}</Button>
            </>
          ) : owner ? (
            <form
              className={styles.rename}
              onSubmit={(event) => {
                event.preventDefault();
                onFollow(name.trim());
              }}
            >
              <label className={styles.field}>
                <span className={styles.srOnly}>{word("name")}</span>
                <input value={name} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder={word("namePlaceholder")} />
              </label>
              <Button type="submit" variant="primary" icon="plus" loading={busy} lang={lang}>{word("follow")}</Button>
            </form>
          ) : (
            <ConnectWalletButton />
          )}
          {notice || owner ? <p className={styles.hint} role={notice ? "status" : undefined}>{notice ?? word("alertsWhere")}</p> : null}
        </div>
      </Block>

      <Block title={word("honest")} titleAs="h3" icon="percent" lang={lang}>
        <HonestPnlPanel
          pnl={view.honest.pnl}
          lang={lang}
          numberLocale={numberLocale}
          format={(value, signed) => `${sol(value, numberLocale, signed)} SOL`}
          head={false}
          notes={[
            word("honestExit"),
            word("honestFollower"),
            view.honest.approx ? word("approx") : null,
            view.honest.feesEstimated ? word("feesEstimated") : null,
            view.complete ? word("windowAll", { count: view.scanned }) : since ? word("window", { count: view.scanned, date: since }) : null,
          ].filter((note): note is string => note !== null)}
        />
      </Block>

      <FollowerReality wallet={view.wallet} locale={lang} owner={owner} proven={proven} proving={proving} ensureProof={ensureProof} />

      <Block title={word("tokens")} titleAs="h3" icon="chart-pie" lang={lang} className={styles.tableBlock}>
        {view.tokens.length === 0 ? (
          <EmptyState icon="search" role="status" text={word("noTrades")} />
        ) : (
          <Table id="wallet-tokens" className={styles.table} caption={word("tokens")} columns={tokenColumns} rows={view.tokens} rowKey={(row) => row.mint} lang={lang} />
        )}
      </Block>

      <Block title={word("trades")} titleAs="h3" icon="activity" lang={lang} className={styles.tableBlock}>
        {view.trades.length === 0 ? (
          <EmptyState icon="search" role="status" text={word("noTrades")} />
        ) : (
          <Table id="wallet-trades" className={styles.table} caption={word("trades")} columns={tradeColumns} rows={view.trades} rowKey={(row) => `${row.signature}:${row.mint}:${row.side}`} lang={lang} />
        )}
      </Block>

      <p className={styles.sources}>
        {[
          view.complete ? word("windowAll", { count: view.scanned }) : since ? word("window", { count: view.scanned, date: since }) : null,
          readTime ? word("readAt", { time: readTime }) : null,
          view.pnl.partial ? `* ${word("partial")}` : null,
          view.pnl.approx ? word("approx") : null,
          view.skipped > 0 ? word("skipped", { count: view.skipped }) : null,
          view.gap ? word("gap") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

