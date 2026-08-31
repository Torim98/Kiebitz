/**
 * Die Zeichnungen der Figurensets · zwölf SVG-Schnipsel je Set.
 *
 * Getrennt von `./sets.ts`, und zwar aus einem Grund, der nichts mit Ordnung zu
 * tun hat: Die Liste der Sets hängt am Erscheinungsbild (`lib/theme.ts`) und
 * damit am Start der App, die Zeichnungen aber braucht erst, wer ein Brett
 * malt.
 *
 * Und sie kommen einzeln nach. Die mitgelieferten Sätze sind zusammen über
 * hundert Kilobyte Zeichnung · wer beim klassischen Satz bleibt, und das ist
 * die Vorgabe, soll dafür nichts laden. Jedes Set liegt deshalb in einem
 * eigenen Bündel, das erst geholt wird, wenn das Set an der Reihe ist.
 *
 * Bis es da ist, liefert `pieceGlyphs` den klassischen Satz. Das ist keine
 * Notlösung, sondern die Absicht: ein Brett, das eine Bildschirmaktualisierung
 * lang die gewohnten Figuren zeigt, ist besser als eines, das so lange leer
 * bleibt. Wer sich für das Ergebnis interessiert, hängt sich mit
 * `subscribeGlyphs` an · die Figuren tauschen sich dann von selbst aus.
 */
import { PIECE_GLYPH, PIECE_VIEWBOX } from "../../components/pieceGlyphs";
import type { PieceSetId } from "./sets";

/**
 * Woher die Zeichnungen eines Sets kommen · "classic" fehlt, den Satz bringt
 * das Brett mit.
 *
 * Der Typ sorgt dafür, dass ein neues Set nicht halb ankommt: Wer in
 * `./sets.ts` eine Kennung erfindet, muss hier sagen, wo ihre Figuren liegen,
 * sonst übersetzt es nicht.
 */
const SOURCES: Record<Exclude<PieceSetId, "classic">, () => Promise<Record<string, string>>> = {
  kiebitz: () => import("./drawn").then((module) => module.KIEBITZ_GLYPHS),
  monolith: () => import("./drawn").then((module) => module.MONOLITH_GLYPHS),
  merida: () => import("./vendor/merida").then((module) => module.MERIDA_GLYPHS),
  fantasy: () => import("./vendor/fantasy").then((module) => module.FANTASY_GLYPHS),
  chessnut: () => import("./vendor/chessnut").then((module) => module.CHESSNUT_GLYPHS),
};

const built = new Map<PieceSetId, Record<string, string>>([["classic", PIECE_GLYPH]]);
const running = new Map<PieceSetId, Promise<Record<string, string>>>();

const listeners = new Set<() => void>();
let version = 0;

/**
 * Zählt jedes angekommene Set. React braucht einen Wert, der sich ändert ·
 * die Tabellen selbst wechseln nur einmal und sagen nichts darüber, ob
 * *irgendein* anderes Set inzwischen da ist (die Vorschau in den Einstellungen
 * zeigt alle nebeneinander).
 */
export function glyphsVersion(): number {
  return version;
}

export function subscribeGlyphs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Die zwölf Zeichnungen eines Sets · der klassische Satz, solange das gewählte
 * noch unterwegs ist. Die Tabelle behält ihre Identität, sobald sie einmal da
 * ist; `useSyncExternalStore` verlässt sich darauf.
 */
export function pieceGlyphs(id: PieceSetId): Record<string, string> {
  return built.get(id) ?? PIECE_GLYPH;
}

/** Ist das Set schon zur Hand? */
export function pieceGlyphsReady(id: PieceSetId): boolean {
  return built.has(id);
}

/**
 * Holt die Zeichnungen eines Sets · mehrfach aufzurufen ist erlaubt und lädt
 * einmal. Schlägt das Laden fehl, bleibt es beim klassischen Satz: Ein
 * Figurensatz ist Ausstattung, kein Grund, ein Brett scheitern zu lassen.
 */
export function loadPieceGlyphs(id: PieceSetId): Promise<Record<string, string>> {
  const ready = built.get(id);
  if (ready) return Promise.resolve(ready);

  const started = running.get(id);
  if (started) return started;

  const load = SOURCES[id as Exclude<PieceSetId, "classic">]()
    .then((glyphs) => {
      built.set(id, glyphs);
      running.delete(id);
      version += 1;
      for (const listener of listeners) listener();
      return glyphs;
    })
    .catch(() => {
      running.delete(id);
      return PIECE_GLYPH;
    });
  running.set(id, load);
  return load;
}

/**
 * Ausschnitt um eine Figur · für alle Sets derselbe, damit eine geschlagene
 * Figur genauso beschnitten ist wie dieselbe Figur auf dem Brett.
 */
export { PIECE_VIEWBOX };
