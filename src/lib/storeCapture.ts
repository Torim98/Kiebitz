/**
 * Opt-in capture mode for reproducible store assets.
 *
 * It is only active in development and keeps browser-preview labels and
 * personal demo handles out of screenshots. Production builds ignore the
 * query parameter entirely.
 */
export function isStoreCapture(): boolean {
  const localPreview = window.location.hostname === "127.0.0.1"
    || window.location.hostname === "localhost";
  return localPreview && new URLSearchParams(window.location.search).has("store-capture");
}
