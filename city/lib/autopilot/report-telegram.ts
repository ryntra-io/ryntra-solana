import type { GuardStore } from '../../../lib/guard/store.ts';
import { AGENT_REPORT, readReportCallback, reportCallback, type Lang } from './report.ts';
import { keepReport, readReport } from './report-watch.ts';

/**
 * The daily report's one button in Telegram (CITY-194): «Turn off daily report» — and, once off, «Turn it back on» in
 * its place. A press counts only from the chat the wallet's own account bound: the chat's account (the assistant's
 * binding, `lib/assistant/telegram/link.ts`) must be the account the report's wallet belongs to; any other chat
 * changes nothing. The only write is the report's one switch.
 */

export type ReportPress = Readonly<{ id: string; from: Readonly<{ id: number; language_code?: string }>; data?: string; message?: Readonly<{ message_id: number; chat: Readonly<{ id: number }> }> }>;

type Keyboard = readonly (readonly Readonly<{ text: string; url?: string; callback_data?: string }>[])[];

export type ReportPressDeps = Readonly<{
  store: GuardStore;
  /** The account the chat of this Telegram user is bound to; null — none; undefined — not read. */
  accountOfChat: (telegramId: number) => Promise<string | null | undefined>;
  /** The account a wallet belongs to; null — none; undefined — not read. */
  accountOfWallet: (owner: string) => Promise<string | null | undefined>;
  answer: (callbackId: string, text?: string) => Promise<unknown>;
  /** The message's buttons after the press: its link kept, the switch turned. */
  editKeyboard: (chatId: number, messageId: number, keyboard: Keyboard) => Promise<unknown>;
  /** The link the message carries, kept on its first row. */
  link: (lang: Lang) => Readonly<{ text: string; url: string }>;
  now: () => number;
}>;

/** True when the press was the report's: answered here, whatever came of it. */
export async function pressReport(press: ReportPress, deps: ReportPressDeps): Promise<boolean> {
  const asked = readReportCallback(press.data);
  if (!asked) return false;
  const [chatAccount, walletAccount] = await Promise.all([deps.accountOfChat(press.from.id).catch(() => undefined), deps.accountOfWallet(asked.owner).catch(() => undefined)]);
  const settings = await readReport(deps.store, asked.owner).catch(() => null);
  const lang: Lang = settings?.locale ?? (press.from.language_code?.startsWith('uk') ? 'uk' : 'en');
  const w = AGENT_REPORT[lang];
  if (!chatAccount || !walletAccount || chatAccount !== walletAccount) {
    await deps.answer(press.id, w.notYours);
    return true;
  }
  const on = asked.verb === 'on';
  await keepReport(deps.store, { owner: asked.owner, on }, deps.now());
  await deps.answer(press.id, on ? w.toldOn : w.toldOff);
  if (press.message) {
    const keyboard: Keyboard = [[deps.link(lang)], [{ text: on ? w.noteOff : w.noteOn, callback_data: reportCallback(on ? 'off' : 'on', asked.owner) }]];
    await deps.editKeyboard(press.message.chat.id, press.message.message_id, keyboard).catch(() => undefined);
  }
  return true;
}
