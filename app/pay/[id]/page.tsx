import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { loadPublicPaymentRequest, qrDataUrl } from "@/lib/pay/public";
import { payCopy } from "@/lib/site/pay-copy";
import { publicServerLocale } from "@/lib/site/server-locale";
import { displayAmount } from "@/lib/solana/amounts";

import { PayClient } from "./pay-client";

import styles from "../pay.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * `/pay/:id` — the page a person opens when somebody asks them for money.
 *
 * No account, no wallet connection, no Ryntra vocabulary. It says who is
 * asking, for what, how much and until when, whether it has been paid, and
 * offers two ways to pay: scan the code with a phone wallet, or connect a
 * wallet in this browser. Everything on it comes from the public read; the
 * status is the server's, refreshed by the client only through the same read.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const locale = await publicServerLocale();
  const copy = payCopy(locale);
  const view = await loadPublicPaymentRequest({ store: getGuardRuntime().store, id, observe: false });
  if (!view) return { title: copy.notFoundTitle, robots: { index: false, follow: false } };
  const amount = view.request.amount ? `${view.request.amount.display} ${view.request.token.symbol}` : view.request.token.symbol;
  return {
    title: `${copy.title} · ${amount}`,
    description: view.request.description ?? copy.title,
    robots: { index: false, follow: false },
  };
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await publicServerLocale();
  const copy = payCopy(locale);
  const view = await loadPublicPaymentRequest({ store: getGuardRuntime().store, id });
  if (!view) notFound();

  /* The QR carries this page's own link. Any phone camera opens it, and the
     page then hands itself to the wallet app — Phantom's documented mobile
     path — instead of relying on a wallet's in-app scanner reading a
     `solana:` transfer request, which Phantom's scanner refused in testing. */
  const pageUrl = `${await publicOrigin()}/pay/${view.request.id}`;
  const qr = await qrDataUrl(pageUrl, 640);
  const paidAmount =
    view.request.paid ? `${displayAmount(view.request.paid.creditedRaw, view.request.token.decimals)} ${view.request.token.symbol}` : null;

  return (
    <main className={styles.page} id="main-content">
      <PayClient initial={view} qr={qr} pageUrl={pageUrl} paidAmount={paidAmount} locale={locale} copy={copy} />
    </main>
  );
}

async function publicOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "ryntra.io";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
