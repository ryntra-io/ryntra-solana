/**
 * Handing a person a file they asked for.
 *
 * Separate from the receipt vault's `downloadReceipt`, which validates that
 * what it is given is a receipt before offering it — that check is the point of
 * that function and would be wrong here, where the caller has already decided
 * what the file is. Shared rather than inlined because History is the first
 * export and not the last.
 *
 * Never throws. A browser that refuses object URLs, a sandbox that blocks the
 * click, a quota that is full — all of them return `false`, and the surface
 * says the export did not happen rather than failing to render.
 */
export function downloadTextFile(
  contents: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
): boolean {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return false;
  let url: string | null = null;
  try {
    /* A BOM, because the most common destination for a CSV is a spreadsheet on
       Windows, and without one it reads UTF-8 bytes as the system codepage and
       turns every non-Latin name into mojibake. */
    const bom = mime.startsWith("text/csv") ? "﻿" : "";
    const blob = new Blob([bom + contents], { type: mime });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    return false;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
