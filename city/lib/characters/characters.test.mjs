// The characters' library: the guardian's skeleton and armour, its clips, states and reactions, blending without
// snaps, feet that stay planted, a head that follows a target, the detail switch and the palette rules.
//   node --test city/lib/characters/
import assert from 'node:assert/strict';
import test from 'node:test';

import { Animator, REACTIONS, STATES } from './animator.ts';
import { CROWD, HERO, MATS, STANDARD, partsAt } from './body.ts';
import { CH, HUES, linearHex } from './expression.ts';
import { GUARDIAN, GUARDIAN_BODY, GUARDIAN_BOUNDS, GUARDIAN_RIG } from './guardian/index.ts';
import { CHARACTER_BUDGET, chooseDetail, DETAIL_PIXELS, projectedHeight } from './lod.ts';
import { quatAngle } from './math.ts';
import { ANKLE } from './pose.ts';

const rig = GUARDIAN_RIG;
const bone = (name) => rig.index[name];
const at = (a, name) => {
  const o = bone(name) * 12;
  return [a.mats[o + 3], a.mats[o + 7], a.mats[o + 11]];
};
const near = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('the skeleton is a tree with every left bone mirrored on the right', () => {
  assert.equal(rig.names[0], 'pelvis');
  for (let i = 1; i < rig.count; i += 1) assert.ok(rig.parent[i] >= 0 && rig.parent[i] < i, `${rig.names[i]} has its parent first`);
  for (const name of rig.names) {
    if (!name.endsWith('.L')) continue;
    const twin = name.replace(/\.L$/, '.R');
    assert.ok(twin in rig.index, `${twin}`);
    const [l, r] = [bone(name), bone(twin)];
    if (l < rig.count) assert.deepEqual([-rig.rest[l * 3], rig.rest[l * 3 + 1], rig.rest[l * 3 + 2]], [rig.rest[r * 3], rig.rest[r * 3 + 1], rig.rest[r * 3 + 2]]);
  }
  // Pistons are aimed, not posed: four a side, after the posed bones.
  assert.equal(rig.total - rig.count, 8);
});

test('the guardian is separate hard parts on bones, at three levels of detail', () => {
  const hero = partsAt(GUARDIAN_BODY, HERO);
  const standard = partsAt(GUARDIAN_BODY, STANDARD);
  const crowd = partsAt(GUARDIAN_BODY, CROWD);
  assert.ok(hero.length > standard.length && standard.length > crowd.length, `${hero.length} > ${standard.length} > ${crowd.length}`);
  assert.ok(crowd.length <= 30, 'the crowd is a few shapes');
  for (const part of GUARDIAN_BODY) {
    assert.ok(part.boneIndex >= 0 && part.boneIndex < rig.total, `${part.bone}`);
    assert.ok(part.mat in MATS, part.mat);
  }
  // Every posed bone carries a part up close; hands have fingers up close and mitts on the street.
  const carried = new Set(hero.map((p) => p.bone));
  for (const name of rig.names.slice(0, rig.count)) assert.ok(carried.has(name), `${name} has a part`);
  assert.ok(hero.filter((p) => p.bone === 'tips.L').length === 4, 'four fingertips a hand up close');
  assert.ok(standard.filter((p) => p.bone === 'tips.L').length === 1, 'a mitt on the street');
  // A face at every level: the visor.
  for (const level of [hero, standard, crowd]) assert.ok(level.some((p) => p.mat === 'visor'), 'a visor');
});

test('the silhouette reads as a sleek humanoid: human proportions, a little taller than a person', () => {
  const { min, max } = GUARDIAN_BOUNDS;
  const height = max[1] - min[1];
  const width = max[0] - min[0];
  assert.ok(height > 1.85 && height < 2.05, `height ${height}`);
  // Shoulders about a quarter to a third of the height across; legs about half of it.
  assert.ok(width / height > 0.24 && width / height < 0.36, `width ${width}`);
  const a = new Animator(GUARDIAN, 1);
  a.seek('idleA', 0);
  const hip = at(a, 'thigh.L')[1];
  assert.ok(hip / height > 0.45 && hip / height < 0.55, `hip ${hip}`);
  // The head stands clear above the shoulders.
  const visor = at(a, 'head')[1] + 0.085;
  const shoulder = at(a, 'upperArm.L')[1];
  assert.ok(visor - shoulder > 0.2, `visor ${visor} over the shoulder ${shoulder}`);
});

test('ten and more animations, each a clip in code, plus the head following a target', () => {
  const clips = Object.keys(GUARDIAN.clips);
  for (const name of ['idleA', 'idleB', 'walk', 'analyze', 'attempt', 'laugh', 'alarm', 'defeat', 'celebrate', 'greet', 'speak', 'done']) assert.ok(clips.includes(name), name);
  assert.ok(clips.length + 1 >= 10);
  for (const clip of Object.values(GUARDIAN.clips)) {
    assert.ok(clip.duration > 0, clip.name);
    for (let i = 1; i < clip.times.length; i += 1) assert.ok(clip.times[i] >= clip.times[i - 1], `${clip.name} keys in order`);
  }
});

test('looping clips close their loop: the last frame meets the first', () => {
  const a = new Animator(GUARDIAN, 1);
  const b = new Animator(GUARDIAN, 1);
  for (const clip of Object.values(GUARDIAN.clips)) {
    if (!clip.loop) continue;
    const [from, to] = clip.loop;
    a.seek(clip.name, to - 1e-4);
    b.seek(clip.name, from === 0 ? 0 : to + 1e-4);
    let worst = 0;
    for (let i = 0; i < rig.total; i += 1) {
      const pa = [a.mats[i * 12 + 3], a.mats[i * 12 + 7], a.mats[i * 12 + 11]];
      const pb = [b.mats[i * 12 + 3], b.mats[i * 12 + 7], b.mats[i * 12 + 11]];
      worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
    }
    assert.ok(worst < 0.03, `${clip.name} jumps ${worst.toFixed(3)} at its loop`);
  }
});

test('the four states are told apart by body and light, not text', () => {
  const looks = {};
  const when = { ready: 1.2, thinking: 1.2, acting: 0.6, done: 2.0 };
  for (const state of STATES) {
    const a = new Animator(GUARDIAN, 1);
    a.seek(GUARDIAN.states[state], when[state]);
    looks[state] = { face: a.face.slice(), hand: at(a, 'hand.L'), handR: at(a, 'hand.R') };
  }
  const amber = linearHex(HUES.amber);
  const warm = linearHex(HUES.warm);
  const hue = (f) => [f[CH.r], f[CH.g], f[CH.b]];
  assert.ok(near(hue(looks.ready.face), amber, 1e-3), 'ready is amber');
  assert.ok(near(hue(looks.thinking.face), warm, 1e-3), 'thinking is warm');
  assert.ok(looks.thinking.face[CH.holo] > 0.9 && looks.ready.face[CH.holo] === 0, 'a hologram only while thinking');
  assert.ok(looks.thinking.face[CH.scan] > 0.9, 'a scan bar while thinking');
  assert.ok(looks.acting.face[CH.talk] > 0.9 && looks.acting.face[CH.core] > looks.ready.face[CH.core] + 0.4, 'acting speaks and burns brighter');
  assert.ok(looks.done.face[CH.smile] > 0.3, 'done is pleased');
  // Bodies differ too: a hand up to read, a hand out to speak, arms crossed.
  assert.ok(looks.thinking.hand[1] > looks.ready.hand[1] + 0.3, 'thinking lifts the left palm');
  assert.ok(looks.acting.handR[1] > looks.ready.handR[1] + 0.5, 'acting lifts the right hand');
  assert.ok(Math.abs(looks.done.hand[0]) < Math.abs(looks.ready.hand[0]) - 0.2, 'done crosses the arms');
});

test('red is danger only: flare appears in the alarm and the defeat and nowhere else; mint never', () => {
  const flare = linearHex(HUES.flare);
  for (const clip of Object.values(GUARDIAN.clips)) {
    const usesFlare = clip.faces.some((f) => near([f[CH.r], f[CH.g], f[CH.b]], flare, 1e-3));
    assert.equal(usesFlare, clip.name === 'alarm' || clip.name === 'defeat', clip.name);
  }
  assert.ok(!Object.values(HUES).includes('#14F195'), 'no mint on a character');
  assert.ok(!('mint' in MATS));
});

test('switching state blends: no bone jumps between two frames', () => {
  const a = new Animator(GUARDIAN, 3);
  const prev = new Float32Array(a.mats);
  const dt = 1 / 60;
  let worst = 0;
  const step = () => {
    a.update(dt);
    for (let i = 0; i < rig.total; i += 1) {
      const d = Math.hypot(a.mats[i * 12 + 3] - prev[i * 12 + 3], a.mats[i * 12 + 7] - prev[i * 12 + 7], a.mats[i * 12 + 11] - prev[i * 12 + 11]);
      worst = Math.max(worst, d);
    }
    prev.set(a.mats);
  };
  for (const state of ['thinking', 'acting', 'done', 'ready']) {
    a.setState(state);
    for (let f = 0; f < 120; f += 1) step();
  }
  // A state change is never faster than the states' own gestures: under 10 cm a frame (6 m/s, the fist of a chop).
  assert.ok(worst < 0.1, `a bone moved ${worst.toFixed(3)} in one frame`);
});

test('no clip pops: at 60 frames a second no part jumps more than 30 cm in a frame', () => {
  for (const clip of Object.values(GUARDIAN.clips)) {
    const a = new Animator(GUARDIAN, 1);
    a.seek(clip.name, 0);
    const prev = new Float32Array(a.mats);
    let worst = 0;
    for (let t = 1 / 60; t < clip.duration; t += 1 / 60) {
      a.seek(clip.name, t);
      for (let i = 0; i < rig.total; i += 1) {
        worst = Math.max(worst, Math.hypot(a.mats[i * 12 + 3] - prev[i * 12 + 3], a.mats[i * 12 + 7] - prev[i * 12 + 7], a.mats[i * 12 + 11] - prev[i * 12 + 11]));
      }
      prev.set(a.mats);
    }
    assert.ok(worst < 0.3, `${clip.name}: ${worst.toFixed(3)} in a frame`);
  }
});

test('a reaction plays once and hands back to the state; held, it stays', () => {
  const a = new Animator(GUARDIAN, 1);
  a.setState('thinking');
  for (let f = 0; f < 60; f += 1) a.update(1 / 60);
  a.react('laugh');
  assert.ok(a.busy);
  const laugh = GUARDIAN.clips.laugh.duration;
  for (let f = 0; f < Math.ceil((laugh + 0.2) * 60); f += 1) a.update(1 / 60);
  assert.ok(!a.busy, 'done laughing');
  for (let f = 0; f < 60; f += 1) a.update(1 / 60);
  assert.equal(a.top, 'analyze', 'back to thinking');

  a.react('defeat', true);
  for (let f = 0; f < 60 * 12; f += 1) a.update(1 / 60);
  assert.ok(a.busy, 'stays down');
  assert.equal(a.top, 'defeat');
  assert.ok(at(a, 'head')[1] < 1.45, 'kneeling');
  a.release();
  for (let f = 0; f < 60 * 3; f += 1) a.update(1 / 60);
  assert.ok(!a.busy && at(a, 'head')[1] > 1.65, 'back on its feet');
});

test('every reaction exists and moves the body', () => {
  for (const reaction of REACTIONS) {
    const a = new Animator(GUARDIAN, 1);
    a.seek('idleA', 0);
    const rest = new Float32Array(a.mats);
    const clip = GUARDIAN.clips[GUARDIAN.reactions[reaction]];
    a.seek(clip.name, clip.duration * 0.35);
    let moved = 0;
    for (let i = 0; i < rig.count; i += 1) moved = Math.max(moved, Math.hypot(a.mats[i * 12 + 3] - rest[i * 12 + 3], a.mats[i * 12 + 7] - rest[i * 12 + 7], a.mats[i * 12 + 11] - rest[i * 12 + 11]));
    assert.ok(moved > 0.15, `${reaction} moves ${moved.toFixed(2)}`);
  }
});

test('feet stay on the ground: planted in the stance, and still while the body walks over them', () => {
  const a = new Animator(GUARDIAN, 1);
  for (const t of [0, 1.1, 2.7, 4.4]) {
    a.seek('idleA', t);
    for (const foot of ['foot.L', 'foot.R']) assert.ok(Math.abs(at(a, foot)[1] - ANKLE) < 0.002, `${foot} on the ground at ${t}`);
  }
  // Walking at full stride: a planted foot, carried forward by the body at walking speed, stays put on the ground.
  const speed = GUARDIAN.walk.speed;
  const cycle = GUARDIAN.clips.walk.duration;
  const planted = [];
  for (let k = 0; k <= 20; k += 1) {
    const t = 0.05 * cycle + (k / 20) * 0.5 * cycle;
    a.seek('walk', t, null, 1);
    const [x, y, z] = at(a, 'foot.L');
    planted.push([x, y, z + speed * t]);
  }
  const zs = planted.map((p) => p[2]);
  const slide = Math.max(...zs) - Math.min(...zs);
  assert.ok(slide < 0.04, `the planted foot slides ${slide.toFixed(3)}`);
  assert.ok(planted.every((p) => Math.abs(p[1] - ANKLE) < 0.01), 'and stays on the ground');
});

test('the head turns toward a target within its reach, and the eyes lead it', () => {
  const left = new Animator(GUARDIAN, 1);
  const right = new Animator(GUARDIAN, 1);
  left.seek('idleA', 0, [3, 2, 2]);
  right.seek('idleA', 0, [-3, 2, 2]);
  const fwd = (a) => {
    const o = bone('head') * 12;
    return [a.mats[o + 2], a.mats[o + 6], a.mats[o + 10]];
  };
  assert.ok(fwd(left)[0] > 0.4, 'faces its left');
  assert.ok(fwd(right)[0] < -0.4, 'faces its right');
  // Live: the eyes get there first, the heavy head follows.
  const a = new Animator(GUARDIAN, 1);
  a.setState('thinking');
  a.setState('ready');
  for (let f = 0; f < 15; f += 1) a.update(1 / 60, { look: [3, 2.1, 1] });
  const early = a.face[CH.gazeX];
  const headEarly = fwd(a)[0];
  for (let f = 0; f < 150; f += 1) a.update(1 / 60, { look: [3, 2.1, 1] });
  assert.ok(early > 0.2, `eyes ahead: ${early.toFixed(2)}`);
  assert.ok(fwd(a)[0] > headEarly + 0.2, 'the head catches up');
  assert.ok(a.face[CH.gazeX] < early, 'and the eyes settle back');
});

test('detail follows size on screen, without flicker at a threshold', () => {
  assert.equal(chooseDetail(500, null), 0);
  assert.equal(chooseDetail(150, null), 1);
  assert.equal(chooseDetail(50, null), 2);
  assert.equal(chooseDetail(10, null), 3);
  // Just under a threshold keeps the finer level until past the margin.
  assert.equal(chooseDetail(DETAIL_PIXELS[1] * 0.95, 1), 1);
  assert.equal(chooseDetail(DETAIL_PIXELS[1] * 0.8, 1), 2);
  assert.equal(chooseDetail(DETAIL_PIXELS[1] * 1.05, 2), 2);
  assert.equal(chooseDetail(DETAIL_PIXELS[1] * 1.2, 2), 1);
  assert.ok(Math.abs(projectedHeight(2, 10, 40, 800) - (2 / 10) * (400 / Math.tan((20 * Math.PI) / 180))) < 1e-9);
});

test("the city's quality ladder caps a character: low never draws the hero, mid needs a bigger figure", () => {
  const at = (q, px) => Math.max(CHARACTER_BUDGET[q].best, chooseDetail(px, null, CHARACTER_BUDGET[q].pixels));
  assert.equal(at('high', 350), 0);
  assert.equal(at('mid', 350), 1, 'mid: a 350 px figure is drawn standard');
  assert.equal(at('mid', 500), 0);
  assert.equal(at('low', 2000), 1, 'low: never the hero');
  assert.equal(at('low', 50), 3, 'low: the picture sooner');
  assert.equal(at('high', 50), 2);
  assert.ok(CHARACTER_BUDGET.high.contact && !CHARACTER_BUDGET.low.contact, 'the contact shadow only on the top tier');
});

test('an update is cheap: well under a millisecond', () => {
  const a = new Animator(GUARDIAN, 1);
  a.setState('acting');
  for (let f = 0; f < 200; f += 1) a.update(1 / 60, { look: [1, 2, 3] });
  const start = performance.now();
  for (let f = 0; f < 1000; f += 1) a.update(1 / 60, { look: [1, 2, 3] });
  const each = (performance.now() - start) / 1000;
  assert.ok(each < 0.5, `${(each * 1000).toFixed(0)} µs`);
});

test('quaternion helpers measure angles', () => {
  const a = new Float32Array([0, 0, 0, 1]);
  const b = new Float32Array([0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]);
  assert.ok(Math.abs(quatAngle(a, 0, b, 0) - Math.PI / 2) < 1e-6);
});
