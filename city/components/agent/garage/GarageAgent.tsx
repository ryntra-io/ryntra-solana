'use client';

import { useMemo } from 'react';
import { GARAGE_OPEN } from '@/city/lib/agent/garage/flag';
import { useGarage } from '@/city/lib/agent/garage/store';
import { PLOT, slotCentre, type Lot } from '@/city/lib/quarter/plot';
import { useQuarter } from '@/city/lib/quarter/store';
import { Guardian } from '../../characters/Guardian';
import { TERRACE_TOP } from '../../quarter/afar';
import { useBody } from './useBody';

/** The agent's height in the quarter, in world units: a figure beside its garage, not a giant over it. */
const HEIGHT = 1.1;
/** Where it stands: at its garage's door, on the front edge of the plot, a little to the side. */
const AHEAD = PLOT / 2 - 0.18;
const SIDE = 0.42;

/**
 * The agent of the garage (CITY-29) on your lot, while you are in your quarter: the characters line's robot (CITY-57,
 * `public/city/characters/guardian/`) at the front of the first garage, facing the street. Its body shows only what
 * really happens — it greets when its window opens, thinks while Ryntra is asked, acts while it shows towers, nods
 * when an answer came; otherwise it stands ready. Off duty, it is not there. Seen from afar in the city's view it is
 * not drawn at all: there it would be a speck.
 */
export function GarageAgent({ lot }: { lot: Lot }) {
  if (!GARAGE_OPEN) return null;
  return <Agent lot={lot} />;
}

function Agent({ lot }: { lot: Lot }) {
  const mode = useQuarter((st) => st.mode);
  const buildings = useQuarter((st) => st.me?.buildings);
  const opened = useGarage((st) => st.opened);
  const open = useGarage((st) => st.open);
  const body = useBody();

  const garage = useMemo(() => (buildings ?? []).filter((b) => b.kind === 'garage').sort((a, b) => a.slot - b.slot)[0] ?? null, [buildings]);
  // A greeting each time the window opens, while it is open.
  const reaction = useMemo(() => (open && opened > 0 ? { kind: 'greet' as const, key: opened } : null), [open, opened]);
  if (!garage || body === null || mode === 'city') return null;

  const c = slotCentre(lot, garage.slot);
  const f = lot.facing;
  return <Guardian position={[c.x + SIDE * f, TERRACE_TOP, c.z + AHEAD * f]} heading={f === 1 ? 0 : Math.PI} height={HEIGHT} state={body} reaction={reaction} seed={7} />;
}
