/**
 * Berechtigungsstand für Oberflächentests.
 *
 * Die Seitentests prüfen die Funktionen selbst, nicht das Gate davor. Sie
 * setzen den Plus-Zustand deshalb direkt · ohne API, ohne Token, ohne Netz.
 * Für das Gate selbst gibt es eigene Tests neben dem Store.
 */
import { setPlusStateForTests } from "../lib/plus/store";
import { ALL_FEATURES, PLUS_ONLY_FEATURES, type EntitlementClaims } from "../lib/plus/types";

function claims(overrides: Partial<EntitlementClaims> = {}): EntitlementClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://api.kiebitz.dev",
    sub: "acc_test",
    aud: "kiebitz-app",
    plan: "plus",
    features: [...ALL_FEATURES],
    provider: "stripe",
    providers: ["stripe"],
    status: "active",
    trial: false,
    trial_until: null,
    entitlement_valid_until: now + 30 * 86_400,
    iat: now - 60,
    exp: now + 7 * 86_400,
    ...overrides,
  };
}

/** Vollständiges Plus · alle Feature-IDs freigeschaltet. */
export function grantPlus(overrides: Partial<EntitlementClaims> = {}): void {
  setPlusStateForTests({
    loading: false,
    signedIn: true,
    claims: claims(overrides),
    account: {
      id: "acc_test",
      email: "test@example.com",
      plan: "plus",
      status: "active",
      providers: ["stripe"],
      trial: false,
      trial_eligible: false,
    },
    error: null,
  });
}

/** Angemeldet, aber ohne Plus · der Zustand hinter jedem Gate. */
export function revokePlus(): void {
  setPlusStateForTests({
    loading: false,
    signedIn: false,
    claims: null,
    account: null,
    error: null,
  });
}

export { PLUS_ONLY_FEATURES };
