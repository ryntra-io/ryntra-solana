import { sayIn, type DocsFacts } from './facts.ts';
import { EN } from './content/en.ts';
import { UK } from './content/uk.ts';
import { DOC_IDS, sectionHeadings, type DocId, type DocSection, type Heading, type Localized } from './model.ts';
import { navOf, type LocalizedNav } from './nav.ts';
import { DOC_GROUPS, DOC_NAMES, GROUP_WORDS, NAV_LAYOUT, PAGE_NAMES } from './sections.ts';
import { pagePath, SITE_DOC_PATHS } from '../pages/pages.ts';
import { sectionSoon, type DocsStatus } from './status.ts';

/**
 * The documentation put together (CITY-180): each section's words with this build's facts and status. Pure: the server calls
 * it once at build time, and the tests call it with any facts and status they want to hold it to.
 */

const WORDS = { en: EN, uk: UK } as const;

export function buildSection(id: DocId, lang: 'en' | 'uk', facts: DocsFacts, status: DocsStatus): DocSection {
  const name = DOC_NAMES[lang][id];
  const words = WORDS[lang][id]({ f: facts, s: status, say: sayIn(lang) });
  return { id, title: name.title, lead: words.lead, summary: name.line, soon: sectionSoon(id, status), parts: words.parts, related: words.related, action: words.action };
}

export function indexOf(lang: 'en' | 'uk', facts: DocsFacts, status: DocsStatus): readonly Heading[] {
  const pages = DOC_GROUPS.flatMap((group) =>
    NAV_LAYOUT[group].flatMap((ref): Heading[] => {
      if (typeof ref === 'string') return [];
      const name = 'page' in ref ? PAGE_NAMES[lang][ref.page] : PAGE_NAMES[lang].partnerPage;
      const href = 'page' in ref ? pagePath(ref.page) : SITE_DOC_PATHS.partners;
      return [{ href, sectionTitle: GROUP_WORDS[lang][group], title: name.title, anchor: null }];
    }),
  );
  return [...DOC_IDS.flatMap((id) => sectionHeadings(buildSection(id, lang, facts, status))), ...pages];
}

/** What every page of the documentation reads: the table of contents and the search's headings, in both languages. */
export type DocsFrame = Readonly<{ nav: LocalizedNav; index: Localized<readonly Heading[]> }>;

export function docsFrame(facts: DocsFacts, status: DocsStatus): DocsFrame {
  return {
    nav: { en: navOf('en', status), uk: navOf('uk', status) },
    index: { en: indexOf('en', facts, status), uk: indexOf('uk', facts, status) },
  };
}
