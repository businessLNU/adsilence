/**
 * Die Optionsseite: Kopf, ZWEI Reiter, ein Bereich. Kein Router; der
 * Bereich steht im Anker (`#konto`), damit das Popup direkt hinspringen kann
 * und Zurueck im Browser funktioniert.
 *
 * ── Warum zwei und nicht fuenf ────────────────────────────────────────────
 * Der Reiter beantwortet eine Frage: WAS wird geblockt (Filterlisten) oder
 * WIE haette ich es gern (alles andere). „Konto", „Info" und seit dem
 * 07.09.2026 auch „Ausnahmen" stehen UNTER „Einstellungen", nicht daneben.
 *
 * „Ausnahmen" war der letzte Reiter, der eine eigene Zeile bekam, obwohl er
 * eine Einstellung ist: eine Liste von Hosts, auf denen AdSilence nichts tun
 * soll. Wer sie sucht, sucht sie dort, wo auch der Rest steht, den er selbst
 * entschieden hat.
 *
 * ── Ein Bauplan fuer alle Abschnitte ──────────────────────────────────────
 * Jeder Abschnitt ist: Ueberschrift (und hoechstens ein Satz) AUSSERHALB,
 * alles Bedienbare in GENAU EINER weissen Karte darunter. Vorher war es
 * gemischt - die beiden Auswahlfelder standen nackt auf dem Grau, die
 * Schalter in einer Karte, der Konto-Knopf wieder nackt daneben. Drei
 * Bauweisen auf einem Bildschirm lesen sich als drei Sachen, die nichts
 * miteinander zu tun haben.
 *
 * Der Reiterwechsel ist NICHT animiert: Wer zwischen Listen und
 * Einstellungen hin und her springt, will die Inhalte, nicht die Bewegung.
 * Nur die Listenzeilen treten gestaffelt ein (40 ms, hoechstens acht).
 */
import { useEffect, useState } from 'react';
import { Hinweis, fehlerText } from '../oberflaeche/Hinweis.tsx';
import { Skeleton } from '../oberflaeche/Skeleton.tsx';
import { Marke } from '../oberflaeche/Symbole.tsx';
import { t, useSprache } from '../oberflaeche/i18n.ts';
import { paketUrl } from '../oberflaeche/laufzeit.ts';
import { nutzeZustand } from '../oberflaeche/nutzeZustand.ts';
import { Einstellungen } from './teile/Einstellungen.tsx';
import { Filterlisten } from './teile/Filterlisten.tsx';

const BEREICHE = ['filterlisten', 'einstellungen'] as const;
type Bereich = (typeof BEREICHE)[number];

/**
 * Anker, die es als eigenen Reiter nicht mehr gibt.
 *
 * `oeffneOptionen('konto')` steht so im Vertrag der Laufzeit, und ein Lesezeichen
 * auf `#konto` ist eine Adresse, die einmal funktioniert hat. Beide landen
 * weiterhin dort, wo der Inhalt jetzt steht — still auf den ersten Reiter zu
 * fallen waere die schlechtere Antwort als die richtige Stelle.
 */
const UMLEITUNG: Record<string, Bereich> = { konto: 'einstellungen', ueber: 'einstellungen', ausnahmen: 'einstellungen' };

function bereichAusAnker(): Bereich {
  const anker = location.hash.replace(/^#/, '');
  if ((BEREICHE as readonly string[]).includes(anker)) return anker as Bereich;
  return UMLEITUNG[anker] ?? 'filterlisten';
}

export function App() {
  useSprache();
  const [bereich, setBereich] = useState<Bereich>(bereichAusAnker);
  const [bildFehlt, setBildFehlt] = useState(false);
  const { zustand, fehler, laedt, neuLaden } = nutzeZustand(undefined);

  useEffect(() => {
    document.title = t('optionen.titel');
  });

  useEffect(() => {
    const beiAnker = () => setBereich(bereichAusAnker());
    window.addEventListener('hashchange', beiAnker);
    return () => window.removeEventListener('hashchange', beiAnker);
  }, []);

  /*
   * Ein umgeleiteter Anker rollt zu SEINEM Abschnitt.
   *
   * Ohne das landet `#konto` oben bei der Sprachauswahl, und der Nutzer sucht
   * das Konto auf einer Seite, auf der es steht — nur weiter unten. Die
   * Ueberschriften tragen die Anker schon (`konto-titel`, `ueber-titel`),
   * weil `aria-labelledby` sie ohnehin braucht.
   */
  useEffect(() => {
    const anker = location.hash.replace(/^#/, '');
    if (!UMLEITUNG[anker] || !zustand) return;
    document.getElementById(`${anker}-titel`)?.scrollIntoView({ block: 'start' });
  }, [bereich, zustand]);

  function wechsle(zu: Bereich) {
    if (zu === bereich) return;
    history.pushState(null, '', `#${zu}`);
    setBereich(zu);
  }

  let inhalt;
  if (laedt && !zustand) {
    inhalt = (
      <div className="bereich" aria-busy="true">
        <div className="stapel" style={{ gap: 8 }}>
          <Skeleton hoehe={20} breite="30%" />
          <Skeleton hoehe={14} breite="60%" />
        </div>
        <div className="liste">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="liste__zeile">
              <div className="stapel wachsend" style={{ gap: 6 }}>
                <Skeleton hoehe={14} breite="35%" />
                <Skeleton hoehe={12} breite="55%" />
              </div>
              <Skeleton hoehe={26} breite={44} rund />
            </div>
          ))}
        </div>
      </div>
    );
  } else if (fehler || !zustand) {
    inhalt = <Hinweis art="fehler">{fehlerText(fehler ?? undefined)}</Hinweis>;
  } else {
    switch (bereich) {
      case 'filterlisten':
        inhalt = <Filterlisten zustand={zustand} />;
        break;
      case 'einstellungen':
        /*
         * EIN Abschnitt, eine Karte. „Ausnahmen", „Konto" und „Info" waren
         * bis zum 07.09.2026 eigene Reiter, danach kurz eigene Abschnitte
         * unter diesem einen; jetzt sind sie Aufklappzeilen IN der Karte von
         * `Einstellungen`.
         *
         * Der Weg dahin ging ueber die Zwischenstufe „drei Abschnitte
         * untereinander, getrennt durch Haarlinien". Die sah aus wie drei
         * Sachen, die zufaellig auf demselben Bildschirm liegen - jede mit
         * eigener Ueberschrift in der Groesse der Seitenueberschrift, jede
         * mit eigener Karte. Eine Liste mit sieben Zeilen beantwortet
         * dieselbe Frage in einem Blick.
         *
         * Die Anker `#ausnahmen`, `#konto` und `#ueber` klappen ihre Zeile
         * OFFEN auf (jede Zeile liest den Anker selbst) und `App.tsx` rollt
         * hin - der Titel jeder Zeile traegt `id="<anker>-titel"`.
         */
        inhalt = <Einstellungen zustand={zustand} neuLaden={neuLaden} />;
        break;
    }
  }

  return (
    <div className="seite">
      <header className="seite__kopf">
        {bildFehlt ? <Marke groesse={32} /> : <img className="seite__bild" src={paketUrl('icons/icon-48.png')} alt="" onError={() => setBildFehlt(true)} />}
        <h1>{t('extName')}</h1>
      </header>
      <nav className="nav" aria-label={t('optionen.nav.label')}>
        {BEREICHE.map((b) => (
          <button key={b} type="button" className="nav__eintrag drueckbar" aria-current={b === bereich ? 'page' : undefined} onClick={() => wechsle(b)}>
            {t(`optionen.nav.${b}`)}
          </button>
        ))}
      </nav>
      <main key={bereich}>{inhalt}</main>
    </div>
  );
}
