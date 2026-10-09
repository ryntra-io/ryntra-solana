import type { IntentKind } from "@/lib/account/intent.client";

/**
 * The account surfaces' copy, English and Ukrainian, complete on both sides.
 * No provider name is translated; no address, code or secret passes through.
 */
export type AccountCopy = Readonly<{
  signIn: string;
  account: string;
  sheetTitle: string;
  sheetLead: string;
  attachLead: string;
  reasons: Readonly<Record<IntentKind, string>>;
  close: string;
  google: string;
  telegram: string;
  telegramBot: string;
  telegramBotHint: string;
  emailTab: string;
  createTab: string;
  forgotTab: string;
  email: string;
  password: string;
  newPassword: string;
  passwordHint: string;
  submitSignIn: string;
  submitCreate: string;
  submitForgot: string;
  submitReset: string;
  working: string;
  confirmEmail: string;
  resend: string;
  resent: string;
  recoverySent: string;
  invalid: string;
  weakPassword: string;
  samePassword: string;
  rateLimited: string;
  unavailable: string;
  methodsPreparing: string;
  returned: Readonly<{ ok: string; okNew: string; linked: string; cancel: string; error: string; telegramClaimed: string; telegramIdentity: string; link: string; state: string }>;
  menu: Readonly<{ method: string; settings: string; logout: string; logoutAll: string; logoutFailed: string; logoutAllFailed: string; walletNote: string }>;
  /** The account inside the wallet panel: the wallet is the account. */
  identity: Readonly<{ lead: string; signIn: string; signing: string; checking: string; checkingHint: string; paused: string; signedIn: string; signedInOther: string; refused: string; failed: string; unsupported: string; taken: string }>;
  methods: Readonly<Record<"email_password" | "email_recovery" | "google_oidc" | "telegram_oidc" | "telegram_link" | "wallet_siwe" | "solana_siws", string>>;
  checkingPage: Readonly<{ title: string; lead: string; still: string; again: string; asking: string }>;
  privateGate: Readonly<{ lead: string; action: string }>;
  reset: Readonly<{ title: string; lead: string; done: string; signedOut: string; sessionsOpen: string; signOutAll: string }>;
}>;

const EN: AccountCopy = {
  signIn: "Sign in",
  account: "Account",
  sheetTitle: "Sign in to Ryntra",
  sheetLead: "An account keeps your plans, journal and alerts across devices. Swaps, sends and bridges need only your wallet.",
  attachLead: "This method will be added to the account you are signed in with now. Your plans, journal and alerts stay where they are.",
  reasons: {
    save_plan: "Sign in to save this plan.",
    journal: "Sign in to keep your journal.",
    alerts: "Sign in to receive alerts.",
    settings: "Sign in to sync your settings.",
    link_wallet: "Sign in to link this wallet to your account.",
    generic: "",
  },
  close: "Close",
  google: "Continue with Google",
  telegram: "Continue with Telegram",
  telegramBot: "Open the Telegram bot",
  telegramBotHint: "One confirmation in the bot signs you in. It stays available while the new doors are being verified.",
  emailTab: "Sign in",
  createTab: "Create account",
  forgotTab: "Forgot password",
  email: "Email",
  password: "Password",
  newPassword: "New password",
  passwordHint: "At least 8 characters. Your password manager can fill this.",
  submitSignIn: "Sign in",
  submitCreate: "Create account",
  submitForgot: "Send reset link",
  submitReset: "Set new password",
  working: "One moment…",
  confirmEmail: "Check your mail and open the confirmation link. It expires; you can ask for a fresh one.",
  resend: "Send the link again",
  resent: "Sent.",
  recoverySent: "If that address has an account, a reset link is on its way.",
  invalid: "That email and password did not match.",
  weakPassword: "That password is too short or too common.",
  samePassword: "Choose a password you have not used here before.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  unavailable: "Sign-in is not available right now.",
  methodsPreparing: "Email, Google and Telegram sign-in are being verified. Until then the Telegram bot signs you in.",
  returned: {
    ok: "You are signed in.",
    okNew: "Your account is ready.",
    linked: "Sign-in method added.",
    cancel: "Sign-in cancelled. Nothing changed.",
    error: "Sign-in did not complete. Try again.",
    telegramClaimed: "This Telegram identity already belongs to another account.",
    telegramIdentity: "Telegram did not share the details needed to find your account. Nothing was created. Sign in with email, or open Ryntra from the Telegram bot and add Telegram there.",
    link: "That link is no longer valid. Ask for a fresh one.",
    state: "That sign-in started somewhere else. Start again from here.",
  },
  menu: {
    method: "Signed in with",
    settings: "Account settings",
    logout: "Sign out",
    logoutAll: "Sign out everywhere",
    logoutFailed: "Sign-out could not be confirmed. Please sign in again and retry.",
    logoutAllFailed: "Sign-out everywhere could not be confirmed. Other sessions may still be active. Sign in again and retry.",
    walletNote: "Your wallet stays connected until you disconnect it.",
  },
  identity: {
    lead: "Sign in to keep your settings, alerts and plans. One signature — no funds move.",
    signIn: "Sign in with wallet",
    checking: "Checking your sign-in…",
    checkingHint: "Nothing to sign — the answer comes by itself in a moment.",
    paused: "You're still signed in. Your wallet isn't available right now — unlock it when you need to sign.",
    signing: "Confirm the message in your wallet…",
    signedIn: "Signed in with this wallet",
    signedInOther: "Signed in with",
    refused: "Sign-in was cancelled.",
    failed: "Sign-in could not be completed. Try again.",
    unsupported: "This wallet cannot sign a sign-in message.",
    taken: "This wallet belongs to another account.",
  },
  methods: {
    email_password: "email",
    email_recovery: "email (reset)",
    google_oidc: "Google",
    telegram_oidc: "Telegram",
    telegram_link: "Telegram bot",
    wallet_siwe: "wallet signature",
    solana_siws: "Solana signature",
  },
  checkingPage: {
    title: "Checking your sign-in…",
    lead: "Nothing to sign — this page opens by itself.",
    still: "Still checking — your sign-in is still there and there is nothing to sign.",
    again: "Check again",
    asking: "Checking…",
  },
  privateGate: {
    lead: "Confirm sign-in to open this wallet’s private account.",
    action: "Sign in with wallet",
  },
  reset: {
    title: "Set a new password",
    lead: "This link was sent to your address. Other sessions of this account will be signed out.",
    done: "Password updated. You are signed in.",
    signedOut: "This reset link has expired. Ask for a fresh one.",
    sessionsOpen: "Password updated, but the other sessions could not all be ended. Sign out everywhere to finish.",
    signOutAll: "Sign out everywhere",
  },
};

const UK: AccountCopy = {
  signIn: "Увійти",
  account: "Акаунт",
  sheetTitle: "Увійти в Ryntra",
  sheetLead: "Обліковий запис зберігає плани, журнал і сповіщення між пристроями. Для свопів, переказів і мостів потрібен лише гаманець.",
  attachLead: "Цей спосіб буде додано до облікового запису, з яким ви зараз увійшли. Плани, журнал і сповіщення лишаються на місці.",
  reasons: {
    save_plan: "Увійдіть, щоб зберегти план.",
    journal: "Увійдіть, щоб вести журнал.",
    alerts: "Увійдіть, щоб отримувати сповіщення.",
    settings: "Увійдіть, щоб синхронізувати налаштування.",
    link_wallet: "Увійдіть, щоб привʼязати гаманець до облікового запису.",
    generic: "",
  },
  close: "Закрити",
  google: "Продовжити з Google",
  telegram: "Продовжити з Telegram",
  telegramBot: "Відкрити Telegram-бота",
  telegramBotHint: "Одне підтвердження в боті виконує вхід. Цей шлях лишається, поки нові способи перевіряються.",
  emailTab: "Увійти",
  createTab: "Створити акаунт",
  forgotTab: "Забули пароль",
  email: "Email",
  password: "Пароль",
  newPassword: "Новий пароль",
  passwordHint: "Щонайменше 8 символів. Менеджер паролів може заповнити це поле.",
  submitSignIn: "Увійти",
  submitCreate: "Створити акаунт",
  submitForgot: "Надіслати посилання",
  submitReset: "Встановити пароль",
  working: "Хвилинку…",
  confirmEmail: "Перевірте пошту й відкрийте посилання підтвердження. Воно тимчасове; можна запросити нове.",
  resend: "Надіслати ще раз",
  resent: "Надіслано.",
  recoverySent: "Якщо на цю адресу є обліковий запис, посилання для скидання вже в дорозі.",
  invalid: "Email і пароль не збігаються.",
  weakPassword: "Пароль надто короткий або надто поширений.",
  samePassword: "Оберіть пароль, якого тут ще не було.",
  rateLimited: "Забагато спроб. Зачекайте хвилину і спробуйте знову.",
  unavailable: "Вхід зараз недоступний.",
  methodsPreparing: "Вхід через email, Google і Telegram перевіряється. Поки що вхід виконує Telegram-бот.",
  returned: {
    ok: "Вхід виконано.",
    okNew: "Обліковий запис готовий.",
    linked: "Спосіб входу додано.",
    cancel: "Вхід скасовано. Нічого не змінилося.",
    error: "Вхід не завершився. Спробуйте ще раз.",
    telegramClaimed: "Цей Telegram уже належить іншому обліковому запису.",
    telegramIdentity: "Telegram не передав дані, потрібні, щоб знайти ваш обліковий запис. Нічого не створено. Увійдіть через email або відкрийте Ryntra з Telegram-бота й додайте Telegram там.",
    link: "Це посилання вже недійсне. Запросіть нове.",
    state: "Цей вхід починався в іншому місці. Почніть знову звідси.",
  },
  menu: {
    method: "Вхід через",
    settings: "Налаштування акаунта",
    logout: "Вийти",
    logoutAll: "Вийти всюди",
    logoutFailed: "Не вдалося підтвердити вихід. Увійдіть ще раз і повторіть спробу.",
    logoutAllFailed: "Не вдалося підтвердити вихід усюди. Інші сесії можуть бути активними. Увійдіть ще раз і повторіть спробу.",
    walletNote: "Гаманець лишається підключеним, доки ви його не відключите.",
  },
  identity: {
    lead: "Увійди, щоб зберегти налаштування, сповіщення й плани. Один підпис — кошти не рухаються.",
    signIn: "Увійти гаманцем",
    checking: "Перевіряємо вхід…",
    checkingHint: "Підписувати нічого не треба — відповідь прийде сама за мить.",
    paused: "Ти й далі в акаунті. Гаманець зараз недоступний — розблокуй його, коли треба буде підписати.",
    signing: "Підтвердь повідомлення в гаманці…",
    signedIn: "Вхід виконано цим гаманцем",
    signedInOther: "Вхід виконано гаманцем",
    refused: "Вхід скасовано.",
    failed: "Не вдалося виконати вхід. Спробуй ще раз.",
    unsupported: "Цей гаманець не підтримує підпис для входу.",
    taken: "Цей гаманець належить іншому акаунту.",
  },
  methods: {
    email_password: "email",
    email_recovery: "email (скидання)",
    google_oidc: "Google",
    telegram_oidc: "Telegram",
    telegram_link: "Telegram-бот",
    wallet_siwe: "підпис гаманця",
    solana_siws: "підпис Solana",
  },
  checkingPage: {
    title: "Перевіряємо вхід…",
    lead: "Підписувати нічого не треба — сторінка відкриється сама.",
    still: "Ще перевіряємо — твій вхід нікуди не дівся, підписувати нічого не треба.",
    again: "Перевірити ще раз",
    asking: "Перевіряємо…",
  },
  privateGate: {
    lead: "Підтвердь вхід, щоб відкрити приватний акаунт цього гаманця.",
    action: "Увійти гаманцем",
  },
  reset: {
    title: "Новий пароль",
    lead: "Це посилання надіслано на вашу адресу. Інші сесії цього облікового запису буде завершено.",
    done: "Пароль оновлено. Вхід виконано.",
    signedOut: "Посилання для скидання вже недійсне. Запросіть нове.",
    sessionsOpen: "Пароль оновлено, але завершити всі інші сесії не вдалося. Натисніть «Вийти всюди», щоб довести до кінця.",
    signOutAll: "Вийти всюди",
  },
};

export function accountCopyFor(locale: string): AccountCopy {
  return locale === "uk" ? UK : EN;
}
