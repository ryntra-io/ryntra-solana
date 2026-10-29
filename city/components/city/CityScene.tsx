'use client';

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';
import { BUDGET } from '@/city/lib/city/quality';
import { BAR, SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { useRun } from '@/city/lib/run/store';
import { RunWarmup } from '../run/RunWarmup';
import { RunWorld } from '../run/RunWorld';
import { LookScene } from '../look/LookScene';
import { HarborTowers } from '../districts/HarborTowers';
import { PredictBillboard } from '../districts/PredictBillboard';
import { MyTowers } from '../trade/MyTowers';
import { ScoutFlags } from '../scouts/ScoutFlags';
import { ScoutDrone } from '../agent/ScoutDrone';
import { QuarterScene } from '../quarter/QuarterScene';
import { VaultTower } from '../vault/VaultTower';
import { HallSigns } from '../launch/HallSigns';
import { HoverPick } from '../hud/HoverPick';
import { Selected } from './Selected';
import { BeaconTowers } from '../beacon/BeaconTowers';
import { PALETTE } from '@/city/lib/palette';
import { CameraRig } from './CameraRig';
import { Capturer } from './Capturer';
import { Effects } from './Effects';
import { Embers } from './Embers';
import { Fillers } from './Fillers';
import { Fx } from './Fx';
import { Ground } from './Ground';
import { Rails } from './Rails';
import { Sky } from './Sky';
import { Towers } from './Towers';
import { Traffic } from './Traffic';
import { DevView } from './skyline/DevView';

/** Everything inside the canvas. The world group is what the camera shake moves; the sky stays still. */
export function CityScene() {
  const layout = useCity((s) => s.layout);
  const quality = useCity((s) => s.quality);
  const budget = BUDGET[quality];
  const world = useRef<THREE.Group>(null);
  const running = useRun((s) => s.phase !== 'off');
  const course = useRun((s) => s.course);
  const hidden = running ? course?.hiddenRails : undefined;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    SHARED.uTime.value = t;
    // The heartbeat: a soft amber Slot Pulse from the Sol Spire on every bar, unless an event pulse is still running.
    const since = t - SHARED.uPulseTime.value;
    if (since > BAR && since > 2.4) {
      SHARED.uPulseTime.value = Math.floor(t / BAR) * BAR;
      SHARED.uPulseOrigin.value.set(0, 0);
      SHARED.uPulseStrength.value = 0.32;
      SHARED.uPulseColor.value.set(PALETTE.amber);
    }
  });

  return (
    <>
      <Sky />
      <group ref={world}>
        <Ground />
        <Fillers fillers={layout.fillers} />
        <Towers towers={layout.towers} />
        <Rails rails={layout.rails} hidden={hidden} />
        <Traffic drones={budget.drones} walkers={budget.walkers} />
        <Embers count={budget.embers} />
        <Fx />
        <Selected />
        <MyTowers />
        <ScoutFlags />
        <BeaconTowers />
        <HarborTowers />
        <ScoutDrone />
        <QuarterScene />
        <VaultTower />
        <PredictBillboard />
        <HallSigns />
        <RunWorld />
        {process.env.NODE_ENV !== 'production' && <LookScene />}
      </group>
      <RunWarmup />
      <CameraRig world={world} />
      <HoverPick />
      <Effects quality={quality} />
      <Capturer />
      {process.env.NODE_ENV !== 'production' && <DevView />}
    </>
  );
}
