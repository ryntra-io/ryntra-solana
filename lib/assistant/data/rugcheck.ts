/**
 * RugCheck — a token's risk report as the assistant reads it (AI-03).
 *
 * The public `v1/tokens/{mint}/report/summary` answer, keyless: the risks
 * the service lists, each with its level, its normalised score (lower is
 * fewer flags) and the share of pool liquidity it sees locked. The report is
 * the service's opinion of a token's structure, never a verdict of safety:
 * an empty list of risks is said as «RugCheck lists no flags», never as
 * «safe».
 *
 * The risk names are the service's labels; they are cut to a short run of
 * plain characters, and the free-text descriptions are not read at all — a
 * description is someone else's prose and has no place in an answer.
 *
 * Pure: an answer in, a report out.
 */

export const RUGCHECK_BASE_URL = "https://api.rugcheck.xyz";
export const RUGCHECK_SOURCE = "RugCheck";
export const RUGCHECK_RISKS_MAX = 8;

export type RugRiskLevel = "danger" | "warn" | "info";

export type RugCheckReport = Readonly<{
  risks: readonly Readonly<{ name: string; level: RugRiskLevel }>[];
  /** The service's normalised score, 0 and up; lower means fewer and lighter flags. */
  score: number | null;
  /** Percent of the pools' liquidity the service sees locked. */
  lpLockedPct: number | null;
}>;

function riskName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").replace(/[^\p{L}\p{N} ._%()+-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return text.length > 0 ? text : null;
}

function level(value: unknown): RugRiskLevel {
  return value === "danger" ? "danger" : value === "warn" || value === "warning" ? "warn" : "info";
}

const ORDER: Readonly<Record<RugRiskLevel, number>> = { danger: 0, warn: 1, info: 2 };

/** The report, or null when the answer is not one. */
export function parseRugCheck(body: unknown): RugCheckReport | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (!Array.isArray(row.risks) && row.score_normalised === undefined && row.score === undefined) return null;
  const risks = (Array.isArray(row.risks) ? row.risks : [])
    .map((risk) => (risk && typeof risk === "object" ? { name: riskName((risk as Record<string, unknown>).name), level: level((risk as Record<string, unknown>).level) } : null))
    .filter((risk): risk is { name: string; level: RugRiskLevel } => risk !== null && risk.name !== null)
    .sort((a, b) => ORDER[a.level] - ORDER[b.level])
    .slice(0, RUGCHECK_RISKS_MAX);
  const score = typeof row.score_normalised === "number" && Number.isFinite(row.score_normalised) && row.score_normalised >= 0 ? row.score_normalised : null;
  const locked = typeof row.lpLockedPct === "number" && Number.isFinite(row.lpLockedPct) && row.lpLockedPct >= 0 && row.lpLockedPct <= 100 ? row.lpLockedPct : null;
  return { risks, score, lpLockedPct: locked };
}

export function rugCheckUrl(mint: string): string {
  return `${RUGCHECK_BASE_URL}/v1/tokens/${mint}/report/summary`;
}
