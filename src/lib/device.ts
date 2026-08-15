/** Client-side device helpers (no Node APIs). */

export function isAppleTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Phones/tablets where SVG foreignObject capture is fragile (iOS + Android). */
export function isConstrainedCaptureDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  if (isAppleTouchDevice()) return true;
  return (
    navigator.maxTouchPoints > 1 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function hasSaveFilePicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (
      window as Window & {
        showSaveFilePicker?: unknown;
      }
    ).showSaveFilePicker === "function"
  );
}
