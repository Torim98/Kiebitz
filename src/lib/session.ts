/**
 * Gemessene Trainingszeit statt gezählter Klicks.
 *
 * Das Trainingsbudget verglich früher eine getippte Wochenvorgabe mit einer
 * Hochrechnung („1,5 Minuten je Puzzle"). Diese Datei misst stattdessen, was
 * tatsächlich passiert: eine Trainerseite meldet sich an, und solange der
 * Nutzer wirklich dort ist, laufen Sekunden.
 *
 * „Wirklich dort" heißt drei Dinge zusammen:
 *
 * · Das Fenster ist sichtbar. Ein Tab im Hintergrund trainiert nicht.
 * · Die letzte Eingabe liegt innerhalb des Aufmerksamkeitsfensters. Eine offen
 *   stehengelassene App zählt nicht weiter.
 * · Das Fenster ist nicht abgemeldet worden (Seitenwechsel, Schließen).
 *
 * Das Fenster ist mit drei Minuten bewusst großzügig: eine Stellung zu
 * durchdenken ist Training, auch wenn dabei nichts angeklickt wird. Wer
 * weggeht, verliert dadurch höchstens drei Minuten an Überzählung — deutlich
 * weniger, als die alte Schätzung danebenlag.
 *
 * Fortgeschrieben wird regelmäßig, nicht erst am Ende: ein Absturz kostet
 * damit höchstens ein Intervall statt der ganzen Sitzung.
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { emitDataChange } from "./changes";

/** Bereiche mit eigener Trainerseite · „play" misst die Partieuhr, nicht die App. */
export type SessionArea = "tactics" | "openings" | "endgames" | "analysis";

/** So lange nach der letzten Eingabe gilt die Sitzung noch als aktiv. */
const IDLE_MS = 180_000;
/** Takt des Zählers. */
const TICK_MS = 1_000;
/** Nach so vielen gezählten Sekunden wird fortgeschrieben. */
const FLUSH_SECONDS = 30;

const DAY_SECONDS = 86_400;

function dayBucket(seconds: number): number {
  return Math.floor(seconds / DAY_SECONDS);
}

/** Schlüssel einer Sitzung · geräteweit eindeutig, damit der Sync sie zuordnet. */
function newSessionKey(area: SessionArea, startTs: number): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `session-${area}-${startTs}-${random}`;
}

/**
 * Zählt aktive Sekunden für einen Bereich, solange `active` gilt.
 *
 * Ohne Desktop-Backend passiert nichts · die Web-Vorschau hat keine Datenbank,
 * in die eine Messung gehörte.
 */
export function useTrainingSession(area: SessionArea, active = true): void {
  useEffect(() => {
    if (!active) return;
    // Der Tauri-Aufruf existiert nur im Desktop-Backend; in der Web-Vorschau
    // und im Test-DOM bleibt die Messung still.
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

    let startTs = Math.floor(Date.now() / 1000);
    let key = newSessionKey(area, startTs);
    let seconds = 0;
    let flushedSeconds = 0;
    let lastInput = Date.now();
    let disposed = false;

    /**
     * `announce` meldet die neuen Minuten an die Oberfläche. Das passiert nur
     * beim Verlassen der Seite · ein Herzschlag alle 30 Sekunden würde sonst
     * den Lernplan im Hintergrund immer wieder neu rechnen lassen.
     */
    const flush = (announce = false) => {
      if (disposed || seconds <= flushedSeconds) return;
      const pending = seconds;
      const pendingKey = key;
      const pendingStart = startTs;
      flushedSeconds = pending;
      void invoke("record_study_time", {
        sessionKey: pendingKey,
        area,
        startTs: pendingStart,
        seconds: pending,
      })
        .then(() => {
          if (announce) emitDataChange("study");
        })
        .catch(() => {
          // Ein fehlgeschlagener Herzschlag darf das Training nicht stören.
          // Beim nächsten Versuch geht ohnehin der volle Stand mit, weil
          // `seconds` kumulativ ist.
          if (flushedSeconds === pending) flushedSeconds = pending - 1;
        });
    };

    /**
     * Über Mitternacht beginnt eine neue Sitzung. Die Tageszuordnung hängt am
     * Startzeitpunkt · ohne Schnitt läge eine Nachtsitzung komplett auf dem
     * Vortag.
     */
    const rotateIfNewDay = (nowTs: number) => {
      if (dayBucket(nowTs) === dayBucket(startTs)) return;
      flush();
      startTs = nowTs;
      key = newSessionKey(area, startTs);
      seconds = 0;
      flushedSeconds = 0;
    };

    const noteInput = () => {
      lastInput = Date.now();
    };

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastInput > IDLE_MS) return;
      rotateIfNewDay(Math.floor(Date.now() / 1000));
      seconds += TICK_MS / 1_000;
      if (seconds - flushedSeconds >= FLUSH_SECONDS) flush();
    };

    const onVisibility = () => {
      // Beim Wegschalten den Stand sichern, beim Zurückkommen nicht die
      // Abwesenheit als Denkpause zählen.
      if (document.visibilityState === "visible") lastInput = Date.now();
      else flush();
    };

    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) {
      window.addEventListener(event, noteInput, { passive: true, capture: true });
    }
    const onPageHide = () => flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    const timer = window.setInterval(tick, TICK_MS);

    return () => {
      window.clearInterval(timer);
      for (const event of events) {
        window.removeEventListener(event, noteInput, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      flush(true);
      disposed = true;
    };
  }, [area, active]);
}
