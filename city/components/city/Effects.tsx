'use client';

import { Bloom, ChromaticAberration, EffectComposer, Noise, ShockWave, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { useFrame } from '@react-three/fiber';
import { BlendFunction, ToneMappingMode, type ChromaticAberrationEffect, type ShockWaveEffect } from 'postprocessing';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BUDGET } from '@/city/lib/city/quality';
import { useCity, useCityEvents, type Quality } from '@/city/lib/city/store';
import { flashingOn } from '@/city/lib/feed/motion';
import { onRunEvent, runLive } from '@/city/lib/run/bus';

/**
 * One composer, effects in pulses: bloom carries the night (light is the material), the shockwave and the
 * colour-fringe kick only on impacts, then ACES tone mapping, vignette and a little grain hide banding in the dark.
 * ACES since 28.10: AgX washed the lit windows out to cream and the
 * night to grey; ACES keeps the windows gold and the haze violet. The bloom threshold stays at 0.62: lower, the bloom
 * picks up the facades' window grid and it shimmers in motion (skyline-flicker.mjs, orbit 0.7 % → 8 %).
 * The cheapest tier keeps bloom, tone mapping and vignette, and drops the grain, the fringe and the shockwave.
 * High and Balanced start with SMAA on the scene, so the skyline's thin fins, masts and rails keep clean edges (CITY-56);
 * the grain stays faint, so it never sits on the lights as sand.
 */
export function Effects({ quality }: { quality: Quality }) {
  const shock = useRef<ShockWaveEffect>(null);
  const fringe = useRef<ChromaticAberrationEffect>(null);
  const kick = useRef(0);
  const offset = useRef(new THREE.Vector2(0.0004, 0.0004));
  const layout = useCity((s) => s.layout);

  useCityEvents((event) => {
    // «Flashing effects» off (CITY-66): no shockwave and no colour kick for the city's moments.
    if (!flashingOn()) return;
    if (event.kind === 'pump') {
      kick.current = Math.max(kick.current, 0.35);
      return;
    }
    const t = layout.towers.find((p) => p.tower.id === event.towerId);
    if (t && shock.current) {
      shock.current.position.set(t.x, t.height, t.z);
      shock.current.explode();
    }
    kick.current = 1;
  });

  // The run's impacts: a shockwave where you crashed or broke through, a colour kick on a boost.
  useEffect(
    () =>
      onRunEvent((event) => {
        if (!flashingOn()) return;
        if (event.kind === 'crash' || event.kind === 'break') {
          shock.current?.position.set(runLive.x, runLive.y, runLive.z);
          shock.current?.explode();
          kick.current = 1;
        } else if (event.kind === 'boost' || event.kind === 'shatter' || event.kind === 'save') {
          kick.current = Math.max(kick.current, 0.45);
        }
      }),
    [],
  );

  useFrame((_, dt) => {
    kick.current = Math.max(0, kick.current - dt * 2.2);
    const amount = 0.0004 + kick.current * kick.current * 0.006;
    offset.current.set(amount, amount * 0.6);
    if (fringe.current) fringe.current.offset = offset.current;
  });

  const b = BUDGET[quality];
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {b.smaa ? <SMAA /> : <></>}
      <Bloom
        mipmapBlur
        intensity={b.bloomIntensity}
        luminanceThreshold={0.62}
        luminanceSmoothing={0.28}
        radius={0.78}
        levels={b.bloomLevels}
        resolutionScale={b.bloomScale}
      />
      {b.touches ? <ShockWave ref={shock} speed={1.4} maxRadius={0.55} waveSize={0.18} amplitude={0.32} /> : <></>}
      {b.touches ? <ChromaticAberration ref={fringe} offset={offset.current} radialModulation modulationOffset={0.3} /> : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.72} />
      {b.touches ? <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.12} /> : <></>}
    </EffectComposer>
  );
}
