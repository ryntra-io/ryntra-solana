"use client";

import { WORDMARK_BOX } from "@/app/brand/generated/wordmark-box";
import { WORDMARK_DARK_UI_DATA_URI } from "@/app/brand/generated/wordmark-dark-ui";
import type { CardFace } from "@/lib/growth/card-face";
import { muxAvcMp4, type Mp4Sample } from "@/lib/growth/mp4";
import { CARD, FILM_COVER_MS, FILM_FADE_MS, FILM_FPS, FILM_MS, STILL, cardBackdropSvg, drawCardScene, svgDataUri, type SceneAssets, type SceneFonts } from "@/lib/growth/card-scene";

/**
 * What the live card and its film need in the browser: the pictures the
 * scene draws, the page's own Geist faces, and the film itself.
 *
 * Every picture is a data address (the backdrop, the wordmark, the rank's
 * badge, the token's picture fetched by the server), so a canvas that draws
 * them stays readable and can be turned into a video.
 */

function image(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const element = new Image();
    element.decoding = "async";
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = src;
  });
}

export async function loadSceneAssets(face: CardFace): Promise<SceneAssets | null> {
  const [backdrop, wordmark, badge, icon] = await Promise.all([
    image(svgDataUri(cardBackdropSvg())),
    image(WORDMARK_DARK_UI_DATA_URI),
    face.rank ? image(face.rank.badge) : Promise.resolve(null),
    face.icon ? image(face.icon) : Promise.resolve(null),
  ]);
  if (!backdrop || !wordmark) return null;
  return { backdrop, wordmark, wordmarkRatio: WORDMARK_BOX.width / WORDMARK_BOX.height, badge, icon };
}

/** The families the root layout loads Geist under, waited for with the card's own words so Cyrillic is in. */
export async function sceneFonts(face: CardFace): Promise<SceneFonts> {
  const style = getComputedStyle(document.documentElement);
  const sans = style.getPropertyValue("--font-geist").trim() || "system-ui, sans-serif";
  const mono = style.getPropertyValue("--font-geist-mono").trim() || "ui-monospace, monospace";
  const sample = [face.kindLabel, face.symbol, face.period, face.offer, face.offerWhy, face.join, face.seal, face.risk, face.ladder?.entryLabel ?? "", face.rank?.name ?? ""].join(" ");
  const figures = `${face.headline} ${face.link} ${face.ladder?.entry ?? ""} ${face.ladder?.exit ?? ""} ${face.facts.map((fact) => fact.value).join(" ")} 0123456789+−%$.,`;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`400 20px ${sans}`, sample),
        document.fonts.load(`600 20px ${sans}`, sample),
        document.fonts.load(`500 20px ${mono}`, figures),
      ]),
      new Promise((resolve) => setTimeout(resolve, 2_500)),
    ]);
  } catch {
    /* The fallback faces still draw the card. */
  }
  return { sans, mono };
}

/* ---------- the film ---------- */

/** H.264 profiles to try, best first: High is what X recommends; Baseline is everywhere. Level 3.1 holds 1200 × 630 at 30 fps. */
const CODECS = ["avc1.64001f", "avc1.4d001f", "avc1.42001f"] as const;

type Config = VideoEncoderConfig;

function configFor(codec: string): Config {
  return { codec, width: CARD.width, height: CARD.height, bitrate: 6_000_000, framerate: FILM_FPS, avc: { format: "avc" }, latencyMode: "quality" };
}

/** Whether this browser can make the film at all. */
export async function filmSupported(): Promise<boolean> {
  if (typeof window === "undefined" || typeof window.VideoEncoder === "undefined" || typeof window.VideoFrame === "undefined") return false;
  for (const codec of CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported(configFor(codec));
      if (support.supported) return true;
    } catch {
      /* try the next */
    }
  }
  return false;
}

async function encodeWith(codec: string, face: CardFace, assets: SceneAssets, fonts: SceneFonts): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("no canvas");
  const samples: Mp4Sample[] = [];
  let avcC: Uint8Array | null = null;
  let failure: unknown = null;
  let lastTimestamp = -1;
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      /* Frames must come out in the order they show: a B-frame would need offsets this file does not write. */
      if (chunk.timestamp <= lastTimestamp) failure = new Error("reordered frames");
      lastTimestamp = chunk.timestamp;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === "key" });
      const description = metadata?.decoderConfig?.description;
      if (description && !avcC) {
        avcC = description instanceof ArrayBuffer ? new Uint8Array(description.slice(0)) : new Uint8Array((description as ArrayBufferView).buffer.slice((description as ArrayBufferView).byteOffset, (description as ArrayBufferView).byteOffset + (description as ArrayBufferView).byteLength));
      }
    },
    error(error) {
      failure = error;
    },
  });
  encoder.configure(configFor(codec));
  /* The finished card, drawn once: the cover, and what the fade leaves. */
  const cover = document.createElement("canvas");
  cover.width = CARD.width;
  cover.height = CARD.height;
  const coverCtx = cover.getContext("2d", { alpha: false });
  if (!coverCtx) throw new Error("no canvas");
  drawCardScene(coverCtx, face, assets, fonts, STILL, true);
  const frames = Math.round((FILM_MS / 1_000) * FILM_FPS);
  const step = 1_000_000 / FILM_FPS;
  for (let i = 0; i < frames; i += 1) {
    if (failure) break;
    const ms = (i * 1_000) / FILM_FPS;
    if (ms < FILM_COVER_MS) {
      ctx.drawImage(cover, 0, 0);
    } else if (ms < FILM_COVER_MS + FILM_FADE_MS) {
      drawCardScene(ctx, face, assets, fonts, 0, true);
      ctx.globalAlpha = 1 - (ms - FILM_COVER_MS) / FILM_FADE_MS;
      ctx.drawImage(cover, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      drawCardScene(ctx, face, assets, fonts, ms - FILM_COVER_MS - FILM_FADE_MS, true);
    }
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
    encoder.encode(frame, { keyFrame: i % (FILM_FPS * 2) === 0 });
    frame.close();
    /* Let the encoder keep up rather than queueing the whole film in memory. */
    while (encoder.encodeQueueSize > 6) await new Promise((resolve) => setTimeout(resolve, 4));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (!avcC || samples.length !== frames) throw new Error("incomplete film");
  return muxAvcMp4({ width: CARD.width, height: CARD.height, fps: FILM_FPS, avcC, samples });
}

/**
 * The card as a film for X: H.264 in MP4, 1200 × 630, 30 fps, about seven
 * seconds — the finished card, the entrance with the figure whole from its
 * first frame, a second light, held. No sound. Made frame by frame from the same drawing as the live card, so it is
 * the same everywhere, whatever the device's speed.
 */
export async function makeCardFilm(face: CardFace, assets: SceneAssets, fonts: SceneFonts): Promise<Blob> {
  let last: unknown = new Error("no encoder");
  for (const codec of CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported(configFor(codec));
      if (!support.supported) continue;
      const bytes = await encodeWith(codec, face, assets, fonts);
      return new Blob([bytes as BlobPart], { type: "video/mp4" });
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/** A file name a person can recognise: the brand, the token, the card. */
export function cardFileName(face: Pick<CardFace, "symbol">, id: string, extension: "png" | "mp4"): string {
  const token = face.symbol.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 16) || "trade";
  return `ryntra-${token}-${id.slice(0, 8)}.${extension}`;
}

/** Saves `blob` as a download, the way a link with `download` would. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
