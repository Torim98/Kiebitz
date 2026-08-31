/**
 * Die selbst gezeichneten Sätze, fertig aufgebaut.
 *
 * `./art.ts` beschreibt sechs Figuren, `buildGlyphs` macht daraus zwölf · das
 * gehört einmal getan und nicht bei jedem Zugriff. Die Datei existiert vor
 * allem, damit `./glyphs.ts` alle Sätze auf demselben Weg nachladen kann:
 * gezeichnet oder mitgeliefert, jeder Satz ist ein Modul mit einer Tabelle.
 */
import { buildGlyphs } from "./art";
import { KIEBITZ_ART } from "./kiebitz";
import { MONOLITH_ART } from "./monolith";

export const KIEBITZ_GLYPHS = buildGlyphs(KIEBITZ_ART);
export const MONOLITH_GLYPHS = buildGlyphs(MONOLITH_ART);
