/**
 * A gzipped tarball out of a few files in memory (CITY-238): what a machine's file API takes (`drivers/vercel.ts`
 * writes a job this way, `image.mjs` the image). Plain ustar — regular files only, names up to 255 bytes split at a
 * slash, no times, no owners — so the same files always give the same bytes before gzip.
 *
 * Pure: no store, no clock, no network.
 */

import { gzipSync } from "node:zlib";

export type TarFile = { readonly name: string; readonly data: Uint8Array | string };

const BLOCK = 512;

function field(header: Buffer, text: string, offset: number, length: number): void {
  header.write(text, offset, length, "utf8");
}

/** A name as ustar holds it: `name` (100) and, for a longer one, `prefix` (155) cut at a slash. */
function split(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  for (let at = name.indexOf("/"); at !== -1; at = name.indexOf("/", at + 1)) {
    const prefix = name.slice(0, at);
    const rest = name.slice(at + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return { name: rest, prefix };
  }
  throw new RangeError(`a tar name is at most 255 bytes, cut at a slash: ${name.slice(0, 80)}`);
}

function headerOf(file: { name: string; size: number }): Buffer {
  if (!file.name || file.name.startsWith("/") || file.name.split("/").includes("..")) throw new RangeError(`a tar name is a relative path: ${file.name.slice(0, 80)}`);
  const { name, prefix } = split(file.name);
  const header = Buffer.alloc(BLOCK);
  field(header, name, 0, 100);
  field(header, "0000644\0", 100, 8);
  field(header, "0000000\0", 108, 8);
  field(header, "0000000\0", 116, 8);
  field(header, `${file.size.toString(8).padStart(11, "0")}\0`, 124, 12);
  field(header, "00000000000\0", 136, 12);
  field(header, "        ", 148, 8);
  field(header, "0", 156, 1);
  field(header, "ustar\0", 257, 6);
  field(header, "00", 263, 2);
  field(header, prefix, 345, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  field(header, `${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

/** The files as one uncompressed tar. */
export function tar(files: readonly TarFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    const data = typeof file.data === "string" ? Buffer.from(file.data, "utf8") : Buffer.from(file.data);
    parts.push(headerOf({ name: file.name, size: data.length }), data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

/** The files as a `.tar.gz`. */
export const tarGz = (files: readonly TarFile[]): Buffer => gzipSync(tar(files), { level: 9 });
