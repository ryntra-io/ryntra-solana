/**
 * User notification preferences. Marketing is opt-out after an explicit save.
 * Service/security notices cannot be turned off. Missing rows stay eligible
 * for product updates so existing broadcasts do not silently go to zero.
 */

export const NOTIFICATION_KEYS = [
  "product_updates",
  "beta_access",
  "strategy_receipt_alerts",
  "service_security",
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

export type NotificationPrefs = Record<NotificationKey, boolean>;

export const NOTIFICATION_DEFAULTS: NotificationPrefs = {
  product_updates: true,
  beta_access: true,
  strategy_receipt_alerts: false,
  service_security: true,
};

export type PrefsLang = "en" | "uk" | "ru";

export const NOTIFICATION_COPY: Record<
  PrefsLang,
  { title: string; hint: string; locked: string; labels: Record<NotificationKey, string> }
> = {
  en: {
    title: "<b>Notifications</b>",
    hint: "Product updates can be turned off. Service and security notices cannot.",
    locked: "Service and security notices stay on.",
    labels: {
      product_updates: "Product updates",
      beta_access: "Beta / access",
      strategy_receipt_alerts: "Strategy / receipt alerts",
      service_security: "Service / security",
    },
  },
  uk: {
    title: "<b>Сповіщення</b>",
    hint: "Оновлення продукту можна вимкнути. Сервіс і безпека — ні.",
    locked: "Сервісні й безпекові сповіщення лишаються увімкненими.",
    labels: {
      product_updates: "Оновлення продукту",
      beta_access: "Бета / доступ",
      strategy_receipt_alerts: "Стратегія / квитанції",
      service_security: "Сервіс / безпека",
    },
  },
  ru: {
    title: "<b>Уведомления</b>",
    hint: "Обновления продукта можно выключить. Сервис и безопасность — нет.",
    locked: "Сервисные и безопасные уведомления остаются включёнными.",
    labels: {
      product_updates: "Обновления продукта",
      beta_access: "Бета / доступ",
      strategy_receipt_alerts: "Стратегия / квитанции",
      service_security: "Сервис / безопасность",
    },
  },
};

export function isNotificationKey(value: unknown): value is NotificationKey {
  return typeof value === "string" && (NOTIFICATION_KEYS as readonly string[]).includes(value);
}

export function prefsFromRow(row: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  return {
    product_updates: row?.product_updates ?? NOTIFICATION_DEFAULTS.product_updates,
    beta_access: row?.beta_access ?? NOTIFICATION_DEFAULTS.beta_access,
    strategy_receipt_alerts: row?.strategy_receipt_alerts ?? NOTIFICATION_DEFAULTS.strategy_receipt_alerts,
    service_security: true,
  };
}

export function togglePref(prefs: NotificationPrefs, key: NotificationKey): NotificationPrefs {
  if (key === "service_security") return { ...prefs, service_security: true };
  return { ...prefs, [key]: !prefs[key] };
}

export function eligibleForProductBroadcast(prefs: NotificationPrefs | null | undefined): boolean {
  return prefsFromRow(prefs).product_updates;
}

export function settingsBody(lang: PrefsLang, prefs: NotificationPrefs): string {
  const copy = NOTIFICATION_COPY[lang];
  const lines = [copy.title, "", copy.hint, ""];
  for (const key of NOTIFICATION_KEYS) {
    const mark = key === "service_security" || prefs[key] ? "✅" : "▫️";
    lines.push(`${mark} ${copy.labels[key]}`);
  }
  return lines.join("\n");
}

export function settingsButtons(lang: PrefsLang, prefs: NotificationPrefs): { text: string; callback_data: string }[][] {
  const copy = NOTIFICATION_COPY[lang];
  return NOTIFICATION_KEYS.map((key) => {
    const mark = key === "service_security" ? "🔒" : prefs[key] ? "✅" : "▫️";
    return [{ text: `${mark} ${copy.labels[key]}`, callback_data: `np:${key}` }];
  });
}
