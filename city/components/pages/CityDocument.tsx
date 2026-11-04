import { readDocsFrame } from '@/city/lib/docs/read.server';
import { LANG_BOOT_SCRIPT } from '@/city/lib/i18n/langs';
import type { PageId } from '@/city/lib/pages/pages';
import { CITY_FONTS } from '@/city/styles/fonts';
import city from '@/city/styles/city.module.css';
import { DocsView } from '../docs/DocsView';
import { DocumentPage } from './DocumentPage';

/**
 * The route entry of a city page at its address (CITY-157): the city's faces and colours, the language boot script,
 * then the page in the documentation's frame (CITY-180). The same root as the city's own routes (`app/(home)/page.tsx`, `app/window/page.tsx`); nothing of
 * the old site's chrome.
 */
export function CityDocument({ id }: { id: PageId }) {
  return (
    <div className={`${city.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      {id === 'docs' ? <DocsView frame={readDocsFrame()} section={null} /> : <DocumentPage id={id} frame={readDocsFrame()} />}
    </div>
  );
}
