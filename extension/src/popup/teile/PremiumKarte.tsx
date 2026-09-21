/**
 * Die Premium-Karte in drei Lagen:
 *  - kein Konto: der Nutzen in einem Satz, Knopf „Mit Konto verbinden"
 *    (kein Kauf ohne Konto: das waere ein stiller Gastkauf).
 *  - Konto, frei: derselbe Satz, dahinter `PremiumWahl`.
 *  - Konto, Premium: „Premium bis …", Hinweise (Zahlung offen, angehalten,
 *    endet), Knopf „Premium verwalten" zur Kontoseite der Website.
 * Ein Knopftext je Absicht: „Premium verwalten" heisst hier und in den
 * Optionen gleich, „Trennen" ebenso (`gemeinsam.trennen`).
 *
 * ── Warum „Trennen" hier steht und nicht nur in den Optionen ───────────────
 * Ein Abmelden auf der WEBSITE trennt die Erweiterung nicht. Sie haelt einen
 * eigenen Refresh-Token in `storage.local`; die Sitzung im Browser und die
 * der Erweiterung sind zwei Dinge. Wer sich auf der Seite abmeldet und
 * erwartet, dass das Popup danach frei ist, wartet vergeblich. Der Weg dorthin
 * fuehrte bis heute nur ueber die Optionsseite - zwei Klicks weit weg von der
 * Stelle, an der die Kontozeile steht.
 */
import type { Zustand } from '../../gemeinsam/typen.ts';
import { Hinweis } from '../../oberflaeche/Hinweis.tsx';
import { Karte } from '../../oberflaeche/Karte.tsx';
import { Knopf } from '../../oberflaeche/Knopf.tsx';
import { PremiumWahl } from '../../oberflaeche/PremiumWahl.tsx';
import { t } from '../../oberflaeche/i18n.ts';

/**
 * Die Zeile „verbunden als …" mit dem Trennen-Knopf daneben. Der Knopf ist
 * `leise` und `klein`: Er steht immer da, soll aber nichts von der
 * Premium-Aussage wegnehmen. Ohne E-Mail gibt es die ganze Zeile nicht - dann
 * ist auch kein Konto verbunden, das man trennen koennte.
 */
function KontoZeile({ email, onTrennen, beschaeftigt }: { email?: string; onTrennen: () => void; beschaeftigt: boolean }) {
  if (!email) return null;
  return (
    <div className="kontozeile">
      <span className="klein schwach abschneiden">{t('popup.premium.verbundenAls', { email })}</span>
      <Knopf art="leise" klein beschaeftigt={beschaeftigt} onClick={onTrennen}>
        {t('gemeinsam.trennen')}
      </Knopf>
    </div>
  );
}

export function PremiumKarte({ zustand, onVerbinden, onTrennen, onFehler, beschaeftigt }: { zustand: Zustand; onVerbinden: () => void; onTrennen: () => void; onFehler: (code: string) => void; beschaeftigt: boolean }) {
  const { konto, lizenz, verbindung } = zustand;

  if (konto.hinweis === 'gesperrt') {
    return (
      <Karte className="stapel">
        <Hinweis art="warn">{t('gemeinsam.gesperrt')}</Hinweis>
      </Karte>
    );
  }

  if (!konto.verbunden) {
    return (
      <Karte className="stapel">
        <div className="premium__titel">{t('gemeinsam.premium')}</div>
        <p className="klein schwach">{t('popup.premium.text')}</p>
        {konto.hinweis === 'neuVerbinden' ? <Hinweis art="warn">{t('gemeinsam.neuVerbinden')}</Hinweis> : null}
        {verbindung ? (
          <Hinweis art="neutral">
            {t('optionen.konto.wartet')} <span className="mono">{verbindung.code}</span>
          </Hinweis>
        ) : (
          <Knopf art="primaer" breit beschaeftigt={beschaeftigt} onClick={onVerbinden}>
            {t('gemeinsam.kontoVerbinden')}
          </Knopf>
        )}
      </Karte>
    );
  }

  if (!lizenz.premium) {
    return (
      <Karte className="stapel">
        <div className="premium__titel">{t('gemeinsam.premium')}</div>
        <p className="klein schwach">{t('popup.premium.text')}</p>
        {lizenz.hinweis === 'zahlungOffen' ? <Hinweis art="warn">{t('gemeinsam.zahlungOffen')}</Hinweis> : null}
        {lizenz.hinweis === 'angehalten' ? <Hinweis art="warn">{t('gemeinsam.angehalten')}</Hinweis> : null}
        <PremiumWahl breit onFehler={onFehler} />
        <KontoZeile email={konto.email} onTrennen={onTrennen} beschaeftigt={beschaeftigt} />
      </Karte>
    );
  }

  // Laufendes Premium: nur die Warnungen, die eine HANDLUNG verlangen.
  //
  // Weggefallen sind der Knopf „Premium verwalten" und die Kontozeile mit
  // „Trennen". Beide stehen auf der Optionsseite, die das Zahnrad oben
  // oeffnet. Ein Popup ist der Ort fuer den Blick auf DIESE Seite; was das
  // Konto betrifft, gehoert eine Ebene tiefer.
  //
  // Seit dem 10.09.2026 faellt auch „Endet am …" weg. Ein gekuendigtes Abo
  // laeuft bis zum Termin unveraendert weiter — bis dahin ist das Datum
  // keine Handlung, sondern eine Erinnerung an eine Entscheidung, die schon
  // getroffen ist, und sie stand bei JEDEM Oeffnen im Fenster. Wer den
  // Termin sehen will, findet ihn im Konto.
  //
  // Die Warnungen bleiben: „Zahlung offen" und „angehalten" sind kein Bericht
  // ueber den Vertrag, sondern der Hinweis, dass Premium gleich AUFHOERT.
  const warnung =
    lizenz.hinweis === 'zahlungOffen'
      ? t('gemeinsam.zahlungOffen')
      : lizenz.hinweis === 'angehalten'
        ? t('gemeinsam.angehalten')
        : null;
  if (!warnung) return null;
  return (
    <Karte className="stapel">
      <Hinweis art="warn">{warnung}</Hinweis>
    </Karte>
  );
}
