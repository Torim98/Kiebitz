/**
 * Die Bildkarte einer geteilten Stellung.
 *
 * Der Link trägt die Stellung, das Bild trägt die Absenderin: Wer in einem Chat
 * ein Brett sieht, soll auf den ersten Blick erkennen, dass es aus Kiebitz
 * kommt: Marke, Farben, Figurensatz und Adresse in einem Bild, das auch ohne
 * Klick etwas erzählt.
 *
 * Warum Canvas und nicht ein Bildschirmfoto des Bretts: Ein Foto hängt an
 * Fenstergröße, Zoomstufe und Betriebssystem. Diese Karte ist auf jedem Gerät
 * dieselbe 1080er Kachel · die Größe, die WhatsApp, Telegram und Instagram
 * unbeschnitten zeigen.
 *
 * Die Beschriftungen kommen fertig übersetzt herein. Diese Datei kennt keine
 * Sprache, nur Text und Layout.
 */
import type { PieceSetId } from "../pieces/sets";
import { boardCoordinates, boardSvg } from "./board";
import type { ShareMove } from "./codec";

/** Kantenlänge der Karte · quadratisch, weil das in jedem Chat vollständig ankommt. */
export const CARD_SIZE = 1080;

const BG = "#0e0e0d";
const LINE = "#292927";
const INK = "#f2f1ec";
const INK2 = "#b9b8ae";
const INK3 = "#8b8a82";
const ACCENT = "#22c08a";
const ACCENT_SOFT = "#103528";
const FONT = '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Die Vogelmarke aus der Seitenleiste · dieselben Pfade wie das Lucide-Zeichen
 * `Bird`, das die App im Kopf trägt (ISC, siehe THIRD_PARTY_NOTICES.md).
 * Gezeichnet in einem 24×24-Feld.
 */
const BIRD_PATHS = [
  "M16 7h.01",
  "M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20",
  "m20 7 2 .5-2 .5",
  "M10 18v3",
  "M14 17.75V21",
  "M7 18a6 6 0 0 0 3.84-10.61",
];

export interface ShareCardText {
  /** Überschrift · die Frage oder der Titel, höchstens zwei Zeilen. */
  heading: string;
  /** Kurze Merkmale unter der Überschrift ("Weiß am Zug", "Elo 1780", "Gabel"). */
  chips: string[];
  /** Art der Karte, oben rechts ("Analyse", "Taktik"). */
  badge: string;
  /** Zeile unter dem Brett · die Einladung, nicht die Adresse. */
  tagline: string;
}

export interface ShareCardOptions extends ShareCardText {
  fen: string;
  orientation: "white" | "black";
  lastMove?: ShareMove | null;
  /** Pfeil auf der Karte · bei verdeckten Aufgaben bleibt er weg. */
  arrow?: ShareMove | null;
  /** Figurenset der Karte · ohne Angabe der klassische Satz. */
  pieceSet?: PieceSetId;
}

/** Rechteck mit runden Ecken · `roundRect` fehlt in älteren WebViews. */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Text auf höchstens `maxLines` Zeilen umbrechen, der Rest endet mit Auslassung. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && line && lines[maxLines - 1] !== line) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last} …`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last} …`;
  }
  return lines;
}

function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const path of BIRD_PATHS) ctx.stroke(new Path2D(path));
  ctx.restore();
}

/** Ein Merkmal als Pille · dieselbe Form wie die Chips in der Oberfläche. */
function drawChip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): number {
  ctx.font = `500 26px ${FONT}`;
  const width = ctx.measureText(text).width + 40;
  const height = 52;
  roundedPath(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = "#1e1e1d";
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = INK2;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 20, y + height / 2 + 1);
  return width;
}

/** Das Brett-SVG als geladenes Bild · ohne Netz, alles steckt in der Adresse. */
function loadBoard(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("board image failed"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Sorgt dafür, dass Inter geladen ist, bevor gemessen und gezeichnet wird.
 * Ohne diesen Schritt fällt der erste Aufruf auf die Systemschrift zurück und
 * die Karte sähe anders aus als die App.
 */
async function readyFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.all([
      fonts.load(`600 52px "Inter Variable"`),
      fonts.load(`500 26px "Inter Variable"`),
      fonts.load(`400 24px "Inter Variable"`),
    ]);
    await fonts.ready;
  } catch {
    // Kein Grund, das Teilen abzubrechen · dann eben die Systemschrift.
  }
}

/**
 * Zeichnet die Karte und liefert sie als PNG.
 *
 * Wirft, wenn der WebView das Bild nicht hergibt · die Oberfläche fängt das ab
 * und bietet weiterhin den Link an. Ein Share ohne Bild ist immer noch ein
 * Share; eine Fehlermeldung ohne Ausweg wäre keiner.
 */
export async function renderShareCard(options: ShareCardOptions): Promise<Blob> {
  await readyFonts();

  const size = CARD_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);

  // Ein Hauch Akzent in der oberen Ecke · derselbe Schimmer wie hinter der App,
  // damit die Karte nicht wie ein Screenshot auf schwarzem Grund wirkt.
  const glow = ctx.createRadialGradient(120, 60, 0, 120, 60, 780);
  glow.addColorStop(0, "rgba(34, 192, 138, 0.14)");
  glow.addColorStop(1, "rgba(34, 192, 138, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const pad = 56;
  ctx.textBaseline = "middle";

  // Kopf: Marke links, Art der Karte rechts.
  roundedPath(ctx, pad, pad, 76, 76, 22);
  ctx.fillStyle = ACCENT_SOFT;
  ctx.fill();
  drawBird(ctx, pad + 18, pad + 18, 40);

  ctx.font = `600 40px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText("Kiebitz", pad + 96, pad + 38);

  if (options.badge) {
    ctx.font = `600 24px ${FONT}`;
    const badgeWidth = ctx.measureText(options.badge).width + 44;
    const badgeX = size - pad - badgeWidth;
    roundedPath(ctx, badgeX, pad + 18, badgeWidth, 44, 22);
    ctx.fillStyle = ACCENT_SOFT;
    ctx.fill();
    ctx.fillStyle = ACCENT;
    ctx.fillText(options.badge, badgeX + 22, pad + 41);
  }

  // Überschrift.
  ctx.font = `600 52px ${FONT}`;
  ctx.fillStyle = INK;
  const headingLines = wrap(ctx, options.heading, size - pad * 2, 2);
  let y = pad + 128;
  for (const line of headingLines) {
    ctx.fillText(line, pad, y + 26);
    y += 62;
  }

  // Merkmale.
  if (options.chips.length) {
    let chipX = pad;
    for (const chip of options.chips) {
      if (!chip) continue;
      const width = drawChip(ctx, chip, chipX, y + 8);
      chipX += width + 14;
      if (chipX > size - pad - 120) break;
    }
    y += 76;
  } else {
    y += 12;
  }

  // Brett · alles darunter richtet sich nach dem Platz, der übrig bleibt.
  const footerHeight = 92;
  const boardTop = y + 16;
  const boardSize = Math.min(size - pad * 2 - 44, size - boardTop - footerHeight - pad);
  const boardLeft = Math.round((size - boardSize) / 2);

  const image = await loadBoard(
    boardSvg({
      fen: options.fen,
      orientation: options.orientation,
      size: boardSize,
      lastMove: options.lastMove,
      arrow: options.arrow,
      pieceSet: options.pieceSet,
    })
  );

  ctx.save();
  roundedPath(ctx, boardLeft, boardTop, boardSize, boardSize, 16);
  ctx.clip();
  ctx.drawImage(image, boardLeft, boardTop, boardSize, boardSize);
  ctx.restore();
  roundedPath(ctx, boardLeft, boardTop, boardSize, boardSize, 16);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Randbeschriftung · in der Farbe des jeweils angrenzenden Feldes wäre sie
  // hübscher, aber außerhalb des Bretts liest sie sich ruhiger.
  const unit = boardSize / 8;
  const { files, ranks } = boardCoordinates(options.orientation);
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = INK3;
  ctx.textAlign = "center";
  files.forEach((file, index) => {
    ctx.fillText(file, boardLeft + unit * index + unit / 2, boardTop + boardSize + 22);
  });
  ctx.textAlign = "right";
  ranks.forEach((rank, index) => {
    ctx.fillText(rank, boardLeft - 14, boardTop + unit * index + unit / 2);
  });
  ctx.textAlign = "left";

  // Fuß: Adresse und Einladung links, Bildnachweis klein rechts.
  const footerY = size - pad - 24;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillStyle = ACCENT;
  const host = "kiebitz.dev";
  ctx.fillText(host, pad, footerY - 16);
  const hostWidth = ctx.measureText(host).width;

  ctx.font = `400 26px ${FONT}`;
  ctx.fillStyle = INK3;
  ctx.fillText(options.tagline, pad + hostWidth + 18, footerY - 15);

  // Die Figuren stehen unter CC BY-SA · das Bild wandert ohne die Landeseite
  // weiter, also muss der Nachweis auf dem Bild selbst stehen.
  ctx.font = `400 16px ${FONT}`;
  ctx.fillStyle = "rgba(139, 138, 130, 0.65)";
  ctx.textAlign = "right";
  ctx.fillText("Figuren: Cburnett · CC BY-SA 3.0", size - pad, footerY + 22);
  ctx.textAlign = "left";

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("card export failed"));
    }, "image/png");
  });
}
