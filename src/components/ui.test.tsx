import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, Tag, SourceBadge } from "./ui";

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
