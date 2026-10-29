import { ACT_DASH, ACT_JUMP, ACT_LEFT, ACT_RIGHT } from './sim.ts';

/**
 * One thumb, two grammars.
 * Flight: drag anywhere; the craft's target moves with the finger (relative, so the thumb never covers it)
 * and stays where you left it. With a mouse the craft simply follows the pointer, no button needed. Arrow keys
 * or WASD on a keyboard.
 * Rooftops: swipe left or right to change lane, up (or tap) to jump, down to dash. Arrows, WASD, Space, Shift.
 */
export type RunControls = {
  /** Flight target, −1…1. */
  tx: number;
  ty: number;
  /** Rooftops actions waiting for the next tick. */
  actions: number;
  /** Whether the player has touched the controls yet (the hint stays until then). */
  touched: boolean;
  dispose: () => void;
  /** Keyboard flight: move the target while keys are held. */
  tick: (dt: number) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function attachControls(el: HTMLElement, form: 'flight' | 'roofs'): RunControls {
  const controls: RunControls = { tx: 0, ty: 0, actions: 0, touched: false, dispose: () => {}, tick: () => {} };
  const held = new Set<string>();
  let drag: { id: number; x: number; y: number; tx: number; ty: number; t: number; fired: boolean } | null = null;

  const down = (e: PointerEvent) => {
    controls.touched = true;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: controls.tx, ty: controls.ty, t: performance.now(), fired: false };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // some browsers refuse capture on synthetic events
    }
  };
  const move = (e: PointerEvent) => {
    if (form === 'flight' && e.pointerType === 'mouse') {
      // The pointer is the target: a third of the screen from the centre is the edge of the corridor.
      const rect = el.getBoundingClientRect();
      controls.touched = true;
      controls.tx = clamp((e.clientX - rect.left - rect.width / 2) / (rect.width * 0.32), -1, 1);
      controls.ty = clamp((rect.top + rect.height * 0.55 - e.clientY) / (rect.height * 0.32), -1, 1);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (form === 'flight') {
      // About a third of a phone's width takes the craft from the centre to the edge.
      const k = 3.6 / Math.min(window.innerWidth, window.innerHeight);
      controls.tx = clamp(drag.tx + dx * k, -1, 1);
      controls.ty = clamp(drag.ty - dy * k, -1, 1);
      return;
    }
    // A swipe fires once it travels 26 px; the gesture can chain (swipe, keep the finger down, swipe again).
    if (Math.hypot(dx, dy) < 26) return;
    if (Math.abs(dx) > Math.abs(dy)) controls.actions |= dx < 0 ? ACT_LEFT : ACT_RIGHT;
    else controls.actions |= dy < 0 ? ACT_JUMP : ACT_DASH;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.fired = true;
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    // Rooftops: a quick tap is a jump.
    if (form === 'roofs' && !drag.fired && performance.now() - drag.t < 260 && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 14) controls.actions |= ACT_JUMP;
    drag = null;
  };
  const key = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const known = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' ', 'shift'].includes(k);
    if (!known) return;
    e.preventDefault();
    controls.touched = true;
    if (form === 'roofs') {
      if (e.repeat) return;
      if (k === 'arrowleft' || k === 'a') controls.actions |= ACT_LEFT;
      if (k === 'arrowright' || k === 'd') controls.actions |= ACT_RIGHT;
      if (k === 'arrowup' || k === 'w' || k === ' ') controls.actions |= ACT_JUMP;
      if (k === 'arrowdown' || k === 's' || k === 'shift') controls.actions |= ACT_DASH;
    } else {
      held.add(k);
    }
  };
  const release = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());

  controls.tick = (dt) => {
    if (form !== 'flight' || !held.size) return;
    const rate = 2.2 * dt;
    if (held.has('arrowleft') || held.has('a')) controls.tx = clamp(controls.tx - rate, -1, 1);
    if (held.has('arrowright') || held.has('d')) controls.tx = clamp(controls.tx + rate, -1, 1);
    if (held.has('arrowup') || held.has('w')) controls.ty = clamp(controls.ty + rate, -1, 1);
    if (held.has('arrowdown') || held.has('s')) controls.ty = clamp(controls.ty - rate, -1, 1);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', release);
  controls.dispose = () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', release);
  };
  return controls;
}
