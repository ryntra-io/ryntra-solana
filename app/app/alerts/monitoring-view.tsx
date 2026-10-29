"use client";

import { Page } from "@ryntra/core/ui";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { numberLocale } from "@/app/app/invest/invest-words";
import { langOf, WarnSheet, WatchLine } from "@/app/app/invest/position-watch";
import { usePositions } from "@/app/app/invest/use-positions";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import type { PositionWatchView } from "@/lib/api/v1/contract";
import { watchWord } from "@/lib/monitoring/watch-words";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { WalletChoices } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { rynHref } from "@/lib/agent/context";
import type { Locale } from "@/lib/monitoring/engine";
import { relativeTime, words } from "@/lib/monitoring/copy";
import type { InboxRecord } from "@/lib/monitoring/store";
import type { QuietHours } from "@/lib/monitoring/quiet-hours";

import styles from "./monitoring.module.css";
import watchStyles from "@/app/app/invest/watch.module.css";
import { ensureWalletActs, walletFact } from "@/lib/account/wallet-proof-store.client";

type MonitorStatus = "watching" | "needs_attention" | "paused" | "unavailable";

type SurfaceCard = Readonly<{
  monitorId: string;
  label: string;
  status: MonitorStatus;
  title: string;
  reason: string;
  href: string;
  cta: string;
  paper: boolean;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  /** The record the card stands for: a plan, or (1.21.0) a position under «Ryntra попередить». */
  subject?: Readonly<{ kind: string; id: string }>;
}>;

type Preferences = Readonly<{ telegram: boolean; push: boolean; quietHours: QuietHours | null }>;
type DeviceRow = Readonly<{ deviceId: string; platform: string; appVersion: string; locale: string; registeredAt: string }>;

type Surface = Readonly<{
  attention: readonly SurfaceCard[];
  watching: readonly SurfaceCard[];
  recent: readonly InboxRecord[];
  unread: number;
  preferences: Preferences;
}>;

function fixtureSurface(): Surface | null {
  if (typeof window === "undefined") return null;
  const raw = (window as { __RYNTRA_MONITORING_FIXTURE?: Surface }).__RYNTRA_MONITORING_FIXTURE;
  return raw ?? null;
}

export function MonitoringPanel({ locale }: { locale: Locale }) {
  const w = words(locale);
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const [fixture, setFixture] = useState<Surface | null>(null);
  useEffect(() => {
    setFixture(fixtureSurface());
  }, []);
  const proven = Boolean(fixture) || (proof.state.status === "proven" && proof.state.address === address);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [surface, setSurface] = useState<Surface | null>(null);
  const [devices, setDevices] = useState<readonly DeviceRow[]>([]);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  /* Нагляд over the wallet's positions: every company it holds, its state and one action — the plan's «Виконано» stops nothing. */
  const positions = usePositions();
  const [warning, setWarning] = useState<PositionWatchView | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [monitoring, deviceRes] = await Promise.all([
        fetch("/api/monitoring", { headers: { accept: "application/json", "accept-language": locale } }),
        fetch("/api/v1/notifications/devices", { headers: { accept: "application/json", "X-Ryntra-API": "1" } }),
      ]);
      if (!monitoring.ok) {
        setState("failed");
        return;
      }
      const body = (await monitoring.json()) as Surface;
      setSurface(body);
      if (body.preferences.quietHours) {
        setQuietStart(body.preferences.quietHours.start);
        setQuietEnd(body.preferences.quietHours.end);
      }
      if (deviceRes.ok) {
        const listed = (await deviceRes.json()) as { devices?: DeviceRow[] };
        setDevices(listed.devices ?? []);
      }
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [locale]);

  useEffect(() => {
    if (fixture) {
      setSurface(fixture);
      setState("ready");
      return;
    }
    if (proven) void load();
    else {
      setState("idle");
      setSurface(null);
    }
  }, [proven, load, fixture]);

  async function markRead(id: string) {
    /* A read mark is a write; on a link alone it stays on this screen rather than asking the wallet to sign for it. */
    if (walletFact().provenVia !== "link") await fetch("/api/monitoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ read: id }) });
    setSurface((current) =>
      current
        ? { ...current, recent: current.recent.map((row) => (row.id === id ? { ...row, unread: false } : row)), unread: Math.max(0, current.unread - 1) }
        : current,
    );
  }

  async function savePrefs(patch: Partial<Preferences>) {
    const quietHours = patch.quietHours === undefined ? surface?.preferences.quietHours ?? null : patch.quietHours;
    if (!(await ensureWalletActs())) return;
    await fetch("/api/monitoring", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        telegram: patch.telegram ?? surface?.preferences.telegram,
        push: patch.push ?? surface?.preferences.push,
        quietHours,
      }),
    });
    await load();
  }

  async function revoke(deviceId: string) {
    if (!(await ensureWalletActs())) return;
    const response = await fetch(`/api/v1/notifications/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE", headers: { "X-Ryntra-API": "1" } }).catch(() => null);
    if (!response?.ok) return;
    setDevices((rows) => rows.filter((row) => row.deviceId !== deviceId));
  }

  if (!address && !fixture) {
    return (
      <Page kind="action" className={styles.page} title={w.title} help={w.lead} lang={locale}>
        <div className={styles.gate}>
          <p className={styles.title}>{w.connect}</p>
          <p className={styles.meta}>{w.noWallet}</p>
          <WalletChoices single="button" />
        </div>
      </Page>
    );
  }

  if (!proven) {
    return (
      <Page kind="action" className={styles.page} title={w.title} help={w.lead} lang={locale}>
        <div className={styles.gate}>
          <p className={styles.empty}>{w.confirm}</p>
          <button type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing"}>
            {w.confirmWallet}
          </button>
        </div>
      </Page>
    );
  }

  if (state === "failed") {
    return (
      <Page kind="action" className={styles.page} title={w.title} help={w.lead} lang={locale}>
        <p className={styles.empty}>{w.couldNotLoad}</p>
        <button type="button" className={styles.ghost} onClick={() => void load()}>{w.tryAgain}</button>
      </Page>
    );
  }

  /* The prediction demo's paper cards and notes left the surface with the demo; the service still keeps them. */
  /* A position is shown once, as a position: its plan's card and its «Ryntra попередить» card fold into «Твої позиції». */
  const held = positions.body?.positions ?? [];
  const positionPlans = new Set(held.flatMap((view) => (view.exit?.planId ? [view.exit.planId] : [])));
  const asPosition = (card: SurfaceCard) => card.subject?.kind === "position" || (card.subject?.kind === "trading-plan" && positionPlans.has(card.subject.id));
  const attention = (surface?.attention ?? []).filter((card) => !card.paper && !asPosition(card));
  const watching = (surface?.watching ?? []).filter((card) => !card.paper && !asPosition(card));
  const recent = (surface?.recent ?? []).filter((row) => !row.paper);
  const prefs = surface?.preferences;
  const now = Date.now();
  /* One orange action on the screen: the first card that needs attention, else the newest unread note that still has an action; every other action stays quiet. */
  /* The one orange action: a note that still buys or asks for something before one that only says a purchase waits (1.18.0). */
  /* A position in «Дія» — its limit or its target reached — holds the orange: the sale comes first. */
  const actNow = held.find((view) => view.state === "action") ?? null;
  const primaryNote = attention.length === 0 && !actNow ? ((recent.find((row) => row.unread && noteActs(row) && row.ruleState !== "deferred") ?? recent.find((row) => row.unread && noteActs(row)))?.id ?? null) : null;

  return (
    <Page kind="action" className={styles.page} title={w.title} help={w.lead} lang={locale}>

      {state === "loading" && !surface ? <p className={styles.empty} aria-busy="true">{w.loading}</p> : null}

      <PositionsSection positions={positions} locale={locale} actNow={actNow} onWarn={setWarning} />
      <WarnSheet view={warning} locale={locale} onClose={() => setWarning(null)} />

      <section className={styles.section} aria-labelledby="attention-title">
        <h2 id="attention-title">{w.needsAttention}</h2>
        {attention.length === 0 ? <p className={styles.empty}>{w.emptyAttention}</p> : (
          <div className={styles.cards}>
            {attention.map((card, index) => <Card key={card.monitorId} card={card} w={w} now={now} locale={locale} tone="attention" primary={index === 0 && !actNow} />)}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="watching-title">
        <h2 id="watching-title">{w.watchingSection}</h2>
        {watching.length === 0 ? <p className={styles.empty}>{w.emptyWatching}</p> : (
          <div className={styles.cards}>
            {watching.map((card) => <Card key={card.monitorId} card={card} w={w} now={now} locale={locale} tone="watching" primary={false} />)}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="recent-title">
        <h2 id="recent-title">{w.recent}</h2>
        {recent.length === 0 ? <p className={styles.empty}>{w.emptyRecent}</p> : (
          <div className={styles.cards}>
            {recent.map((row) => {
              const state = noteState(row, w);
              return (
                <article key={row.id} className={styles.card} data-unread={row.unread ? "true" : "false"} data-rule-state={state?.key}>
                  <div className={styles.cardTop}>
                    <span className={styles.label}>{row.context}</span>
                    {row.paper ? <span className={styles.paper}>{w.paper}</span> : null}
                    {/* A rule's reminder and the month's budget say their state: «Час покупки за правилом», «Пропущено», «Бюджет вичерпано». */}
                    {state ? <span className={styles.status} data-status={state.tone}>{state.label}</span> : null}
                    <span className={styles.meta}>{relativeTime(row.createdAt, now, locale)}</span>
                  </div>
                  <p className={styles.title}>{row.title}</p>
                  <p className={styles.reason}>{row.reason}</p>
                  {/* The note's actions in one row, wrapping on a phone: its own, then «Спитати Ryntra», then «Позначити прочитаним». */}
                  <div className={styles.noteActions}>
                    {noteActs(row) ? <Link className={row.id === primaryNote ? "rw-btn rw-btn--primary" : "rw-btn"} href={row.href}>{row.cta}</Link> : null}
                    {/* Why this note, in Ryntra's words — the exact record, the finding, the market now. Autoinvest's notes, an issuer's event and a limit order's note say why themselves: the rule's day or fall came, the budget is spent, the issuer's deadline nears, the order filled or its receipt is ready. */}
                    {row.subject?.kind === "autoinvest-rule" || row.subject?.kind === "autoinvest-budget" || row.subject?.kind === "issuer-event" || row.subject?.kind === "limit-order" || row.subject?.kind === "assistant-brief" || row.subject?.kind === "launch-creator" || row.subject?.kind === "token-watch" || row.subject?.kind === "assistant-task" || row.subject?.kind === "wallet-watch" ? null : (
                      <Link className="rw-btn" href={rynHref({ kind: "note", inboxId: row.id }, locale === "uk" ? "Чому мені прийшло це сповіщення?" : "Why did I get this alert?")} prefetch={false}>{locale === "uk" ? "Спитати Ryntra" : "Ask Ryntra"}</Link>
                    )}
                    {row.unread ? <button type="button" className={styles.ghost} onClick={() => void markRead(row.id)}>{w.markRead}</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {prefs ? (
        <section className={styles.section} aria-labelledby="notes-title">
          <h2 id="notes-title">{w.notes}</h2>
          <div className={styles.prefs}>
            <p className={styles.reason}>{w.inboxOn}</p>
            <div className={styles.prefRow}>
              <span>{w.telegram}</span>
              <button type="button" className={styles.ghost} onClick={() => void savePrefs({ telegram: !prefs.telegram })}>
                {prefs.telegram ? w.telegramOn : w.telegramOffPref}
              </button>
            </div>
            <p className={styles.meta}>
              <Link href="/app/settings#account">{w.connectTelegram}</Link>
            </p>
            <div className={styles.prefRow}>
              <span>{w.push}</span>
              <button type="button" className={styles.ghost} onClick={() => void savePrefs({ push: !prefs.push })}>
                {prefs.push ? w.pushOn : w.pushOff}
              </button>
            </div>
            <form
              className={styles.quietForm}
              onSubmit={(event) => {
                event.preventDefault();
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Kyiv";
                void savePrefs({ quietHours: { start: quietStart, end: quietEnd, timezone } });
              }}
            >
              <span>{w.quietHours}</span>
              <label>
                <input className={styles.time} type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} />
              </label>
              <label>
                <input className={styles.time} type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} />
              </label>
              <button type="submit" className={styles.ghost}>{w.saveQuiet}</button>
              {prefs.quietHours ? (
                <button type="button" className={styles.ghost} onClick={() => void savePrefs({ quietHours: null })}>{w.quietOff}</button>
              ) : null}
            </form>
            {devices.length === 0 ? <p className={styles.meta}>{w.noDevices}</p> : (
              <ul className={styles.devices}>
                {devices.map((device) => (
                  <li key={device.deviceId}>
                    <span>{device.platform} · {device.appVersion}</span>
                    <button type="button" className={styles.ghost} onClick={() => void revoke(device.deviceId)}>{w.revokeDevice}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </Page>
  );
}

/**
 * «Твої позиції» — every company the wallet holds, as Нагляд sees it: its
 * name and worth over the state's one line and one action. A position that
 * needs the person comes first; a read that failed says so and never an
 * empty list.
 */
function PositionsSection({ positions, locale, actNow, onWarn }: Readonly<{ positions: ReturnType<typeof usePositions>; locale: Locale; actNow: PositionWatchView | null; onWarn: (view: PositionWatchView) => void }>) {
  const lang = langOf(locale);
  const body = positions.body;
  const unread = positions.phase === "failed" || (body !== null && (body.read.holdings === "failed" || body.read.market === "failed"));
  return (
    <section className={styles.section} aria-labelledby="positions-title" data-positions>
      <h2 id="positions-title">{watchWord("positions", lang)}</h2>
      {positions.phase === "loading" && !body ? <p className={styles.empty} aria-busy="true">{watchWord("positions", lang)}…</p> : null}
      {unread ? <p className={styles.empty}>{watchWord("positionsUnread", lang)}</p> : null}
      {body && !unread && body.read.holdings === "partial" ? <p className={styles.empty}>{watchWord("positionsPartial", lang)}</p> : null}
      {body && !unread && body.read.holdings === "complete" && body.positions.length === 0 ? <p className={styles.empty}>{watchWord("positionsEmpty", lang)}</p> : null}
      {body && body.positions.length > 0 ? (
        <div className={watchStyles.positions}>
          {body.positions.map((view) => (
            <article key={view.mint} className={watchStyles.positionCard} data-position-card={view.state}>
              <Link className={watchStyles.positionHead} href={`/app/stocks/${encodeURIComponent(view.symbol)}`} prefetch={false}>
                <MarketIcon mint={view.mint} icon={view.icon} symbol={view.symbol} size={32} />
                <span className={watchStyles.positionName}>
                  <b>{view.name}</b>
                  <span translate="no">{view.symbol}</span>
                </span>
                <span className={watchStyles.positionValue} translate="no">{view.valueUsd !== null ? formatUsdMoney(view.valueUsd, numberLocale(locale)) : "—"}</span>
              </Link>
              <WatchLine view={view} locale={locale} place="card" onWarn={() => onWarn(view)} primary={actNow?.mint === view.mint} />
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * What a rule's reminder or the month's budget note says of itself now
 * (1.13.0): the reminder still open — «Час покупки за правилом», its one
 * action; bought, on its way or missed — said, with no action; the budget
 * spent — «Бюджет вичерпано», its action «Змінити бюджет». Every other note
 * says nothing here.
 */
function noteState(row: InboxRecord, w: ReturnType<typeof words>): Readonly<{ key: string; label: string; tone: MonitorStatus }> | null {
  if (row.subject?.kind === "autoinvest-budget") return { key: "budget", label: w.budgetSpent, tone: "needs_attention" };
  if (row.subject?.kind !== "autoinvest-rule" || !row.ruleState) return null;
  if (row.ruleState === "due") return { key: "due", label: w.ruleDue, tone: "needs_attention" };
  if (row.ruleState === "pending") return { key: "pending", label: w.rulePending, tone: "watching" };
  if (row.ruleState === "bought") return { key: "bought", label: w.ruleBought, tone: "watching" };
  if (row.ruleState === "missed") return { key: "missed", label: w.ruleMissed, tone: "paused" };
  /* 1.18.0: the price condition holds the purchase back — said, with the note's one action, to look. */
  if (row.ruleState === "deferred") return { key: "deferred", label: w.ruleDeferred, tone: "paused" };
  return null;
}

/** Whether a note still has its action: a rule's reminder only while one tap still buys (or its rule can no longer say); every other note always. */
function noteActs(row: InboxRecord): boolean {
  if (row.subject?.kind !== "autoinvest-rule") return true;
  /* A deferred purchase keeps its action — «Подивитись»: the company, where why is said. */
  return row.ruleState === undefined || row.ruleState === "due" || row.ruleState === "deferred";
}

function Card(props: Readonly<{
  card: SurfaceCard;
  w: ReturnType<typeof words>;
  now: number;
  locale: Locale;
  tone: "attention" | "watching";
  /** The page's one orange action. */
  primary: boolean;
}>) {
  const statusWord =
    props.card.status === "needs_attention" ? props.w.needsAttention
      : props.card.status === "unavailable" ? props.w.unavailable
        : props.card.status === "paused" ? props.w.paused
          : props.w.watching;
  return (
    <article className={styles.card} data-tone={props.tone}>
      <div className={styles.cardTop}>
        <span className={styles.label}>{props.card.label}</span>
        {props.card.paper ? <span className={styles.paper}>{props.w.paper}</span> : null}
        <span className={styles.status} data-status={props.card.status}>{statusWord}</span>
      </div>
      {props.card.title && props.card.title !== props.w.watching && props.card.title !== props.w.paused ? <p className={styles.title}>{props.card.title}</p> : null}
      {props.card.reason ? <p className={styles.reason}>{props.card.reason}</p> : null}
      <p className={styles.meta}>{props.w.lastChecked} · {relativeTime(props.card.lastCheckedAt, props.now, props.locale)}</p>
      <Link className={props.tone === "attention" ? (props.primary ? "rw-btn rw-btn--primary" : "rw-btn") : styles.ghostLink} href={props.card.href}>{props.card.cta}</Link>
    </article>
  );
}
