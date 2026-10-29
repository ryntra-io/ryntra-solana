"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Receipt, Review } from "@ryntra/core/ui";

import {
  EARN_PROVIDER_NAMES,
  liquidityBand,
  rawFromText,
  textFromRaw,
  type EarnMarket,
  type EarnPosition,
} from "@/lib/earn/model";

import { mayOpenWallet } from "@/lib/solana/blockhash-life";

import { useSolanaConnection } from "../connection.tsx";

import {
  reviewEarn,
  signableMsOf,
  signAndRelay,
  useEarnSurface,
  useFollowedReceipt,
  type EarnReceipt,
  type EarnReview,
  type EarnSurface as Surface,
} from "./earn-api.ts";
import { earnFailureWord, earnWord, type EarnWordKey } from "./earn-words.ts";

import styles from "./earn.module.css";

type Lang = "en" | "uk";
type Action = "deposit" | "withdraw";

/* A Review, its signature and its receipt belong to the wallet they were built for, whatever is connected later. */
type Phase =
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "reviewing" }>
  | Readonly<{ kind: "review"; review: EarnReview; at: number; signer: string }>
  | Readonly<{ kind: "signing"; review: EarnReview; at: number; signer: string }>
  | Readonly<{ kind: "done"; review: EarnReview; receipt: EarnReceipt; at: number; signer: string }>;

/**
 * «Earn» — a person's own asset in a lending market, and what it is doing there.
 *
 * Three things on one page, in the order a person needs them: what the markets pay and whether they can be
 * left today, what this wallet already has in them read from the chain, and the one form that supplies or
 * withdraws through a Review the wallet signs. The page says twice, in words, that Ryntra takes nothing out
 * of it — once at the top and once inside the Review — because that is the fact a person has no way to check
 * for themselves.
 *
 * A provider that cannot be asked gets a row of its own saying so. Nothing here draws an empty market list
 * for a provider nobody could reach.
 */
export function EarnSurface({ initial, lang }: { initial: Surface; lang: Lang }) {
  const w = (key: EarnWordKey, fill?: Readonly<Record<string, string>>) => earnWord(lang, key, fill);
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const [version, setVersion] = useState(0);
  const { surface } = useEarnSurface(initial, owner, version);

  const markets = useMemo(
    () => surface.providers.flatMap((provider) => (provider.ok ? provider.markets : [])),
    [surface.providers],
  );
  const positions = surface.positions;

  return (
    <>
      <header className={styles.head}>
        <h1 className="so-title">{w("title")}</h1>
        <p className={styles.lead}>{w("lead")}</p>
        {/* The row's own word in the menu says «Earn and loans». Borrowing is a separate piece of work, so the
            page says so rather than letting the menu promise it. */}
        <p className={styles.muted}>{w("noLoans")}</p>
        <p className={styles.noFee} data-earn-no-fee="true">
          <strong>{w("noFee")}</strong> {w("noFeeLong")}
        </p>
        <details className={styles.help}>
          <summary>{w("risk")}</summary>
          <p>{w("riskWords")}</p>
          <p>{w("help")}</p>
        </details>
      </header>

      {surface.providers.map((provider) =>
        provider.ok ? (
          <MarketTable key={provider.provider} name={EARN_PROVIDER_NAMES[provider.provider]} markets={provider.markets} lang={lang} intl={intl} />
        ) : (
          <section key={provider.provider} className={styles.block} aria-label={w("unavailable", { provider: EARN_PROVIDER_NAMES[provider.provider] })}>
            <h2 className={styles.blockTitle}>{w("unavailable", { provider: EARN_PROVIDER_NAMES[provider.provider] })}</h2>
            <p className={styles.muted} data-earn-unavailable={provider.code}>
              {provider.code === "NO_KEY"
                ? w("unavailableNoKey")
                : provider.code === "DISABLED"
                  ? w("unavailableDisabled")
                  : provider.code === "UNREADABLE"
                    ? w("unavailableUnreadable")
                    : w("unavailableDown")}
            </p>
          </section>
        ),
      )}

      <section className={styles.block} aria-label={w("positions")}>
        <h2 className={styles.blockTitle}>{w("positions")}</h2>
        {!owner ? (
          <p className={styles.muted}>{w("connectHint")}</p>
        ) : positions.length === 0 ? (
          <p className={styles.muted}>{w("noPositions")}</p>
        ) : (
          <ul className={styles.positions}>
            {positions.map((position) => (
              <PositionRow key={`${position.provider}:${position.marketId}`} position={position} lang={lang} intl={intl} />
            ))}
          </ul>
        )}
      </section>

      <EarnForm
        surface={surface}
        markets={markets}
        positions={positions}
        owner={owner}
        wallet={connection ? { wallet: connection.wallet, address: connection.address } : null}
        lang={lang}
        intl={intl}
        onFinished={() => setVersion((seen) => seen + 1)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ figures */

const percent = (value: number | null, intl: string) =>
  value === null ? null : new Intl.NumberFormat(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** An amount with its ticker. Every digit the asset has: a figure that is signed for is never rounded away. */
function amountWith(raw: string | null, asset: EarnMarket["asset"], intl: string): string | null {
  if (raw === null) return null;
  const text = textFromRaw(raw, asset.decimals, Math.min(asset.decimals, 6));
  const [whole, fraction] = text.split(".");
  const grouped = new Intl.NumberFormat(intl, { maximumFractionDigits: 0 }).format(BigInt(whole ?? "0"));
  return `${fraction ? `${grouped}.${fraction}` : grouped}${asset.symbol ? ` ${asset.symbol}` : ""}`;
}

function MarketTable({ name, markets, lang, intl }: { name: string; markets: readonly EarnMarket[]; lang: Lang; intl: string }) {
  const w = (key: EarnWordKey, fill?: Readonly<Record<string, string>>) => earnWord(lang, key, fill);
  return (
    <section className={styles.block} aria-label={w("marketsOf", { provider: name })}>
      <h2 className={styles.blockTitle}>{w("marketsOf", { provider: name })}</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{w("asset")}</th>
              <th scope="col">{w("rate")}</th>
              <th scope="col">{w("liquidity")}</th>
              <th scope="col">{w("risk")}</th>
              <th scope="col">{w("minimum")}</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((market) => {
              const band = liquidityBand(market);
              const rate = percent(market.rateAnnualPercent, intl);
              return (
                <tr key={`${market.provider}:${market.id}`} data-earn-market={market.asset.symbol || market.id}>
                  <th scope="row" translate="no">
                    {market.asset.symbol || market.id.slice(0, 6)}
                  </th>
                  <td data-label={w("rate")}>{rate === null ? w("notRead") : w("ratePerYear", { x: rate })}</td>
                  <td data-label={w("liquidity")}>{amountWith(market.liquidRaw, market.asset, intl) ?? w("notRead")}</td>
                  <td data-label={w("risk")} data-earn-band={band}>
                    {band === "full" ? w("riskFull") : band === "partial" ? w("riskPartial") : band === "none" ? w("riskNone") : w("riskUnknown")}
                  </td>
                  <td data-label={w("minimum")}>{amountWith(market.minimumRaw, market.asset, intl) ?? w("notRead")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One position as the chain has it.
 *
 * Four figures, and any of them may be «not read» — which is the whole point. «Earned» is the worth now less
 * what went in, so it needs both; «available now» is the position or the market's liquidity, whichever is
 * smaller. A dash would read as zero, so the words say «not read» instead.
 */
function PositionRow({ position, lang, intl }: { position: EarnPosition; lang: Lang; intl: string }) {
  const w = (key: EarnWordKey, fill?: Readonly<Record<string, string>>) => earnWord(lang, key, fill);
  const time = new Date(position.readAt).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" });
  return (
    <li className={styles.position} data-earn-position={position.marketId}>
      <p className={styles.positionHead}>
        <strong translate="no">{position.asset.symbol || position.marketId.slice(0, 6)}</strong>{" "}
        <span className={styles.muted} translate="no">
          {EARN_PROVIDER_NAMES[position.provider]}
        </span>
      </p>
      <dl className={styles.figures}>
        <div>
          <dt>{w("supplied")}</dt>
          <dd>{amountWith(position.underlyingRaw, position.asset, intl) ?? w("notRead")}</dd>
        </div>
        <div>
          <dt>{w("deposited")}</dt>
          <dd>{amountWith(position.depositedRaw, position.asset, intl) ?? w("notRead")}</dd>
        </div>
        <div>
          <dt>{w("earned")}</dt>
          <dd>{amountWith(position.earnedRaw, position.asset, intl) ?? w("notRead")}</dd>
        </div>
        <div>
          <dt>{w("availableNow")}</dt>
          <dd>{amountWith(position.availableRaw, position.asset, intl) ?? w("notRead")}</dd>
        </div>
      </dl>
      <p className={styles.muted}>{position.sharesRaw === null ? w("positionUnread") : w("readFromChain", { time })}</p>
    </li>
  );
}

/* --------------------------------------------------------------- the action */

function EarnForm({
  surface,
  markets,
  positions,
  owner,
  wallet,
  lang,
  intl,
  onFinished,
}: {
  surface: Surface;
  markets: readonly EarnMarket[];
  positions: readonly EarnPosition[];
  owner: string | null;
  wallet: Readonly<{ wallet: string; address: string }> | null;
  lang: Lang;
  intl: string;
  onFinished: () => void;
}) {
  const w = (key: EarnWordKey, fill?: Readonly<Record<string, string>>) => earnWord(lang, key, fill);
  const [action, setAction] = useState<Action>("deposit");
  const [marketKey, setMarketKey] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [failure, setFailure] = useState<string | null>(null);
  /* Each Review is one attempt: an answer for an older one — another wallet, a Review asked again — is
     dropped. A signature already given is not, so a receipt survives a wallet change. */
  const attempt = useRef(0);
  const signing = useRef(false);

  useEffect(() => {
    if (signing.current) return;
    attempt.current += 1;
    setPhase((current) => (current.kind === "done" ? current : { kind: "edit" }));
    setFailure(null);
  }, [owner]);

  const market = markets.find((entry) => `${entry.provider}:${entry.id}` === marketKey) ?? markets[0] ?? null;
  const position = market ? positions.find((entry) => entry.provider === market.provider && entry.marketId === market.id) ?? null : null;
  const asked = market ? rawFromText(text, market.asset.decimals) : null;

  if (phase.kind === "done") {
    return (
      <EarnReceipt
        review={phase.review}
        receipt={phase.receipt}
        lang={lang}
        intl={intl}
        onAgain={() => {
          setPhase({ kind: "edit" });
          setText("");
          onFinished();
        }}
      />
    );
  }

  if (phase.kind === "review" || phase.kind === "signing") {
    return (
      <ReviewCard
        review={phase.review}
        lang={lang}
        intl={intl}
        signing={phase.kind === "signing"}
        failure={failure}
        onCancel={() => {
          setPhase({ kind: "edit" });
          setFailure(null);
        }}
        onConfirm={async () => {
          if (!wallet || phase.kind !== "review") return;
          /* A wallet is not opened on bytes that cannot land any more: the person would sign something the
             chain would refuse, and a refusal after a signature reads as a loss. */
          if (!mayOpenWallet({ receivedAtMs: phase.at, signableMs: signableMsOf(phase.review) })) {
            setFailure("REVIEW_AGED");
            setPhase({ kind: "edit" });
            return;
          }
          const mine = attempt.current;
          signing.current = true;
          setPhase({ kind: "signing", review: phase.review, at: phase.at, signer: phase.signer });
          const relayed = await signAndRelay(wallet, phase.review, phase.at);
          signing.current = false;
          if (!relayed.ok) {
            setFailure(relayed.code);
            if (mine === attempt.current) setPhase({ kind: "review", review: phase.review, at: phase.at, signer: phase.signer });
            return;
          }
          setFailure(null);
          setPhase({ kind: "done", review: phase.review, receipt: relayed.value, at: phase.at, signer: phase.signer });
        }}
      />
    );
  }

  const open = surface.actions.open && owner !== null && wallet !== null;

  return (
    <section className={styles.block} aria-label={w("deposit")}>
      <h2 className={styles.blockTitle}>{action === "deposit" ? w("deposit") : w("withdraw")}</h2>
      {!open && <p className={styles.muted} data-earn-actions="closed">{owner === null ? w("connectHint") : w("closed")}</p>}
      <div className={styles.tabs} role="group">
        <Button variant={action === "deposit" ? "primary" : "ghost"} onClick={() => setAction("deposit")}>
          {w("deposit")}
        </Button>
        <Button variant={action === "withdraw" ? "primary" : "ghost"} onClick={() => setAction("withdraw")}>
          {w("withdraw")}
        </Button>
      </div>

      <label className={styles.field}>
        <span>{w("asset")}</span>
        <select
          value={market ? `${market.provider}:${market.id}` : ""}
          onChange={(event) => setMarketKey(event.target.value)}
          disabled={markets.length === 0}
        >
          {markets.map((entry) => (
            <option key={`${entry.provider}:${entry.id}`} value={`${entry.provider}:${entry.id}`}>
              {`${entry.asset.symbol || entry.id.slice(0, 6)} · ${EARN_PROVIDER_NAMES[entry.provider]}`}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>{w("amount")}</span>
        <input
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="0.00"
          disabled={!open || !market}
        />
      </label>
      {action === "withdraw" && position?.availableRaw && market && (
        <p className={styles.muted}>
          {w("availableNow")}: {amountWith(position.availableRaw, market.asset, intl)}{" "}
          <Button variant="ghost" onClick={() => setText(textFromRaw(position.availableRaw!, market.asset.decimals))}>
            {w("max")}
          </Button>
        </p>
      )}

      {failure && (
        <p className={styles.failure} role="status" data-earn-failure={failure}>
          {earnFailureWord(lang, failure)}
        </p>
      )}

      <Button
        variant="primary"
        disabled={!open || !market || asked === null || asked <= 0n || phase.kind === "reviewing"}
        loading={phase.kind === "reviewing"}
        onClick={async () => {
          if (!market || asked === null || !owner) return;
          setFailure(null);
          setPhase({ kind: "reviewing" });
          const mine = ++attempt.current;
          const answer = await reviewEarn({
            provider: market.provider,
            action,
            owner,
            market: market.id,
            amount: asked.toString(),
          });
          if (mine !== attempt.current) return;
          if (!answer.ok) {
            setFailure(answer.code);
            setPhase({ kind: "edit" });
            return;
          }
          setPhase({ kind: "review", review: answer.value, at: Date.now(), signer: owner });
        }}
      >
        {phase.kind === "reviewing" ? w("reviewing") : w("reviewAction")}
      </Button>
    </section>
  );
}

/** The Review the wallet is asked to sign: the amounts, the rate, every cost — and Ryntra's, which is none. */
function ReviewCard({
  review,
  lang,
  intl,
  signing,
  failure,
  onCancel,
  onConfirm,
}: {
  review: EarnReview;
  lang: Lang;
  intl: string;
  signing: boolean;
  failure: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const w = (key: EarnWordKey, fill?: Readonly<Record<string, string>>) => earnWord(lang, key, fill);
  const name = EARN_PROVIDER_NAMES[review.provider];
  const amount = amountWith(review.amountRaw, review.asset, intl) ?? review.amountRaw;
  const rate = percent(review.rateAnnualPercent, intl);
  const rateWords = rate === null ? w("notRead") : w("ratePerYear", { x: rate });
  const rows = [
    { label: w("reviewRate"), value: rateWords },
    ...(review.minimumRaw ? [{ label: w("reviewMinimum"), value: amountWith(review.minimumRaw, review.asset, intl) ?? w("notRead") }] : []),
    ...(review.leftRaw ? [{ label: w("reviewLeft"), value: amountWith(review.leftRaw, review.asset, intl) ?? w("notRead") }] : []),
  ];

  return (
    <section className={styles.block}>
      <Review
        lang={lang}
        title={review.action === "deposit" ? w("reviewDepositTitle", { amount, provider: name }) : w("reviewWithdrawTitle", { amount, provider: name })}
        pay={review.action === "deposit" ? w("reviewPay", { amount }) : amountWith(review.amountRaw, review.share, intl) ?? amount}
        get={review.action === "deposit" ? w("reviewGet", { amount, rate: rateWords }) : w("reviewGetBack", { amount })}
        costs={[
          { label: w("costsRyntra"), value: w("costsNothing") },
          { label: w("costsProvider"), value: w("costsNothing") },
          { label: w("costsNetwork"), value: w("costsPaidByWallet") },
        ]}
        costsTotal={w("noFee")}
        rows={rows}
        whatItIs={w("reviewWhatItIs", { provider: name })}
        signer={w("reviewSigner")}
        signWith="wallet"
        ready={!signing}
        signing={signing}
        risk={review.partial ? w("reviewPartial", { amount, left: amountWith(review.leftRaw, review.asset, intl) ?? "" }) : w("reviewRateMoves")}
        details={w("noFeeLong")}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
      {failure && (
        <p className={styles.failure} role="status" data-earn-failure={failure}>
          {earnFailureWord(lang, failure)}
        </p>
      )}
    </section>
  );
}

/** The record: what was signed, what the chain did with it, and the zero fee stated once more. */
function EarnReceipt({
  review,
  receipt,
  lang,
  intl,
  onAgain,
}: {
  review: EarnReview;
  receipt: EarnReceipt;
  lang: Lang;
  intl: string;
  onAgain: () => void;
}) {
  const w = (key: EarnWordKey, fill?: Readonly<Record<string, string>>) => earnWord(lang, key, fill);
  const followed = useFollowedReceipt(receipt);
  const name = EARN_PROVIDER_NAMES[followed.provider];
  const amount = amountWith(followed.amountRaw, followed.asset, intl) ?? followed.amountRaw;
  const rate = percent(followed.rateAnnualPercent, intl);
  const status = followed.state === "LANDED" ? "completed" : followed.state === "FAILED" ? "failed" : "unknown";
  return (
    <section className={styles.block}>
      <Receipt
        lang={lang}
        variant="full"
        title={followed.action === "deposit" ? w("receiptDeposit", { provider: name }) : w("receiptWithdraw", { provider: name })}
        status={status}
        amount={`${followed.action === "deposit" ? "−" : "+"}${amount}`}
        got={followed.state === "LANDED" ? w("receiptLanded") : followed.state === "FAILED" ? w("receiptFailed") : w("receiptUnknown")}
        costs={w("receiptNoFee")}
        time={new Date(followed.sentAt).toLocaleString(intl)}
        network={name}
        transaction={`${followed.signature.slice(0, 6)}…${followed.signature.slice(-6)}`}
        reason={followed.reason ?? undefined}
        actionsDisabled={followed.state === "UNKNOWN"}
      />
      <p className={styles.muted}>
        {rate === null ? w("notRead") : w("receiptRate", { x: w("ratePerYear", { x: rate }) })}
        {review.partial ? ` · ${w("reviewPartial", { amount, left: amountWith(review.leftRaw, review.asset, intl) ?? "" })}` : ""}
      </p>
      <Button variant="ghost" onClick={onAgain}>
        {w("receiptAgain")}
      </Button>
    </section>
  );
}
