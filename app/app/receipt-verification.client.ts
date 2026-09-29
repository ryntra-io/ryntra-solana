import type { StoredReceiptView } from "@/lib/solana/receipt-view";

type VerificationClient = Pick<typeof import("../agents/agent-control-client"), "verifyArtifact">;

/** Verification is optional display evidence; unavailable code never promotes an outcome. */
export async function verifyReceiptCandidates(
  candidates: readonly StoredReceiptView[],
  isCurrent: () => boolean,
  loadClient: () => Promise<VerificationClient> = () => import("../agents/agent-control-client"),
): Promise<ReadonlySet<string>> {
  if (candidates.length === 0 || !isCurrent()) return new Set();
  try {
    const { verifyArtifact } = await loadClient();
    // A wallet switch or navigation can invalidate the effect while the chunk loads.
    if (!isCurrent()) return new Set();
    const hashes = await Promise.all(candidates.map(async (row) => {
      if (!isCurrent()) return null;
      try {
        const result = await verifyArtifact(row.receipt);
        return result.integrity.valid && result.issuer.verdict === "SIGNATURE_VALID"
          ? String(row.receipt.contentHash) : null;
      } catch { return null; }
    }));
    return isCurrent() ? new Set(hashes.filter((hash): hash is string => hash !== null)) : new Set();
  } catch { return new Set(); }
}
