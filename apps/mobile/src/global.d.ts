declare module '*.css'

/** The QR encoder's core alone — no canvas, no file system; the matrix is drawn with react-native-svg. */
declare module 'qrcode/lib/core/qrcode.js' {
  export function create(
    text: string,
    options?: Readonly<{ errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }>,
  ): Readonly<{ modules: Readonly<{ size: number; data: Uint8Array }>; version: number }>
}
