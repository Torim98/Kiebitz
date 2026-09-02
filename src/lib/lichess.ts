/**
 * Der persönliche Lichess-API-Token.
 *
 * Lichess hat den Eröffnungs-Explorer Anfang 2026 hinter eine Anmeldung
 * gelegt — anonyme Abfragen beantwortet der Server mit 401, bevor sie die
 * Anwendung erreichen. Wer Meister- und Online-Häufigkeiten sehen will, legt
 * dafür einen Token an (lichess.org/account/oauth/token/create, ohne jede
 * Berechtigung — der Explorer verlangt nur, dass überhaupt jemand fragt).
 *
 * Der Token liegt im Schlüsselspeicher des Systems und nicht in der
 * settings.json · er ist ein Zugangsdatum wie die Kontositzung daneben. Von
 * dort holt ihn dieses Modul einmal und reicht ihn an jede Abfrage weiter;
 * das Backend selbst müsste sonst auf zwei Systemen an zwei verschiedenen
 * Ablagen vorbeigreifen.
 */
import { deleteSecret, readSecret, writeSecret } from "./plus/storage";

/** `undefined` = noch nicht gelesen, `null` = keiner hinterlegt. */
let cached: string | null | undefined;
let request: Promise<string | null> | null = null;

export function lichessToken(): Promise<string | null> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!request) {
    request = readSecret("lichess_token")
      .then((value) => {
        cached = value && value.trim() ? value.trim() : null;
        return cached;
      })
      .catch(() => null)
      .finally(() => {
        request = null;
      });
  }
  return request;
}

/** Setzt den Token; ein leerer Wert entfernt ihn. */
export async function setLichessToken(value: string): Promise<void> {
  const token = value.trim();
  if (token) {
    await writeSecret("lichess_token", token);
    cached = token;
  } else {
    await deleteSecret("lichess_token");
    cached = null;
  }
}

/** Nur für Tests · zwingt das nächste Lesen zurück in den Speicher. */
export function resetLichessTokenCache(): void {
  cached = undefined;
  request = null;
}
