/**
 * Das Popup, von oben: Kopf, Site-Karte, globaler Schalter, Premium-Karte,
 * Fusszeile. Vier Zustaende: laden (Skeleton in Kartenform), Fehler (der
 * Hintergrund antwortet nicht), Inhalt, und eine Fehlerzeile fuer Aktionen,
 * die nicht geklappt haben (der Schalter springt dann zurueck).
 *
 * Beim Oeffnen: Ist die Lizenz aelter als eine Stunde, stoesst das Popup
 * eine Pruefung an (vertrag.md 6, Prueftakte). Das Ergebnis kommt ueber die
 * Speicheraenderung zurueck; das Popup wartet nicht darauf.
 */
import { useEffect, useRef, useState } from 'react';
import { LIZENZ_FRISCH_MS } from '../gemeinsam/konstanten.ts';
import { Hinweis, fehlerText } from '../oberflaeche/Hinweis.tsx';
import { Karte } from '../oberflaeche/Karte.tsx';
import { Knopf } from '../oberflaeche/Knopf.tsx';
import { Skeleton } from '../oberflaeche/Skeleton.tsx';
import { t, useSprache } from '../oberflaeche/i18n.ts';
import { aktiverTabId, NachrichtFehler, sende } from '../oberflaeche/laufzeit.ts';
import { nutzeZustand } from '../oberflaeche/nutzeZustand.ts';
import { Kopf } from './teile/Kopf.tsx';
import { MeldungDialog } from './teile/MeldungDialog.tsx';
import { PremiumKarte } from './teile/PremiumKarte.tsx';
import { SiteKarte } from './teile/SiteKarte.tsx';

function Skelett() {
  return (
    <>
      <Karte className="skelett-karte" aria-busy="true">
        <Skeleton hoehe={18} breite="55%" />
        <div className="reihe" style={{ justifyContent: 'space-between' }}>
          <div className="stapel wachsend" style={{ gap: 6 }}>
            <Skeleton hoehe={14} breite="70%" />
            <Skeleton hoehe={12} breite="45%" />
          </div>
          <Skeleton hoehe={34} breite={60} rund />
        </div>
      </Karte>
      <Karte eng className="reihe" style={{ justifyContent: 'space-between' }}>
        <Skeleton hoehe={14} breite="40%" />
        <Skeleton hoehe={26} breite={44} rund />
      </Karte>
      <Karte className="skelett-karte">
        <Skeleton hoehe={14} breite="30%" />
        <Skeleton hoehe={12} breite="90%" />
        <Skeleton hoehe={36} />
      </Karte>
    </>
  );
}

export function App() {
  useSprache();
  const [tabId, setTabId] = useState<number | null | undefined>(null);
  const { zustand, fehler, laedt, setze, neuLaden } = nutzeZustand(tabId);
  const [aktionsFehler, setAktionsFehler] = useState<string | null>(null);
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const [meldungOffen, setMeldungOffen] = useState(false);
  const lizenzAngestossen = useRef(false);

  useEffect(() => {
    void aktiverTabId().then((id) => setTabId(id));
  }, []);

  useEffect(() => {
    if (!zustand || lizenzAngestossen.current) return;
    lizenzAngestossen.current = true;
    if (zustand.konto.verbunden && Date.now() - zustand.lizenz.geprueftAm > LIZENZ_FRISCH_MS) {
      // Nicht warten und nicht klagen: Ist der Dienst gerade weg, gilt der
      // letzte Stand; das ist die Regel, kein Fehler.
      sende({ typ: 'lizenz.pruefen' }).catch(() => {});
    }
  }, [zustand]);

  async function aktion(optimistisch: () => void, zurueck: () => void, senden: () => Promise<unknown>) {
    setAktionsFehler(null);
    optimistisch();
    setBeschaeftigt(true);
    try {
      await senden();
    } catch (e) {
      zurueck();
      /*
       * Der uebersetzte Satz UND der Klartext dahinter.
       *
       * „Keine Verbindung zum Dienst" sagt einem Kunden, was er wissen muss.
       * Es sagt aber niemandem, WORAN es lag — und der Hintergrund weiss das:
       * Er faengt den Wurf von `fetch` und kennt dessen Meldung.
       *
       * Am 06.09.2026 stand genau dieser Satz auf einem Rechner, waehrend
       * derselbe Aufruf aus der Konsole derselben Erweiterung mit 201
       * durchlief. Ohne den Klartext war von aussen nicht zu entscheiden, ob
       * die Adresse falsch war, eine Berechtigung fehlte, ein zweiter Blocker
       * dazwischenstand oder das Netz schwieg — vier verschiedene Ursachen,
       * ein Satz.
       *
       * Der Zusatz steht klein und in Klammern: Er ist eine Angabe fuer den
       * Support, kein Satz, den jemand verstehen muss.
       */
      const f = e instanceof NachrichtFehler ? e : null;
      const satz = fehlerText(f?.code);
      setAktionsFehler(f?.grund ? `${satz} (${f.grund})` : satz);
    } finally {
      setBeschaeftigt(false);
    }
  }

  const siteSetzen = (blocken: boolean) => {
    const host = zustand?.tab?.host;
    if (!host) return;
    const erlaubt = !blocken;
    return aktion(
      () => setze((z) => ({ ...z, tab: z.tab ? { ...z.tab, erlaubt } : z.tab })),
      () => setze((z) => ({ ...z, tab: z.tab ? { ...z.tab, erlaubt: !erlaubt } : z.tab })),
      () => sende({ typ: 'site.setzen', host, erlaubt }),
    );
  };

  const verbinden = () =>
    aktion(
      () => {},
      () => {},
      async () => {
        await sende({ typ: 'konto.verbinden' });
        await neuLaden();
      },
    );

  // Ohne Rueckfrage, und das ist Absicht: Trennen loescht nichts. Der
  // Hintergrund legt `kontoHinweis` ab und laesst die Ausnahmen und eigenen
  // Regeln stehen; wer sich neu verbindet, ist sofort wieder da (Regel 7 des
  // Katalogeintrags). Ein Dialog vor einer ruecknehmbaren Handlung kostet
  // einen Klick und schuetzt vor nichts.
  const trennen = () =>
    aktion(
      () => {},
      () => {},
      async () => {
        await sende({ typ: 'konto.trennen' });
        await neuLaden();
      },
    );

  return (
    <div className="popup">
      <Kopf premium={zustand?.lizenz.premium === true} />
      {laedt && !zustand ? (
        <Skelett />
      ) : fehler || !zustand ? (
        <Hinweis art="fehler">{fehlerText(fehler ?? undefined)}</Hinweis>
      ) : (
        <>
          <SiteKarte
            premium={zustand.lizenz.premium}
            tab={zustand.tab}
            aktiv={zustand.aktiv}
            onWechsel={(b) => void siteSetzen(b)}
            beschaeftigt={beschaeftigt}
          />
          {zustand.listenFehler ? <Hinweis art="warn">{fehlerText(zustand.listenFehler)}</Hinweis> : null}
          <PremiumKarte
            zustand={zustand}
            onVerbinden={() => void verbinden()}
            onTrennen={() => void trennen()}
            onFehler={(code) => setAktionsFehler(fehlerText(code))}
            beschaeftigt={beschaeftigt}
          />
          {aktionsFehler ? <Hinweis art="fehler">{aktionsFehler}</Hinweis> : null}
          {/*
            Nur noch EIN Knopf, und der steht mittig.
            „Optionen" ist weg: Dieselbe Seite oeffnet das Zahnrad in der
            Kopfzeile. Zwei Wege zu einem Ziel sind einer zu viel — und der
            hier war der schlechtere, weil er unten stand und wie eine
            Nebensache aussah.
          */}
          <footer className="fuss fuss--mittig">
            <Knopf art="leise" klein disabled={!zustand.tab} onClick={() => setMeldungOffen(true)}>
              {t('popup.melden')}
            </Knopf>
          </footer>
          <MeldungDialog offen={meldungOffen} tabId={tabId ?? undefined} onSchliessen={() => setMeldungOffen(false)} />
        </>
      )}
    </div>
  );
}
