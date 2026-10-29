"use client";

import { PageBones } from "./bones";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";

/**
 * The cabinet while a page is on its way: the page's shape, held at the heights its content will take.
 *
 * This stood as one paragraph, «Loading…», which told a person nothing about where anything would be and moved every
 * row of the page when the content arrived.
 */
export default function ProductLoading() {
  const { locale } = useSolanaI18n();
  return <PageBones label={locale === "uk" ? "Завантаження…" : "Loading…"} />;
}
