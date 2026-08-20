import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import Study from "./Study";
import { demoDeepInsights } from "./insights/demo";
import { grantPlus } from "../test/plus";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const DAY = 86_400;

function liveStudy(overrides: Record<string, unknown> = {}) {
  const today = Math.floor(Date.now() / 1000 / DAY);
  return {
    due_now: 7,
    due_week: [7, 3, 0, 2, 1, 0, 4],
    unanalyzed: 2,
    today_puzzle_attempts: 3,
    puzzle_goal: 10,
    activity: [...Array(7)].map((_, index) => ({
      day_ts: (today - 6 + index) * DAY,
      puzzle_attempts: index === 6 ? 3 : 0,
      endgame_attempts: 0,
      rep_reviews: 0,
    })),
    streak_days: 4,
    ...overrides,
  };
}

function emptyProgram(overrides: Record<string, unknown> = {}) {
  return {
    focuses: [],
    history: [],
    load_28d: [
      { area: "play", items: 20, minutes: 200 },
      { area: "tactics", items: 40, minutes: 60 },
      { area: "openings", items: 10, minutes: 5 },
      { area: "endgames", items: 0, minutes: 0 },
      { area: "analysis", items: 4, minutes: 24 },
    ],
    days: [],
    observed_weekly_minutes: 72,
    ...overrides,
  };
}

/** Ein Messfenster mit genug Material, damit ein Urteil zustande kommt. */
function window(blunders: number, games = 40) {
  return {
    from_ts: 0,
    to_ts: 1,
    games,
    ratings: [],
    metrics: [
      {
        key: "blunders_middlegame_per100",
        value: blunders,
        n: 1_200,
        sd: null,
        unit: "per100",
        lower_is_better: true,
      },
    ],
  };
}

interface BackendOptions {
  study?: ReturnType<typeof liveStudy>;
  deep?: unknown;
  program?: ReturnType<typeof emptyProgram>;
  puzzles?: unknown;
  metrics?: unknown[];
  settings?: Record<string, unknown>;
}

function mockBackend(options: BackendOptions = {}) {
  const {
    study = liveStudy(),
    deep = null,
    program = emptyProgram(),
    puzzles = null,
    metrics = [],
    settings = {},
  } = options;
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "app_info":
        return Promise.resolve({ version: "0.4.4", backend: "tauri", platform: "windows" });
      case "get_settings":
        return Promise.resolve({
          locale: "de",
          weekly_minutes: 0,
          training_days: 0,
          goal_date: "",
          focus_cycle_days: 14,
          ...settings,
        });
      case "study_data":
        return Promise.resolve(study);
      case "training_program":
        return Promise.resolve(program);
      case "list_game_summaries":
        return Promise.resolve([]);
      case "puzzle_insights":
        return Promise.resolve(puzzles);
      case "study_metrics":
        return Promise.resolve(metrics);
      case "set_study_focus":
        return Promise.resolve({
          id: 9,
          area: "tactics",
          metric_key: "blunders_middlegame_per100",
          label_params: "{}",
          target: null,
          cycle_days: 14,
          start_ts: 0,
          end_ts: 0,
          status: "active",
        });
      case "close_study_focus":
        return Promise.resolve();
      case "study_calendar":
        return Promise.resolve({
          templates: [
            {
              id: 1,
              title: "Taktik",
              duration_min: 0,
              tool: "Kiebitz Puzzles",
              description: "15–20 Aufgaben",
              area: "tactics",
              areas: ["tactics"],
              builtin: "tactics",
              i18n_key: "",
            },
          ],
          events: [],
          days: [],
        });
      case "schedule_study_unit":
        return Promise.resolve(1);
      case "apply_week_plan":
        return Promise.resolve(1);
      case "set_settings":
        return Promise.resolve({ locale: "de", weekly_minutes: 72, training_days: 0 });
      case "deep_insights":
        return deep ? Promise.resolve(deep) : Promise.reject(new Error("keine Tiefenanalyse"));
      default:
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    }
  });
}

function renderStudy(
  go = vi.fn(),
  openPuzzles = vi.fn(),
  mobile = false,
  openEndgame = vi.fn()
) {
  render(
    <LocaleProvider>
      <ShellProvider mobile={mobile}>
        <Study go={go} openPuzzles={openPuzzles} openEndgame={openEndgame} />
      </ShellProvider>
    </LocaleProvider>
  );
  return { go, openPuzzles, openEndgame };
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  // Wochenvorschlag und Fokuszyklen gehören zu Kiebitz Plus · hier geht es um
  // ihr Verhalten, nicht um das Gate davor.
  grantPlus();
});

afterEach(cleanup);

describe("Study page", () => {
  it("loads and renders the data-backed daily plan through Tauri invoke", async () => {
    mockBackend();
    renderStudy();

    expect(await screen.findByText("3 / 10")).toBeTruthy();
    expect(screen.getAllByText("7 fällig").length).toBeGreaterThan(0);
    expect(screen.getByText("2 Partien offen")).toBeTruthy();
    expect(screen.getByText("4 Tage Serie")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("study_data");
    expect(invokeMock).toHaveBeenCalledWith("training_program", { days: null });
  });

  it("routes an unfinished puzzle task to the puzzle trainer", async () => {
    mockBackend();
    const openPuzzles = vi.fn();
    renderStudy(vi.fn(), openPuzzles);

    await screen.findByText("3 / 10");
    fireEvent.click(screen.getByRole("button", { name: "Lösen" }));
    expect(openPuzzles).toHaveBeenCalled();
  });

  it("turns findings into quantified prescriptions with a budget split", async () => {
    mockBackend({ deep: demoDeepInsights() });
    const go = vi.fn();
    renderStudy(go);

    // Ein Befund aus der Tiefenanalyse …
    expect(await screen.findByText("Zeitnot kostet dich Partien")).toBeTruthy();
    // … und die Soll-Verteilung, die aus allen Befunden entsteht: sie steht
    // in der Wochenkarte, neben dem gemessenen Ist, und nirgends sonst.
    expect(document.querySelector("[data-week-area='tactics']")).toBeTruthy();
    expect(document.querySelectorAll("[data-week-budget]")).toHaveLength(1);
    // Der Rest der Liste bleibt über die Insights erreichbar.
    fireEvent.click(screen.getByRole("button", { name: /Befunde in den Insights/ }));
    expect(go).toHaveBeenCalledWith("insights");
  });

  it("passes the recommended rating band into the puzzle trainer", async () => {
    mockBackend({
      deep: demoDeepInsights(),
      puzzles: {
        personal_rating: 1500,
        attempts: 120,
        solved: 70,
        avg_puzzle_rating: 1480,
        avg_solved_rating: 1450,
        best_run: 8,
        current_run: 2,
        themes: [{ theme: "fork", attempts: 20, solved: 6 }],
        by_rating: [{ key: 1200, attempts: 40, solved: 26 }],
        by_weekday: [],
        by_hour: [],
        timeline: [],
      },
    });
    const openPuzzles = vi.fn();
    renderStudy(vi.fn(), openPuzzles);

    // Die Dosis nennt Band und Motiv, statt "üb mal Taktik" zu sagen.
    expect(await screen.findByText(/Aufgaben pro Tag im Band 1\.400–1\.650/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Puzzles" })[0]);
    expect(openPuzzles).toHaveBeenCalledWith(
      "fork",
      expect.objectContaining({ minRating: 1400, maxRating: 1650 })
    );
  });

  it("starts a focus cycle and shows the verdict once a cycle is running", async () => {
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();
    await screen.findByText("Zeitnot kostet dich Partien");

    fireEvent.click(screen.getAllByRole("button", { name: "Als Fokus setzen" })[0]);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "set_study_focus",
        expect.objectContaining({
          focus: expect.objectContaining({ cycle_days: 14 }),
        })
      );
    });
  });

  it("reports a running cycle as not yet measurable when the sample is short", async () => {
    const start = Math.floor(Date.now() / 1000) - 5 * DAY;
    mockBackend({
      deep: demoDeepInsights(),
      program: emptyProgram({
        focuses: [
          {
            id: 3,
            area: "tactics",
            metric_key: "blunders_middlegame_per100",
            label_params: "{}",
            target: 2,
            cycle_days: 14,
            start_ts: start,
            end_ts: 0,
            status: "active",
          },
        ],
      }),
      // Zu wenig Material im Nachher-Fenster · das Urteil muss ausbleiben.
      metrics: [
        window(3.1),
        { ...window(2.4), metrics: [{ ...window(2.4).metrics[0], n: 90 }] },
      ],
    });
    renderStudy();

    expect(await screen.findByText(/noch nicht messbar/)).toBeTruthy();
    expect(screen.getByText("Tag 6/14")).toBeTruthy();
  });

  it("calls a real improvement a real improvement", async () => {
    const start = Math.floor(Date.now() / 1000) - 12 * DAY;
    mockBackend({
      deep: demoDeepInsights(),
      program: emptyProgram({
        focuses: [
          {
            id: 4,
            area: "tactics",
            metric_key: "blunders_middlegame_per100",
            label_params: "{}",
            target: 2,
            cycle_days: 14,
            start_ts: start,
            end_ts: 0,
            status: "active",
          },
        ],
      }),
      // 3,4 → 1,9 bei 1.200 Zügen liegt klar über der Rauschgrenze.
      metrics: [window(3.4), window(1.9)],
    });
    renderStudy();

    expect(await screen.findByText("wirkt")).toBeTruthy();
    expect(screen.getByText("3,4 → 1,9")).toBeTruthy();
  });

  it("completes an elapsed focus cycle as a success instead of dropping it", async () => {
    const start = Math.floor(Date.now() / 1000) - 15 * DAY;
    mockBackend({
      deep: demoDeepInsights(),
      program: emptyProgram({
        focuses: [
          {
            id: 5,
            area: "tactics",
            metric_key: "blunders_middlegame_per100",
            label_params: "{}",
            target: 2,
            cycle_days: 14,
            start_ts: start,
            end_ts: 0,
            status: "active",
          },
        ],
      }),
      metrics: [window(3.4), window(1.9)],
    });
    renderStudy();

    fireEvent.click(await screen.findByRole("button", { name: "Zyklus abschließen" }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("close_study_focus", {
        focusId: 5,
        status: "done",
      });
    });
  });

  it("marks a fully completed backend plan as done", async () => {
    mockBackend({ study: liveStudy({ due_now: 0, unanalyzed: 0, today_puzzle_attempts: 30 }) });
    renderStudy();

    expect(await screen.findByText("Tagesplan komplett · starke Arbeit!")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText("Erledigt")).toHaveLength(3);
    });
  });

  it("acts as the training hub on mobile, but leaves the desktop page alone", async () => {
    mockBackend();
    const { go, openPuzzles } = renderStudy(vi.fn(), vi.fn(), true);
    await screen.findAllByText("3 / 10");

    const hub = within(screen.getByRole("navigation", { name: "Trainingsbereiche" }));
    expect(hub.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Repertoire7 fällig",
      "Puzzles3 / 10",
      "EndspieleTheorie gegen die Engine",
    ]);

    fireEvent.click(hub.getByRole("button", { name: /^Endspiele/ }));
    expect(go).toHaveBeenCalledWith("endgame");
    fireEvent.click(hub.getByRole("button", { name: /^Puzzles/ }));
    expect(openPuzzles).toHaveBeenCalled();

    cleanup();
    renderStudy();
    await screen.findByText("3 / 10");
    expect(screen.queryByRole("navigation", { name: "Trainingsbereiche" })).toBeNull();
  });

  it("stacks the focus action below the text only in the mobile shell", async () => {
    mockBackend({ deep: demoDeepInsights() });
    renderStudy(vi.fn(), vi.fn(), true);

    const mobileCard = (await screen.findByText("Zeitnot kostet dich Partien")).closest(
      "[data-focus-card]"
    ) as HTMLElement;
    const mobileAction = within(mobileCard).queryByRole("button", {
      name: /Puzzles|Repertoire|Endspiele|Analyse|Partien/,
    });
    if (mobileAction) expect(mobileAction.className).toContain("w-full");

    cleanup();
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();
    const desktopCard = (await screen.findByText("Zeitnot kostet dich Partien")).closest(
      "[data-focus-card]"
    ) as HTMLElement;
    const desktopAction = within(desktopCard).queryByRole("button", {
      name: /Puzzles|Repertoire|Endspiele|Analyse|Partien/,
    });
    if (desktopAction) expect(desktopAction.className).not.toContain("w-full");
  });

  it("proposes a week plan and only writes it after confirmation", async () => {
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();
    await screen.findByText("Zeitnot kostet dich Partien");

    fireEvent.click(screen.getByRole("button", { name: /Die nächsten 7 Tage planen/ }));
    expect(await screen.findByText("Vorschlag für die nächsten 7 Tage")).toBeTruthy();
    // Bis hierher darf nichts gespeichert sein.
    expect(invokeMock).not.toHaveBeenCalledWith("apply_week_plan", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "In den Kalender übernehmen" }));
    await waitFor(() => {
      const call = invokeMock.mock.calls.find(([command]) => command === "apply_week_plan");
      // Ein Aufruf für die ganze Woche: er ersetzt frühere Vorschläge, statt
      // sie ein zweites Mal danebenzulegen. Jede Einheit trägt ihre Minuten.
      expect(call?.[1].units.length).toBeGreaterThan(0);
      expect(call?.[1].units[0]).toMatchObject({ template_id: 1 });
      expect(call?.[1].units.every((unit: { planned_min: number }) => unit.planned_min >= 10)).toBe(
        true
      );
    });
  });

  it("names the source of the weekly target without offering to adopt it", async () => {
    // Ohne Vorgabe rechnet der Plan mit dem beobachteten Schnitt · und sagt
    // das auch, denn genau diese Zahl kann sich je Gerät unterscheiden. Die
    // Zeile ist reine Auskunft: das Budget wird in den Einstellungen gesetzt.
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();

    expect(await screen.findByText(/Kein Wochenbudget gesetzt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\d+ Min\. übernehmen/ })).toBeNull();
  });

  it("schedules an editable unit from the week calendar", async () => {
    mockBackend();
    renderStudy();
    await screen.findByText("3 / 10");

    // Die Vorlagen liegen eingeklappt unter dem Kalender.
    fireEvent.click(screen.getByRole("button", { name: /Lerneinheiten/ }));
    expect(await screen.findByText("15–20 Aufgaben")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Planen" }));

    await waitFor(() => {
      // Die Länge kommt aus dem Budget, nicht aus einem Eingabefeld.
      const call = invokeMock.mock.calls.find(([command]) => command === "schedule_study_unit");
      expect(call?.[1]).toMatchObject({ templateId: 1 });
      expect(call?.[1].plannedMin).toBeGreaterThanOrEqual(10);
    });
  });
});
