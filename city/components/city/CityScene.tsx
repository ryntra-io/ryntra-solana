'use client';

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';
import { BAR, SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { RunWarmup } from '../run/RunWarmup';
import { RunWorld } from '../run/RunWorld';
import { LookScene } from '../look/LookScene';
import { HarborTowers } from '../districts/HarborTowers';
import { MyTowers } from '../trade/MyTowers';
import { ScoutFlags } from '../scouts/ScoutFlags';
import { NetworkStreets } from '../partners/NetworkStreets';
import { ScoutDrone } from '../agent/ScoutDrone';
import { BotDrones } from '../bots/BotDrones';
import { QuarterScene } from '../quarter/QuarterScene';
import { VaultTower } from '../vault/VaultTower';
import { HallSigns } from '../launch/HallSigns';
import { NightSpot } from '../launch/NightSpot';
import { LaunchCrowns } from '../launch/LaunchCrowns';
import { LaunchHalos } from '../launch/LaunchHalos';
import { HoverPick } from '../hud/HoverPick';
import { Selected } from './Selected';
import { BeaconTowers } from '../beacon/BeaconTowers';
import { AgentTowerTag } from '../autopilot/AgentTowerTag';
import { AgentWalker } from '../autopilot/AgentWalker';
import { LensCamera, LensRings } from '../lens/LensScene';
import { PALETTE } from '@/city/lib/palette';
import { CameraRig } from './CameraRig';
import { Capturer } from './Capturer';
import { Effects } from './Effects';
import { Fillers } from './Fillers';
import { Fx } from './Fx';
import { Ground } from './Ground';
import { Sky } from './Sky';
import { Towers } from './Towers';
import { DevView } from './skyline/DevView';

/** Everything inside the canvas. The world group is what the camera shake moves; the sky stays still. */
export function CityScene() {
  const layout = useCity((s) => s.layout);
  const quality = useCity((s) => s.quality);
  const world = useRef<THREE.Group>(null);

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
        <LensRings />
        <Fx />
        <Selected />
        <MyTowers />
        <ScoutFlags />
        <NetworkStreets />
        <BeaconTowers />
        <AgentTowerTag />
        <AgentWalker />
        <HarborTowers />
        <ScoutDrone />
        <BotDrones />
        <QuarterScene />
        <VaultTower />
        <HallSigns />
        <NightSpot />
        <LaunchCrowns />
        <LaunchHalos />
        <RunWorld />
        {process.env.NODE_ENV !== 'production' && <LookScene />}
      </group>
      <RunWarmup />
      <CameraRig world={world} />
      {/* After the director: on a redrawn city the lens frames its towers again once the director has flown home. */}
      <LensCamera />
      <HoverPick />
      <Effects quality={quality} />
      <Capturer />
      {process.env.NODE_ENV !== 'production' && <DevView />}
    </>
  );
}
