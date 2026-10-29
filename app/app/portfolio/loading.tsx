"use client";

import { PageBones } from "@/app/app/bones";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";

/**
 * The portfolio while it is read: the page's shape — the heading, the value's block, what the wallet holds, and the
 * history under them — each block as tall as the lines it will hold, so the numbers do not push the rows down when they
 * arrive. It was a heading and the word «Reading…».
 */
export default function PortfolioLoading() {
  const { text } = useSolanaI18n();
  return <PageBones blocks={[4, 6, 4]} label={text("Reading…")} />;
}
