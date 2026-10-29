import type { Archetype } from '../animator.ts';
import { placeParts, restBounds } from '../body.ts';
import { compileClip } from '../clip.ts';
import { GUARDIAN_PARTS } from './body.ts';
import { GUARDIAN_CLIPS } from './clips.ts';
import { GUARDIAN_RIG } from './rig.ts';

/** The vault guardian, ready to play: skeleton, armour, clips and which clip each state and reaction plays. */
export const GUARDIAN: Archetype = {
  name: 'guardian',
  rig: GUARDIAN_RIG,
  clips: Object.fromEntries(GUARDIAN_CLIPS.map((spec) => [spec.name, compileClip(GUARDIAN_RIG, spec)])),
  states: { ready: 'idleA', thinking: 'analyze', acting: 'speak', done: 'done' },
  reactions: { attempt: 'attempt', laugh: 'laugh', alarm: 'alarm', defeat: 'defeat', celebrate: 'celebrate', greet: 'greet' },
  idle: { clip: 'idleB', every: [9, 15] },
  walk: { clip: 'walk', speed: 0.75, turnRate: 1.2 },
  legs: { L: ['thigh.L', 'shin.L', 'foot.L'], R: ['thigh.R', 'shin.R', 'foot.R'] },
  look: { neck: 'neck', head: 'head', yaw: 70, up: 30, down: 35 },
};

export const GUARDIAN_BODY = placeParts(GUARDIAN_RIG, GUARDIAN_PARTS);

/** The guardian's size at rest, for framing and the impostor: about 2.4 units tall. */
export const GUARDIAN_BOUNDS = restBounds(GUARDIAN_RIG, GUARDIAN_BODY);

export { GUARDIAN_RIG };
