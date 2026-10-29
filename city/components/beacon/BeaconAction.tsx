'use client';

import { useBeacons } from '@/city/lib/beacon/store';
import { BEACONS } from '@/city/lib/beacon/switch';
import type { Tower } from '@/city/lib/market/types';
import { BeaconGlyph } from './glyphs';
import s from './beacon.module.css';

/** The tower card's beacon: one quiet button in its head that opens the editor; it glows while this tower's beacon is lit. */
export function BeaconAction({ tower }: { tower: Tower }) {
  return BEACONS === 'closed' ? null : <BeaconButton tower={tower} />;
}

function BeaconButton({ tower }: { tower: Tower }) {
  const glow = useBeacons((st) => st.glow.get(tower.id) ?? null);
  const open = useBeacons((st) => st.open);
  return (
    <button className={`${s.action} ${glow === 'lit' ? s.actionLit : glow === 'set' ? s.actionSet : ''}`} onClick={() => open(tower.id)} aria-label="Beacon">
      <BeaconGlyph />
      <span className={s.actionWord}>Beacon</span>
    </button>
  );
}
