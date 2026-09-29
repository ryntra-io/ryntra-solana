import { holdingValue } from "../../../app/wallet-view-model.ts";
import { WRAPPED_SOL_MINT } from "../../../../lib/solana/send-kinds.ts";

export type SwapTokenRow = Readonly<{
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  tokenProgram: string | null;
  isVerified: boolean | null;
  isSuspicious: boolean;
  usdPrice: string | null;
  icon?: string | null;
}>;

export type SwapHolding = Readonly<{
  kind: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  amountRaw?: string;
  spendableRaw: string;
  decimals: number;
  tokenProgram?: string | null;
  symbol?: string | null;
  name?: string | null;
  catalog?: Readonly<{
    symbol: string | null; name: string | null; usdPrice: string | null;
    isVerified?: boolean | null; isSuspicious?: boolean; icon?: string | null;
  }> | null;
}>;

export type SwapAssetRow = SwapTokenRow & Readonly<{ holding: SwapHolding | null; usdValue: bigint | null }>;

/** Holdings are already named and priced by the server; keep that evidence in the picker. */
export function buildSwapAssetRows(
  holdings: readonly SwapHolding[],
  known: Readonly<Record<string, SwapTokenRow>>,
  featured: readonly { mint: string; code: string; note: string }[],
): readonly SwapAssetRow[] {
  const byMint = new Map<string, SwapHolding>();
  for (const holding of holdings) {
    const mint = holding.mint ?? WRAPPED_SOL_MINT;
    if (!byMint.has(mint) || holding.kind === "NATIVE_SOL") byMint.set(mint, holding);
  }
  const mints = new Set([...byMint.keys(), ...featured.map(row => row.mint), ...Object.keys(known)]);
  const rows = [...mints].map((mint): SwapAssetRow => {
    const holding = byMint.get(mint) ?? null;
    const catalog = holding?.catalog;
    const cached = known[mint];
    const seed = featured.find(row => row.mint === mint);
    const native = holding?.kind === "NATIVE_SOL" || mint === WRAPPED_SOL_MINT;
    const usdPrice = catalog?.usdPrice ?? cached?.usdPrice ?? null;
    const row = {
      mint,
      symbol: native ? "SOL" : seed?.code ?? catalog?.symbol ?? cached?.symbol ?? holding?.symbol ?? null,
      name: native ? "Solana" : catalog?.name ?? cached?.name ?? holding?.name ?? seed?.note.split(" — ")[0] ?? null,
      decimals: holding?.decimals ?? cached?.decimals ?? null,
      tokenProgram: holding?.tokenProgram ?? cached?.tokenProgram ?? null,
      isVerified: catalog?.isVerified ?? cached?.isVerified ?? null,
      isSuspicious: catalog?.isSuspicious === true || cached?.isSuspicious === true,
      usdPrice,
      icon: catalog?.icon ?? cached?.icon ?? null,
      holding,
    };
    return { ...row, usdValue: holding ? holdingValue({
      ...holding, amountRaw: holding.amountRaw ?? holding.spendableRaw,
      symbol: row.symbol, catalog: { symbol: row.symbol, name: row.name, usdPrice },
    }) : null };
  });
  const rank = (row: SwapAssetRow) => row.isSuspicious ? 4 : row.holding && row.symbol
    ? row.usdValue !== null && row.usdValue > 0n ? 0 : 1
    : row.holding ? 3 : 2;
  return rows.sort((a, b) => {
    const group = rank(a) - rank(b);
    if (group) return group;
    if (a.usdValue !== b.usdValue) {
      if (a.usdValue === null) return 1;
      if (b.usdValue === null) return -1;
      return a.usdValue > b.usdValue ? -1 : 1;
    }
    return 0;
  });
}
