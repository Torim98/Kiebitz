/** Extracts a readable message from native/Tauri errors as well as JS errors. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const nativeMessage = (error as { message?: unknown }).message;
    if (typeof nativeMessage === "string" && nativeMessage.trim()) return nativeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through for exotic/circular host objects.
    }
  }
  return String(error);
}
