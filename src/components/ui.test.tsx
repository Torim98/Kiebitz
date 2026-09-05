import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, Menu, MenuItem, Tag, SourceBadge } from "./ui";

describe("Button", () => {
  it("renders its children and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save note</Button>);
    const btn = screen.getByRole("button", { name: "Save note" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the accent fill only in the primary variant", () => {
    const { rerender } = render(<Button>Plain</Button>);
    expect(screen.getByRole("button").className).not.toContain("bg-accent");
    rerender(<Button primary>Primary</Button>);
    expect(screen.getByRole("button").className).toContain("bg-accent");
  });

  it("keeps label and icon on one line (no wrap, non-shrinking icon)", () => {
    render(<Button>Label</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("whitespace-nowrap");
    expect(cls).toContain("[&>svg]:shrink-0");
  });
});

describe("Menu", () => {
  /**
   * Das Blatt misst sich an seinem längsten Eintrag.
   *
   * Ein absolut gesetztes Blatt darf von Haus aus nur so breit werden wie sein
   * Anker · daran ist „Alle analysieren (1 offen)" neben dem Plus-Hinweis in
   * drei gestapelte Wortfetzen zerfallen. `w-max` löst es davon, der Schirm
   * bleibt die Grenze.
   */
  it("sizes its sheet to the longest entry, capped by the screen", () => {
    render(
      <Menu label="Analysieren">
        <MenuItem>Alle analysieren (12 offen)</MenuItem>
      </Menu>
    );
    fireEvent.click(screen.getByRole("button", { name: "Analysieren" }));
    const cls = screen.getByRole("menu").className;
    expect(cls).toContain("w-max");
    expect(cls).toContain("max-w-[calc(100vw-1.5rem)]");
  });

  /** Ist das Menü die Hauptaktion seiner Zeile, nimmt es die ganze Zeile. */
  it("fills its row when it is the main action", () => {
    const { rerender } = render(<Menu label="Analysieren"><MenuItem>Alle</MenuItem></Menu>);
    expect(screen.getByRole("button", { name: "Analysieren" }).className).not.toContain("w-full");
    rerender(<Menu label="Analysieren" block><MenuItem>Alle</MenuItem></Menu>);
    expect(screen.getByRole("button", { name: "Analysieren" }).className).toContain("w-full");
  });
});

describe("Tag", () => {
  it("renders its children", () => {
    render(<Tag>Miniature</Tag>);
    expect(screen.getByText("Miniature")).toBeTruthy();
  });
});

describe("SourceBadge", () => {
  it("labels the source", () => {
    const { rerender } = render(<SourceBadge source="chess.com" />);
    expect(screen.getByText("chess.com")).toBeTruthy();
    rerender(<SourceBadge source="lichess" />);
    expect(screen.getByText("lichess")).toBeTruthy();
  });
});
