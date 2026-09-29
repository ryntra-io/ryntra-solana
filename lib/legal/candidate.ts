import { FEES, FEES_UK, REWARDS } from "../../app/docs/content/facts.ts";
import { CONTACTS } from "../site/contacts.ts";

const EMAIL = CONTACTS.email;

/**
 * The legal review candidate of the new site (canon v5.5; the plan of
 * `RYN-SITE-V5-001`, decision 7: subtask 3 prepares the candidates, English
 * and Ukrainian, with the privacy of the Android app; the published
 * `/legal/terms` and `/legal/privacy` change only on a lawyer's word).
 *
 * Three documents — Terms, Privacy, Product and risk disclosures — as data,
 * so both languages keep one structure and a test can read every sentence.
 * Every statement about the product was checked against the code on
 * `LEGAL_RELEASE_FACTS.verifiedThrough` (the data inventory is in
 * `docs/legal/CANDIDATE-2026-09-26-DATA-MAP.md`): what is stored, where, who
 * else receives it, what the phone keeps. What only the operator and counsel
 * can supply — the operator's identity, the governing law, the transfer
 * mechanism, the retention schedule — is named as missing, never invented.
 */

export type Bi<T = string> = Readonly<{ en: T; uk: T }>;

export type LegalBlock =
  | Readonly<{ p: Bi }>
  | Readonly<{ list: Bi<readonly string[]> }>
  | Readonly<{ table: Readonly<{ caption: Bi; head: Bi<readonly string[]>; rows: Bi<readonly (readonly string[])[]> }> }>;

export type LegalSection = Readonly<{ id: string; heading: Bi; blocks: readonly LegalBlock[] }>;

export type LegalDocumentId = "terms" | "privacy" | "disclosures";

export type LegalDocument = Readonly<{
  id: LegalDocumentId;
  title: Bi;
  description: Bi;
  lead: Bi;
  sections: readonly LegalSection[];
}>;

const bi = (en: string, uk: string): Bi => ({ en, uk });
/** A table's column heads, one list per language. */
const heads = (en: readonly string[], uk: readonly string[]): Bi<readonly string[]> => ({ en, uk });
const p = (en: string, uk: string): LegalBlock => ({ p: bi(en, uk) });
const list = (en: readonly string[], uk: readonly string[]): LegalBlock => ({ list: { en, uk } });
const section = (id: string, en: string, uk: string, blocks: readonly LegalBlock[]): LegalSection => ({ id, heading: bi(en, uk), blocks });

const ukMoney = (value: number) => value.toFixed(2).replace(".", ",");

export const CANDIDATE_TERMS: LegalDocument = {
  id: "terms",
  title: bi("Terms of Use", "Умови користування"),
  description: bi(
    "Review candidate of Ryntra's Terms of Use: a non-custodial app for tokenized stocks on Solana, Autoinvest, the AI assistant, fees, Rewards, risks and liability.",
    "Кандидат Умов користування Ryntra: застосунок без кастодії для токенізованих акцій на Solana, «Автоінвест», ШІ-помічник, комісії, Винагороди, ризики й відповідальність.",
  ),
  lead: bi(
    "These Terms govern your use of Ryntra. By using it you agree to them; if you do not agree, do not use it.",
    "Ці Умови регулюють користування Ryntra. Користуючись нею, ти з ними погоджуєшся; якщо не погоджуєшся — не користуйся.",
  ),
  sections: [
    section("service", "1. What Ryntra is", "1. Що таке Ryntra", [
      p(
        "Ryntra is an app at ryntra.io, with a phone app and a Telegram bot for notifications, that lets you buy tokenized stocks and other assets on the Solana network from your own wallet: a purchase in dollars from $1, Autoinvest rules that remind you when to buy, swaps, Spot, bridges, sending and receiving, your portfolio, your history with receipts, Rewards, and Ryntra, the AI assistant (together, the «Service»).",
        "Ryntra — застосунок на ryntra.io з телефонним застосунком і ботом Telegram для сповіщень, що дає купувати токенізовані акції та інші активи в мережі Solana зі свого гаманця: купівлю в доларах від $1, правила «Автоінвесту», що нагадують, коли купувати, обмін, Спот, міст, надсилання й отримання, портфель, історію з квитанціями, Винагороди й Ryntra — ШІ-помічника (разом — «Сервіс»).",
      ),
      p(
        "Ryntra is not an exchange, a broker, a custodian or an investment adviser. It is not operated by, and does not speak for, any issuer, wallet, liquidity or bridging provider, or network whose tokens or services appear in the Service.",
        "Ryntra — не біржа, не брокер, не кастодіан і не інвестиційний радник. Її не керує й від її імені не говорить жоден емітент, гаманець, провайдер ліквідності чи мосту або мережа, чиї токени чи послуги є в Сервісі.",
      ),
    ]),
    section("wallet", "2. Your wallet and your signature", "2. Твій гаманець і твій підпис", [
      list(
        [
          "Ryntra never holds your money. There is no deposit and no balance with Ryntra; what you buy stays in your own wallet.",
          "Ryntra never asks for, stores or has access to your seed phrase, private keys or wallet password. Anyone who asks for them in Ryntra's name is not Ryntra.",
          "Every financial action — a purchase, a swap, a Spot trade, a bridge, a transfer, a Rewards claim — is signed by your own wallet. Ryntra prepares the transaction and shows it in the Review; it cannot sign it, change it after the Review, or keep a standing permission over your wallet.",
          "You are responsible for your wallet, your device and your keys. A signed transaction is final, and Ryntra cannot reverse it.",
        ],
        [
          "Ryntra ніколи не тримає твоїх грошей. Депозиту й балансу в Ryntra немає; куплене лишається у твоєму гаманці.",
          "Ryntra ніколи не просить, не зберігає й не має доступу до твоєї сід-фрази, приватних ключів чи пароля гаманця. Той, хто просить їх від імені Ryntra, — не Ryntra.",
          "Кожну фінансову дію — купівлю, обмін, угоду на Споті, міст, переказ, виплату Винагород — підписує твій гаманець. Ryntra готує транзакцію й показує її в «Перевірці»; вона не може її підписати, змінити після «Перевірки» чи тримати постійний дозвіл на твій гаманець.",
          "За свій гаманець, пристрій і ключі відповідаєш ти. Підписана транзакція остаточна, і Ryntra не може її скасувати.",
        ],
      ),
    ]),
    section("assets", "3. What you buy", "3. Що ти купуєш", [
      p(
        "Tokenized stocks and the other tokens in the Service are issued by third parties — xStocks, Backpack, Ondo, PreStocks and others — under their own terms. A tokenized stock tracks a share's price; it is not the share itself unless its issuer says so, and it carries no shareholder rights unless its issuer grants them.",
        "Токенізовані акції та інші токени в Сервісі випускають треті сторони — xStocks, Backpack, Ondo, PreStocks та інші — на власних умовах. Токенізована акція відстежує ціну акції; вона не є самою акцією, якщо про це не каже її емітент, і не дає прав акціонера, якщо їх не надає емітент.",
      ),
      p(
        "A PreStocks token gives only economic exposure to a private company — no ownership, vote or dividends. It may not be possible to sell; its issuer takes a fee on every transfer and can freeze, move or burn the token; and when the company lists or is acquired, the token must be swapped by the issuer's deadline or it expires. Each asset's page names its issuer and what it is before you buy; the issuer's terms, not Ryntra's, govern the token.",
        "Токен PreStocks дає лише економічну експозицію на приватну компанію — без власності, голосу й дивідендів. Його може не вийти продати; його емітент бере комісію з кожного переказу й може заморозити, перемістити чи спалити токен; а коли компанія виходить на біржу чи її купують, токен треба обміняти до строку емітента, інакше він згорить. Сторінка кожного активу називає емітента й що це таке ще до купівлі; токен регулюють умови емітента, а не Ryntra.",
      ),
    ]),
    section("autoinvest", "4. Autoinvest", "4. «Автоінвест»", [
      list(
        [
          "An Autoinvest rule — regularly, if a price falls, or from every payment — only schedules reminders. It is not an instruction or a permission to buy: nothing is bought until you sign a fresh Review.",
          "A reminder you do not sign is marked Missed, and Ryntra never buys it later. The monthly budget limits reminders; it grants nothing.",
          "A rule «from every payment» reads the public USDC transfers of your wallet on Solana to count what it sets aside. It never moves your money.",
          "A price condition defers a reminder when the price stands above its reference by more than your limit, or when the data is stale. A reference is the issuer's figure or PreStocks' valuation, not a fair price.",
        ],
        [
          "Правило «Автоінвесту» — регулярно, якщо ціна впаде, чи з кожної оплати — лише планує нагадування. Це не доручення й не дозвіл купувати: нічого не купується, доки ти не підпишеш свіжу «Перевірку».",
          "Непідписане нагадування позначається «Пропущено», і Ryntra ніколи не купує його пізніше. Бюджет місяця обмежує нагадування; він нічого не дозволяє.",
          "Правило «з кожної оплати» читає публічні перекази USDC твого гаманця в Solana, щоб порахувати, що воно відкладає. Воно ніколи не рухає твоїх грошей.",
          "«Умова ціни» відкладає нагадування, коли ціна вища за орієнтир більш ніж на твій ліміт або дані застаріли. Орієнтир — цифра емітента чи оцінка PreStocks, а не справедлива ціна.",
        ],
      ),
    ]),
    section("assistant", "5. Ryntra, the AI assistant", "5. Ryntra — ШІ-помічник", [
      list(
        [
          "Ryntra, the AI assistant, explains and prepares drafts. It can be wrong or incomplete: check what it says before you rely on it.",
          "It has no tool to buy, sell, send or sign, and it gives no personal investment advice.",
          "Your questions and its answers are kept with your account; to answer, your question and the facts it needs are processed by the model's provider, as the Privacy Policy describes.",
          "Do not enter a seed phrase, a key, a password or anyone else's personal data in a question.",
        ],
        [
          "Ryntra — ШІ-помічник — пояснює й готує чернетки. Він може помилятися чи казати не все: перевір сказане, перш ніж на нього покладатися.",
          "У нього немає інструмента купити, продати, надіслати чи підписати, і він не дає персональних інвестиційних порад.",
          "Твої запитання і його відповіді зберігаються з твоїм акаунтом; щоб відповісти, твоє запитання й потрібні для нього факти обробляє постачальник моделі, як описує Політика приватності.",
          "Не вводь у запитання сід-фразу, ключ, пароль чи чужі персональні дані.",
        ],
      ),
    ]),
    section("eligibility", "6. Who may use the Service", "6. Хто може користуватися Сервісом", [
      list(
        [
          "You must be at least 18 years old, or of age where you live if that age is higher.",
          "You are responsible for complying with the laws that apply to you, including any restriction on buying tokenized or digital assets.",
          "Each issuer decides who may hold its token. By their own documents xStocks, Backpack, Ondo and PreStocks exclude the United States, and Backpack also excludes the United Kingdom, the UAE and Japan. You must not use the Service to get around these restrictions, and Ryntra never works around them.",
          "You must not use the Service if you are subject to sanctions, or on behalf of someone who is.",
        ],
        [
          "Тобі має бути щонайменше 18 років або вік повноліття там, де ти живеш, якщо він вищий.",
          "Ти відповідаєш за дотримання законів, що діють для тебе, зокрема обмежень на купівлю токенізованих чи цифрових активів.",
          "Хто може тримати токен, вирішує його емітент. За своїми документами xStocks, Backpack, Ondo й PreStocks виключають США, а Backpack — ще й Велику Британію, ОАЕ та Японію. Не використовуй Сервіс, щоб обійти ці обмеження, — Ryntra їх не обходить.",
          "Не користуйся Сервісом, якщо ти під санкціями, чи від імені того, хто під ними.",
        ],
      ),
    ]),
    section("fees", "7. Fees", "7. Комісії", [
      p(
        `Ryntra charges a service fee of ${FEES.swap} of the amount on a purchase, a swap and a Spot trade, and ${FEES.bridge} on a bridge. The fee is shown in the Review before you sign and is part of the transaction your wallet signs. Network fees, the one-time reserve of a new token account, an issuer's fee, a provider's costs, price impact and slippage are not Ryntra's; the Review shows them apart. Sending, receiving and Rewards claims carry no Ryntra fee, and nothing is charged for looking.`,
        `Ryntra бере комісію ${FEES_UK.swap} від суми купівлі, обміну й угоди на Споті та ${FEES_UK.bridge} — мосту. Комісію видно в «Перевірці» до підпису, і вона — частина транзакції, яку підписує твій гаманець. Плата мережі, разовий резерв нового рахунку токена, комісія емітента, витрати провайдера, вплив на ціну й прослизання — не комісії Ryntra; «Перевірка» показує їх окремо. Надсилання, отримання й виплати Винагород не мають комісії Ryntra, а за перегляд нічого не стягується.`,
      ),
    ]),
    section("rewards", "8. Rewards, referrals and points", "8. Винагороди, реферали й бали", [
      p(
        `When Ryntra collects its service fee on an eligible operation, a share of that collected fee is credited: ${REWARDS.cashbackPercent}% to the wallet that made the operation, ${REWARDS.referralL1Percent}% to the wallet that invited it and ${REWARDS.referralL2Percent}% to the wallet that invited that one. Only a fee actually collected counts. Rewards are paid in USDC on Solana to the wallet you are signed in with, from $${REWARDS.claimFloorUsd.toFixed(2)} a claim, after the operation has settled. An inviter, once confirmed, cannot be changed; self-referral and circular referrals are refused. Points record activity, have no cash value, cannot be transferred, and carry no promise of any token, airdrop or conversion. Ryntra may change, suspend or end the programme; a change applies to operations made after it.`,
        `Коли Ryntra збирає свою комісію з операції, що зараховується, частку зібраної комісії нараховують: ${REWARDS.cashbackPercent}% — гаманцю, що зробив операцію, ${REWARDS.referralL1Percent}% — гаманцю, що його запросив, і ${REWARDS.referralL2Percent}% — гаманцю, що запросив того. Рахується лише справді зібрана комісія. Винагороди виплачуються в USDC на Solana на гаманець, яким виконано вхід, від $${ukMoney(REWARDS.claimFloorUsd)} за виплату, після завершення операції. Підтвердженого запрошувача змінити не можна; запрошення самого себе й кола запрошень відхиляються. Бали фіксують активність, не мають грошової вартості, не передаються й не обіцяють жодного токена, airdrop чи конвертації. Ryntra може змінити, призупинити чи завершити програму; зміна діє для операцій після неї.`,
      ),
    ]),
    section("advice", "9. No advice", "9. Це не порада", [
      p(
        "Nothing in the Service is investment, financial, legal or tax advice, or an offer or solicitation to buy or sell any asset. Figures, charts, company facts, research and the assistant's answers are information. You alone decide what to buy and when.",
        "Ніщо в Сервісі не є інвестиційною, фінансовою, юридичною чи податковою порадою або пропозицією чи закликом купити чи продати будь-який актив. Цифри, графіки, факти про компанії, дослідження й відповіді помічника — це інформація. Що й коли купувати, вирішуєш лише ти.",
      ),
    ]),
    section("risks", "10. Risks", "10. Ризики", [
      list(
        [
          "Prices move and can fall to zero. A tokenized stock can trade away from the share's price, especially when the exchange is closed.",
          "Liquidity can be thin; a PreStocks token may not be sellable at all.",
          "An issuer can freeze, pause, move or burn its token, change its terms, or fail.",
          "A private company's listing or acquisition can set a deadline to swap its PreStocks token; missing it can mean losing the token.",
          "Bridges cross networks and providers and can be delayed or fail; a transaction on a blockchain is final.",
          "The AI assistant can be wrong. A loss limit or a reminder guarantees nothing: a price can jump past a limit before you act.",
          "Past prices do not indicate future results.",
        ],
        [
          "Ціни рухаються й можуть упасти до нуля. Токенізована акція може торгуватися осторонь ціни акції, особливо коли біржа зачинена.",
          "Ліквідність може бути тонкою; токен PreStocks може взагалі не вийти продати.",
          "Емітент може заморозити, призупинити, перемістити чи спалити свій токен, змінити умови або збанкрутувати.",
          "Вихід приватної компанії на біржу чи її купівля можуть поставити строк обміну її токена PreStocks; пропустити його — означає, що токен може згоріти.",
          "Мости перетинають мережі й провайдерів і можуть затримуватися чи не завершитися; транзакція в блокчейні остаточна.",
          "ШІ-помічник може помилятися. Межа збитку чи нагадування нічого не гарантують: ціна може проскочити межу раніше, ніж ти встигнеш діяти.",
          "Минулі ціни не свідчать про майбутні результати.",
        ],
      ),
    ]),
    section("use", "11. Acceptable use", "11. Допустиме користування", [
      list(
        [
          "Do not use the Service for anything unlawful, for market manipulation or for wash trading.",
          "Do not try to gain unauthorized access to the Service, other people's data or its infrastructure.",
          "Do not abuse, overload, scrape at scale or resell the Service without written permission.",
          "Do not abuse Rewards — self-referral, circular referrals or artificial volume.",
          "Do not impersonate Ryntra or misrepresent a connection with it.",
        ],
        [
          "Не використовуй Сервіс для незаконного, для маніпулювання ринком чи фіктивних угод.",
          "Не намагайся отримати несанкціонований доступ до Сервісу, чужих даних чи його інфраструктури.",
          "Не зловживай Сервісом, не перевантажуй його, не збирай дані масово й не перепродуй без письмового дозволу.",
          "Не зловживай Винагородами — запрошення себе, кола запрошень чи штучний обсяг.",
          "Не видавай себе за Ryntra й не вигадуй зв'язку з нею.",
        ],
      ),
    ]),
    section("third-parties", "12. Third-party services", "12. Сервіси третіх сторін", [
      p(
        "The Service works with third parties — your wallet software; the Solana network and the networks a bridge crosses; Jupiter and the venues it routes through; bridging providers; the issuers; market data sources; OpenAI for the AI assistant; Telegram; Google Firebase for phone notifications — each under its own terms. Ryntra does not control them and is not responsible for their availability, their data, their execution or the terms on which a token is issued.",
        "Сервіс працює з третіми сторонами — програмою твого гаманця; мережею Solana й мережами, які перетинає міст; Jupiter і майданчиками, через які він прокладає маршрут; провайдерами мостів; емітентами; джерелами ринкових даних; OpenAI для ШІ-помічника; Telegram; Google Firebase для сповіщень на телефоні, — кожна на своїх умовах. Ryntra їх не контролює й не відповідає за їхню доступність, дані, виконання чи умови, на яких випущено токен.",
      ),
    ]),
    section("ip", "13. Intellectual property", "13. Інтелектуальна власність", [
      p(
        "The Service — its design, code and content, excluding third-party materials and your own content — belongs to Ryntra. You receive a limited, personal, non-transferable and revocable licence to use it. Parts of Ryntra's code are published as open source; their own licences govern that code. Your plans, notes and rules remain yours.",
        "Сервіс — його дизайн, код і зміст, крім матеріалів третіх сторін і твого власного змісту, — належить Ryntra. Ти отримуєш обмежену, особисту, непередавану й відкличну ліцензію ним користуватися. Частину коду Ryntra опубліковано як відкритий код; цей код регулюють його власні ліцензії. Твої плани, нотатки й правила лишаються твоїми.",
      ),
    ]),
    section("liability", "14. Disclaimers and limitation of liability", "14. Застереження й обмеження відповідальності", [
      p(
        "The Service is beta software provided «as is» and «as available», without warranties of any kind, including accuracy, fitness for a purpose or uninterrupted operation. Market data may be delayed, incomplete or wrong. To the extent the law allows, Ryntra is not liable for indirect, incidental, special or consequential losses, or for lost profits, funds or data — including trading losses, losses caused by an issuer, a provider or a network, and losses caused by a compromised device or wallet.",
        "Сервіс — бета-програма, що надається «як є» і «як доступно», без будь-яких гарантій, зокрема точності, придатності для мети чи безперебійної роботи. Ринкові дані можуть запізнюватися, бути неповними чи хибними. Наскільки дозволяє закон, Ryntra не відповідає за непрямі, випадкові, особливі чи наслідкові збитки, втрачений прибуток, кошти чи дані — зокрема за торгові збитки, збитки з вини емітента, провайдера чи мережі та збитки через скомпрометований пристрій чи гаманець.",
      ),
    ]),
    section("termination", "15. Suspension and termination", "15. Призупинення й припинення", [
      p(
        "Ryntra may suspend or end your access to the Service, including for a breach of these Terms or abuse of Rewards. You may stop using it at any time and ask for your data to be deleted as the Privacy Policy describes. What is in your wallet is unaffected, because Ryntra never holds it.",
        "Ryntra може призупинити чи припинити твій доступ до Сервісу, зокрема за порушення цих Умов чи зловживання Винагородами. Ти можеш будь-коли припинити ним користуватися й попросити видалити свої дані, як описує Політика приватності. На те, що в твоєму гаманці, це не впливає, бо Ryntra його не тримає.",
      ),
    ]),
    section("changes", "16. Changes to these Terms", "16. Зміни цих Умов", [
      p(
        "Ryntra may update these Terms. The version and its date are stated at the top, and a material change is announced in the Service. Using the Service after a change takes effect means you accept it.",
        "Ryntra може оновлювати ці Умови. Версію та її дату вказано вгорі, а про суттєву зміну повідомляють у Сервісі. Користування Сервісом після того, як зміна набула чинності, означає, що ти її приймаєш.",
      ),
    ]),
    section("contact", "17. Contact", "17. Контакти", [
      p(`Ryntra — ${EMAIL}.`, `Ryntra — ${EMAIL}.`),
    ]),
  ],
};

export const CANDIDATE_PRIVACY: LegalDocument = {
  id: "privacy",
  title: bi("Privacy Policy", "Політика приватності"),
  description: bi(
    "Review candidate of Ryntra's Privacy Policy for the website, the Android app and the Telegram bot: what is collected, why, who else receives it, and how to delete it.",
    "Кандидат Політики приватності Ryntra для сайту, застосунку Android і бота Telegram: що збирається, навіщо, хто ще це отримує і як це видалити.",
  ),
  lead: bi(
    "This policy explains what Ryntra collects through ryntra.io, the Ryntra app for Android and the Ryntra Telegram bot, why, who else receives it, and your choices. Your account is your wallet, and Ryntra collects what the Service needs to work.",
    "Ця політика пояснює, що Ryntra збирає через ryntra.io, застосунок Ryntra для Android і бота Ryntra в Telegram, навіщо, хто ще це отримує і який у тебе вибір. Твій акаунт — це твій гаманець, і Ryntra збирає те, що потрібно Сервісу для роботи.",
  ),
  sections: [
    section("controller", "1. Who is responsible", "1. Хто відповідає", [
      p(
        `The legal identity and address of the entity responsible for your data are completed before this policy takes effect. Until then, write to ${EMAIL}.`,
        `Юридичну особу, що відповідає за твої дані, і її адресу буде вказано до того, як ця політика набуде чинності. До того пиши на ${EMAIL}.`,
      ),
    ]),
    section("collect", "2. What we collect", "2. Що ми збираємо", [
      list(
        [
          "Your wallet's public address — when you connect a wallet. It is public on the blockchain; with it Ryntra reads what the wallet holds, prepares transactions and keeps the record of what you do through Ryntra.",
          "Sign-in records — when you sign in with your wallet: the proof of the message your wallet signed, the account linked to the address, and session records (when issued, when they expire, last activity, whether revoked). A sign-in lasts up to a day on a device.",
          "Operations and receipts — the purchases, swaps, trades, bridges, transfers and Rewards claims you make through Ryntra: what you reviewed, what the network did, transaction signatures, amounts, fees and status.",
          "Autoinvest — your rules, your monthly budget, the reminders and whether you bought, and, for a rule «from every payment», the USDC payments and incoming transfers of your wallet that the rule counted: the amount, the time, the transaction, the other address and its memo, and the accounts you marked as your own.",
          "Plans and notifications — your trading plans with their versions and notes, the conditions Ryntra watches for you, and the notes it writes to you.",
          "Ryntra, the AI assistant — your questions and its answers, kept per conversation with your account, and a record of each call to the model (its name, size and outcome — not your words).",
          "Rewards, points and referrals — the ledgers of cashback and referral shares, your points and level, your referral code, the wallet that invited you and the wallets you invited, and your claims.",
          "Preferences — your watchlist, on the account once you sign in; your language and theme, in your browser.",
          "Telegram, if you connect it — your Telegram ID and username, and the messages you send the bot.",
          "Feedback and letters — what you write to us, the page and language it came from, and any contact detail you add.",
          "Usage events — a few events, such as a button pressed, with the page, the language and the referring address, shortened; they carry no wallet and no amount. Vercel Web Analytics counts visits in aggregate.",
          "Cookies — a sign-in cookie, a wallet-proof cookie, short-lived sign-in state, a referral cookie when you arrive through an invitation link, and a language cookie. No advertising or cross-site tracking cookies.",
        ],
        [
          "Публічна адреса гаманця — коли ти під'єднуєш гаманець. Вона публічна в блокчейні; з нею Ryntra читає, що тримає гаманець, готує транзакції й веде запис того, що ти робиш через Ryntra.",
          "Записи входу — коли ти входиш гаманцем: доказ повідомлення, яке підписав гаманець, акаунт, прив'язаний до адреси, і записи сесій (коли видано, коли спливає, остання активність, чи відкликано). Вхід діє на пристрої до доби.",
          "Операції й квитанції — купівлі, обміни, угоди, мости, перекази й виплати Винагород через Ryntra: що було в «Перевірці», що зробила мережа, підписи транзакцій, суми, комісії й статус.",
          "«Автоінвест» — твої правила, бюджет місяця, нагадування й чи була купівля, а для правила «з кожної оплати» — оплати й надходження USDC твого гаманця, які правило врахувало: сума, час, транзакція, адреса іншої сторони та її memo, а також рахунки, позначені тобою як свої.",
          "Плани й сповіщення — твої торгові плани з версіями й нотатками, умови, за якими Ryntra для тебе стежить, і нотатки, які вона тобі пише.",
          "Ryntra — ШІ-помічник — твої запитання і його відповіді, збережені по розмовах із твоїм акаунтом, і запис кожного звернення до моделі (її назва, обсяг і результат — не твої слова).",
          "Винагороди, бали й реферали — облік кешбеку й реферальних часток, твої бали й рівень, реферальний код, гаманець, що тебе запросив, і гаманці, запрошені тобою, та твої виплати.",
          "Уподобання — твоє обране, в акаунті після входу; мова й тема — у твоєму браузері.",
          "Telegram, якщо ти його під'єднуєш, — твій Telegram ID та ім'я користувача й повідомлення, які ти надсилаєш боту.",
          "Відгуки й листи — що ти нам пишеш, сторінка й мова, звідки це прийшло, і контакт, якщо ти його додаєш.",
          "Події використання — кілька подій, як-от натиснута кнопка, зі сторінкою, мовою й адресою переходу, скороченою; вони не несуть ні гаманця, ні суми. Vercel Web Analytics рахує відвідування загалом.",
          "Cookies — cookie входу, cookie доказу гаманця, короткочасний стан входу, реферальний cookie, коли ти приходиш за запрошенням, і cookie мови. Жодних рекламних cookies чи стеження між сайтами.",
        ],
      ),
    ]),
    section("android", "3. The Ryntra app for Android", "3. Застосунок Ryntra для Android", [
      p(
        "The app works with the same account as the website, and everything above applies to it. What differs:",
        "Застосунок працює з тим самим акаунтом, що й сайт, і все сказане вище стосується й нього. Що відрізняється:",
      ),
      list(
        [
          "On your phone: your session, in the phone's secure storage; your notification settings and, if you turn phone notifications on, the phone's push token; your watchlist; the last Home screen you saw (public prices and the time); a short record of the steps you took in the app, with no identity; your preferences. Removing the app removes them.",
          "Your wallet signs in the wallet app on your phone through Mobile Wallet Adapter; your keys never reach Ryntra's app.",
          "If you turn phone notifications on, the push token, the app's version, your language, quiet hours and the kinds of notes you want are stored with your account, and notes are delivered through Google Firebase Cloud Messaging. Turning notifications off or signing out revokes the token.",
          "The app gets its data from ryntra.io. Asset logos load from the addresses their issuers publish, and those hosts see your phone's network address.",
          "The app asks only for permission to send notifications, when you turn them on. It does not use your location, camera, contacts or advertising identifier, and it includes no analytics or advertising kit.",
        ],
        [
          "На телефоні: твоя сесія — у захищеному сховищі телефона; налаштування сповіщень і, якщо ти ввімкнеш сповіщення на телефоні, push-токен телефона; твоє обране; останній показаний тобі екран Головної (публічні ціни й час); короткий запис кроків у застосунку без жодної особи; твої уподобання. Видалення застосунку прибирає їх.",
          "Твій гаманець підписує в застосунку гаманця на телефоні через Mobile Wallet Adapter; твої ключі ніколи не потрапляють у застосунок Ryntra.",
          "Якщо ти ввімкнеш сповіщення на телефоні, push-токен, версія застосунку, твоя мова, тихі години й види нотаток, які ти хочеш, зберігаються з твоїм акаунтом, а нотатки доставляє Google Firebase Cloud Messaging. Вимкнення сповіщень чи вихід відкликає токен.",
          "Дані застосунок отримує з ryntra.io. Логотипи активів завантажуються з адрес, які публікують їхні емітенти, і ці хости бачать мережеву адресу твого телефона.",
          "Застосунок просить лише дозволу надсилати сповіщення — коли ти їх вмикаєш. Він не використовує твоєї геолокації, камери, контактів чи рекламного ідентифікатора й не містить наборів аналітики чи реклами.",
        ],
      ),
    ]),
    section("never", "4. What we never collect", "4. Чого ми ніколи не збираємо", [
      list(
        [
          "Seed phrases, private keys, wallet passwords or any credential that controls funds.",
          "Deposits or funds of any kind — Ryntra is non-custodial.",
          "Card or bank details — there is nothing to pay Ryntra; its fee is part of the transaction your wallet signs.",
          "An email address and password for a customer account — the wallet is the account.",
          "Your location, contacts or photos.",
        ],
        [
          "Сід-фрази, приватні ключі, паролі гаманців чи будь-які облікові дані, що керують коштами.",
          "Депозити чи кошти будь-якого виду — Ryntra не тримає коштів.",
          "Дані карток чи банківських рахунків — платити Ryntra нема за що; її комісія — частина транзакції, яку підписує твій гаманець.",
          "Пошту й пароль для клієнтського акаунта — акаунтом є гаманець.",
          "Геолокацію, контакти чи фото.",
        ],
      ),
    ]),
    section("use", "5. Why we use it", "5. Навіщо ми це використовуємо", [
      list(
        [
          "To provide the Service: read what your wallet holds, prepare and simulate the transactions you ask for, and record their results as History and receipts.",
          "To remind you by your Autoinvest rules and write the notes you asked for — in the app, in Telegram or on your phone.",
          "To answer your questions to Ryntra, the AI assistant.",
          "To run Rewards, points and referrals on the fees actually collected.",
          "To keep the Service secure: sessions, rate limits, abuse prevention.",
          "To understand, in aggregate, how the Service is used and to improve it.",
        ],
        [
          "Щоб надавати Сервіс: читати, що тримає твій гаманець, готувати й симулювати транзакції, які ти просиш, і записувати їхні результати в Історію й квитанції.",
          "Щоб нагадувати за правилами «Автоінвесту» й писати нотатки, про які ти просиш, — у застосунку, у Telegram чи на телефоні.",
          "Щоб відповідати на твої запитання до Ryntra — ШІ-помічника.",
          "Щоб вести Винагороди, бали й реферали на справді зібраних комісіях.",
          "Щоб берегти безпеку Сервісу: сесії, обмеження частоти, запобігання зловживанням.",
          "Щоб загалом розуміти, як користуються Сервісом, і покращувати його.",
        ],
      ),
      p(
        "We do not sell your data, share it with advertisers or build advertising profiles.",
        "Ми не продаємо твоїх даних, не передаємо їх рекламодавцям і не будуємо рекламних профілів.",
      ),
    ]),
    section("recipients", "6. Who else receives data", "6. Хто ще отримує дані", [
      {
        table: {
          caption: bi("The services that process data for Ryntra or receive what an action needs", "Сервіси, що обробляють дані для Ryntra чи отримують те, що потрібно для дії"),
          head: heads(["Service", "What it receives", "Why"], ["Сервіс", "Що отримує", "Навіщо"]),
          rows: {
            en: [
              ["Vercel", "Requests to the site; visits counted in aggregate", "Hosting and analytics"],
              ["Supabase", "Your account, sessions, receipts, feedback and usage events", "Database"],
              ["Neon", "Operations, Autoinvest, plans, the assistant's conversations, Rewards, points and notifications", "Database"],
              ["OpenAI", "Your question and the facts it needs — for example your holdings as company and amount — and an identifier computed from your wallet's address, never the address itself; asked not to store the request", "The AI assistant's answers"],
              ["Jupiter", "Your wallet's address and the transaction, for a quote and a purchase; the tokens your wallet holds, to name them", "Routes, quotes and token data"],
              ["Solana RPC providers — PublicNode, Solana Vibe Station and the Solana public endpoint", "Your wallet's address", "Reading the chain and sending transactions"],
              ["Relay and Mayan", "Your address and the destination address", "Bridges"],
              ["Webacy (DD.xyz)", "The address you send to", "The recipient check in Send"],
              ["Telegram", "Your chat and the note's text", "The notifications you connected"],
              ["Google Firebase Cloud Messaging", "The push token and the note", "The phone notifications you turned on"],
              ["Sentry, when enabled", "Error details, without secrets", "Fixing errors"],
            ],
            uk: [
              ["Vercel", "Запити до сайту; відвідування, пораховані загалом", "Хостинг і аналітика"],
              ["Supabase", "Твій акаунт, сесії, квитанції, відгуки й події використання", "База даних"],
              ["Neon", "Операції, «Автоінвест», плани, розмови з помічником, Винагороди, бали й сповіщення", "База даних"],
              ["OpenAI", "Твоє запитання й потрібні для нього факти — наприклад, твої позиції як компанія й кількість — та ідентифікатор, обчислений з адреси твого гаманця, але ніколи не сама адреса; з проханням не зберігати запит", "Відповіді ШІ-помічника"],
              ["Jupiter", "Адреса твого гаманця й транзакція — для котирування й купівлі; токени, що є в гаманці, — щоб їх назвати", "Маршрути, котирування й дані токенів"],
              ["Провайдери Solana RPC — PublicNode, Solana Vibe Station і публічний вузол Solana", "Адреса твого гаманця", "Читання ланцюга й надсилання транзакцій"],
              ["Relay і Mayan", "Твоя адреса й адреса призначення", "Мости"],
              ["Webacy (DD.xyz)", "Адреса, на яку ти надсилаєш", "Перевірка отримувача в «Надіслати»"],
              ["Telegram", "Твій чат і текст нотатки", "Під'єднані тобою сповіщення"],
              ["Google Firebase Cloud Messaging", "Push-токен і нотатка", "Увімкнені тобою сповіщення на телефоні"],
              ["Sentry, якщо ввімкнено", "Подробиці помилки без секретів", "Виправлення помилок"],
            ],
          },
        },
      },
      p(
        "These services process data for Ryntra or under their own terms. A transaction you sign is public on the blockchain by nature.",
        "Ці сервіси обробляють дані для Ryntra чи на власних умовах. Транзакція, яку ти підписуєш, за своєю природою публічна в блокчейні.",
      ),
    ]),
    section("transfers", "7. International transfers", "7. Передача за кордон", [
      p(
        "These services may process data outside your country, including in the European Union and the United States. The legal mechanism for each transfer is confirmed before this policy takes effect.",
        "Ці сервіси можуть обробляти дані за межами твоєї країни, зокрема в Європейському Союзі та США. Правову підставу для кожної передачі буде підтверджено до того, як ця політика набуде чинності.",
      ),
    ]),
    section("retention", "8. How long we keep it", "8. Скільки ми це зберігаємо", [
      p(
        "Your data is kept while your account is in use. Some records are capped by the Service itself — a rule keeps its latest reminders and a payment watch its latest events. No deletion schedule for the rest has been approved; it is completed before this policy takes effect. Records on a public blockchain cannot be deleted by anyone.",
        "Твої дані зберігаються, поки ти користуєшся акаунтом. Частину записів обмежує сам Сервіс — правило тримає свої останні нагадування, а стеження за оплатами — останні події. Графіка видалення решти ще не затверджено; його буде визначено до того, як ця політика набуде чинності. Записів у публічному блокчейні не може видалити ніхто.",
      ),
    ]),
    section("rights", "9. Your rights and deleting your data", "9. Твої права й видалення даних", [
      p(
        `Depending on where you live, you may have rights to access, correct, export or delete your data and to object to or restrict its processing. Write to ${EMAIL} from a way we can link to your account — for example by naming the wallet you sign in with; we may ask you to prove it with a signature. Some things you can remove yourself: delete an Autoinvest rule, disconnect Telegram, turn phone notifications off, sign out everywhere.`,
        `Залежно від того, де ти живеш, у тебе можуть бути права на доступ до своїх даних, їх виправлення, експорт чи видалення, а також на заперечення проти обробки чи її обмеження. Напиши на ${EMAIL} так, щоб ми могли пов'язати лист із твоїм акаунтом, — наприклад, назви гаманець, яким входиш; ми можемо попросити підтвердити це підписом. Дещо можна прибрати самому: видалити правило «Автоінвесту», від'єднати Telegram, вимкнути сповіщення на телефоні, вийти всюди.`,
      ),
    ]),
    section("security", "10. Security", "10. Безпека", [
      p(
        "Ryntra holds no keys and no funds; sign-in sessions are signed by the server and short-lived; the keys of the services Ryntra uses stay on the server. No system is perfectly secure, and what happens on your device and in your wallet is outside Ryntra's control. The Security page says what Ryntra can and cannot touch.",
        "Ryntra не тримає ключів і коштів; сесії входу підписує сервер, і вони короткочасні; ключі сервісів, якими користується Ryntra, лишаються на сервері. Жодна система не є цілком захищеною, а те, що відбувається на твоєму пристрої й у гаманці, — поза контролем Ryntra. Сторінка «Безпека» каже, чого Ryntra може торкнутися, а чого ні.",
      ),
    ]),
    section("children", "11. Children", "11. Діти", [
      p(
        "The Service is not for anyone under 18, and Ryntra does not knowingly collect their data. If you believe a minor has given us data, write to us and it will be deleted.",
        "Сервіс не для тих, кому немає 18, і Ryntra свідомо не збирає їхніх даних. Якщо вважаєш, що неповнолітня особа надала нам дані, напиши нам — і їх буде видалено.",
      ),
    ]),
    section("changes", "12. Changes and contact", "12. Зміни й контакти", [
      p(
        `Ryntra may update this policy; the version and its date are stated at the top, and a material change is announced in the Service. Questions: ${EMAIL}.`,
        `Ryntra може оновлювати цю політику; версію та її дату вказано вгорі, а про суттєву зміну повідомляють у Сервісі. Запитання: ${EMAIL}.`,
      ),
    ]),
  ],
};

export const CANDIDATE_DISCLOSURES: LegalDocument = {
  id: "disclosures",
  title: bi("Product and risk disclosures", "Розкриття про продукт і ризики"),
  description: bi(
    "Review candidate of Ryntra's product and risk disclosures: what each issuer's token is, how prices and references work, what you pay, Autoinvest, the AI assistant and private companies.",
    "Кандидат розкриття про продукт і ризики Ryntra: що таке токен кожного емітента, як працюють ціни й орієнтири, що ти платиш, «Автоінвест», ШІ-помічник і приватні компанії.",
  ),
  lead: bi(
    "What you should know before you buy through Ryntra, in one place. These disclosures add to the Terms of Use.",
    "Що варто знати, перш ніж купувати через Ryntra, в одному місці. Ці розкриття доповнюють Умови користування.",
  ),
  sections: [
    section("what", "1. What Ryntra does and does not do", "1. Що Ryntra робить і чого ні", [
      list(
        [
          "Ryntra prepares a purchase, shows it in the Review and records its result; your wallet signs it.",
          "Ryntra does not hold your money, sign for you, buy on its own, or give personal investment advice.",
          "Ryntra is not the issuer of any token it shows and does not stand behind any issuer.",
        ],
        [
          "Ryntra готує купівлю, показує її в «Перевірці» й записує результат; підписує твій гаманець.",
          "Ryntra не тримає твоїх грошей, не підписує за тебе, не купує сама й не дає персональних інвестиційних порад.",
          "Ryntra не є емітентом жодного токена, який показує, і не ручається за жодного емітента.",
        ],
      ),
    ]),
    section("issuers", "2. What each issuer's token is", "2. Що таке токен кожного емітента", [
      {
        table: {
          caption: bi("The issuers of the tokens in Ryntra, by their own documents", "Емітенти токенів у Ryntra — за їхніми власними документами"),
          head: heads(["Issuer", "What the token is", "Not available to"], ["Емітент", "Що таке токен", "Не доступний для"]),
          rows: {
            en: [
              ["xStocks", "A tracker certificate backed one to one by the share a custodian holds; no vote", "The United States"],
              ["Ondo", "A backed tracker of the share's price and dividends; not itself a share", "The United States"],
              ["Backpack", "A claim that can be exchanged for the share through a Backpack account with KYC; no vote yet", "The United States, the United Kingdom, the UAE, Japan"],
              ["PreStocks", "Economic exposure to a private company — no ownership, vote or dividends; a fee on every transfer; may not be sellable", "The United States"],
            ],
            uk: [
              ["xStocks", "Сертифікат-трекер, забезпечений один до одного акцією в кастодіана; без голосу", "США"],
              ["Ondo", "Забезпечений трекер ціни акції та її дивідендів; сам не є акцією", "США"],
              ["Backpack", "Вимога, яку можна обміняти на акцію через акаунт Backpack із KYC; голосу поки немає", "США, Велика Британія, ОАЕ, Японія"],
              ["PreStocks", "Економічна експозиція на приватну компанію — без власності, голосу й дивідендів; комісія з кожного переказу; може не вийти продати", "США"],
            ],
          },
        },
      },
      p(
        "Each issuer's own documents are the authority and can change; Ryntra has not verified every country's rules for every token.",
        "Джерело правди — власні документи кожного емітента, і вони можуть змінюватися; Ryntra не перевіряла правил кожної країни для кожного токена.",
      ),
    ]),
    section("prices", "3. Prices and references", "3. Ціни й орієнтири", [
      list(
        [
          "A token's price is the market's, read from Jupiter with its time. Outside the exchange's hours the token trades on its own supply and demand.",
          "A reference is the issuer's price per share, or PreStocks' valuation of a private company — each with its time; neither is a fair price.",
          "The Review quotes your sum again before you sign; what you get is at least the minimum it shows, and a price that moved past it asks you to refresh.",
        ],
        [
          "Ціна токена — ринкова, прочитана з Jupiter із часом. Поза годинами біржі токен торгується за власним попитом і пропозицією.",
          "Орієнтир — ціна емітента за акцію чи оцінка приватної компанії від PreStocks — кожен зі своїм часом; жоден із них не є справедливою ціною.",
          "«Перевірка» котирує твою суму знову до підпису; отримаєш щонайменше показаний мінімум, а ціна, що вийшла за нього, попросить оновити.",
        ],
      ),
    ]),
    section("costs", "4. What you pay", "4. Що ти платиш", [
      {
        table: {
          caption: bi("Every cost of a purchase and who receives it", "Кожна витрата купівлі й хто її отримує"),
          head: heads(["Cost", "Who receives it", "Where you see it"], ["Витрата", "Хто отримує", "Де видно"]),
          rows: {
            en: [
              [`Ryntra's service fee, ${FEES.swap}`, `Ryntra; ${REWARDS.cashbackPercent}% comes back to you as cashback`, "All costs, in the Review"],
              ["Network fee", "The Solana network", "All costs, in the Review"],
              ["The issuer's fee", "The issuer of a PreStocks token, at the rate read from the chain", "Its own line under All costs"],
              ["Account reserve", "Your own new token account — yours, not a fee", "Its own line in the Review"],
              ["Price impact and slippage", "The market", "Bounded by the minimum you get"],
            ],
            uk: [
              [`Комісія Ryntra, ${FEES_UK.swap}`, `Ryntra; ${REWARDS.cashbackPercent}% повертається тобі кешбеком`, "«Усі витрати» в «Перевірці»"],
              ["Плата мережі", "Мережа Solana", "«Усі витрати» в «Перевірці»"],
              ["Комісія емітента", "Емітент токена PreStocks, за ставкою з ланцюга", "Окремий рядок під «Усі витрати»"],
              ["Резерв рахунку", "Твій власний новий рахунок токена — твоє, не комісія", "Окремий рядок «Перевірки»"],
              ["Вплив на ціну й прослизання", "Ринок", "Обмежені мінімумом, який ти отримаєш"],
            ],
          },
        },
      },
    ]),
    section("autoinvest", "5. Autoinvest", "5. «Автоінвест»", [
      p(
        "A rule reminds you; it never buys. Each purchase needs a fresh Review and your signature, a reminder you do not sign is never bought later, and the monthly budget and the price condition only hold reminders back. Regular buying does not protect against a falling market.",
        "Правило нагадує; воно ніколи не купує. Кожна купівля потребує свіжої «Перевірки» й твого підпису, непідписане нагадування ніколи не купується пізніше, а бюджет місяця й «Умова ціни» лише стримують нагадування. Регулярні купівлі не захищають від падіння ринку.",
      ),
    ]),
    section("assistant", "6. Ryntra, the AI assistant", "6. Ryntra — ШІ-помічник", [
      p(
        "Ryntra, the AI assistant, is an AI system. It explains and prepares drafts, can be wrong, has no tool to buy, sell or sign, and is not an adviser; the figures on a draft are computed by published rules, and the decision and the signature are yours.",
        "Ryntra — ШІ-помічник — це система штучного інтелекту. Він пояснює й готує чернетки, може помилятися, не має інструмента купити, продати чи підписати і не є радником; цифри в чернетці рахують опубліковані правила, а рішення й підпис — твої.",
      ),
    ]),
    section("private", "7. Private companies", "7. Приватні компанії", [
      p(
        "A PreStocks token is not a share. Selling it may not be possible; a full loss is possible; the issuer can freeze, move or burn it; and a listing or an acquisition can set a deadline to swap it, after which it expires. The price can stand far from PreStocks' own valuation.",
        "Токен PreStocks — не акція. Продати його може не вийти; можлива повна втрата; емітент може його заморозити, перемістити чи спалити; а вихід на біржу чи купівля компанії можуть поставити строк обміну, після якого токен згорить. Ціна може стояти далеко від власної оцінки PreStocks.",
      ),
    ]),
    section("assurance", "8. What has not been done", "8. Чого не зроблено", [
      p(
        "Ryntra has not completed an independent security audit, has no bug bounty and no third-party penetration test. The Service is a beta on Solana Mainnet and moves real money.",
        "Ryntra не проходила незалежного аудиту безпеки, не має програми винагород за вразливості й стороннього тесту на проникнення. Сервіс — бета на Solana Mainnet і рухає справжні гроші.",
      ),
    ]),
  ],
};

export const CANDIDATE_DOCUMENTS: readonly LegalDocument[] = [CANDIDATE_TERMS, CANDIDATE_PRIVACY, CANDIDATE_DISCLOSURES];

/** Every sentence of a document in one language — for the tests that read what the candidate says. */
export function candidateText(document: LegalDocument, locale: "en" | "uk"): string {
  const parts: string[] = [document.title[locale], document.description[locale], document.lead[locale]];
  for (const item of document.sections) {
    parts.push(item.heading[locale]);
    for (const block of item.blocks) {
      if ("p" in block) parts.push(block.p[locale]);
      else if ("list" in block) parts.push(...block.list[locale]);
      else parts.push(block.table.caption[locale], ...block.table.head[locale], ...block.table.rows[locale].flat());
    }
  }
  return parts.join(" ");
}
