/**
 * Automatischer Hintergrund-Sync (Mobile-Client).
 *
 * Sobald in den Einstellungen aktiviert und ein Hub konfiguriert ist, läuft der
 * Sync selbstständig: bei lokalen Änderungen (entprellt/gebündelt), per Timer
 * als Sicherheitsnetz und bei App-Fokus. Fehler (Hub nicht erreichbar) werden
 * leise behandelt (Status "error" + Backoff), nicht als Fehlermeldung.
 *
 * Der Kern (Planung/Entprellung/Backoff/In-Flight) ist DOM-frei und über
 * injizierte `run`/`now` unit-testbar; Browser-Trigger (Fokus, Sichtbarkeit,
 * Datenänderung) hängt `start()` separat an.
 */
import { useEffect, useState } from "react";
import { syncNow } from "./sync";
import { onDataChange } from "./changes";

export type SyncPhase = "idle" | "syncing" | "error";

export interface SyncStatus {
  /** Auto-Sync aktiv (aktiviert + Hub konfiguriert)? */
  active: boolean;
  phase: SyncPhase;
  /** Unix-Sekunden des letzten Erfolgs (0 = nie). */
  lastSync: number;
  lastError: string | null;
}

export interface SyncManagerOptions {
  /** Führt einen Sync-Roundtrip aus (wirft bei Fehler). */
  run: () => Promise<unknown>;
  /** Zeitquelle in ms (Default Date.now) — für Tests injizierbar. */
  now?: () => number;
  /** Änderungs-Bursts zu einem Roundtrip bündeln. */
  debounceMs?: number;
  /** Sicherheitsnetz-Intervall (fängt Backend-/Desktop-Änderungen). */
  periodMs?: number;
  /** Mindestabstand zwischen zwei Syncs (Drossel). */
  minGapMs?: number;
  /** Obergrenze für den Fehler-Backoff. */
  maxBackoffMs?: number;
}

export class AutoSyncManager {
  private opts: Required<SyncManagerOptions>;
  private active = false;
  private phase: SyncPhase = "idle";
  private lastSync = 0;
  private lastError: string | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private periodTimer: ReturnType<typeof setInterval> | null = null;

  private inFlight = false;
  private pendingAgain = false;
  private lastAttemptAt = 0;
  private failCount = 0;

  private subscribers = new Set<(s: SyncStatus) => void>();
  private unbind: (() => void) | null = null;

  constructor(options: SyncManagerOptions) {
    this.opts = {
      now: () => Date.now(),
      debounceMs: 4000,
      periodMs: 5 * 60_000,
      minGapMs: 8000,
      maxBackoffMs: 5 * 60_000,
      ...options,
    };
  }

  getStatus(): SyncStatus {
    return {
      active: this.active,
      phase: this.phase,
      lastSync: this.lastSync,
      lastError: this.lastError,
    };
  }

  subscribe(cb: (s: SyncStatus) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  /** Aktiviert/deaktiviert den Auto-Sync. `lastSync` setzt den Startwert. */
  setActive(active: boolean, lastSync?: number): void {
    if (lastSync != null && lastSync > this.lastSync) this.lastSync = lastSync;
    if (active === this.active) {
      this.emit();
      return;
    }
    this.active = active;
    if (active) this.start();
    else this.stop();
    this.emit();
  }

  /** Eine lokale Änderung — plant einen entprellten Sync. */
  notifyChange(): void {
    if (!this.active) return;
    this.clearTimer("debounce");
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.schedule();
    }, this.opts.debounceMs);
  }

  /** Sofort-Trigger (App-Fokus/Timer) — respektiert aber den Mindestabstand. */
  kick(): void {
    if (!this.active) return;
    this.clearTimer("debounce");
    this.schedule();
  }

  /** Manueller Sofort-Sync (z. B. Button); ignoriert die Drossel. */
  async syncNow(): Promise<void> {
    if (!this.active) return;
    await this.runOnce();
  }

  dispose(): void {
    this.stop();
    this.subscribers.clear();
  }

  // ── intern ────────────────────────────────────────────────────────────────

  private start(): void {
    this.periodTimer = setInterval(() => this.kick(), this.opts.periodMs);
    this.bindBrowser();
    // Beim Aktivieren einmal abgleichen.
    this.schedule();
  }

  private stop(): void {
    this.clearTimer("debounce");
    this.clearTimer("gap");
    if (this.periodTimer != null) {
      clearInterval(this.periodTimer);
      this.periodTimer = null;
    }
    this.unbind?.();
    this.unbind = null;
    this.phase = "idle";
  }

  /** Plant den nächsten Sync unter Beachtung des Mindestabstands. */
  private schedule(): void {
    if (!this.active || this.gapTimer != null) return;
    const wait = this.opts.minGapMs - (this.opts.now() - this.lastAttemptAt);
    if (wait <= 0) {
      void this.runOnce();
    } else {
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        void this.runOnce();
      }, wait);
    }
  }

  private async runOnce(): Promise<void> {
    if (!this.active) return;
    if (this.inFlight) {
      this.pendingAgain = true;
      return;
    }
    this.inFlight = true;
    this.lastAttemptAt = this.opts.now();
    this.setPhase("syncing");
    try {
      await this.opts.run();
      this.lastSync = Math.floor(this.opts.now() / 1000);
      this.lastError = null;
      this.failCount = 0;
      this.setPhase("idle");
    } catch (e) {
      this.failCount++;
      this.lastError = String(e);
      this.setPhase("error");
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
      if (this.pendingAgain) {
        this.pendingAgain = false;
        this.schedule();
      }
    }
  }

  private scheduleRetry(): void {
    if (this.gapTimer != null) return;
    const backoff = Math.min(
      this.opts.minGapMs * 2 ** Math.min(this.failCount, 8),
      this.opts.maxBackoffMs
    );
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      this.schedule();
    }, backoff);
  }

  private bindBrowser(): void {
    if (typeof window === "undefined") return;
    const onFocus = () => this.kick();
    const onVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") this.kick();
    };
    const offData = onDataChange(() => this.notifyChange());
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    this.unbind = () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      offData();
    };
  }

  private clearTimer(which: "debounce" | "gap"): void {
    const key = which === "debounce" ? "debounceTimer" : "gapTimer";
    const t = this[key];
    if (t != null) {
      clearTimeout(t);
      this[key] = null;
    }
  }

  private setPhase(p: SyncPhase): void {
    this.phase = p;
    this.emit();
  }

  private emit(): void {
    const s = this.getStatus();
    for (const cb of this.subscribers) cb(s);
  }
}

// ── App-weite Instanz ─────────────────────────────────────────────────────────

/** Singleton für die App (Mobile-Client). */
export const autoSync = new AutoSyncManager({ run: () => syncNow() });

/**
 * Aktiviert Auto-Sync nur, wenn wir mobil sind, es eingeschaltet ist und ein
 * Hub konfiguriert wurde. Aus App.tsx (beim Laden) und Settings (nach Speichern)
 * aufgerufen.
 */
export function configureAutoSync(
  opts: { isMobile: boolean; syncAuto: boolean; syncHost: string; lastSync?: number }
): void {
  const active = opts.isMobile && opts.syncAuto && opts.syncHost.trim() !== "";
  autoSync.setActive(active, opts.lastSync);
}

/** React-Hook: liefert den aktuellen Auto-Sync-Status (re-rendert bei Änderung). */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => autoSync.getStatus());
  useEffect(() => autoSync.subscribe(setStatus), []);
  return status;
}
