/**
 * The security boundary, as facts rather than prose.
 *
 * One value in here matters more than the rest: `independentAudit`. It is
 * `null`, and `null` has to be the only thing it can be until an audit report
 * exists that someone can read. Every product that has ever written
 * "enterprise-grade security" on a page did it by letting a claim live in copy
 * where no test could see it — so the claim lives here, the page renders it,
 * and `security.test.mjs` fails the build if the page starts describing itself
 * in vocabulary this object does not support.
 *
 * `asOf` is the date the boundary below was last checked against the code, not
 * the date the file was edited. It appears on the page, because a security
 * statement without an observation date is a statement about no particular
 * moment.
 */

export type Assurance = Readonly<{
  /** A completed independent audit, or `null`. Never "in progress". */
  independentAudit: null;
  /** A funded, staffed bug bounty, or `null`. */
  bugBounty: null;
  /** A monitored `security@` inbox, or `null` — see `SECURITY_REPORT_SUBJECT`. */
  dedicatedInbox: null;
  /** A completed third-party penetration test, or `null`. */
  penetrationTest: null;
}>;

export const SECURITY_ASSURANCE: Assurance = {
  independentAudit: null,
  bugBounty: null,
  dedicatedInbox: null,
  penetrationTest: null,
};

/**
 * The date the boundary was last checked against the code it describes —
 * 2026-09-26, the day the page was rewritten for the current product: a
 * purchase from $1 through the Review and the person's signature, «Автоінвест»
 * rules that only remind, the wallet's own USDC payments read to count a
 * rule's sum and never moved, Ryntra the AI assistant with no tool that buys
 * or signs. The 2026-09-14 check had found the venue trading key, the agent
 * mandate and the testnet lifecycle gone.
 */
export const SECURITY_AS_OF = "2026-09-26";

/**
 * The sentence that renders when `independentAudit` is `null`.
 *
 * Fixed wording, never to be replaced with vague enterprise-grade security.
 * Keeping it as a constant means a copy edit cannot soften it without failing
 * a test.
 */
export const NO_AUDIT_STATEMENT = "Ryntra has not completed an independent security audit.";

/** The same sentence in Ukrainian, pinned the same way. */
export const NO_AUDIT_STATEMENT_UK = "Ryntra не проходила незалежного аудиту безпеки.";

export const SECURITY_REPORT_SUBJECT = "Security Report";

/**
 * Words a security page may not use about itself.
 *
 * Each one asserts a level of assurance that only an artifact can establish.
 * They are not banned because they are marketing; they are banned because no
 * evidence in this repository supports any of them.
 */
export const FORBIDDEN_ASSURANCE_WORDS: readonly string[] = [
  "enterprise-grade",
  "bank-grade",
  "military-grade",
  "battle-tested",
  "unhackable",
  "fully secure",
  "completely secure",
  "guaranteed secure",
  "zero risk",
  "hardened by default",
];

export type BoundaryKind = "cannot" | "can";

export type Boundary = Readonly<{
  kind: BoundaryKind;
  /** One line. A reviewer reads these before anything else on the page. */
  text: string;
  /** The same line in Ukrainian. */
  uk: string;
}>;

/**
 * What Ryntra can and cannot touch, in the order a reviewer asks it.
 *
 * `cannot` first, deliberately. A product is credible in proportion to what
 * it has made itself unable to do, and a page that opens with capabilities
 * is answering a question nobody security-minded asked first.
 */
export const BOUNDARIES: readonly Boundary[] = [
  {
    kind: "cannot",
    text: "Hold your money. There is no deposit address, no pooled balance and no withdrawal path, because no part of Ryntra could hold one.",
    uk: "Тримати твої гроші. Немає адреси для поповнення, спільного балансу чи шляху виведення — жодна частина Ryntra не могла б їх тримати.",
  },
  {
    kind: "cannot",
    text: "Receive a seed phrase, a private key or a wallet password. No screen asks for one, and no support conversation ever will.",
    uk: "Отримати сід-фразу, приватний ключ чи пароль гаманця. Жоден екран їх не просить, і жодна розмова з підтримкою не попросить.",
  },
  {
    kind: "cannot",
    text: "Sign or send for you. Every transaction is signed by your own wallet, once, for the exact bytes you reviewed.",
    uk: "Підписати чи надіслати за тебе. Кожну транзакцію підписує твій гаманець — один раз і рівно ті байти, що були в «Перевірці».",
  },
  {
    kind: "cannot",
    text: "Keep a standing permission. Ryntra holds no token approval, delegate, session key or exchange key that could move an asset later — and an Autoinvest rule is not a permission either.",
    uk: "Тримати постійний дозвіл. У Ryntra немає схвалення токена, делегата, ключа сесії чи ключа біржі, що могли б рухати актив пізніше, — і правило «Автоінвесту» теж не дозвіл.",
  },
  {
    kind: "cannot",
    text: "Change a transaction after the Review. The bytes your wallet signs are the bytes you reviewed; if the market moves past them, the purchase stops and asks again.",
    uk: "Змінити транзакцію після «Перевірки». Гаманець підписує рівно перевірені байти; якщо ринок вийшов за них, купівля зупиняється й питає знову.",
  },
  {
    kind: "can",
    text: "Read public chain data and what a connected wallet shows: balances, token accounts, the wallet's own payments and the operations Ryntra made for it.",
    uk: "Читати публічні дані ланцюга й те, що показує під'єднаний гаманець: баланси, рахунки токенів, власні оплати гаманця й операції, які Ryntra для нього зробила.",
  },
  {
    kind: "can",
    text: "Prepare an exact transaction, simulate it against the live network, and show the result in the Review for you to sign or leave.",
    uk: "Підготувати точну транзакцію, симулювати її в живій мережі й показати результат у «Перевірці» — підписати чи ні вирішуєш ти.",
  },
  {
    kind: "can",
    text: "Remind you when a rule you set falls due, and keep what you reviewed beside what the network did, as a receipt.",
    uk: "Нагадати, коли настає час твого правила, і зберегти перевірене поруч із тим, що зробила мережа, як квитанцію.",
  },
];
