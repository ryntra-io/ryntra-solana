import Link from "next/link";

import type { SectionTabs } from "./domains";

/**
 * A section's pages, one tap apart, at the top of each of them — one
 * component everywhere: Торгувати — Спот · Обмін; Лаунч —
 * Запустити токен · Мої лаунчі; Боти — Мої боти · Каталог; Портфель —
 * Позиції · Історія; Гроші — Поповнити · Надіслати · Отримати · Між мережами.
 * The shell draws it from the registry (`sectionTabs`), so a page never draws
 * its own and two sections never draw theirs differently.
 */
export function SectionTabsBar({ tabs }: { tabs: SectionTabs }) {
  return (
    <nav className="rs-tabs" aria-label={tabs.title} data-section={tabs.section}>
      <div className="rs-tabs-list">
        {tabs.tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className="rs-tab"
            data-tab={tab.id}
            aria-current={tabs.current === tab.href ? "page" : undefined}
            prefetch={false}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
