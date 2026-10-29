import type { WorkspaceLocale } from "@/app/shell/locale";

export const HOME_CATALOG = {
  en: {
    "nav.overview": "Today",
    "nav.radar": "Research",
    "nav.portfolio": "Portfolio",
    "nav.strategy": "Strategies",
    "nav.journal": "Journal",
    "nav.settings": "Settings",
    "nav.brief": "Daily Brief",
    "nav.adviser": "Ryntra",
    "nav.control": "Control",
    "nav.alerts": "Alerts",
    "nav.coverage": "Coverage",
    "nav.operations": "History",
    "nav.lab": "Strategy Lab",
    "nav.decisions": "Decisions",
    "nav.connect": "Connections",
    "nav.access": "Access",
    "chrome.language": "Language",
    "chrome.about": "About this page",
    "visitor.foot": "Reading Ryntra as a visitor. Sign in to keep plans, journal and alerts.",
    "visitor.signin": "Sign in",
    "foot.disclaimer":
      "Non-custodial. No deposits to Ryntra. The simulation uses no real money; live account view is read-only public data. NFA.",
    "foot.terms": "Terms",
    "foot.privacy": "Privacy",
    "appearance.title": "Appearance",
    "appearance.theme": "Theme",
    "appearance.language": "Language",
    "appearance.hint":
      "One preference for every workspace. Risk colours are locked by design and are never restyled by the theme.",
  },
  uk: {
    "nav.overview": "Сьогодні",
    "nav.radar": "Дослідження",
    "nav.portfolio": "Портфель",
    "nav.strategy": "Стратегії",
    "nav.journal": "Журнал",
    "nav.settings": "Налаштування",
    "nav.brief": "Щоденний бриф",
    "nav.adviser": "Ryntra",
    "nav.control": "Контроль",
    "nav.alerts": "Сповіщення",
    "nav.coverage": "Покриття",
    "nav.operations": "Історія",
    "nav.lab": "Лабораторія стратегій",
    "nav.decisions": "Рішення",
    "nav.connect": "Підключення",
    "nav.access": "Доступ",
    "chrome.language": "Мова",
    "chrome.about": "Про цю сторінку",
    "visitor.foot": "Ти читаєш Ryntra як відвідувач. Увійди, щоб зберігати плани, журнал і сповіщення.",
    "visitor.signin": "Увійти",
    "foot.disclaimer":
      "Некастодіально. Без депозитів у Ryntra. Симуляція — без реальних грошей; перегляд реального рахунку — лише читання публічних даних. Не є фінансовою порадою.",
    "foot.terms": "Умови",
    "foot.privacy": "Конфіденційність",
    "appearance.title": "Вигляд",
    "appearance.theme": "Тема",
    "appearance.language": "Мова",
    "appearance.hint":
      "Одне налаштування для всіх робочих просторів. Кольори ризику зафіксовані дизайном — тема їх не змінює.",
  },
} as const satisfies Record<WorkspaceLocale, Record<string, string>>;

export type HomeMessageKey = keyof (typeof HOME_CATALOG)["en"];

export function homeMessage(locale: WorkspaceLocale, key: HomeMessageKey): string {
  return HOME_CATALOG[locale][key] ?? HOME_CATALOG.en[key] ?? key;
}
