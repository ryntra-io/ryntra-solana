/**
 * The published privacy policy's section on the Ryntra app for Android, in
 * English and Ukrainian — the one part of `/legal/privacy` written in both
 * languages since 2026-09-28, because every store portal asks for a privacy
 * address that says what the app keeps and collects. The rest of the policy
 * stays English until a lawyer gives it Ukrainian; the review candidate in
 * `lib/legal/candidate.ts` carries the same facts and moves only through its
 * own signed release.
 *
 * Every sentence was checked against the phone's code on 2026-09-29: the
 * session in the phone's secure storage; the push token read on the phone and
 * sent to Ryntra only when the person turns phone notifications on and allows
 * them, registered with the app's version, language, quiet hours and the one
 * kind of note the phone takes (a plan's change); the registration removed on
 * the server when notifications are turned off or the person signs out; no
 * analytics or advertising dependency; asset logos loaded from their published
 * addresses. The permissions and a launch's picture were checked on 2026-10-07
 * against the lines the phone's 1.11.0 (versionCode 6) build reads back:
 * the camera, asked when the person scans or takes a launch's picture; the
 * notifications, asked only when phone notifications are turned on; a launch's
 * picture also from the system photo picker, with no storage permission.
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
        lead: "Camera (CAMERA)",
        body: "asked only when you choose to scan or to take a photo — to scan a wallet address or a payment QR code, and to take a picture for a token you launch. Nothing is recorded; a picture you take is sent to Ryntra only when you press to launch a token with it, and from then on it is at a public address even if you do not sign.",
      },
      {
        lead: "Notifications (POST_NOTIFICATIONS)",
        body: "declared for phone notifications — reminders and the state of your operations. The current version (1.11.0) has no phone notifications and does not ask for it; notes stay in the app's inbox. A version that brings phone notifications asks only when you turn them on.",
      },
      {
        lead: "What the app does not ask for",
        body: "access to your photos or files, your location, contacts, microphone, accounts or advertising identifier; it carries no third-party analytics or advertising library. You can refuse the camera or notifications, or take them back in the phone's settings, and the rest of the app keeps working.",
      },
      {
        lead: "A token you launch",
        body: "its picture can also be chosen in the phone's system photo picker, which hands the app only that one image, with no permission to your photos or files. The picture, name, ticker, description and links of a token you launch become public together with the token: anyone can see them on Ryntra's pages, in the app and at the public address the token names on the blockchain. Put nothing in them you do not want to be public. What a launched token may not carry is in the Terms of Use.",
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
        lead: "Камера (CAMERA)",
        body: "застосунок просить її лише тоді, коли ти обираєш сканувати чи зняти фото, — щоб сканувати адресу гаманця чи QR-код оплати й щоб зняти фото для токена, який ти запускаєш. Нічого не записується; зняте фото надсилається в Ryntra лише тоді, коли ти натискаєш запустити з ним токен, і відтоді лежить за публічною адресою, навіть якщо ти не підпишеш.",
      },
      {
        lead: "Сповіщення (POST_NOTIFICATIONS)",
        body: "оголошений для сповіщень на телефоні — нагадувань і стану твоїх операцій. Поточна версія (1.11.0) сповіщень на телефоні не має й цього дозволу не просить; нотатки лишаються у вхідних застосунку. Версія, що принесе сповіщення на телефоні, попросить його лише тоді, коли ти їх увімкнеш.",
      },
      {
        lead: "Чого застосунок не просить",
        body: "доступу до твоїх фото чи файлів, геолокації, контактів, мікрофона, облікових записів телефона чи рекламного ідентифікатора; сторонніх бібліотек аналітики чи реклами в ньому немає. Камеру чи сповіщення можна не дозволити або забрати в налаштуваннях телефона — решта застосунку працює далі.",
      },
      {
        lead: "Токен, який ти запускаєш",
        body: "його картинку можна також вибрати в системному вікні вибору фото, який передає застосунку лише це одне зображення, без дозволу на твої фото чи файли. Картинка, назва, тікер, опис і посилання токена, який ти запускаєш, стають публічними разом із токеном: їх бачить будь-хто на сторінках Ryntra, у застосунку й за публічною адресою, яку токен називає в блокчейні. Не вписуй туди нічого, що не має бути публічним. Чого не може містити запущений токен — в Умовах використання.",
      },
    ],
    pointer: { text: "Політика чинна англійською.", link: "Розділ про застосунок Ryntra для Android — українською" },
  },
};

export function androidPrivacy(locale: AndroidPrivacyLocale): AndroidPrivacy {
  return ANDROID_PRIVACY[locale];
}
