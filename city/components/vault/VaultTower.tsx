'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { playTick } from '@/city/lib/audio/engine';
import { SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useMoments } from '@/city/lib/moments/stage';
import { PALETTE } from '@/city/lib/palette';
import { useQuarter } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { VAULT_OPEN } from '@/city/lib/vault/flag';
import { FACING, GUARD_LOCAL, ISLET_RADIUS, PLINTH_TOP, TOWER, VAULT_SPOT, flightAt, flightMs, roomView, signOnScreen, type Point, type SignScreen, type View } from '@/city/lib/vault/place';
import { guardianOf, useVault, vaultStore } from '@/city/lib/vault/store';
import { enterVault } from '@/city/lib/vault/enter';
import { placeVault, VAULT_TOP } from '@/city/lib/vault/tap';
import { VaultGlyph } from './glyphs';
import { SceneHtml } from '../city/SceneHtml';
import { Guardian } from './Guardian';
import { createArmourMaterial, createCoreMaterial, glow } from './materials';
import v from './vault.module.css';
import { VAULT } from './words';

/** The armoured base the door is cut into, and where the glass of the core starts above it. */
const BASE_H = 4.2;
/** The door: a ring of stored sun around a steel disc, its centre this high. */
const DOOR = { radius: 1.55, y: PLINTH_TOP + 1.85 } as const;
const PILLARS = 8;

/**
 * The Vault in the city, once its flag is open: an armoured octagonal tower on its own islet, a core of stored sun
 * showing between the plates, the door turned to the city and the guard beside it, its name over it. A tap on the
 * tower or its name opens the room — the same room as «Arena → Vault» (CITY-241); the camera flies to the door and
 * gives the city its view back when the room closes. Each attempt sends a pulse of light from the vault across the
 * city; a crack throws a beam into the sky.
 */
export function VaultTower() {
  if (!VAULT_OPEN) return null;
  return <Vault />;
}

function Vault() {
  const phase = useVault((st) => st.phase);
  const [, tick] = useState(0);
  // An answer's "acting" ends by itself: look again once it has played.
  useEffect(() => {
    if (phase.step !== 'answered') return;
    const timer = setTimeout(() => tick((n) => n + 1), 2700);
    return () => clearTimeout(timer);
  }, [phase]);
  const guard = guardianOf(phase, Date.now());
  // The city's tap meets the tower while it stands in the city's view (`city/lib/vault/tap.ts`, asked by `CameraRig`):
  // never while a quarter is built.
  const away = useQuarter((st) => st.mode !== 'city');
  useEffect(() => {
    placeVault(!away);
    return () => placeVault(false);
  }, [away]);

  return (
    <group position={[VAULT_SPOT.x, 0, VAULT_SPOT.z]} rotation-y={FACING}>
      <Tower />
      <group position={[GUARD_LOCAL.side, PLINTH_TOP, GUARD_LOCAL.ahead]}>
        <Guardian state={guard} />
      </group>
      <VaultSign />
      <VaultCamera />
    </group>
  );
}

const HIDDEN = { visibility: 'hidden' } as const;

/**
 * The box at the screen's foot the sign keeps over: the Deck and, while it stands, the first action's banner just over
 * it (on a phone the sign at the edge went under the banner, and a tap on it reached the banner). Read once a change,
 * not every frame.
 */
function useDeckBox(): RefObject<SignScreen['deck']> {
  const box = useRef<SignScreen['deck']>(null);
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    let watched: Element | null = null;
    const read = () => {
      const deck = document.querySelector('[data-city-deck]');
      if (deck !== watched) {
        observer?.disconnect();
        watched = deck;
        if (deck && typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(read);
          observer.observe(deck);
        }
      }
      const r = deck?.getBoundingClientRect();
      const h = document.querySelector('[data-city-hint]')?.getBoundingClientRect();
      const boxes = [r && r.width > 0 && r.height > 0 && deck?.getAttribute('aria-hidden') !== 'true' ? r : null, h && h.width > 0 && h.height > 0 ? h : null].filter((b) => b !== null && b !== undefined);
      box.current = boxes.length ? { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)), top: Math.min(...boxes.map((b) => b.top)) } : null;
    };
    read();
    // The Deck comes with the HUD after the scene: looked for again a few times, and on every resize.
    const timers = [600, 2_000, 6_000].map((ms) => window.setTimeout(read, ms));
    // A Deck that came late or was drawn again, a banner that came or went: found within a second.
    const again = window.setInterval(read, 1_000);
    window.addEventListener('resize', read);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(again);
      window.removeEventListener('resize', read);
      observer?.disconnect();
    };
  }, []);
  return box;
}

/**
 * The vault's name over its tower: one tap opens the room. It steps aside inside the room, during a run or a filming,
 * and while a quarter is built; kept mounted and hidden then, so its own root is never torn down mid-render.
 */
function VaultSign() {
  const w = useWords(VAULT);
  const inside = useVault((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useMoments((st) => st.filming !== null);
  const away = useQuarter((st) => st.mode !== 'city');
  const quiet = inside || running || filming || away;
  // Where the sign stands (CITY-243): over its tower, never under the Deck, and at the screen's edge on the Vault's side
  // while the tower is outside the frame — an arrow on it says which way.
  const deck = useDeckBox();
  const sign = useRef<HTMLButtonElement>(null);
  const place = useMemo(() => {
    const at = new THREE.Vector3();
    return (el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) => {
      at.setFromMatrixPosition(el.matrixWorld).project(camera);
      // Every screen keeps it: a phone's first frame has the Vault outside it, a desk's idle sway carries it past the edge.
      const screen = { width: size.width, height: size.height, deck: deck.current, edge: true };
      const spot = signOnScreen({ x: ((at.x + 1) / 2) * size.width, y: ((1 - at.y) / 2) * size.height }, screen);
      const side = String(spot.side);
      if (sign.current && sign.current.dataset.side !== side) sign.current.dataset.side = side;
      return [spot.x, spot.y];
    };
  }, [deck]);
  return (
    <SceneHtml position={[0, VAULT_TOP + 1.2, 0]} center zIndexRange={[3, 0]} style={quiet ? HIDDEN : undefined} calculatePosition={place}>
      <button
        ref={sign}
        type="button"
        className={v.sign}
        aria-label={w.vault}
        data-vault-sign=""
        tabIndex={quiet ? -1 : undefined}
        onClick={() => {
          if (useCity.getState().sound) playTick();
          enterVault();
        }}
      >
        <span className={v.signPlate}>
          <VaultGlyph />
          {w.vault}
          <span className={v.signArrow} aria-hidden="true" />
        </span>
      </button>
    </SceneHtml>
  );
}

function Tower() {
  const core = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);
  const beam = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const ring = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const sent = useRef(0);
  const amber = useMemo(() => new THREE.Color(PALETTE.amber), []);

  const parts = useMemo(() => {
    const height = TOWER.height - BASE_H;
    // An octagon with a flat face to the front, where the door is cut.
    const octagon = (r: number, h: number, open = false) => new THREE.CylinderGeometry(r, r, h, PILLARS, 1, open, Math.PI / PILLARS);
    const pillar = new THREE.BoxGeometry(0.95, height, 0.8);
    return {
      armour: createArmourMaterial('#2A2834'),
      dark: createArmourMaterial('#16151E', 0.6),
      core: createCoreMaterial(),
      amber: glow(PALETTE.amber, 2.4),
      ringGlow: glow(PALETTE.amber, 2.4),
      warm: glow(PALETTE.warmWhite, 2.2),
      violet: glow(PALETTE.violet, 1.8, { transparent: true, opacity: 0.9 }),
      beam: glow(PALETTE.warmWhite, 2.4, { transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      plinth: new THREE.CylinderGeometry(ISLET_RADIUS, ISLET_RADIUS + 0.5, PLINTH_TOP, 16),
      edge: new THREE.TorusGeometry(ISLET_RADIUS - 0.25, 0.06, 4, 64).rotateX(Math.PI / 2),
      base: octagon(TOWER.radius + 0.35, BASE_H),
      pillar,
      pillarAt: Array.from({ length: PILLARS }, (_, i) => {
        const a = ((i + 0.5) / PILLARS) * Math.PI * 2;
        return { x: Math.sin(a) * TOWER.radius, z: Math.cos(a) * TOWER.radius, a };
      }),
      height,
      crown: octagon(TOWER.radius + 0.45, 1.1),
      cap: new THREE.ConeGeometry(TOWER.radius * 0.8, 2.4, PILLARS, 1, false, Math.PI / PILLARS),
      glass: new THREE.CylinderGeometry(TOWER.core, TOWER.core, height, 20, 1, true),
      door: new THREE.CircleGeometry(DOOR.radius - 0.1, 32),
      doorRing: new THREE.TorusGeometry(DOOR.radius, 0.13, 6, 40),
      lock: new THREE.CircleGeometry(0.32, 20),
      lamp: new THREE.SphereGeometry(0.32, 10, 8),
      beamGeo: new THREE.CylinderGeometry(0.5, 1.4, 120, 16, 1, true).translate(0, 60, 0),
    };
  }, []);
  useEffect(
    () => () => {
      for (const value of Object.values(parts)) if (value && typeof (value as { dispose?: () => void }).dispose === 'function') (value as { dispose: () => void }).dispose();
    },
    [parts],
  );

  useFrame(({ clock }) => {
    const { pulseAt, crackedAt } = vaultStore.getState();
    const now = Date.now();
    // Each attempt: the core flares and a pulse of light runs from the vault across the city.
    if (pulseAt !== sent.current) {
      sent.current = pulseAt;
      SHARED.uPulseTime.value = clock.elapsedTime;
      SHARED.uPulseOrigin.value.set(VAULT_SPOT.x, VAULT_SPOT.z);
      SHARED.uPulseStrength.value = 0.45;
      SHARED.uPulseColor.value.set(PALETTE.amber);
    }
    const heat = Math.max(0, 1 - (now - pulseAt) / 1800);
    const c = core.current;
    if (c) c.material.uniforms.uHeat!.value = heat * 0.9 + 0.08 * Math.sin(clock.elapsedTime * 1.7);
    const b = beam.current;
    if (b) {
      const since = (now - crackedAt) / 1000;
      const on = crackedAt > 0 && since < 6 ? Math.min(1, since * 4) * Math.max(0, 1 - since / 6) : 0;
      b.visible = on > 0.001;
      b.material.opacity = on * 0.55;
    }
    const r = ring.current;
    if (r) r.material.color.copy(amber).multiplyScalar(2.4 + heat * 2.4);
  });

  const { height } = parts;
  return (
    <group>
      <mesh geometry={parts.plinth} material={parts.dark} position={[0, PLINTH_TOP / 2, 0]} />
      <mesh geometry={parts.edge} material={parts.violet} position={[0, PLINTH_TOP + 0.01, 0]} />
      <mesh geometry={parts.base} material={parts.armour} position={[0, PLINTH_TOP + BASE_H / 2, 0]} />
      {parts.pillarAt.map((p) => (
        <mesh key={p.a} geometry={parts.pillar} material={parts.armour} position={[p.x, PLINTH_TOP + BASE_H + height / 2, p.z]} rotation-y={p.a} />
      ))}
      <mesh ref={core} geometry={parts.glass} material={parts.core} position={[0, PLINTH_TOP + BASE_H + height / 2, 0]} />
      <mesh geometry={parts.crown} material={parts.dark} position={[0, PLINTH_TOP + TOWER.height + 0.55, 0]} />
      <mesh geometry={parts.cap} material={parts.armour} position={[0, PLINTH_TOP + TOWER.height + 2.3, 0]} />
      <mesh geometry={parts.lamp} material={parts.amber} position={[0, PLINTH_TOP + TOWER.height + 3.65, 0]} />
      {/* The door, cut into the front face. */}
      <group position={[0, DOOR.y, (TOWER.radius + 0.35) * Math.cos(Math.PI / PILLARS) + 0.03]}>
        <mesh geometry={parts.door} material={parts.dark} />
        <mesh ref={ring} geometry={parts.doorRing} material={parts.ringGlow} />
        <mesh geometry={parts.lock} material={parts.warm} position={[0, 0, 0.02]} />
      </group>
      <mesh ref={beam} geometry={parts.beamGeo} material={parts.beam} position={[0, PLINTH_TOP + TOWER.height, 0]} visible={false} />
    </group>
  );
}

/** The part of the city's camera controls the room borrows. */
type Controls = {
  enabled: boolean;
  getPosition: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  getTarget: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, transition?: boolean) => Promise<void>;
};

const v3 = (v: THREE.Vector3): Point => ({ x: v.x, y: v.y, z: v.z });

/**
 * While the room is open the camera is the room's: it flies from wherever the city's camera was to the door and holds
 * the view there, whatever else the city's director would do, the way my quarter holds it while it builds. When the
 * room closes the city's controls get the camera back where they left it, unless the city has since flown somewhere of
 * its own (a tower picked, a run).
 */
function VaultCamera() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const size = useThree((s) => s.size);
  const open = useVault((st) => st.open);
  const active = useRef(false);
  const fly = useRef<{ from: View; to: View; t0: number; ms: number } | null>(null);
  const hold = useRef<View | null>(null);
  const back = useRef<View | null>(null);
  const look = useRef(new THREE.Vector3());

  useEffect(() => {
    if (open && !active.current) {
      active.current = true;
      const ahead = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(40));
      const from: View = { eye: v3(camera.position), target: v3(controls ? controls.getTarget(new THREE.Vector3(), false) : ahead) };
      back.current = controls ? { eye: v3(controls.getPosition(new THREE.Vector3(), true)), target: v3(controls.getTarget(new THREE.Vector3(), true)) } : from;
      if (controls) controls.enabled = false;
      camera.up.set(0, 1, 0);
      const to = roomView(size.width, size.height);
      fly.current = { from, to, t0: performance.now(), ms: flightMs(from, to) };
      hold.current = to;
      look.current.set(from.target.x, from.target.y, from.target.z);
      useCity.getState().touch();
    }
    if (!open && active.current) {
      active.current = false;
      fly.current = null;
      if (controls) {
        const l = look.current;
        void controls.setLookAt(camera.position.x, camera.position.y, camera.position.z, l.x, l.y, l.z, false);
        const b = back.current;
        if (b && !useCity.getState().selectedId && useRun.getState().phase === 'off') void controls.setLookAt(b.eye.x, b.eye.y, b.eye.z, b.target.x, b.target.y, b.target.z, true);
        controls.enabled = true;
      }
      useCity.getState().touch();
    }
  }, [open, camera, controls, size.width, size.height]);

  // A turned phone: the room frames the vault again for the new shape.
  useEffect(() => {
    if (!active.current) return;
    const to = roomView(size.width, size.height);
    const from: View = { eye: v3(camera.position), target: v3(look.current) };
    fly.current = { from, to, t0: performance.now(), ms: 600 };
    hold.current = to;
  }, [size.width, size.height, camera]);

  useFrame(() => {
    if (!active.current || !hold.current) return;
    // The city's controls stay down for as long as the room holds the camera, whatever else wakes them.
    if (controls?.enabled) controls.enabled = false;
    let pose = hold.current;
    const f = fly.current;
    if (f) {
      const t = (performance.now() - f.t0) / f.ms;
      pose = flightAt(f.from, f.to, t);
      if (t >= 1) fly.current = null;
    }
    camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
    look.current.set(pose.target.x, pose.target.y, pose.target.z);
    camera.lookAt(look.current);
  });
  return null;
}
