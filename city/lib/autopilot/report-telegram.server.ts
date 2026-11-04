import 'server-only';

import { accountByWallet } from '@/lib/account/rpc';
import { resolveChat } from '@/lib/assistant/telegram/link';
import { assistantBotDeps } from '@/lib/assistant/telegram/runtime.server';
import { APP } from '@/lib/monitoring/deliver';
import { answerCallback, editReplyMarkup, type InlineKeyboard } from '@/lib/telegram/api';
import { AGENT_REPORT, AGENT_REPORT_HREF, REPORT_CALLBACK } from './report';
import { pressReport, type ReportPress } from './report-telegram';

/** The bot's side of the report's button (CITY-194): `lib/telegram/handlers.ts` hands it every `agr:` press. */
export async function handleReportPress(press: ReportPress): Promise<boolean> {
  if (!press.data?.startsWith(REPORT_CALLBACK)) return false;
  const bot = assistantBotDeps();
  return pressReport(press, {
    store: bot.store,
    accountOfChat: async (telegramId) => {
      const link = await resolveChat(bot.store, telegramId, { walletsOf: bot.walletsOf, locale: 'en', nowMs: bot.now() });
      if (link.state === 'linked' || link.state === 'no-wallet') return link.accountId;
      return link.state === 'unlinked' ? null : undefined;
    },
    accountOfWallet: (owner) => accountByWallet('solana', owner),
    answer: (id, text) => answerCallback(id, text),
    editKeyboard: (chatId, messageId, keyboard) => editReplyMarkup(chatId, messageId, keyboard as InlineKeyboard),
    link: (lang) => ({ text: AGENT_REPORT[lang].noteCta, url: `${APP}${AGENT_REPORT_HREF}` }),
    now: Date.now,
  });
}
