/**
 * Die Bausteine des Buchsatzes.
 *
 * Geprüft wird, was sie den Seiten zusagen: Trefferflächen über 44 px, eine
 * Zahl, die einen offenen Posten von einem Wert unterscheidet, und ein Befund,
 * dessen Schwere eine Rangordnung bleibt und keine Note wird.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Befund } from "./Befund";
import {
  Balken,
  ErledigenZeile,
  Formularkopf,
  Rubrik,
  Schalterreihe,
  Verzeichniszeile,
} from "./Satz";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

describe("Verzeichniszeile", () => {
  it("sets an open item apart from a plain value", () => {
    render(
      <>
        <Verzeichniszeile name="Analyse" zahl="4" />
        <Verzeichniszeile name="Ohne" zahl="" />
      </>
    );
    expect(screen.getByText("4").className).toContain("text-ink");
    expect(screen.getByText("4").className).not.toContain("text-ink3");
  });

  it("stays reachable with a finger", () => {
    render(<Verzeichniszeile name="Analyse" onClick={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("style")).toContain("min-height: 44px");
  });

  it("marks the running chapter", () => {
    render(<Verzeichniszeile name="Analyse" aktiv onClick={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-current")).toBe("true");
  });
});

describe("Balken", () => {
  it("keeps a value inside the frame", () => {
    render(
      <>
        <span data-testid="a">
          <Balken anteil={140} />
        </span>
        <span data-testid="b">
          <Balken anteil={-20} />
        </span>
      </>
    );
    const fuellung = (id: string) =>
      screen.getByTestId(id).querySelector(".bg-ink")!.getAttribute("style");
    expect(fuellung("a")).toContain("width: 100%");
    expect(fuellung("b")).toContain("width: 0%");
  });
});

describe("ErledigenZeile", () => {
  it("is one button, 52 px tall, and leads somewhere", () => {
    const onWeg = vi.fn();
    render(
      <ErledigenZeile
        zahl="14"
        sache="fällige Wiederholungen"
        neben="Repertoire"
        weg="trainieren"
        onWeg={onWeg}
      />
    );
    const zeile = screen.getByRole("button");
    expect(zeile.getAttribute("style")).toContain("min-height: 52px");
    fireEvent.click(zeile);
    expect(onWeg).toHaveBeenCalled();
  });
});

describe("Schalterreihe", () => {
  it("keeps every handle at 44 px and disables what leads nowhere", () => {
    render(
      <Schalterreihe
        eintraege={[{ label: "Tipp", onClick: vi.fn() }, { label: "Lösung" }]}
      />
    );
    const knoepfe = screen.getAllByRole("button");
    for (const knopf of knoepfe) expect(knopf.className).toContain("h-11");
    expect(knoepfe[1].hasAttribute("disabled")).toBe(true);
  });
});

describe("Befund", () => {
  it("shows the severity as a rank, not as a bar", () => {
    render(<Befund titel="Zeitnot" text="17,4 %" schwere={71} ton="bad" />);
    // Die Zahl steht da; ein Balken, der sie in eine Note verwandelte, nicht.
    expect(screen.getByText("blatt.severity")).toBeTruthy();
  });

  it("leaves the prescription out when the data has none", () => {
    render(<Befund titel="Zeitnot" text="17,4 %" schwere={71} ton="bad" />);
    expect(screen.queryByText("blatt.prescription")).toBeNull();

    cleanup();
    render(
      <Befund titel="Zeitnot" text="17,4 %" schwere={71} ton="bad" verordnung="65 Minuten" />
    );
    expect(screen.getByText("blatt.prescription")).toBeTruthy();
  });
});

describe("Formularkopf", () => {
  it("puts every field on a line with its label", () => {
    render(
      <Formularkopf
        felder={[
          { label: "Weiß", wert: "Tom", gross: true },
          { label: "Schwarz", wert: "Gegner" },
        ]}
      />
    );
    expect(screen.getByText("Weiß")).toBeTruthy();
    expect(screen.getByText("Tom").className).toContain("border-b");
  });
});

describe("Rubrik", () => {
  it("offers its one way onward as a button", () => {
    const onWeg = vi.fn();
    render(
      <Rubrik weg="Alle anzeigen" onWeg={onWeg}>
        Letzte Partien
      </Rubrik>
    );
    fireEvent.click(screen.getByText("Alle anzeigen"));
    expect(onWeg).toHaveBeenCalled();
  });
});
