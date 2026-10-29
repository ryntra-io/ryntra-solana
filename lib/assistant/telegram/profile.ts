/**
 * The bot's profile in Telegram (AI-07) — its name, the description shown
 * before Start, the short one on its page and the list of commands, in
 * English (the default) and Ukrainian — set by the bot itself through the Bot
 * API with its own token from the server's environment. Nothing to do by hand in BotFather.
 *
 * Read first, written only where Telegram holds something else: a release
 * that changed nothing writes nothing, and `setMyName` — which Telegram
 * limits hard — is called only when the name differs. The beta's Russian
 * list of commands is removed. Pure over the Bot API call it is given.
 */

import { BOT_COMMANDS, BOT_PROFILE, type TgLocale } from "./words.ts";

/** One Bot API call: its result, or null when Telegram refused or did not answer. */
export type BotApi = <T = unknown>(method: string, body: Record<string, unknown>) => Promise<T | null>;

type Command = Readonly<{ command: string; description: string }>;

const sameCommands = (held: readonly Command[] | null, wanted: readonly Command[]): boolean =>
  Array.isArray(held) && held.length === wanted.length && held.every((row, index) => row.command === wanted[index]!.command && row.description === wanted[index]!.description);

export type ProfileOutcome = Readonly<{ state: "same" | "applied" | "failed"; written: readonly string[] }>;

export async function ensureBotProfile(api: BotApi): Promise<ProfileOutcome> {
  const written: string[] = [];
  let failed = false;
  const write = async (method: string, body: Record<string, unknown>) => {
    const result = await api(method, body);
    written.push(method + (body.language_code ? `:${String(body.language_code)}` : ""));
    /* Telegram limits renaming hard: a refused name waits for the next release, it never makes every instance retry. */
    if (result === null && method !== "setMyName") failed = true;
  };
  for (const [locale, scope] of [["en", {}], ["uk", { language_code: "uk" }]] as const satisfies readonly (readonly [TgLocale, Record<string, string>])[]) {
    const words = BOT_PROFILE[locale];
    const commands = await api<Command[]>("getMyCommands", scope);
    if (commands === null) return { state: "failed", written };
    if (!sameCommands(commands, BOT_COMMANDS[locale])) await write("setMyCommands", { commands: BOT_COMMANDS[locale], ...scope });
    const description = await api<{ description?: string }>("getMyDescription", scope);
    if (description?.description !== words.description) await write("setMyDescription", { description: words.description, ...scope });
    const short = await api<{ short_description?: string }>("getMyShortDescription", scope);
    if (short?.short_description !== words.short) await write("setMyShortDescription", { short_description: words.short, ...scope });
    const name = await api<{ name?: string }>("getMyName", scope);
    if (name?.name !== words.name) await write("setMyName", { name: words.name, ...scope });
  }
  const russian = await api<Command[]>("getMyCommands", { language_code: "ru" });
  if (Array.isArray(russian) && russian.length > 0) await write("deleteMyCommands", { language_code: "ru" });
  if (failed) return { state: "failed", written };
  return { state: written.length > 0 ? "applied" : "same", written };
}

const PROFILE_RETRY_MS = 10 * 60_000;
const memory = globalThis as typeof globalThis & { __ryntraBotProfile?: { done: boolean; triedAt: number } };

/**
 * Once per instance: the first cron pass or webhook update after a release
 * makes the profile right, a failure tries again ten minutes on. Never
 * throws — a profile is no reason to fail a pass or an update.
 */
export async function ensureBotProfileOnce(api: BotApi, nowMs: number = Date.now()): Promise<ProfileOutcome | null> {
  const seen = (memory.__ryntraBotProfile ??= { done: false, triedAt: Number.NEGATIVE_INFINITY });
  if (seen.done || nowMs - seen.triedAt < PROFILE_RETRY_MS) return null;
  seen.triedAt = nowMs;
  try {
    const outcome = await ensureBotProfile(api);
    if (outcome.state !== "failed") seen.done = true;
    if (outcome.state === "applied") console.info(`[assistant.telegram] bot profile written: ${outcome.written.join(", ")}`);
    return outcome;
  } catch {
    return { state: "failed", written: [] };
  }
}
