"use client";

import { useMemo } from "react";

import type { OrderListItem, PositionGroup, UserActivityItem } from "@agg-build/sdk";
import { useAggAuthContext, useAggBalance, useExecutionOrders, useExecutionPositions, useUserActivity } from "@agg-build/hooks";
import { UserProfilePage } from "@agg-build/ui/pages";
import type {
  UserProfileActivity,
  UserProfileOpenOrder,
  UserProfilePosition,
} from "@agg-build/ui/pages";
import type { VenueLogoName } from "@agg-build/ui/primitives";

import styles from "./lab.module.css";

/*
 * The aggregator's profile page is presentational — it takes view models —
 * while their hooks return the API's own shapes, so the glue lives here. It
 * is the same glue their demo app carries; nothing is invented, every label
 * is a number the API returned, formatted, and every list is the paper
 * account's (the app is paper at the app level, `mode: "paper"` is passed
 * anyway so the intent is on the wire).
 */

const money = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "—" : `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
const cents = (price: number | null | undefined) => (price == null ? "—" : `${Math.round(price * 100)}¢`);
const shares = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(2)} sh`);
const raw6 = (value: string | null | undefined) => (value == null ? null : Number(value) / 1_000_000);
const when = (value: string | Date | null | undefined) => {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

function positionsOf(groups: PositionGroup[]): UserProfilePosition[] {
  const out: UserProfilePosition[] = [];
  for (const group of groups) {
    for (const outcome of group.venueMarket.venueMarketOutcomes) {
      if (!outcome.totalSize) continue;
      const pnl = outcome.unrealizedPnl ?? null;
      out.push({
        id: `${group.targetMarketId}:${outcome.label}`,
        eventId: group.eventId ?? group.venueMarket.venueEventId,
        marketId: group.targetMarketId,
        thumbnailSrc: group.venueMarket.image ?? "",
        title: group.venueMarket.question,
        outcomeLabel: outcome.label,
        venueShareBreakdown: outcome.venueBreakdown.map((leg) => ({ venue: leg.venue, sharesLabel: shares(leg.size) })),
        totalShares: outcome.totalSize,
        averageLabel: cents(outcome.avgEntryPrice),
        averagePrice: outcome.avgEntryPrice,
        currentLabel: cents(outcome.currentPrice),
        currentPrice: outcome.currentPrice,
        valueLabel: money(outcome.totalValue),
        currentValue: outcome.totalValue,
        pnlLabel: money(pnl),
        pnlValue: pnl,
        pnlPercent: outcome.unrealizedPnlPercent ?? null,
        isPnlPositive: (pnl ?? 0) >= 0,
        status: group.status,
        marketStatus: group.venueMarket.status,
        winner: outcome.winner ?? null,
        resolutionDate: group.resolutionDate,
        closedClaimStatus: group.redeemStatus,
        totalTradedValue: outcome.avgEntryPrice * outcome.totalSize,
        closedTotalTradedLabel: money(outcome.avgEntryPrice * outcome.totalSize),
      });
    }
  }
  return out;
}

function activitiesOf(items: UserActivityItem[]): UserProfileActivity[] {
  return items.map((item): UserProfileActivity => {
    const status = /fail|reject|cancel/i.test(item.status)
      ? /cancel/i.test(item.status)
        ? "canceled"
        : "failed"
      : /pending|open|queued|submitted/i.test(item.status)
        ? "pending"
        : "completed";
    if (item.type === "trade") {
      const filled = raw6(item.filledAmountRaw) ?? raw6(item.amountRaw);
      return {
        kind: "trade",
        id: item.id,
        eventId: item.venueMarket?.venueEventId ?? undefined,
        marketId: item.venueMarket?.id ?? undefined,
        status,
        isFailed: status === "failed",
        hasError: Boolean(item.errorMessage),
        errorMessage: item.errorMessage ?? undefined,
        type: item.side,
        thumbnailSrc: item.venueMarket?.image ?? "",
        title: item.venueMarket?.question ?? item.marketQuestion ?? "Trade",
        venue: item.venue as VenueLogoName,
        outcomeLabel: item.venueMarketOutcome?.label ?? item.outcomeLabel ?? "",
        sharesLabel: item.executionPrice && filled != null ? shares(filled / Number(item.executionPrice)) : "",
        amountLabel: money(filled),
        timeLabel: when(item.createdAt),
      } as UserProfileActivity;
    }
    if (item.type === "redeem") {
      return {
        kind: "redeem",
        id: item.id,
        status,
        type: "redeem",
        title: "Redeem",
        timeLabel: when(item.createdAt),
      } as UserProfileActivity;
    }
    return {
      kind: item.type === "withdrawal" || item.type === "deposit" || item.type === "bridge" || item.type === "user_op" ? item.type : "unknown",
      id: item.id,
      status,
      type: item.type,
      title: item.type,
      subtitleLabel: item.status,
      amountLabel: "",
      timeLabel: when(item.createdAt),
    };
  });
}

function openOrdersOf(items: OrderListItem[]): UserProfileOpenOrder[] {
  return items
    .filter((order) => /open|pending|queued|submitted|partial/i.test(order.status))
    .map((order) => ({
      id: order.id,
      eventId: order.venueMarket?.venueEventId,
      marketId: order.venueMarket?.id,
      thumbnailSrc: order.venueMarket?.image ?? "",
      title: order.venueMarket?.question ?? "Order",
      outcomeLabel: order.venueMarketOutcome?.label ?? "",
      venue: order.venue,
      limitPriceLabel: order.limitPriceRaw ? cents(raw6(order.limitPriceRaw)) : undefined,
      filledLabel: order.filledSizeRaw ? shares(raw6(order.filledSizeRaw)) : "0 sh",
      valueLabel: money(raw6(order.amountRaw)),
      expirationLabel: order.expiresAt ? when(order.expiresAt) : undefined,
      status: order.status,
      orderType: order.orderType,
      dagRunId: order.dagRunId,
    }));
}

export function ProfileFromHooks({ onOpenEvent }: { onOpenEvent: (eventId: string) => void }) {
  const auth = useAggAuthContext();
  const balance = useAggBalance();
  const enabled = auth.isAuthenticated;
  const active = useExecutionPositions({ mode: "paper", status: "active", limit: 50, enabled });
  const closed = useExecutionPositions({ mode: "paper", status: "closed", limit: 50, enabled });
  const orders = useExecutionOrders({ mode: "paper", limit: 50, enabled });
  const activity = useUserActivity({ limit: 50, enabled });

  const activePositions = useMemo(() => positionsOf(active.positions ?? []), [active.positions]);
  const closedPositions = useMemo(() => positionsOf(closed.positions ?? []), [closed.positions]);
  const activities = useMemo(() => activitiesOf(activity.activities ?? []), [activity.activities]);
  const openOrders = useMemo(() => openOrdersOf(orders.orders ?? []), [orders.orders]);

  if (!enabled || !auth.user) {
    return (
      <p className={styles.empty}>
        Профіль — це сторінка AGG-користувача. Увійди кнопкою праворуч угорі (Google, e-mail, X або Apple — методи
        їхнього пакета `@agg-build/auth`), і тут з&apos;являться paper-баланс, позиції, ордери та активність.
      </p>
    );
  }

  const paper = balance.managedBalances?.paper;
  const total = paper ? paper.cashBalance + paper.positionsValue : balance.totalBalance;
  const wallet = auth.user.wallets?.[0];

  return (
    <UserProfilePage
      executionMode="paper"
      user={{
        username: auth.user.username ?? `agg-${auth.user.id.slice(0, 6)}`,
        avatarUrl: auth.user.avatarUrl,
        displayAddress: wallet ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}` : undefined,
        connectedWallets: (auth.user.wallets ?? []).map((w) => ({
          chain: w.chain,
          displayAddress: `${w.address.slice(0, 4)}…${w.address.slice(-4)}`,
        })),
      }}
      balance={{
        totalLabel: money(total),
        changeLabel: paper ? `${money(paper.realizedPnl + paper.unrealizedPnl)} P&L` : undefined,
        isPositive: paper ? paper.realizedPnl + paper.unrealizedPnl >= 0 : undefined,
      }}
      balanceChainsOverride={
        paper
          ? [{ key: "paper", label: "PAPER_USD", balance: paper.cashBalance, accountCount: 1 }]
          : undefined
      }
      activePositions={activePositions}
      closedPositions={closedPositions}
      openOrders={openOrders}
      activities={activities}
      isLoadingPositions={active.isLoading || closed.isLoading}
      isLoadingActivities={activity.isLoading}
      isLoadingOpenOrders={orders.isLoading}
      positionsError={active.isError || closed.isError}
      activitiesError={activity.isError}
      openOrdersError={orders.isError}
      onPositionClick={(position) => position.eventId && onOpenEvent(position.eventId)}
      onActivityClick={(item) => "eventId" in item && item.eventId && onOpenEvent(item.eventId)}
    />
  );
}
