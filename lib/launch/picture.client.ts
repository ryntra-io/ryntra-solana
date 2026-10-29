/**
 * A token's picture as the launch takes it: a 512 px square (centre crop), WebP — or PNG where the browser cannot write
 * WebP — under the size the server takes, as a data: address. One function for every place a creator picks the picture:
 * the launch form and the launch dock on the home page, so both hand the same bytes to the same review.
 */

import { imageTypeOf, IMAGE_MAX_BYTES } from "./form.ts";

export type Picture = Readonly<{ url: string; base64: string; bytes: number }>;

/** The picture shrunk to a 512 px square; null when the file is no picture every wallet shows. */
export async function shrinkPicture(file: File): Promise<Picture | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!imageTypeOf(head)) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  for (const [type, quality] of [["image/webp", 0.9], ["image/webp", 0.75], ["image/png", undefined], ["image/jpeg", 0.85]] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.size > IMAGE_MAX_BYTES) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!imageTypeOf(bytes)) continue;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary);
    /* A data: address, not a blob: one — the product's content policy shows images from itself and data: only. */
    return { url: `data:${imageTypeOf(bytes)};base64,${base64}`, base64, bytes: bytes.length };
  }
  return null;
}
