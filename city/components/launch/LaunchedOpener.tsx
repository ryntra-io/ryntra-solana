'use client';

import { useEffect } from 'react';
import { openLaunched } from '@/city/lib/launch/launched-store';

/** `/launches` opens on «Launched on Ryntra» (CITY-185): the city paints, and the window opens over it. */
export function LaunchedOpener() {
  useEffect(() => openLaunched(), []);
  return null;
}
