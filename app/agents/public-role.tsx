import Link from "next/link";

/*
 * The band that tells a reader which of the two versions they are on.
 *
 * `/agents/passport` and `/agents/workspace/passport` render the same
 * component, and so do the two verifiers — one component, two mounts, which is
 * why there is no duplicated logic to keep in step. What was missing was the
 * *role*: nothing on the public page said it was the public page, so an
 * operator who followed a link out of the workspace had no way to tell they had
 * left, and a person handed a public link had no idea a workspace existed.
 *
 * Public is the shareable one: no session, no workspace chrome, safe to send to
 * somebody outside the product. That is stated here rather than implied by the
 * absence of a sidebar.
 */
export function PublicSurfaceRole({
  what,
  workspaceHref,
}: {
  /** What this surface is, in the product's own words. */
  readonly what: string;
  /** The same surface inside the workspace. */
  readonly workspaceHref: string;
}) {
  return (
    <div className="ag-public-role">
      <span className="ag-public-role-tag">PUBLIC · SHAREABLE · NO ACCOUNT</span>
      <p>
        {what} This page is the shareable version: it holds no session and needs no wallet, so a
        link to it works for anyone.
      </p>
      <Link className="ag-public-role-link" href={workspaceHref}>
        Open in the workspace →
      </Link>
    </div>
  );
}
