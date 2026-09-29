/**
 * The published privacy policy's section on the Ryntra app for Android, in
 * English and Ukrainian — the one part of `/legal/privacy` written in both
 * languages, on the Owner's word of 2026-09-28 (the mobile line's request 27:
 * every store portal asks for a privacy address that says what the app keeps
 * and collects). The rest of the policy stays English until a lawyer gives it
 * Ukrainian; the review candidate in `lib/legal/candidate.ts` carries the same
 * facts and moves only through its own signed release.
 *
 * Every sentence was checked against the phone's code on 2026-09-29: the
 * session in the phone's secure storage; the push token read on the phone and
 * sent to Ryntra only when the person turns phone notifications on and allows
 * them, registered with the app's version, language, quiet hours and the one
 * kind of note the phone takes (a plan's change); the registration removed on
 * the server when notifications are turned off or the person signs out; no
 * analytics or advertising dependency; asset logos loaded from their published
 * addresses.
 */

export type AndroidPrivacyLocale = "en" | "uk";

export type AndroidPrivacyItem = Readonly<{ lead: string; body: string }>;

export type AndroidPrivacy = Readonly<{
  heading: string;
  intro: string;
  items: readonly AndroidPrivacyItem[];
  /** For a reader of Ukrainian, over an English policy: where this section is. */
  pointer: Readonly<{ text: string; link: string }> | null;
}>;

/** The section's anchor — the store listing and `/support` link to it. */
export const ANDROID_SECTION_ID = "android";

export const ANDROID_PRIVACY: Readonly<Record<AndroidPrivacyLocale, AndroidPrivacy>> = {
  en: {
    heading: "2. The Ryntra app for Android",
    intro: "The Ryntra app for Android works with the same account as the website, and section 1 applies to your account in the app too. What is different on the phone:",
    items: [
      {
        lead: "What reaches Ryntra",
        body: "the public address of the wallet you connect — to show what it holds and, once you sign in with it, your own plans, rules and notes. The app gets its data from ryntra.io; asset logos load from the public addresses where they are published, and those servers see your phone's IP address.",
      },
      {
        lead: "What stays on your phone",
        body: "your session, in the phone's secure storage; your watchlist; the last Home screen you saw (public prices and the time); a short record of the steps you took in the app, with nothing that identifies you; your preferences — language, theme, hidden amounts. Signing out deletes your session and the private data kept on the phone; removing the app deletes everything.",
      },
      {
        lead: "Your keys",
        body: "every signature happens in the wallet app on your phone, through Mobile Wallet Adapter; your seed phrase and private keys never reach the Ryntra app.",
      },
      {
        lead: "The push token, only when you turn phone notifications on",
        body: "then the phone's push token, the app's version, your language, your quiet hours and the kind of notes the phone takes (changes to your plans) are stored with your account, and the notes are delivered through Google Firebase Cloud Messaging. Turning phone notifications off or signing out removes this phone's registration from your account. While they are off, no push token is sent to Ryntra.",
      },
      {
        lead: "Permissions",
        body: "the app asks for one permission (to show notifications), and only when you turn them on. It does not use your location, camera, contacts, photos or advertising identifier, and it carries no third-party analytics or advertising library.",
      },
    ],
    pointer: null,
  },
  uk: {
    heading: "2. Застосунок Ryntra для Android",
    intro: "Застосунок Ryntra для Android працює з тим самим акаунтом, що й сайт, і розділ 1 стосується твого акаунта і в застосунку. Що інакше на телефоні:",
    items: [
      {
        lead: "Що отримує Ryntra",
        body: "публічну адресу гаманця, який ти під'єднуєш, — щоб показати, що на ньому є, а коли ти ввійдеш через нього, — твої плани, правила й нотатки. Дані застосунок отримує з ryntra.io; логотипи активів завантажуються з публічних адрес, де їх опубліковано, і ці сервери бачать IP-адресу твого телефона.",
      },
      {
        lead: "Що лишається на телефоні",
        body: "твоя сесія — у захищеному сховищі телефона; твоє обране; останній показаний тобі екран Головної (публічні ціни й час); знеособлений короткий запис твоїх кроків у застосунку; твої уподобання — мова, тема, приховані суми. Вихід видаляє з телефона сесію й приватні дані, що на ньому зберігалися; після видалення застосунку не лишається нічого.",
      },
      {
        lead: "Твої ключі",
        body: "підписуєш ти — у застосунку гаманця на телефоні, через Mobile Wallet Adapter; сід-фраза й приватні ключі ніколи не потрапляють у застосунок Ryntra.",
      },
      {
        lead: "Push-токен — лише коли ти вмикаєш сповіщення на телефоні",
        body: "тоді push-токен телефона, версія застосунку, твоя мова, тихі години й вид нотаток, які отримує телефон (зміни твоїх планів), зберігаються з твоїм акаунтом, а нотатки доставляє Google Firebase Cloud Messaging. Вимкнення сповіщень на телефоні чи вихід видаляє реєстрацію цього телефона з твого акаунта. Поки сповіщення вимкнені, push-токен у Ryntra не надсилається.",
      },
      {
        lead: "Дозволи",
        body: "застосунок просить один дозвіл (показувати сповіщення) і лише тоді, коли ти їх вмикаєш. Він не використовує геолокації, камери, контактів, фото чи рекламного ідентифікатора й не містить сторонніх бібліотек аналітики чи реклами.",
      },
    ],
    pointer: { text: "Політика чинна англійською.", link: "Розділ про застосунок Ryntra для Android — українською" },
  },
};

export function androidPrivacy(locale: AndroidPrivacyLocale): AndroidPrivacy {
  return ANDROID_PRIVACY[locale];
}
