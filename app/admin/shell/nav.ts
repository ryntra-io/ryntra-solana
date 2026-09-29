export type AdminNavId =
  | "overview"
  | "users"
  | "feedback"
  | "broadcasts"
  | "analytics"
  | "seo"
  | "operations"
  | "audit"
  | "settings"
  | "academy";

export type AdminNavItem = {
  id: AdminNavId;
  label: string;
  href: string;
  group: "overview" | "people" | "communications" | "insights" | "system" | "internal";
  later?: boolean;
};

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { id: "overview", label: "Огляд", href: "/admin", group: "overview" },
  { id: "users", label: "Користувачі та доступ", href: "/admin/users", group: "people" },
  { id: "feedback", label: "Відгуки", href: "/admin/feedback", group: "people" },
  { id: "broadcasts", label: "Розсилки", href: "/admin/broadcasts", group: "communications" },
  { id: "analytics", label: "Аналітика", href: "/admin/analytics", group: "insights" },
  { id: "seo", label: "SEO і ріст", href: "/admin/seo", group: "insights" },
  { id: "operations", label: "Операції", href: "/admin/operations", group: "system" },
  { id: "audit", label: "Журнал аудиту", href: "/admin/audit", group: "system" },
  { id: "settings", label: "Налаштування", href: "/admin/settings", group: "system" },
  { id: "academy", label: "Академія", href: "/admin/academy", group: "internal" },
];

export const ADMIN_NAV_GROUPS: readonly { id: AdminNavItem["group"]; label: string }[] = [
  { id: "overview", label: "Огляд" },
  { id: "people", label: "Люди" },
  { id: "communications", label: "Комунікації" },
  { id: "insights", label: "Інсайти" },
  { id: "system", label: "Система" },
  { id: "internal", label: "Внутрішнє" },
];
