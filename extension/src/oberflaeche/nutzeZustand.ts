/**
 * Der Zustand aus dem Hintergrund als React-Hook.
 *
 * Beim Start `{ typ: 'zustand' }`, danach bei jeder Speicheraenderung neu
 * (Einstellungen, Ausnahmen, Konto, Lizenz, Verbindung). So zeigt das Popup
 * den Wechsel, den die Optionsseite eben gemacht hat, ohne Neuladen, und
 * umgekehrt. Mehrere Aenderungen im selben Tick loesen EINE Anfrage aus.
 *
 * `setze()` aendert den Zustand optimistisch: Wer den Schalter drueckt,
 * sieht ihn sofort umspringen; kommt der Fehler, springt er zurueck.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeicherLokal, Zustand } from '../gemeinsam/typen.ts';
import { beiSpeicherAenderung, NachrichtFehler, sende } from './laufzeit.ts';
import { sofortZustand } from './sofortZustand.ts';

const RELEVANT: ReadonlyArray<keyof SpeicherLokal> = ['einstellungen', 'sites', 'konto', 'kontoHinweis', 'lizenz', 'verbindungOffen', 'eigeneRegeln', 'abgleich'];

export type ZustandHook = {
  zustand: Zustand | null;
  fehler: string | null;
  laedt: boolean;
  neuLaden: () => Promise<void>;
  setze: (aenderung: (alt: Zustand) => Zustand) => void;
};

export function nutzeZustand(tabId?: number | null): ZustandHook {
  const [zustand, setZustand] = useState<Zustand | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const angefragt = useRef(false);
  const lebt = useRef(true);

  const neuLaden = useCallback(async () => {
    if (angefragt.current) return;
    angefragt.current = true;
    try {
      const antwort = await sende({ typ: 'zustand', ...(typeof tabId === 'number' ? { tabId } : {}) });
      if (!lebt.current) return;
      setZustand(antwort);
      setFehler(null);
    } catch (e) {
      if (!lebt.current) return;
      setFehler(e instanceof NachrichtFehler ? e.code : 'HINTERGRUND_FEHLT');
    } finally {
      angefragt.current = false;
      if (lebt.current) setLaedt(false);
    }
  }, [tabId]);

  // Erst zeichnen, dann fragen: Der Klick aufs Symbol weckt unter MV3 den
  // Service Worker, und bis der antwortet, vergeht auf einem langsamen
  // Rechner mehr als eine Sekunde (gemessen: 1451 ms kalt, 75 ms warm). So
  // lange stand hier ein leeres Fenster. Der vorlaeufige Zustand kommt aus
  // dem lokalen Speicher und wird von der Antwort ueberschrieben.
  //
  // Ohne Warten auf `tabId`: Die Tab-Abfrage ist selbst ein Rundlauf, und
  // `sofortZustand` macht sie bei Bedarf selbst. Nacheinander waren es zwei
  // Wartezeiten hintereinander, bevor ueberhaupt etwas zu sehen war.
  useEffect(() => {
    let gilt = true;
    void sofortZustand(typeof tabId === 'number' ? tabId : undefined).then((vorlaeufig) => {
      if (!gilt || !vorlaeufig) return;
      // Nur, solange die echte Antwort noch aussteht - sonst wuerde ein
      // spaeter eintreffender Vorlaeufiger den genauen Stand zurueckdrehen.
      setZustand((alt) => alt ?? vorlaeufig);
      setLaedt(false);
    });
    return () => {
      gilt = false;
    };
    // Absichtlich EINMAL beim Aufgehen: Der vorlaeufige Zustand ist nur fuer
    // das erste Bild da; sobald `tabId` steht, holt die Anfrage an den
    // Hintergrund den genauen Stand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    lebt.current = true;
    // `tabId === null` heisst: noch nicht ermittelt. Erst dann fragen, wenn
    // wir wissen, fuer welchen Tab; sonst kaeme ein Zustand ohne Site.
    if (tabId === null) return;
    void neuLaden();
    let geplant = false;
    const ab = beiSpeicherAenderung((aenderungen) => {
      if (!RELEVANT.some((k) => k in aenderungen)) return;
      if (geplant) return;
      geplant = true;
      queueMicrotask(() => {
        geplant = false;
        void neuLaden();
      });
    });
    return () => {
      lebt.current = false;
      ab();
    };
  }, [neuLaden, tabId]);

  const setze = useCallback((aenderung: (alt: Zustand) => Zustand) => {
    setZustand((alt) => (alt ? aenderung(alt) : alt));
  }, []);

  return { zustand, fehler, laedt, neuLaden, setze };
}
