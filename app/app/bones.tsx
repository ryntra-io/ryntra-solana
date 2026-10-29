"use client";

import { Block, Page, Skeleton, type PageKind } from "@ryntra/core/ui";

import styles from "./bones.module.css";

/**
 * The shape of a cabinet page that is still being read — the page's own geometry, not a sentence standing in for it.
 *
 * «Loading…» as a paragraph costs the page everything below it: the heading arrives at one height, then jumps to
 * another, and a person who reached for a row watches it slide out from under their thumb. So the bones are the core's
 * own `Page` and `Block`: the page's padding, its gaps, its heading's line and a block's frame come from the same
 * tokens the loaded page reads, and each block reserves the lines it will hold. The heading lands where it will stand,
 * and the first block's top edge does not move when the numbers come.
 *
 * A page whose content has a height of its own — a chart, a terminal — reserves that height itself, in its own
 * stylesheet, from the same custom property the loaded block reads.
 */
export function PageBones({ kind = "overview", blocks = [3, 4, 2], label, className }: { kind?: PageKind; blocks?: readonly number[]; label: string; className?: string }) {
  return (
    <Page
      kind={kind}
      /* The heading's place, exactly its own line tall: a block inside the heading leaves the line box out of it. */
      title={<span className={styles.title} aria-hidden="true" />}
      className={className ? `${styles.page} ${className}` : styles.page}
      aria-busy="true"
      data-surface-state="LOADING"
    >
      {blocks.map((lines, index) => (
        /* The block's own frame and head from the core, the head's word reserved to its line: a block of three lines
           while it reads is a block of three lines once it has read. */
        <Block key={index} title={<span className={styles.blockTitle} aria-hidden="true" />} aria-busy="true">
          <Skeleton lines={lines} label={index === 0 ? label : ""} />
        </Block>
      ))}
    </Page>
  );
}
