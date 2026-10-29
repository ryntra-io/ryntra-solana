"use client";

import { Block, Button, Skeleton } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { dollars } from "@/lib/rewards/format";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { REWARDS_CHANGED_EVENT } from "../rewards/header-rewards.tsx";
import { rankCopy } from "../rewards/rank-copy.ts";
import { useWalletFact, useWalletProof } from "../wallet-proof.tsx";
import { pointsScale, REWARDS_REREAD_MS, rewardsReadOf, rewardsShown, type ProofPhase, type RewardsPoints, type RewardsRead } from "./portfolio-model.ts";
import { portfolioWords } from "./portfolio-words.ts";
import styles from "./holdings.module.css";

/**
 * «Винагороди» in Portfolio (B5): one number of points and the way to Rewards.
 *
 * ## One number, the same one
 *
 * The points are the rank's points over its window — the figure Rewards draws
 * in its ring — read from the same field of the same answer (`/api/rewards`,
 * `rank.points`) and written by the same words (`rankCopy`). There is no
 * second count of points anywhere: Portfolio never adds, converts or rounds
 * them. The header draws no points (Menu 3, decision 55: the header is the
 * logo, search, balance, wallet and the assistant), so Rewards is the place
 * this number has to agree with.
 *
 * ## Deliberately not part of the total
 *
 * What is gathered in Rewards is a claim against Ryntra, not an asset in the
 * wallet: it is said here, never added to the value above. Once claimed, the
 * USDC arrives on chain and the total picks it up through the balance read.
 *
 * ## Deliberately not a second Rewards page
 *
 * A figure, the rank it belongs to, what is gathered, and the way there. No
 * claim, no referral, no ladder: a person presses «Забрати» in one place.
 */
export function RewardsBlock() {
  const { connection } = useSolanaConnection();
  const { locale } = useSolanaI18n();
  const proof = useWalletProof();
  const fact = useWalletFact();
  const words = portfolioWords(locale);
  const copy = rankCopy(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const address = connection?.address ?? null;
  const proven = proof.state.status === "proven" && proof.state.address === address;
  const phase: ProofPhase = proven
    ? "proven"
    : fact.status === "down"
      ? "down"
      : proof.state.status === "idle" || proof.state.status === "checking" || proof.state.status === "signing"
        ? "settling"
        : "unproven";
  const [read, setRead] = useState<Readonly<{ address: string; value: RewardsRead }> | null>(null);
  /* Several reads can be in flight (the tab coming back, a retry): only the latest answer is kept, the one before it is cancelled. */
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /* When the last answer came, for this address: the route replays benefit jobs, so a returning tab does not ask again within a minute. */
  const answeredAt = useRef<Readonly<{ address: string; at: number }> | null>(null);

  const load = useCallback(async () => {
    if (!address || !proven) return;
    const ask = ++latest.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const response = await fetch(`/api/rewards?address=${encodeURIComponent(address)}&locale=${locale}`, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (ask !== latest.current || controller.signal.aborted) return;
      const value = rewardsReadOf(response.status, body, address);
      if (value.status === "ready") answeredAt.current = { address, at: Date.now() };
      setRead({ address, value });
    } catch {
      /* Portfolio must not fail because Rewards did; a cancelled read is replaced by the one that cancelled it. */
      if (ask === latest.current && !controller.signal.aborted) setRead({ address, value: { status: "failed" } });
    }
  }, [address, proven, locale]);

  useEffect(() => {
    void load();
    return () => inFlight.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!address || !proven) return undefined;
    const onChanged = () => void load();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = answeredAt.current;
      if (last && last.address === address && Date.now() - last.at < REWARDS_REREAD_MS) return;
      void load();
    };
    window.addEventListener(REWARDS_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(REWARDS_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [address, proven, load]);

  const value = rewardsShown({ address, proof: phase, read });
  if (!value) return null;

  const action =
    value.status === "failed" && phase === "proven" ? (
      <Button
        variant="secondary"
        onClick={() => {
          /* The press shows at once: the block reads again, then answers. */
          if (address) setRead({ address, value: { status: "loading" } });
          void load();
        }}
        lang={lang}
      >
        {words.retry}
      </Button>
    ) : (
      <Link className="ryntra-button ryntra-button--secondary" href="/app/rewards" prefetch={false}>
        <span className="ryntra-button__label">{words.rewardsOpen}</span>
      </Link>
    );

  return (
    <Block title={words.rewardsTitle} titleAs="h2" icon="gift" lang={lang} action={action} data-portfolio="rewards" id="portfolio-rewards">
      {value.status === "loading" ? (
        <Skeleton lines={2} label={words.rewardsReading} />
      ) : value.status === "proof" ? (
        <p className={styles.blockSentence}>{words.rewardsProof}</p>
      ) : value.status === "failed" ? (
        <p className={styles.blockSentence}>{words.rewardsUnread}</p>
      ) : (
        <div className={styles.rewardsBody}>
          {value.points ? <Points points={value.points} copy={copy} words={words} /> : <p className={styles.blockSentence}>{words.rewardsPointsUnread}</p>}
          {value.available ? (
            <p className={styles.rewardsGathered} translate="no">
              {words.rewardsGathered(dollars(value.available))}
            </p>
          ) : null}
        </div>
      )}
    </Block>
  );
}

/** The one number, written as the ring writes it — in full below 100 000, then thousands or millions with the full figure read aloud. */
function Points({ points, copy, words }: { points: RewardsPoints; copy: ReturnType<typeof rankCopy>; words: ReturnType<typeof portfolioWords> }) {
  const scale = pointsScale(points.points);
  const compact = scale.scale === "millions" ? copy.millions(scale.value) : scale.scale === "thousands" ? copy.thousands(scale.value) : null;
  const full = `${copy.number(points.points)} ${copy.unit(points.points)}`;
  return (
    <>
      {/* «124k» on the screen, the full figure read aloud — the ring's own way. */}
      <p className={styles.pointsFigure} data-portfolio="points" title={compact ? full : undefined}>
        <strong translate="no" aria-hidden={compact ? true : undefined}>{compact ? compact.figure : copy.number(points.points)}</strong>
        <span aria-hidden={compact ? true : undefined}>{compact ? compact.unit : copy.unit(points.points)}</span>
        {compact ? <span className="ryntra-visually-hidden">{full}</span> : null}
      </p>
      <p className={styles.blockSentence}>{words.rewardsRank(copy.rank[points.rank], copy.window(points.windowDays))}</p>
    </>
  );
}
