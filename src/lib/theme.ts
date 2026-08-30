/**
 * Erscheinungsbild: Themenliste, Auflösung und Anwendung.
 *
 * Hier steht *was* es gibt und *wann* es gilt · die Farben selbst stehen
 * ausschließlich in `src/themes.css`. Angewendet wird ein Thema, indem am
 * <html> `data-theme` (und für ein abweichendes Brett `data-board`) gesetzt
 * wird; die Tokens der Oberfläche wechseln dann in einem Zug, ohne dass eine
 * Komponente davon weiß.
 *
 * Das Modul führt den Zustand selbst, nicht React: Das Thema hängt an drei
 * Quellen, die zu verschiedenen Zeiten eintreffen — den Einstellungen, der
 * Systemvorgabe (hell/dunkel) und der Uhrzeit —, und zusätzlich am
 * Plus-Status. Jede Änderung läuft durch `apply()`, sodass es genau einen Weg
 * ans <html> gibt.
 */
import { invoke } from "@tauri-apps/api/core";

import type { Key } from "./i18n";
import { featureUnlocked, subscribePlus } from "./plus/store";
import { getSettings, type Settings } from "./settings";

export type ThemeId =
  | "dark"
  | "light"
  | "dusk"
  | "graphite"
  | "paper"
  | "contrast"
  | "signal"
  | "rose";

export interface ThemeDef {
  id: ThemeId;
  /** Nur mit Kiebitz Plus wählbar. */
  plus: boolean;
  /**
   * Helle Grundfläche. Steuert zweierlei: welches Thema der Systemabgleich als
   * Tagseite versteht, und worauf ein Plus-Thema zurückfällt, wenn die
   * Freischaltung endet — wer „Papier" gewählt hat, will hell bleiben.
   */
  light: boolean;
  nameKey: Key;
  descKey: Key;
}

/** Reihenfolge in der Auswahl: erst frei, dann Plus. */
export const THEMES: readonly ThemeDef[] = [
  { id: "dark", plus: false, light: false, nameKey: "theme.dark", descKey: "theme.darkNote" },
  { id: "light", plus: false, light: true, nameKey: "theme.light", descKey: "theme.lightNote" },
  { id: "dusk", plus: true, light: false, nameKey: "theme.dusk", descKey: "theme.duskNote" },
  {
    id: "graphite",
    plus: true,
    light: false,
    nameKey: "theme.graphite",
    descKey: "theme.graphiteNote",
  },
  { id: "paper", plus: true, light: true, nameKey: "theme.paper", descKey: "theme.paperNote" },
  {
    id: "contrast",
    plus: true,
    light: false,
    nameKey: "theme.contrast",
    descKey: "theme.contrastNote",
  },
  { id: "signal", plus: true, light: false, nameKey: "theme.signal", descKey: "theme.signalNote" },
  { id: "rose", plus: true, light: false, nameKey: "theme.rose", descKey: "theme.roseNote" },
];

export const DEFAULT_THEME: ThemeId = "dark";

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function themeDef(id: ThemeId): ThemeDef {
  return THEME_BY_ID.get(id) ?? THEME_BY_ID.get(DEFAULT_THEME)!;
}

/** Prüft einen gespeicherten Wert (Einstellungen, localStorage). */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_BY_ID.has(value as ThemeId);
}

/** Brett-Sets · "auto" heißt: das Brett des Themas. */
export type BoardSetId = "auto" | "forest" | "graphite" | "sepia" | "ice" | "contrast";

export interface BoardSetDef {
  id: BoardSetId;
  nameKey: Key;
}

export const BOARD_SETS: readonly BoardSetDef[] = [
  { id: "auto", nameKey: "board.auto" },
  { id: "forest", nameKey: "board.forest" },
  { id: "graphite", nameKey: "board.graphite" },
  { id: "sepia", nameKey: "board.sepia" },
  { id: "ice", nameKey: "board.ice" },
  { id: "contrast", nameKey: "board.contrast" },
];

export const DEFAULT_BOARD_SET: BoardSetId = "auto";

const BOARD_IDS = new Set(BOARD_SETS.map((set) => set.id));

export function isBoardSetId(value: unknown): value is BoardSetId {
  return typeof value === "string" && BOARD_IDS.has(value as BoardSetId);
}

/** Wann ein zweites Thema übernimmt. */
export type AutoMode = "off" | "system" | "time";

export const AUTO_MODES: readonly AutoMode[] = ["off", "system", "time"];

export function isAutoMode(value: unknown): value is AutoMode {
  return typeof value === "string" && (AUTO_MODES as readonly string[]).includes(value);
}

/** Die vollständige Wahl · dasselbe, was in den Einstellungen liegt. */
export interface Appearance {
  /** Ausdrückliche Wahl bzw. Tagseite eines automatischen Wechsels. */
  theme: ThemeId;
  boardSet: BoardSetId;
  auto: AutoMode;
  /** Nachtseite eines automatischen Wechsels. */
  night: ThemeId;
  /** Nur bei `auto: "time"` · lokale "HH:MM". */
  nightFrom: string;
  nightTo: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  boardSet: DEFAULT_BOARD_SET,
  auto: "off",
  night: "dusk",
  nightFrom: "19:00",
  nightTo: "07:00",
};

/** Liest die Wahl aus den Einstellungen und verwirft dabei Unbekanntes. */
export function appearanceFromSettings(settings: Settings): Appearance {
  return {
    theme: isThemeId(settings.theme) ? settings.theme : DEFAULT_APPEARANCE.theme,
    boardSet: isBoardSetId(settings.board_set) ? settings.board_set : DEFAULT_APPEARANCE.boardSet,
    auto: isAutoMode(settings.theme_auto) ? settings.theme_auto : DEFAULT_APPEARANCE.auto,
    night: isThemeId(settings.theme_night) ? settings.theme_night : DEFAULT_APPEARANCE.night,
    nightFrom: normalizeTime(settings.theme_night_from, DEFAULT_APPEARANCE.nightFrom),
    nightTo: normalizeTime(settings.theme_night_to, DEFAULT_APPEARANCE.nightTo),
  };
}

/** Gegenstück zu `appearanceFromSettings` · was gespeichert werden muss. */
export function settingsFromAppearance(appearance: Appearance): Partial<Settings> {
  return {
    theme: appearance.theme,
    board_set: appearance.boardSet,
    theme_auto: appearance.auto,
    theme_night: appearance.night,
    theme_night_from: appearance.nightFrom,
    theme_night_to: appearance.nightTo,
  };
}

/** Minuten seit Mitternacht oder null. */
function minutesOfDay(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const minutes = minutesOfDay(value);
  if (minutes == null) return fallback;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Liegt `now` im Nachtfenster? Das Fenster geht in aller Regel über
 * Mitternacht (19:00 → 07:00), deshalb der Ringvergleich. Ein Fenster ohne
 * Ausdehnung (from == to) ist keine Nacht.
 */
export function inNightWindow(now: Date, from: string, to: string): boolean {
  const start = minutesOfDay(from);
  const end = minutesOfDay(to);
  if (start == null || end == null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export interface ResolveContext {
  now: Date;
  /** Systemvorgabe „dunkel" · null, wenn die Plattform keine meldet. */
  systemDark: boolean | null;
  /**
   * Sind die Plus-Themen freigeschaltet? `null` heißt „noch unbekannt": Solange
   * die Freischaltung geprüft wird, bleibt die Wahl des Nutzers stehen, statt
   * für einen Wimpernschlag auf Dunkel zu springen.
   */
  plus: boolean | null;
}

/** Das Thema, das gelten soll · einzige Stelle, die darüber entscheidet. */
export function resolveTheme(appearance: Appearance, context: ResolveContext): ThemeId {
  const night =
    appearance.auto === "system"
      ? context.systemDark === true
      : appearance.auto === "time"
        ? inNightWindow(context.now, appearance.nightFrom, appearance.nightTo)
        : false;
  return allowed(night ? appearance.night : appearance.theme, context.plus);
}

/** Ohne Plus fällt ein Plus-Thema auf das freie Thema derselben Helligkeit. */
function allowed(id: ThemeId, plus: boolean | null): ThemeId {
  const def = themeDef(id);
  if (!def.plus || plus !== false) return def.id;
  return def.light ? "light" : "dark";
}

/**
 * Zwischenspeicher für den Kaltstart.
 *
 * Die Einstellungen kommen aus dem Backend und damit erst nach dem ersten
 * Bild. Ohne diesen Wert stünde die App für einen Moment in Dunkel, bevor sie
 * auf Hell umspringt · das Aufblitzen ist genau das, was ein Thema für
 * empfindliche Augen verhindern soll. Das Startskript in index.html liest
 * denselben Schlüssel, bevor React überhaupt lädt.
 */
const CACHE_KEY = "kiebitz.appearance";

interface CachedAppearance {
  theme: ThemeId;
  /** Fehlt, wenn das Brett dem Thema folgt. */
  board?: BoardSetId;
  /**
   * Grundton des Themas, wie er zuletzt tatsächlich gemessen wurde. Das
   * Startskript malt damit die Seite, bevor das Stylesheet steht · so kommt es
   * ohne eigene Farbtabelle aus.
   */
  bg?: string;
}

function readCache(): CachedAppearance | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { theme, board, bg } = parsed as Record<string, unknown>;
    if (!isThemeId(theme)) return null;
    return {
      theme,
      board: isBoardSetId(board) ? board : DEFAULT_BOARD_SET,
      bg: typeof bg === "string" ? bg : undefined,
    };
  } catch {
    return null;
  }
}

function writeCache(value: CachedAppearance) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Privater Modus oder abgeschalteter Speicher · dann eben ohne Vorgriff.
  }
}

/** Meldung an alles, was Farben nicht über CSS bezieht (z. B. die Diagramme). */
export const APPEARANCE_EVENT = "kiebitz:appearance";

let appearance: Appearance = DEFAULT_APPEARANCE;
let plusUnlocked: boolean | null = null;
let applied: ThemeId | null = null;
let appliedBoard: BoardSetId | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function systemDark(): boolean | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Wendet die aufgelöste Wahl auf das Dokument an · idempotent. */
function apply() {
  if (typeof document === "undefined") return;
  const theme = resolveTheme(appearance, { now: new Date(), systemDark: systemDark(), plus: plusUnlocked });
  const board = appearance.boardSet;

  const root = document.documentElement;
  root.dataset.theme = theme;
  // "auto" heißt: kein eigenes Brett · dann muss das Attribut weg, sonst
  // überschriebe ein alter Wert weiterhin das Brett des Themas.
  if (board === DEFAULT_BOARD_SET) delete root.dataset.board;
  else root.dataset.board = board;

  // Erst jetzt, mit gesetztem Attribut, stehen die Tokens des neuen Themas am
  // <html> · und noch vor dem Ausstieg unten: Beim Start bestätigen die
  // Einstellungen bloß das zwischengespeicherte Thema, die Titelleiste hat es
  // dann aber noch nie gehört.
  paintTitlebar(theme);

  if (theme === applied && board === appliedBoard) return;
  applied = theme;
  appliedBoard = board;

  // Den Grundton für den nächsten Kaltstart mitnehmen, statt ihn ein zweites
  // Mal aufzuschreiben · gemessen wird, was die Themendatei gerade sagt.
  const bg = getComputedStyle(root).getPropertyValue("--color-bg").trim();
  if (bg) root.style.background = bg;
  // Das Brett steht nur im Zwischenspeicher, wenn es vom Thema abweicht ·
  // so setzt das Startskript kein `data-board="auto"`, das es nicht gibt.
  writeCache({ theme, board: board === DEFAULT_BOARD_SET ? undefined : board, bg });
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: theme }));
}

/**
 * Die Windows-Titelleiste in den Farben des Themas.
 *
 * Sie gehört nicht zum Dokument, also erreicht sie kein Stylesheet · das
 * Backend setzt die DWM-Attribute des Fensters. Die Werte kommen trotzdem aus
 * `themes.css`: Hier wird gemessen, was am <html> gerade gilt, damit es keine
 * zweite Farbtabelle in Rust gibt (siehe `src-tauri/src/titlebar.rs`).
 *
 * Schlägt der Aufruf fehl, gibt es keine Tauri-Shell (Web-Vorschau, Tests) ·
 * dann bleibt es dabei, statt bei jedem Themenwechsel erneut anzuklopfen.
 */
let titlebar = true;
let painted: ThemeId | null = null;

function paintTitlebar(theme: ThemeId) {
  if (!titlebar || theme === painted || typeof document === "undefined") return;
  const style = getComputedStyle(document.documentElement);
  const caption = style.getPropertyValue("--color-panel").trim();
  const text = style.getPropertyValue("--color-ink").trim();
  const border = style.getPropertyValue("--color-line").trim();
  // Ohne geladenes Stylesheet ist nichts zu messen · dann lieber nichts sagen
  // als die Leiste auf Schwarz ziehen. Der nächste Anlauf holt es nach.
  if (!caption || !text || !border) return;
  painted = theme;
  try {
    void invoke("set_titlebar", {
      caption,
      text,
      border,
      // Helle Schrift auf dunkler Leiste · steuert Hover und Systemmenü.
      dark: !themeDef(theme).light,
    }).catch(() => {
      titlebar = false;
    });
  } catch {
    titlebar = false;
  }
}

/** Das gerade angewendete Thema (nicht unbedingt das gewählte). */
export function appliedTheme(): ThemeId {
  return applied ?? readCache()?.theme ?? DEFAULT_THEME;
}

/**
 * Übernimmt eine neue Wahl. Die Einstellungsseite ruft das beim Antippen einer
 * Kachel auf, damit das Thema sofort steht und nicht erst nach dem Speichern.
 */
export function setAppearance(next: Appearance) {
  appearance = next;
  syncTimer();
  apply();
  for (const listener of listeners) listener();
}

/**
 * Die getroffene Wahl · nicht zu verwechseln mit `appliedTheme()`: Ohne Plus
 * oder mitten in der Nacht steht auf dem Bildschirm etwas anderes als in den
 * Einstellungen, und die Kachel soll zeigen, was gewählt ist.
 */
export function currentAppearance(): Appearance {
  return appearance;
}

const listeners = new Set<() => void>();

/**
 * Abonniert die Wahl (für `useSyncExternalStore`). Die Einstellungsseite hängt
 * daran, statt die Wahl ein zweites Mal im eigenen Zustand zu führen · sonst
 * liefe die Markierung auf der Kachel gegen das, was tatsächlich gilt.
 */
export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Meldet den Plus-Status. `null` = noch in Prüfung; erst ein ausdrückliches
 * `false` holt ein Plus-Thema auf den freien Ersatz zurück.
 */
export function setPlusUnlocked(value: boolean | null) {
  if (value === plusUnlocked) return;
  plusUnlocked = value;
  apply();
}

/** Feature-Kennung der Plus-Themen · dieselbe wie im Gate der Einstellungen. */
export const THEME_FEATURE = "advanced_themes" as const;

/**
 * Der Uhrzeit-Wechsel braucht einen Takt · einmal pro Minute genügt für eine
 * Grenze, die auf Minuten genau gesetzt wird. Er läuft nur, wenn er gebraucht
 * wird, damit ein Gerät ohne automatischen Wechsel keinen Timer trägt.
 */
function syncTimer() {
  const needed = appearance.auto === "time";
  if (needed === (timer !== null)) return;
  if (needed) timer = setInterval(apply, 60_000);
  else if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

let started = false;

/**
 * Startet die Steuerung: gespeicherte Wahl anwenden, danach die aus den
 * Einstellungen, und auf die Systemvorgabe hören.
 */
export function initAppearance() {
  if (started) return;
  started = true;

  // Vor allem anderen der zwischengespeicherte Stand · das Startskript hat ihn
  // bereits gesetzt, hier wird der Modulzustand darauf gebracht.
  const cached = readCache();
  if (cached) {
    applied = cached.theme;
    appliedBoard = cached.board ?? DEFAULT_BOARD_SET;
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    // Safari unter iOS kennt addEventListener am MediaQueryList erst ab 14.
    if (typeof query.addEventListener === "function") query.addEventListener("change", apply);
    else query.addListener(apply);
  }

  // Die Freischaltung entscheidet mit · dieselbe Regel wie in jedem anderen
  // Gate, damit ein abgelaufenes Plus die Themenwahl nicht überlebt.
  subscribePlus((state) =>
    setPlusUnlocked(state.loading ? null : featureUnlocked(THEME_FEATURE, state))
  );

  void getSettings()
    .then((settings) => setAppearance(appearanceFromSettings(settings)))
    .catch(() => {
      // Ohne Backend (Web-Vorschau) bleibt es beim zwischengespeicherten Stand.
      apply();
    });
}
