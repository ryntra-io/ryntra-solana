"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon, words, type Lang } from "@ryntra/core/ui";

/**
 * A page's heading with its explanation behind a «?» beside it — never a line printed under it. The same toggle and panel as
 * the core's `Page`, for the pages that draw their own heading.
 */
export function PageTitle({
  title,
  help,
  lang,
  id,
  className,
}: {
  title: ReactNode;
  /** What the page is for, in a sentence or two: opened by the «?», hidden until then. */
  help?: ReactNode;
  lang: Lang;
  /** The heading's id, for a section labelled by it. */
  id?: string | undefined;
  className?: string | undefined;
}) {
  const w = words(lang).page;
  const helpId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="ryntra-page__heading">
      <div className="ryntra-page__title-row">
        <h1 id={id} className={className}>
          {title}
        </h1>
        {help ? (
          <button
            type="button"
            className="ryntra-icon-button ryntra-page__help-toggle"
            aria-expanded={open}
            aria-controls={helpId}
            aria-label={open ? w.hideHelp : w.help}
            title={open ? w.hideHelp : w.help}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name="circle-help" size={16} />
          </button>
        ) : null}
      </div>
      {help ? (
        <div className="ryntra-page__help" id={helpId} hidden={!open}>
          {help}
        </div>
      ) : null}
    </div>
  );
}
