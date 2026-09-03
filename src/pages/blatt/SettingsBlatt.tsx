/**
 * Einstellungen im Diagramm-Modus.
 *
 * Wenn der Modus an ist, gilt er auch hier. Aus den achtzehn Abschnittskarten
 * wird ein Register in der linken Spalte, aus den Karten werden Rubriken mit
 * Linien.
 *
 * Der Modus sortiert die Abschnitte nicht um — er setzt sie nur anders. Wer
 * eine Einstellung an ihrem Platz gelernt hat, findet sie hier an derselben
 * Stelle wieder; genau das ist der Unterschied zwischen einem Layoutmodus und
 * einer zweiten App.
 *
 * Der Inhalt jedes Abschnitts kommt unverändert von der Seite: Es sind
 * dieselben Eingaben, dieselben Schalter, dieselbe Speicherlogik.
 */
import { Fragment, type ReactNode } from "react";
import { Kolumnentitel, Rubrik, Verzeichnisteil, Verzeichniszeile } from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";

export interface SettingsAbschnitt {
  id: string;
  titel: string;
  /** Eine Zeile, die sagt, was der Bereich enthält. */
  zeile: string;
  gruppe: string;
  inhalt: ReactNode;
}

export interface SettingsBlattProps {
  mobile: boolean;
  abschnitte: SettingsAbschnitt[];
  /** Überschrift einer Gruppe · derselbe Text wie in der Seite von heute. */
  gruppenTitel: (gruppe: string) => string;
  aktiv: string | null;
  /** Anker-Id eines Abschnitts · dieselbe wie in der gewöhnlichen Fassung. */
  ankerId: (id: string) => string;
  onSpringen: (id: string) => void;
  onSichtbar: (id: string) => void;
  /** Hinweise und Meldungen der Seite · stehen über dem Satzspiegel. */
  meldungen?: ReactNode;
  /** Der Speichern-Griff, falls die Seite einen hat. */
  speichern?: ReactNode;
}

export default function SettingsBlatt({
  mobile,
  abschnitte,
  gruppenTitel,
  aktiv,
  ankerId,
  onSpringen,
  onSichtbar,
  meldungen,
  speichern,
}: SettingsBlattProps) {
  const { t } = useI18n();

  const register = (
    <div className="hidden min-[1160px]:block">
      <nav aria-label={t("set.sections")} className="sticky top-0 flex flex-col pt-1">
        {abschnitte.map((abschnitt, index) => (
          <Fragment key={abschnitt.id}>
            {abschnitt.gruppe !== abschnitte[index - 1]?.gruppe && (
              <Verzeichnisteil>{gruppenTitel(abschnitt.gruppe)}</Verzeichnisteil>
            )}
            <Verzeichniszeile
              name={abschnitt.titel}
              aktiv={abschnitt.id === aktiv}
              hoehe={34}
              onClick={() => onSpringen(abschnitt.id)}
            />
          </Fragment>
        ))}
      </nav>
    </div>
  );

  const liste = (
    <div className="flex flex-col">
      {abschnitte.map((abschnitt, index) => (
        <Fragment key={abschnitt.id}>
          {abschnitt.gruppe !== abschnitte[index - 1]?.gruppe && (
            <div className={index === 0 ? "" : "mt-8"}>
              <Kolumnentitel links={gruppenTitel(abschnitt.gruppe)} />
            </div>
          )}
          {/* Kein Rahmen, keine Karte · Rubrik und Haarlinie, wie im Formular. */}
          <section
            id={ankerId(abschnitt.id)}
            data-settings-section={abschnitt.id}
            ref={(node) => {
              if (node) onSichtbar(abschnitt.id);
            }}
            className="mt-5 scroll-mt-4"
          >
            <Rubrik weg={abschnitt.zeile}>{abschnitt.titel}</Rubrik>
            <div className="pt-3.5">{abschnitt.inhalt}</div>
          </section>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col px-4 pb-8 pt-6 sm:px-10 min-[1160px]:max-w-[1096px]">
      <Kolumnentitel links={t("blatt.settingsTitle")} rechts={speichern} />
      {meldungen && <div className="mt-4">{meldungen}</div>}
      {mobile ? (
        <div className="mt-2">{liste}</div>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-x-8 min-[1160px]:grid-cols-[188px_minmax(0,1fr)]">
          {register}
          {liste}
        </div>
      )}
    </div>
  );
}
