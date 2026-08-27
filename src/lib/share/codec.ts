/**
 * Nutzlast eines geteilten Bretts · Stellung, Zuglinie und Beiwerk in wenigen
 * Bytes.
 *
 * Ein geteilter Link trägt die Stellung selbst, nicht den Schlüssel zu einer
 * Stellung auf einem Server. Das ist keine Sparsamkeit um ihrer selbst willen:
 * Kiebitz verspricht, dass Partien und Analysen auf dem Gerät bleiben, und
 * dieses Versprechen bliebe schief, wenn jedes Teilen eine Zeile in einer
 * fremden Datenbank hinterließe. Was im Link steht, sieht nur, wer den Link
 * bekommt.
 *
 * Damit der Link dabei in eine Chatzeile passt, wird die Stellung gepackt und
 * nicht als FEN durchgereicht: acht Bytes Belegung, danach vier Bit je
 * besetztem Feld. Eine typische Mittelspielstellung braucht so gut zwei Dutzend
 * Bytes statt siebzig Zeichen.
 *
 * Dieselbe Datei liegt im Worker (`kiebitz-api`), der die Landeseite baut ·
 * abgeglichen von `npm run share:sync`. Änderungen am Format gehören deshalb
 * hinter eine neue Versionsnummer: Links, die jemand vor einem Jahr in einen
 * Chat gestellt hat, müssen weiter aufgehen.
 */

/** Aktuelle Formatversion · ältere Nutzlasten bleiben lesbar, neue nicht rückwärts. */
export const SHARE_VERSION = 1;

/**
 * Woher eine geteilte Stellung stammt · sie entscheidet über Aufmacher,
 * Vorgabetitel und darüber, ob die Fortsetzung verdeckt bleibt.
 *
 * Die Reihenfolge ist Teil des Formats: Der Codec schreibt den Index. Neue
 * Arten kommen deshalb hinten dazu und nie dazwischen · dann liest ein Link
 * von gestern in jeder Version dieselbe Stellung. Umgekehrt gilt das nicht:
 * Eine ältere App kennt eine neue Art nicht und meldet den Link als
 * unlesbar, statt eine falsche Stellung zu zeigen.
 */
export type ShareKind = "analysis" | "puzzle" | "repertoire" | "endgame";

/** Ein Zug in der Sprache des Bretts · Felder wie "e2", Umwandlung als Kleinbuchstabe. */
export interface ShareMove {
  from: string;
  to: string;
  promo?: "q" | "r" | "b" | "n";
}

export interface ShareEval {
  /** Centipawns aus Sicht von Weiß · null, wenn ein Matt ansteht. */
  cp: number | null;
  /** Züge bis Matt, negativ wenn Schwarz mattsetzt. */
  mate: number | null;
}

export interface SharePayload {
  kind: ShareKind;
  /** Vollständiges FEN der gezeigten Stellung. */
  fen: string;
  /** Aus wessen Sicht das Brett steht. */
  orientation: "white" | "black";
  /**
   * Der Zug, der zu dieser Stellung geführt hat · das Brett hebt ihn hervor.
   * Beim Puzzle ist das der Gegnerzug, der die Aufgabe stellt.
   */
  lastMove?: ShareMove | null;
  /**
   * Fortsetzung: die Variante der Analyse, die Lösung der Aufgabe oder die
   * Züge einer Repertoire-Linie. Beim Puzzle bleibt sie auf der Landeseite
   * verdeckt, bis jemand sie sehen will.
   */
  line?: ShareMove[];
  /** Stockfish-Bewertung der Stellung, sofern sie mitgeteilt werden soll. */
  eval?: ShareEval | null;
  /** Freie Überschrift des Absenders · höchstens 80 Bytes UTF-8. */
  title?: string;
  /** Puzzle-Elo. */
  rating?: number;
  /** Motivschlüssel des Puzzles ("fork", "backRankMate", …) · Lichess-Katalog. */
  theme?: string;
}

const KINDS: ShareKind[] = ["analysis", "puzzle", "repertoire", "endgame"];

/** Figurenkennungen in der Reihenfolge ihrer Nibble-Codes. */
const PIECES = "PNBRQKpnbrqk";

const FLAG_BLACK_VIEW = 1;
const FLAG_LAST_MOVE = 2;
const FLAG_LINE = 4;
const FLAG_EVAL = 8;
const FLAG_TITLE = 16;
const FLAG_RATING = 32;
const FLAG_THEME = 64;

/** Längste Überschrift in Bytes · ein Link soll eine Zeile bleiben. */
export const TITLE_MAX_BYTES = 80;
/** Längste mitgegebene Zuglinie · deckt jede Aufgabe und jede sinnvolle Variante ab. */
export const LINE_MAX_MOVES = 40;

class Writer {
  private bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u16(value: number): void {
    this.u8(value);
    this.u8(value >> 8);
  }

  i16(value: number): void {
    this.u16(value < 0 ? value + 0x10000 : value);
  }

  raw(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.u8(values[i]);
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private at = 0;
  private readonly bytes: Uint8Array;

  // Ausgeschriebener Konstruktor statt Parameter-Eigenschaft: So bleibt die
  // Datei reines TypeScript, aus dem sich die Typen wegstreichen lassen · das
  // braucht das Skript, das die Testvektoren für beide Repos erzeugt.
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** Bleibt noch so viel übrig? Jeder Lesevorgang prüft das selbst. */
  private need(count: number): void {
    if (this.at + count > this.bytes.length) throw new RangeError("share payload truncated");
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.at++];
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  i16(): number {
    const value = this.u16();
    return value >= 0x8000 ? value - 0x10000 : value;
  }

  raw(count: number): Uint8Array {
    this.need(count);
    const slice = this.bytes.subarray(this.at, this.at + count);
    this.at += count;
    return slice;
  }
}

/** Feldindex in FEN-Lesefolge · 0 ist a8, 63 ist h1. */
function squareIndex(square: string): number {
  const file = square.charCodeAt(0) - 97;
  const rank = square.charCodeAt(1) - 49;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) throw new RangeError(`bad square ${square}`);
  return (7 - rank) * 8 + file;
}

function squareName(index: number): string {
  return (
    String.fromCharCode(97 + (index % 8)) + String.fromCharCode(49 + (7 - Math.floor(index / 8)))
  );
}

/** Die 64 Felder eines FEN als Figurenzeichen, leere Felder als leerer String. */
function boardFromFen(placement: string): string[] {
  const squares: string[] = [];
  for (const row of placement.split("/")) {
    for (const char of row) {
      if (char >= "1" && char <= "8") {
        for (let i = 0; i < Number(char); i++) squares.push("");
      } else {
        if (!PIECES.includes(char)) throw new RangeError(`bad piece ${char}`);
        squares.push(char);
      }
    }
  }
  if (squares.length !== 64) throw new RangeError("bad board");
  return squares;
}

function fenPlacement(squares: string[]): string {
  const rows: string[] = [];
  for (let rank = 0; rank < 8; rank++) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = squares[rank * 8 + file];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) row += String(empty);
      empty = 0;
      row += piece;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join("/");
}

function writePosition(out: Writer, fen: string): void {
  const [placement, side = "w", castling = "-", ep = "-", half = "0", full = "1"] = fen
    .trim()
    .split(/\s+/);
  const squares = boardFromFen(placement);

  // Belegung zuerst: acht Bytes sagen, welche Felder überhaupt eine Figur
  // tragen. Erst danach folgt für jedes dieser Felder, welche.
  const occupancy = new Uint8Array(8);
  const codes: number[] = [];
  for (let i = 0; i < 64; i++) {
    const piece = squares[i];
    if (!piece) continue;
    occupancy[i >> 3] |= 1 << (i & 7);
    codes.push(PIECES.indexOf(piece));
  }
  out.raw(occupancy);
  for (let i = 0; i < codes.length; i += 2) {
    out.u8(codes[i] | ((codes[i + 1] ?? 0) << 4));
  }

  const hasEp = ep !== "-" && ep.length === 2;
  let meta = side === "b" ? 1 : 0;
  if (castling.includes("K")) meta |= 2;
  if (castling.includes("Q")) meta |= 4;
  if (castling.includes("k")) meta |= 8;
  if (castling.includes("q")) meta |= 16;
  if (hasEp) meta |= 32;
  out.u8(meta);
  if (hasEp) out.u8(squareIndex(ep));

  out.u8(Math.min(255, Math.max(0, Number(half) || 0)));
  out.u16(Math.min(65535, Math.max(1, Number(full) || 1)));
}

function readPosition(input: Reader): string {
  const occupancy = input.raw(8);
  const occupied: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (occupancy[i >> 3] & (1 << (i & 7))) occupied.push(i);
  }
  const squares = new Array<string>(64).fill("");
  for (let i = 0; i < occupied.length; i += 2) {
    const byte = input.u8();
    const first = PIECES[byte & 0x0f];
    const second = PIECES[(byte >> 4) & 0x0f];
    if (!first) throw new RangeError("bad piece code");
    squares[occupied[i]] = first;
    if (i + 1 < occupied.length) {
      if (!second) throw new RangeError("bad piece code");
      squares[occupied[i + 1]] = second;
    }
  }

  const meta = input.u8();
  const side = meta & 1 ? "b" : "w";
  let castling = "";
  if (meta & 2) castling += "K";
  if (meta & 4) castling += "Q";
  if (meta & 8) castling += "k";
  if (meta & 16) castling += "q";
  const ep = meta & 32 ? squareName(input.u8()) : "-";
  const half = input.u8();
  const full = input.u16();

  return `${fenPlacement(squares)} ${side} ${castling || "-"} ${ep} ${half} ${full}`;
}

function writeMove(out: Writer, move: ShareMove): void {
  const promo = move.promo ? "qrbn".indexOf(move.promo) + 1 : 0;
  out.u16(squareIndex(move.from) | (squareIndex(move.to) << 6) | (promo << 12));
}

function readMove(input: Reader): ShareMove {
  const packed = input.u16();
  const promo = (packed >> 12) & 7;
  const move: ShareMove = {
    from: squareName(packed & 63),
    to: squareName((packed >> 6) & 63),
  };
  if (promo >= 1 && promo <= 4) move.promo = "qrbn"[promo - 1] as ShareMove["promo"];
  return move;
}

function utf8(text: string, maxBytes: number): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return bytes;
  // Nicht mitten in einer Mehrbyte-Folge abschneiden · sonst steht am Ende ein
  // Ersatzzeichen, und das fiele in jeder Vorschau auf.
  let cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  return bytes.subarray(0, cut);
}

/** Bytes als base64url ohne Füllzeichen · das überlebt jede Chat-App. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Packt eine Stellung samt Beiwerk in die Zeichenkette, die im Link steht.
 * Ungültige Eingaben wirft die Funktion zurück · sie kommen aus der eigenen
 * Oberfläche, ein stiller Fehlschlag erzeugte nur einen kaputten Link.
 */
export function encodeShare(payload: SharePayload): string {
  const out = new Writer();
  const title = payload.title?.trim() ?? "";
  const theme = payload.theme?.trim() ?? "";
  const line = (payload.line ?? []).slice(0, LINE_MAX_MOVES);
  const evaluation =
    payload.eval && (payload.eval.cp != null || payload.eval.mate != null) ? payload.eval : null;

  let flags = 0;
  if (payload.orientation === "black") flags |= FLAG_BLACK_VIEW;
  if (payload.lastMove) flags |= FLAG_LAST_MOVE;
  if (line.length) flags |= FLAG_LINE;
  if (evaluation) flags |= FLAG_EVAL;
  if (title) flags |= FLAG_TITLE;
  if (payload.rating) flags |= FLAG_RATING;
  if (theme) flags |= FLAG_THEME;

  const kind = KINDS.indexOf(payload.kind);
  out.u8(SHARE_VERSION);
  out.u8(kind < 0 ? 0 : kind);
  out.u8(flags);
  writePosition(out, payload.fen);

  if (payload.lastMove) writeMove(out, payload.lastMove);
  if (line.length) {
    out.u8(line.length);
    for (const move of line) writeMove(out, move);
  }
  if (evaluation) {
    // Matt und Centipawns teilen sich zwei Bytes; das Typbyte davor macht die
    // Unterscheidung eindeutig, statt sie an einen Zahlenbereich zu hängen.
    out.u8(evaluation.mate != null ? 1 : 0);
    const value = evaluation.mate != null ? evaluation.mate : (evaluation.cp ?? 0);
    out.i16(Math.max(-32000, Math.min(32000, Math.trunc(value))));
  }
  if (title) {
    const bytes = utf8(title, TITLE_MAX_BYTES);
    out.u8(bytes.length);
    out.raw(bytes);
  }
  if (payload.rating) out.u16(Math.max(0, Math.min(65535, Math.round(payload.rating))));
  if (theme) {
    const bytes = utf8(theme, 40);
    out.u8(bytes.length);
    out.raw(bytes);
  }

  return toBase64Url(out.done());
}

/**
 * Liest die Nutzlast eines Links. Alles, was nicht aufgeht, sei es eine
 * abgeschnittene Zeichenkette, eine fremde Version oder Unfug aus der
 * Zwischenablage, ergibt
 * `null`; ein geteilter Link ist Fremdeingabe und darf nichts zum Absturz
 * bringen.
 */
export function decodeShare(text: string): SharePayload | null {
  try {
    const input = new Reader(fromBase64Url(text.trim()));
    if (input.u8() !== SHARE_VERSION) return null;
    const kind = KINDS[input.u8()];
    if (!kind) return null;
    const flags = input.u8();
    const fen = readPosition(input);

    const payload: SharePayload = {
      kind,
      fen,
      orientation: flags & FLAG_BLACK_VIEW ? "black" : "white",
    };
    if (flags & FLAG_LAST_MOVE) payload.lastMove = readMove(input);
    if (flags & FLAG_LINE) {
      const count = input.u8();
      if (count > LINE_MAX_MOVES) return null;
      const line: ShareMove[] = [];
      for (let i = 0; i < count; i++) line.push(readMove(input));
      payload.line = line;
    }
    if (flags & FLAG_EVAL) {
      const mate = input.u8() === 1;
      const value = input.i16();
      payload.eval = mate ? { cp: null, mate: value } : { cp: value, mate: null };
    }
    if (flags & FLAG_TITLE) {
      const length = input.u8();
      payload.title = new TextDecoder().decode(input.raw(length));
    }
    if (flags & FLAG_RATING) payload.rating = input.u16();
    if (flags & FLAG_THEME) {
      const length = input.u8();
      payload.theme = new TextDecoder().decode(input.raw(length));
    }
    return payload;
  } catch {
    return null;
  }
}
