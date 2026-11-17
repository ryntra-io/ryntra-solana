'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { cityFonts } from '@/city/lib/moments/draw';
import { countdown, phaseAt, shieldLeft, usePool, type PoolListed } from '@/city/lib/launch/pool';
import { PALETTE } from '@/city/lib/palette';

/**
 * A launch into a pool, in the city: over its tower the countdown to its opening — the one number a person
 * needs of it — and around it the shield: a veil of light that stands whole while a purchase pays half, and thins as
 * the fee against snipers falls with the price, until it is gone. No word and no other figure: the tower's window says
 * what they are.
 */

/** Towers that carry a beacon at most: the docks hold no more launches into a pool than this. */
const MAX = 6;
const TEX = { w: 512, h: 208 } as const;
const VIOLET = new THREE.Color(PALETTE.violet);
const AMBER = new THREE.Color(PALETTE.amber);

export function PoolBeacons() {
  const layout = useCity((st) => st.layout);
  const launches = usePool((st) => st.launches);
  const placed = useMemo(() => {
    const byMint = new Map(launches.map((launch) => [launch.mint, launch]));
    return layout.towers.flatMap((tower) => (byMint.has(tower.tower.id) ? [{ tower, launch: byMint.get(tower.tower.id)! }] : [])).slice(0, MAX);
  }, [layout, launches]);
  if (!placed.length) return null;
  return (
    <>
      {placed.map(({ tower, launch }) => (
        <Beacon key={launch.mint} tower={tower} launch={launch} />
      ))}
    </>
  );
}

function Beacon({ tower, launch }: { tower: PlacedTower; launch: PoolListed }) {
  const parts = useMemo(() => {
    /* The veil: an open cylinder standing on the ground, its light fading to nothing at the top. */
    const shell = new THREE.CylinderGeometry(1, 1, 1, 48, 6, true);
    shell.translate(0, 0.5, 0);
    const position = shell.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      const fade = (1 - position.getY(i)) ** 1.6 * 0.7;
      colors.set([fade, fade, fade], i * 3);
    }
    shell.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const veil = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    const canvas = document.createElement('canvas');
    canvas.width = TEX.w;
    canvas.height = TEX.h;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false });
    return { shell, veil, canvas, texture, sign };
  }, []);
  useEffect(
    () => () => {
      parts.shell.dispose();
      parts.veil.dispose();
      parts.texture.dispose();
      parts.sign.dispose();
    },
    [parts],
  );
  const fonts = useRef<string>('system-ui, sans-serif');
  useEffect(() => {
    let live = true;
    void cityFonts().then((loaded) => {
      if (live) fonts.current = loaded.display;
    });
    return () => {
      live = false;
    };
  }, []);

  const sprite = useRef<THREE.Sprite>(null);
  const drawn = useRef('');
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const now = Math.floor(Date.now() / 1000);
    const phase = phaseAt(launch, now);
    const view = usePool.getState().views[launch.mint];
    /* The shield: whole until the pool is read, then what is left of the fee between where it started and where it settles. */
    const left = phase === 'BUILDING' ? 0 : view ? (shieldLeft(view.fee) ?? 1) : phase === 'COUNTDOWN' ? 1 : 0;
    const breath = 0.8 + 0.2 * Math.sin(clock.elapsedTime * 0.7 + (tower.seed % 97));
    parts.veil.color.copy(tint.copy(VIOLET).lerp(AMBER, 1 - left)).multiplyScalar(left * breath);
    parts.veil.visible = left > 0.02;
    /* The countdown is drawn again only when its text changes: once a second. */
    const text = phase === 'COUNTDOWN' ? countdown(launch.opensAt - now) : '';
    if (text !== drawn.current) {
      drawn.current = text;
      const ctx = parts.canvas.getContext('2d')!;
      ctx.clearRect(0, 0, TEX.w, TEX.h);
      if (text) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${text.length > 5 ? 112 : 148}px ${fonts.current}`;
        ctx.shadowColor = 'rgba(255, 178, 63, 0.55)';
        ctx.shadowBlur = 26;
        ctx.fillStyle = PALETTE.warmWhite;
        ctx.fillText(text, TEX.w / 2, TEX.h / 2 + 6);
      }
      parts.texture.needsUpdate = true;
    }
    if (sprite.current) sprite.current.visible = text !== '';
  });

  const reach = Math.max(tower.width * 1.9, 3.4);
  return (
    <group position={[tower.x, 0, tower.z]}>
      <mesh geometry={parts.shell} material={parts.veil} scale={[tower.width * 1.12, Math.max(1, tower.height * 0.9), tower.width * 1.12]} frustumCulled={false} renderOrder={2} />
      <sprite ref={sprite} material={parts.sign} position={[0, tower.height + reach * 0.42, 0]} scale={[reach, reach * (TEX.h / TEX.w), 1]} renderOrder={3} />
    </group>
  );
}
