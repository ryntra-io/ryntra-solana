/**
 * The city's score, synthesised live with Tone.js — no samples, so no licence questions.
 * 150 BPM grid (an 8th note = 200 ms, a Solana slot). Pad and bass carry a minor progression; an arpeggio of
 * "stored sun" sparkles rides on top. Events land on the next 8th note: a riser and a bright stab for a pump,
 * a beat of silence then a layered impact for a Solar Flare, a whoosh and a rising run for a new tower.
 * Tone is loaded only when the visitor enters, inside their tap, as browsers require.
 */
import type * as ToneType from 'tone';
import type { FxKind } from '../city/store.ts';

type Engine = {
  Tone: typeof ToneType;
  music: ToneType.Gain;
  master: ToneType.Gain;
  sfx: ToneType.Gain;
  pad: ToneType.PolySynth;
  bass: ToneType.MonoSynth;
  arp: ToneType.Synth;
  hat: ToneType.NoiseSynth;
  kick: ToneType.MembraneSynth;
  stab: ToneType.PolySynth;
  riser: ToneType.NoiseSynth;
  riserFilter: ToneType.Filter;
  crack: ToneType.NoiseSynth;
  boom: ToneType.MembraneSynth;
  chime: ToneType.Synth;
  padFilter: ToneType.Filter;
};

let engine: Engine | null = null;
let starting: Promise<Engine> | null = null;

// D minor: Dm9 – Bbmaj7 – Fmaj7 – C6/9, two bars each.
const CHORDS = [
  ['D3', 'F3', 'A3', 'C4', 'E4'],
  ['Bb2', 'D3', 'F3', 'A3', 'D4'],
  ['F2', 'A3', 'C4', 'E4', 'G4'],
  ['C3', 'E3', 'G3', 'A3', 'D4'],
];
const ROOTS = ['D2', 'Bb1', 'F1', 'C2'];

let built: Promise<Engine> | null = null;

/**
 * Builds the whole score and every synth while the title screen is idle, silent and suspended: the noise buffers,
 * the reverbs and the AudioContext take a quarter of a second, which must not land on the PLAY tap.
 * Browsers start sound only from a tap; that part is startAudio, and it is quick.
 */
export function prepareAudio(): Promise<Engine> {
  built ??= build();
  return built;
}

export async function startAudio(): Promise<void> {
  if (engine) return;
  starting ??= (async () => {
    const e = await prepareAudio();
    await e.Tone.start();
    e.Tone.getTransport().start('+0.05');
    e.master.gain.rampTo(0.85, 2.5);
    return e;
  })();
  engine = await starting;
}

/** A breath between building steps, so the frame loop keeps running while the score is assembled. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function build(): Promise<Engine> {
  const Tone = await import('tone');
  await breathe();
  const transport = Tone.getTransport();
  transport.bpm.value = 150;

  const master = new Tone.Gain(0).toDestination();
  const limiter = new Tone.Limiter(-1).connect(master);
  const music = new Tone.Gain(0.9).connect(limiter);
  const sfx = new Tone.Gain(1).connect(limiter);
  const reverb = new Tone.Reverb({ decay: 7, wet: 0.45 }).connect(music);
  await breathe();
  const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.38, wet: 0.35 }).connect(reverb);

  const padFilter = new Tone.Filter(1400, 'lowpass').connect(reverb);
  const chorus = new Tone.Chorus(0.6, 2.5, 0.4).start().connect(padFilter);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
    envelope: { attack: 1.4, decay: 0.6, sustain: 0.7, release: 3.5 },
    volume: -22,
  }).connect(chorus);
  pad.maxPolyphony = 12;

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filter: { Q: 1, type: 'lowpass' },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3, baseFrequency: 90, octaves: 2.2 },
    envelope: { attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.8 },
    volume: -14,
  }).connect(music);

  const arpFilter = new Tone.Filter(2600, 'lowpass').connect(delay);
  const arp = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.18, sustain: 0.0, release: 0.2 }, volume: -24 }).connect(arpFilter);

  const hatFilter = new Tone.Filter(7500, 'highpass').connect(music);
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -34 }).connect(hatFilter);
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0 }, volume: -18 }).connect(music);

  await breathe();
  // Effects bus.
  const sfxVerb = new Tone.Reverb({ decay: 4, wet: 0.3 }).connect(sfx);
  const stab = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsquare', count: 2, spread: 18 }, envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 1.2 }, volume: -16 }).connect(sfxVerb);
  const riserFilter = new Tone.Filter(300, 'bandpass').connect(sfxVerb);
  const riser = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.6, decay: 0.05, sustain: 1, release: 0.05 }, volume: -16 }).connect(riserFilter);
  const crackFilter = new Tone.Filter(3200, 'bandpass').connect(sfxVerb);
  const crack = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: -8 }).connect(crackFilter);
  const boom = new Tone.MembraneSynth({ pitchDecay: 0.12, octaves: 7, envelope: { attack: 0.001, decay: 1.6, sustain: 0, release: 1.2 }, volume: -4 }).connect(sfxVerb);
  const chime = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.8 }, volume: -14 }).connect(sfxVerb);

  await breathe();
  // The score.
  let bar = 0;
  new Tone.Loop((time) => {
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length]!;
    const root = ROOTS[Math.floor(bar / 2) % ROOTS.length]!;
    if (bar % 2 === 0) pad.triggerAttackRelease(chord, '2m', time, 0.5);
    bass.triggerAttackRelease(root, '4n', time, 0.8);
    bass.triggerAttackRelease(root, '8n', time + Tone.Time('2n.').toSeconds(), 0.5);
    kick.triggerAttackRelease('C1', '8n', time, 0.5);
    kick.triggerAttackRelease('C1', '8n', time + Tone.Time('2n').toSeconds(), 0.35);
    bar += 1;
  }, '1m').start(0);

  let step = 0;
  new Tone.Loop((time) => {
    const chord = CHORDS[Math.floor(Math.floor(step / 8) / 2) % CHORDS.length]!;
    const pattern = [0, 2, 4, 3, 1, 3, 4, 2];
    const note = Tone.Frequency(chord[pattern[step % 8]!]!).transpose(12).toNote();
    arp.triggerAttackRelease(note, '16n', time, 0.35 + 0.25 * ((step % 4) === 0 ? 1 : 0));
    if (step % 2 === 1) hat.triggerAttackRelease('32n', time, 0.6);
    step += 1;
  }, '8n').start('1m');

  // Noise buffers are generated on first use: touch them now, not on the first hi-hat.
  new Tone.Noise('pink').dispose();
  new Tone.Noise('white').dispose();
  return { Tone, music, master, sfx, pad, bass, arp, hat, kick, stab, riser, riserFilter, crack, boom, chime, padFilter };
}

export function setMuted(muted: boolean) {
  if (!engine) return;
  engine.master.gain.rampTo(muted ? 0 : 0.85, muted ? 0.3 : 1.2);
}

/** Plays a city moment on the next 8th note of the grid. */
export function playMoment(kind: FxKind) {
  const e = engine;
  if (!e) return;
  try {
    moment(e, kind);
  } catch {
    // A clash with a sound already scheduled drops this one; the city goes on.
  }
}

function moment(e: Engine, kind: FxKind) {
  const { Tone } = e;
  const transport = Tone.getTransport();
  const at = transport.nextSubdivision('8n');
  const beat = Tone.Time('4n').toSeconds();
  if (kind === 'pump') {
    e.riser.triggerAttackRelease(beat * 2, at);
    e.riserFilter.frequency.cancelScheduledValues(at);
    e.riserFilter.frequency.setValueAtTime(300, at);
    e.riserFilter.frequency.exponentialRampToValueAtTime(6000, at + beat * 2);
    e.stab.triggerAttackRelease(['F4', 'A4', 'C5', 'E5', 'G5'], '8n', at + beat * 2, 0.7);
    ['C6', 'E6', 'G6', 'A6', 'C7'].forEach((n, i) => e.chime.triggerAttackRelease(n, '16n', at + beat * 2 + i * 0.07, 0.4));
  } else if (kind === 'flare') {
    // The silence makes the hit: duck the music for a beat, then the impact, then let it come back.
    e.music.gain.cancelScheduledValues(at);
    e.music.gain.setValueAtTime(e.music.gain.value, at);
    e.music.gain.linearRampToValueAtTime(0.12, at + 0.08);
    e.boom.triggerAttackRelease('A0', '2n', at + beat, 1);
    e.crack.triggerAttackRelease('16n', at + beat, 1);
    e.music.gain.setValueAtTime(0.25, at + beat + 0.3);
    e.music.gain.linearRampToValueAtTime(0.9, at + beat + 2.2);
  } else {
    e.riser.triggerAttackRelease(beat, at);
    e.riserFilter.frequency.cancelScheduledValues(at);
    e.riserFilter.frequency.setValueAtTime(5000, at);
    e.riserFilter.frequency.exponentialRampToValueAtTime(400, at + beat);
    ['D5', 'F5', 'A5', 'C6', 'E6', 'A6'].forEach((n, i) => e.chime.triggerAttackRelease(n, '16n', at + beat + i * 0.1, 0.5));
  }
}

/** A short tick for taps on towers and buttons. */
export function playTick() {
  const e = engine;
  if (!e) return;
  e.chime.triggerAttackRelease('A6', '64n', undefined, 0.25);
}

/* ---------------------------------------------------------------------------------------------- */
/* Skyline Run                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

let wind: { gain: ToneType.Gain; filter: ToneType.Filter } | null = null;

/** The air rushing past: louder and brighter with speed. 0 is silent. */
export function setRunWind(level: number) {
  const e = engine;
  if (!e) return;
  if (!wind) {
    const gain = new e.Tone.Gain(0).connect(e.sfx);
    const filter = new e.Tone.Filter(600, 'bandpass').connect(gain);
    filter.Q.value = 0.8;
    new e.Tone.Noise('pink').connect(filter).start();
    wind = { gain, filter };
  }
  const l = Math.max(0, Math.min(1, level));
  wind.gain.gain.rampTo(l * 0.22, 0.12);
  wind.filter.frequency.rampTo(380 + l * 1900, 0.12);
}

export type RunSound = 'count' | 'go' | 'boost' | 'break' | 'shatter' | 'save' | 'hit' | 'shield' | 'crash' | 'finish' | 'jump' | 'land' | 'dash' | 'near';

/** A synth cannot be scheduled earlier than its last note: two run sounds in one frame step a hair apart. */
const lastAt = new WeakMap<object, number>();
function when(synth: object, at: number): number {
  const t = Math.max(at, (lastAt.get(synth) ?? 0) + 0.012);
  lastAt.set(synth, t);
  return t;
}

/** Run sounds play at once, not on the grid: a thumb wants an answer now. */
export function playRun(kind: RunSound) {
  const e = engine;
  if (!e) return;
  try {
    runSound(e, kind);
  } catch {
    // A dropped sound never stops the run.
  }
}

function runSound(e: Engine, kind: RunSound) {
  const now = e.Tone.now();
  switch (kind) {
    case 'count':
      e.chime.triggerAttackRelease('A5', '32n', when(e.chime, now), 0.35);
      break;
    case 'go':
      e.stab.triggerAttackRelease(['D4', 'F4', 'A4', 'D5'], '8n', when(e.stab, now), 0.6);
      e.chime.triggerAttackRelease('D6', '16n', when(e.chime, now + 0.04), 0.4);
      break;
    case 'boost':
      ['A5', 'D6', 'F6'].forEach((n, i) => e.chime.triggerAttackRelease(n, '32n', when(e.chime, now + i * 0.045), 0.4));
      break;
    case 'shatter':
      e.crack.triggerAttackRelease('32n', when(e.crack, now), 0.6);
      e.chime.triggerAttackRelease('E7', '32n', when(e.chime, now + 0.02), 0.25);
      break;
    case 'break':
      e.crack.triggerAttackRelease('16n', when(e.crack, now), 1);
      e.boom.triggerAttackRelease('D1', '8n', when(e.boom, now), 0.55);
      break;
    case 'save':
      ['D6', 'F6', 'A6', 'D7'].forEach((n, i) => e.chime.triggerAttackRelease(n, '16n', when(e.chime, now + i * 0.06), 0.45));
      break;
    case 'hit':
      // A shield cracks: the glass and a short thud, without the crash's drop in the music.
      e.crack.triggerAttackRelease('16n', when(e.crack, now), 0.8);
      e.boom.triggerAttackRelease('F1', '16n', when(e.boom, now), 0.4);
      e.chime.triggerAttackRelease('C#6', '32n', when(e.chime, now + 0.03), 0.3);
      break;
    case 'shield':
      ['A5', 'E6'].forEach((n, i) => e.chime.triggerAttackRelease(n, '32n', when(e.chime, now + i * 0.06), 0.35));
      break;
    case 'crash':
      e.music.gain.cancelScheduledValues(now);
      e.music.gain.setValueAtTime(e.music.gain.value, now);
      e.music.gain.linearRampToValueAtTime(0.15, now + 0.06);
      e.boom.triggerAttackRelease('A0', '2n', when(e.boom, now), 1);
      e.crack.triggerAttackRelease('16n', when(e.crack, now), 1);
      e.music.gain.linearRampToValueAtTime(0.9, now + 2.4);
      break;
    case 'finish':
      e.stab.triggerAttackRelease(['F4', 'A4', 'C5', 'E5', 'G5'], '8n', when(e.stab, now), 0.7);
      ['C6', 'E6', 'G6', 'A6', 'C7'].forEach((n, i) => e.chime.triggerAttackRelease(n, '16n', when(e.chime, now + 0.12 + i * 0.07), 0.45));
      break;
    case 'jump':
      e.chime.triggerAttackRelease('D5', '64n', when(e.chime, now), 0.18);
      break;
    case 'land':
      e.kick.triggerAttackRelease('G1', '32n', when(e.kick, now), 0.25);
      break;
    case 'dash':
      e.riser.triggerAttackRelease(0.12, when(e.riser, now));
      e.riserFilter.frequency.cancelScheduledValues(now);
      e.riserFilter.frequency.setValueAtTime(3800, now);
      e.riserFilter.frequency.exponentialRampToValueAtTime(500, now + 0.12);
      break;
    case 'near':
      e.riser.triggerAttackRelease(0.16, when(e.riser, now));
      e.riserFilter.frequency.cancelScheduledValues(now);
      e.riserFilter.frequency.setValueAtTime(900, now);
      e.riserFilter.frequency.exponentialRampToValueAtTime(5200, now + 0.16);
      break;
  }
}
