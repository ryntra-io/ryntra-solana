"use client";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
export default function ProductLoading() {
  const {locale}=useSolanaI18n();
  return <p role="status" aria-live="polite" aria-busy="true">{locale==="uk"?"Завантаження…":"Loading…"}</p>;
}
