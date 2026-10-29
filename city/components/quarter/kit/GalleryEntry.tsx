'use client';

import dynamic from 'next/dynamic';

// Development builds only: production never ships the gallery.
const Gallery = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('./Gallery').then((m) => m.Gallery), { ssr: false });

export function GalleryEntry() {
  return Gallery ? <Gallery /> : null;
}
