import { streamFrames } from '../capture.ts';
import { muxMp4, type Mp4Frame } from './mp4.ts';

/**
 * A 9:16 clip recorded in the browser: after every render of the city the recorder draws the frame, cropped to
 * portrait, with the moment's words over it, into its own 720 × 1280 canvas and hands that to the browser's H.264
 * encoder (WebCodecs). Frames are taken on a 30-a-second grid of real time, so the clip plays at the speed it
 * happened. A device that cannot draw or encode that fast films fewer frames, each lasting until the next, rather
 * than slowing the city down or queueing pictures in memory.
 *
 * A run is filmed as it is played and only its last seconds are kept (`keep`), so a record is ready to share
 * the moment it ends. A clip ends with a few frames drawn on the spot (the end card), then becomes an MP4.
 */

export const CLIP = { width: 720, height: 1280, fps: 30, bitrate: 4_000_000 } as const;

/** H.264 profiles, best first; Baseline is everywhere. Level 3.1 holds 720 × 1280 at 30 frames a second. */
const CODECS = ['avc1.64001f', 'avc1.4d001f', 'avc1.42001f'];
/** Frames waiting in the encoder before the next one is skipped. */
const BACKLOG = 4;
/** A device that cannot finish the clip in this long gets the card alone, never a sheet that waits forever. */
const PATIENCE_MS = 12_000;

const configFor = (codec: string): VideoEncoderConfig => ({
  codec,
  width: CLIP.width,
  height: CLIP.height,
  bitrate: CLIP.bitrate,
  framerate: CLIP.fps,
  avc: { format: 'avc' },
  // Real time: the encoder keeps up with the city and never reorders frames, which the MP4 index needs.
  latencyMode: 'realtime',
});

let codec: Promise<string | null> | null = null;

/** The first H.264 profile this browser can encode, or null when it cannot film at all. */
export function clipCodec(): Promise<string | null> {
  codec ??= (async () => {
    if (typeof window === 'undefined' || typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    for (const c of CODECS) {
      try {
        if ((await VideoEncoder.isConfigSupported(configFor(c))).supported) return c;
      } catch {
        // the next profile
      }
    }
    return null;
  })();
  return codec;
}

/** Draws one picture of the clip: `source` is the city's canvas (null for a frame drawn without the city), `t` seconds since the start. */
export type DrawClip = (ctx: CanvasRenderingContext2D, source: HTMLCanvasElement | null, t: number) => void;

/** A copy of the decoder setup the encoder hands over, whatever kind of buffer it comes in. */
function bytesOf(src: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
  return new Uint8Array(src.slice(0));
}

const STEP_US = 1e6 / CLIP.fps;

export class ClipRecorder {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly encoder: VideoEncoder;
  private readonly draw: DrawClip;
  private readonly keep: number;
  private frames: Mp4Frame[] = [];
  private avcC: Uint8Array | null = null;
  private failure: unknown = null;
  /** The next slot of the 30-a-second grid, counted from the start of the clip. */
  private slot = 0;
  /** The last second of the clip that got a key frame. */
  private keyed = -1;
  private lastTimestamp = -1;
  private t0 = 0;
  private untap: (() => void) | null = null;
  private closed = false;

  /** `keep`: seconds of the clip to keep from its end (a run); 0 keeps everything. */
  constructor(codecName: string, draw: DrawClip, keep = 0) {
    this.draw = draw;
    this.keep = keep;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CLIP.width;
    this.canvas.height = CLIP.height;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no canvas');
    this.ctx = ctx;
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.take(chunk, meta),
      error: (e) => {
        this.failure = e;
      },
    });
    this.encoder.configure(configFor(codecName));
  }

  get failed(): boolean {
    return this.failure !== null;
  }

  /** Why the clip failed, for the console during development. */
  get reason(): string {
    return this.failure ? String(this.failure) : this.avcC ? '' : 'no decoder setup';
  }

  /** Seconds of clip so far. */
  get seconds(): number {
    return this.slot / CLIP.fps;
  }

  private take(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
    if (chunk.timestamp <= this.lastTimestamp) this.failure = new Error('the encoder reordered frames');
    this.lastTimestamp = chunk.timestamp;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const description = meta?.decoderConfig?.description;
    if (description && !this.avcC) this.avcC = bytesOf(description);
    this.frames.push({ data, key: chunk.type === 'key', at: chunk.timestamp });
    this.trim();
  }

  /** Keeps the last `keep` seconds, starting on a key frame (there is one every second). */
  private trim() {
    if (!this.keep) return;
    const from = (this.slot / CLIP.fps - this.keep) * 1e6;
    let cut = 0;
    for (let i = 0; i < this.frames.length; i += 1) {
      const f = this.frames[i]!;
      if (f.at > from) break;
      if (f.key) cut = i;
    }
    if (cut > 0) this.frames.splice(0, cut);
  }

  /** Encodes the canvas as the picture of grid slot `slot`. */
  private encode(slot: number) {
    if (this.closed || this.failure) return;
    const second = Math.floor(slot / CLIP.fps);
    const key = second > this.keyed;
    if (key) this.keyed = second;
    const frame = new VideoFrame(this.canvas, { timestamp: Math.round(slot * STEP_US), duration: Math.round(STEP_US) });
    try {
      this.encoder.encode(frame, { keyFrame: key });
    } catch (e) {
      this.failure = e;
    } finally {
      frame.close();
    }
  }

  private frame = (source: HTMLCanvasElement) => {
    const now = Math.floor(((performance.now() - this.t0) / 1000) * CLIP.fps);
    if (now < this.slot) return;
    // The encoder is behind: this picture is skipped and the last one shown lasts longer.
    if (this.encoder.encodeQueueSize > BACKLOG) return;
    this.draw(this.ctx, source, now / CLIP.fps);
    this.encode(now);
    this.slot = now + 1;
  };

  /** Starts (or resumes) filming the city's frames. */
  start() {
    if (this.untap || this.closed) return;
    this.t0 = performance.now() - (this.slot / CLIP.fps) * 1000;
    this.untap = streamFrames(this.frame);
  }

  /** Stops filming the city; the clip can still get drawn frames and be finished. */
  stop() {
    this.untap?.();
    this.untap = null;
  }

  /** Appends `seconds` of frames drawn without the city (the end card), as fast as the encoder takes them. */
  async append(seconds: number, draw: DrawClip) {
    this.stop();
    const start = this.slot;
    const count = Math.round(seconds * CLIP.fps);
    const until = performance.now() + PATIENCE_MS;
    for (let i = 0; i < count && !this.failure && !this.closed; i += 1) {
      draw(this.ctx, null, (this.slot - start) / CLIP.fps);
      this.encode(this.slot);
      this.slot += 1;
      while (this.encoder.encodeQueueSize > BACKLOG && !this.closed && !this.failure) {
        if (performance.now() > until) this.failure = new Error('the encoder is too slow on this device');
        else await new Promise((r) => setTimeout(r, 8));
      }
    }
  }

  /** The clip as an MP4, or null if this browser's encoder failed on the way or filmed almost nothing. */
  async finish(): Promise<Blob | null> {
    this.stop();
    if (this.closed) return null;
    try {
      if (!this.failure) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the encoder is too slow on this device')), PATIENCE_MS);
        });
        await Promise.race([this.encoder.flush(), late]).finally(() => clearTimeout(timer));
      }
    } catch (e) {
      this.failure ??= e;
    }
    const avcC = this.avcC;
    const first = this.frames.findIndex((f) => f.key);
    const frames = first < 0 ? [] : this.frames.slice(first);
    this.close();
    if (this.failure || !avcC || frames.length < 2) return null;
    const span = (frames[frames.length - 1]!.at - frames[0]!.at) / 1e6;
    if (span < 1) return null;
    const bytes = muxMp4({ width: CLIP.width, height: CLIP.height, fps: CLIP.fps, avcC, frames });
    return new Blob([bytes as BlobPart], { type: 'video/mp4' });
  }

  /** Drops everything filmed. */
  close() {
    this.stop();
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      // already closed
    }
    this.frames = [];
  }
}
