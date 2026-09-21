/**
 * Info: Version, Browser, der Datenschutz in einem Absatz (was den Browser
 * verlaesst und was nicht) und die beiden Rechtslinks aus der Basisadresse
 * plus Pfad.
 *
 * ── Eine ZEILE, kein eigener Abschnitt ─────────────────────────────────────
 * Bis zum 07.09.2026 war das ein `<section>` mit Ueberschrift und eigener
 * Karte, ganz unten auf der Seite. Sechs Zeilen Auskunft, die man einmal im
 * Leben liest, standen damit dauerhaft so gross da wie die Einstellungen
 * darueber, die man benutzt. Jetzt ist es eine Zeile in derselben Karte, die
 * sich auf Klick oeffnet - wie „Sprachlisten je Land" daneben.
 *
 * Die Version steht in der ZUGEKLAPPTEN Zeile. Sie ist die Auskunft, mit der
 * man herkommt („welche Fassung habe ich?"); haette man sie erst nach einem
 * Klick, waere der Klick reine Arbeit.
 *
 * ── Der Anker `#ueber` ─────────────────────────────────────────────────────
 * `oeffneOptionen('ueber')` und ein Lesezeichen auf `#ueber` landen weiter
 * hier: Die Zeile traegt `id="ueber-titel"`, worauf `App.tsx` rollt, und sie
 * startet OFFEN, wenn der Anker sie meint. Eine zugeklappte Zeile am Ziel
 * eines Sprungs waere derselbe Fehler wie gar kein Sprung.
 */
import { useState } from 'react';
import type { Zustand } from '../../gemeinsam/typen.ts';
import { Link } from '../../oberflaeche/Link.tsx';
import { t } from '../../oberflaeche/i18n.ts';
import { UMGEBUNG } from '../../oberflaeche/laufzeit.ts';

const BROWSER_NAME: Record<string, string> = { chromium: 'Chromium', firefox: 'Firefox', safari: 'Safari' };

export function Ueber({ zustand }: { zustand: Zustand }) {
  const [offen, setOffen] = useState(() => location.hash.replace(/^#/, '') === 'ueber');
  const basis = UMGEBUNG.apiBasis;

  return (
    <>
      <button
        type="button"
        className="aufklapper"
        aria-expanded={offen}
        aria-controls="ueber-inhalt"
        onClick={() => setOffen((o) => !o)}
      >
        <span className="wachsend">
          <span className="aufklapper__titel" id="ueber-titel">
            {t('optionen.ueber.titel')}
          </span>
          <span className="aufklapper__stand zahl">
            {t('optionen.ueber.version', { version: zustand.version || UMGEBUNG.version })}
          </span>
        </span>
        <span className="aufklapper__pfeil" aria-hidden="true" />
      </button>

      {offen ? (
        <div id="ueber-inhalt" className="aufklapper__inhalt">
          <dl className="paare">
            <dt>{t('optionen.ueber.browser')}</dt>
            <dd>{BROWSER_NAME[zustand.browser] ?? zustand.browser}</dd>
          </dl>
          <p className="klein schwach">{t('optionen.ueber.datenschutz')}</p>
          <div className="reihe" style={{ gap: 16 }}>
            <Link href={`${basis}/impressum`}>{t('optionen.ueber.impressum')}</Link>
            <Link href={`${basis}/datenschutz`}>{t('optionen.ueber.datenschutzLink')}</Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
