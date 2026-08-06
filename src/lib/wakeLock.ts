/**
 * Bildschirmsperre für die Dauer eines langen Vorgangs aufhalten.
 *
 * Android beendet einen Import gern mit dem Bildschirm: die App wandert in den
 * Hintergrund, das System kappt Netzwerk und Prozess. Der Backend-Import setzt
 * deshalb selbst wieder auf (Range-Download, blockweise Transaktionen) · die
 * Wake-Lock erspart den Fall, dass es überhaupt so weit kommt, solange der
 * Nutzer die App offen liegen lässt.
 *
 * Die API gibt es nur in sicheren Kontexten und nicht in jedem WebView; fehlt
 * sie, passiert schlicht nichts.
 */

interface WakeLockSentinel {
  release: () => Promise<void>;
}

interface WakeLockApi {
  request: (type: "screen") => Promise<WakeLockSentinel>;
}

export function keepScreenAwake(): () => void {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  if (!api) return () => {};

  let released = false;
  let sentinel: WakeLockSentinel | null = null;

  const acquire = () => {
    api
      .request("screen")
      .then((next) => {
        if (released) void next.release().catch(() => {});
        else sentinel = next;
      })
      .catch(() => {});
  };

  // Eine einmal verlorene Sperre (Bildschirm aus, Tab im Hintergrund) kommt
  // nicht von allein zurück · beim Zurückkehren wird sie neu angefordert.
  const onVisible = () => {
    if (!released && document.visibilityState === "visible") acquire();
  };

  acquire();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisible);
    void sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
