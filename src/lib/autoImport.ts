/**
 * Hintergrund-Import der Online-Partien. Läuft beim Start und danach stündlich,
 * solange in den Einstellungen ein Konto hinterlegt und der Import aktiviert
 * ist. Bewusst leise: Fehler (offline, Rate-Limit) landen nicht in der
 * Oberfläche, der nächste Lauf holt die Partien nach.
 */
import type { GameRecord } from "./db";
import { getSettings } from "./settings";

const INTERVAL_MS = 60 * 60 * 1000;
const LAST_RUN_KEY = "kiebitz.autoImport.lastRun";
/** Nicht öfter als alle 30 Minuten, auch nach mehreren App-Starts. */
const MIN_GAP_MS = 30 * 60 * 1000;

function lastRun(): number {
  const value = Number(localStorage.getItem(LAST_RUN_KEY));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Führt einen Import aus, wenn er ansteht. `force` überspringt die Wartezeit.
 * Liefert die Zahl der neu eingefügten Partien (0, wenn nichts lief).
 */
export async function runAutoImport(force = false): Promise<number> {
  const settings = await getSettings();
  if (!settings.auto_import) return 0;
  const accounts = [settings.cc_user.trim(), settings.li_user.trim()].filter(Boolean);
  if (accounts.length === 0) return 0;
  if (!force && Date.now() - lastRun() < MIN_GAP_MS) return 0;

  localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
  // Parser und chess.js erst laden, wenn wirklich ein Import ansteht. Der
  // stündliche Timer selbst bleibt dadurch ein kleiner Start-Helfer.
  const [{ fetchAll }, { upsertGames }, { indexPositions }] = await Promise.all([
    import("./importer"),
    import("./db"),
    import("./analysis"),
  ]);
  const { games } = await fetchAll(settings.cc_user.trim(), settings.li_user.trim(), {
    months: settings.import_months,
  });
  if (games.length === 0) return 0;
  const result = await upsertGames(games as GameRecord[]);
  if (result.inserted > 0) {
    // Stellungsindex nachziehen, damit die Suche die neuen Partien kennt.
    indexPositions().catch(() => {});
  }
  return result.inserted;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Startet den stündlichen Lauf (idempotent). */
export function startAutoImport(): void {
  if (timer != null) return;
  const tick = () => void runAutoImport().catch(() => {});
  timer = setInterval(tick, INTERVAL_MS);
  tick();
}

export function stopAutoImport(): void {
  if (timer == null) return;
  clearInterval(timer);
  timer = null;
}
