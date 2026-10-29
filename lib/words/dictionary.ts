import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * One concept — one word (the UX audit of 21.10, themes T10 and T11; cards
 * UX-973, UX-953, UX-751; task SOL-C17).
 *
 * The audit counted the same thing said three ways on the same screen: «Add
 * funds» in the menu over a «Top up» button, H1 «Between networks» over a card
 * called «Bridge», «History» 36 times beside «Activity» 11 and «Operations» 8.
 * A person looking for the page they were just told about cannot find it. The
 * audit's own §4.6 table proposed the dictionary; this file **is** that table,
 * in code, so a word is decided once and the guard can hold it.
 *
 * Two kinds of rule live here and they are not the same kind of wrong:
 *
 *   - `CONCEPTS` — the word to use and the words that mean the same thing. A
 *     synonym is a navigation defect: nothing untrue is said, the person simply
 *     cannot tell two names are one place.
 *   - `BANNED` — words no surface of Ryntra may carry at all: a promise of income, a verdict of safety, a
 *     price call. Those are honesty and regulatory defects.
 *
 * Both halves carry the same keys in both languages, because a rule that holds
 * in English and not in Ukrainian is how «Заробляй у пулі» survived three waves
 * while «Earn from the pool» was being discussed.
 *
 * What this file does not decide: voice («ти» against «ви», card UX-972) and
 * English left on a Ukrainian page (UX-971). Those are their own cards and
 * their own work; a dictionary that also policed grammar would flag half the
 * product and be switched off.
 */

export type Locale = WorkspaceLocale;

/** A word the product uses, and the words it must not use for the same thing. */
export type Concept = Readonly<{
  /** Stable id — what the thing is, never the word, so renaming a word is one edit. */
  id: string;
  /** What the concept is, for the person reading a guard's report. */
  about: string;
  /** The one word, per language. */
  word: Readonly<Record<Locale, string>>;
  /** What means the same and must not be drawn, per language. */
  instead: Readonly<Record<Locale, readonly string[]>>;
  /** Where the same letters are not the same word — matched before `instead`. */
  keep?: Readonly<Record<Locale, readonly string[]>>;
  /**
   * The audit's card this row is still open under, where reconciling it is
   * another row's work. A staged row is reported and does not fail a run: the
   * word is decided here, the sweep is somebody's task.
   */
  staged?: string;
  /** The synonym is wrong as a label — the whole drawn string — and right inside a sentence. */
  labelOnly?: boolean;
}>;

/** A word no surface may carry, whatever it is talking about. */
export type Banned = Readonly<{
  id: string;
  /** Why it cannot be drawn — quoted in the guard's report. */
  why: string;
  /** The pattern, per language. */
  pattern: Readonly<Record<Locale, RegExp>>;
  /** What to say instead, per language, where one word replaces another. */
  say?: Readonly<Record<Locale, string>>;
  /** The same letters in a term that is allowed — a financial term, a provider's name. */
  keep?: Readonly<Record<Locale, readonly string[]>>;
  /** The whole string, when the word on its own is the product's own name for something. */
  keepWhole?: Readonly<Record<Locale, readonly string[]>>;
  /**
   * The ban is on a promise, so a sentence that denies the promise is the
   * opposite of the defect and passes.
   *
   * «A model, never a guaranteed maximum loss», «Not a guarantee of safety,
   * execution success or profit», «Ryntra has no token promise, no airdrop and
   * no allocation». A
   * guard that reports the honest lines is a guard that gets an `--ignore`.
   */
  deniable?: boolean;
}>;

const both = <T,>(en: T, uk: T) => ({ en, uk }) as const;

/**
 * The dictionary, in the order of the audit's §4.6 table.
 *
 * `instead` holds what the audit found drawn, not every synonym a language has:
 * a guard that invents violations teaches people to pass `--ignore`.
 */
export const CONCEPTS: readonly Concept[] = [
  {
    id: "swap",
    about: "a swap inside one network",
    word: both("Swap", "Обмін"),
    /* «Exchange» is not here, and that is a decision, not an omission. The
       audit's §4.6 table warns against it as a second name for a swap, and the
       product never uses it that way: every «Exchange» drawn names the venue a
       stock is listed on and whether it is open — a different concept with its
       own word. Forbidding the letters would have renamed NASDAQ. */
    instead: both(["Spot Swap"], ["Своп", "своп", "Swap"]),
  },
  {
    id: "bridge",
    about: "moving money between networks",
    word: both("Between networks", "Між мережами"),
    instead: both(["Bridge", "bridge", "cross-chain"], ["Міст", "міст", "кросчейн"]),
    /* The providers that carry it keep their own names, and so does the fee
       Ryntra pays them — «Relay bridge fee» is a counterparty, not a section. */
    keep: both(["Relay", "deBridge", "Mayan", "bridge provider", "bridge fee"], ["Relay", "deBridge", "Mayan"]),
  },
  {
    id: "launch",
    about: "the section that launches tokens, and the action",
    word: both("Launch", "Лаунч"),
    instead: both(["Token creation"], ["Запуск токена", "Створення лаунчу"]),
    /* «Запустити токен» is the action and stays; the section is «Лаунч». */
    keep: both([], ["Запустити токен", "запустити токен", "Кроки запуску", "кроки запуску", "Правила запуску"]),
  },
  {
    id: "add-funds",
    about: "putting money into the account",
    word: both("Add funds", "Поповнити"),
    instead: both(["Top up", "top up", "Deposit"], ["Депозит", "депозит"]),
    /* The Perps account takes collateral, not funds: that action keeps its own
       name on both sides («Add collateral / Внести заставу»), because what it
       risks is different. */
    /* Collateral is its own action with its own risk, and the account rent
       that comes back on close is neither. */
    /* A bank's deposit and a deposit receipt are not this product's «Add
       funds»: «This is not a deposit» is the sentence that stops a person
       reading a liquidity position as savings, and `jlUSDC` is a deposit
       receipt by its own definition. Collateral keeps its own name on both
       sides, because what it risks is different. */
    keep: both(["Add collateral", "Deposit for the account", "Deposit back", "not a deposit", "Deposit receipts", "a deposit on this account", "pause after a deposit", "Deposits and withdrawals", "Perps deposit"], ["Внести заставу", "Застава за рахунок", "Повернення застави", "не депозит"]),
  },
  {
    id: "perps",
    about: "perpetual futures on Phoenix",
    word: both("Perps", "Perps"),
    instead: both([], ["Перпи", "перпи"]),
    keep: both(["perpetual"], ["безстрокові", "безстроковий"]),
  },
  {
    id: "alerts",
    about: "the rules that write to a person",
    word: both("Alerts", "Сповіщення"),
    instead: both(["Monitoring"], ["Нагляд", "Нагляду", "Нагляді", "Наглядом", "моніторинг", "алерти"]),
    /* Watching one asset is an action, not the section. */
    keep: both(["Watch"], ["Стежити", "стежити"]),
  },
  {
    id: "account",
    about: "the person's account",
    word: both("Account", "Акаунт"),
    instead: both(["Profile"], ["Обліковий запис", "Кабінет", "Профіль"]),
    /* Phoenix's own account, and the one a market makes, are the venue's word. */
    /* The creator's own place is not the person's account: «Кабінет творця»
       is the section at `/app/launch/mine` and «Профіль творця» the public page
       of whoever launched a token. Phoenix's account, and the rent-bearing
       token account, are the venue's and the chain's own words. */
    keep: both(["Phoenix account", "account state", "Account state", "account value", "Account value", "Creator profile", "Creator cabinet"], ["рахунок", "Рахунок", "рахунку", "Стан рахунку", "Профіль творця", "Кабінет творця"]),
  },
  {
    id: "review",
    about: "the check before a signature",
    word: both("Review", "Перевірка"),
    instead: both([], ["Review", "Ревʼю"]),
  },
  {
    id: "portfolio",
    about: "what a person holds",
    word: both("Portfolio", "Портфель"),
    instead: both(["Holdings", "My assets"], ["Активи портфеля", "Мої активи"]),
    /* Inside the page the block of what is held is «Assets / Активи». */
    keep: both(["Assets"], ["Активи"]),
  },
  {
    id: "history",
    about: "what has happened",
    word: both("History", "Історія"),
    instead: both(["Activity", "Operations"], ["Активність", "Операції"]),
    /* A count is a figure, not a section: «confirmed and pending operations»
       reads as language, and «Операцій: 12» is a number's unit. */
    keep: both(["operations sent", "Operations sent", "pending operations", "operations, their"], ["Операцій", "операцій"]),
  },
  {
    id: "assistant",
    about: "the assistant",
    word: both("Ryntra assistant", "Помічник Ryntra"),
    instead: both(["AI assistant", "Ryntra AI"], ["ШІ-помічник", "AI-помічник", "ШІ помічник"]),
  },
  {
    id: "connect-wallet",
    about: "connecting a wallet",
    word: both("Connect wallet", "Підключити гаманець"),
    instead: both(["Connect a wallet", "Link wallet"], ["Під'єднати гаманець", "Приєднати гаманець"]),
    /**
     * A label, not a sentence.
     *
     * The defect the audit counted is four forms of one *control* («Підключити
     * гаманець» 22, «Під'єднати» 6, «Підключи» 5, «Підключіть» 3). The product
     * also speaks in sentences — «Connect a wallet to see your pool positions»,
     * «Connect a wallet — your assets and positions will be here» — and the
     * audit's own microcopy for UX-953 writes them that way (pair 10). A rule
     * that renamed those would be arguing with the audit, and the first live
     * run reported three of them, so the rule reads the whole drawn string:
     * what a button says, never what a paragraph says.
     */
    labelOnly: true,
    keep: both([], ["Підключи гаманець", "Підключіть гаманець, щоб"]),
  },
  {
    id: "points",
    about: "the points a rank is read from",
    /**
     * One programme, one word (UX-751, following Ріст 19).
     *
     * The audit's §4.6 table proposed «Бали» for Ukrainian. Ріст 19 then
     * shipped the one programme a person can see — the rank: «Очки не мають грошової вартості». The screen a person reads is the
     * truth the landing and the documentation follow, not the other way round,
     * so the word is «очки» and the audit's proposal loses to the shipped
     * programme. That is the whole of UX-751 for line A.
     */
    word: both("points", "очки"),
    instead: both(["PTS", "pts", "Ryntra Points", "Points program", "Points programme"], ["Бали", "бали", "балів", "бала", "БАЛІВ", "поінти", "Програма балів"]),
  },
  {
    id: "simulation",
    about: "trading without real money",
    word: both("Simulation", "Симуляція"),
    instead: both(["Paper trading", "Paper-", "PAPER TRADING"], ["Paper", "paper", "Паперова торгівля"]),
  },
  {
    id: "loaded",
    about: "whether the figures arrived",
    word: both("Loaded", "Завантажено"),
    instead: both(["Reading", "was read", "were read"], ["прочитано", "Прочитано", "прочиталися", "прочитати", "Читаємо"]),
    /**
     * Staged, with its reason (card UX-975, P3).
     *
     * This is the one row of the §4.6 table this task does not sweep, and the
     * arithmetic is why: the audit counted 275 Ukrainian and 276 English
     * strings, and they sit on `/app/launch/*`, `/app/spot`, Головна, Портфель
     * and the receipts — routes the registry gives to SOL-C4, SOL-C5, SOL-C7,
     * SOL-C9 and SOL-C13, not to «решти маршрутів» this row owns. They are also
     * not one word: «Не вдалося прочитати ринок» is a loading failure and
     * becomes «Не вдалося завантажити», while «кожну позначку прочитано з
     * ланцюга» is the Evidence Kernel saying where a fact came from and becomes
     * «оновлено», not «завантажено». Five hundred sentences rewritten by one
     * regular expression is how a product starts lying in a new way.
     *
     * So the word is decided here and the guard names every place it is still
     * the old one; the sweep is its own row of the registry.
     */
    staged: "UX-975",
  },
  {
    id: "margin-state",
    about: "the state of a leveraged account",
    word: both("Account state", "Стан рахунку"),
    instead: both([], []),
  },
  {
    id: "mint-open",
    about: "whether more of a token can be minted",
    word: both("Can mint more", "Можна випустити ще"),
    instead: both(["Mint open"], ["Випуск відкритий"]),
  },
] as const;

/**
 * Words that may not be drawn anywhere.
 *
 * Each pattern is as narrow as the ban allows, and `keep` carries the financial
 * terms that share its letters. That is not softening the ban: «Take profit» is
 * the name of an order type a person sets, «Чистий прибуток» is a line in a
 * receipt, and a guard that painted them red would be turned off within a week —
 * which is exactly how the old scan ended up checking nine words nobody writes.
 *
 * Two bans of §12 are not patterns and are not here: a price forecast and
 * investment advice. Those are judgements of a sentence's meaning, and a
 * regular expression that claimed to find them would report the honest lines
 * («ціна може впасти до нуля») and miss the dishonest ones.
 */
export const BANNED: readonly Banned[] = [
  {
    id: "earn",
    why: "Growth rules §12: «заробляй» — a call to income; B-01 and B-10 of the audit",
    /**
     * The ban is on telling a person to go and get income, not on the word's
     * letters. §12 forbids «заробляй»; the audit's own §4.6 matrix lists
     * «Заробіток» — the noun, the menu's group — under «Норма (не дефект)».
     *
     * So this reads the imperative and the invitation: «Заробляй у пулі»,
     * «Earn from the pool», «Trade, earn, and grow with Ryntra».
     */
    pattern: both(/(?:^|[,;:—–]\s*)earn\b|\bearn\s+(?:from|up to|more)\b/i, /заробля(?:й|йте|єш|тимеш)|зароби(?:ш|те)\b/i),
    say: both("A share of the fee", "Частка комісії"),
    /* «Earn» on its own is the core's lending section (decision 47) — the
       product's own name for a place, not an instruction. */
    keepWhole: both(["Earn"], ["Earn"]),
    /* A tab's title is «〈Page〉 · Ryntra» (D-09), so the lending section's own
       name arrives as «Earn · Ryntra» — not the whole string, and not an
       instruction either. The live guard reported it on `/app/earn`. */
    keep: both(["Earn supplies", "Earn actions", "Earn tiles", "Earn ·"], ["Дії Earn", "Earn віддає", "Earn ·"]),
  },
  {
    id: "passive-income",
    why: "Growth rules §12: «пасивний дохід»",
    pattern: both(/\bpassive income\b/i, /пасивн(?:ий|ого|им) дохід/i),
    deniable: true,
  },
  {
    id: "guaranteed",
    why: "Growth rules §12: «гарантовано»",
    pattern: both(/\bguarantee(?:d|s)?\b/i, /гарантован|гарантуємо|гарантія доход/i),
    deniable: true,
  },
  {
    id: "safe",
    why: "the product rules §2 and audit UX-953: «safe» as a verdict on money",
    /**
     * «Ризик: Безпечно» beside a leveraged account was the defect — a verdict.
     * A sentence that says something is *not* safe, and the name of the
     * «Безпека» section, are not: the first is the warning, the second is a
     * place. So the pattern reads the verdict's own shape — the word as a
     * status, after a colon, or as the whole of a label.
     */
    pattern: both(/(?::|·)\s*safe\b|\b(?:is|are|it'?s|completely|totally|100%)\s+safe\b|^safe$/i, /(?::|·)\s*безпечн|\b(?:це|повністю|цілком)\s+безпечн|^безпечно$/i),
    say: both("Account state: healthy", "Стан рахунку: здоровий"),
    deniable: true,
  },
  {
    id: "risk-free",
    why: "Growth rules §12: «без ризику»",
    pattern: both(/\brisk[- ]free\b/i, /без ризику/i),
    deniable: true,
  },
  {
    id: "get-rich",
    why: "Growth rules §12: «розбагатій»",
    pattern: both(/\bget rich\b/i, /розбагаті[а-яїієґ]*/i),
  },
  {
    id: "free-shares",
    why: "Growth rules §12: «безкоштовні акції»",
    pattern: both(/\bfree (?:shares|stocks)\b/i, /безкоштовн[а-яїієґ]* акці/i),
    deniable: true,
  },
  {
    id: "real-shares",
    why: "Growth rules §12: «справжні акції» — a token is not a share",
    pattern: both(/\breal (?:shares|stocks|equity)\b/i, /справжн[а-яїієґ]* акці/i),
    say: both("Tokenized stocks are not shares", "Токенізовані акції — не акції"),
    deniable: true,
  },
  {
    id: "first-only",
    why: "Growth rules §12: «перші / єдині» — a claim about the market",
    pattern: both(/\bfirst[- ]ever\b|\bthe only (?:platform|product|app|place|exchange)\b|\bno competitors\b/i, /перші у світі|перша у світі|єдин(?:ий|а|е) (?:у світі|на ринку)|немає конкурент/i),
  },
  {
    id: "official-partner",
    why: "Growth rules §12: «офіційний партнер»",
    pattern: both(/\bofficial (?:partner|partnership)\b/i, /офіційн(?:ий|е|а) партнер/i),
    deniable: true,
  },
  {
    id: "points-convert",
    why: "Growth rules §12: «бали конвертуються» — points have no cash value",
    pattern: both(/\bpoints (?:convert|can be converted|are converted)\b/i, /(?:бали|очки) конвертуються|(?:бали|очки) можна обміняти/i),
    say: both("Points have no cash value", "Очки не мають грошової вартості"),
    deniable: true,
  },
  {
    id: "token-soon",
    why: "Growth rules §12: «токен / аірдроп скоро»",
    pattern: both(/\bairdrop\b|\btoken (?:is )?coming soon\b/i, /аірдроп|ейрдроп|токен (?:буде|скоро)/i),
    deniable: true,
  },
  {
    id: "ryn",
    why: "the product rules §17: the assistant is «Ryntra»; «Ryn» is not a persona a person meets",
    pattern: both(/\bRyn\b(?!tra)/, /\bРин\b/),
    say: both("Ryntra assistant", "Помічник Ryntra"),
  },
  {
    id: "signal",
    why: "the product rules §15.4 and §17.19: a «signal» reads as advice to trade",
    pattern: both(/\bsignals?\b/i, /сигнал[а-яїієґ]*/i),
    say: both("Model theses (not advice)", "Тези моделі (не порада)"),
    deniable: true,
  },
  {
    id: "profit-if",
    why: "audit UX-953: «профіт» as a promise beside a bet",
    pattern: both(/\bprofit if\b/i, /прибуток, якщо/i),
    say: both("Gain if right", "Виграш, якщо маєш рацію"),
  },
] as const;

/**
 * Does this line deny the claim its word would make?
 *
 * Only asked of a ban marked `deniable`, and only of the claim words — a
 * promise refused is the product being honest. It is deliberately shallow: one
 * negation anywhere in the sentence is enough, because a sentence that both
 * denies and promises is a sentence a person has to read twice, and that is a
 * microcopy card of its own.
 */
export function deniesClaim(line: string, locale: Locale): boolean {
  /* Ukrainian gets lookarounds, not `\b`: JavaScript defines a word boundary on
     ASCII word characters, so `\bне\b` never matches at all — the same trap
     `termPattern` documents, and the reason the first run of this guard
     reported «ніколи не гарантована максимальна втрата» as a promise. */
  return locale === "uk"
    ? /(?<![\p{L}\p{N}])(?:не|ні|ніколи|немає|без|жодн\p{L}*|нічого|нікому)(?![\p{L}\p{N}])/iu.test(line)
    : /\b(?:no|not|never|nothing|none|without|cannot|can't|isn't|aren't|doesn't)\b/i.test(line);
}

/** One finding: what was drawn, where, and what the rule says. */
export type Finding = Readonly<{
  kind: "banned" | "synonym";
  id: string;
  /** The exact text that matched. */
  term: string;
  /** The word to use instead, where the rule names one. */
  say: string | null;
  /** Why, in one line. */
  why: string;
  /** The line it was drawn on, trimmed. */
  line: string;
  /** The audit card this row waits on, where another task owns the sweep. */
  staged: string | null;
}>;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A synonym matches as a word, not as a run of letters: «Deposit» must not
 * catch «Deposits and withdrawals are not open», and «міст» must not catch
 * «містить». A Latin term gets `\b`; a Cyrillic one gets its own edges, because
 * `\b` in JavaScript is defined on ASCII word characters and treats every
 * Cyrillic letter as a boundary — the single reason a naive guard reports
 * «Очки» inside «Очкування».
 */
export function termPattern(term: string): RegExp {
  const body = escape(term);
  const head = /^[A-Za-z0-9]/.test(term) ? "\\b" : "(?<![\\p{L}\\p{N}])";
  const tail = /[A-Za-z0-9]$/.test(term) ? "\\b" : "(?![\\p{L}\\p{N}])";
  return new RegExp(`${head}${body}${tail}`, "u");
}

/** Blank the places where a term is allowed, so the rule reads only the rest. */
function blankKept(line: string, kept: readonly string[]): string {
  let out = line;
  for (const phrase of kept) {
    const pattern = new RegExp(escape(phrase), "giu");
    out = out.replace(pattern, (match) => " ".repeat(match.length));
  }
  return out;
}

/**
 * Scan one line of text a person can read.
 *
 * Order matters: the allowed phrases are blanked first, then the bans, then the
 * synonyms. A line is reported once per rule, never once per occurrence — three
 * «Top up» in a paragraph are one thing to fix.
 */
export function scanLine(line: string, locale: Locale): readonly Finding[] {
  const findings: Finding[] = [];
  const trimmed = line.trim();
  if (!trimmed) return findings;
  for (const rule of BANNED) {
    if ((rule.keepWhole?.[locale] ?? []).includes(trimmed)) continue;
    if (rule.deniable && deniesClaim(trimmed, locale)) continue;
    const text = blankKept(trimmed, rule.keep?.[locale] ?? []);
    const hit = rule.pattern[locale].exec(text);
    if (hit) findings.push({ kind: "banned", id: rule.id, term: hit[0], say: rule.say?.[locale] ?? null, why: rule.why, line: trimmed, staged: null });
  }
  for (const concept of CONCEPTS) {
    const text = blankKept(trimmed, concept.keep?.[locale] ?? []);
    for (const term of concept.instead[locale]) {
      if (concept.labelOnly && text !== term) continue;
      const hit = termPattern(term).exec(text);
      if (!hit) continue;
      findings.push({
        kind: "synonym",
        id: concept.id,
        term: hit[0],
        say: concept.word[locale],
        why: `one concept — one word: ${concept.about}`,
        line: trimmed,
        staged: concept.staged ?? null,
      });
      break;
    }
  }
  return findings;
}

/**
 * Which language a line is written in, by its letters: Cyrillic is Ukrainian.
 *
 * A page carries both — a provider's name and a ticker inside a Ukrainian
 * sentence, an English sentence left on a Ukrainian page — so the guard reads
 * each line in its own language rather than the page's. Taking the page's
 * language instead would read «no» in an English rule against Ukrainian text,
 * and would hold an English sentence on a Ukrainian page to Ukrainian rules.
 */
export function lineLocale(line: string): Locale {
  return /[Ѐ-ӿ]/.test(line) ? "uk" : "en";
}

