import { SITE_DOC_PATHS, pagePath, type PageId } from '../pages/pages.ts';
import { docPath, type Localized } from './model.ts';
import { DOC_GROUPS, DOC_NAMES, GROUP_WORDS, NAV_LAYOUT, PAGE_NAMES, type DocGroup, type NavRef } from './sections.ts';
import { sectionSoon, type DocsStatus } from './status.ts';

/**
 * The documentation's one menu, in a language (CITY-180): the sections and the pages that stand in the same frame — Developers, AI
 * chats, Help, the legal documents — by group, with each section's «Soon». No section's words here: the city's window reads it too.
 */
export type NavItem = Readonly<{ key: string; href: string; title: string; line: string; soon: boolean }>;
export type NavGroup = Readonly<{ id: DocGroup; title: string; items: readonly NavItem[] }>;

/** A page's key in the menu: Help the page and «Questions and answers» the section share a name, not a row. */
export const pageKey = (id: PageId): string => `page:${id}`;

function itemOf(ref: NavRef, lang: 'en' | 'uk', status: DocsStatus): NavItem {
  if (typeof ref === 'string') return { key: ref, href: docPath(ref), ...DOC_NAMES[lang][ref], soon: sectionSoon(ref, status) };
  if ('page' in ref) return { key: pageKey(ref.page), href: pagePath(ref.page), ...PAGE_NAMES[lang][ref.page], soon: false };
  return { key: 'partner-page', href: SITE_DOC_PATHS.partners, ...PAGE_NAMES[lang].partnerPage, soon: false };
}

export function navOf(lang: 'en' | 'uk', status: DocsStatus): readonly NavGroup[] {
  return DOC_GROUPS.map((id) => ({ id, title: GROUP_WORDS[lang][id], items: NAV_LAYOUT[id].map((ref) => itemOf(ref, lang, status)) }));
}

export type LocalizedNav = Localized<readonly NavGroup[]>;
