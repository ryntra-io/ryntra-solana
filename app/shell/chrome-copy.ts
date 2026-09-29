import type { ShellChromeCopy } from "./shell-copy";
import type { WorkspaceLocale } from "./locale";

/**
 * Chrome copy the shell renders out of its own body.
 *
 * One hub already threads its own catalog through `chrome`. Home and Agent Control pass
 * the same shape from here so Layout, Theme and Simple/Pro never sit in English
 * on a Ukrainian cabinet.
 */

export const SHELL_CHROME_COPY: Readonly<Record<WorkspaceLocale, ShellChromeCopy>> = {
  en: {
    contextToggle: "Context",
    menu: "Menu",
    theme: {
      dark: "Dark",
      light: "Light",
      darkShort: "Dark",
      lightShort: "Light",
      announce: "Theme: {current}. Switch to {next}",
    },
    layout: {
      trigger: "Layout",
      triggerTitle: "Customize layout",
      depth: "Depth",
      depthGroup: "Workspace depth",
      simple: "Simple",
      simpleBody: "The essential modules only. Surfaces inside them stay folded away.",
      pro: "Pro",
      proBody: "Every surface in the rail, and the panels can be hidden and reordered.",
      density: "Density",
      densityGroup: "Workspace density",
      comfortable: "Comfortable",
      comfortableBody: "Roomier panels and 44px table rows.",
      compact: "Compact",
      compactBody: "Tighter padding and 32px table rows.",
      panelsFixed: "Panels · fixed in Simple",
      panelsEditable: "Panels · show, hide and reorder",
      empty: "This workspace has no configurable panels. Nothing here is hidden from you.",
      alwaysOn: "Always on",
      advanced: "Advanced",
      moveUp: "Move {panel} up",
      moveDown: "Move {panel} down",
      savedLocally: "Saved in this browser only.",
      resetLayout: "Reset layout",
      resetAsk: "Reset this workspace to its default layout?",
      resetGo: "Reset",
      resetCancel: "Cancel",
    },
    switcher: { title: "Workspaces", all: "Current capabilities" },
  },
  uk: {
    contextToggle: "Контекст",
    menu: "Меню",
    theme: {
      dark: "Темна",
      light: "Світла",
      darkShort: "Темна",
      lightShort: "Світла",
      announce: "Тема: {current}. Перемкнути на {next}",
    },
    layout: {
      trigger: "Макет",
      triggerTitle: "Налаштувати макет",
      depth: "Глибина",
      depthGroup: "Глибина робочого простору",
      simple: "Простий",
      simpleBody: "Лише основні модулі. Поверхні всередині них лишаються згорнутими.",
      pro: "Профі",
      proBody: "Усі поверхні в рейці; панелі можна ховати й переставляти.",
      density: "Щільність",
      densityGroup: "Щільність робочого простору",
      comfortable: "Зручна",
      comfortableBody: "Більше повітря в панелях і рядки таблиці 44px.",
      compact: "Компактна",
      compactBody: "Тісніші відступи і рядки таблиці 32px.",
      panelsFixed: "Панелі · фіксовані в Простому",
      panelsEditable: "Панелі · показ, приховування і порядок",
      empty: "У цьому робочому просторі немає панелей, які можна налаштувати. Нічого від вас не сховано.",
      alwaysOn: "Завжди",
      advanced: "Розширені",
      moveUp: "Пересунути {panel} вгору",
      moveDown: "Пересунути {panel} вниз",
      savedLocally: "Збережено лише в цьому браузері.",
      resetLayout: "Скинути макет",
      resetAsk: "Скинути цей робочий простір до типового макета?",
      resetGo: "Скинути",
      resetCancel: "Скасувати",
    },
    switcher: { title: "Робочі простори", all: "Поточні можливості" },
  },
};

export const SHELL_STRINGS: Readonly<
  Record<WorkspaceLocale, { skip: string; brandHome: string; navLabel: string; navOpen: string; navClose: string; navExpand: string; navCollapse: string }>
> = {
  en: {
    skip: "Skip to content",
    brandHome: "Ryntra",
    navLabel: "Workspace",
    navOpen: "Open navigation",
    navClose: "Close navigation",
    navExpand: "Expand navigation",
    navCollapse: "Collapse navigation",
  },
  uk: {
    skip: "Перейти до змісту",
    brandHome: "Ryntra",
    navLabel: "Робочий простір",
    navOpen: "Відкрити навігацію",
    navClose: "Закрити навігацію",
    navExpand: "Розгорнути навігацію",
    navCollapse: "Згорнути навігацію",
  },
};

/**
 * The same chrome, for the surfaces that are Ryntra itself.
 *
 * `SHELL_STRINGS` names the navigation `Workspace` / `Робочий простір`, which
 * is accurate on another hub, Stellar, Robinhood and the cabinet — they are workspaces
 * — and is exactly the word the owner decision of 2026-09-04 removed from the
 * product. A screen reader on the six-domain rail announced "Робочий простір
 * navigation" on every page of a product that has no workspaces in it.
 *
 * Only the label changes, and only for the product's own shells. The retired
 * word keeps its place where it still describes something true.
 */
export const PRODUCT_SHELL_STRINGS: typeof SHELL_STRINGS = {
  en: { ...SHELL_STRINGS.en, navLabel: "Ryntra navigation" },
  uk: { ...SHELL_STRINGS.uk, navLabel: "Навігація Ryntra" },
};
