/**
 * The assistant in Telegram — the same
 * Ryntra as on ryntra.io, for a chat bound to an account.
 *
 * - A chat with no binding gets only the way to connect (Settings →
 *   «Підключити Telegram»); nothing of anyone's own is read for it.
 * - A question goes the web's own way: `handleAgentMessage` for the
 *   account's wallet, the same session store, the same model, the same
 *   credits (the account's balance — one holder for the web and Telegram).
 *   The free credits pay first; when they are spent, the price from the
 *   balance is shown before the question is asked (`acceptCredits` is only
 *   ever a price a button showed).
 * - A voice message: its length and price first, «Розпізнати» hears it on
 *   the server (6 credits per started 30 s, up to 2 min; a failed hearing
 *   gives them back), the words come back with «Так / Виправити», and only
 *   «Так» asks them. Ryntra answers in text.
 * - The commands read what the web reads: /watch (and «/watch BONK» to start
 *   one), /plans (the plans there are — the plan with its critic comes with
 *   AI-11), /brief, /credits, /settings, /help.
 * - A notification's buttons: «Чому?» asks the note's question at the price
 *   it shows, «Мій план» shows the plans on that token, «Пауза» pauses the
 *   watch that rang (or the brief).
 *
 * No tool here signs, sends, trades, approves a spend or reads a key: every
 * write is the person's own setting (a watch, the brief, the language, the
 * wallet read for, the binding removed). Nothing is sold and no payment is
 * linked in Telegram (its rules for digital goods, PLAN §10).
 */

import type { AgentDeps } from "../../agent/service.ts";
import { creditsContextFor, handleAgentMessage, openAgentSession, readAgentSession } from "../../agent/service.ts";
import { readAgentCredits } from "../../agent/budget.ts";
import { AGENT_QUESTION_MAX, type AgentContext } from "../../api/v1/contract.ts";
import { disconnectTelegramChannel } from "../../account/notifications.ts";
import type { GuardStore } from "../../guard/store.ts";
import { briefTelegramText } from "../brief/telegram.ts";
import { readBriefSurface, updateBriefSettings } from "../brief/service.ts";
import { reserveCredits, settleCredits } from "../credits/ledger.ts";
import { priceOf } from "../credits/prices.ts";
import { PRESET_WORDS, ruleWords, WATCH_PRESETS } from "../watch/rules.ts";
import { createWatch, readWatchSurface, updateWatch, watchView, type TokenLookup } from "../watch/service.ts";
import { readWatch } from "../watch/store.ts";
import { chooseWallet, CHAT_VOICE_PER_DAY, claimVoiceSeconds, dayOf, PENDING_MS, resolveChat, settleVoiceSeconds, takeMinute, updateChat, TELEGRAM_COLLECTION, chatKey, type ChatLink, type ChatRecord, type WalletsOf } from "./link.ts";
import { answerKeyboard, answerText, asksOf, type TgKeyboard } from "./render.ts";
import { judgeVoice, oggSeconds, voiceBytesAllowed, voiceCredits, type Heard, type Transcriber } from "./voice.ts";
import { shortWallet, wordsFor, type TgLocale } from "./words.ts";
import { escapeHtml } from "../../telegram/api.ts";

/* ------------------------------------------------------------ the ports */

export type TgUser = Readonly<{ id: number; username?: string; first_name?: string; language_code?: string }>;
export type TgVoice = Readonly<{ file_id: string; file_unique_id: string; duration?: number; mime_type?: string; file_size?: number }>;
export type TgMessage = Readonly<{ message_id: number; chat: Readonly<{ id: number; type: string }>; from?: TgUser; text?: string; voice?: TgVoice; audio?: TgVoice }>;
export type TgCallback = Readonly<{ id: string; from: TgUser; data?: string; message?: TgMessage }>;

/** What the bot says through Telegram; the production port is `lib/telegram/api.ts`, the tests' a fake that records. */
export type TgPort = Readonly<{
  send(chatId: number, text: string, keyboard?: TgKeyboard): Promise<Readonly<{ message_id: number }> | null>;
  edit(chatId: number, messageId: number, text: string, keyboard?: TgKeyboard): Promise<unknown>;
  answer(callbackId: string, text?: string): Promise<unknown>;
  typing(chatId: number): Promise<unknown>;
  /** A file's bytes by its id, refused past `maxBytes`. */
  download(fileId: string, maxBytes: number): Promise<Readonly<{ ok: true; bytes: Uint8Array; mime: string }> | Readonly<{ ok: false; reason: string }>>;
}>;

export type AssistantBotDeps = Readonly<{
  store: GuardStore;
  tg: TgPort;
  walletsOf: WalletsOf;
  /** The agent's dependencies for this wallet — the web's own (`agentDepsFor`), or the stand's fixture world. */
  agentFor: (owner: string, telegramId: number) => Promise<AgentDeps>;
  transcriber: Transcriber | null;
  lookupToken: TokenLookup;
  voiceDailySeconds: number;
  origin: string;
  now: () => number;
}>;

const localeOfUser = (user: TgUser | undefined): TgLocale => (user?.language_code?.toLowerCase().startsWith("uk") ? "uk" : "en");
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WATCH_ID = /^wch_[0-9a-f]{24}$/;
const INBOX_ID = /^inb_[0-9a-z_]{4,40}$/;

/* ------------------------------------------------------------ the chat */

type Linked = Extract<ChatLink, { state: "linked" }>;

async function linkOf(deps: AssistantBotDeps, user: TgUser): Promise<ChatLink> {
  return resolveChat(deps.store, user.id, { walletsOf: deps.walletsOf, locale: localeOfUser(user), nowMs: deps.now() });
}

/** Everything but a linked chat is answered here with what the person can do; `null` — go on. */
async function refuseUnlinked(deps: AssistantBotDeps, chatId: number, link: ChatLink, locale: TgLocale, withBroadcasts = false): Promise<Linked | null> {
  const words = wordsFor(locale);
  if (link.state === "linked") return link;
  /* /settings from a chat with no binding still reaches the broadcast toggles (`a:np`) — an opt-out is never behind a binding. */
  const keyboard: TgKeyboard = [[{ text: words.openSettings, url: `${deps.origin}/app/settings` }], ...(withBroadcasts ? [[{ text: words.broadcasts, callback_data: "a:np" }]] : [])];
  if (link.state === "unlinked") await deps.tg.send(chatId, `${escapeHtml(words.hello)}\n\n${escapeHtml(words.unlinked)}`, keyboard);
  else if (link.state === "no-wallet") await deps.tg.send(chatId, escapeHtml(words.noWallet), withBroadcasts ? keyboard.slice(1) : undefined);
  else await deps.tg.send(chatId, escapeHtml(words.unavailable), withBroadcasts ? keyboard.slice(1) : undefined);
  return null;
}

/** The chat's minute: past the limit the chat is told once, then not answered until the minute ends. */
async function withinMinute(deps: AssistantBotDeps, chatId: number, link: Linked): Promise<boolean> {
  const decision = await takeMinute(deps.store, link.chat.telegramId, deps.now());
  if (decision === "slow-down") await deps.tg.send(chatId, escapeHtml(wordsFor(link.chat.locale).slowDown));
  return decision === "ok";
}

const fresh = (at: string, nowMs: number) => nowMs - Date.parse(at) <= PENDING_MS;

/** Take what waits for a button, once: two presses of one button cannot both act. */
async function takePending<K extends NonNullable<ChatRecord["pending"]>["kind"]>(deps: AssistantBotDeps, telegramId: number, kind: K): Promise<Extract<NonNullable<ChatRecord["pending"]>, { kind: K }> | null> {
  const box: { taken: NonNullable<ChatRecord["pending"]> | null } = { taken: null };
  const at = new Date(deps.now()).toISOString();
  const written = await updateChat(deps.store, telegramId, (current) => {
    box.taken = null;
    if (current.pending?.kind !== kind) return null;
    box.taken = current.pending;
    return { ...current, pending: null, updatedAt: at };
  });
  /* A store that did not answer took nothing: the button asks again rather than acting twice. */
  if (!written || written.pending !== null) return null;
  return box.taken as Extract<NonNullable<ChatRecord["pending"]>, { kind: K }> | null;
}

async function setPending(deps: AssistantBotDeps, telegramId: number, pending: ChatRecord["pending"], extra: Partial<Pick<ChatRecord, "suggestions" | "sessionId">> = {}): Promise<void> {
  const at = new Date(deps.now()).toISOString();
  await updateChat(deps.store, telegramId, (current) => ({ ...current, pending, ...extra, updatedAt: at }));
}

/**
 * The wallet a press is about: the chat's own first, then the account's
 * other proven wallets — a note reaches the account's chat whichever of its
 * wallets it is about. Never a wallet the account does not prove.
 */
async function walletFor(deps: AssistantBotDeps, link: Linked, owns: (wallet: string) => Promise<boolean>): Promise<Linked | null> {
  if (await owns(link.wallet).catch(() => false)) return link;
  const wallets = (await deps.walletsOf(link.accountId).catch(() => undefined)) ?? [];
  for (const wallet of wallets) {
    /* Another wallet's conversation is its own: the question opens a session of that wallet. */
    if (wallet !== link.wallet && (await owns(wallet).catch(() => false))) return { ...link, wallet, chat: { ...link.chat, sessionId: null } };
  }
  return null;
}

/* ------------------------------------------------------------ the question */

async function sessionFor(agent: AgentDeps, link: Linked, deps: AssistantBotDeps, forceNew = false, context: AgentContext | null = null): Promise<string | null> {
  if (link.chat.sessionId && !forceNew) return link.chat.sessionId;
  const opened = await openAgentSession(agent, { owner: link.wallet, locale: link.chat.locale, context, fresh: true });
  if (!opened.ok) return null;
  const sessionId = opened.response.session.id;
  const at = new Date(deps.now()).toISOString();
  /* The chat keeps the conversation of the wallet it reads for; another wallet's session lives for its one question. */
  if (link.wallet === link.chat.wallet) await updateChat(deps.store, link.chat.telegramId, (current) => ({ ...current, sessionId, updatedAt: at }));
  return sessionId;
}

/**
 * Ask a question for the linked chat. `accept` is the price a button showed
 * for this very question, or null; when the free credits do not cover it and
 * the balance does, the price is shown first and nothing is asked.
 */
export async function askQuestion(deps: AssistantBotDeps, chatId: number, link: Linked, text: string, accept: number | null, context: AgentContext | null = null): Promise<void> {
  const locale = link.chat.locale;
  const words = wordsFor(locale);
  const question = text.trim();
  if (question.length === 0) return;
  if (question.length > AGENT_QUESTION_MAX) {
    await deps.tg.send(chatId, escapeHtml(words.tooLongText));
    return;
  }
  const agent = await deps.agentFor(link.wallet, link.chat.telegramId);
  /* A question about something (a note) opens its own conversation in that context, as the web's «Спитати Ryntra» does. */
  let sessionId = await sessionFor(agent, link, deps, context !== null, context);
  if (!sessionId) {
    await deps.tg.send(chatId, escapeHtml(words.failed));
    return;
  }
  /* The price before the action: the free credits pay without a word; the balance only after a button showed its price. */
  let state = await readAgentSession(agent, link.wallet, sessionId).catch(() => null);
  if (!state) {
    /* The conversation ran past its retention: a new one, read before the price is decided. */
    sessionId = await sessionFor(agent, link, deps, true);
    if (!sessionId) {
      await deps.tg.send(chatId, escapeHtml(words.failed));
      return;
    }
    state = await readAgentSession(agent, link.wallet, sessionId).catch(() => null);
  }
  const wallet = state?.budget.credits;
  if (wallet) {
    const price = wallet.prices.question;
    const fromBalance = wallet.free.left < price;
    if (fromBalance && wallet.balance >= price && accept !== price) {
      await setPending(deps, link.chat.telegramId, { kind: "question", text: question, credits: price, at: new Date(deps.now()).toISOString(), ...(link.wallet !== link.chat.wallet ? { wallet: link.wallet } : {}) });
      await deps.tg.send(chatId, escapeHtml(words.askPrice(price, wallet.balance)), [[{ text: words.askButton(price), callback_data: "a:k" }, { text: words.cancel, callback_data: "a:x:question" }]]);
      return;
    }
  }
  await deps.tg.typing(chatId).catch(() => undefined);
  let result = await handleAgentMessage(agent, { owner: link.wallet, sessionId, text: question, locale, acceptCredits: accept });
  if (!result.ok && result.code === "AGENT_SESSION_NOT_FOUND") {
    /* The conversation ran past its retention: a new one, the same question. */
    sessionId = await sessionFor(agent, link, deps, true);
    if (sessionId) result = await handleAgentMessage(agent, { owner: link.wallet, sessionId, text: question, locale, acceptCredits: accept });
  }
  if (!result.ok || !sessionId) {
    await deps.tg.send(chatId, escapeHtml(result.ok ? words.failed : result.code === "AGENT_BUSY" ? words.busy : result.code === "AGENT_BUDGET_EXHAUSTED" ? words.budgetOut : words.failed));
    return;
  }
  const turn = result.response.ryn;
  /* An answer for another wallet of the account (a note's button) leaves the chat's own conversation and suggestions as they were. */
  if (link.wallet === link.chat.wallet) await setPending(deps, link.chat.telegramId, null, { suggestions: asksOf(turn), sessionId });
  else await setPending(deps, link.chat.telegramId, null, { suggestions: [] });
  await deps.tg.send(chatId, answerText(turn, locale, result.response.budget), answerKeyboard(turn, { locale, origin: deps.origin, asks: link.wallet === link.chat.wallet }));
}

/* ------------------------------------------------------------ the voice */

async function creditsOf(agent: AgentDeps, owner: string, nowMs: number) {
  const context = await creditsContextFor(agent, owner, nowMs);
  if (!context) return null;
  return { context, view: await readAgentCredits(agent.store, context, nowMs) };
}

/** A voice message: refused on what Telegram says of it, or offered with its length and price. */
export async function offerVoice(deps: AssistantBotDeps, chatId: number, link: Linked, voice: TgVoice): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const judged = judgeVoice({ seconds: voice.duration, bytes: voice.file_size, mime: voice.mime_type });
  if (!judged.ok) {
    await deps.tg.send(chatId, escapeHtml(judged.why === "too-long" ? words.voiceTooLong : judged.why === "too-big" ? words.voiceTooBig : words.voiceNotVoice));
    return;
  }
  if (!deps.transcriber) {
    await deps.tg.send(chatId, escapeHtml(words.voiceOff));
    return;
  }
  const nowMs = deps.now();
  if (link.chat.voiceDay.day === dayOf(nowMs) && link.chat.voiceDay.count >= CHAT_VOICE_PER_DAY) {
    await deps.tg.send(chatId, escapeHtml(words.voiceDay));
    return;
  }
  const agent = await deps.agentFor(link.wallet, link.chat.telegramId);
  const held = await creditsOf(agent, link.wallet, nowMs).catch(() => null);
  if (!held) {
    /* Without the credits the deployment cannot price a voice message, so it hears none. */
    await deps.tg.send(chatId, escapeHtml(words.voiceOff));
    return;
  }
  const price = voiceCredits(held.context.config, judged.seconds);
  const free = held.view.free.left;
  const balance = held.view.balance;
  if (free + balance < price && free < price) {
    await deps.tg.send(chatId, escapeHtml(words.voiceNoCredits(price)));
    return;
  }
  await setPending(deps, link.chat.telegramId, { kind: "voice", fileId: voice.file_id, fileUniqueId: voice.file_unique_id, seconds: judged.seconds, credits: price, at: new Date(nowMs).toISOString() });
  const text = free >= price ? words.voiceOffer(judged.seconds, price) : `${words.voiceOffer(judged.seconds, price)}\n${words.voicePrice(price, balance)}`;
  await deps.tg.send(chatId, escapeHtml(text), [[{ text: words.voiceButton(price), callback_data: "a:v" }, { text: words.cancel, callback_data: "a:x:voice" }]]);
}

/** «Розпізнати»: the price held, the file heard, the price kept only for words heard. */
export async function hearVoice(deps: AssistantBotDeps, chatId: number, link: Linked, messageId: number | undefined): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const pending = await takePending(deps, link.chat.telegramId, "voice");
  const nowMs = deps.now();
  if (!pending || !fresh(pending.at, nowMs)) {
    await deps.tg.send(chatId, escapeHtml(words.expired));
    return;
  }
  if (!deps.transcriber) {
    await deps.tg.send(chatId, escapeHtml(words.voiceOff));
    return;
  }
  const agent = await deps.agentFor(link.wallet, link.chat.telegramId);
  const context = await creditsContextFor(agent, link.wallet, nowMs).catch(() => null);
  if (!context) {
    await deps.tg.send(chatId, escapeHtml(words.voiceOff));
    return;
  }
  /* The price shown is the price held: a price that moved since asks again. */
  const price = voiceCredits(context.config, pending.seconds);
  if (price !== pending.credits) {
    await offerVoice(deps, chatId, link, { file_id: pending.fileId, file_unique_id: pending.fileUniqueId, duration: pending.seconds });
    return;
  }
  if (!(await claimVoiceSeconds(deps.store, pending.seconds, deps.voiceDailySeconds, nowMs))) {
    await deps.tg.send(chatId, escapeHtml(words.voiceDay));
    return;
  }
  const idem = `tg-voice:${link.chat.telegramId}:${pending.fileUniqueId}:${pending.at}`;
  const held = await reserveCredits(deps.store, context.holder, { action: "voice", amount: price, acceptCredits: pending.credits, idem, config: context.config, nowMs });
  if (!held.ok) {
    await settleVoiceSeconds(deps.store, { claimed: pending.seconds, heard: 0, microUsd: 0, claimedAtMs: nowMs });
    await deps.tg.send(chatId, escapeHtml(held.code === "CREDITS_EXHAUSTED" ? words.voiceNoCredits(price) : held.code === "CREDITS_LIMIT" ? words.voiceLimit : held.code === "CREDITS_BUSY" ? words.busy : words.failed));
    return;
  }
  if (messageId) await deps.tg.edit(chatId, messageId, escapeHtml(words.voiceOffer(pending.seconds, price))).catch(() => undefined);
  await deps.tg.typing(chatId).catch(() => undefined);
  /* The length Telegram states is the sender's word: a file larger than that length can be is not heard (`voiceBytesAllowed`). */
  const file = await deps.tg.download(pending.fileId, voiceBytesAllowed(pending.seconds)).catch(() => ({ ok: false as const, reason: "the file did not come" }));
  const real = file.ok ? oggSeconds(file.bytes) : null;
  const heard = file.ok && (real ?? 0) <= pending.seconds + 2 ? await deps.transcriber({ bytes: file.bytes, mime: file.mime, locale: link.chat.locale, seconds: pending.seconds }).catch((): Heard => ({ ok: false, reason: "the transcriber failed" })) : null;
  const settledAt = deps.now();
  if (file.ok && (oggSeconds(file.bytes) ?? 0) > pending.seconds + 2) {
    /* The container says the recording is longer than the message said: not heard, nothing charged. */
    await settleCredits(deps.store, context.holder, { holdId: held.holdId, charged: 0, idem: `${idem}:release`, nowMs: settledAt }).catch(() => null);
    await settleVoiceSeconds(deps.store, { claimed: pending.seconds, heard: 0, microUsd: 0, claimedAtMs: nowMs });
    await deps.tg.send(chatId, escapeHtml(words.voiceTooLong));
    return;
  }
  if (!heard || !heard.ok) {
    await settleCredits(deps.store, context.holder, { holdId: held.holdId, charged: 0, idem: `${idem}:release`, nowMs: settledAt }).catch(() => null);
    /* Silence the provider billed (AI-21): free to the person, counted in the deployment's day and in the chat's — free silence never spends everyone's day. */
    await settleVoiceSeconds(deps.store, { claimed: pending.seconds, heard: heard?.billedSeconds ?? 0, microUsd: heard?.costMicroUsd ?? 0, claimedAtMs: nowMs });
    if (heard && heard.billedSeconds) {
      const day = dayOf(settledAt);
      await updateChat(deps.store, link.chat.telegramId, (current) => ({ ...current, voiceDay: { day, count: current.voiceDay.day === day ? current.voiceDay.count + 1 : 1 }, updatedAt: new Date(settledAt).toISOString() }));
    }
    await deps.tg.send(chatId, escapeHtml(words.notHeard));
    return;
  }
  await settleCredits(deps.store, context.holder, { holdId: held.holdId, charged: price, idem: `${idem}:capture`, nowMs: settledAt }).catch(() => null);
  await settleVoiceSeconds(deps.store, { claimed: pending.seconds, heard: heard.billedSeconds, microUsd: heard.costMicroUsd ?? 0, claimedAtMs: nowMs });
  const at = new Date(settledAt).toISOString();
  const day = dayOf(settledAt);
  await updateChat(deps.store, link.chat.telegramId, (current) => ({
    ...current,
    pending: { kind: "heard", text: heard.text, at },
    voiceDay: { day, count: current.voiceDay.day === day ? current.voiceDay.count + 1 : 1 },
    updatedAt: at,
  }));
  await deps.tg.send(chatId, `${escapeHtml(words.heard(heard.text))}\n\n<i>${escapeHtml(words.heardCharged(price))}</i>\n${escapeHtml(words.heardAsk)}`, [[{ text: words.yes, callback_data: "a:y" }, { text: words.fix, callback_data: "a:f" }]]);
}

/* ------------------------------------------------------------ the commands */

export async function showCredits(deps: AssistantBotDeps, chatId: number, link: Linked): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const agent = await deps.agentFor(link.wallet, link.chat.telegramId);
  const held = await creditsOf(agent, link.wallet, deps.now()).catch(() => undefined);
  if (held === undefined) {
    await deps.tg.send(chatId, escapeHtml(words.unavailable));
    return;
  }
  if (held === null) {
    await deps.tg.send(chatId, `<b>${escapeHtml(words.creditsTitle)}</b>\n\n${escapeHtml(words.creditsOff)}`);
    return;
  }
  const view = held.view;
  const lines = [
    `<b>${escapeHtml(words.creditsTitle)}</b>`,
    escapeHtml(words.creditsFree(view.free.left, view.free.daily)),
    escapeHtml(words.creditsBalance(view.balance, view.welcome, view.bought)),
    escapeHtml(words.creditsPrices(view.prices.question, view.prices.alertExplain, view.prices.voice)),
    escapeHtml(words.creditsDay(view.dailySpend.used, view.dailySpend.cap)),
  ];
  if (view.reserved > 0) lines.push(escapeHtml(words.creditsReserved(view.reserved)));
  await deps.tg.send(chatId, lines.join("\n\n"));
}

/** The plans there are — on one token, or all of them; the plan with its critic comes with AI-11. */
export async function showPlans(deps: AssistantBotDeps, chatId: number, link: Linked, mint: string | null = null): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const agent = await deps.agentFor(link.wallet, link.chat.telegramId);
  const read = await agent.readers.plans(link.wallet).catch(() => null);
  if (!read) {
    await deps.tg.send(chatId, escapeHtml(words.unavailable));
    return;
  }
  const plans = read.plans.filter((plan) => mint === null || plan.asset.mint === mint);
  if (plans.length === 0) {
    await deps.tg.send(chatId, `<b>${escapeHtml(words.plansTitle)}</b>\n\n${escapeHtml(words.plansNone)}`, [[{ text: words.plansOpenAll, url: `${deps.origin}/app/strategies/plans` }]]);
    return;
  }
  const shown = plans.slice(0, 5);
  const lines = shown.map((plan) => `• ${escapeHtml(plan.asset.symbol)} — ${escapeHtml(words.planStatus[plan.status] ?? plan.status)}`);
  if (plans.length > shown.length) lines.push(escapeHtml(words.plansMore(plans.length - shown.length)));
  const keyboard: TgKeyboard = [
    ...shown.map((plan) => [{ text: words.planOpen(plan.asset.symbol), url: `${deps.origin}/app/strategies/plans/${plan.id}` }]),
    [{ text: words.plansOpenAll, url: `${deps.origin}/app/strategies/plans` }],
  ];
  await deps.tg.send(chatId, `<b>${escapeHtml(words.plansTitle)}</b>\n\n${lines.join("\n")}`, keyboard);
}

export async function showWatches(deps: AssistantBotDeps, chatId: number, link: Linked): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const agent = await deps.agentFor(link.wallet, link.chat.telegramId);
  const explain = agent.credits ? priceOf(agent.credits.config, "question") : 0;
  const surface = await readWatchSurface(deps.store, link.wallet, deps.now(), link.chat.locale, explain).catch(() => null);
  if (!surface) {
    await deps.tg.send(chatId, escapeHtml(words.unavailable));
    return;
  }
  if (surface.watches.length === 0) {
    await deps.tg.send(chatId, `<b>${escapeHtml(words.watchTitle)}</b>\n\n${escapeHtml(words.watchNone)}`);
    return;
  }
  const lines = surface.watches.map((watch) => `• ${escapeHtml(watch.symbol)} — ${escapeHtml(watch.ruleText)} · ${escapeHtml(words.watchState[watch.status] ?? watch.status)}${watch.now.text ? ` (${escapeHtml(watch.now.text)})` : ""}`);
  const keyboard: TgKeyboard = surface.watches.slice(0, 6).map((watch) => [watch.status === "active" ? { text: words.watchPause(watch.symbol), callback_data: `a:wp:${watch.id}` } : { text: words.watchResume(watch.symbol), callback_data: `a:wr:${watch.id}` }]);
  await deps.tg.send(chatId, `<b>${escapeHtml(words.watchTitle)}</b>\n\n${lines.join("\n")}\n\n${escapeHtml(words.watchAddHint(surface.limit.left))}`, [...keyboard, [{ text: words.open, url: `${deps.origin}/app/ryn?watch=all` }]]);
}

/** «/watch BONK»: the token found, then the presets to pick from. */
export async function startWatch(deps: AssistantBotDeps, chatId: number, link: Linked, query: string): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const asked = query.trim().slice(0, 64);
  if (MINT.test(asked)) {
    await offerPresets(deps, chatId, link, asked);
    return;
  }
  const agent = await deps.agentFor(link.wallet, link.chat.telegramId);
  const search = await agent.readers.spotSearch(asked.replace(/^\$/, ""), 5).catch(() => null);
  if (!search || !search.ok) {
    await deps.tg.send(chatId, escapeHtml(words.unavailable));
    return;
  }
  const rows = search.rows.filter((row) => !row.suspicious);
  const exact = rows.filter((row) => row.symbol.toLowerCase() === asked.replace(/^\$/, "").toLowerCase());
  const pick = exact.length === 1 ? exact : rows;
  if (pick.length === 0) {
    await deps.tg.send(chatId, escapeHtml(words.watchNotFound(asked)));
    return;
  }
  if (pick.length === 1) {
    await offerPresets(deps, chatId, link, pick[0]!.mint);
    return;
  }
  await deps.tg.send(chatId, escapeHtml(words.watchMany(asked)), pick.slice(0, 5).map((row) => [{ text: `${row.symbol} · ${row.mint.slice(0, 4)}…${row.mint.slice(-4)}`, callback_data: `a:wt:${row.mint}` }]));
}

async function offerPresets(deps: AssistantBotDeps, chatId: number, link: Linked, mint: string): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const token = await deps.lookupToken(mint).catch(() => undefined);
  if (token === undefined) {
    await deps.tg.send(chatId, escapeHtml(words.unavailable));
    return;
  }
  if (token === null) {
    await deps.tg.send(chatId, escapeHtml(words.watchNotFound(mint)));
    return;
  }
  if (token.suspicious) {
    await deps.tg.send(chatId, escapeHtml(words.watchSuspicious(token.symbol)));
    return;
  }
  const presets = WATCH_PRESETS.map((preset, index) => ({ preset, index })).filter(({ preset }) => token.priced !== false || (preset !== "below" && preset !== "above"));
  const rows: { text: string; callback_data: string }[][] = [];
  for (let at = 0; at < presets.length; at += 2) rows.push(presets.slice(at, at + 2).map(({ preset, index }) => ({ text: PRESET_WORDS[preset][link.chat.locale], callback_data: `a:wn:${index}:${mint}` })));
  await deps.tg.send(chatId, escapeHtml(words.watchPick(token.symbol)), rows);
}

async function createFromPreset(deps: AssistantBotDeps, chatId: number, link: Linked, index: number, mint: string): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const preset = WATCH_PRESETS[index];
  if (!preset || !MINT.test(mint)) return;
  const made = await createWatch(deps.store, link.wallet, { mint, preset, cooldownMinutes: 60, channels: { telegram: true, push: true }, locale: link.chat.locale }, deps.now(), deps.lookupToken);
  if (made.ok) {
    await deps.tg.send(chatId, escapeHtml(words.watchCreated(made.watch.symbol, ruleWords(made.watch.rule, link.chat.locale))), [[{ text: words.watchPause(made.watch.symbol), callback_data: `a:wp:${made.watch.id}` }]]);
    return;
  }
  const text = made.code === "WATCH_LIMIT_REACHED" ? words.watchLimit : made.code === "PRICE_UNAVAILABLE" ? words.watchNoPrice : made.code === "ASSET_UNCONFIRMED" ? words.watchNotFound(mint) : made.code === "VALIDATION_ERROR" ? made.reason : words.watchFailed;
  await deps.tg.send(chatId, escapeHtml(text));
}

async function setWatchStatus(deps: AssistantBotDeps, chatId: number, link: Linked, id: string, status: "active" | "paused"): Promise<string> {
  const words = wordsFor(link.chat.locale);
  if (!WATCH_ID.test(id)) return words.watchGone;
  const changed = await updateWatch(deps.store, link.wallet, id, { status }, deps.now()).catch(() => null);
  if (!changed) return words.watchFailed;
  if (!changed.ok) return changed.code === "WATCH_NOT_FOUND" ? words.watchGone : words.watchFailed;
  const said = status === "paused" ? words.watchPaused(changed.watch.symbol) : words.watchResumed(changed.watch.symbol);
  await deps.tg.send(chatId, escapeHtml(said), [[status === "paused" ? { text: words.watchResume(changed.watch.symbol), callback_data: `a:wr:${id}` } : { text: words.watchPause(changed.watch.symbol), callback_data: `a:wp:${id}` }]]);
  return said;
}

export async function showBrief(deps: AssistantBotDeps, chatId: number, link: Linked): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const surface = await readBriefSurface(deps.store, link.wallet, deps.now(), link.chat.locale).catch(() => null);
  if (!surface) {
    await deps.tg.send(chatId, escapeHtml(words.unavailable));
    return;
  }
  const head = `<b>${escapeHtml(words.briefTitle)}</b>\n${escapeHtml(surface.settings.enabled ? words.briefOn(surface.settings.time, surface.settings.zone) : words.briefOff)}`;
  const whole = surface.latest ? await briefTelegramText(deps.store, link.wallet, surface.latest.day, link.chat.locale).catch(() => null) : null;
  /* Cut before escaping, so no entity or tag is split. */
  const body = escapeHtml(whole ? (whole.length > 3_400 ? `${whole.slice(0, 3_400)}…` : whole) : words.briefNone);
  const toggle = surface.settings.enabled ? { text: words.briefDisable, callback_data: "a:b0" } : { text: words.briefEnable, callback_data: "a:b1" };
  await deps.tg.send(chatId, `${head}\n\n${body}`, [[toggle], [{ text: words.open, url: `${deps.origin}/app/ryn` }]]);
}

async function setBrief(deps: AssistantBotDeps, link: Linked, enabled: boolean): Promise<string> {
  const words = wordsFor(link.chat.locale);
  const surface = await readBriefSurface(deps.store, link.wallet, deps.now(), link.chat.locale).catch(() => null);
  if (!surface) return words.unavailable;
  const done = await updateBriefSettings(deps.store, link.wallet, { enabled, time: surface.settings.time, zone: surface.settings.zone, locale: surface.settings.locale }, deps.now()).catch(() => null);
  if (!done || !done.ok) return words.unavailable;
  return enabled ? words.briefEnabled : words.briefDisabled;
}

export async function showSettings(deps: AssistantBotDeps, chatId: number, link: Linked, messageId?: number): Promise<void> {
  const words = wordsFor(link.chat.locale);
  const brief = await readBriefSurface(deps.store, link.wallet, deps.now(), link.chat.locale).catch(() => null);
  const wallets = (await deps.walletsOf(link.accountId).catch(() => undefined)) ?? [link.wallet];
  const lines = [
    `<b>${escapeHtml(words.settingsTitle)}</b>`,
    escapeHtml(words.settingsLang),
    escapeHtml(words.settingsWallet(shortWallet(link.wallet))),
    ...(brief ? [escapeHtml(words.settingsBrief(brief.settings.enabled, brief.settings.time))] : []),
    escapeHtml(words.settingsNotes),
  ];
  const keyboard: { text: string; callback_data: string }[][] = [[{ text: words.switchLang, callback_data: "a:lang" }]];
  if (wallets.length > 1) keyboard.push([{ text: words.otherWallet, callback_data: "a:wl" }]);
  if (brief) keyboard.push([brief.settings.enabled ? { text: words.briefDisable, callback_data: "a:b0" } : { text: words.briefEnable, callback_data: "a:b1" }]);
  keyboard.push([{ text: words.broadcasts, callback_data: "a:np" }]);
  keyboard.push([{ text: words.disconnect, callback_data: "a:dc" }]);
  if (messageId) {
    const edited = await deps.tg.edit(chatId, messageId, lines.join("\n"), keyboard).catch(() => null);
    if (edited) return;
  }
  await deps.tg.send(chatId, lines.join("\n"), keyboard);
}

/* ------------------------------------------------------------ the entries */

/** `/start` (and the binding just made): who Ryntra is, and either what to do here or how to connect. */
export async function assistantStart(deps: AssistantBotDeps, msg: TgMessage, input: Readonly<{ connected: boolean }> = { connected: false }): Promise<void> {
  if (!msg.from) return;
  const link = await linkOf(deps, msg.from);
  const locale = link.state === "linked" || link.state === "no-wallet" ? link.chat.locale : localeOfUser(msg.from);
  const words = wordsFor(locale);
  if (link.state !== "linked") {
    if (input.connected && link.state === "no-wallet") {
      await deps.tg.send(msg.chat.id, `${escapeHtml(words.connected)}\n\n${escapeHtml(words.noWallet)}`);
      return;
    }
    await refuseUnlinked(deps, msg.chat.id, link, locale);
    return;
  }
  const head = [input.connected ? words.connected : null, words.hello, words.helloLinked, words.wallet(shortWallet(link.wallet))].filter(Boolean).map((line) => escapeHtml(line!));
  await deps.tg.send(msg.chat.id, head.join("\n\n"), [
    [{ text: "/watch", callback_data: "a:c:watch" }, { text: "/plans", callback_data: "a:c:plans" }],
    [{ text: "/brief", callback_data: "a:c:brief" }, { text: "/credits", callback_data: "a:c:credits" }],
  ]);
}

export const ASSISTANT_COMMANDS = ["/watch", "/plans", "/brief", "/credits", "/settings", "/help"] as const;

/** One of the assistant's commands. `/help` answers anyone; the rest need a linked chat. */
export async function assistantCommand(deps: AssistantBotDeps, msg: TgMessage, cmd: string, arg: string): Promise<boolean> {
  if (!msg.from || !(ASSISTANT_COMMANDS as readonly string[]).includes(cmd)) return false;
  const link = await linkOf(deps, msg.from);
  const locale = link.state === "linked" || link.state === "no-wallet" ? link.chat.locale : localeOfUser(msg.from);
  if (cmd === "/help") {
    await deps.tg.send(msg.chat.id, escapeHtml(wordsFor(locale).help), link.state === "linked" ? undefined : [[{ text: wordsFor(locale).openSettings, url: `${deps.origin}/app/settings` }]]);
    return true;
  }
  const linked = await refuseUnlinked(deps, msg.chat.id, link, locale, cmd === "/settings");
  if (!linked || !(await withinMinute(deps, msg.chat.id, linked))) return true;
  if (cmd === "/watch") await (arg ? startWatch(deps, msg.chat.id, linked, arg) : showWatches(deps, msg.chat.id, linked));
  else if (cmd === "/plans") await showPlans(deps, msg.chat.id, linked);
  else if (cmd === "/brief") await showBrief(deps, msg.chat.id, linked);
  else if (cmd === "/credits") await showCredits(deps, msg.chat.id, linked);
  else if (cmd === "/settings") await showSettings(deps, msg.chat.id, linked);
  return true;
}

/** A private message that is no command: a question, a voice message, or the corrected words. */
export async function assistantMessage(deps: AssistantBotDeps, msg: TgMessage): Promise<void> {
  if (!msg.from) return;
  const link = await linkOf(deps, msg.from);
  const locale = link.state === "linked" || link.state === "no-wallet" ? link.chat.locale : localeOfUser(msg.from);
  const linked = await refuseUnlinked(deps, msg.chat.id, link, locale);
  if (!linked || !(await withinMinute(deps, msg.chat.id, linked))) return;
  const voice = msg.voice ?? msg.audio;
  if (voice) {
    await offerVoice(deps, msg.chat.id, linked, voice);
    return;
  }
  const text = (msg.text ?? "").trim();
  if (text.startsWith("/")) {
    /* An unknown command is no question to pay for: the list of what the bot does. */
    await deps.tg.send(msg.chat.id, escapeHtml(wordsFor(locale).help));
    return;
  }
  if (!text) {
    await deps.tg.send(msg.chat.id, escapeHtml(wordsFor(locale).onlyText));
    return;
  }
  /* A new message replaces whatever waited for a button. */
  if (linked.chat.pending) await setPending(deps, linked.chat.telegramId, null);
  await askQuestion(deps, msg.chat.id, linked, text, null);
}

/**
 * A press on one of the assistant's buttons (`a:…`). Answered at once (so
 * the button stops spinning), then acted on. `a:np` — the old broadcast
 * settings — is the bot's own and is answered by the caller.
 */
export async function assistantCallback(deps: AssistantBotDeps, cb: TgCallback): Promise<boolean> {
  const data = cb.data ?? "";
  if (!data.startsWith("a:") || data === "a:np") return false;
  const chatId = cb.message?.chat.id ?? cb.from.id;
  const messageId = cb.message?.message_id;
  const link = await linkOf(deps, cb.from);
  const locale = link.state === "linked" || link.state === "no-wallet" ? link.chat.locale : localeOfUser(cb.from);
  const words = wordsFor(locale);
  if (link.state !== "linked") {
    await deps.tg.answer(cb.id);
    await refuseUnlinked(deps, chatId, link, locale);
    return true;
  }
  if (!(await withinMinute(deps, chatId, link))) {
    await deps.tg.answer(cb.id);
    return true;
  }
  const [, verb = "", first = "", second = ""] = data.split(":");
  switch (verb) {
    case "c": {
      await deps.tg.answer(cb.id);
      if (first === "watch") await showWatches(deps, chatId, link);
      else if (first === "plans") await showPlans(deps, chatId, link);
      else if (first === "brief") await showBrief(deps, chatId, link);
      else if (first === "credits") await showCredits(deps, chatId, link);
      return true;
    }
    case "q": {
      await deps.tg.answer(cb.id);
      const question = link.chat.suggestions[Number(first)];
      if (question) await askQuestion(deps, chatId, link, question, null);
      return true;
    }
    case "k": {
      await deps.tg.answer(cb.id);
      const pending = await takePending(deps, link.chat.telegramId, "question");
      if (!pending || !fresh(pending.at, deps.now())) {
        await deps.tg.send(chatId, escapeHtml(words.expired));
        return true;
      }
      if (messageId) await deps.tg.edit(chatId, messageId, escapeHtml(pending.text)).catch(() => undefined);
      /* A price shown for another wallet's question (a note's button) is asked for that wallet, still one the account proves. */
      const owner = pending.wallet ? await walletFor(deps, link, async (wallet) => wallet === pending.wallet) : link;
      if (!owner) {
        await deps.tg.send(chatId, escapeHtml(words.expired));
        return true;
      }
      await askQuestion(deps, chatId, { ...owner, chat: { ...owner.chat, pending: null } }, pending.text, pending.credits);
      return true;
    }
    case "x": {
      await deps.tg.answer(cb.id, words.cancelled);
      /* «Скасувати» cancels what its own message offered — never a newer offer of another kind. */
      if (first === "question" || first === "voice") await takePending(deps, link.chat.telegramId, first);
      if (messageId) await deps.tg.edit(chatId, messageId, escapeHtml(words.cancelled)).catch(() => undefined);
      return true;
    }
    case "v": {
      await deps.tg.answer(cb.id);
      await hearVoice(deps, chatId, link, messageId);
      return true;
    }
    case "y": {
      await deps.tg.answer(cb.id);
      const heard = await takePending(deps, link.chat.telegramId, "heard");
      if (!heard || !fresh(heard.at, deps.now())) {
        await deps.tg.send(chatId, escapeHtml(words.expired));
        return true;
      }
      await askQuestion(deps, chatId, { ...link, chat: { ...link.chat, pending: null } }, heard.text, null);
      return true;
    }
    case "f": {
      await deps.tg.answer(cb.id);
      const heard = await takePending(deps, link.chat.telegramId, "heard");
      if (!heard) {
        await deps.tg.send(chatId, escapeHtml(words.expired));
        return true;
      }
      await deps.tg.send(chatId, `${escapeHtml(words.fixHow)}\n\n<code>${escapeHtml(heard.text)}</code>`);
      return true;
    }
    case "wp":
    case "wr": {
      await deps.tg.answer(cb.id);
      /* A note goes to the account's chat whichever of its wallets it is about: the watch is acted on for the wallet that holds it. */
      const owner = WATCH_ID.test(first) ? await walletFor(deps, link, async (wallet) => (await readWatch(deps.store, wallet, first)) !== null) : null;
      if (!owner) {
        await deps.tg.send(chatId, escapeHtml(words.watchGone));
        return true;
      }
      await setWatchStatus(deps, chatId, owner, first, verb === "wp" ? "paused" : "active");
      return true;
    }
    case "wy": {
      /* «Чому?» on a watch's note: its own question, for the wallet that holds the watch, at the price the button showed. */
      await deps.tg.answer(cb.id);
      const owner = WATCH_ID.test(first) ? await walletFor(deps, link, async (wallet) => (await readWatch(deps.store, wallet, first)) !== null) : null;
      const watch = owner ? await readWatch(deps.store, owner.wallet, first).catch(() => null) : null;
      if (!owner || !watch) {
        await deps.tg.send(chatId, escapeHtml(words.watchGone));
        return true;
      }
      const agent = await deps.agentFor(owner.wallet, link.chat.telegramId);
      const price = agent.credits ? priceOf(agent.credits.config, "question") : 0;
      const view = watchView(watch, null, deps.now(), locale, price);
      if (!view.explain) {
        await deps.tg.send(chatId, escapeHtml(words.noteGone));
        return true;
      }
      await askQuestion(deps, chatId, owner, view.explain.question, Number(second) === price ? price : null);
      return true;
    }
    case "ny": {
      /* «Чому?» on a plan's note: «why did I get this?» in the note's own context, for the note's own wallet, as on the web. */
      await deps.tg.answer(cb.id);
      /* The note read the agent's own way (the wallet's inbox, or the stand's fixture): a note of no wallet of this account, or gone, is no question. */
      const owner = INBOX_ID.test(first) ? await walletFor(deps, link, async (wallet) => (await (await deps.agentFor(wallet, link.chat.telegramId)).readers.inboxNote(wallet, first)) !== null) : null;
      if (!owner) {
        await deps.tg.send(chatId, escapeHtml(words.noteGone));
        return true;
      }
      const agent = await deps.agentFor(owner.wallet, link.chat.telegramId);
      const price = agent.credits ? priceOf(agent.credits.config, "question") : 0;
      const question = locale === "uk" ? "Чому мені прийшло це сповіщення?" : "Why did I get this alert?";
      await askQuestion(deps, chatId, owner, question, Number(second) === price ? price : null, { kind: "note", inboxId: first });
      return true;
    }
    case "pl": {
      /* «Мій план» on a watch's note: the plans on that token, of the wallet that holds the watch. */
      await deps.tg.answer(cb.id);
      const owner = WATCH_ID.test(first) ? await walletFor(deps, link, async (wallet) => (await readWatch(deps.store, wallet, first)) !== null) : null;
      const watch = owner ? await readWatch(deps.store, owner.wallet, first).catch(() => null) : null;
      await showPlans(deps, chatId, owner ?? link, watch?.mint ?? null);
      return true;
    }
    case "wt": {
      await deps.tg.answer(cb.id);
      if (MINT.test(first)) await offerPresets(deps, chatId, link, first);
      return true;
    }
    case "wn": {
      await deps.tg.answer(cb.id);
      await createFromPreset(deps, chatId, link, Number(first), second);
      return true;
    }
    case "b0":
    case "b1": {
      /* Under a brief's note the button names its wallet by the address's first characters; from /brief and /settings — the chat's own. */
      const owner = first ? await walletFor(deps, link, async (wallet) => wallet.startsWith(first)) : link;
      if (!owner) {
        await deps.tg.answer(cb.id);
        await deps.tg.send(chatId, escapeHtml(words.unavailable));
        return true;
      }
      const said = await setBrief(deps, owner, verb === "b1");
      await deps.tg.answer(cb.id, said);
      await deps.tg.send(chatId, escapeHtml(said));
      return true;
    }
    case "lang": {
      const next: TgLocale = locale === "uk" ? "en" : "uk";
      const at = new Date(deps.now()).toISOString();
      const written = await updateChat(deps.store, link.chat.telegramId, (current) => ({ ...current, locale: next, updatedAt: at }));
      await deps.tg.answer(cb.id);
      if (written) await showSettings(deps, chatId, { ...link, chat: written }, messageId);
      return true;
    }
    case "wl": {
      await deps.tg.answer(cb.id);
      const wallets = (await deps.walletsOf(link.accountId).catch(() => undefined)) ?? [];
      await deps.tg.send(chatId, escapeHtml(words.pickWallet), wallets.slice(-6).map((wallet) => [{ text: `${shortWallet(wallet)}${wallet === link.wallet ? " ✓" : ""}`, callback_data: `a:ws:${wallet}` }]));
      return true;
    }
    case "ws": {
      const chosen = MINT.test(first) ? await chooseWallet(deps.store, link.chat.telegramId, first, { walletsOf: deps.walletsOf, nowMs: deps.now() }) : "not-proven";
      await deps.tg.answer(cb.id);
      await deps.tg.send(chatId, escapeHtml(chosen === "chosen" ? words.walletChosen(shortWallet(first)) : words.unavailable));
      return true;
    }
    case "dc": {
      await deps.tg.answer(cb.id);
      await deps.tg.send(chatId, escapeHtml(words.disconnectSure), [[{ text: words.disconnectYes, callback_data: "a:dc1" }, { text: words.cancel, callback_data: "a:x:none" }]]);
      return true;
    }
    case "dc1": {
      /* The person's own binding, removed at their press: the channel, then the chat's memory. */
      const removed = await disconnectTelegramChannel(deps.store, link.accountId);
      if (removed) await deps.store.collection(TELEGRAM_COLLECTION).delete(chatKey(link.chat.telegramId)).catch(() => undefined);
      await deps.tg.answer(cb.id);
      await deps.tg.send(chatId, escapeHtml(removed ? words.disconnected : words.unavailable));
      return true;
    }
    default:
      await deps.tg.answer(cb.id);
      return true;
  }
}
