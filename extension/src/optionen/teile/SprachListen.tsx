/**
 * „Sprachlisten je Land": eine Zeile, die sich auf Klick öffnet.
 *
 * ── Warum zugeklappt ──────────────────────────────────────────────────────
 * Achtzehn Sprachen sind eine Wand. Wer die Einstellungen öffnet, will
 * meistens etwas anderes — und muss dann an achtzehn Zeilen vorbeiscrollen,
 * die ihn nichts angehen. Zugeklappt ist die Rubrik eine Zeile wie jede
 * andere; wer sie braucht, klickt sie auf.
 *
 * Deshalb erscheint auch das Suchfeld erst DANACH: Ein Suchfeld über einer
 * unsichtbaren Liste ist eine Frage ohne erkennbaren Gegenstand.
 *
 * ── Warum hier und nicht bei den Filterlisten ─────────────────────────────
 * Sie stand dort bis zum 05.09.2026. Eine Sprachliste ist aber keine
 * Entscheidung über das Blocken, sondern eine über das eigene Umfeld — sie
 * gehört zu „wo ich bin", nicht zu „was geblockt wird".
 *
 * ── Warum `<button>` und nicht `<details>` ────────────────────────────────
 * `<details>` bringt sein eigenes Dreieck und seine eigene Typografie mit,
 * und beides folgt hier nicht dem Rest der Seite. Ein Knopf mit
 * `aria-expanded` und `aria-controls` sagt einer Vorleseanwendung dasselbe.
 */
import { useState } from 'react';
import type { ListenEintrag } from '../../gemeinsam/typen.ts';
import { Hinweis, fehlerText } from '../../oberflaeche/Hinweis.tsx';
import { Schalter } from '../../oberflaeche/Schalter.tsx';
import { t } from '../../oberflaeche/i18n.ts';
import { spracheName } from '../../oberflaeche/sprachen.ts';
import { NachrichtFehler, sende } from '../../oberflaeche/laufzeit.ts';

/** Fünf sichtbar, der Rest auf Wunsch — siehe unten, warum. */
const ZEIGE = 5;

export function SprachListen({ listen }: { listen: ListenEintrag[] }) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [alleZeigen, setAlleZeigen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wartend, setWartend] = useState<string | null>(null);
  // Optimistisch: der Schalter springt sofort; der Zustand aus dem Speicher
  // ueberholt ihn gleich darauf und bestaetigt oder korrigiert.
  const [lokal, setLokal] = useState<Record<string, boolean>>({});

  const regional = listen.filter((l) => l.sprache);
  const anzahlAn = regional.filter((l) => lokal[l.id] ?? l.aktiv).length;

  async function schalte(l: ListenEintrag, an: boolean) {
    setFehler(null);
    setWartend(l.id);
    setLokal((a) => ({ ...a, [l.id]: an }));
    try {
      await sende({ typ: 'liste.setzen', id: l.id, aktiv: an });
    } catch (e) {
      setLokal((a) => ({ ...a, [l.id]: !an }));
      setFehler(fehlerText(e instanceof NachrichtFehler ? e.code : undefined));
    } finally {
      setWartend(null);
    }
  }

  /*
   * Die Suche vergleicht den ANGEZEIGTEN Namen und die Quelle darunter: Wer
   * „Deutsch" tippt, meint die Zeile, auf der „Deutsch" steht — dass sie
   * intern `regional-de` heisst, weiss er nicht.
   */
  const gesucht = suche.trim().toLowerCase();
  const gefiltert = gesucht
    ? regional.filter(
        (l) =>
          spracheName(l.sprache ?? '').toLowerCase().includes(gesucht) ||
          l.name.toLowerCase().includes(gesucht),
      )
    : regional;
  // Wer sucht, sieht alle Treffer — dann ist die Liste ja schon kurz.
  const gekuerzt = !gesucht && !alleZeigen && gefiltert.length > ZEIGE;
  const sichtbar = gekuerzt ? gefiltert.slice(0, ZEIGE) : gefiltert;

  if (regional.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="aufklapper"
        aria-expanded={offen}
        aria-controls="sprachlisten"
        onClick={() => setOffen((o) => !o)}
      >
        <span className="wachsend">
          <span className="aufklapper__titel">{t('optionen.listen.regionalTitel')}</span>
          {/*
            Die Zahl der eingeschalteten Sprachen steht in der zugeklappten
            Zeile: Sonst muss man aufklappen, um zu sehen, ob ueberhaupt eine
            an ist — und genau das ist die Frage, mit der man herkommt.
          */}
          <span className="aufklapper__stand">
            {t('optionen.listen.regionalStand', { anzahl: String(anzahlAn) })}
          </span>
        </span>
        <span className="aufklapper__pfeil" aria-hidden="true" />
      </button>

      {offen ? (
        <div id="sprachlisten" className="aufklapper__inhalt">
          <p className="klein schwach">{t('optionen.listen.regionalText')}</p>
          <input
            type="search"
            className="feld__eingabe suchfeld suchfeld--breit"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={t('optionen.listen.suche')}
            aria-label={t('optionen.listen.suche')}
          />
          {fehler ? <Hinweis art="fehler">{fehler}</Hinweis> : null}
          <div className="liste">
            {sichtbar.length === 0 ? (
              <div className="liste__leer">{t('optionen.listen.keinTreffer')}</div>
            ) : null}
            {sichtbar.map((l) => {
              const an = lokal[l.id] ?? l.aktiv;
              const id = `liste-${l.id}`;
              return (
                <div key={l.id} className="liste__zeile">
                  <div className="wachsend">
                    <div className="liste__name" id={`${id}-name`} lang={l.sprache}>
                      {spracheName(l.sprache ?? '')}
                    </div>
                  </div>
                  <Schalter
                    id={id}
                    an={an}
                    disabled={wartend === l.id}
                    onWechsel={(neu) => void schalte(l, neu)}
                    aria-labelledby={`${id}-name`}
                  />
                </div>
              );
            })}
          </div>
          {gekuerzt ? (
            <button
              type="button"
              className="knopf knopf--leise knopf--breit"
              onClick={() => setAlleZeigen(true)}
            >
              {t('optionen.listen.mehr', { anzahl: String(gefiltert.length - ZEIGE) })}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
