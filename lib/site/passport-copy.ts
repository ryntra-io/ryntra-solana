import type { PublicLocale } from "./locale.ts";

/**
 * Copy for the public Asset Passport at `/assets/:mint`.
 *
 * Every line here describes a fact the page read from a mint account on the
 * visit. There is no score, no grade and no verdict, and the word `safe` is
 * absent by rule: this product states what an issuer *can still do* and lets a
 * person decide what that means to them.
 */
export type PassportCopy = Readonly<{
  eyebrow: string;
  lead: string;
  openInProduct: string;
  aboutProduct: string;
  share: string;
  shareCopied: string;

  unreadTitle: string;
  unreadBody: string;

  powersTitle: string;
  powersLead: string;
  canMint: string;
  canFreeze: string;
  program: string;
  decimals: string;
  yes: string;
  no: string;

  rulesTitle: string;
  rulesLead: string;
  rulesNone: string;
  affectsTransfers: string;

  knowingTitle: string;
  knowingLead: string;
  readAt: string;
  network: string;
  undecodable: string;
  seeMarkets: string;
}>;

const EN: PassportCopy = {
  eyebrow: "ASSET PASSPORT",
  lead: "What this token's issuer can still do to a balance you hold, read from the mint account on this visit. No account, no wallet.",
  openInProduct: "Open in Ryntra",
  aboutProduct: "About the product",
  share: "Share",
  shareCopied: "Link copied",

  unreadTitle: "This address did not read as a mint",
  unreadBody:
    "Either it is not a token mint on Solana mainnet, or the chain could not be read just now. Nothing is inferred from the silence: the page says it could not look rather than telling you there is nothing there.",

  powersTitle: "What the issuer can still do",
  powersLead:
    "Two powers decide whether a balance is yours in practice. Both are bytes in the mint account, and both are stated here whichever way they fall.",
  canMint: "Create more",
  canFreeze: "Freeze your balance",
  program: "Token program",
  decimals: "Decimals",
  yes: "Yes",
  no: "No — the authority is absent",

  rulesTitle: "Extra rules on a transfer",
  rulesLead:
    "Token-2022 extensions can change what a transfer actually delivers, who may move it, or who can take it back. Each one below is decoded from the account, and the ones that change a transfer are marked.",
  rulesNone: "None. This mint carries no extension that changes what a transfer does.",
  affectsTransfers: "Affects transfers",

  knowingTitle: "How this is known",
  knowingLead:
    "Read directly from the chain when this page was built, not from a list somebody maintains. An extension nobody can decode is counted rather than hidden.",
  readAt: "Read at",
  network: "Solana mainnet",
  undecodable: "Could not be decoded",
  seeMarkets: "See every issuer's powers",
};

const UK: PassportCopy = {
  eyebrow: "ПАСПОРТ АКТИВУ",
  lead: "Що емітент цього токена ще може зробити з вашим балансом — прочитано з мінт-акаунта під час цього візиту. Без акаунта, без гаманця.",
  openInProduct: "Відкрити в Ryntra",
  aboutProduct: "Про продукт",
  share: "Поділитися",
  shareCopied: "Посилання скопійовано",

  unreadTitle: "Ця адреса не прочиталася як мінт",
  unreadBody:
    "Або це не мінт токена в Solana mainnet, або мережу зараз не вдалося прочитати. З мовчання нічого не виводиться: сторінка каже, що не змогла подивитися, а не що там нічого немає.",

  powersTitle: "Що емітент ще може зробити",
  powersLead:
    "Дві властивості вирішують, чи баланс справді ваш на практиці. Обидві — байти в мінт-акаунті, і обидві названі тут, хай як вони випали.",
  canMint: "Випустити більше",
  canFreeze: "Заморозити ваш баланс",
  program: "Програма токена",
  decimals: "Десяткових знаків",
  yes: "Так",
  no: "Ні — повноваження відсутнє",

  rulesTitle: "Додаткові правила переказу",
  rulesLead:
    "Розширення Token-2022 можуть змінити те, що насправді дійде переказом, хто може його зробити або хто може забрати кошти назад. Кожне нижче розкодоване з акаунта, і ті, що впливають на переказ, позначені.",
  rulesNone: "Немає. Цей мінт не має розширень, які змінюють поведінку переказу.",
  affectsTransfers: "Впливає на перекази",

  knowingTitle: "Звідки це відомо",
  knowingLead:
    "Прочитано напряму з мережі під час побудови сторінки, а не зі списку, який хтось веде. Розширення, яке ніхто не може розкодувати, порахували, а не сховали.",
  readAt: "Прочитано",
  network: "Solana mainnet",
  undecodable: "Не вдалося розкодувати",
  seeMarkets: "Подивитися повноваження всіх емітентів",
};

export const PASSPORT_COPY: Readonly<Record<PublicLocale, PassportCopy>> = { en: EN, uk: UK };

export function passportCopy(locale: PublicLocale): PassportCopy {
  return PASSPORT_COPY[locale] ?? EN;
}
