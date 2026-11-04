/**
 * The Terms of Use's section on the tokens a person launches, in English and
 * Ukrainian — written in both, like the privacy policy's section on the
 * Android app, because a launch's last step in either language says that
 * launching means agreeing to these Terms, and an app store that carries
 * what people create asks the user terms to name what that content may not
 * carry. The rest of the Terms stays English until a lawyer gives it
 * Ukrainian.
 *
 * Checked on 2026-10-07 against the launch: the server refuses a name or
 * ticker that borrows a brand or a person before anything is built
 * (`lib/launch/form.ts`); pictures, descriptions and links are not checked
 * in advance; a report reaches Ryntra by email until a route of its own.
 */

/** The two languages the section is written in. */
export type LaunchTermsLocale = "en" | "uk";

export type LaunchTerms = Readonly<{
  heading: string;
  intro: string;
  forbidden: readonly string[];
  after: readonly string[];
  /** How a report reaches Ryntra; the address itself is rendered from the contacts. */
  report: Readonly<{ before: string; after: string }>;
  /** For a reader of Ukrainian, over English Terms: where this section is. */
  pointer: Readonly<{ text: string; link: string }> | null;
}>;

/** The section's anchor. */
export const LAUNCH_SECTION_ID = "launch";

export const LAUNCH_TERMS: Readonly<Record<LaunchTermsLocale, LaunchTerms>> = {
  en: {
    heading: "10. Tokens you launch",
    intro: "When you launch a token through the Service, you choose its name, ticker, picture, description and links, and they become public together with the token. You are responsible for them. A token you launch may not carry:",
    forbidden: [
      "an impersonation — a name, ticker, picture or description that passes the token off as a brand, a company, a project or a person it does not belong to, or suggests that they endorse it;",
      "hateful content — content that attacks or demeans people for their race, ethnicity, nationality, religion, disability, sex, gender, sexual orientation or age, or calls for violence against them;",
      "sexual content, including nudity, or violent or graphic content;",
      "a scam — content that misleads people about what the token is, promises profits, airdrops or giveaways, poses as an official listing, or leads to phishing or malicious software;",
      "anything that breaks the law or infringes another person's trademark, copyright or other rights.",
    ],
    after: [
      "Before anything is built, the Service refuses a name or ticker that reads as a known brand or a known person, and a picture that Ryntra took down before. Other pictures, descriptions and links are not checked in advance.",
      "If a token breaks this section, Ryntra may hide its picture, description and links on Ryntra's pages and in the Ryntra apps, without notice. The token itself lives on the blockchain: Ryntra cannot change or remove it, and hiding its content does not change what anyone holds.",
    ],
    report: {
      before: "To report a token, write to",
      after: "with the token's address or the link to its page. The Ryntra team reads every report and acts on one that shows a breach without delay. On a token's page on ryntra.io, «Report this token» sends the report to the team with the token's page. In the Ryntra app for Android, the report button on a token's page opens that letter, and «Hide on this phone» hides the token's picture, description and links for you.",
    },
    pointer: null,
  },
  uk: {
    heading: "10. Токени, які ти запускаєш",
    intro: "Коли ти запускаєш токен через Сервіс, ти обираєш його назву, тікер, картинку, опис і посилання, і вони стають публічними разом із токеном. Відповідальність за них — на тобі. Токен, який ти запускаєш, не може містити:",
    forbidden: [
      "видавання за когось іншого — назву, тікер, картинку чи опис, що видають токен за бренд, компанію, проєкт чи людину, яким він не належить, або натякають, що вони його підтримують;",
      "мову ворожнечі — вміст, що атакує людей чи принижує їх за расу, етнічне походження, національність, релігію, інвалідність, стать, гендер, сексуальну орієнтацію чи вік або закликає до насильства проти них;",
      "сексуальний вміст, зокрема оголеність, чи насильницький або жорстокий вміст;",
      "шахрайство — вміст, що вводить людей в оману щодо того, чим є токен, обіцяє прибуток, ейрдропи чи роздачі, видає себе за офіційний лістинг або веде на фішинг чи шкідливе програмне забезпечення;",
      "будь-що, що порушує закон або чужі торговельні марки, авторські чи інші права.",
    ],
    after: [
      "Ще до того, як щось буде створено, Сервіс відмовляє назві чи тікеру, що читається як відомий бренд або відома людина, і картинці, яку Ryntra вже знімала. Інші картинки, описи й посилання наперед не перевіряються.",
      "Якщо токен порушує цей розділ, Ryntra може сховати його картинку, опис і посилання на своїх сторінках і в застосунках Ryntra без попередження. Сам токен живе в блокчейні: Ryntra не може його змінити чи видалити, а приховування його вмісту не змінює нічиїх активів.",
    ],
    report: {
      before: "Щоб поскаржитися на токен, напиши на",
      after: "з адресою токена чи посиланням на його сторінку. Команда Ryntra читає кожну скаргу й без зволікань діє за тією, що показує порушення. На сторінці токена на ryntra.io «Поскаржитися на токен» надсилає скаргу команді разом зі сторінкою токена. У застосунку Ryntra для Android кнопка скарги на сторінці токена відкриває цей лист, а «Сховати на цьому телефоні» ховає картинку, опис і посилання токена для тебе.",
    },
    pointer: { text: "Умови чинні англійською.", link: "Розділ про токени, які ти запускаєш, — українською" },
  },
};

export function launchTerms(locale: LaunchTermsLocale): LaunchTerms {
  return LAUNCH_TERMS[locale];
}
