"use client";

import { ArrowSquareOut, CaretDown, CheckCircle, CircleNotch, Warning } from "@phosphor-icons/react";
import { Button } from "@ryntra/core/ui";
import { useCallback, useEffect, useId, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type {
  LaunchCabinetRow,
  LaunchSplitDepthBuildResponse,
  LaunchSplitDepthSubmitResponse,
  LaunchSplitPayoutBuildResponse,
  LaunchSplitPayoutSubmitResponse,
  LaunchSplitRule,
  LaunchSplitRuleBuildResponse,
  LaunchSplitRuleSubmitResponse,
  LaunchSplitView,
} from "@/lib/api/v1/contract";
import { CREATOR_SPLIT_OWNER_WORD, SPLIT_GIVEN, splitProblems, splitRaiseProblems, splitRuleLines } from "@/lib/core/launch/creator-split";
import { launchPreset } from "@/lib/core/venues/meteora-dbc/presets";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions } from "@/lib/solana/wallet.client";

import { coreLang } from "../launch-blocks";
import { explorerUrl, formatBps, formatDate, formatRaw, shortAddress } from "../launch-format";
import styles from "../launch.module.css";
import { exact } from "./cabinet-figures";
import own from "./cabinet.module.css";
import { SPLIT_WORDS, splitWords, type SplitWordKey } from "./split-words";

/**
 * «Поділ твоєї частки» on a launch's card in the creator's cabinet (SOL-L2b): the creator divides their own share of the
 * fees — собі · глибина · спільнота · холдерам — by a rule they sign, then carries it out with their signature: buy steps
 * in the token's DLMM pool after the DEX, the community's transfer and the holders' rounds. What the rule owes and what
 * was done are the server's count from the chain; a figure not read is said so, never a zero.
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

type Phase = "idle" | "prepare" | "sign" | "send" | "done" | "error";
type Act = "rule" | "depth" | "payout";
type Outcome = Readonly<{ act: Act; state: "CONFIRMED" | "PENDING" | "FAILED" | "PAID" | "PARTIAL"; signature: string | null; phase?: "POOL" | "SYNC" | "STEPS" }>;
type Pair = LaunchSplitView["pair"];

const ZERO_RULE: LaunchSplitRule = { shares: { self: 10_000, depth: 0, community: 0, holders: 0 }, community: null };

export function SplitBlock({ row, wallet, network, locale, paused }: { row: LaunchCabinetRow; wallet: string; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale; paused: boolean }) {
  const word = splitWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const [view, setView] = useState<LaunchSplitView | "unread" | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [again, setAgain] = useState(false);
  /* Where a refusal came from: before anything was sent, or at the send — when the answer may be lost after it went out. */
  const [failure, setFailure] = useState<{ code: string; step?: "send" } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const load = useCallback(async () => {
    const answer = await api<LaunchSplitView>(`/api/v1/launch/${row.token}/split`);
    setView(answer.ok ? answer.data : "unread");
  }, [row.token]);
  /* Closed on this network: no rule can exist here, so nothing is read and nothing is drawn — no
     «reading…» or «not read» on every row for a format that is not offered. */
  const closedHere = network === "solana:mainnet" && !CREATOR_SPLIT_OWNER_WORD;
  useEffect(() => {
    if (!closedHere) void load();
  }, [closedHere, load]);

  const busy = phase === "prepare" || phase === "sign" || phase === "send";

  /* One act from build to send: the bytes live ~30 s, so a signature that comes back later is built again. */
  const run = async <B extends { signableMs: number; network: "solana:devnet" | "solana:mainnet"; buildId: string }, S>(
    which: Act,
    buildBody: unknown,
    wiresOf: (built: B) => readonly string[],
    submit: (built: B, signed: readonly string[]) => Promise<Answer<S>>,
    outcomeOf: (built: B, sent: S) => Outcome,
  ) => {
    setFailure(null);
    setOutcome(null);
    setAgain(false);
    if (!connection || connection.address !== wallet) {
      setFailure({ code: "WALLET_CHANGED" });
      setPhase("error");
      return;
    }
    const fresh = await signFreshBytes({
      build: async () => {
        setPhase("prepare");
        return api<B>(`/api/v1/launch/${row.token}/split/${which}/build`, { method: "POST", body: JSON.stringify(buildBody) });
      },
      signableMsOf: (data) => data.signableMs,
      sign: async (data) => {
        setPhase("sign");
        const answer = await signTransactions({ wallet: connection.wallet, address: wallet, unsignedWireBase64: [...wiresOf(data)], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
      onRebuild: (why) => setAgain(why === "late"),
    });
    if (!fresh.ok) {
      if (fresh.stage === "sign") {
        setFailure({ code: "WALLET_REFUSED" });
        setPhase("idle");
        return;
      }
      setFailure({ code: fresh.stage === "build" ? fresh.failure.code : "LAUNCH_BUILD_EXPIRED" });
      setPhase("error");
      return;
    }
    setPhase("send");
    const sent = await submit(fresh.built, fresh.signed);
    if (!sent.ok) {
      setFailure({ code: sent.code, step: "send" });
      setPhase("error");
      void load();
      return;
    }
    setOutcome(outcomeOf(fresh.built, sent.data));
    setPhase("done");
    void load();
  };

  const writeRule = (rule: LaunchSplitRule) =>
    run<LaunchSplitRuleBuildResponse, LaunchSplitRuleSubmitResponse>(
      "rule",
      { creator: wallet, rule },
      (built) => [built.unsignedWireBase64],
      (built, signed) => api(`/api/v1/launch/${row.token}/split/rule/submit`, { method: "POST", body: JSON.stringify({ buildId: built.buildId, creator: wallet, signedWireBase64: signed[0] }) }),
      (_, sent) => ({ act: "rule", state: sent.state, signature: sent.signature }),
    );
  const placeDepth = () =>
    run<LaunchSplitDepthBuildResponse, LaunchSplitDepthSubmitResponse>(
      "depth",
      { creator: wallet },
      (built) => [built.unsignedWireBase64],
      (built, signed) => api(`/api/v1/launch/${row.token}/split/depth/submit`, { method: "POST", body: JSON.stringify({ buildId: built.buildId, creator: wallet, signedWireBase64: signed[0] }) }),
      (built, sent) => ({ act: "depth", state: sent.state, signature: sent.signature, phase: built.phase }),
    );
  const pay = () =>
    run<LaunchSplitPayoutBuildResponse, LaunchSplitPayoutSubmitResponse>(
      "payout",
      { creator: wallet },
      (built) => built.unsignedWireBase64,
      (built, signed) => api(`/api/v1/launch/${row.token}/split/payout/submit`, { method: "POST", body: JSON.stringify({ buildId: built.buildId, creator: wallet, signedWireBase64: signed }) }),
      (_, sent) => ({ act: "payout", state: sent.state, signature: sent.txs[0]?.signature ?? null }),
    );

  if (closedHere) return null;
  if (view === null) return <p className={styles.hint}>{word("reading")}</p>;
  if (view === "unread")
    return (
      <div className={styles.blockStack}>
        <p className={styles.unread}>{word("unread")}</p>
        <Button variant="ghost" onClick={() => void load()} lang={lang}>
          {word("readAgain")}
        </Button>
      </div>
    );
  /* Not offered here and nothing written: no block — a closed format is not drawn. */
  if (!view.open && !view.rule && !view.pendingRule) return null;
  const pair = view.pair;
  const ledger = view.ledger;
  const owed = (bucket: (typeof SPLIT_GIVEN)[number]) => (ledger ? BigInt(ledger.owed[bucket]) : 0n);
  const depthOwed = owed("depth");
  const payable = (owed("community") >= BigInt(view.minimums.communityRaw) ? owed("community") : 0n) + (owed("holders") >= BigInt(view.minimums.holdersRoundRaw) ? owed("holders") : 0n);
  const onItsWay = view.depth.placements.some((placement) => placement.state === "PENDING") || view.rounds.some((round) => round.txs.some((tx) => tx.state === "PENDING"));
  const actions = view.open && !paused && view.rule && !busy && phase !== "done" && !onItsWay;
  const below = (["depth", "community", "holders"] as const).filter((bucket) => {
    const least = BigInt(bucket === "depth" ? view.minimums.depthRaw : bucket === "community" ? view.minimums.communityRaw : view.minimums.holdersRoundRaw);
    return owed(bucket) > 0n && owed(bucket) < least && !(bucket === "depth" && row.migrated === false);
  });

  return (
    <section className={styles.mineShares} aria-label={word("title")}>
      <p className={styles.mineSharesTitle}>{word("title")}</p>
      {!view.rule ? (
        view.pendingRule ? (
          <p className={styles.hint}>{word("pendingRule")}</p>
        ) : !view.open ? (
          <p className={styles.hint}>{word("closed")}</p>
        ) : (
          <>
            <p className={styles.hint}>{word("lede")}</p>
            {busy || phase === "done" || paused ? null : <RuleForm current={null} creator={row.creator} pair={pair} locale={locale} onSign={(rule) => void writeRule(rule)} />}
          </>
        )
      ) : (
        <>
          <ul className={styles.mineShareList}>
            {(["self", ...SPLIT_GIVEN] as const)
              .filter((bucket) => view.rule!.shares[bucket] > 0)
              .map((bucket) => (
                <li key={bucket}>
                  <span>{word(`bucket_${bucket}`)}</span>
                  <span className={styles.mineSharePct}>{formatBps(view.rule!.shares[bucket], locale)}</span>
                </li>
              ))}
          </ul>
          <p className={styles.cellSub}>
            {view.since ? word("ruleSince", { date: formatDate(view.since * 1000, locale) }) : null}
            {view.segments.at(-1) ? (
              <>
                {" · "}
                <a className={styles.markLink} href={explorerUrl(network, "tx", view.segments.at(-1)!.signature)} target="_blank" rel="noreferrer noopener">
                  {word("ruleTx")} <ArrowSquareOut size={12} aria-hidden />
                </a>
              </>
            ) : null}
          </p>
          {view.pendingRule ? <p className={styles.hint}>{word("pendingRule")}</p> : null}

          <Ledger view={view} locale={locale} />

          {actions ? (
            <div className={styles.mineActions}>
              {row.migrated && depthOwed > 0n && depthOwed >= BigInt(view.minimums.depthRaw) ? (
                <Button variant="secondary" onClick={() => void placeDepth()} lang={lang}>
                  {word("placeSteps", { amount: exact(depthOwed, pair, locale) })}
                </Button>
              ) : null}
              {payable > 0n ? (
                <Button variant="secondary" onClick={() => void pay()} lang={lang}>
                  {word("payout", { amount: exact(payable, pair, locale) })}
                </Button>
              ) : null}
            </div>
          ) : null}
          {onItsWay ? <p className={styles.hint}>{word("onItsWay")}</p> : null}
          {actions && row.migrated && depthOwed >= BigInt(view.minimums.depthRaw) ? <p className={styles.hint}>{word("stepsPoolHint")}</p> : null}
          {view.rule.shares.depth > 0 && depthOwed > 0n && row.migrated === false ? <p className={styles.hint}>{word("afterDex")}</p> : null}
          {below.map((bucket) => (
            <p key={bucket} className={styles.hint}>
              {word("belowLeast", {
                name: word(`bucket_${bucket}`),
                amount: exact(bucket === "depth" ? view.minimums.depthRaw : bucket === "community" ? view.minimums.communityRaw : view.minimums.holdersRoundRaw, pair, locale),
              })}
            </p>
          ))}

          <Steps view={view} network={network} locale={locale} tokenDecimals={launchPreset(row.preset)?.token.decimals ?? 6} symbol={row.symbol} />
          <Rounds view={view} network={network} locale={locale} />

          {view.open && !paused && !busy && phase !== "done" && !view.pendingRule ? (
            <details className={`${styles.details} ${own.fit}`}>
              <summary className={styles.summary}>
                {word("raise")} <CaretDown size={14} aria-hidden className={styles.caret} />
              </summary>
              <p className={styles.hint}>{word("raiseHint")}</p>
              <RuleForm current={view.rule} creator={row.creator} pair={pair} locale={locale} onSign={(rule) => void writeRule(rule)} />
            </details>
          ) : null}
        </>
      )}

      {busy ? (
        <ol className={styles.steps} aria-live="polite">
          {(["prepare", "sign", "send"] as const).map((step) => {
            const order = ["prepare", "sign", "send"];
            const state = order.indexOf(step) < order.indexOf(phase) ? "done" : step === phase ? "active" : "next";
            return (
              <li key={step} className={styles.step} data-state={state}>
                <span className={styles.stepIcon}>
                  {state === "done" ? <CheckCircle size={18} weight="fill" aria-hidden /> : state === "active" ? <CircleNotch size={18} aria-hidden className={styles.spin} /> : <span className={styles.stepDot} />}
                </span>
                {step === "prepare" ? word("stepPrepare") : step === "sign" ? word(again ? "stepSignAgain" : "stepSign") : word("stepSend")}
              </li>
            );
          })}
        </ol>
      ) : null}

      {phase === "done" && outcome ? (
        <div role="status" aria-live="polite" className={styles.blockStack}>
          <p className={styles.hint}>
            {outcome.state === "PENDING"
              ? word("pending")
              : outcome.state === "FAILED"
                ? word("failed")
                : outcome.act === "rule"
                  ? word("done_rule")
                  : outcome.act === "depth"
                    ? word(outcome.phase === "POOL" ? "done_pool" : outcome.phase === "SYNC" ? "done_sync" : "done_depth")
                    : outcome.state === "PARTIAL"
                      ? word("donePartly")
                      : word("done_payout")}
            {outcome.signature ? (
              <>
                {" "}
                <a className={styles.markLink} href={explorerUrl(network, "tx", outcome.signature)} target="_blank" rel="noreferrer noopener">
                  {shortAddress(outcome.signature)} <ArrowSquareOut size={12} aria-hidden />
                </a>
              </>
            ) : null}
          </p>
          <Button variant="ghost" onClick={() => setPhase("idle")} lang={lang}>
            {word("again")}
          </Button>
        </div>
      ) : null}

      {failure && phase !== "done" ? (
        failure.code === "WALLET_REFUSED" ? (
          <p className={styles.cancelled} role="status">
            {word("cancelled")}
          </p>
        ) : (
          <div className={styles.failure} role="alert">
            <p className={styles.failureTitle}>
              <Warning size={18} weight="fill" aria-hidden /> {failureText(failure.code, failure.step === "send", word)}
            </p>
          </div>
        )
      ) : null}
    </section>
  );
}

/**
 * A refusal in the creator's words: what is known of it; else, before the send, that nothing was sent — and at the send,
 * where the answer may be lost after the bytes went out, that it may have gone.
 */
function failureText(code: string, atSend: boolean, word: ReturnType<typeof splitWords>): string {
  const key = `err_${code}`;
  if (key in SPLIT_WORDS) return word(key as SplitWordKey);
  return atSend ? word("err_sentUnknown") : word("err_generic");
}

/** What the rule owes each given part and what was done, by the chain's count; not read — said so. */
function Ledger({ view, locale }: { view: LaunchSplitView; locale: WorkspaceLocale }) {
  const word = splitWords(locale);
  const pair = view.pair;
  const ledger = view.ledger;
  const given = SPLIT_GIVEN.filter((bucket) => view.rule && view.rule.shares[bucket] > 0);
  return (
    <div>
      <p className={styles.mineSharesTitle}>{word("ledgerTitle")}</p>
      {ledger ? <p className={styles.cellSub}>{word("ledgerSubject", { amount: exact(ledger.subjectRaw, pair, locale) })}</p> : null}
      <dl className={styles.rows}>
        {given.map((bucket) => (
          <div key={bucket} className={styles.row}>
            <dt>{word(`bucket_${bucket}`)}</dt>
            <dd>
              {ledger ? (
                <>
                  {word("ledgerLeft", { left: exact(ledger.owed[bucket], pair, locale) })}
                  <span className={styles.mineLeft}>{word("ledgerRow", { due: exact(ledger.due[bucket], pair, locale), done: exact(ledger.done[bucket], pair, locale) })}</span>
                </>
              ) : (
                <span className={styles.statUnread}>{word("ledgerUnread")}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {(ledger?.warnings ?? []).map((warning) => (
        <p key={warning} className={styles.unread}>
          {word(`warn_${warning}`)}
        </p>
      ))}
      {view.read === "NOT_READ" ? <p className={styles.unread}>{word("readPartly")}</p> : null}
      <p className={styles.hint}>{word("ledgerNote")}</p>
    </div>
  );
}

/** The creator's buy steps as the pool holds them: what they hold, what they bought. */
function Steps({ view, network, locale, tokenDecimals, symbol }: { view: LaunchSplitView; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale; tokenDecimals: number; symbol: string }) {
  const word = splitWords(locale);
  if (!view.depth.steps.length) return null;
  return (
    <div>
      <p className={styles.mineSharesTitle}>{word("stepsTitle")}</p>
      <ul className={own.sales}>
        {view.depth.steps.map((step) => (
          <li key={step.position}>
            {step.pairRaw === null ? (
              <span className={styles.statUnread}>{word("stepsUnread")}</span>
            ) : (
              word("stepsRow", { pair: exact(step.pairRaw, view.pair, locale), tokens: formatRaw(step.tokenRaw ?? "0", tokenDecimals, locale, 0), symbol: `$${symbol}` })
            )}{" "}
            <a className={styles.markLink} href={explorerUrl(network, "account", step.position)} target="_blank" rel="noreferrer noopener">
              {word("position")} <span className={styles.addr}>{shortAddress(step.position)}</span> <ArrowSquareOut size={12} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>{word("hint_depth")}</p>
    </div>
  );
}

/** Each payout round: how many holders, how much, the community's part, its root on chain. */
function Rounds({ view, network, locale }: { view: LaunchSplitView; network: "solana:devnet" | "solana:mainnet"; locale: WorkspaceLocale }) {
  const word = splitWords(locale);
  if (!view.rounds.length) return null;
  return (
    <div>
      <p className={styles.mineSharesTitle}>{word("roundsTitle")}</p>
      <ul className={own.sales}>
        {[...view.rounds].reverse().map((round) => {
          const holders = round.rows.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n);
          const memo = round.txs.find((tx) => tx.memo);
          const state = round.txs.some((tx) => tx.state === "PENDING") ? word("roundPending") : round.txs.some((tx) => tx.state === "FAILED") ? word("roundPartly") : null;
          return (
            <li key={round.round}>
              {word("roundRow", { n: round.round, count: round.rows.length, amount: exact(holders, view.pair, locale) })}
              {round.community ? ` · ${word("roundCommunity", { amount: exact(round.community.amountRaw, view.pair, locale) })}` : ""}
              {state ? ` · ${state}` : ""}
              {memo ? (
                <>
                  {" · "}
                  <a className={styles.markLink} href={explorerUrl(network, "tx", memo.signature)} target="_blank" rel="noreferrer noopener">
                    {word("root")} <span className={styles.addr}>{round.root.slice(0, 8)}…</span> <ArrowSquareOut size={12} aria-hidden />
                  </a>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A percent as typed into basis points: «12,5» → 1 250; null when it is no number of whole hundredths. */
function bpsOf(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** The rule's form: the three given parts in per cent, the community's wallet when it takes one, and what buyers will read. */
function RuleForm({ current, creator, pair, locale, onSign }: { current: LaunchSplitRule | null; creator: string; pair: Pair; locale: WorkspaceLocale; onSign: (rule: LaunchSplitRule) => void }) {
  const word = splitWords(locale);
  const lang = coreLang(locale);
  const start = current ?? ZERO_RULE;
  const pct = (bps: number) => (bps ? String(bps / 100).replace(".", locale === "uk" ? "," : ".") : "");
  const [depth, setDepth] = useState(pct(start.shares.depth));
  const [community, setCommunity] = useState(pct(start.shares.community));
  const [holders, setHolders] = useState(pct(start.shares.holders));
  const [walletText, setWalletText] = useState(start.community ?? "");
  const [walletEdited, setWalletEdited] = useState(false);
  const parts = { depth: bpsOf(depth), community: bpsOf(community), holders: bpsOf(holders) };
  const whole = parts.depth !== null && parts.community !== null && parts.holders !== null;
  const given = whole ? parts.depth! + parts.community! + parts.holders! : null;
  const rule: LaunchSplitRule | null =
    whole && given !== null && given <= 10_000
      ? { shares: { self: 10_000 - given, depth: parts.depth!, community: parts.community!, holders: parts.holders! }, community: parts.community! > 0 ? walletText.trim() || null : null }
      : null;
  const problems = rule ? splitProblems(rule, creator) : ["NOT_ALL"];
  const raise = rule && current ? splitRaiseProblems(current, rule) : [];
  const ok = rule !== null && problems.length === 0 && raise.length === 0;
  /* Why «Підписати» waits, in the creator's words — the first reason; an empty form says nothing yet. */
  const touched = depth !== pct(start.shares.depth) || community !== pct(start.shares.community) || holders !== pct(start.shares.holders) || walletText !== (start.community ?? "");
  const reason = !touched ? null : !whole ? "NOT_WHOLE" : given !== null && given > 10_000 ? "NOT_ALL" : (problems[0] ?? raise[0] ?? null);
  const lines = ok && rule ? splitRuleLines(rule, { since: Math.floor(Date.now() / 1000), pairSymbol: pair.symbol }, locale) : [];
  return (
    <div className={styles.blockStack}>
      <PercentField label={word("percent", { name: word("bucket_depth") })} hint={word("hint_depth")} value={depth} onValue={setDepth} bad={parts.depth === null} />
      <PercentField label={word("percent", { name: word("bucket_community") })} hint={word("hint_community")} value={community} onValue={setCommunity} bad={parts.community === null} />
      {(parts.community ?? 0) > 0 ? <WalletField label={word("wallet")} hint={word("walletHint")} value={walletText} onValue={(value) => {
            setWalletEdited(true);
            setWalletText(value);
          }} disabled={Boolean(current?.community)} bad={walletEdited && problems.some((code) => code.startsWith("COMMUNITY") || code === "NOT_AN_ADDRESS")} /> : null}
      <PercentField label={word("percent", { name: word("bucket_holders") })} hint={word("hint_holders")} value={holders} onValue={setHolders} bad={parts.holders === null} />
      <p className={styles.label} aria-live="polite">
        {word("selfLeft", { pct: rule ? formatBps(rule.shares.self, locale) : "—" })}
      </p>
      {lines.length ? (
        <div>
          <p className={styles.mineSharesTitle}>{word("preview")}</p>
          <ul className={styles.boostLines}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {reason && `problem_${reason}` in SPLIT_WORDS ? (
        <p className={styles.problem} role="status">
          {word(`problem_${reason}` as SplitWordKey)}
        </p>
      ) : null}
      <Button variant="primary" onClick={() => rule && onSign(rule)} disabled={!ok} lang={lang}>
        {current ? word("raise") : word("write")}
      </Button>
    </div>
  );
}

function PercentField({ label, hint, value, onValue, bad }: { label: string; hint: string; value: string; onValue: (value: string) => void; bad: boolean }) {
  const id = useId();
  return (
    <div className={styles.field} data-invalid={bad ? "" : undefined}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input id={id} className={`${styles.input} ${styles.mono}`} value={value} onChange={(event) => onValue(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0" aria-invalid={bad || undefined} />
      <span className={styles.hint}>{hint}</span>
    </div>
  );
}

function WalletField({ label, hint, value, onValue, disabled, bad }: { label: string; hint: string; value: string; onValue: (value: string) => void; disabled: boolean; bad: boolean }) {
  const id = useId();
  return (
    <div className={styles.field} data-invalid={bad ? "" : undefined}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input id={id} className={`${styles.input} ${styles.mono}`} value={value} onChange={(event) => onValue(event.target.value)} autoComplete="off" spellCheck={false} disabled={disabled} />
      <span className={styles.hint}>{hint}</span>
    </div>
  );
}
