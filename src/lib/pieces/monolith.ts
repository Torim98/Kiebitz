/**
 * Figurenset „Monolith" · reduziert auf Grundformen.
 *
 * Der Gegenentwurf zum Kiebitz-Set: keine Erzählung, keine Zierlinie, nur
 * Kreis, Keil, Block und Kreuz auf einem gemeinsamen Sockel. Gedacht für
 * lange Analysesitzungen, in denen man Figuren nicht ansehen, sondern nur
 * erkennen will · und für die kleinen Bretter, auf denen jedes Detail
 * ohnehin zu Grau zerfällt.
 *
 * Weil die Formen so knapp sind, trägt hier allein die Silhouette: Der Bauer
 * ist der einzige Kreis, der Turm der einzige gezackte Block, die Dame das
 * einzige Vieleck. Zwei Figuren, die sich auf einen Blick ähneln, wären in
 * diesem Set nicht schlicht, sondern unbrauchbar.
 */
import { body, disc, inlay, mark, type PieceArt, type PiecePalette } from "./art";

/** Der gemeinsame Sockel · gleiche Standbreite für alle sechs Figuren. */
function plinth(palette: PiecePalette): string {
  return body("M11.4 39.2h22.2l-2.2-4.6H13.6z", palette);
}

export const MONOLITH_ART: PieceArt = {
  p: (palette) =>
    body("M18.8 34.6l1.6-7.4h4.2l1.6 7.4z", palette)
    + disc(22.5, 24.2, 5.4, palette)
    + plinth(palette),

  n: (palette) =>
    body(
      "M17.4 34.6v-7.2l2.4-4.8-5.2 1.2-3.8-2.6 6.6-6 7.2-1.6 3.8-4.2 2.2 11.6v13.6z",
      palette
    )
    + plinth(palette)
    + mark("M27.6 12.2l-2.2 6.6", palette, 1.3)
    + inlay("M21.2 16.2l3 1.2-3 1.2z", palette),

  b: (palette) =>
    body("M19.4 34.6l1-4.6h4.2l1 4.6z", palette)
    + body(
      "M22.5 8.4c4.9 4.6 7.9 10.4 7.9 15.2 0 5.4-3.4 8.8-7.9 8.8s-7.9-3.4-7.9-8.8"
      + "c0-4.8 3-10.6 7.9-15.2z",
      palette
    )
    + plinth(palette)
    + mark("M19.2 15.6l6.6 6.6", palette, 1.5),

  r: (palette) =>
    body("M14 34.6V16.6h4.4v3.2h3v-3.2h2.2v3.2h3v-3.2H31v18z", palette)
    + plinth(palette)
    + mark("M14.6 23.2h15.8", palette),

  q: (palette) =>
    body("M18.4 34.6l1.6-8h5l1.6 8z", palette)
    + body("M22.5 7.4l7.9 5.6v9.2l-7.9 5.6-7.9-5.6v-9.2z", palette)
    + plinth(palette)
    + mark("M14.6 13l7.9 4.2 7.9-4.2", palette, 1.2)
    + mark("M22.5 17.2v10.6", palette, 1.2),

  k: (palette) =>
    body("M20.6 18.4V11.4h-4.8V7.4h4.8V3.8h3.8v3.6h4.8v4h-4.8v7z", palette)
    + body("M15.8 34.6L17.6 17.6h9.8l1.8 17z", palette)
    + plinth(palette)
    + mark("M17.2 23h10.6", palette),
};
