import sharp from "sharp";

import type { GuardStore } from "../guard/store.ts";
import { readLaunchImage } from "./metadata.server.ts";

/**
 * A launched token's picture for its card (SOL-L1e), as a PNG data address — or nothing, and the card draws the
 * ticker's letter. Launch keeps every picture itself (`/api/launch/image/<sha256>`, WebP, PNG, JPEG or GIF; the
 * metadata of a Ryntra launch names no other), so it is read from the store and never fetched over the network; the
 * card's renderer draws only PNG and JPEG, so the picture is drawn again as a small PNG.
 */

const SIDE = 208;
const OWN_PATH = /^\/api\/launch\/image\/([0-9a-f]{64})$/;

export async function pngOf(bytes: Uint8Array): Promise<string | null> {
  try {
    const png = await sharp(bytes, { animated: false, limitInputPixels: 25_000_000 }).resize(SIDE, SIDE, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function launchPicture(store: GuardStore, address: string | null): Promise<string | null> {
  if (!address) return null;
  let path: string;
  try {
    path = new URL(address).pathname;
  } catch {
    return null;
  }
  const own = OWN_PATH.exec(path);
  const stored = own ? await readLaunchImage(store, own[1]).catch(() => null) : null;
  return stored ? pngOf(Buffer.from(stored.base64, "base64")) : null;
}
