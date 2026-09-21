/**
 * Einstellungen: Sprache, Erscheinungsbild, Zaehler auf dem Symbol.
 *
 * Was hier NICHT mehr steht: Cookie-Antwort, Verwechslungswarner und
 * Listenpflege. Die drei sind zu den Filterlisten gewandert — sie bestimmen,
 * WAS geblockt und beantwortet wird, und gehoeren dorthin, wo man das
 * einstellt. Hier blieb, wie die Oberflaeche selbst aussieht und ob sie
 * ueberhaupt laeuft.
 *
 * Die
 * drei Felder schreibt die Seite selbst in `einstellungen`; dafuer gibt es
 * keine Nachricht (vertrag.md 7 kennt nur aktiv und listen). Vor jedem
 * Schreiben wird frisch gelesen, damit ein Wert, den der Hintergrund gerade
 * gesetzt hat (`aktiv`), nicht ueberschrieben wird.
 *
 * Sprachen zur Wahl: nur die mit Katalog (`verfuegbareSprachen`), mit ihrer
 * Eigenbezeichnung aus `sprachen.ts`, in der Reihenfolge des Backends.
 */
import { useEffect, useState } from 'react';
import type { Einstellungen as EinstellungenForm, Thema, Zustand } from '../../gemeinsam/typen.ts';
import { Hinweis, fehlerText } from '../../oberflaeche/Hinweis.tsx';
import { Schalter } from '../../oberflaeche/Schalter.tsx';
import { t, verfuegbareSprachen } from '../../oberflaeche/i18n.ts';
import { beiSpeicherAenderung, leseSpeicher, schreibeSpeicher } from '../../oberflaeche/laufzeit.ts';
import { SPRACHEN } from '../../oberflaeche/sprachen.ts';
import { Ausnahmen } from './Ausnahmen.tsx';
import { Konto } from './Konto.tsx';
import { SprachListen } from './SprachListen.tsx';
import { Ueber } from './Ueber.tsx';

const THEMEN: Thema[] = ['system', 'hell', 'dunkel'];
const THEMA_TEXT: Record<Thema, string> = { system: 'optionen.einstellungen.themaSystem', hell: 'optionen.einstellungen.themaHell', dunkel: 'optionen.einstellungen.themaDunkel' };

export function Einstellungen({ zustand, neuLaden }: { zustand: Zustand; neuLaden: () => Promise<void> }) {
  const [e, setE] = useState<EinstellungenForm | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let lebt = true;
    leseSpeicher('einstellungen').then((s) => lebt && setE(s.einstellungen)).catch(() => lebt && setFehler(fehlerText('HINTERGRUND_FEHLT')));
    const ab = beiSpeicherAenderung((a) => {
      if (a.einstellungen) setE(a.einstellungen);
    });
    return () => {
      lebt = false;
      ab();
    };
  }, []);

  async function aendere(teil: Partial<EinstellungenForm>) {
    setFehler(null);
    setE((alt) => (alt ? { ...alt, ...teil } : alt));
    try {
      const { einstellungen } = await leseSpeicher('einstellungen');
      await schreibeSpeicher({ einstellungen: { ...einstellungen, ...teil } });
    } catch {
      setFehler(fehlerText('HINTERGRUND_FEHLT'));
    }
  }

  const sprachen = SPRACHEN.filter((s) => verfuegbareSprachen.includes(s.code));

  return (
    <section className="bereich" aria-labelledby="einstellungen-titel">
      <div className="bereich__kopf">
        <h2 id="einstellungen-titel">{t('optionen.einstellungen.titel')}</h2>
      </div>
      {fehler ? <Hinweis art="fehler">{fehler}</Hinweis> : null}
      {/*
        EINE Karte im Bau der Filterlisten (`liste` + `liste__zeile`), nicht
        zwei nackte Felder ueber einer Karte mit Schaltern.

        Vorher standen Sprache und Erscheinungsbild als `Auswahl` mit Label
        DARUEBER frei auf dem Grau, darunter erst begann die weisse Karte. Das
        waren zwei Bauweisen auf einem Bildschirm, und der Blick las sie als
        zwei Sachen, die nichts miteinander zu tun haben. Jetzt ist jede
        Einstellung dasselbe: Name links, Erklaerung darunter, Bedienelement
        rechts - egal ob dahinter ein Schalter, eine Auswahl oder ein
        Aufklapper sitzt. Genau der Bau, den der Reiter „Filterlisten" schon
        hat; die beiden Reiter sehen deshalb wie ein Programm aus.

        `htmlFor` und nicht `aria-labelledby`: Ein `<label>` am Namen macht
        den Namen zur Klickflaeche der Auswahl - dieselbe Zeile, dieselbe
        Wirkung wie beim Schalter daneben.
      */}
      <div className="liste">
        <div className="liste__zeile">
          <div className="wachsend">
            <label className="liste__name" htmlFor="sprache">
              {t('optionen.einstellungen.sprache')}
            </label>
          </div>
          <select
            id="sprache"
            className="feld__eingabe zeilenwahl"
            value={e?.sprache ?? ''}
            disabled={!e}
            onChange={(ev) => void aendere({ sprache: ev.target.value || null })}
          >
            <option value="">{t('optionen.einstellungen.spracheSystem')}</option>
            {sprachen.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="liste__zeile">
          <div className="wachsend">
            <label className="liste__name" htmlFor="thema">
              {t('optionen.einstellungen.thema')}
            </label>
          </div>
          <select
            id="thema"
            className="feld__eingabe zeilenwahl"
            value={e?.thema ?? 'system'}
            disabled={!e}
            onChange={(ev) => void aendere({ thema: ev.target.value as Thema })}
          >
            {THEMEN.map((th) => (
              <option key={th} value={th}>
                {t(THEMA_TEXT[th])}
              </option>
            ))}
          </select>
        </div>
        {/*
          Hier stand bis zum 07.09.2026 der globale Schalter „AdSilence aktiv".
          Er ist weg: Wer die Erweiterung ganz abschalten will, schaltet sie in
          `chrome://extensions` ab; wer sie auf EINER Seite nicht will, nimmt
          den Schalter im Popup. Ein dritter Weg dazwischen war eine seltene
          Entscheidung mit einer teuren Folge - „AdSilence blockt nicht mehr",
          drei Klicks tief, ohne Hinweis an irgendeiner anderen Stelle.

          `Einstellungen.aktiv` BLEIBT im Datenmodell und wird weiter ueberall
          gelesen (`kosmetikFuer`, `aktiveListenIds`, das Popup). Nur setzt es
          niemand mehr auf false. Wer es beim Update auf false stehen hatte,
          bekommt es in `migriereSpeicher()` auf true zurueck - sonst waere er
          dauerhaft ungeschuetzt, ohne einen Schalter, der ihn zurueckholt.
        */}
        <div className="liste__zeile">
          <div className="wachsend">
            <div className="liste__name" id="badge-name">
              {t('optionen.einstellungen.badge')}
            </div>
            <div className="liste__nebentext">{t('optionen.einstellungen.badgeText')}</div>
          </div>
          <Schalter
            id="badge"
            an={e?.zaehlerBadge ?? true}
            disabled={!e}
            onWechsel={(an) => void aendere({ zaehlerBadge: an })}
            aria-labelledby="badge-name"
          />
        </div>
        {/*
          „Sprachlisten je Land" — eine Zeile, die sich oeffnet. Die
          Begruendung steht in `SprachListen.tsx`.
        */}
        <SprachListen listen={zustand.listen} />
        {/*
          Vier Aufklappzeilen, gleicher Bau, in der Reihenfolge, in der man
          sie braucht: das eigene Umfeld, wo nichts geblockt werden soll, wem
          das Ganze gehoert, und zuletzt die Auskunft, die man einmal liest.

          Alle vier waren einmal eigene Reiter oder eigene Abschnitte mit
          Ueberschrift. Zusammen sind sie eine Karte: Wer hier ist, hat EINE
          Frage - „wie haette ich es gern?" - und bekommt EINE Liste.
        */}
        <Ausnahmen />
        <Konto zustand={zustand} neuLaden={neuLaden} />
        <Ueber zustand={zustand} />
      </div>
    </section>
  );
}
