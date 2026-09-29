import type { AgentPassport } from "./agent-passport.ts";
import { verifyBrowserAgentPassport } from "./agent-passport-browser.ts";

/** Full documents can carry provider readmes, so the tab cache is bounded. */
export const AGENT_PASSPORT_DIRECTORY_LIMIT = 12;

export async function parseAgentPassportDirectory(raw: string | null): Promise<readonly AgentPassport[]> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > AGENT_PASSPORT_DIRECTORY_LIMIT) return [];

  const records: AgentPassport[] = [];
  const addresses = new Set<string>();
  for (const candidate of parsed) {
    let valid = false;
    try {
      valid = await verifyBrowserAgentPassport(candidate);
    } catch {
      return [];
    }
    if (!valid) continue;
    const passport = candidate as AgentPassport;
    if (addresses.has(passport.request.address)) continue;
    records.push(passport);
    addresses.add(passport.request.address);
  }
  return records;
}

export function rememberAgentPassport(
  records: readonly AgentPassport[],
  passport: AgentPassport,
): readonly AgentPassport[] {
  return [
    passport,
    ...records.filter((entry) => entry.request.address !== passport.request.address),
  ].slice(0, AGENT_PASSPORT_DIRECTORY_LIMIT);
}
