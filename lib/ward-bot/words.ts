/**
 * The bot's words (CITY-166), in English and Ukrainian: the verdict in one word, one short line per reason the engine
 * gives, and the few sentences the bot ever says besides a verdict. The best verdict is «No known blockers» — no word
 * here says «safe», promises protection or scores anything. Every line names what was found, not how it was read.
 */

import type { WardReasonCode } from "../ward/codes.ts";

export type WardBotLang = "en" | "uk";

/** Ukrainian for a Ukrainian Telegram, English for everyone else. */
export function langOf(code: unknown): WardBotLang {
  return typeof code === "string" && /^uk\b/i.test(code) ? "uk" : "en";
}

type Words = Readonly<{
  allow: string;
  warn: string;
  block: string;
  notRead: (n: number) => string;
  token: (name: string) => string;
  transaction: string;
  link: string;
  intro: string;
  hint: string;
  signature: string;
  notCheckable: string;
  unread: string;
  failed: string;
  busyChat: (minutes: number) => string;
  busyUser: (minutes: number) => string;
  commands: Readonly<{ check: string; help: string }>;
  shortDescription: string;
  fee: (percent: string | null) => string;
  links: Readonly<Record<string, string>>;
  reasons: Readonly<Record<WardReasonCode, string>>;
}>;

const minutes = (n: number) => Math.max(1, Math.ceil(n));

/* «1 перевірку», «2 перевірки», «5 перевірок». */
const ukChecks = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "перевірку" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "перевірки" : "перевірок");

export const WARD_BOT_WORDS: Readonly<Record<WardBotLang, Words>> = {
  en: {
    allow: "No known blockers",
    warn: "Look first",
    block: "Stop",
    notRead: (n) => (n === 1 ? "1 check not read" : `${n} checks not read`),
    token: (name) => `token ${name}`,
    transaction: "transaction",
    link: "link",
    intro: "Paste an address, a CA, a link or a transaction — I answer in one line. I only read: I never sign, never move funds and never ask for keys or a seed phrase.",
    hint: "Paste an address, a CA, a solana: link or a transaction.",
    signature: "That is a sent transaction’s signature. Paste the transaction before signing, an address or a CA.",
    notCheckable: "This cannot be checked. Paste an address, a CA, a solana: link or a transaction.",
    unread: "Could not read the chain right now. Try again in a minute.",
    failed: "The check did not answer. Try again in a minute.",
    busyChat: (n) => `Too many checks here. Back in ${minutes(n)} min.`,
    busyUser: (n) => `Too many checks. Try again in ${minutes(n)} min.`,
    commands: { check: "Check an address, CA, link or transaction", help: "What I do" },
    shortDescription: "Paste an address, CA, link or transaction — a one-line check. Reads only.",
    fee: (percent) => (percent ? `Takes ${percent}% of every transfer` : "Every transfer takes a fee"),
    links: {
      LINK_PAID: "This payment link is already paid",
      LINK_EXPIRED: "This payment link has expired",
      LINK_UNCONFIRMED: "Whether this link is paid could not be read",
      LINK_NOT_FOUND: "No Ryntra payment link at this address",
      LINK_MISMATCH: "Does not match the payment link it claims to be",
    },
    reasons: {
      LINK_NOT_READ: "Builds its transaction on a server — check that transaction",
      TX_SIGNER_ABSENT: "This wallet does not sign it",
      SIMULATION_FAILED: "Fails as it stands",
      SIMULATION_UNAVAILABLE: "Could not be simulated",
      LOOKUPS_UNREAD: "Part of it could not be read",
      SWEEPS_ASSETS: "Empties several balances at once",
      OWNER_CHANGED: "Hands the wallet to a program — for good",
      TOKEN_OWNER_CHANGED: "Gives away a token account",
      CLOSE_AUTHORITY_CHANGED: "Lets someone close a token account",
      CLOSE_TO_OTHER: "Closes a token account into someone else’s wallet",
      DELEGATE_UNLIMITED: "Lets someone take all of a token, any time",
      DELEGATE_SET: "Lets someone move tokens without asking",
      STAKE_AUTHORITY_CHANGED: "Gives away the stake",
      UPGRADE_AUTHORITY_CHANGED: "Gives away the right to change a program",
      MINT_AUTHORITY_CHANGED: "Hands over a power over a token",
      NONCE_AUTHORITY_CHANGED: "Hands over a nonce account",
      DURABLE_NONCE: "The signature never expires",
      RECIPIENT_KNOWN_THREAT: "Known wallet drainer",
      RECIPIENT_SANCTIONED: "On a sanctions list",
      RECIPIENT_LOOKALIKE: "Looks like another address — compare every character",
      RECIPIENT_REFUSED: "Not a wallet — anything sent here is lost",
      RECIPIENT_FLAGGED: "Flagged by the security source",
      RECIPIENT_NEW: "Brand-new address — no history",
      RECIPIENT_LINK: "This payment link cannot be paid now",
      RECIPIENT_UNREAD: "Recipient not fully read",
      RECIPIENT_PROGRAM: "Pays into a pool or a vault",
      TOKEN_NON_TRANSFERABLE: "Can never be moved once held",
      TOKEN_FROZEN_ON_ARRIVAL: "Arrives frozen — cannot be sold",
      TOKEN_PAUSED: "Paused — nobody can move it",
      TOKEN_PERMANENT_DELEGATE: "Issuer can take it back from any holder",
      TOKEN_TRANSFER_HOOK: "Every transfer runs a program that can stop it",
      TOKEN_FREEZE_AUTHORITY: "Issuer can freeze holders",
      TOKEN_MINT_AUTHORITY: "Supply can still grow",
      TOKEN_PAUSABLE: "Issuer can pause it",
      TOKEN_TRANSFER_FEE: "Every transfer takes a fee",
      TOKEN_CONCENTRATED: "Held by a few — they can move the price alone",
      TOKEN_UNREAD: "Token could not be read",
      TOKEN_FACTS_UNREAD: "Holders not read",
      INTENT_AMOUNT_OVER: "Sends more than the agent said",
      INTENT_RECIPIENT: "Pays someone the agent did not name",
      INTENT_ASSET: "Takes something the agent never mentioned",
      INTENT_AMOUNT_UNDER: "Sends less than the agent said",
      INTENT_NOT_RECEIVED: "You do not get what the agent said",
      INTENT_UNREADABLE: "The agent’s words were not read",
      INTENT_UNCHECKED: "The agent’s words were not checked",
      INTENT_MATCH: "Does what the agent said",
      PROGRAMS_UNKNOWN: "Calls programs Ryntra does not name",
    },
  },
  uk: {
    allow: "Відомих перешкод немає",
    warn: "Подивіться уважно",
    block: "Стоп",
    notRead: (n) => `${n} ${ukChecks(n)} не прочитано`,
    token: (name) => `токен ${name}`,
    transaction: "транзакція",
    link: "посилання",
    intro: "Вставте адресу, CA, посилання чи транзакцію — відповім одним рядком. Я лише читаю: не підписую, не рухаю кошти й ніколи не прошу ключів чи сід-фрази.",
    hint: "Вставте адресу, CA, посилання solana: чи транзакцію.",
    signature: "Це підпис уже надісланої транзакції. Вставте транзакцію до підпису, адресу чи CA.",
    notCheckable: "Це не перевірити. Вставте адресу, CA, посилання solana: чи транзакцію.",
    unread: "Зараз не вдалося прочитати мережу. Спробуйте за хвилину.",
    failed: "Перевірка не відповіла. Спробуйте за хвилину.",
    busyChat: (n) => `Забагато перевірок тут. Повернуся за ${minutes(n)} хв.`,
    busyUser: (n) => `Забагато перевірок. Спробуйте за ${minutes(n)} хв.`,
    commands: { check: "Перевірити адресу, CA, посилання чи транзакцію", help: "Що я роблю" },
    shortDescription: "Вставте адресу, CA, посилання чи транзакцію — перевірка одним рядком. Лише читає.",
    fee: (percent) => (percent ? `Бере ${percent}% з кожного переказу` : "Кожен переказ бере комісію"),
    links: {
      LINK_PAID: "Це посилання вже оплачено",
      LINK_EXPIRED: "Строк посилання минув",
      LINK_UNCONFIRMED: "Не вдалося прочитати, чи посилання оплачено",
      LINK_NOT_FOUND: "За цією адресою немає посилання Ryntra",
      LINK_MISMATCH: "Не збігається з посиланням, за яке себе видає",
    },
    reasons: {
      LINK_NOT_READ: "Збирає транзакцію на сервері — перевірте саму транзакцію",
      TX_SIGNER_ABSENT: "Цей гаманець її не підписує",
      SIMULATION_FAILED: "Не пройде як є",
      SIMULATION_UNAVAILABLE: "Не вдалося симулювати",
      LOOKUPS_UNREAD: "Частину не прочитано",
      SWEEPS_ASSETS: "Спустошує кілька балансів одразу",
      OWNER_CHANGED: "Віддає гаманець програмі — назавжди",
      TOKEN_OWNER_CHANGED: "Віддає токен-акаунт",
      CLOSE_AUTHORITY_CHANGED: "Дозволяє комусь закрити токен-акаунт",
      CLOSE_TO_OTHER: "Закриває токен-акаунт на чужий гаманець",
      DELEGATE_UNLIMITED: "Дозволяє забрати весь токен будь-коли",
      DELEGATE_SET: "Дозволяє рухати токени без дозволу",
      STAKE_AUTHORITY_CHANGED: "Віддає стейк",
      UPGRADE_AUTHORITY_CHANGED: "Віддає право змінювати програму",
      MINT_AUTHORITY_CHANGED: "Передає владу над токеном",
      NONCE_AUTHORITY_CHANGED: "Передає nonce-акаунт",
      DURABLE_NONCE: "Підпис не має строку",
      RECIPIENT_KNOWN_THREAT: "Відомий дрейнер гаманців",
      RECIPIENT_SANCTIONED: "Адреса під санкціями",
      RECIPIENT_LOOKALIKE: "Схожа на іншу адресу — звірте кожен символ",
      RECIPIENT_REFUSED: "Не гаманець — надіслане сюди пропаде",
      RECIPIENT_FLAGGED: "Позначена джерелом безпеки",
      RECIPIENT_NEW: "Нова адреса — без історії",
      RECIPIENT_LINK: "Це посилання зараз не оплатити",
      RECIPIENT_UNREAD: "Отримувача не дочитано",
      RECIPIENT_PROGRAM: "Платить у пул чи сховище",
      TOKEN_NON_TRANSFERABLE: "Його не можна рухати",
      TOKEN_FROZEN_ON_ARRIVAL: "Приходить замороженим — не продати",
      TOKEN_PAUSED: "На паузі — ніхто не може рухати",
      TOKEN_PERMANENT_DELEGATE: "Емітент може забрати його в будь-кого",
      TOKEN_TRANSFER_HOOK: "Кожен переказ запускає програму, що може його зупинити",
      TOKEN_FREEZE_AUTHORITY: "Емітент може заморозити власників",
      TOKEN_MINT_AUTHORITY: "Емісія ще може зрости",
      TOKEN_PAUSABLE: "Емітент може поставити на паузу",
      TOKEN_TRANSFER_FEE: "Кожен переказ бере комісію",
      TOKEN_CONCENTRATED: "У руках кількох — вони самі рухають ціну",
      TOKEN_UNREAD: "Токен не прочитано",
      TOKEN_FACTS_UNREAD: "Власників не прочитано",
      INTENT_AMOUNT_OVER: "Надсилає більше, ніж сказав агент",
      INTENT_RECIPIENT: "Платить не тому, кого назвав агент",
      INTENT_ASSET: "Забирає те, про що агент мовчав",
      INTENT_AMOUNT_UNDER: "Надсилає менше, ніж сказав агент",
      INTENT_NOT_RECEIVED: "Ви не отримаєте обіцяного",
      INTENT_UNREADABLE: "Слова агента не прочитано",
      INTENT_UNCHECKED: "Слова агента не перевірено",
      INTENT_MATCH: "Робить те, що сказав агент",
      PROGRAMS_UNKNOWN: "Викликає програми, яких Ryntra не знає",
    },
  },
};
