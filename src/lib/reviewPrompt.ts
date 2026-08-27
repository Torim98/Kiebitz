import { invoke } from "@tauri-apps/api/core";
import type { BackendInfo } from "./backend";

const STORAGE_KEY = "kiebitz.playReview.v1";
const REVIEW_COOLDOWN_DAYS = 90;
const COOLDOWN_MS = REVIEW_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const MIN_ANALYZED_GAMES = 10;
const MIN_SOLVED_PUZZLES = 25;
const MIN_CORRECT_REPERTOIRE_ANSWERS = 5;
const MIN_MASTERED_ENDGAME_DRILLS = 5;

export type ReviewMilestone =
  | { kind: "analysis-complete"; totalAnalyzedGames: number }
  | { kind: "puzzle-solved"; totalSolved: number }
  | { kind: "repertoire-session-complete"; correctAnswers: number }
  | { kind: "endgame-drill-mastered"; masteredDrills: number };

interface ReviewState {
  lastRequestedAt: number;
}

interface NativeReviewResult {
  /** Play Core konnte den Review-Flow anfordern und starten. */
  requested: boolean;
}

let requestInFlight = false;
let volatileLastRequestedAt = 0;

function lastRequestedAt(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return volatileLastRequestedAt;
    const parsed = JSON.parse(raw) as Partial<ReviewState>;
    return typeof parsed.lastRequestedAt === "number"
      ? parsed.lastRequestedAt
      : volatileLastRequestedAt;
  } catch {
    return volatileLastRequestedAt;
  }
}

function rememberRequest(at: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lastRequestedAt: at } satisfies ReviewState));
  } catch {
    // Auch bei deaktiviertem WebView-Speicher nicht mehrfach in derselben
    // Sitzung fragen.
    volatileLastRequestedAt = at;
  }
}

function isEligible(milestone: ReviewMilestone): boolean {
  switch (milestone.kind) {
    case "analysis-complete":
      return milestone.totalAnalyzedGames >= MIN_ANALYZED_GAMES;
    case "puzzle-solved":
      return milestone.totalSolved >= MIN_SOLVED_PUZZLES;
    case "repertoire-session-complete":
      return milestone.correctAnswers >= MIN_CORRECT_REPERTOIRE_ANSWERS;
    case "endgame-drill-mastered":
      return milestone.masteredDrills >= MIN_MASTERED_ENDGAME_DRILLS;
  }
}

/**
 * Fordert den nativen Play-Review-Flow ausschließlich aus einem expliziten
 * Erfolgsmoment heraus an. Es gibt bewusst keinen Aufruf aus App.tsx oder
 * einem Start-Effect. Play kann den Dialog trotz erfolgreicher Anfrage wegen
 * seines eigenen Kontingents unterdrücken.
 */
export async function maybeRequestPlayReview(
  backend: BackendInfo | undefined,
  milestone: ReviewMilestone
): Promise<boolean> {
  if (
    backend?.platform !== "android" ||
    backend.distribution !== "play-store" ||
    !isEligible(milestone) ||
    requestInFlight
  ) {
    return false;
  }

  const now = Date.now();
  if (now - lastRequestedAt() < COOLDOWN_MS) return false;

  requestInFlight = true;
  try {
    const result = await invoke<NativeReviewResult>("request_play_review");
    if (!result.requested) return false;
    rememberRequest(now);
    return true;
  } catch {
    // Der Erfolgsmoment bleibt ungestört; ein technischer Fehlschlag sperrt
    // einen späteren Versuch nicht.
    return false;
  } finally {
    requestInFlight = false;
  }
}
