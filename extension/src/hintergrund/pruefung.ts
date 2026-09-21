/**
 * Handpruefung eingehender Nachrichten. Kein Zod im Service Worker: Die
 * Bibliothek wiegt mehr als der ganze Hintergrund, und geprueft werden hier
 * zwoelf flache Formen.
 */

import { MELDUNG_MAX_KOMMENTAR, MELDUNG_MAX_LISTEN, MELDUNG_MAX_REGELN, MELDUNG_MAX_REGEL_LAENGE, MELDUNG_MAX_SEITE } from '../gemeinsam/konstanten.ts';
import type { Browser, Nachricht } from '../gemeinsam/typen.ts';

export function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
export const istString = (x: unknown): x is string => typeof x === 'string';
export const istBoolean = (x: unknown): x is boolean => typeof x === 'boolean';
export const istZahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const istStringListe = (x: unknown): x is string[] => Array.isArray(x) && x.every(istString);

const BROWSER: Browser[] = ['chromium', 'firefox', 'safari'];
const INTERVALLE = ['monthly', 'yearly'];

/** Hostname, wie ihn `new URL().hostname` liefert: klein, ohne Schema, ohne Pfad. */
export function istHost(x: unknown): x is string {
  return istString(x) && x.length > 0 && x.length <= 253 && /^[a-z0-9.-]+$/.test(x) && !x.startsWith('.') && !x.endsWith('.');
}

/**
 * Gibt die Nachricht typisiert zurueck oder null. Unbekannte Felder werden
 * nicht abgestreift, aber auch nicht gelesen; ein Feld mit falschem Typ
 * macht die ganze Nachricht ungueltig.
 */
export function pruefeNachricht(roh: unknown): Nachricht | null {
  if (!istObjekt(roh) || !istString(roh.typ)) return null;
  const n = roh;
  switch (n.typ) {
    case 'zustand':
      return n.tabId === undefined || istZahl(n.tabId) ? { typ: 'zustand', tabId: n.tabId as number | undefined } : null;
    case 'aktiv.setzen':
      return istBoolean(n.aktiv) ? { typ: 'aktiv.setzen', aktiv: n.aktiv } : null;
    case 'site.setzen':
      return istHost(n.host) && istBoolean(n.erlaubt) ? { typ: 'site.setzen', host: n.host, erlaubt: n.erlaubt } : null;
    case 'liste.setzen':
      return istString(n.id) && istBoolean(n.aktiv) ? { typ: 'liste.setzen', id: n.id, aktiv: n.aktiv } : null;
    case 'konto.verbinden':
    case 'konto.trennen':
    case 'lizenz.pruefen':
    case 'abgleich.jetzt':
      return { typ: n.typ };
    case 'premium.kaufen':
      if (!istString(n.interval) || !INTERVALLE.includes(n.interval)) return null;
      if (n.zustimmung !== undefined && !istBoolean(n.zustimmung)) return null;
      return { typ: 'premium.kaufen', interval: n.interval as 'monthly' | 'yearly', zustimmung: n.zustimmung as boolean | undefined };
    // Ohne Feld, also nichts zu pruefen - der Fall steht hier, damit eine
    // neue Nachricht nicht stillschweigend durchfaellt.
    case 'tarife.holen':
      return { typ: 'tarife.holen' };
    case 'meldung.vorschau':
      return istZahl(n.tabId) ? { typ: 'meldung.vorschau', tabId: n.tabId } : null;
    case 'meldung.senden': {
      if (!istString(n.seite) || n.seite.length > MELDUNG_MAX_SEITE) return null;
      if (!istString(n.browser) || !BROWSER.includes(n.browser as Browser)) return null;
      if (!istString(n.version) || n.version.length > 40) return null;
      if (!istStringListe(n.listen) || n.listen.length > MELDUNG_MAX_LISTEN) return null;
      if (!istStringListe(n.regeln) || n.regeln.length > MELDUNG_MAX_REGELN) return null;
      if (n.regeln.some((r) => r.length > MELDUNG_MAX_REGEL_LAENGE)) return null;
      if (n.kommentar !== undefined && (!istString(n.kommentar) || n.kommentar.length > MELDUNG_MAX_KOMMENTAR)) return null;
      return {
        typ: 'meldung.senden',
        seite: n.seite,
        browser: n.browser as Browser,
        version: n.version,
        listen: n.listen,
        regeln: n.regeln,
        kommentar: n.kommentar as string | undefined,
      };
    }
    case 'regeln.eigene.setzen':
      return istString(n.text) && n.text.length <= 200_000 ? { typ: 'regeln.eigene.setzen', text: n.text } : null;
    case 'kosmetik':
      // Auch der LEERE Host ist gueltig: ein about:blank-, srcdoc-, blob:-
      // oder data:-Rahmen unter einem Elternrahmen fremder Herkunft, dessen
      // Host das Inhaltsskript nicht kennt (Firefox ohne `ancestorOrigins`).
      // Die oberste Seite kommt dann aus `sender.tab.url`, und daran haengt
      // die Entscheidung ueber das Rauschen; Selektoren gibt es fuer '' keine.
      return istHost(n.host) || n.host === '' ? { typ: 'kosmetik', host: n.host } : null;
    case 'kosmetik.generisch':
      // Hoechstens so viele Listen, wie es geben kann; jede Kennung nur aus
      // Kleinbuchstaben, Ziffern und Bindestrich - sie wird zum Dateipfad.
      return istStringListe(n.listen) &&
        n.listen.length <= MELDUNG_MAX_LISTEN &&
        n.listen.every((id) => /^[a-z0-9-]{1,40}$/.test(id))
        ? { typ: 'kosmetik.generisch', listen: n.listen }
        : null;
    case 'cookies.antwort':
      return { typ: 'cookies.antwort' };
    case 'listen.pflegen':
      return { typ: 'listen.pflegen' };
    case 'verwechslung.pruefen':
      // Derselbe Hostprüfer wie bei `kosmetik`: Was hier hereinkommt, stammt
      // aus einem Inhaltsskript auf einer FREMDEN Seite und ist damit die am
      // wenigsten vertrauenswürdige Eingabe, die die Erweiterung kennt.
      return istHost(n.host) ? { typ: 'verwechslung.pruefen', host: n.host } : null;
    default:
      return null;
  }
}

/**
 * Kuerzt eine Seitenadresse auf Herkunft und Pfad. Query und Fragment tragen
 * Sitzungen, Suchbegriffe, Token; nichts davon gehoert in eine Meldung.
 * Der Server kuerzt noch einmal; hier geschieht es, damit die VORSCHAU
 * zeigt, was wirklich geht.
 */
export function seiteOhneQuery(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}${u.pathname}`.slice(0, MELDUNG_MAX_SEITE);
  } catch {
    return null;
  }
}
