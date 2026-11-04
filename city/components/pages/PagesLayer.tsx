'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { PAGE_IDS, type PageId } from '@/city/lib/pages/pages';
import { usePages } from '@/city/lib/pages/store';
import { useRun } from '@/city/lib/run/store';
import { useCityWindow } from '../window/useCityWindow';
import { PAGE_GLYPHS } from './glyphs';
import { WhereProvider } from './parts';
import s from './pages.module.css';
import { PAGES } from './words';

// The pages' contents load the first time one opens: the city's first frame carries none of them.
const PageBody = dynamic(() => import('./PageBody'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

/** Where each page first stands on a computer: the documents read wide, the doors stand narrow. */
const SIZE: Readonly<Record<PageId, { width: number; height: number }>> = {
  docs: { width: 480, height: 640 },
  developers: { width: 480, height: 660 },
  connector: { width: 480, height: 680 },
  help: { width: 460, height: 640 },
  about: { width: 460, height: 640 },
  terms: { width: 600, height: 680 },
  privacy: { width: 600, height: 680 },
};

/**
 * The city's pages as windows in the one frame (CITY-157, CITY-65): Docs, Developers, AI chats (CITY-170), Help,
 * About, the Terms and the Privacy Policy, opened from the menu (☰) and from one another, over the live city — never a tab of the old site.
 * On a phone each one is the bottom sheet. Escape closes the front one, as the city's other windows do.
 */
export function PagesLayer() {
  const open = usePages((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const hidden = running || filming;

  useEffect(() => {
    if (!open.length || hidden) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const last = usePages.getState().open.at(-1);
      if (!last) return;
      event.preventDefault();
      usePages.getState().close(last);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open.length, hidden]);

  return (
    <>
      {PAGE_IDS.map((id) => (
        <PageWindow key={id} id={id} shown={open.includes(id) && !hidden} />
      ))}
    </>
  );
}

function PageWindow({ id, shown }: { id: PageId; shown: boolean }) {
  const title = useWords(PAGES)[id];
  const spec = useMemo(() => {
    const Glyph = PAGE_GLYPHS[id];
    return {
      id: `page-${id}`,
      title,
      icon: <Glyph />,
      render: () => (
        <WhereProvider where="window">
          <PageBody id={id} />
        </WhereProvider>
      ),
      size: SIZE[id],
      min: { width: 340, height: 420 },
      onClose: () => usePages.getState().close(id),
    };
  }, [id, title]);
  useCityWindow(shown, spec);
  return null;
}
