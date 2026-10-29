/**
 * «Знайомство» (AI-06) — five questions in a minute, asked once: the goal,
 * the experience, the risk per trade (0.5 / 1 / 2 %, 1 % unless picked), the
 * horizon, and where notes go with quiet hours (23:00–08:00 unless changed).
 *
 * The first four are the assistant's own record; the fifth is Нагляд's
 * preferences — the same the monitoring settings write, never a second copy.
 * The answers shape how Ryntra words an answer (`readerOf`): plainer for a
 * newcomer, the horizon's window first. They are never a reason for a buy or
 * a sell, and nothing here signs, sends, trades or spends.
 */

import type { AssistantProfile, AssistantProfileResponse, AssistantProfileUpdate } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";
import { isValidQuietHours } from "../../monitoring/quiet-hours.ts";
import { preferencesOf, readPreferences } from "../../monitoring/store.ts";
import { profileOf, readProfileRecord, readProfileVersion, writeProfileRecord, type ProfileRecord } from "./store.ts";

export const PROFILE_DEFAULTS = { riskPct: 1, quietHours: { start: "23:00", end: "08:00" } } as const;

export async function readProfileSurface(store: GuardStore, owner: string): Promise<AssistantProfileResponse> {
  /* One read after the other: two small reads, and a store with one connection (the stand) never sees them collide. */
  const record = await readProfileRecord(store, owner);
  const preferences = await readPreferences(store, owner);
  return {
    profile: profileOf(record),
    delivery: { inbox: true, telegram: preferences.telegram, push: preferences.push, quietHours: preferences.quietHours ? { start: preferences.quietHours.start, end: preferences.quietHours.end, timezone: preferences.quietHours.timezone } : null },
  };
}

export type ProfileWrite = Readonly<{ ok: true }> | Readonly<{ ok: false; code: "VALIDATION_ERROR" | "UNAVAILABLE"; reason: string }>;

/**
 * Write the answers (or the skip) and, when asked, where notes go. Each record is written by compare-and-set over the
 * version read, retried once on a clash: the later press wins, never a write over a version it did not read.
 */
export async function updateProfile(store: GuardStore, owner: string, body: AssistantProfileUpdate, nowMs: number): Promise<ProfileWrite> {
  const at = new Date(nowMs).toISOString();
  if ("goal" in body && body.delivery?.quietHours && !isValidQuietHours(body.delivery.quietHours)) {
    return { ok: false, code: "VALIDATION_ERROR", reason: "Quiet hours need a start and an end as HH:MM and a time zone." };
  }
  /* Where notes go first: a clash there leaves the answers unwritten, so «Не вдалося зберегти» is true as said. */
  if ("goal" in body && body.delivery) {
    const delivery = body.delivery;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await readPreferences(store, owner);
      const written = await preferencesOf(store).compareAndSet(`solana:mainnet:${owner}`, current.version === 0 ? null : current.version, {
        version: current.version + 1,
        owner,
        inbox: true,
        telegram: delivery.telegram,
        push: delivery.push,
        quietHours: delivery.quietHours,
        updatedAt: at,
      });
      if (written) break;
      if (attempt === 1) return { ok: false, code: "UNAVAILABLE", reason: "Where notes go changed meanwhile; read it again." };
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const read = await readProfileRecord(store, owner);
    /* A row this code cannot read (an older shape) is still written over by its own version, never stuck. */
    const version = read?.version ?? (await readProfileVersion(store, owner));
    const answers = "skipped" in body ? { skipped: true, goal: null, experience: null, riskPct: null, horizon: null } : { skipped: false, goal: body.goal, experience: body.experience, riskPct: body.riskPct, horizon: body.horizon };
    const next: ProfileRecord = { schema: "ryntra.assistant.profile", version: (version ?? 0) + 1, owner, ...answers, createdAt: read?.createdAt ?? at, updatedAt: at };
    if (await writeProfileRecord(store, next, version)) break;
    if (attempt === 1) return { ok: false, code: "UNAVAILABLE", reason: "The answers changed meanwhile in another tab; read them again." };
  }
  return { ok: true };
}

/**
 * The reader as the model is told about them — only what shapes the words. Null where the person skipped or never
 * answered: the answer is then written for anyone, as before.
 */
export type Reader = Readonly<{ experience: NonNullable<AssistantProfile["experience"]>; goal: NonNullable<AssistantProfile["goal"]>; horizon: NonNullable<AssistantProfile["horizon"]> }>;

export function readerOf(profile: AssistantProfile | null): Reader | null {
  if (profile === null || profile.skipped || profile.experience === null || profile.goal === null || profile.horizon === null) return null;
  return { experience: profile.experience, goal: profile.goal, horizon: profile.horizon };
}
