/**
 * Build the next duplicate title: "Report" → "Report 1" → "Report 2".
 * Strips an existing trailing number so copying "Report 1" yields "Report 2".
 */
export function nextDuplicateTitle(
  sourceTitle: string,
  existingTitles: string[],
): string {
  const cleaned = sourceTitle.replace(/\s+/g, " ").trim() || "document";
  const base = cleaned.replace(/\s+\d+$/, "").trim() || cleaned;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`, "i");

  let max = 0;
  for (const title of existingTitles) {
    const m = String(title || "").replace(/\s+/g, " ").trim().match(re);
    if (!m) continue;
    const n = m[1] ? Number.parseInt(m[1], 10) : 0;
    if (Number.isFinite(n) && n > max) max = n;
  }

  return `${base} ${max + 1}`.slice(0, 180);
}
