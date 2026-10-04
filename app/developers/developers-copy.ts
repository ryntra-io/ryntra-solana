import { SOLANA_EVIDENCE_REPOSITORY_URL } from "../../lib/site/contacts.ts";

/**
 * «Відкритий код» — the words of `/developers`, English and Ukrainian together:
 * one page about the public repository, out of the index.
 *
 * It describes the one public repository as that repository's own README
 * states it — what is open, how to run it, what it does not claim — and
 * nothing the repository does not hold: no hosted API, no key, no published
 * package (`FORBIDDEN_DEVELOPER_CLAIMS`).
 */

export type DevelopersLocale = "en" | "uk";

type Pair = Readonly<{ title: string; body: string }>;

export type DevelopersCopy = Readonly<{
  meta: Readonly<{ title: string; description: string }>;
  hero: Readonly<{ eyebrow: string; title: string; lead: string; open: string }>;
  open: Readonly<{ eyebrow: string; title: string; lead: string; tiles: readonly Pair[] }>;
  run: Readonly<{ eyebrow: string; title: string; lead: string; after: string }>;
  limits: Readonly<{ eyebrow: string; title: string; items: readonly string[] }>;
  more: Readonly<{ title: string; links: readonly Readonly<{ href: string; label: string; external?: boolean }>[] }>;
}>;

export const REPOSITORY_NAME = "ryntra-io/ryntra-solana-evidence";

export const RUN_COMMANDS = [
  `git clone ${SOLANA_EVIDENCE_REPOSITORY_URL}.git`,
  "cd ryntra-solana-evidence",
  "npm ci",
  "npm run verify",
].join("\n");

export const DEVELOPERS_COPY: Readonly<Record<DevelopersLocale, DevelopersCopy>> = {
  en: {
    meta: {
      title: "Open source — Ryntra",
      description: `The public repository ${REPOSITORY_NAME}: what is open, how to run it, and what it does not claim.`,
    },
    hero: {
      eyebrow: "Open source",
      title: "The parts of Ryntra anyone can run and check.",
      lead: `${REPOSITORY_NAME} holds read-only Solana tooling, the models behind a tokenized stock and a trading plan, and the public record of what shipped — Apache-2.0.`,
      open: "Open on GitHub",
    },
    open: {
      eyebrow: "What is open",
      title: "What the repository holds",
      lead: "The same code the product runs on, imported rather than copied and tested without a network — and the record of what shipped.",
      tiles: [
        { title: "Mint inspection", body: "A token's identity, authorities and Token-2022 extensions, read from the chain with where each fact came from." },
        { title: "Transfer preflight", body: "The fees and limits a mint puts on a transfer, checked against a policy you write — before anything is signed." },
        { title: "Receipt verification", body: "A receipt checked offline: its schema, its integrity, the issuer's signature and its Solana binding, each on its own." },
        { title: "Tokenized-stock model", body: "The instrument's class, units and rights, a mint's transfer fee, the issuer's lifecycle and scaled-unit arithmetic." },
        { title: "Trading-plan helpers", body: "Position sizing that shows its assumptions, and decimal input read exactly as it was typed." },
        { title: "Build log", body: "What shipped in the product and when, newest first, with screenshots of the live app." },
      ],
    },
    run: {
      eyebrow: "Run it",
      title: "Run it yourself",
      lead: "Node.js 24 and npm. The offline checks need no wallet and no key.",
      after: "The last command runs the lint, the type check, every package's tests and the boundary checks — the same command the repository's own CI runs.",
    },
    limits: {
      eyebrow: "Limits",
      title: "What it does not claim",
      items: [
        "No keys, no signing, no building or sending a transaction — the kit only reads accounts.",
        "A preflight is a calculation, not a simulation and not a promise that a transfer goes through.",
        "A verified receipt proves the file you supplied, not that its transaction settled.",
        "It is not the app: the application, its infrastructure and its live flows stay private.",
        "Distributed as source — there is no npm package and no hosted service.",
        "Open to read is not audited: Ryntra has not completed an independent security audit.",
      ],
    },
    more: {
      title: "Read more",
      links: [
        { href: SOLANA_EVIDENCE_REPOSITORY_URL, label: "The repository on GitHub", external: true },
        { href: `${SOLANA_EVIDENCE_REPOSITORY_URL}/blob/main/BUILDLOG.md`, label: "Build log", external: true },
        { href: "/security", label: "Security" },
        { href: "/company", label: "About Ryntra" },
      ],
    },
  },
  uk: {
    meta: {
      title: "Відкритий код — Ryntra",
      description: `Публічний репозиторій ${REPOSITORY_NAME}: що відкрито, як запустити і чого він не стверджує.`,
    },
    hero: {
      eyebrow: "Відкритий код",
      title: "Те з Ryntra, що кожен може запустити й перевірити.",
      lead: `У ${REPOSITORY_NAME} — інструменти Solana лише для читання, моделі токенізованої акції й торгового плану і публічний журнал того, що вийшло, — під ліцензією Apache-2.0.`,
      open: "Відкрити на GitHub",
    },
    open: {
      eyebrow: "Що відкрито",
      title: "Що є в репозиторії",
      lead: "Той самий код, на якому працює продукт, — імпортований, а не скопійований, і з тестами без мережі, — а ще запис того, що вийшло.",
      tiles: [
        { title: "Перевірка мінта", body: "Хто випустив токен, які в нього повноваження й розширення Token-2022 — прочитано з ланцюга, з джерелом кожного факту." },
        { title: "Перевірка переказу", body: "Комісії й обмеження, які мінт накладає на переказ, звірені з політикою, яку пишеш ти, — ще до будь-якого підпису." },
        { title: "Перевірка квитанції", body: "Квитанція, перевірена офлайн: схема, цілісність, підпис видавця й прив'язка до Solana — кожне окремо." },
        { title: "Модель токенізованої акції", body: "Клас інструмента, одиниці й права, комісія мінта на переказ, життєвий цикл емітента й арифметика масштабованих одиниць." },
        { title: "Помічники торгового плану", body: "Розмір позиції, що показує свої припущення, і десяткові числа, прочитані рівно як набрані." },
        { title: "Журнал релізів", body: "Що вийшло в продукті й коли, найновіше зверху, зі знімками живого застосунку." },
      ],
    },
    run: {
      eyebrow: "Запуск",
      title: "Запусти сам",
      lead: "Node.js 24 і npm. Офлайн-перевіркам не потрібні ні гаманець, ні ключ.",
      after: "Остання команда запускає лінтер, перевірку типів, тести кожного пакета й перевірки меж — ту саму команду, що й CI самого репозиторію.",
    },
    limits: {
      eyebrow: "Межі",
      title: "Чого він не стверджує",
      items: [
        "Жодних ключів, підписів, складання чи надсилання транзакцій — набір лише читає рахунки.",
        "Попередня перевірка — розрахунок, а не симуляція й не обіцянка, що переказ пройде.",
        "Перевірена квитанція доводить лише наданий файл, а не те, що її транзакція відбулася.",
        "Це не застосунок: сам застосунок, його інфраструктура й живі процеси лишаються приватними.",
        "Поширюється кодом — пакета в npm і хостингового сервісу немає.",
        "Відкритий код — не аудит: Ryntra не проходила незалежного аудиту безпеки.",
      ],
    },
    more: {
      title: "Читати далі",
      links: [
        { href: SOLANA_EVIDENCE_REPOSITORY_URL, label: "Репозиторій на GitHub", external: true },
        { href: `${SOLANA_EVIDENCE_REPOSITORY_URL}/blob/main/BUILDLOG.md`, label: "Журнал релізів", external: true },
        { href: "/security", label: "Безпека" },
        { href: "/company", label: "Про Ryntra" },
      ],
    },
  },
};

export function developersCopy(locale: DevelopersLocale): DevelopersCopy {
  return DEVELOPERS_COPY[locale];
}
