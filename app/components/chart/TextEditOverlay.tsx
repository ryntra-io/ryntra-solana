"use client";

/* Inline text editor for the "text" drawing tool. Positioned by the parent
   inside the chart wrapper (.pc-stage). Enter/blur commits, Escape cancels. */

import { useRef, useState } from "react";

function EditInput(props: {
  x: number;
  y: number;
  initial: string;
  onCommit(text: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(props.initial);
  const done = useRef(false);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  return (
    <input
      className="pc-textedit"
      style={{ left: props.x, top: props.y }}
      autoFocus
      spellCheck={false}
      placeholder="Text"
      aria-label="Drawing text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(() => props.onCommit(value));
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(props.onCancel);
        }
      }}
      onBlur={() => finish(() => props.onCommit(value))}
    />
  );
}

export function TextEditOverlay(props: {
  at: { x: number; y: number } | null;
  initial: string;
  onCommit(text: string): void;
  onCancel(): void;
}) {
  if (!props.at) return null;
  return (
    <EditInput
      key={`${props.at.x}:${props.at.y}`}
      x={props.at.x}
      y={props.at.y}
      initial={props.initial}
      onCommit={props.onCommit}
      onCancel={props.onCancel}
    />
  );
}
