"use client";

import { ArrowRight, Check } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Help } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { formatUsdPrice } from "@/app/solana/workspace/spot/spot-format";
import { WalletChoices } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { PlanAssetRead, TradingPlan } from "@/lib/api/v1/contract";
import { LOSS_LIMIT_PRESETS, lossLimitPurchase, type LossLimitPreset } from "@/lib/plans/purchase";

import { wordsFor } from "../stock-model";
import styles from "../stocks.module.css";
import { announceBuyActions } from "./buy-actions";

/**
 * The purchase with a loss limit on the buy card — the loop made visible:
 *
 * - **Намір · intent** — the person's amount on the card and one preset;
 * - **Межі · limits** — the published rules (`lib/plans/purchase.ts`) turn
 *   them into the plan: the limit, the target, the most that can be lost,
 *   the price bound — figures of the rules, never of a model;
 * - **Дозвіл · permission** — «Прийняти й підписати» writes the plan (the
 *   wallet's proof first) and opens Spot's Review bound to it with the same
 *   amount; the Review checks the plan and the person's wallet signs;
 * - **Виконання · доказ** — the swap and its receipt, in Spot, unchanged;
 * - **Нагляд · oversight** — the bought plan is watched as a position for its
 *   loss limit (`lib/monitoring/position.ts`), in Telegram once connected.
 *
 * Nothing here signs, buys or sells; the status says «Запропоновано · нічого
 * не куплено» until the person acts, and it never says more than happened.
 */

export function LossLimitPresets({ value, onChange, locale }: { value: LossLimitPreset | null; onChange: (value: LossLimitPreset | null) => void; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const options: ReadonlyArray<{ id: LossLimitPreset | null; label: string; pct: string | null }> = [
    { id: null, label: word("noLimit"), pct: null },
    { id: "careful", label: word("presetCareful"), pct: `−${LOSS_LIMIT_PRESETS.careful.stopPct}%` },
    { id: "balanced", label: word("presetBalanced"), pct: `−${LOSS_LIMIT_PRESETS.balanced.stopPct}%` },
  ];
  return (
    <div className={styles.limitRow}>
      <span className={styles.limitLabel} id="loss-limit-label">
        {word("lossLimit")}
      </span>
      <div className={styles.limitPresets} role="group" aria-labelledby="loss-limit-label">
        {options.map((option) => (
          <button key={option.id ?? "none"} type="button" className={styles.limitPreset} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
            <span>{option.label}</span>
            {option.pct ? <span>{option.pct}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

type Phase = Readonly<{ status: "idle" | "writing" | "failed"; message: string | null }>;
type AssetRead = Readonly<{ status: "loading" | "ready" | "failed"; read: PlanAssetRead | null }>;
type Channel = Readonly<{ status: "unknown" | "connected" | "none"; username: string | null }>;

const API_HEADERS = { accept: "application/json", "X-Ryntra-API": "1" } as const;

export function LossLimitCard({
  mint,
  amountUsd,
  preset,
  planHref,
  actionId,
  locale,
}: {
  mint: string;
  amountUsd: number;
  preset: LossLimitPreset;
  /** The full builder — «Своє», any limit the person writes. */
  planHref: string;
  /** The id the page's Buy watches, so one orange action stands on a screen. */
  actionId: string;
  locale: WorkspaceLocale;
}) {
  const word = wordsFor(locale);
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const router = useRouter();
  const { connection, wallets } = useSolanaConnection();
  const { text } = useSolanaI18n();
  const proof = useWalletProof();
  const [asset, setAsset] = useState<AssetRead>({ status: "loading", read: null });
  const [channel, setChannel] = useState<Channel>({ status: "unknown", username: null });
  const [phase, setPhase] = useState<Phase>({ status: "idle", message: null });
  /* The clock the rules are written at: read once when the card opens, so a re-render never moves the entry's window. */
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    /* The asset the plan will carry and the planning price, read the way the plan's own write will resolve it. */
    let live = true;
    setAsset({ status: "loading", read: null });
    fetch(`/api/v1/plans/asset?mint=${encodeURIComponent(mint)}`, { headers: API_HEADERS })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as PlanAssetRead | null;
        if (!live) return;
        setAsset(response.ok && body?.asset ? { status: "ready", read: body } : { status: "failed", read: null });
      })
      .catch(() => {
        if (live) setAsset({ status: "failed", read: null });
      });
    return () => {
      live = false;
    };
  }, [mint]);

  const proven = proof.state.status === "proven";
  const walletAddress = connection?.address ?? null;
  useEffect(() => {
    /* A wallet connected or confirmed draws the one action anew; the page's Buy watches the new one. */
    announceBuyActions();
  }, [walletAddress, proven]);

  useEffect(() => {
    /* The channel Ryntra warns through, read only for the proven wallet; the card never guesses it. */
    if (!proven) {
      setChannel({ status: "unknown", username: null });
      return;
    }
    let live = true;
    fetch("/api/v1/notifications/telegram", { headers: API_HEADERS })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { telegram?: { connected?: boolean; username?: string | null } } | null;
        if (!live) return;
        const connected = response.ok && body?.telegram?.connected === true;
        setChannel({ status: connected ? "connected" : "none", username: connected ? (body?.telegram?.username ?? null) : null });
      })
      .catch(() => {
        if (live) setChannel({ status: "unknown", username: null });
      });
    return () => {
      live = false;
    };
  }, [proven]);

  const read = asset.read;
  const unitBasis = read?.asset.unitBasis ?? "share";
  const unitWord = unitBasis === "token" ? word("perToken") : word("perShare");
  const presetWord = preset === "careful" ? word("presetCareful") : word("presetBalanced");
  const { stopPct, targetPct } = LOSS_LIMIT_PRESETS[preset];
  const made = useMemo(() => {
    const price = read?.planningPrice?.perUnit ?? null;
    if (price === null) return null;
    const thesis =
      locale === "uk"
        ? `Купівля з межею збитку · ${presetWord}: межа −${stopPct}%, ціль +${targetPct}%.`
        : `Purchase with a loss limit · ${presetWord}: limit −${stopPct}%, target +${targetPct}%.`;
    return lossLimitPurchase({ amountUsd, pricePerUnit: price, preset, hasReference: read?.planningPrice?.source === "issuer-reference", thesis, nowMs });
  }, [read, amountUsd, preset, presetWord, stopPct, targetPct, locale, nowMs]);

  const accept = async () => {
    if (!made) return;
    setPhase({ status: "writing", message: null });
    try {
      const response = await fetch("/api/v1/plans", {
        method: "POST",
        headers: { ...API_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ asset: { mint }, rules: made.rules, activate: true }),
      });
      const body = (await response.json().catch(() => null)) as { plan?: TradingPlan; error?: { code?: string; message?: string } } | null;
      if (response.ok && body?.plan) {
        /* Permission is the Review and the signature: Spot's ticket on this mint, bound to the plan, with the same amount. */
        router.push(`/app/spot?view=stock&mint=${encodeURIComponent(mint)}&plan=${encodeURIComponent(body.plan.id)}&v=${body.plan.version}&side=buy&amount=${encodeURIComponent(String(amountUsd))}`);
        return;
      }
      setPhase({ status: "failed", message: word("planWriteFailed") });
    } catch {
      setPhase({ status: "failed", message: word("planWriteFailed") });
    }
  };

  const steps: ReadonlyArray<{ label: string; done: boolean }> = [
    { label: word("loopIntent"), done: true },
    { label: word("loopLimits"), done: made !== null },
    { label: word("loopPermission"), done: false },
    { label: word("loopExecution"), done: false },
    { label: word("loopProof"), done: false },
    { label: word("loopOversight"), done: false },
  ];

  return (
    <div className={styles.limitCard} aria-live="polite">
      <div className={styles.limitHead}>
        <b>{word("preparedBy")}</b>
        <span>{word("fromYourFigures")}</span>
      </div>

      {asset.status === "loading" ? <div className={`${styles.bone} ${styles.limitBone}`} aria-busy="true" /> : null}
      {asset.status === "failed" || (asset.status === "ready" && made === null) ? (
        <p className={styles.quoteStatus} data-kind="failed" role="status">
          {word("planPriceUnavailable")}
        </p>
      ) : null}

      {made ? (
        <dl className={styles.facts}>
          <div>
            <dt>{word("canLose")}</dt>
            <dd translate="no">
              {`${word("approx")} ${formatUsdPrice(made.canLoseUsd, numberLocale)}`}
              <span className={styles.factSub}>{`${word("limitAt")} ${formatUsdPrice(made.limitPerUnit, numberLocale)} ${unitWord} · −${stopPct}%`}</span>
            </dd>
          </div>
          <div>
            <dt>{word("sellIfReaches")}</dt>
            <dd translate="no">
              {formatUsdPrice(made.targetPerUnit, numberLocale)}
              <span className={styles.factSub}>{`+${targetPct}% · ${locale === "uk" ? "правило твого плану, не ордер" : "your plan's rule, not an order"}`}</span>
            </dd>
          </div>
          <div>
            <dt>{word("protection")}</dt>
            {channel.status === "connected" ? (
              <dd data-prose="true">
                {word("ryntraWarns")}
                <span className={styles.factSub}>{channel.username ? `Telegram · @${channel.username}` : "Telegram"}</span>
              </dd>
            ) : channel.status === "none" ? (
              <dd data-prose="true" data-tone="caution">
                {word("noProtection")}
                <span className={styles.factSub}>
                  <Link href="/app/settings#account" prefetch={false}>
                    {word("connectTelegramToWarn")}
                  </Link>
                </span>
              </dd>
            ) : (
              <dd data-prose="true">
                {word("ryntraWarns")}
                <span className={styles.factSub}>{word("protectionAfterProof")}</span>
              </dd>
            )}
          </div>
          <div>
            <dt>{word("cardStatus")}</dt>
            <dd data-prose="true">{phase.status === "writing" ? word("preparing") : word("proposed")}</dd>
          </div>
        </dl>
      ) : null}

      {/* The loop, one line: what is done and what comes next — nothing advances without its evidence. */}
      <ol className={styles.loop} aria-label={locale === "uk" ? "Петля покупки" : "The purchase loop"}>
        {steps.map((step, index) => (
          <li key={step.label} data-done={step.done} data-next={!step.done && steps.slice(0, index).every((before) => before.done)}>
            {step.done ? <Check size={12} weight="bold" aria-hidden="true" /> : null}
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      <p className={styles.limitWarning}>
        <span>{word("canLoseAll")}</span>
        <Help topic="lossLimitWarning" locale={locale} label={word("canLoseAll")} />
      </p>

      {phase.status === "failed" && phase.message ? (
        <p className={styles.quoteStatus} data-kind="failed" role="status">
          {phase.message}
        </p>
      ) : null}

      <div className={styles.quoteActions}>
        {!connection ? (
          /* No wallet yet: the choice of wallet is the one action here — or, with none in this browser, which ones work. */
          wallets.length === 0 ? (
            <p className={styles.quoteStatus} role="status">
              {`${text("No Solana wallet in this browser.")} ${text("Phantom, Solflare and Backpack all work.")}`}
            </p>
          ) : (
            <WalletChoices single="button" />
          )
        ) : !proven ? (
          <button id={actionId} type="button" className="rw-btn rw-btn--primary" onClick={() => void proof.prove()} disabled={proof.state.status === "signing" || proof.state.status === "checking"}>
            <span>{proof.state.status === "signing" ? word("confirmingWallet") : word("confirmWalletToAccept")}</span>
          </button>
        ) : (
          <button id={actionId} type="button" className="rw-btn rw-btn--primary" onClick={() => void accept()} disabled={!made || phase.status === "writing"}>
            <span>{phase.status === "writing" ? word("preparing") : word("acceptAndSign")}</span>
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </button>
        )}
        <Link className="rw-btn" href={planHref} prefetch={false}>
          {word("planThisPurchase")}
        </Link>
      </div>
    </div>
  );
}
