/**
 * React-Anbindung an den Plus-Zustand.
 *
 * `usePlus()` liefert den aktuellen Stand samt Feature-Prüfung, `usePlusGate()`
 * beantwortet die einzige Frage, die die Seiten stellen: Ist diese Funktion
 * freigeschaltet, und wenn nicht, wie erkläre ich das.
 */
import { useEffect, useState } from "react";
import {
  featureUnlocked,
  initPlus,
  plusState,
  refreshEntitlement,
  subscribePlus,
  type PlusState,
} from "./store";
import { claimsStillValid } from "./token";
import type { PlusFeature } from "./types";

export interface PlusView extends PlusState {
  /** Gültiges Plus (bezahlt, Trial oder Grace Period). */
  isPlus: boolean;
  /** Läuft gerade der kostenlose Testzeitraum? */
  isTrial: boolean;
  /** Darf der Trial-CTA gezeigt werden? */
  trialEligible: boolean;
  has: (feature: PlusFeature) => boolean;
}

function view(state: PlusState): PlusView {
  // Plus gilt genau dann, wenn der geprüfte Token noch läuft · dieselbe Regel
  // wie für jedes einzelne Feature, damit Anzeige und Gate nie auseinanderlaufen.
  const isPlus = Boolean(
    state.claims && state.claims.plan === "plus" && claimsStillValid(state.claims)
  );
  return {
    ...state,
    isPlus,
    isTrial: isPlus && state.claims?.trial === true,
    trialEligible: state.account?.trial_eligible === true,
    has: (feature) => featureUnlocked(feature, state),
  };
}

/**
 * Abonniert den Plus-Zustand.
 *
 * Der erste Aufruf stößt die Initialisierung an; alle weiteren teilen sie sich.
 * Beim erneuten Fokus des Fensters wird nachgefragt · nach der Rückkehr aus
 * dem Systembrowser ist das der Moment, in dem der Kauf ankommen kann.
 */
export function usePlus(): PlusView {
  const [state, setState] = useState<PlusState>(() => plusState());

  useEffect(() => {
    const unsubscribe = subscribePlus(setState);
    setState(plusState());
    void initPlus();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Nach Checkout oder Portal kann `refresh_after` des vorherigen Tokens
    // noch viele Stunden in der Zukunft liegen. Beim tatsächlichen Zurück-
    // kehren in die App muss deshalb genau diese Schranke übergangen werden.
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      void refreshEntitlement({ force: true }).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return view(state);
}

export interface FeatureGate {
  /** Freigeschaltet · die Funktion darf laufen. */
  unlocked: boolean;
  /** Der Plus-Zustand steht noch nicht fest; Vorschau statt Sperrhinweis. */
  pending: boolean;
  plus: PlusView;
}

/**
 * Gate für eine einzelne Funktion.
 *
 * Gesperrte Funktionen bleiben sichtbar: Wer nicht weiß, was es gibt, kauft es
 * auch nicht, und ein plötzlich verschwundener Menüpunkt liest sich wie ein
 * Fehler. Die Seiten zeigen deshalb eine Vorschau und öffnen die gemeinsame
 * Plus-Erklärung.
 */
export function usePlusGate(feature: PlusFeature): FeatureGate {
  const plus = usePlus();
  return {
    unlocked: plus.has(feature),
    pending: plus.loading,
    plus,
  };
}
