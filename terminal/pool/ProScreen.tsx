'use client';

import { EarnDesk } from '@/terminal/earn/EarnScreen';
import { Page } from '@/terminal/ui';

/**
 * Meteora DLMM Pro, every pool of it on Solana, read from the program, deepest first; a tap opens the pool's
 * own desk. It is «Earn» on its DLMM Pro tab: the same desk, the same head and tabs, the same places —
 * the list on the left as wide as the desk, the chosen pool's ticket on the right (`terminal/earn/ProList.tsx`).
 */
export function ProScreen() {
  return (
    <Page kind="desk" data-dlmm-list="">
      <EarnDesk />
    </Page>
  );
}
