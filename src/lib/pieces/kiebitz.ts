/**
 * Figurenset „Kiebitz" · das Haus-Set.
 *
 * Der Kiebitz ist ein Vogel mit einem unverwechselbaren Merkmal: der langen,
 * nach hinten geschwungenen Haube. Genau daran hängt dieses Set. Jede Figur
 * ist ein Vogel, und die Haube ist das, was sie zur Familie macht — beim
 * Springer ein Kopf im Profil, bei der Dame ein aufgestellter Fächer, beim
 * König ein Schopf unter dem Kreuz.
 *
 * Die Umrisse bleiben trotzdem die gewohnten: Ein Turm ist breit und flach
 * oben (hier ein Nest mit drei Eiern), ein Läufer schlank und spitz, ein Bauer
 * klein und rund. Wer Schach spielt, liest eine Stellung an den Silhouetten,
 * nicht an den Details · ein Set, das dafür ein paar Sekunden länger braucht,
 * ist ein schönes Set und ein schlechtes Brett.
 */
import { body, disc, dot, inlay, mark, type PieceArt, type PiecePalette } from "./art";

/**
 * Das Nest, auf dem alle großen Figuren stehen · der gemeinsame Fuß. Er hält
 * die Figuren in einer Reihe: gleiche Standbreite, gleiche Standhöhe.
 */
function nest(palette: PiecePalette): string {
  return (
    body("M9.4 39.3c0-2.7 2.3-3.8 4-4.8h18.2c1.7 1 4 2.1 4 4.8z", palette)
    + mark("M12.6 37.2h19.8", palette)
  );
}

/** Kopf im Profil · Schnabel nach links, Auge darüber. Für Dame und König. */
function beakAndEye(palette: PiecePalette, x: number, y: number): string {
  return (
    inlay(`M${x} ${y - 1.6}L${x - 6.2} ${y}L${x + 0.2} ${y + 2}z`, palette)
    + dot(x + 3.4, y - 1.8, 0.95, palette)
  );
}

export const KIEBITZ_ART: PieceArt = {
  // Ein Ei mit Haube · das Kleinste, das schon ein Kiebitz ist.
  p: (palette) =>
    mark("M25.9 17.2c1.6-2.4 3.9-3.5 6.6-3.7", palette, 1.5)
    + body(
      "M22.5 16.2c-4 0-7.1 4.2-7.1 9.4 0 5.2 3.1 9.2 7.1 9.2s7.1-4 7.1-9.2c0-5.2-3.1-9.4-7.1-9.4z",
      palette
    )
    + body("M13.1 38.9c0-2.3 1.9-3.2 3.4-4.1h12c1.5.9 3.4 1.8 3.4 4.1z", palette)
    + inlay("M15.7 21.9L10.9 23.8l5 1.7z", palette)
    + dot(19.6, 22.4, 0.95, palette),

  // Der Kopf im Profil · beim Springer trägt die Silhouette schon alles.
  n: (palette) =>
    mark("M30.6 12.6c2.9-2.8 6-4.1 8.8-4.5", palette, 1.9)
    + mark("M28.2 10.2c2.2-2 4.7-3.1 7-3.5", palette, 1.7)
    + body(
      "M15.9 34.6c-.7-4.8 1-8.4 3.7-11 1-1 1.6-1.7 1.8-2.7l-8.4-.7c-.9-.1-1-1.2-.1-1.6l7.9-3.2"
      + "c.8-2.5 3.4-4.2 6.5-4.2 3.6 0 6.3 2.8 6.3 6.4 0 3.2-1.6 5.2-3.4 7.4-2 2.6-2.3 6-2.1 9.6z",
      palette
    )
    + nest(palette)
    + dot(26.2, 16.4, 1, palette)
    + mark("M18.4 18.9l2.7-1.1", palette, 0.9),

  // Wasservogel: schlank, Kopf hoch, Schnabel schräg nach oben.
  b: (palette) =>
    mark("M26.6 11.2c2.4-2 5-2.9 7.4-3", palette, 1.5)
    + body("M19.6 18.6c-3.4 3.4-5.2 9.4-5.4 16h16.6c-.2-6.6-2-12.6-5.4-16z", palette)
    + disc(22.5, 15.4, 5, palette)
    + nest(palette)
    + inlay("M18.6 12.8L10.6 10.2l7.6 6.6z", palette)
    + dot(21.4, 14.6, 0.95, palette)
    + mark("M18.4 24.6c2.6-1.4 5.6-1.4 8.2 0", palette)
    + mark("M17.4 28.8c3.4-1.6 6.8-1.6 10.2 0", palette),

  // Nest mit drei Eiern · breit, flach und oben dreifach gezackt.
  r: (palette) =>
    disc(15.4, 19, 3.5, palette)
    + disc(29.6, 19, 3.5, palette)
    + disc(22.5, 17.6, 3.9, palette)
    + body("M11.2 34.5h22.6L31.2 21.4H13.8z", palette)
    + nest(palette)
    + mark("M14.4 25.4h16.2", palette)
    + mark("M13.2 29.6h18.6", palette),

  // Die volle Haube · fünf Federn, jede mit einer Spitze.
  q: (palette) =>
    body(
      "M17.4 13.8L10.2 11l8.6 1.4L15.8 7.6l5 4L22.5 6.4l1.7 5.2 5-4-3 4.8 8.6-1.4-7.2 2.8z",
      palette,
      1.3
    )
    + disc(10.2, 11, 1.7, palette, 1.3)
    + disc(15.8, 7.6, 1.7, palette, 1.3)
    + disc(22.5, 6.2, 1.8, palette, 1.3)
    + disc(29.2, 7.6, 1.7, palette, 1.3)
    + disc(34.8, 11, 1.7, palette, 1.3)
    + body("M18.4 21.6c-3.8 3.4-5.6 8.2-5.8 12.9h19.8c-.2-4.7-2-9.5-5.8-12.9z", palette)
    + disc(22.5, 17.8, 5.2, palette)
    + nest(palette)
    + beakAndEye(palette, 17.8, 17)
    + mark("M17 27.4c3.6-1.5 7.4-1.5 11 0", palette)
    + mark("M15.8 31.4c4.4-1.6 9-1.6 13.4 0", palette),

  // Schopf und Kreuz · die höchste Figur, aber derselbe Vogel.
  k: (palette) =>
    body("M17.4 14.4L12.4 7.2l7.6 5.6h5l7.6-5.6-5 7.2z", palette, 1.3)
    + body("M20.8 13.2h3.4V10h3.6V6.6h-3.6V3.4h-3.4v3.2h-3.6V10h3.6z", palette, 1.3)
    + body("M18.6 21.8c-3.6 3.4-5.4 8.2-5.6 12.7h19c-.2-4.5-2-9.3-5.6-12.7z", palette)
    + disc(22.5, 18, 5, palette)
    + nest(palette)
    + beakAndEye(palette, 17.8, 17.2)
    + mark("M17.2 27.6c3.5-1.5 7.1-1.5 10.6 0", palette)
    + mark("M16.2 31.4c4.2-1.6 8.4-1.6 12.6 0", palette),
};
