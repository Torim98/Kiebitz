import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import type { Settings } from "../lib/settings";
import Onboarding from "./Onboarding";

const mocks = vi.hoisted(() => ({
  setSettings: vi.fn(),
  runAutoImport: vi.fn(),
}));

vi.mock("../lib/settings", () => ({ setSettings: mocks.setSettings }));
vi.mock("../lib/autoImport", () => ({ runAutoImport: mocks.runAutoImport }));

const fresh = { locale: "en", cc_user: "", li_user: "", display_name: "", onboarded: false } as Settings;

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "en");
  mocks.setSettings.mockImplementation((s: Settings) => Promise.resolve(s));
  mocks.runAutoImport.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Schritt 1 (Sprache) überspringen. */
function goToAccounts() {
  fireEvent.click(screen.getByRole("button", { name: /Next/i }));
}

describe("Onboarding", () => {
  it("stores a single account and kicks off the first import", async () => {
    render(
      <LocaleProvider>
        <Onboarding settings={fresh} onDone={vi.fn()} />
      </LocaleProvider>
    );
    goToAccounts();

    // Nur Lichess · chess.com bleibt leer.
    fireEvent.change(screen.getByLabelText(/Lichess/i), { target: { value: "Torim98" } });
    fireEvent.click(screen.getByRole("button", { name: /Start and import/i }));

    await waitFor(() =>
      expect(mocks.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ li_user: "Torim98", cc_user: "", onboarded: true })
      )
    );
    expect(mocks.runAutoImport).toHaveBeenCalledWith(true);
  });

  it("finishes without any account and imports nothing", async () => {
    const onDone = vi.fn();
    render(
      <LocaleProvider>
        <Onboarding settings={fresh} onDone={onDone} />
      </LocaleProvider>
    );
    goToAccounts();

    expect(screen.getByText(/Without an account Kiebitz starts empty/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Get started/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ cc_user: "", li_user: "", onboarded: true })
    );
    expect(mocks.runAutoImport).not.toHaveBeenCalled();
  });

  it("marks the setup as done when skipped", async () => {
    render(
      <LocaleProvider>
        <Onboarding settings={fresh} onDone={vi.fn()} />
      </LocaleProvider>
    );
    goToAccounts();

    fireEvent.change(screen.getByLabelText(/chess\.com/i), { target: { value: "Torim" } });
    fireEvent.click(screen.getByRole("button", { name: /Set up later/i }));

    await waitFor(() =>
      expect(mocks.setSettings).toHaveBeenCalledWith(expect.objectContaining({ onboarded: true }))
    );
    // Beim Überspringen wird nicht importiert.
    expect(mocks.runAutoImport).not.toHaveBeenCalled();
  });
});
