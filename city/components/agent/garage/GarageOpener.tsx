'use client';

import { useEffect } from 'react';
import { GARAGE_OPEN } from '@/city/lib/agent/garage/flag';
import { openGarage } from '@/city/lib/agent/garage/show';
import { useGarage } from '@/city/lib/agent/garage/store';
import { quarterStore } from '@/city/lib/quarter/store';
import type { Building } from '@/city/lib/quarter/types';

export { GARAGE_OPEN };

/**
 * In place of the garage's sheet (`BuildHud`): a tap on the garage opens the agent's window instead, and the plot is let
 * go when the window closes, so the next tap opens it again.
 */
export function GarageOpener({ building }: { building: Building }) {
  useEffect(() => {
    openGarage();
    return useGarage.subscribe((st, before) => {
      if (before.open && !st.open && !st.away && quarterStore.getState().slot === building.slot) quarterStore.getState().pick(null);
    });
  }, [building.slot]);
  return null;
}
