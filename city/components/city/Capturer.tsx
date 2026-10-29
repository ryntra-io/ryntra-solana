'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { deliverFrame, hasFrameRequests } from '@/city/lib/capture';

/** Runs after the composer (priority 2) and hands the finished frame to whoever asked for it. */
export function Capturer() {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (hasFrameRequests()) deliverFrame(gl.domElement);
  }, 2);
  return null;
}
