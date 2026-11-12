'use client';

import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';

/**
 * drei's `Html` for a sign that stands in the scene from its first frame (CITY-241). `Html` builds its own React root
 * on its own element, appended to the canvas's event target, and tears that root down synchronously whenever the target
 * changes or the scene's layout effects are taken down — and the root it then builds again on the same element is
 * cleared a moment later, leaving the sign empty. Both happen to a sign mounted with the scene: the canvas connects its
 * events only after it is created, which moves the target; and whenever something in the scene suspends — a model, a
 * texture — the canvas's Suspense boundary takes every layout effect down and puts it back. The Vault's name never
 * showed. So the sign stands in the canvas's own box, which never moves, and is drawn afresh — a new element, a root of
 * its own — each time the scene comes back.
 */
export function SceneHtml(props: Omit<ComponentProps<typeof Html>, 'portal'>) {
  const gl = useThree((s) => s.gl);
  const portal = useMemo(() => ({ current: gl.domElement.parentElement }), [gl]);
  const [generation, setGeneration] = useState(0);
  const runs = useRef(0);
  useLayoutEffect(() => {
    runs.current += 1;
    // The first run is the mount; every later one is the scene shown again after a suspension.
    if (runs.current > 1) setGeneration((n) => n + 1);
  }, []);
  if (!portal.current) return null;
  return <Html key={generation} portal={portal as { current: HTMLElement }} {...props} />;
}
