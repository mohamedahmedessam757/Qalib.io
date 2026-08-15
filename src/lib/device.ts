/** Client-side device helpers (no Node APIs). */

export function isAppleTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
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
