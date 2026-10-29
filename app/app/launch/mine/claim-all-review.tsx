"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import { Review } from "@ryntra/core/ui";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchClaimReviewResponse } from "@/lib/api/v1/contract";
import { reviewSol, reviewWord } from "@/lib/ticket/review-words";

import { coreLang, Reading } from "../launch-blocks";
import { explorerUrl, formatBps, formatDate, shortAddress } from "../launch-format";
import styles from "../launch.module.css";
import { exact } from "./cabinet-figures";
import own from "./cabinet.module.css";
import { claimAllWords } from "./claim-all-words";

type ReviewRead = LaunchClaimReviewResponse;
type Pocket = ReviewRead["pockets"][number];

/**
 * «Забрати все» (SOL-L12) — the core's Review before one signature: what the wallet receives and what it costs; every
 * pocket of the creator's side and what this claim does about it; each transaction the wallet signs and what it takes;
 * the locked position as the NFT it is — who holds it, locked for ever. A press deeper: the NFT, what sending it does,
 * the surplus as Meteora splits it and the unlock calendar.
 */
export function ClaimAllReview({
  review,
  symbol,
  wallet,
  locale,
  signing,
  onSign,
  onCancel,
}: {
  review: ReviewRead;
  symbol: string;
  wallet: string;
  locale: WorkspaceLocale;
  signing: boolean;
  onSign: () => void;
  onCancel: () => void;
}) {
  const say = claimAllWords(locale);
  const lang = coreLang(locale);
  const pair = review.pair;
  const network = review.network;
  const count = review.transactions.length;
  const pocketWord = (id: Pocket["pocket"]) => say(`pocket_${id}`);
  const stateText = (pocket: Pocket) => {
    if (pocket.state === "IN_CLAIM") return say("state_IN_CLAIM", { n: pocket.transaction ?? 1 });
    if (pocket.state === "NOT_YOURS") return say("state_NOT_YOURS", { holder: pocket.holder ? shortAddress(pocket.holder) : "—" });
    return say(`state_${pocket.state}`);
  };
  /* A pocket's figure in the pair currency; a withheld transfer fee is the launched token's and is only named. */
  const figure = (pocket: Pocket) => (pocket.amountRaw === null || pocket.pocket === "transferFee" || BigInt(pocket.amountRaw) === 0n ? null : exact(pocket.amountRaw, pair, locale));
  const network_ = review.networkCostLamports === null ? say("networkCostUnknown") : reviewSol(BigInt(review.networkCostLamports), lang);
  const txWhat = (tx: ReviewRead["transactions"][number]) => {
    const what = tx.sources.map((source) => pocketWord(source)).join(", ");
    if (!review.shared) return what;
    return [what ? say("txFundsVault", { what }) : "", tx.payout ? say("txPayout") : ""].filter(Boolean).join("; ");
  };
  const position = review.position;
  const holderWord = position ? (position.holderIs === "OTHER" && position.holder ? shortAddress(position.holder) : say(`holder_${position.holderIs === "OTHER" ? "UNREAD" : position.holderIs}`)) : "";
  return (
    <Review
      className={own.claimReview}
      lang={lang}
      titleAs="h3"
      data-claim-review=""
      title={say("reviewTitle", { symbol })}
      pay={reviewWord(lang, "onlyNetwork")}
      get={review.blockedBy ? "—" : exact(review.expectedRaw, pair, locale)}
      costs={[
        { label: reviewWord(lang, "ryntra"), value: reviewWord(lang, "none") },
        { label: reviewWord(lang, "network"), value: network_ },
      ]}
      costsTotal={network_}
      rows={[
        ...review.pockets.map((pocket) => ({
          label: pocketWord(pocket.pocket),
          value: (
            <span data-pocket={pocket.pocket} data-state={pocket.state}>
              {figure(pocket) ? `${figure(pocket)} · ` : ""}
              {stateText(pocket)}
            </span>
          ),
        })),
        ...review.transactions.map((tx) => ({ label: say("txRow", { n: tx.index }), value: txWhat(tx) })),
        ...(position
          ? [{ label: say("positionRow"), value: say("positionValue", { holder: holderWord, lock: position.forever ? say("positionLocked") : say("positionLockedPart", { pct: formatBps(position.permanentBps, locale) }) }) }]
          : []),
      ]}
      whatItIs={review.blockedBy ? say("whatItIsBlocked", { symbol }) : count > 0 ? say("whatItIs", { symbol, n: count }) : say("whatItIsNothing", { symbol })}
      signer={<span translate="no">{shortAddress(wallet)}</span>}
      ready={count > 0 && review.blockedBy === null}
      blockedReason={review.blockedBy === "POSITION_MOVED" ? say("blockedMoved") : say("txNothing")}
      signing={signing}
      onCancel={onCancel}
      onConfirm={onSign}
      risk={reviewWord(lang, "walletShowsFee")}
      details={
        <div className={own.claimDetails}>
          {position ? (
            <>
              <p className={own.claimDetailsTitle}>{say("positionTitle")}</p>
              <dl className={styles.rows}>
                <div className={styles.row}>
                  <dt>{say("positionHolder")}</dt>
                  <dd>
                    {position.holder ? (
                      <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(network, "account", position.holder)} target="_blank" rel="noreferrer noopener">
                        {holderWord} <ArrowSquareOut size={12} aria-hidden />
                      </a>
                    ) : (
                      holderWord
                    )}
                  </dd>
                </div>
                <div className={styles.row}>
                  <dt>NFT</dt>
                  <dd>
                    <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(network, "account", position.nftMint)} target="_blank" rel="noreferrer noopener">
                      {shortAddress(position.nftMint)} <ArrowSquareOut size={12} aria-hidden />
                    </a>
                  </dd>
                </div>
              </dl>
              <p className={styles.hint}>{position.holderIs === "OTHER" ? say("positionGone") : say("positionSend")}</p>
            </>
          ) : null}
          {review.pockets.some((pocket) => pocket.pocket === "leftover" && pocket.state === "NOT_YOURS") ? <p className={styles.hint}>{say("leftoverHint")}</p> : null}
          {review.pockets.some((pocket) => pocket.state === "CLOSED") ? <p className={styles.hint}>{say("closedNote")}</p> : null}
          {review.surplus ? (
            <p className={styles.hint}>
              {say("surplusSplit", {
                total: exact(review.surplus.totalRaw, pair, locale),
                creator: exact(review.surplus.creatorRaw, pair, locale),
                partner: exact(review.surplus.partnerRaw, pair, locale),
                protocol: exact(review.surplus.protocolRaw, pair, locale),
              })}
            </p>
          ) : null}
          {review.lock || position?.forever ? (
            <>
              <p className={own.claimDetailsTitle}>{say("calendarTitle")}</p>
              <dl className={styles.rows}>
                {review.lock ? (
                  <>
                    <div className={styles.row}>
                      <dt>{say("calendarTokensCliff")}</dt>
                      <dd>{formatDate(review.lock.cliffAt, locale)}</dd>
                    </div>
                    <div className={styles.row}>
                      <dt>{say("calendarTokensEnd")}</dt>
                      <dd>{formatDate(review.lock.endAt, locale)}</dd>
                    </div>
                  </>
                ) : null}
                {position?.forever ? (
                  <div className={styles.row}>
                    <dt>{say("calendarLp")}</dt>
                    <dd>{say("calendarNever")}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : null}
        </div>
      }
    />
  );
}

/** While the pockets are read: the cabinet's own reading lines. */
export function ClaimAllReading({ locale }: { locale: WorkspaceLocale }) {
  return <Reading label={claimAllWords(locale)("reviewReading")} lines={3} />;
}
