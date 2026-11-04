import type { DocsFrame } from '@/city/lib/docs/book';
import type { DocSection, Localized } from '@/city/lib/docs/model';
import { LANG_BOOT_SCRIPT } from '@/city/lib/i18n/langs';
import { CITY_FONTS } from '@/city/styles/fonts';
import city from '@/city/styles/city.module.css';
import { DocsView } from './DocsView';

/**
 * The route entry of the documentation (CITY-180): the city's faces and colours, the language boot script, then the hub or a
 * section. The server paints English with every word in the page; the person's language follows at once.
 */
export function DocsDocument({ frame, section }: { frame: DocsFrame; section: Localized<DocSection> | null }) {
  return (
    <div className={`${city.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <DocsView frame={frame} section={section} />
    </div>
  );
}
