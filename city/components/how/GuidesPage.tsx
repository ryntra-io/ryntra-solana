'use client';

import type { Lesson } from '@/city/lib/how/guides';
import { DocumentShell } from '../pages/DocumentPage';
import { Guides } from './Guides';

/**
 * `/how-it-works` (CITY-43): the same lessons as the window in the city, as a page of its own for a link, in the shell
 * of the city's pages (CITY-157): the mark, the language and the way back on top, the pages at the foot. Each «Try»
 * leads into the city with `?try=<id>`, which opens that function's window there.
 */
export function GuidesPage({ items }: { items: readonly Lesson[] }) {
  return (
    <DocumentShell doc="how-it-works">
      <Guides where="page" items={items} />
    </DocumentShell>
  );
}
