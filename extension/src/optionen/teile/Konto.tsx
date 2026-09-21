/**
 * Konto: drei Lagen.
 *  - nicht verbunden, kein Code: Erklaerung und „Mit Konto verbinden".
 *  - Code offen: der Code gross, „Website oeffnen", „Wartet auf Freigabe",
 *    „Neuen Code anfordern". Der Hintergrund holt im Takt ab; sobald er
 *    fertig ist, aendert sich `konto` im Speicher und diese Seite springt
 *    von selbst in die dritte Lage.
 *  - verbunden: E-Mail, Name, Tarif, gueltig bis; „Jetzt pruefen";
 *    Premium: „Premium verwalten" und der Abgleich; sonst `PremiumWahl`;
 *    zuletzt „Trennen".
 *
 * ── Eine ZEILE in der Einstellungskarte ────────────────────────────────────
 * Alle drei Lagen stecken seit dem 07.09.2026 hinter einer Aufklappzeile, wie
 * „Ausnahmen" und „Info" daneben. In der ZUGEKLAPPTEN Zeile steht, was man
 * wissen will, ohne zu klicken: „Nicht verbunden", sonst die E-Mail. Der
 * Zustand ist die Auskunft - der Knopf darunter ist die Handlung, und die
 * braucht man erst, wenn man sie will.
 *
 * Der Anker `#konto` (aus `oeffneOptionen('konto')` und aus Lesezeichen)
 * klappt die Zeile OFFEN auf. Eine zugeklappte Zeile am Ziel eines Sprungs
 * waere derselbe Fehler wie gar kein Sprung.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Abgleich, Zustand } from '../../gemeinsam/typen.ts';
import { Hinweis, fehlerText } from '../../oberflaeche/Hinweis.tsx';
import { Knopf } from '../../oberflaeche/Knopf.tsx';
import { PremiumWahl } from '../../oberflaeche/PremiumWahl.tsx';
import { Extern } from '../../oberflaeche/Symbole.tsx';
import { formatiereDatum, t } from '../../oberflaeche/i18n.ts';
import { beiSpeicherAenderung, leseSpeicher, NachrichtFehler, oeffneTab, sende, UMGEBUNG } from '../../oberflaeche/laufzeit.ts';

export function Konto({ zustand, neuLaden }: { zustand: Zustand; neuLaden: () => Promise<void> }) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [abgleich, setAbgleich] = useState<Abgleich | null>(null);
  const [offen, setOffen] = useState(() => location.hash.replace(/^#/, '') === 'konto');
  const { konto, lizenz, verbindung } = zustand;

  useEffect(() => {
    let lebt = true;
    leseSpeicher('abgleich').then((s) => lebt && setAbgleich(s.abgleich)).catch(() => {});
    const ab = beiSpeicherAenderung((a) => {
      if (a.abgleich) setAbgleich(a.abgleich);
    });
    return () => {
      lebt = false;
      ab();
    };
  }, []);

  async function tu(name: string, arbeit: () => Promise<unknown>) {
    setFehler(null);
    setLaeuft(name);
    try {
      await arbeit();
      await neuLaden();
    } catch (e) {
      setFehler(fehlerText(e instanceof NachrichtFehler ? e.code : undefined));
    } finally {
      setLaeuft(null);
    }
  }

  /*
    Die Zeile selbst: Titel, darunter der Zustand. Kein erklaerender Satz -
    „Verbinde die Erweiterung mit deinem Konto auf der Website, damit sie
    deinen Tarif kennt" stand einmal direkt ueber einem Knopf, auf dem „Mit
    Konto verbinden" steht: derselbe Inhalt, nur laenger. Was danach
    passiert, erklaert die Karte mit dem Code, und die kommt ohnehin.
  */
  function zeile(inhalt: ReactNode) {
    return (
      <>
        <button
          type="button"
          className="aufklapper"
          aria-expanded={offen}
          aria-controls="konto-inhalt"
          onClick={() => setOffen((o) => !o)}
        >
          <span className="wachsend">
            <span className="aufklapper__titel" id="konto-titel">
              {t('optionen.konto.titel')}
            </span>
            <span className="aufklapper__stand">
              {konto.verbunden ? konto.email : t('optionen.konto.nichtVerbunden')}
            </span>
          </span>
          <span className="aufklapper__pfeil" aria-hidden="true" />
        </button>
        {offen ? (
          <div id="konto-inhalt" className="aufklapper__inhalt">
            {inhalt}
          </div>
        ) : null}
      </>
    );
  }

  if (!konto.verbunden) {
    return zeile(
      <>
        {konto.hinweis === 'gesperrt' ? <Hinweis art="warn">{t('gemeinsam.gesperrt')}</Hinweis> : null}
        {konto.hinweis === 'neuVerbinden' ? <Hinweis art="warn">{t('gemeinsam.neuVerbinden')}</Hinweis> : null}
        {zustand.verbindungFehler ? <Hinweis art="fehler">{fehlerText(zustand.verbindungFehler)}</Hinweis> : null}
        {fehler ? <Hinweis art="fehler">{fehler}</Hinweis> : null}
        {/*
          KEINE `Karte` mehr um diese Bloecke. Sie stehen jetzt im
          aufgeklappten Teil einer Zeile, und die steckt schon in der weissen
          Karte des Abschnitts - eine zweite darin waere Weiss auf Weiss mit
          zwei Schatten dazwischen.
        */}
        {verbindung ? (
          <div className="stapel" style={{ maxWidth: 440 }}>
            <div className="klein schwach">{t('optionen.konto.code')}</div>
            <div className="code" aria-live="polite">
              {verbindung.code}
            </div>
            <p className="klein schwach">{t('optionen.konto.codeText')}</p>
            <Hinweis art="neutral">{t('optionen.konto.wartet')}</Hinweis>
            <div className="reihe">
              <Knopf art="primaer" className="wachsend" onClick={() => void oeffneTab(verbindung.verbindenUrl)}>
                <Extern groesse={16} />
                {t('optionen.konto.websiteOeffnen')}
              </Knopf>
              <Knopf art="leise" beschaeftigt={laeuft === 'code'} onClick={() => void tu('code', () => sende({ typ: 'konto.verbinden' }))}>
                {t('optionen.konto.neuerCode')}
              </Knopf>
            </div>
          </div>
        ) : (
          <div className="reihe" style={{ justifyContent: 'flex-start' }}>
            <Knopf art="primaer" beschaeftigt={laeuft === 'code'} onClick={() => void tu('code', () => sende({ typ: 'konto.verbinden' }))}>
              {t('gemeinsam.kontoVerbinden')}
            </Knopf>
          </div>
        )}
      </>,
    );
  }

  const bis = formatiereDatum(lizenz.gueltigBis);
  return zeile(
    <>
      {konto.hinweis === 'gesperrt' ? <Hinweis art="warn">{t('gemeinsam.gesperrt')}</Hinweis> : null}
      {lizenz.hinweis === 'zahlungOffen' ? <Hinweis art="warn">{t('gemeinsam.zahlungOffen')}</Hinweis> : null}
      {lizenz.hinweis === 'angehalten' ? <Hinweis art="warn">{t('gemeinsam.angehalten')}</Hinweis> : null}
      {fehler ? <Hinweis art="fehler">{fehler}</Hinweis> : null}
      <div className="zwei-spalten">
        <div className="stapel">
          <dl className="paare">
            <dt>{t('optionen.konto.email')}</dt>
            <dd>{konto.email}</dd>
            {konto.name ? (
              <>
                <dt>{t('optionen.konto.name')}</dt>
                <dd>{konto.name}</dd>
              </>
            ) : null}
            <dt>{t('optionen.konto.tarif')}</dt>
            <dd>{lizenz.premium ? t('gemeinsam.premium') : t('gemeinsam.frei')}</dd>
            {lizenz.premium && bis ? (
              <>
                <dt>{t('optionen.konto.gueltigBis')}</dt>
                <dd className="zahl">{bis}</dd>
              </>
            ) : null}
          </dl>
          {/*
            Hier standen „Jetzt pruefen" und „Zuletzt geprueft <Datum>".
            Auf Ansage vom 08.09.2026 raus.

            Beides beantwortete eine Frage, die niemand stellt: Die Lizenz
            prueft sich alle sechs Stunden von selbst (`LIZENZ_TAKT_MIN`), und
            was oben in der Karte steht -- Tarif und Laufzeit -- ist das, was
            zaehlt. Ein Zeitstempel daneben laedt nur dazu ein, ihm zu
            misstrauen.

            Der Weg bleibt: `sende({ typ: 'lizenz.pruefen' })` gibt es
            weiterhin, und das Verbinden loest ihn ohnehin aus.
          */}
          {lizenz.premium ? (
            <Knopf art="primaer" onClick={() => void oeffneTab(`${UMGEBUNG.apiBasis}/konto`)}>
              {t('gemeinsam.premiumVerwalten')}
            </Knopf>
          ) : (
            <PremiumWahl onFehler={(code) => setFehler(fehlerText(code))} />
          )}
        </div>
        <div className="stapel">
          <h3>{t('optionen.konto.abgleich')}</h3>
          <p className="klein schwach">{t('optionen.konto.abgleichText')}</p>
          <div className="reihe" style={{ flexWrap: 'wrap' }}>
            <Knopf art="sekundaer" klein disabled={!lizenz.premium} beschaeftigt={laeuft === 'abgleich'} onClick={() => void tu('abgleich', () => sende({ typ: 'abgleich.jetzt' }))}>
              {t('optionen.konto.abgleichJetzt')}
            </Knopf>
            {abgleich?.aktualisiertAm ? <span className="klein schwach zahl">{t('optionen.konto.abgeglichen', { datum: formatiereDatum(abgleich.aktualisiertAm, 'datumZeit') })}</span> : null}
          </div>
        </div>
      </div>
      <div className="stapel" style={{ gap: 8 }}>
        <div>
          <Knopf art="gefahr" beschaeftigt={laeuft === 'trennen'} onClick={() => void tu('trennen', () => sende({ typ: 'konto.trennen' }))}>
            {t('gemeinsam.trennen')}
          </Knopf>
        </div>
      </div>
    </>,
  );
}
