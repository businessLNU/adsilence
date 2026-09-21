/**
 * Ausnahmen: die Hosts, auf denen AdSilence nichts tut. Kommen aus
 * `storage.local.sites` (nicht aus dem Zustand des Hintergrunds, der kennt
 * nur den aktuellen Tab). Hinzufuegen und Entfernen laufen ueber
 * `site.setzen`, dieselbe Nachricht wie der Schalter im Popup.
 *
 * ── Eine ZEILE in der Einstellungskarte ────────────────────────────────────
 * Bis zum 07.09.2026 ein eigener Reiter, danach kurz ein eigener Abschnitt,
 * jetzt eine Aufklappzeile wie „Sprachlisten je Land" und „Info". Die ANZAHL
 * steht in der zugeklappten Zeile: „Habe ich hier ueberhaupt etwas
 * eingetragen?" ist die Frage, mit der man herkommt - haette man die Antwort
 * erst nach dem Klick, waere der Klick reine Arbeit.
 *
 * Der Anker `#ausnahmen` landet weiter hier und klappt die Zeile OFFEN auf.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { normalisiereHost } from '../../gemeinsam/host.ts';
import type { Sites } from '../../gemeinsam/typen.ts';
import { Hinweis, fehlerText } from '../../oberflaeche/Hinweis.tsx';
import { Knopf } from '../../oberflaeche/Knopf.tsx';
import { Kreuz } from '../../oberflaeche/Symbole.tsx';
import { formatiereDatum, t } from '../../oberflaeche/i18n.ts';
import { beiSpeicherAenderung, leseSpeicher, NachrichtFehler, sende } from '../../oberflaeche/laufzeit.ts';

export function Ausnahmen() {
  const [sites, setSites] = useState<Sites | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [feldFehler, setFeldFehler] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wartend, setWartend] = useState<string | null>(null);
  const [offen, setOffen] = useState(() => location.hash.replace(/^#/, '') === 'ausnahmen');

  useEffect(() => {
    let lebt = true;
    leseSpeicher('sites').then((s) => lebt && setSites(s.sites)).catch(() => lebt && setSites({}));
    const ab = beiSpeicherAenderung((a) => {
      if (a.sites !== undefined) setSites(a.sites ?? {});
    });
    return () => {
      lebt = false;
      ab();
    };
  }, []);

  async function setze(host: string, erlaubt: boolean) {
    setFehler(null);
    setWartend(host);
    try {
      await sende({ typ: 'site.setzen', host, erlaubt });
    } catch (e) {
      setFehler(fehlerText(e instanceof NachrichtFehler ? e.code : undefined));
    } finally {
      setWartend(null);
    }
  }

  async function hinzufuegen(e: FormEvent) {
    e.preventDefault();
    const host = normalisiereHost(eingabe);
    if (!host) {
      setFeldFehler(t('optionen.ausnahmen.ungueltig'));
      return;
    }
    if (sites?.[host]?.erlaubt) {
      setFeldFehler(t('optionen.ausnahmen.schonDa'));
      return;
    }
    setFeldFehler(null);
    await setze(host, true);
    setEingabe('');
  }

  const eintraege = Object.entries(sites ?? {})
    .filter(([, s]) => s.erlaubt)
    .sort((a, b) => b[1].seit - a[1].seit);

  const stand =
    eintraege.length === 0
      ? t('optionen.ausnahmen.standKeine')
      : eintraege.length === 1
        ? t('optionen.ausnahmen.standEine')
        : t('optionen.ausnahmen.stand', { anzahl: String(eintraege.length) });

  return (
    <>
      <button
        type="button"
        className="aufklapper"
        aria-expanded={offen}
        aria-controls="ausnahmen-inhalt"
        onClick={() => setOffen((o) => !o)}
      >
        <span className="wachsend">
          <span className="aufklapper__titel" id="ausnahmen-titel">
            {t('optionen.ausnahmen.titel')}
          </span>
          <span className="aufklapper__stand">{stand}</span>
        </span>
        <span className="aufklapper__pfeil" aria-hidden="true" />
      </button>

      {offen ? (
        <div id="ausnahmen-inhalt" className="aufklapper__inhalt">
          <p className="klein schwach">{t('optionen.ausnahmen.text')}</p>
          {fehler ? <Hinweis art="fehler">{fehler}</Hinweis> : null}
          {/*
            Nur Feld und Knopf, kein Label und kein Hinweis darunter.

            Da stand „Seite" / „Nur der Host, zum Beispiel beispiel.de". Beides
            ist weg, und der Hinweis war der schlechtere von beiden: Er
            verbot etwas, das `normalisiereHost()` seit jeher annimmt.
            GEMESSEN: `www.beispiel.de`, `https://beispiel.de`,
            `http://www.beispiel.de/pfad?x=1#y` und
            `HTTPS://WWW.Beispiel.DE:8443/` ergeben alle `beispiel.de`. Der
            Satz hat also Leute davon abgehalten, etwas einzugeben, das
            funktioniert haette - dieselbe Sorte Fehler wie ein Formularfeld,
            das seinen Wert verwirft, nur umgekehrt.

            Der PLATZHALTER sagt jetzt dasselbe richtig herum: Er zeigt beide
            Formen nebeneinander, statt eine zu verbieten. Er ist kein Ersatz
            fuer den Namen des Feldes - ein Platzhalter verschwindet beim
            Tippen; der Name steckt deshalb im `aria-label`.

            Der Fehler steht UNTER der Zeile und nicht in ihr: In der Zeile
            saesse er neben einem Feld, das schon die volle Breite hat, und
            druengte den Knopf um.
          */}
          <form className="liste__zeile liste__zeile--eingabe" onSubmit={(e) => void hinzufuegen(e)}>
            <input
              id="ausnahme-host"
              className="feld__eingabe wachsend"
              aria-label={t('optionen.ausnahmen.host')}
              placeholder={t('optionen.ausnahmen.hostPlatzhalter')}
              aria-describedby={feldFehler ? 'ausnahme-host-fehler' : undefined}
              aria-invalid={feldFehler ? true : undefined}
              value={eingabe}
              onChange={(e) => {
                setEingabe(e.target.value);
                if (feldFehler) setFeldFehler(null);
              }}
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              dir="ltr"
            />
            <Knopf art="primaer" klein type="submit" beschaeftigt={wartend !== null}>
              {t('gemeinsam.hinzufuegen')}
            </Knopf>
          </form>
          {feldFehler ? (
            <div className="feld__fehler" id="ausnahme-host-fehler" role="alert">
              {feldFehler}
            </div>
          ) : null}
          {eintraege.length > 0 ? (
            <div className="liste stagger">
              {eintraege.map(([host, s], i) => (
                <div key={host} className="liste__zeile" style={{ '--i': i } as React.CSSProperties}>
                  <div className="wachsend">
                    <div className="liste__name mono" dir="ltr">
                      {host}
                    </div>
                    <div className="liste__nebentext">{t('optionen.ausnahmen.seit', { datum: formatiereDatum(s.seit) })}</div>
                  </div>
                  <Knopf art="leise" klein aria-label={t('optionen.ausnahmen.entfernenVon', { host })} beschaeftigt={wartend === host} onClick={() => void setze(host, false)}>
                    <Kreuz groesse={16} />
                    {t('gemeinsam.entfernen')}
                  </Knopf>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
