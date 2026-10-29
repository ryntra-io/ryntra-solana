'use client';

import { useId, type CSSProperties } from 'react';
import { BODIES, GROUND, type AgentBodyProps, type Silhouette } from '@/city/lib/ring/body';
import r from './ring.module.css';

/**
 * An agent's body as a stand-in until the characters line brings the real ones (CITY-57): a robot of separate dark
 * plates with a visor of light for a face, one silhouette per archetype (`city/lib/ring/body.ts`). This is the point
 * where the characters plug in — the same `<AgentBody archetype state />`, the same four states.
 */
export function AgentBody({ archetype, state = 'ready', size = 160, dim = false }: AgentBodyProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const body = BODIES[archetype];
  const s = body.shape;
  const lit = !dim;
  const visorFill = lit ? `url(#v${id})` : '#4A4758';
  return (
    <svg
      className={[r.body, r[`body_${state}`], dim && r.bodyDim].filter(Boolean).join(' ')}
      viewBox="0 0 120 160"
      width={(size * 3) / 4}
      height={size}
      role="img"
      aria-label={`${body.name} body`}
    >
      <defs>
        <linearGradient id={`p${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4D4A5E" />
          <stop offset="1" stopColor="#23222D" />
        </linearGradient>
        <linearGradient id={`v${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFB23F" />
          <stop offset="0.5" stopColor="#FFE7C2" />
          <stop offset="1" stopColor="#FFB23F" />
        </linearGradient>
        <filter id={`g${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <ellipse cx="60" cy={GROUND + 1} rx={s.shoulders.w * 0.55} ry="3.5" fill="#000" opacity="0.45" />
      <g className={r.breathe}>
        <Behind s={s} plate={`url(#p${id})`} />
        <Legs s={s} plate={`url(#p${id})`} />
        <Torso s={s} plate={`url(#p${id})`} core={lit} glow={`url(#g${id})`} />
        <Arm s={s} side={-1} plate={`url(#p${id})`} />
        <Arm s={s} side={1} plate={`url(#p${id})`} raise />
        <Head s={s} plate={`url(#p${id})`} visor={visorFill} glow={lit ? `url(#g${id})` : null} />
      </g>
    </svg>
  );
}

const RIM = { stroke: 'rgba(201, 162, 255, 0.55)', strokeWidth: 1.2 } as const;
const DARK = '#17161F';

/** A chamfered quad from four corners, the cut taken off the top corners. */
function plate(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function Behind({ s, plate: fill }: { s: Silhouette; plate: string }) {
  const half = s.shoulders.w / 2;
  if (s.extra === 'cape') {
    return <polygon points={plate([[60 - half + 4, s.shoulders.y], [60 + half - 4, s.shoulders.y], [60 + half + 6, s.waist.y + 34], [60 - half - 6, s.waist.y + 34]])} fill={fill} opacity={0.7} {...RIM} />;
  }
  if (s.extra === 'pack') {
    return (
      <g>
        <rect x={60 - half + 6} y={s.shoulders.y - 12} width={s.shoulders.w - 12} height={34} rx={3} fill={fill} {...RIM} />
        <rect x={60 - 12} y={s.shoulders.y - 8} width={6} height={3} fill="#FFB23F" opacity="0.8" />
        <rect x={60 + 6} y={s.shoulders.y - 8} width={6} height={3} fill="#FFB23F" opacity="0.8" />
      </g>
    );
  }
  return null;
}

function Legs({ s, plate: fill }: { s: Silhouette; plate: string }) {
  const top = s.waist.y + 6;
  const height = GROUND - 6 - top;
  const left = 60 - s.leg.gap / 2 - s.leg.w;
  const right = 60 + s.leg.gap / 2;
  return (
    <g>
      <rect x={60 - s.waist.w / 2} y={s.waist.y - 2} width={s.waist.w} height={12} rx={2} fill={DARK} {...RIM} />
      {[left, right].map((x) => (
        <g key={x}>
          <rect x={x} y={top} width={s.leg.w} height={height * 0.48} rx={2} fill={fill} {...RIM} />
          <rect x={x + 1} y={top + height * 0.5} width={s.leg.w - 2} height={height * 0.5} rx={2} fill={fill} {...RIM} />
          <rect x={x - 3} y={GROUND - 7} width={s.leg.w + 6} height={7} rx={2} fill={DARK} {...RIM} />
        </g>
      ))}
    </g>
  );
}

function Torso({ s, plate: fill, core, glow }: { s: Silhouette; plate: string; core: boolean; glow: string }) {
  const sh = s.shoulders.w / 2;
  const wa = s.waist.w / 2;
  const cut = 6;
  const chest = s.shoulders.y + 14;
  return (
    <g>
      <polygon
        points={plate([[60 - sh + cut, s.shoulders.y], [60 + sh - cut, s.shoulders.y], [60 + sh, s.shoulders.y + cut], [60 + wa, s.waist.y], [60 - wa, s.waist.y], [60 - sh, s.shoulders.y + cut]])}
        fill={fill}
        {...RIM}
      />
      <line x1={60} y1={s.shoulders.y + 22} x2={60} y2={s.waist.y - 4} stroke="rgba(201, 162, 255, 0.25)" strokeWidth={1} />
      {s.extra === 'collar' && (
        <g>
          <polygon points={plate([[60 - 18, s.shoulders.y + 2], [60 - 8, s.shoulders.y - 14], [60 - 6, s.shoulders.y + 2]])} fill={fill} {...RIM} />
          <polygon points={plate([[60 + 18, s.shoulders.y + 2], [60 + 8, s.shoulders.y - 14], [60 + 6, s.shoulders.y + 2]])} fill={fill} {...RIM} />
        </g>
      )}
      {core && (
        <g>
          <rect x={56} y={chest - 4} width={8} height={8} fill="#FFB23F" transform={`rotate(45 60 ${chest})`} filter={glow} opacity={0.8} />
          <rect x={57} y={chest - 3} width={6} height={6} fill="#FFE7C2" transform={`rotate(45 60 ${chest})`} />
        </g>
      )}
    </g>
  );
}

function Arm({ s, side, plate: fill, raise = false }: { s: Silhouette; side: -1 | 1; plate: string; raise?: boolean }) {
  const shoulderX = 60 + side * (s.shoulders.w / 2 - s.arm.w / 2 + 1);
  const top = s.shoulders.y + 2;
  const style = { transformOrigin: `${shoulderX}px ${top}px`, transformBox: 'view-box', '--spread': `${side * s.arm.spread}deg` } as CSSProperties;
  const upper = s.arm.len * 0.48;
  const fistSize = s.extra === 'fists' ? s.arm.w + 6 : s.arm.w + 1;
  return (
    <g className={raise ? `${r.arm} ${r.armRaise}` : r.arm} style={style}>
      <rect x={shoulderX - s.arm.w / 2 - 2} y={top - 4} width={s.arm.w + 4} height={12} rx={4} fill={fill} {...RIM} />
      <rect x={shoulderX - s.arm.w / 2} y={top + 6} width={s.arm.w} height={upper} rx={2} fill={fill} {...RIM} />
      <rect x={shoulderX - s.arm.w / 2 + 0.5} y={top + 8 + upper} width={s.arm.w - 1} height={s.arm.len - upper - 8} rx={2} fill={fill} {...RIM} />
      <rect x={shoulderX - fistSize / 2} y={top + s.arm.len} width={fistSize} height={fistSize * 0.8} rx={2} fill={DARK} {...RIM} />
      {s.extra === 'shield' && side === -1 && <rect x={shoulderX - 16} y={top + s.arm.len * 0.4} width={22} height={34} rx={4} fill={fill} {...RIM} />}
    </g>
  );
}

function Head({ s, plate: fill, visor, glow }: { s: Silhouette; plate: string; visor: string; glow: string | null }) {
  const h = s.head;
  const x = 60 - h.w / 2;
  const mid = h.y + h.h * 0.46;
  const style = { transformOrigin: `60px ${h.y + h.h}px`, transformBox: 'view-box' } as CSSProperties;
  return (
    <g className={r.head} style={style}>
      <rect x={56} y={h.y + h.h - 2} width={8} height={s.shoulders.y - (h.y + h.h) + 4} fill={DARK} />
      {s.extra === 'antenna' && (
        <g>
          <line x1={60 + h.w * 0.22} y1={h.y + 2} x2={60 + h.w * 0.34} y2={h.y - 12} stroke="rgba(201, 162, 255, 0.7)" strokeWidth={1.4} />
          <circle cx={60 + h.w * 0.34} cy={h.y - 13} r={2.2} fill="#FFB23F" />
        </g>
      )}
      <rect x={x} y={h.y} width={h.w} height={h.h} rx={h.r} fill={fill} {...RIM} />
      <g className={r.visor}>
        {glow && <VisorShape s={s} mid={mid} fill="#FFB23F" filter={glow} />}
        <VisorShape s={s} mid={mid} fill={visor} />
        {glow && <rect className={r.scan} style={{ '--scan': `${h.w - 9}px` } as CSSProperties} x={x + 3} y={mid - 4} width={3} height={8} fill="#FFF6E6" />}
      </g>
    </g>
  );
}

function VisorShape({ s, mid, fill, filter }: { s: Silhouette; mid: number; fill: string; filter?: string }) {
  const w = s.head.w;
  const props = { fill, filter };
  switch (s.visor) {
    case 'bar':
      return <rect x={60 - w / 2 + 4} y={mid - 2.5} width={w - 8} height={5} rx={1.5} {...props} />;
    case 'slit':
      return <polygon points={plate([[60 - w / 2 + 3, mid - 3], [60, mid + 1], [60 + w / 2 - 3, mid - 3], [60 + w / 2 - 3, mid], [60, mid + 3.5], [60 - w / 2 + 3, mid]])} {...props} />;
    case 'split':
      return (
        <g>
          <rect x={60 - w / 2 + 3} y={mid - 2} width={w / 2 - 5} height={4} rx={1} {...props} />
          <rect x={62} y={mid - 2} width={w / 2 - 5} height={4} rx={1} {...props} />
        </g>
      );
    case 'round':
      return <circle cx={60} cy={mid} r={w * 0.2} {...props} />;
    case 'wide':
      return <rect x={60 - w / 2 + 2} y={mid - 4} width={w - 4} height={8} rx={3} {...props} />;
    case 'ring':
      return <circle cx={60} cy={mid} r={w * 0.26} fill="none" stroke={fill} strokeWidth={3.2} filter={filter} />;
  }
}
