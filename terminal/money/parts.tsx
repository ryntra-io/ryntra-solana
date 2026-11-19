'use client';

import { useEffect, useState } from 'react';
import m from './money.module.css';

/** The QR's two colours: dark modules on the brand's warm white, which every scanner reads (the terminal's ink and warm). */
const QR_DARK = '#0b0a14';
const QR_LIGHT = '#ffe7c2';

/** A QR of exactly `value`, drawn here from the value itself; a still well of the same size until it is drawn. */
export function Qr({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    void import('qrcode')
      .then((QRCode) => QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size * 2, color: { dark: QR_DARK, light: QR_LIGHT } }))
      .then((url) => live && setData(url))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [value, size]);
  return (
    <div className={m.qr} data-size={size}>
      {/* A data address drawn here; there is no remote file for an image component. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data ? <img src={data} alt={label} width={size} height={size} /> : <span className={m.qrBone} aria-hidden="true" />}
    </div>
  );
}

/** A copy that says it copied, for two seconds; the text stands on screen whole either way. */
export function useCopy(): [copied: string | null, copy: (text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(text))
      .catch(() => undefined);
  };
  return [copied, copy];
}
