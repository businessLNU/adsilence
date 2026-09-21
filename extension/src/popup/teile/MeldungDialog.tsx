/**
 * „Seite kaputt melden": erst die VORSCHAU dessen, was gesendet wird (Seite
 * ohne Query, Browser, Version, aktive Listen, passende Regeln), dann ein
 * freiwilliges Kommentarfeld, dann „Senden". Nichts geht raus, bevor der
 * Knopf gedrueckt ist; nichts geht raus, was nicht in der Vorschau stand.
 */
import { useEffect, useState } from 'react';
import type { MeldungVorschau } from '../../gemeinsam/typen.ts';
import { MELDUNG_MAX_KOMMENTAR } from '../../gemeinsam/konstanten.ts';
import { Dialog } from '../../oberflaeche/Dialog.tsx';
import { Textfeld } from '../../oberflaeche/Feld.tsx';
import { fehlerText, Hinweis } from '../../oberflaeche/Hinweis.tsx';
import { Knopf } from '../../oberflaeche/Knopf.tsx';
import { Skeleton } from '../../oberflaeche/Skeleton.tsx';
import { hatText, t } from '../../oberflaeche/i18n.ts';
import { NachrichtFehler, sende } from '../../oberflaeche/laufzeit.ts';

type Lage = { art: 'laedt' } | { art: 'vorschau'; daten: MeldungVorschau } | { art: 'fehler'; code: string } | { art: 'gesendet' };

export function MeldungDialog({ offen, tabId, onSchliessen }: { offen: boolean; tabId: number | undefined; onSchliessen: () => void }) {
  const [lage, setLage] = useState<Lage>({ art: 'laedt' });
  const [kommentar, setKommentar] = useState('');
  const [sendet, setSendet] = useState(false);
  const [sendeFehler, setSendeFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!offen) return;
    let lebt = true;
    setLage({ art: 'laedt' });
    setKommentar('');
    setSendeFehler(null);
    if (tabId === undefined) {
      setLage({ art: 'fehler', code: 'KEINE_SEITE' });
      return;
    }
    sende({ typ: 'meldung.vorschau', tabId })
      .then((daten) => lebt && setLage({ art: 'vorschau', daten }))
      .catch((e) => lebt && setLage({ art: 'fehler', code: e instanceof NachrichtFehler ? e.code : 'HINTERGRUND_FEHLT' }));
    return () => {
      lebt = false;
    };
  }, [offen, tabId]);

  async function senden() {
    if (lage.art !== 'vorschau') return;
    setSendet(true);
    setSendeFehler(null);
    try {
      // Nur die fuenf Felder der Vorschau, nichts, was nicht auf dem
      // Bildschirm stand (auch nicht das `ok` der Antwort).
      const { seite, browser, version, listen, regeln } = lage.daten;
      await sende({ typ: 'meldung.senden', seite, browser, version, listen, regeln, ...(kommentar.trim() ? { kommentar: kommentar.trim() } : {}) });
      setLage({ art: 'gesendet' });
    } catch (e) {
      setSendeFehler(e instanceof NachrichtFehler && e.code !== 'HINTERGRUND_FEHLT' ? t('popup.meldung.fehler') : fehlerText(e instanceof NachrichtFehler ? e.code : undefined));
    } finally {
      setSendet(false);
    }
  }

  const fuss =
    lage.art === 'gesendet' ? (
      <Knopf art="primaer" onClick={onSchliessen}>
        {t('gemeinsam.schliessen')}
      </Knopf>
    ) : (
      <>
        <Knopf art="leise" onClick={onSchliessen}>
          {t('gemeinsam.abbrechen')}
        </Knopf>
        <Knopf art="primaer" disabled={lage.art !== 'vorschau'} beschaeftigt={sendet} onClick={() => void senden()}>
          {t('popup.meldung.senden')}
        </Knopf>
      </>
    );

  return (
    <Dialog offen={offen} onSchliessen={onSchliessen} titel={t('popup.meldung.titel')} schliessenText={t('gemeinsam.schliessen')} fuss={fuss}>
      {lage.art === 'gesendet' ? (
        <Hinweis art="gut">{t('popup.meldung.gesendet')}</Hinweis>
      ) : lage.art === 'fehler' ? (
        <Hinweis art="fehler">{lage.code === 'KEINE_SEITE' ? t('popup.meldung.keineSeite') : fehlerText(lage.code)}</Hinweis>
      ) : (
        <>
          <p className="klein schwach">{t('popup.meldung.text')}</p>
          {lage.art === 'laedt' ? (
            <div className="stapel" aria-busy="true">
              <Skeleton hoehe={14} breite="80%" />
              <Skeleton hoehe={14} breite="40%" />
              <Skeleton hoehe={14} breite="55%" />
              <Skeleton hoehe={14} breite="65%" />
            </div>
          ) : (
            <dl className="paare">
              <dt>{t('popup.meldung.seite')}</dt>
              <dd className="mono">{lage.daten.seite}</dd>
              <dt>{t('popup.meldung.browser')}</dt>
              <dd>{lage.daten.browser}</dd>
              <dt>{t('popup.meldung.version')}</dt>
              <dd className="zahl">{lage.daten.version}</dd>
              {/*
                Bereiche, keine Listennamen. Was in `daten.listen` steht, sind
                seit dem 10.09.2026 Schluessel wie `werbung` — die rohen
                Kennungen (`ublock`, `urlhaus`) waren Namen fremder Projekte in
                unserem Fenster. Uebersetzt wird erst hier; ueber die Leitung
                geht der Schluessel, damit die Meldung in unserer Sprache
                lesbar bleibt, egal in welcher sie geschrieben wurde.

                Ein unbekannter Schluessel faellt weg statt roh dazustehen:
                `t()` gaebe ihn selbst zurueck, und dann stuende in der Meldung
                `popup.meldung.bereich.irgendwas`. Dafuer gibt es `hatText`.
              */}
              <dt>{t('popup.meldung.listen')}</dt>
              <dd>
                {lage.daten.listen
                  .filter((b) => hatText(`popup.meldung.bereich.${b}`))
                  .map((b) => t(`popup.meldung.bereich.${b}`))
                  .join(', ')}
              </dd>
              <dt>{t('popup.meldung.regeln')}</dt>
              <dd>
                <div className="klein schwach">{t('popup.meldung.regelnAnzahl', { anzahl: lage.daten.regeln.length })}</div>
                {lage.daten.regeln.length > 0 ? (
                  <ul className="mono klein" style={{ margin: '4px 0 0', paddingInlineStart: 16 }}>
                    {lage.daten.regeln.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </dd>
            </dl>
          )}
          <Textfeld
            id="meldung-kommentar"
            label={t('popup.meldung.kommentar')}
            hinweis={t('popup.meldung.kommentarHinweis')}
            fehler={sendeFehler}
            value={kommentar}
            maxLength={MELDUNG_MAX_KOMMENTAR}
            rows={3}
            style={{ minHeight: 72, fontFamily: 'inherit' }}
            onChange={(e) => setKommentar(e.target.value)}
            disabled={lage.art !== 'vorschau'}
          />
        </>
      )}
    </Dialog>
  );
}
