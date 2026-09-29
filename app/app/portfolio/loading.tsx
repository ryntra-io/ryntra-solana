"use client";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
export default function PortfolioLoading() {
  const {text}=useSolanaI18n();
  return <div aria-busy="true" data-surface-state="LOADING"><h1>{text("Portfolio")}</h1><p role="status">{text("Reading…")}</p></div>;
}
