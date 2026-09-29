import type { PortfolioRiskResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { readPortfolioRisk } from "@/lib/monitoring/portfolio-risk.server";
import { productionPortfolioRiskDeps } from "@/lib/monitoring/positions.deps.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «Ризик портфеля» of the proven wallet (`RYN-PROTECT-SIGNAL-001`, subtask 2,
 * contract 1.23.0; canon v5 §11): «Нормальний», «Увага» with every rule broken,
 * or «Не вдалося перевірити» with what could not be read — decided here, by
 * the same rules for the web and the phone, and never «Нормальний» on
 * incomplete data.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const store = getGuardRuntime().store;
  const read = await readPortfolioRisk(store, proof.address, Date.now(), productionPortfolioRiskDeps(store));
  const risk = { ...read.risk, findings: [...read.risk.findings], gaps: [...read.risk.gaps] };
  return apiJson({ address: proof.address, risk, at: read.at } satisfies PortfolioRiskResponse);
}
