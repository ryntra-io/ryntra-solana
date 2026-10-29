"use client";

import { ArrowRight, CaretDown, Check, Copy } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { LiquidityBadgeState, LiquidityView } from "@/lib/growth/liquidity";
import type { PartnerMarketRow, PartnerPageView } from "@/lib/growth/partner-page";
import type { TrackBadgeState } from "@/lib/growth/partner-tracks";
import { dollars, usdText } from "@/lib/rewards/format";
import type { PaidAs } from "@/lib/rewards/programme-facts";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletGate } from "../wallet-gate.tsx";
import { tilt, TrackBadge } from "./badge.tsx";
import lg from "./leagues.module.css";
import { partnerCopy, type FunnelStep } from "./partner-copy.ts";
import { PaidAsChip } from "./programme-card.tsx";
import { programmeCopy } from "./programme-copy.ts";
import { SignInGate } from "./sign-in-gate.tsx";
import { useRewardsWallet } from "./use-rewards-wallet.tsx";
import styles from "./partners.module.css";
import rw from "./rewards.module.css";

/**
 * «Creator partners» on Rewards — the partner's own page.
 *
 * At rest: the card (level, code and link, activated creators, the money by
 * state and the share now), the funnel from the link to revenue, one row per
 * market the partner is named on, and the Network's badges. The rules sit
 * behind one disclosure; the terms and the media kit are a link away. One
 * orange action: copying the link.
 *
 * Everything is the server's figure for this proven wallet: a share counted
 * from the fee Ryntra received, a date, a count. A pool the review holds says
 * «Under review» and nothing more; its partner may ask the reviewer a
 * question. «Paid» is the sum of the partner's receipts; once the canary has
 * opened payouts, «Get $X» takes what is available to the proven wallet — the
 * one orange action then, with copying the link beside it.
 *
 * Liquidity badges come from their own read (`/api/growth/liquidity`): the
 * wallet's Meteora positions on Solana, read when the page opens. They are
 * the wallet's own until it turns on the one switch that shows its highest
 * liquidity badge on the boards; off by default.
 */

type Loaded = Readonly<{ key: string; page: PartnerPageView }>;

export function usePartnerPage() {
  /* The wallet the sign-in proved (Ріст 18): the partner page opens without a second step. */
  const wallet = useRewardsWallet();
  const { refused, served } = wallet;
  const address = wallet.address;
  const proven = wallet.open;
  const key = proven && address ? address : "";
  const currentKey = useRef(key);
  currentKey.current = key;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const asked = key;
    if (!asked) return;
    setFailed(null);
    try {
      const read = () => fetch(`/api/growth/partner/network?address=${encodeURIComponent(asked)}`);
      let response = await read();
      if (currentKey.current !== asked) return;
      if (response.status === 401) {
        /* Not taken on its own word: the sign-in is asked again first, and a proof that still stands reads once more. */
        let verdict = await refused(asked);
        if (currentKey.current !== asked) return;
        if (verdict === "retry") {
          response = await read();
          if (currentKey.current !== asked) return;
          if (response.status === 401) verdict = await refused(asked);
        }
        /* Gone or refused: the gate follows the sign-in. Anything else is «unavailable», never «loading» for ever. */
        if (response.status === 401 && (verdict === "gone" || verdict === "refused")) return;
      }
      if (!response.ok) throw new Error("unavailable");
      const body = (await response.json()) as { ok: boolean; page?: PartnerPageView };
      if (currentKey.current !== asked) return;
      if (!body.ok || !body.page) throw new Error("unavailable");
      served(asked);
      setLoaded({ key: asked, page: body.page });
    } catch {
      if (currentKey.current === asked) setFailed(asked);
    }
  }, [key, refused, served]);

  useEffect(() => {
    void load();
  }, [load]);

  return { page: loaded?.key === key && key ? loaded.page : null, failed: failed === key && key !== "", load, address, proven, wallet };
}

type Refused = ReturnType<typeof useRewardsWallet>["refused"];

type LiquidityState = Readonly<{
  view: LiquidityView | null;
  failed: boolean;
  saving: boolean;
  saveFailed: boolean;
  toggle: () => void;
}>;

/**
 * The wallet's liquidity badges and its choice about the boards — read once the wallet is proven. A refused read asks
 * the sign-in again without counting a strike (the partner read beside it counts) and, the proof standing, reads once
 * more; the gate follows the answer.
 */
function useLiquidity(address: string | null, proven: boolean, refused: Refused): LiquidityState {
  const key = proven && address ? address : "";
  const currentKey = useRef(key);
  currentKey.current = key;
  const [loaded, setLoaded] = useState<Readonly<{ key: string; view: LiquidityView }> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const asked = key;
    if (!asked) return;
    setFailed(null);
    void (async () => {
      try {
        const read = () => fetch(`/api/growth/liquidity?address=${encodeURIComponent(asked)}`);
        let response = await read();
        if (currentKey.current !== asked) return;
        if (response.status === 401) {
          /* The proof still standing: read once more, as the partner read beside it does. */
          const verdict = await refused(asked, { count: false });
          if (currentKey.current !== asked || verdict === "gone") return;
          response = await read();
          if (currentKey.current !== asked) return;
        }
        const body = response.ok ? ((await response.json()) as { ok: boolean; liquidity?: LiquidityView }) : null;
        if (currentKey.current !== asked) return;
        if (!body?.ok || !body.liquidity) throw new Error("unavailable");
        setLoaded({ key: asked, view: body.liquidity });
      } catch {
        if (currentKey.current === asked) setFailed(asked);
      }
    })();
  }, [key, refused]);

  const view = loaded?.key === key && key ? loaded.view : null;
  const toggle = useCallback(() => {
    const asked = key;
    if (!asked || !view || saving) return;
    const shown = !view.public;
    setSaving(true);
    setSaveFailed(false);
    void (async () => {
      try {
        const response = await fetch("/api/growth/liquidity/visibility", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: asked, shown }),
        });
        /* A sign-in that ended: the page offers the sign-in again. */
        if (response.status === 401) void refused(asked);
        const body = response.ok ? ((await response.json()) as { ok: boolean; shown?: boolean }) : null;
        if (currentKey.current !== asked) return;
        if (!body?.ok || typeof body.shown !== "boolean") throw new Error("unsaved");
        const saved = body.shown;
        setLoaded((current) => (current && current.key === asked ? { key: asked, view: { ...current.view, public: saved } } : current));
      } catch {
        if (currentKey.current === asked) setSaveFailed(true);
      } finally {
        setSaving(false);
      }
    })();
  }, [key, view, saving, refused]);

  return { view, failed: failed === key && key !== "", saving, saveFailed, toggle };
}

/** The three liquidity badges before the read answers: drawn as the way up, counting nothing. */
const LIQUIDITY_UNREAD: readonly LiquidityBadgeState[] = [
  { id: "POOL_CONTRIBUTOR", earned: false, at: null, have: 0, need: 1 },
  { id: "STEWARD", earned: false, at: null, have: 0, need: 0 },
  { id: "STRATEGIST", earned: false, at: null, have: 0, need: 0 },
];

const money = (micros: string) => dollars(usdText(BigInt(micros)));
const percent = (bps: number) => `${bps / 100}%`;

function useDay() {
  const { locale } = useSolanaI18n();
  const intl = locale === "uk" ? "uk-UA" : "en-US";
  /* «2026 р.» stays on one line. */
  return (iso: string) => new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso)).replace(/ р\.$/, "\u00a0р.");
}

/** A day of this year's near future, without the year — for a small line under a figure. */
function useShortDay() {
  const { locale } = useSolanaI18n();
  const intl = locale === "uk" ? "uk-UA" : "en-US";
  return (iso: string) => new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
}

/** The link as a person reads it: no scheme, and the landing it opens left to the address bar. */
export function shownLink(link: string): string {
  return link.replace(/^https?:\/\//, "").replace(/\?.*$/, "");
}

function CopyLink({ link, code, quiet = false }: { link: string; code: string; quiet?: boolean }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={styles.linkBlock}>
      <div className={styles.linkText}>
        <span className={styles.label}>{words.link}</span>
        <span className={styles.linkValue} translate="no">{shownLink(link)}</span>
        <span className={styles.codeLine}>
          {words.code} <strong translate="no">{code}</strong>
        </span>
      </div>
      <button type="button" className={quiet ? styles.quiet : styles.primary} onClick={() => void copy()} aria-live="polite">
        {copied ? <Check size={16} weight="bold" aria-hidden="true" /> : <Copy size={16} weight="bold" aria-hidden="true" />}
        {copied ? words.copied : words.copy}
      </button>
    </div>
  );
}

/** A sentence ends once: a date that already ends with a full stop («2026 р.») takes none. */
const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

type PayoutWord = keyof ReturnType<typeof partnerCopy>["payout"];

/** What a claim's answer says to the partner; anything else is «could not be checked». */
const OUTCOME: Readonly<Record<string, PayoutWord>> = {
  PAID: "paid",
  FAILED: "failed",
  CLAIMING: "checking",
  SUBMITTED_UNKNOWN: "checking",
  RESERVE_SHORT: "reserve",
  ON_REVIEW: "review",
  STOPPED: "stopped",
  NOT_OPEN: "closed",
  PAUSED: "paused",
  RESERVE_UNAVAILABLE: "reserve",
  NOT_CLAIMABLE: "nothing",
  ALREADY_RUNNING: "checking",
  WALLET_CHANGED: "signIn",
  PROOF_REQUIRED: "signIn",
};

const running = (state: string | undefined) => state === "CLAIMING" || state === "SUBMITTED_UNKNOWN";

/** «Get» is offered only with at least the minimum free in the reserve, payouts open and not paused, and the wallet not held. */
const offerable = (page: PartnerPageView) =>
  page.payout.open && !page.payout.paused && page.payout.hold === "NONE" && BigInt(page.payout.offerUsdMicros) >= BigInt(page.payout.minimumUsdMicros);

/** «Get $X» once payouts are open and there is at least the minimum; a payout still deciding is read back, never sent again. */
function usePartnerClaim(page: PartnerPageView, address: string | null, reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<PayoutWord | null>(null);
  const deciding = running(page.payout.slot?.state);
  useEffect(() => {
    if (!deciding || !address) return;
    /* Polling observes and settles; it cannot start a payout. */
    const timer = window.setInterval(() => {
      void fetch(`/api/growth/partner/claim?address=${encodeURIComponent(address)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { payout?: { state?: string } | null } | null) => {
          if (body?.payout && !running(body.payout.state)) void reload();
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [deciding, address, reload]);
  const claim = useCallback(async () => {
    if (!address || busy || deciding) return;
    setBusy(true);
    setSaid(null);
    try {
      const response = await fetch("/api/growth/partner/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      const body = (await response.json().catch(() => ({}))) as { state?: string };
      setSaid(OUTCOME[body.state ?? ""] ?? "error");
    } catch {
      setSaid("error");
    } finally {
      setBusy(false);
      await reload();
    }
  }, [address, busy, deciding, reload]);
  return { busy, said, deciding, claim };
}

function PayoutBlock({ page, claim }: { page: PartnerPageView; claim: ReturnType<typeof usePartnerClaim> }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const { payout } = page;
  const held = BigInt(page.money.heldUsdMicros) > 0n;
  const heldLine = held ? sentence(words.held(money(page.money.heldUsdMicros))) : null;
  if (!payout.open) {
    return (
      <p className={styles.note}>
        {words.payoutsClosed}
        {heldLine ? ` ${heldLine}` : ""}
      </p>
    );
  }
  const claimable = BigInt(payout.claimableUsdMicros);
  const minimum = BigInt(payout.minimumUsdMicros);
  const waiting = BigInt(payout.awaitingReserveUsdMicros);
  const offer = offerable(page) && !claim.deciding;
  const slot = payout.slot;
  /* The latest word: a payout still deciding, a claim just answered, the wallet held, payouts paused, or how the last payout ended. */
  const standing: PayoutWord | null = payout.hold === "STOPPED" ? "stopped" : payout.hold === "REVIEW" ? "review" : payout.paused ? "paused" : null;
  const status: PayoutWord | null = claim.deciding ? "checking" : claim.said ?? standing ?? (slot?.state === "FAILED" ? "failed" : null);
  return (
    <div className={styles.payout}>
      {offer ? (
        <button type="button" className={styles.primary} onClick={() => void claim.claim()} disabled={claim.busy}>
          {claim.busy ? words.claiming : words.claim(money(payout.offerUsdMicros))}
        </button>
      ) : null}
      {status ? (
        <p className={status === "failed" || status === "error" || status === "stopped" ? styles.warn : styles.note} aria-live="polite">
          {status === "checking" && slot && running(slot.state)
            ? words.checkingAmount(money(slot.usdMicros))
            : status === "paid" && slot?.state === "PAID"
              ? words.paidAmount(money(slot.usdMicros))
              : words.payout[status]}
          {status === "paid" && slot?.signature ? (
            <>
              {" "}
              <a className={styles.txLink} href={`https://solscan.io/tx/${slot.signature}`} target="_blank" rel="noreferrer">
                {words.receiptPayout}
              </a>
            </>
          ) : null}
        </p>
      ) : !offer && claimable < minimum ? (
        <p className={styles.note}>{words.minimum(money(payout.minimumUsdMicros))}</p>
      ) : null}
      {waiting > 0n && !standing ? <p className={styles.note}>{words.awaitingReserve(money(payout.awaitingReserveUsdMicros))}</p> : null}
      {BigInt(payout.debtUsdMicros) > 0n ? <p className={styles.note}>{words.debt(money(payout.debtUsdMicros))}</p> : null}
      {BigInt(payout.elsewhereUsdMicros) > 0n ? <p className={styles.note}>{words.elsewhere(money(payout.elsewhereUsdMicros))}</p> : null}
      {heldLine ? <p className={styles.note}>{heldLine}</p> : null}
    </div>
  );
}

/** Every payout with its lines: the pool, the rules, Ryntra's claim, the amount — and the payout's own transaction. */
function Receipts({ page }: { page: PartnerPageView }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const day = useDay();
  const receipts = page.payout.receipts;
  if (!receipts.length) return null;
  return (
    <details className={styles.details}>
      <summary>
        {words.receiptsTitle(receipts.length)}
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </summary>
      <ul className={styles.receipts}>
        {receipts.map((receipt) => (
          <li key={receipt.claimId} className={styles.receipt}>
            <span className={styles.receiptHead}>
              <strong>{money(receipt.usdMicros)}</strong>
              <span className={styles.muted}>{day(receipt.paidAt)}</span>
              <a className={styles.txLink} href={`https://solscan.io/tx/${receipt.signature}`} target="_blank" rel="noreferrer">
                {words.receiptPayout}
              </a>
            </span>
            <ul className={styles.receiptLines}>
              {receipt.lines.map((line) => {
                const debt = BigInt(line.usdMicros) < 0n;
                return (
                  <li key={`${line.pool}:${line.claimTx}:${line.claimIndex}`}>
                    <span translate="no">{line.symbol ?? `${line.pool.slice(0, 4)}…${line.pool.slice(-4)}`}</span> · {words.receiptRules(line.rulesVersion)} ·{" "}
                    <a className={styles.txLink} href={`https://solscan.io/tx/${line.claimTx}`} target="_blank" rel="noreferrer">
                      {words.receiptClaim}
                    </a>{" "}
                    · {debt ? `−${money(line.usdMicros.slice(1))} ${words.receiptDebt}` : money(line.usdMicros)}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The card; until a creator is activated and a share is counted, the level, the link and the share — no row of zeros. */
function PartnerCard({ page, empty, address, reload }: { page: PartnerPageView; empty: boolean; address: string | null; reload: () => Promise<void> }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const day = useDay();
  const shortDay = useShortDay();
  const level = page.level;
  const claim = usePartnerClaim(page, address, reload);
  /* One orange action: «Get» when there is money to take, copying the link otherwise. */
  const offering = !empty && !claim.deciding && offerable(page);
  return (
    <section className={styles.panel} aria-labelledby="partner-level">
      <div className={styles.levelRow}>
        <TrackBadge badge={level.current ?? "SCOUT"} earned={level.current !== null} size={56} className={level.current ? styles.glow : undefined} />
        <div className={styles.levelText}>
          <span className={styles.eyebrow}>{page.foundingSeat !== null ? words.foundingSeat(page.foundingSeat, page.schedule.foundingSeats) : words.tier[page.tier]}</span>
          <h2 className={styles.levelName} id="partner-level">{level.current ? words.badge[level.current] : words.levelNone}</h2>
          <span className={styles.muted}>{level.next ? words.levelNext(words.badge[level.next.id], level.next.creators) : words.levelTop}</span>
        </div>
        <div className={styles.activated}>
          <span className={styles.figure}>{level.activated}</span>
          <span className={styles.label}>{words.activated(level.activated)}</span>
        </div>
      </div>

      {page.referral ? <CopyLink link={page.referral.link} code={page.referral.code} quiet={offering} /> : null}

      {empty ? (
        <p className={styles.note}>{words.moneyLater}</p>
      ) : (
        <>
          <dl className={styles.money}>
            <div>
              <dt>{words.pending}</dt>
              <dd>{money(page.money.pendingUsdMicros)}</dd>
            </div>
            <div>
              <dt>{words.available}</dt>
              <dd>{money(page.money.availableUsdMicros)}</dd>
              {page.money.nextAvailableAt ? <dd className={styles.tileNote}>{words.nextOn(shortDay(page.money.nextAvailableAt))}</dd> : null}
            </div>
            <div>
              <dt>{words.paid}</dt>
              <dd>{money(page.money.paidUsdMicros)}</dd>
            </div>
          </dl>
          <PayoutBlock page={page} claim={claim} />
          {!page.money.complete ? <p className={styles.warn}>{words.incomplete}</p> : null}
          <Receipts page={page} />
        </>
      )}

      <div className={styles.shareRow}>
        <span className={styles.label}>{words.shareNow}</span>
        <span className={styles.shareValue}>
          {page.share
            ? page.share.pools > 1
              ? page.share.nextEnd
                ? `${words.shareSeveral(percent(page.share.bps), page.share.pools)} · ${words.nextStep(day(page.share.nextEnd))}`
                : words.shareSeveral(percent(page.share.bps), page.share.pools)
              : page.share.until
                ? words.shareUntil(percent(page.share.bps), day(page.share.until))
                : words.shareOpen(percent(page.share.bps))
            : words.schedule(page.schedule.tier, page.schedule.steps)}
        </span>
      </div>
    </section>
  );
}

const STEPS: readonly FunnelStep[] = ["opened", "signed", "launched", "earned"];

function Funnel({ page }: { page: PartnerPageView }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const day = useDay();
  /* Opens are counted only from a day: when they are fewer than the next step, the step shows its number alone. */
  const openedShort = page.funnel.opened < page.funnel.signed;
  const top = Math.max(1, openedShort ? 0 : page.funnel.opened, page.funnel.signed, page.funnel.launched, page.funnel.earned);
  return (
    <section className={styles.panel} aria-labelledby="partner-funnel">
      <h2 className={styles.title} id="partner-funnel">{words.funnelTitle}</h2>
      <ol className={styles.funnel}>
        {STEPS.map((step) => {
          const value = page.funnel[step];
          /* No open counted yet: a zero would read as nobody opened the link, so the step says when counting starts. */
          const notCounting = step === "opened" && page.funnel.openedSince === null;
          return (
            <li key={step} className={styles.step}>
              <span className={styles.stepName}>{words.funnel[step]}</span>
              <span className={styles.stepValue}>{notCounting ? "—" : value}</span>
              {notCounting ? (
                <span className={styles.stepSince}>{words.openedFromNext}</span>
              ) : step === "opened" && openedShort && page.funnel.openedSince ? (
                <span className={styles.stepSince}>{words.openedSince(day(page.funnel.openedSince))}</span>
              ) : null}
              <span className={styles.bar} aria-hidden="true" data-quiet={step === "opened" && (openedShort || notCounting) ? "true" : "false"}>
                <span style={{ width: `${value > 0 && !(step === "opened" && openedShort) ? Math.max(4, Math.round((value / top) * 100)) : 0}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
      <details className={styles.details}>
        <summary>
          {words.funnelWhat}
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </summary>
        <ul className={styles.rules}>
          {STEPS.map((step) => (
            <li key={step}>
              <strong>{words.funnel[step]}</strong> — {words.funnelHint[step]}
            </li>
          ))}
          {page.funnel.openedSince ? <li>{words.openedSince(day(page.funnel.openedSince))}</li> : null}
        </ul>
      </details>
    </section>
  );
}

function Ask({ row }: { row: PartnerMarketRow }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const send = async () => {
    setState("sending");
    try {
      const response = await fetch("/api/growth/partner/appeal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: row.network, pool: row.pool, text }),
      });
      setState(response.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  };
  if (state === "sent") return <p className={styles.muted} aria-live="polite">{words.sent}</p>;
  if (row.asked) return <p className={styles.muted}>{words.asked}</p>;
  if (!open) {
    return (
      <button type="button" className={styles.quiet} onClick={() => setOpen(true)}>
        {words.ask}
      </button>
    );
  }
  return (
    <div className={styles.ask}>
      <label className={styles.srOnly} htmlFor={`ask-${row.pool}`}>{words.askLabel}</label>
      <textarea id={`ask-${row.pool}`} className={styles.textarea} rows={3} maxLength={1000} placeholder={words.askPlaceholder} value={text} onChange={(event) => setText(event.target.value)} />
      <div className={styles.askActions}>
        <button type="button" className={styles.quiet} disabled={!text.trim() || state === "sending"} onClick={() => void send()}>
          {state === "sending" ? words.sending : words.send}
        </button>
        <button type="button" className={styles.textButton} onClick={() => setOpen(false)}>
          {words.cancel}
        </button>
      </div>
      {state === "failed" ? <p className={styles.warn}>{words.askFailed}</p> : null}
    </div>
  );
}

/** Markets shown before «Show more»: the newest, enough to see them come in. */
const MARKETS_FOLDED = 4;

function Markets({ page }: { page: PartnerPageView }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const day = useDay();
  const [open, setOpen] = useState(false);
  if (!page.markets.length) {
    return (
      <section className={styles.panel} aria-labelledby="partner-markets">
        <div className={styles.empty}>
          <h2 className={styles.title} id="partner-markets">{words.emptyTitle}</h2>
          <p className={styles.muted}>{words.emptyLead}</p>
          {page.funnel.openedSince === null ? (
            <p className={styles.muted}>{words.emptyCounting}</p>
          ) : page.funnel.opened > 0 ? (
            <p className={styles.muted}>{words.emptyOpens(page.funnel.opened)}</p>
          ) : null}
        </div>
      </section>
    );
  }
  return (
    <section className={styles.panel} aria-labelledby="partner-markets">
      <h2 className={styles.title} id="partner-markets">{words.marketsTitle}</h2>
      <table className={styles.table} aria-label={words.marketsLabel}>
        <thead>
          <tr>
            <th scope="col">{words.market}</th>
            <th scope="col">{words.status}</th>
            <th scope="col">{words.share}</th>
            <th scope="col" className={styles.num}>{words.earned}</th>
            <th scope="col" className={styles.num}>{words.pending}</th>
            <th scope="col" className={styles.num}>{words.available}</th>
          </tr>
        </thead>
        <tbody>
          {(open ? page.markets : page.markets.slice(0, MARKETS_FOLDED)).map((row) => {
            const short = `${row.pool.slice(0, 4)}…${row.pool.slice(-4)}`;
            const name = row.symbol ? `${row.name ?? row.symbol}` : words.unnamed(short);
            /* Under review, closed, a demo — or waiting for its first fee: no figure the pool does not have. */
            const quiet = row.status === "REVIEW" || row.status === "NOT_COUNTED" || row.status === "BLOCKED" || (row.status === "WAITING" && BigInt(row.earnedUsdMicros) === 0n);
            return (
              <tr key={`${row.network}:${row.pool}`}>
                <td data-label={words.market}>
                  <span className={styles.marketName}>
                    {row.token && row.network === "solana" ? <Link href={`/app/launch/${row.token}`}>{name}</Link> : name}
                    {row.symbol ? <span className={styles.symbol} translate="no">{row.symbol}</span> : null}
                  </span>
                  <span className={styles.muted}>
                    {words.network[row.network]} · {words.creator(row.creator)} · {words.launchedOn(day(row.launchedAt))}
                  </span>
                </td>
                <td data-label={words.status}>
                  <span className={styles.chip} data-tone={row.status === "EARNING" ? "live" : row.status === "REVIEW" ? "review" : "quiet"}>
                    {words.poolStatus[row.status]}
                  </span>
                  {!quiet || row.status === "WAITING" ? <span className={styles.muted}>{row.activated ? words.activatedYes : words.activatedNo}</span> : null}
                  {row.data === "NO_DATA" ? <span className={styles.warn}>{words.noData}</span> : null}
                  {row.mayAppeal ? (
                    <div className={styles.askWrap}>
                      <Ask row={row} />
                    </div>
                  ) : null}
                </td>
                <td data-label={words.share}>
                  {row.shareBps > 0
                    ? row.shareUntil
                      ? words.shareUntil(percent(row.shareBps), day(row.shareUntil))
                      : row.status === "WAITING"
                        ? words.fromFirstFee(percent(row.shareBps))
                        : percent(row.shareBps)
                    : "—"}
                </td>
                <td data-label={words.earned} className={styles.num}>{quiet ? "—" : money(row.earnedUsdMicros)}</td>
                <td data-label={words.pending} className={styles.num}>{quiet ? "—" : money(row.pendingUsdMicros)}</td>
                <td data-label={words.available} className={styles.num}>{quiet ? "—" : money(row.availableUsdMicros)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {page.markets.length > MARKETS_FOLDED ? (
        <button type="button" className={styles.textButton} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {open ? words.showLess : words.showMore(page.markets.length - MARKETS_FOLDED)}
          <CaretDown size={12} weight="bold" aria-hidden="true" className={open ? styles.flip : undefined} />
        </button>
      ) : null}
    </section>
  );
}

type Group = Readonly<{ id: "partner" | "founding" | "creator" | "ambassador" | "liquidity"; badges: readonly TrackBadgeState[] }>;

/**
 * One line under the liquidity track — only when today's read needs saying: not read, read in part, or positions
 * found and none counted. At rest otherwise nothing: what each badge asks is one touch deeper.
 */
function liquidityLine(liquidity: LiquidityState, words: ReturnType<typeof partnerCopy>): string | null {
  const held = liquidity.view?.badges.some((badge) => badge.earned) ?? false;
  if (liquidity.failed) return words.liquidityUnread(false);
  if (!liquidity.view) return null;
  const read = liquidity.view.read;
  if (!read) return words.liquidityUnread(held);
  if (read.partial) return words.liquidityPartial;
  if (read.positions > 0 && read.counted === 0) return read.unpriced > 0 ? words.liquidityUnpriced : words.liquidityUnder;
  return null;
}

function NetworkBadges({ page, liquidity }: { page: PartnerPageView; liquidity: LiquidityState }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const day = useDay();
  const [chosen, setChosen] = useState<string | null>(null);
  const liquidityBadges = liquidity.view?.badges ?? LIQUIDITY_UNREAD;
  const groups: readonly Group[] = [
    { id: "partner", badges: page.badges.partner },
    { id: "founding", badges: [page.badges.founding] },
    { id: "creator", badges: page.badges.creator },
    { id: "ambassador", badges: page.badges.ambassador },
    { id: "liquidity", badges: liquidityBadges },
  ];
  const all = groups.flatMap((group) => group.badges);
  /* The count is of badges that can be held now: ambassador badges are not given yet, liquidity ones are counted once read. */
  const holdable = groups.filter((group) => group.id !== "ambassador" && (group.id !== "liquidity" || liquidity.view !== null)).flatMap((group) => group.badges);
  const held = holdable.filter((badge) => badge.earned).length;
  const picked = all.find((badge) => badge.id === chosen) ?? null;
  const pickedLiquidity = liquidity.view?.badges.find((badge) => badge.id === chosen) ?? null;
  const line = liquidityLine(liquidity, words);
  const anyLiquidity = liquidity.view?.badges.some((badge) => badge.earned) ?? false;
  /* Not held yet: how far along — days in range for Steward and Strategist, once read. */
  const notHeldYet = pickedLiquidity && pickedLiquidity.need > 1 ? words.liquidityDays(pickedLiquidity.have, pickedLiquidity.need) : words.notHeld;
  return (
    <section className={`${rw.panel} ${rw.badges} ${styles.badgesPanel}`} aria-labelledby="partner-badges">
      <div className={rw.panelHead}>
        <h2 className={rw.title} id="partner-badges">{words.badgesTitle}</h2>
        <span className={rw.chips}>
          <span className={rw.chip} data-tone="quiet" translate="no">{words.badgesHeld(held, holdable.length)}</span>
          <PaidAsChip paidAs="STATUS" />
        </span>
      </div>
      <div className={styles.tracks}>
        {groups.map((group) => (
          <div key={group.id} className={styles.track}>
            <span className={styles.trackName}>{words.track[group.id]}</span>
            <ul className={styles.trackBadges} style={{ "--count": group.badges.length } as CSSProperties}>
              {group.badges.map((badge) => {
                const name = words.badge[badge.id];
                return (
                  <li key={badge.id}>
                    <button
                      type="button"
                      className={rw.badgeTile}
                      data-held={badge.earned ? "true" : "false"}
                      aria-pressed={chosen === badge.id}
                      aria-controls="partner-badge-detail"
                      aria-label={badge.earned ? name : words.notYet(name)}
                      onClick={() => setChosen((current) => (current === badge.id ? null : badge.id))}
                      {...tilt}
                    >
                      <TrackBadge badge={badge.id} earned={badge.earned} size={48} className={rw.badgeArt} />
                      <span className={rw.badgeName} aria-hidden="true">{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {line || anyLiquidity ? (
          <div className={styles.liquidityFoot}>
            {line ? <span className={styles.muted}>{line}</span> : null}
            {anyLiquidity ? (
              <label className={lg.switchRow}>
                <button type="button" role="switch" className={lg.switch} aria-checked={liquidity.view?.public === true} onClick={liquidity.toggle} disabled={liquidity.saving} />
                {words.liquidityShow}
              </label>
            ) : null}
            {liquidity.saveFailed ? <span className={styles.warn} role="status">{words.liquiditySaveFailed}</span> : null}
          </div>
        ) : null}
      </div>
      <p className={rw.badgeDetail} id="partner-badge-detail" aria-live="polite" data-open={picked ? "true" : "false"}>
        {picked ? (
          <>
            <strong>{words.badge[picked.id]}</strong> · {picked.earned && picked.at ? `${words.badgeHow[picked.id]} · ${words.earnedOn(day(picked.at))}` : picked.earned ? words.badgeHow[picked.id] : `${words.badgeHow[picked.id]} · ${notHeldYet}`}
          </>
        ) : (
          words.badgesHint
        )}
      </p>
    </section>
  );
}

function HowItWorks() {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  return (
    <section className={styles.panel}>
      <details className={styles.details}>
        <summary>
          {words.howTitle}
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </summary>
        <ul className={styles.rules}>
          {[words.activatedHintLine, ...words.how].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <ProgrammeLinks />
    </section>
  );
}

/** The Terms and the media kit: open to anybody, with or without a wallet. */
function ProgrammeLinks() {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  return (
    <div className={styles.links}>
      <Link className={styles.link} href="/promo/partners/terms">
        {words.terms}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
      <Link className={styles.link} href="/app/rewards/partners/kit">
        {words.kit}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

/** The line under the title: the share and how it is paid now (Ріст 19, UX-752); nothing when it could not be read. */
function PartnerFact({ fact, founding = false }: { fact: PartnerFactInput; founding?: boolean }) {
  const { locale } = useSolanaI18n();
  if (!fact) return null;
  const words = programmeCopy(locale);
  /* A Founding partner's steps differ from the Standard line — their own card says them; here only how it is paid. */
  return <p className={styles.promise}>{founding ? words.partnerState(fact.paidAs) : words.partnerFact(fact.percent, fact.then, fact.paidAs)}</p>;
}

export type PartnerFactInput = Readonly<{
  percent: number;
  then: Readonly<{ afterDays: number; percent: number }> | null;
  paidAs: Exclude<PaidAs, "STATUS">;
}> | null;

export function PartnerView({ fact = null }: { fact?: PartnerFactInput }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const { page, failed, load, address, proven, wallet } = usePartnerPage();
  const liquidity = useLiquidity(address, proven, wallet.refused);

  if (wallet.gate === "connect") {
    return (
      <div className={styles.page}>
        <PartnerFact fact={fact} />
        <WalletGate title={words.gateTitle} />
        <ProgrammeLinks />
      </div>
    );
  }
  if (!proven) {
    return (
      <div className={styles.page}>
        <PartnerFact fact={fact} />
        <SignInGate wallet={wallet} lead="partners" />
      </div>
    );
  }
  if (!page) {
    /* The tier is not known yet: no share is said, so a Founding partner never reads the Standard steps. */
    return (
      <div className={styles.page}>
        <section className={styles.panel} aria-live="polite">
          <div className={styles.empty}>
            <p className={styles.muted}>{failed ? words.unavailable : words.loading}</p>
            {failed ? (
              <button type="button" className={styles.quiet} onClick={() => void load()}>
                {words.retry}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    );
  }
  /* No creator activated and nothing counted yet: the honest state is the link and the markets, not a page of zeros. */
  const empty = page.level.activated === 0 && BigInt(page.money.earnedUsdMicros) === 0n && BigInt(page.money.heldUsdMicros) === 0n;
  const funnelEmpty = page.funnel.opened + page.funnel.signed + page.funnel.launched + page.funnel.earned === 0;
  return (
    <div className={styles.page}>
      <PartnerFact fact={fact} founding={page.tier === "FOUNDING"} />
      <div className={styles.grid} data-empty={funnelEmpty && page.markets.length === 0 ? "true" : "false"}>
        <div className={styles.areaCard}>
          <PartnerCard page={page} empty={empty} address={address} reload={load} />
        </div>
        {funnelEmpty ? null : (
          <div className={styles.areaFunnel}>
            <Funnel page={page} />
          </div>
        )}
        <div className={styles.areaMarkets}>
          <Markets page={page} />
        </div>
        <div className={styles.areaBadges}>
          <NetworkBadges page={page} liquidity={liquidity} />
        </div>
        <div className={styles.areaHow}>
          <HowItWorks />
        </div>
      </div>
    </div>
  );
}
