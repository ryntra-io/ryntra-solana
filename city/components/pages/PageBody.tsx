'use client';

import type { PageId } from '@/city/lib/pages/pages';
import { ConnectorBody } from './ConnectorBody';
import { HelpBody } from './HelpBody';
import { AboutBody, DevelopersBody, DocsBody } from './InfoBodies';
import { LegalBody } from './LegalBody';

/** One page's contents, the same in a window of the city and on the page at its address (CITY-157). */
export default function PageBody({ id }: { id: PageId }) {
  switch (id) {
    case 'docs':
      return <DocsBody />;
    case 'developers':
      return <DevelopersBody />;
    case 'connector':
      return <ConnectorBody />;
    case 'help':
      return <HelpBody />;
    case 'about':
      return <AboutBody />;
    case 'terms':
    case 'privacy':
      return <LegalBody id={id} />;
  }
}
