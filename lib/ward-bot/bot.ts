/**
 * The pre-sign check as a Telegram bot for groups (CITY-166; decision 88: «Agents propose. Ryntra checks. You sign.»).
 *
 * Someone in a group pastes an address, a CA, a link or a transaction; the bot answers that message with one line —
 * the engine's verdict (`lib/ward/check.ts`, the same check as `POST /api/v1/ward/check`). In a private chat it does
 * the same. `/check` checks its argument or the message it replies to (the way in for a group where the bot sees only
 * commands); `/start` and `/help` say what it does.
 *
 * It only reads. It holds no one's key, signs nothing, moves nothing and keeps nothing but in-memory counters; it
 * never asks anyone for a key or a seed phrase. Its best word is «No known blockers», never «safe». Foreign text is
 * cleaned before it is searched (`clean.ts`); the bot calls no model and repeats none of it.
 *
 * Quiet by design: messages from bots, edits, channel posts and stale backlog are not answered; in a group a message
 * with nothing to check gets no reply, the same paste is not answered twice, and past a limit the bot says so once.
 *
 * Every effect is injected (`WardBotDeps`): the route passes Telegram and the chain, the tests pass stubs.
 */

import { checkSubject, verdictLine, type WardBotOutcome } from "./engine.ts";
import { findSubject, subjectKey, type WardBotSubject } from "./extract.ts";
import { WARD_BOT_LIMITS, type WardBotGate } from "./limits.ts";
import { langOf, WARD_BOT_WORDS, type WardBotLang } from "./words.ts";

/* ---------------------------------------------------------------- Telegram's shapes, as far as they are read */

export type TgChat = Readonly<{ id: number; type: string }>;
export type TgUser = Readonly<{ id: number; is_bot?: boolean; username?: string; language_code?: string }>;
export type TgMessage = Readonly<{
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  via_bot?: TgUser;
  text?: string;
  caption?: string;
  reply_to_message?: TgMessage;
}>;
export type TgMemberUpdate = Readonly<{
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: Readonly<{ status: string }>;
  new_chat_member: Readonly<{ status: string }>;
}>;
export type TgWardUpdate = Readonly<{ update_id: number; message?: TgMessage; my_chat_member?: TgMemberUpdate }>;

/* ---------------------------------------------------------------- what the bot needs */

export type WardBotReply = Readonly<{
  chatId: number;
  text: string;
  /** The message answered, so the line sits under the paste. */
  replyTo: number | null;
  /** No sound for anything but a «Stop». */
  quiet: boolean;
}>;

export type WardBotDeps = Readonly<{
  send: (reply: WardBotReply) => Promise<unknown>;
  check: (subject: WardBotSubject, known: readonly string[]) => Promise<WardBotOutcome>;
  gate: WardBotGate;
  /** The bot's own username, to tell `/check@ThisBot` from another bot's command; null when it could not be read. */
  username: () => Promise<string | null>;
  now: () => number;
}>;

/** What the bot did with an update — for the tests and the route's log, never shown to anyone. */
export type WardBotResult = Readonly<{ sent: boolean; why: string }>;

/** How long one check may take before the bot gives up on it. */
export const WARD_BOT_CHECK_MS = 20_000;

const GROUPS = new Set(["group", "supergroup"]);
const COMMAND = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/;

const silent = (why: string): WardBotResult => ({ sent: false, why });

async function reply(deps: WardBotDeps, chatId: number, text: string, replyTo: number | null, quiet = true, why = "answered"): Promise<WardBotResult> {
  await deps.send({ chatId, text, replyTo, quiet });
  return { sent: true, why };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the check took too long")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** The check itself, from admission to the line. */
async function check(
  deps: WardBotDeps,
  args: Readonly<{ msg: TgMessage; user: TgUser; subject: WardBotSubject; lang: WardBotLang; direct: boolean; asked: boolean }>,
): Promise<WardBotResult> {
  const { msg, user, subject, lang, direct, asked } = args;
  const words = WARD_BOT_WORDS[lang];
  const chatId = msg.chat.id;
  /* A signature is of a transaction already sent: nothing is left to check before signing. Said only when asked. */
  if (subject.kind === "signature") return (direct || asked) && deps.gate.mayHint(chatId, user.id, direct) ? reply(deps, chatId, words.signature, msg.message_id, true, "signature") : silent("signature");

  const key = subjectKey(subject);
  const admission = deps.gate.admit({ chatId, userId: user.id, direct, key });
  if (!admission.ok) {
    if (!admission.notice) return silent(admission.why);
    const text = admission.why === "member" ? words.busyUser(admission.retryAfterSeconds / 60) : words.busyChat(admission.retryAfterSeconds / 60);
    return reply(deps, chatId, text, msg.message_id, true, `busy:${admission.why}`);
  }

  let outcome: WardBotOutcome;
  try {
    outcome = await withTimeout(deps.check(subject, subject.kind === "address" ? deps.gate.knownIn(chatId) : []), WARD_BOT_CHECK_MS);
  } catch {
    deps.gate.forget(chatId, key);
    return reply(deps, chatId, words.failed, msg.message_id, true, "failed");
  }
  if (outcome.kind === "unread") {
    deps.gate.forget(chatId, key);
    return reply(deps, chatId, words.unread, msg.message_id, true, "unread");
  }
  if (outcome.kind === "not-checkable") return direct || asked ? reply(deps, chatId, words.notCheckable, msg.message_id, true, "not-checkable") : silent("not-checkable");

  if (subject.kind === "address") deps.gate.remember(chatId, subject.value);
  return reply(deps, chatId, verdictLine(outcome, lang), msg.message_id, outcome.verdict !== "block", `verdict:${outcome.verdict}`);
}

async function onMessage(deps: WardBotDeps, msg: TgMessage): Promise<WardBotResult> {
  const user = msg.from;
  const direct = msg.chat.type === "private";
  if (!direct && !GROUPS.has(msg.chat.type)) return silent("not a group");
  if (!user || user.is_bot || msg.via_bot) return silent("from a bot");
  if (deps.now() - msg.date * 1_000 > WARD_BOT_LIMITS.staleMs) return silent("stale");
  const lang = langOf(user.language_code);
  const words = WARD_BOT_WORDS[lang];
  const text = msg.text ?? msg.caption ?? "";

  const command = COMMAND.exec(text.trim());
  if (command) {
    const [, name, to, rest] = command;
    if (to) {
      const own = await deps.username();
      if (own !== null && to.toLowerCase() !== own.toLowerCase()) return silent("another bot's command");
    }
    switch (name.toLowerCase()) {
      case "start":
      case "help":
        /* In a group several bots may answer a bare /help: this one introduces itself there once per window. Asked by name, or in private, it answers within the person's budget. */
        if (!direct && !to) return deps.gate.introduce(msg.chat.id) ? reply(deps, msg.chat.id, words.intro, msg.message_id, true, "intro") : silent("introduced");
        return deps.gate.mayHint(msg.chat.id, user.id, direct) ? reply(deps, msg.chat.id, words.intro, direct ? null : msg.message_id, true, "intro") : silent("member");
      case "check": {
        const source = rest?.trim() ? rest : (msg.reply_to_message?.text ?? msg.reply_to_message?.caption ?? "");
        const subject = findSubject(source);
        if (!subject) return deps.gate.mayHint(msg.chat.id, user.id, direct) ? reply(deps, msg.chat.id, words.hint, msg.message_id, true, "hint") : silent("member");
        return check(deps, { msg: rest?.trim() || !msg.reply_to_message ? msg : { ...msg.reply_to_message, chat: msg.chat }, user, subject, lang, direct, asked: true });
      }
      default:
        return silent("not a command of this bot");
    }
  }

  const subject = findSubject(text);
  if (!subject) {
    if (!direct) return silent("nothing to check");
    /* A private chat that pastes something unreadable is told what to paste — within the person's own budget. */
    return deps.gate.mayHint(msg.chat.id, user.id, true) ? reply(deps, msg.chat.id, words.hint, null, true, "hint") : silent("member");
  }
  return check(deps, { msg, user, subject, lang, direct, asked: false });
}

/** Added to a group: one line on what the bot does, once. */
async function onJoined(deps: WardBotDeps, update: TgMemberUpdate): Promise<WardBotResult> {
  if (!GROUPS.has(update.chat.type)) return silent("not a group");
  const was = update.old_chat_member.status;
  const is = update.new_chat_member.status;
  const joined = (was === "left" || was === "kicked") && (is === "member" || is === "administrator");
  if (!joined) return silent("membership unchanged");
  if (deps.now() - update.date * 1_000 > WARD_BOT_LIMITS.staleMs) return silent("stale");
  if (!deps.gate.introduce(update.chat.id)) return silent("introduced");
  return reply(deps, update.chat.id, WARD_BOT_WORDS[langOf(update.from.language_code)].intro, null, true, "intro");
}

export async function handleWardUpdate(update: TgWardUpdate, deps: WardBotDeps): Promise<WardBotResult> {
  if (typeof update?.update_id !== "number") return silent("not an update");
  if (deps.gate.seen(update.update_id)) return silent("redelivered");
  if (update.message) return onMessage(deps, update.message);
  if (update.my_chat_member) return onJoined(deps, update.my_chat_member);
  return silent("nothing to do");
}

/** The engine with the given reads, as the bot calls it. */
export function engineCheck(reads: () => Parameters<typeof checkSubject>[1]): WardBotDeps["check"] {
  return (subject, known) => checkSubject(subject, reads(), { known });
}
