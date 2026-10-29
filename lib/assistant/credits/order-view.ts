/**
 * What a person and the phone read of buying credits (contract 1.54.0): the
 * packages, the treasury, and each order — what to pay, where, what arrived
 * and what was credited. Pure: no clock it is not given, no network, no store.
 */

import type { AssistantCreditOrder, AssistantCreditPackage, AssistantCreditPurchase } from "../../api/v1/contract.ts";
import { abbreviateAddress } from "../../pay/model.ts";
import { exactDecimal } from "../../solana/amounts.ts";
import { buildSolanaPayUrl } from "../../solana/payment-request.ts";
import { CREDIT_PACKAGES, ORDER_TTL_MS, orderStatus, packageOf, receivedRaw, USDC_DECIMALS, type CreditOrder, type CreditPackage } from "./purchase.ts";

export function packageView(pkg: CreditPackage): AssistantCreditPackage {
  return { id: pkg.id, usdc: String(pkg.usdc), credits: pkg.credits, bonusPercent: pkg.bonusPercent };
}

export function purchaseView(treasury: string | null): AssistantCreditPurchase {
  return {
    available: treasury !== null,
    packages: CREDIT_PACKAGES.map(packageView),
    treasury: treasury ? { address: treasury, abbreviated: abbreviateAddress(treasury) } : null,
    orderMinutes: ORDER_TTL_MS / 60_000,
  };
}

export function orderView(order: CreditOrder, origin: string, nowMs: number): AssistantCreditOrder {
  const pkg = packageOf(order.package) ?? CREDIT_PACKAGES[0];
  const display = exactDecimal(order.priceRaw, USDC_DECIMALS);
  const pay = buildSolanaPayUrl({ recipient: order.treasury, amount: display, splToken: order.mint, decimals: USDC_DECIMALS, reference: order.reference, label: "Ryntra" });
  const received = receivedRaw(order).toString();
  return {
    id: order.id,
    package: packageView(pkg),
    status: orderStatus(order, nowMs),
    amount: { raw: order.priceRaw, display, symbol: "USDC", mint: order.mint },
    received: { raw: received, display: exactDecimal(received, USDC_DECIMALS) },
    credited: order.credited,
    payPage: `${origin}/pay/${order.id}`,
    payUrl: pay.ok ? pay.url : `solana:${order.treasury}`,
    reference: order.reference,
    treasury: { address: order.treasury, abbreviated: abbreviateAddress(order.treasury) },
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    payments: order.payments.map((payment) => ({ signature: payment.signature, amount: exactDecimal(payment.amountRaw, USDC_DECIMALS), at: payment.at })),
    wrongToken: order.foreign.length > 0,
  };
}
