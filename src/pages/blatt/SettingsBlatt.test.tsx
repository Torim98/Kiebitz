/**
 * Das Blatt der Einstellungen.
 *
 * Geprüft wird das, was am alten Satz falsch war und was der neue leisten
 * soll: Auf dem Telefon steht die Seite zuerst als Verzeichnis da und schlägt
 * erst auf, wo man tippt — samt der Folge, die daran hängt, dass ein Bereich
 * seine Daten erst holt, wenn er zu sehen ist.
 *
 * Und: Die Zeile, die sagt, was ein Bereich enthält, darf die Seite nicht mehr
 * breiter machen. Sie stand in der Rubrik, wo im Satz ein nicht umbrechender
 * Griff steht; ein ganzer Satz schob die Seite dort um achtzig Bildpunkte nach
 * rechts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SettingsBlatt, { type SettingsAbschnitt } from "./SettingsBlatt";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

const LANG = "Sprache";
const SOUND = "Brett & Klang";
const LANGE_ZEILE = "Zug-, Schlag- und Mattklänge · Motivhinweis im Puzzle-Training";

const abschnitte: SettingsAbschnitt[] = [
  {
    id: "language",
    titel: LANG,
    zeile: "Sieben Oberflächensprachen",
    gruppe: "basics",
    inhalt: <p>Sprachwahl</p>,
  },
  {
    id: "sound",
    titel: SOUND,
    zeile: LANGE_ZEILE,
    gruppe: "training",
    inhalt: <p>Klangregler</p>,
  },
];

function blatt(props: Partial<Parameters<typeof SettingsBlatt>[0]> = {}) {
  return render(
    <SettingsBlatt
      mobile
      abschnitte={abschnitte}
      gruppenTitel={(gruppe) => gruppe.toUpperCase()}
      aktiv={null}
      ankerId={(id) => `set-${id}`}
      onSpringen={vi.fn()}
      onSichtbar={vi.fn()}
      {...props}
    />
  );
}

describe("SettingsBlatt", () => {
  it("keeps the phone closed until a section is tapped", () => {
    blatt();
    expect(screen.queryByText("Sprachwahl")).toBeNull();
    fireEvent.click(screen.getByText(LANG));
    expect(screen.getByText("Sprachwahl")).toBeTruthy();
    // Die anderen bleiben zu · aufgeschlagen wird, was man sucht.
    expect(screen.queryByText("Klangregler")).toBeNull();
  });

  it("fetches a section only once it is shown", () => {
    const onSichtbar = vi.fn();
    blatt({ onSichtbar });
    expect(onSichtbar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(SOUND));
    expect(onSichtbar).toHaveBeenCalledWith("sound");
    expect(onSichtbar).not.toHaveBeenCalledWith("language");
  });

  it("opens every section on the desktop and asks for all of them", () => {
    const onSichtbar = vi.fn();
    blatt({ mobile: false, onSichtbar });
    expect(screen.getByText("Sprachwahl")).toBeTruthy();
    expect(screen.getByText("Klangregler")).toBeTruthy();
    expect(onSichtbar).toHaveBeenCalledWith("language");
    expect(onSichtbar).toHaveBeenCalledWith("sound");
  });

  /**
   * Der eigentliche Überlauf: Ein Satz darf nicht in einem Element stehen, das
   * nicht schrumpfen kann. Beide Fassungen setzen ihn deshalb in ein Element,
   * das abschneidet oder umbricht — nie in eines mit `shrink-0`.
   */
  it("never lets the summary push the page sideways", () => {
    for (const mobile of [true, false]) {
      cleanup();
      blatt({ mobile });
      const zeile = screen.getByText(LANGE_ZEILE);
      expect(zeile.className).not.toContain("shrink-0");
      expect(zeile.className).not.toContain("whitespace-nowrap");
    }
  });

  it("numbers the sections the same way in the list and in the jump bar", () => {
    blatt({ mobile: false });
    // Zwei Abschnitte · zweistellig, damit die Spalte steht.
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("02")).toBeTruthy();
  });
});
