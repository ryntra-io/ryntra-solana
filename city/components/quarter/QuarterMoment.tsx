'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { slotCentre, type Lot } from '@/city/lib/quarter/plot';
import { quarterStore } from '@/city/lib/quarter/store';
import { setMomentSubjects } from '@/city/lib/trade/moment';
import { fxBurst } from '../city/Fx';
import { TERRACE_TOP } from './Arrivals';
import { heightOf } from './QuarterBuilding';

/**
 * A trade made from my quarter is filmed where the camera already is: this tells the trade's moment where the
 * building carrying the coin stands across the frame and throws its fireworks from its roof. Nothing while the
 * quarter is not on screen, or for a coin no building of it carries.
 */
export function QuarterMoment({ lot }: { lot: Lot | null }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!lot) return;
    const v = new THREE.Vector3();
    setMomentSubjects((mint) => {
      const { mode, me } = quarterStore.getState();
      if (mode === 'city' || !me) return null;
      const building = me.buildings.find((b) => b.link?.kind === 'mint' && b.link.mint === mint);
      if (!building) return null;
      const c = slotCentre(lot, building.slot);
      const top = TERRACE_TOP + heightOf(building.kind, building.level, building.modules);
      return {
        focus: () => {
          v.set(c.x, top * 0.5, c.z).project(camera);
          return v.z > 1 || !Number.isFinite(v.x) ? null : (v.x + 1) / 2;
        },
        burst: (colour) => fxBurst(new THREE.Vector3(c.x, top + 1, c.z), 'pump', new THREE.Color(colour).multiplyScalar(3.2)),
      };
    });
    return () => setMomentSubjects(null);
  }, [lot, camera]);
  return null;
}
