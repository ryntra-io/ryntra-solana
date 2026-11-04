import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { PayerPage } from "@/city/components/pay/PayerPage";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { PALETTE } from "@/city/lib/palette";
import { payerQr } from "@/city/lib/pay/qr.server";
import { payMetadata } from "@/city/lib/pay/meta";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { loadPublicPaymentRequest } from "@/lib/pay/public";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

/**
 * `/pay/:id` — the page a person opens when somebody asks them for money, as one window of Ryntra City (CITY-156).
 *
 * The engine is the one it was: the public read (`lib/pay/public.ts`) draws the first paint, and the window pays
 * through `/api/pay/:id/transaction` and `/api/pay/:id/submit` and follows the status through `/api/pay/:id`. A link
 * is never offered to the index. The server writes English; the page repaints in the person's language before it is
 * seen (CITY-79).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return payMetadata(await loadPublicPaymentRequest({ store: getGuardRuntime().store, id, observe: false }));
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await loadPublicPaymentRequest({ store: getGuardRuntime().store, id });
  if (!view) notFound();

  /* The QR carries this page's own link (`city/lib/pay/qr.server.ts`): any phone camera opens it, and the page hands
     itself to the wallet app. */
  const pageUrl = `${await publicOrigin()}/pay/${view.request.id}`;
  const qr = await payerQr(pageUrl);

  return (
    <div className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <PayerPage initial={view} qr={qr} pageUrl={pageUrl} />
    </div>
  );
}

async function publicOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "ryntra.io";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
