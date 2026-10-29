'use client';

import dynamic from 'next/dynamic';

// Development builds only: production never ships the stand.
const BridgeStand = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('./BridgeStand').then((m) => m.BridgeStand), { ssr: false });

export function BridgeStandEntry() {
  return BridgeStand ? <BridgeStand /> : null;
}
