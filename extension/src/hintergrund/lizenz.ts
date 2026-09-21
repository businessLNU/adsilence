/**
 * Lizenz: Cache, Gnadenfrist, Prueftakte.
 *
 * Takte (vertrag.md 6): Start des Service Workers, Alarm alle 6 h, nach dem
 * Verbinden, nach der Rueckkehr vom Kauf (3 s, hoechstens 60 s), beim Oeffnen
 * des Popups, wenn der Stand aelter als eine Stunde ist.
 *
 * Nur EINE Pruefung zur Zeit: Popup und Alarm koennen zusammenfallen, und
 * zwei gleichzeitige Erneuerungen des Tokens sind genau das, was der Server
 * als Wiederverwendung bestraft.
 */

import { api } from '../gemeinsam/browser.ts';
import { API_BASIS, KAUF_MAX_MS, KAUF_TAKT_MS } from '../gemeinsam/konstanten.ts';
import { liesLokal, schreibeLokal } from '../gemeinsam/speicher.ts';
import type { Lizenz, LizenzHinweis } from '../gemeinsam/typen.ts';
import { allesAnwenden } from './anwenden.ts';
import { anfrageMitKonto } from './konto.ts';
import { freiLizenz, lizenzWirksam } from './lizenz-regeln.ts';

type LizenzAntwort = {
  tarif: 'frei' | 'premium';
  premium: boolean;
  planKeys?: string[];
  gueltigBis?: string | null;
  endetZumTermin?: boolean;
  hinweis?: LizenzHinweis;
  geprueftAm?: string;
};

/** Der wirksame Stand aus dem Speicher, nach Gnadenfrist. */
export async function aktuelleLizenz(): Promise<Lizenz> {
  const { lizenz } = await liesLokal('lizenz');
  return lizenzWirksam(lizenz, Date.now());
}

let laufendePruefung: Promise<Lizenz> | null = null;

export function lizenzPruefen(anlass: string): Promise<Lizenz> {
  if (!laufendePruefung) {
    laufendePruefung = pruefe(anlass).finally(() => {
      laufendePruefung = null;
    });
  }
  return laufendePruefung;
}

async function pruefe(anlass: string): Promise<Lizenz> {
  const jetzt = Date.now();
  const { konto, lizenz: alt } = await liesLokal('konto', 'lizenz');
  const vorher = lizenzWirksam(alt, jetzt).premium;

  if (!konto) {
    const frei = freiLizenz(jetzt);
    if (!alt || alt.premium) {
      await schreibeLokal({ lizenz: frei });
      if (vorher) await allesAnwenden();
    }
    return frei;
  }

  try {
    const a = await anfrageMitKonto<LizenzAntwort>('/api/adsilence/lizenz');
    const neu: Lizenz = {
      tarif: a.premium ? 'premium' : 'frei',
      premium: Boolean(a.premium),
      planKeys: Array.isArray(a.planKeys) ? a.planKeys : [],
      gueltigBis: a.gueltigBis ?? null,
      endetZumTermin: Boolean(a.endetZumTermin),
      hinweis: a.hinweis ?? null,
      geprueftAm: jetzt,
    };
    await schreibeLokal({ lizenz: neu });
    if (neu.premium !== vorher) await allesAnwenden();
    return neu;
  } catch (e) {
    // Trennen und Sperre hat konto.ts schon in den Speicher geschrieben;
    // alles andere heisst „letzter Stand bleibt".
    console.info('[AdSilence] Lizenzpruefung', anlass, e instanceof Error ? e.message : e);
    const { lizenz } = await liesLokal('lizenz');
    const wirksam = lizenzWirksam(lizenz, Date.now());
    if (wirksam.premium !== vorher) await allesAnwenden();
    return wirksam;
  }
}

// Rueckkehr vom Kauf

let kaufLaeuft = false;

/**
 * Nach dem Kauf schaltet der Webhook frei, nicht die Rueckkehrseite. Die
 * Erweiterung fragt deshalb nur nach: alle 3 s, bis Premium da ist oder 60 s
 * um sind. Laenger nicht; der 6-h-Alarm und das Popup holen den Rest.
 */
export function kaufRueckkehrPollen(): void {
  if (kaufLaeuft) return;
  kaufLaeuft = true;
  const start = Date.now();
  const tick = async (): Promise<void> => {
    let fertig = false;
    try {
      const l = await lizenzPruefen('kauf');
      fertig = l.premium;
    } catch {
      fertig = false;
    }
    if (fertig || Date.now() - start > KAUF_MAX_MS) {
      kaufLaeuft = false;
      return;
    }
    setTimeout(() => void tick(), KAUF_TAKT_MS);
  };
  void tick();
}

/**
 * Erkennt die Rueckkehrseite am eigenen Backend. Der Filter steht im
 * Lauscher: Der Browser weckt den Service Worker nur fuer diese eine
 * Adresse, nicht fuer jede Navigation.
 */
export function registriereKaufRueckkehr(): void {
  const nav = api.webNavigation as typeof chrome.webNavigation | undefined;
  if (!nav) return;
  try {
    nav.onCommitted.addListener(
      (details) => {
        if (details.frameId === 0) kaufRueckkehrPollen();
      },
      { url: [{ urlPrefix: `${API_BASIS}/erweiterung/fertig` }] },
    );
  } catch (e) {
    console.warn('[AdSilence] Kaufrueckkehr', e);
  }
}
