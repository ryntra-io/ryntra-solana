import type { Metadata } from 'next';
import type { PublicPaymentView } from '../../../lib/pay/public.ts';
import { CITY_CARD_SIZE, cityCardVersion } from '../share/card.ts';
import { PAY } from './words.ts';

/**
 * The tab and the link preview of the payer's page (CITY-156), and of a link that does not exist. The server writes
 * English (the city's first language); a payment link is never offered to the index; the preview is the city's own
 * card (`/opengraph-image`, the one `/` shares) — never the old face's picture or line, which the site's root would otherwise
 * lend it.
 */
export function payMetadata(view: PublicPaymentView | null): Metadata {
  const words = PAY.en;
  const title = view ? `${words.request} · ${view.request.amount ? `${view.request.amount.display} ${view.request.token.symbol}` : view.request.token.symbol}` : `${words.missingTitle} · Ryntra`;
  const description = view ? (view.request.description ?? words.walletSigns) : words.missingLine;
  const image = { url: `/opengraph-image?v=${cityCardVersion()}`, width: CITY_CARD_SIZE.width, height: CITY_CARD_SIZE.height, alt: title };
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { type: 'website', siteName: 'Ryntra', title, description, ...(view ? { url: `/pay/${view.request.id}` } : {}), images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}
