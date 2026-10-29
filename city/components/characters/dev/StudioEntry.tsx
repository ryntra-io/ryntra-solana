'use client';

import dynamic from 'next/dynamic';

// Development builds only: production never ships the studio.
const Studio = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('./Studio').then((m) => m.Studio), { ssr: false });

export function StudioEntry() {
  return Studio ? <Studio /> : null;
}
