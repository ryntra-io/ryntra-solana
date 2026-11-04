import QRCode from 'qrcode';

/**
 * The payer page's QR, drawn on the server so the first paint already has it: dark modules on the city's warm tile,
 * which every phone camera reads (`city/components/money/bits.tsx` draws the same colours in the browser).
 *
 * It carries the page's own HTTPS link, not a `solana:` transfer request: any camera opens the page, and the page hands
 * itself to the wallet app — Phantom's documented phone path. The founder's Phantom scanner refused the `solana:` request
 * as «not a valid address»; that link stays one tap deep on the page, as «Another wallet».
 */
export async function payerQr(pageUrl: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(pageUrl, { errorCorrectionLevel: 'M', margin: 1, width: 480, color: { dark: '#0b0a14', light: '#fff6e6' } });
  } catch {
    return null;
  }
}
