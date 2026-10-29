import { useEffect, useState } from 'react';

/**
 * How far a phone's keyboard covers the page (CSS px), so a sheet at the bottom stands above it. A browser that
 * resizes the page for the keyboard reads 0: the page's own bottom is already above it.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const measure = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    measure();
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, []);
  return inset;
}
