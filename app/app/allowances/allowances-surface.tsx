"use client";

import { Block, Button, EmptyState, Page } from "@ryntra/core/ui";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import type { AllowanceRow, AllowanceState } from "@/lib/solana/allowances/contract";
import type { AllowanceChain } from "@/lib/solana/allowances/model";
import { explorerAddressUrl } from "@/lib/solana/explorer";

import { LimitForm, SpendForm, SubscribeForm } from "./allowances-forms";
import { AllowanceReceiptCard, AllowanceReviewCard, FailureLine, FollowLine, allowanceApi, lang, money, networkOf, periodText, short, useAllowanceAction, when, type AllowanceAction } from "./allowances-flow";
import { allowanceWords, statusWord } from "./allowances-words";
import styles from "./allowances.module.css";

type Read = Readonly<{ wallet: string; state: AllowanceState | null; failed: string | null }>;

function useAllowanceState(wallet: string | null): Readonly<{ read: Read | null; reload: () => Promise<void> }> {
  const [read, setRead] = useState<Read | null>(null);
  const reload = useCallback(async () => {
    if (!wallet) return;
    const answer = await allowanceApi<AllowanceState>(`/api/solana/allowances/state/${wallet}`);
    setRead({ wallet, state: answer.ok ? answer.data : null, failed: answer.ok ? null : answer.code });
  }, [wallet]);
  useEffect(() => {
    setRead(null);
    void reload();
  }, [reload]);
  return { read: read && read.wallet === wallet ? read : null, reload };
}

type Mode = Readonly<{ form: "none" | "fixed" | "recurring" | "subscribe" }> | Readonly<{ form: "spend"; row: AllowanceRow }>;

const token = (row: AllowanceRow) => ({ decimals: row.decimals, symbol: row.asset === "USDC" ? "USDC" : short(row.mint ?? "?") });

/** «100 USDC in total», «5 USDC every week», «9.99 USDC every 30 days · plan». */
function limitWhat(row: AllowanceRow, locale: WorkspaceLocale): string {
  const word = allowanceWords(locale);
  const amount = money(row.amountRaw, locale, token(row));
  if (row.kind === "fixed") return row.originalRaw ? word("kind_fixed", { amount: money(row.originalRaw, locale, token(row)) }) : word("kind_fixedLeft", { amount });
  const period = row.periodSeconds ? periodText(row.periodSeconds, locale) : "";
  return row.kind === "recurring" ? word("kind_recurring", { amount, period }) : word("kind_subscription", { amount, period });
}

function spentText(row: AllowanceRow, locale: WorkspaceLocale): string {
  const word = allowanceWords(locale);
  if (row.spentRaw === null) return word("unknownAmount");
  const amount = money(row.spentRaw, locale, token(row));
  return row.kind === "fixed" ? amount : word("thisPeriod", { amount });
}

function RowItem({ row, side, locale, network, action, onSpend }: { row: AllowanceRow; side: "given" | "received"; locale: WorkspaceLocale; network: AllowanceChain; action: AllowanceAction; onSpend: (row: AllowanceRow) => void }) {
  const word = allowanceWords(locale);
  const busy = action.phase === "prepare";
  /* A take waits while what was sent is still not known; a revoke never waits. */
  const waiting = action.follow === "watching";
  const party = side === "given" ? (row.delegatee ? short(row.delegatee) : word("merchantUnknown")) : short(row.delegator);
  const net = networkOf(network);
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemWhat}>{limitWhat(row, locale)}</span>
        <span className={styles.state} data-status={row.status}>
          {statusWord(locale, row.status, row.endsAt !== "0" ? when(row.endsAt, locale) : "", row.blockedBy)}
        </span>
      </div>
      <dl className={styles.itemFacts}>
        <div>
          <dt>{side === "given" ? word("who") : word("from")}</dt>
          <dd>
            <a className={styles.mono} href={explorerAddressUrl(net, (side === "given" ? row.delegatee : row.delegator) ?? row.address)} target="_blank" rel="noreferrer">
              {party}
            </a>
          </dd>
        </div>
        <div>
          <dt>{word("spent")}</dt>
          <dd>{spentText(row, locale)}</dd>
        </div>
        <div>
          <dt>{word("available")}</dt>
          <dd>{row.availableRaw === null ? "—" : money(row.availableRaw, locale, token(row))}</dd>
        </div>
        <div>
          <dt>{word("until")}</dt>
          <dd>{row.endsAt === "0" ? word("noEnd") : when(row.endsAt, locale)}</dd>
        </div>
      </dl>
      {row.actions.length ? (
        <div className={styles.rowActions}>
          {row.actions.map((kind) =>
            kind === "spend" ? (
              <Button key={kind} variant="secondary" onClick={() => onSpend(row)} disabled={busy || waiting} lang={lang(locale)}>
                {word("spend")}
              </Button>
            ) : (
              <Button
                key={kind}
                variant={kind === "close" ? "ghost" : "secondary"}
                onClick={() => void action.prepare({ kind: "revoke", wallet: row.delegator, delegation: row.address })}
                disabled={busy}
                lang={lang(locale)}
              >
                {kind === "revoke" ? word("revoke") : kind === "cancel" ? word("cancelSub") : word("close")}
              </Button>
            ),
          )}
        </div>
      ) : null}
    </li>
  );
}

/** The wallet's USDC: its balance, whether the program holds its approval, and the switch that stops everything. */
function UsdcBlock({ state, wallet, locale, action }: { state: AllowanceState | null; wallet: string; locale: WorkspaceLocale; action: AllowanceAction }) {
  const word = allowanceWords(locale);
  const usdc = state?.usdc;
  /* «Given» only when the program's approval can be used now: its own, with something left, on an account not frozen. */
  const open = usdc?.authorityOpen === true && usdc.hasAccount === true && usdc.frozen === false && usdc.delegate === usdc.authority && usdc.delegatedRaw !== null && BigInt(usdc.delegatedRaw) > 0n;
  const approval =
    !usdc || usdc.authorityOpen === null
      ? word("notRead")
      : !usdc.authorityOpen
        ? /* Closed alone on a frozen account: the program's approval may still sit on it. */
          usdc.delegate === usdc.authority && usdc.delegatedRaw !== null && BigInt(usdc.delegatedRaw) > 0n
          ? word("approvalClosedOnly")
          : word("approvalNone")
        : usdc.hasAccount === null
          ? word("notRead")
          : !usdc.hasAccount
            ? word("noAccount")
            : usdc.frozen
              ? word("approvalFrozen")
              : open
                ? word("approvalOpen")
                : usdc.delegate === usdc.authority
                  ? word("approvalUsed")
                  : usdc.delegate === null
                    ? word("approvalPaused")
                    : word("approvalOther");
  return (
    <Block title={word("usdcTitle")} icon="wallet" lang={lang(locale)}>
      <dl className={styles.itemFacts}>
        <div>
          <dt>{word("balance")}</dt>
          <dd>{!usdc || usdc.balanceRaw === null ? word("notRead") : usdc.hasAccount === false ? word("noAccount") : money(usdc.balanceRaw, locale)}</dd>
        </div>
        <div>
          <dt>{word("approval")}</dt>
          <dd className={usdc?.authorityOpen && usdc.hasAccount !== null && !open ? styles.warn : undefined}>{approval}</dd>
        </div>
      </dl>
      {/* Shown unless the authority is known to be closed: when it was not read, the build reads it again. */}
      {usdc && usdc.authorityOpen !== false ? (
        <div className={styles.rowActions}>
          <Button variant="secondary" onClick={() => void action.prepare({ kind: "stopAll", wallet })} disabled={action.phase === "prepare"} lang={lang(locale)}>
            {word("stopAll")}
          </Button>
        </div>
      ) : null}
    </Block>
  );
}

/**
 * «Ліміти витрат» (SOL-7): the person gives an agent, an app or a merchant a limit on their USDC — a fixed amount until
 * a date, an amount every period until a date, or a merchant's plan — sees who may take what and how much was taken,
 * and revokes in one tap. The Subscriptions program keeps the count. Devnet first; mainnet is the operator's canary.
 */
export function AllowancesSurface({ locale, network }: { locale: WorkspaceLocale; network: AllowanceChain }) {
  const word = allowanceWords(locale);
  const { connection } = useSolanaConnection();
  const wallet = connection?.address ?? null;
  const [mode, setMode] = useState<Mode>({ form: "none" });
  const view = useAllowanceState(wallet);
  const onDone = useCallback(() => {
    setMode({ form: "none" });
    void view.reload();
  }, [view]);
  const action = useAllowanceAction(onDone);

  const title = (
    <span className={styles.titleRow}>
      {word("title")}
      {network === "solana:devnet" ? (
        <span className={styles.netChip} title={word("devnetHint")}>
          {word("devnet")}
        </span>
      ) : null}
    </span>
  );

  const reviewing = action.phase === "review" || action.phase === "sign" || action.phase === "send" || (action.phase === "prepare" && action.held !== null);
  /* While what was sent is read again, nothing new is given: the same limit prepared twice would be two limits. */
  const waiting = action.follow === "watching";
  const state = view.read?.state ?? null;
  const loading = wallet !== null && view.read === null;
  const unreadAll = view.read !== null && state === null;

  const viewOf = (at: string) => (
    <div className={styles.view}>
      <UsdcBlock state={state} wallet={at} locale={locale} action={action} />
      <Block
        title={word("given")}
        icon="target"
        loading={loading}
        action={
          <button type="button" className={styles.linkButton} onClick={() => void view.reload()}>
            {word("reload")}
          </button>
        }
        lang={lang(locale)}
      >
        {unreadAll || state?.givenUnread ? (
          <p className={styles.warnLine}>{word("givenUnread")}</p>
        ) : state && state.given.length === 0 ? (
          <p className={styles.hint}>{word("givenEmpty")}</p>
        ) : (
          <ul className={styles.list}>
            {state?.given.map((row) => (
              <RowItem key={row.address} row={row} side="given" locale={locale} network={network} action={action} onSpend={() => undefined} />
            ))}
          </ul>
        )}
      </Block>
      {unreadAll || state?.receivedUnread || (state?.received.length ?? 0) > 0 ? (
        <Block title={word("received")} icon="inbox" lang={lang(locale)}>
          {unreadAll || state?.receivedUnread ? (
            <p className={styles.warnLine}>{word("receivedUnread")}</p>
          ) : (
            <ul className={styles.list}>
              {state?.received.map((row) => (
                <RowItem key={row.address} row={row} side="received" locale={locale} network={network} action={action} onSpend={(picked) => setMode({ form: "spend", row: picked })} />
              ))}
            </ul>
          )}
        </Block>
      ) : null}
    </div>
  );

  return (
    <Page kind="action" className={styles.page} title={title} help={word("help")} lang={lang(locale)}>
      {!wallet ? (
        <EmptyState
          icon="wallet"
          text={word("connectLine")}
          action={
            <ConnectWalletButton />
          }
        />
      ) : (
        <>
          {reviewing ? <AllowanceReviewCard action={action} locale={locale} network={network} /> : action.phase === "done" ? <AllowanceReceiptCard action={action} locale={locale} network={network} /> : null}
          <FailureLine action={action} locale={locale} />
          {/* What was sent and is not final yet, said whatever the person does next — a revoke, a Review, a reset. */}
          <FollowLine follow={action.follow} locale={locale} />
          {!reviewing ? (
            action.phase === "done" ? (
              viewOf(wallet)
            ) : mode.form === "fixed" || mode.form === "recurring" ? (
              <Block title={mode.form === "fixed" ? word("fixedTitle") : word("recurringTitle")} icon="target" lang={lang(locale)}>
                <LimitForm key={mode.form} kind={mode.form} wallet={wallet} locale={locale} busy={action.phase === "prepare"} onSubmit={(request) => void action.prepare(request)} onCancel={() => setMode({ form: "none" })} />
              </Block>
            ) : mode.form === "subscribe" ? (
              <Block title={word("subscribeTitle")} icon="receipt" lang={lang(locale)}>
                <SubscribeForm wallet={wallet} locale={locale} busy={action.phase === "prepare"} onSubmit={(request) => void action.prepare(request)} onCancel={() => setMode({ form: "none" })} />
              </Block>
            ) : mode.form === "spend" ? (
              <Block title={word("spendTitle")} icon="banknote" lang={lang(locale)}>
                <p className={styles.hint}>
                  {limitWhat(mode.row, locale)} · {word("from")} <span className={styles.mono}>{short(mode.row.delegator)}</span>
                </p>
                <SpendForm wallet={wallet} row={mode.row} locale={locale} busy={action.phase === "prepare"} onSubmit={(request) => void action.prepare(request)} onCancel={() => setMode({ form: "none" })} />
              </Block>
            ) : (
              <>
                <div className={styles.startRow}>
                  <Button variant="primary" icon="plus" onClick={() => setMode({ form: "fixed" })} disabled={waiting} lang={lang(locale)}>
                    {word("giveFixed")}
                  </Button>
                  <Button variant="secondary" icon="clock" onClick={() => setMode({ form: "recurring" })} disabled={waiting} lang={lang(locale)}>
                    {word("giveRecurring")}
                  </Button>
                  <Button variant="secondary" icon="receipt" onClick={() => setMode({ form: "subscribe" })} disabled={waiting} lang={lang(locale)}>
                    {word("subscribe")}
                  </Button>
                </div>
                {waiting ? <p className={styles.hint}>{word("followWaitStart")}</p> : null}
                {viewOf(wallet)}
              </>
            )
          ) : null}
        </>
      )}
    </Page>
  );
}

